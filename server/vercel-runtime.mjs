import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import worker from '../cloudflare/worker.mjs';
import { configuredPassword } from '../cloudflare/auth.mjs';
import { runWhatsAppAutomation } from '../cloudflare/automation.mjs';
import { getPostgresDatabase } from './postgres.mjs';

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const DATABASE_UNAVAILABLE = 'O banco de dados está indisponível. Configure o Supabase e aplique as migrações.';
const BODY_LIMIT = 32 * 1024;
const PHOTO_BODY_LIMIT = 300 * 1024;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...API_HEADERS, ...headers } });
}

function constantTimeEqual(actual, expected) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function unavailableResponse(path) {
  if (path === '/api/auth/status') {
    return json({ authenticated: false, required: true, configured: false });
  }
  if (path === '/api/fitness/auth/status') return json({ student: null });
  return json({ error: DATABASE_UNAVAILABLE }, 503);
}

/** Vercel owns x-vercel-forwarded-for. Never reuse user-supplied Cloudflare IPs. */
function trustedHeaders(request, env) {
  const headers = new Headers(request.headers);
  const forwarded = env.VERCEL === '1' ? headers.get('x-vercel-forwarded-for')?.trim() : '';
  headers.set('CF-Connecting-IP', forwarded && isIP(forwarded) ? forwarded : 'unknown');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');
  return headers;
}

/** Shared Web API entrypoint, also useful for local server and integration tests. */
export async function handleVercelRequest(request, {
  env = process.env,
  databaseFactory = getPostgresDatabase,
  appHandler = (incoming, bindings) => worker.fetch(incoming, bindings),
  automation = runWhatsAppAutomation,
} = {}) {
  const path = new URL(request.url).pathname;
  if (path !== '/api' && !path.startsWith('/api/')) return json({ error: 'Rota não encontrada.' }, 404);

  const isCron = path === '/api/cron/whatsapp';
  if (isCron) {
    if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405, { Allow: 'GET' });
    if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 16) {
      return json({ error: 'O agendamento está indisponível até configurar CRON_SECRET.' }, 503);
    }
    const authorization = request.headers.get('Authorization') || '';
    if (!constantTimeEqual(authorization, `Bearer ${env.CRON_SECRET}`)) {
      return json({ error: 'Agendamento não autorizado.' }, 401);
    }
  }

  let DB;
  try {
    DB = await databaseFactory(env);
    if (!DB?.prepare || !DB?.batch) throw new Error('Database unavailable');
  } catch {
    const response = unavailableResponse(path);
    // The existing login UI needs to distinguish a missing password from a
    // disconnected database without allowing a login or exposing credentials.
    if (path === '/api/auth/status') {
      return json({ authenticated: false, required: true, configured: configuredPassword(env) });
    }
    return response;
  }

  const bindings = { ...env, DB };
  try {
    if (isCron) return json(await automation(bindings));
    const incoming = new Request(request, { headers: trustedHeaders(request, env) });
    const response = await appHandler(incoming, bindings);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    // The shared production auth emits Secure cookies. Plain HTTP is supported
    // only by the explicit local development server, never on Vercel.
    if (env.VERCEL !== '1' && env.NODE_ENV !== 'production' && new URL(request.url).protocol === 'http:') {
      const cookies = headers.getSetCookie();
      if (cookies.length) {
        headers.delete('Set-Cookie');
        for (const cookie of cookies) headers.append('Set-Cookie', cookie.replace(/;\s*Secure\b/gi, ''));
      }
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    // Do not log database URLs, SQL, cookie material or upstream response bodies.
    return json({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 500);
  }
}

function canonicalUrl(req, env) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !host || /[\s,/@\\?#]/.test(host)) throw new Error('Invalid host');
  const protocol = env.VERCEL === '1' || env.NODE_ENV === 'production' || req.socket?.encrypted ? 'https:' : 'http:';
  const origin = new URL(`${protocol}//${host}`);
  if (origin.pathname !== '/' || origin.username || origin.password) throw new Error('Invalid host');
  const path = req.url || '/';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Invalid path');
  const url = new URL(path, origin);
  if (url.origin !== origin.origin) throw new Error('Invalid origin');
  return url;
}

async function readBody(req, limit) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > limit)) {
    throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  const chunks = [];
  let length = 0;
  const stream = typeof req.iterator === 'function' ? req.iterator({ destroyOnReturn: false }) : req;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) {
      req.resume?.();
      throw Object.assign(new Error('Body too large'), { status: 413 });
    }
    chunks.push(bytes);
  }
  // Vercel helpers may have parsed the request before invoking a Node handler.
  // In that case enforce the same bound on the supplied body as on raw streams.
  if (!length && Object.hasOwn(req, 'body') && req.body !== undefined) {
    const value = req.body;
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    if (bytes.length > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    return bytes;
  }
  return Buffer.concat(chunks, length);
}

async function sendResponse(res, response, method) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
}

/** Standard Node.js Vercel Function. Does not start a server or open SQLite. */
export function createVercelHandler(options = {}) {
  return async function handler(req, res) {
    const env = options.env ?? process.env;
    let response;
    try {
      const url = canonicalUrl(req, env);
      const method = req.method || 'GET';
      const headers = new Headers();
      for (const [name, values] of Object.entries(req.headers)) {
        if (Array.isArray(values)) for (const value of values) headers.append(name, value);
        else if (values !== undefined) headers.set(name, String(values));
      }
      const body = ['GET', 'HEAD'].includes(method) ? undefined
        : await readBody(req, url.pathname === '/api/fitness/feed' ? PHOTO_BODY_LIMIT : BODY_LIMIT);
      const incoming = new Request(url, { method, headers, body });
      response = await handleVercelRequest(incoming, { ...options, env });
    } catch (error) {
      response = error.status === 413
        ? json({ error: 'Os dados enviados excedem o tamanho permitido.' }, 413)
        : json({ error: 'Solicitação inválida.' }, 400);
    }
    return sendResponse(res, response, req.method);
  };
}
