const COOKIE_NAME = 'ms_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const encoder = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hash(value) {
  return Array.from(await digest(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function configuredPassword(env) {
  return typeof env.DASHBOARD_PASSWORD === 'string'
    && encoder.encode(env.DASHBOARD_PASSWORD).byteLength <= 256
    && Array.from(env.DASHBOARD_PASSWORD).length >= 12;
}

export function assertSameOrigin(request) {
  if (!MUTATIONS.has(request.method)) return;
  const supplied = request.headers.get('Origin');
  if (supplied === null) return;
  try {
    const origin = new URL(supplied);
    if (origin.origin === new URL(request.url).origin && origin.href === `${origin.origin}/`) return;
  } catch {
    // Opaque, malformed, credential-bearing and cross-origin values are rejected.
  }
  throw new HttpError(403, 'Origem da solicitação não permitida.');
}

function sessionToken(request) {
  const values = (request.headers.get('Cookie') ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function unavailable() {
  throw new HttpError(503, 'O acesso está indisponível até configurar uma senha do painel com pelo menos 12 caracteres no servidor.');
}

export async function authenticated(request, env, time = Date.now()) {
  if (!configuredPassword(env)) return false;
  const token = sessionToken(request);
  if (!token) return false;
  const passwordVersion = await hash(env.DASHBOARD_PASSWORD);
  const row = await env.DB.prepare('SELECT expires_at FROM ms_sessions WHERE token_hash = ? AND password_version = ?')
    .bind(await hash(token), passwordVersion).first();
  return !!row && row.expires_at > time;
}

export async function requireAuthenticated(request, env) {
  if (!configuredPassword(env)) unavailable();
  if (!await authenticated(request, env)) {
    throw new HttpError(401, 'Entre com sua senha para acessar o painel.');
  }
}

async function reserveLogin(request, env, time) {
  // Cloudflare supplies and overwrites this header at the edge. Do not trust a
  // user-controlled X-Forwarded-For value. Store a digest rather than the IP.
  const ipKey = await hash(request.headers.get('CF-Connecting-IP') || 'unknown');
  const resetAt = time + LOGIN_WINDOW_MS;
  // The atomic batch reserves a slot before password verification and reads
  // that reservation in the same transaction, including concurrent requests.
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM ms_login_attempts WHERE reset_at <= ?').bind(time),
    env.DB.prepare(`INSERT INTO ms_login_attempts (ip_key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(ip_key) DO UPDATE SET
      count = CASE WHEN reset_at <= ? THEN 1 ELSE MIN(count + 1, 6) END,
      reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END`)
      .bind(ipKey, resetAt, time, time, resetAt),
    env.DB.prepare('SELECT count, reset_at FROM ms_login_attempts WHERE ip_key = ?').bind(ipKey),
  ]);
  const attempt = results[2].results[0];
  if (attempt.count > LOGIN_LIMIT) {
    throw new HttpError(429, 'Muitas tentativas de acesso. Tente novamente em 15 minutos.', {
      'Retry-After': String(Math.max(1, Math.ceil((attempt.reset_at - time) / 1000))),
    });
  }
}

export async function login(request, env, input) {
  if (!configuredPassword(env)) unavailable();
  await reserveLogin(request, env, Date.now());
  const supplied = input?.password;
  if (typeof supplied !== 'string' || encoder.encode(supplied).byteLength > 256) {
    throw new HttpError(400, 'Informe uma senha com até 256 bytes.');
  }
  const [expectedDigest, suppliedDigest] = await Promise.all([
    digest(env.DASHBOARD_PASSWORD), digest(supplied),
  ]);
  let difference = 0;
  for (let index = 0; index < 32; index += 1) difference |= expectedDigest[index] ^ suppliedDigest[index];
  if (difference !== 0) throw new HttpError(401, 'Senha incorreta.');

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const time = Date.now();
  const passwordVersion = await hash(env.DASHBOARD_PASSWORD);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ms_sessions WHERE expires_at <= ? OR password_version != ?').bind(time, passwordVersion),
    env.DB.prepare('INSERT INTO ms_sessions (token_hash, password_version, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await hash(token), passwordVersion, time, time + SESSION_TTL_MS),
  ]);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export async function logout(request, env) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM ms_sessions WHERE token_hash = ?').bind(await hash(token)).run();
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
