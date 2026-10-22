import express from 'express';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const deriveKey = promisify(scrypt);
const PASSWORD_SALT = 'Marcos Squad dashboard authentication v1';
const COOKIE_NAME = 'ms_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const MAX_LIMITER_KEYS = 10000;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function sameOrigin(req, res, next) {
  if (!MUTATIONS.has(req.method) || !req.get('origin')) return next();
  try {
    const origin = new URL(req.get('origin'));
    const expected = new URL(`${req.protocol}://${req.host}`);
    if (origin.origin === expected.origin && origin.href === `${origin.origin}/`) return next();
  } catch {
    // Invalid and opaque origins must never authorize a state-changing request.
  }
  return res.status(403).json({ error: 'Origem da solicitação não permitida.' });
}

function sessionToken(req) {
  const values = (req.get('cookie') ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/**
 * Mount router at /api/auth, then middleware at /api before private routes.
 * The /api/health GET remains public. Set Express trust proxy to match the
 * deployment's actual proxy so req.secure, req.host and req.ip are trustworthy.
 * No password is exposed in responses, cookies or the SQLite session table.
 */
export function createAuth(db, options = {}) {
  const password = options.password ?? process.env.DASHBOARD_PASSWORD;
  const configured = typeof password === 'string' && password.length > 0;
  if (configured && Buffer.byteLength(password, 'utf8') > 256) {
    throw new Error('DASHBOARD_PASSWORD deve ter no máximo 256 bytes.');
  }
  const required = options.required ?? (
    process.env.NODE_ENV === 'production'
    || process.env.REQUIRE_AUTH === 'true'
    || configured
  );
  const now = () => Number((options.now ?? Date.now)());
  const expectedKey = configured ? scryptSync(password, PASSWORD_SALT, 64) : null;
  const passwordVersion = expectedKey ? hash(expectedKey) : '';
  const attempts = new Map();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ms_sessions (
      token_hash TEXT PRIMARY KEY,
      password_version TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ms_sessions_expiry ON ms_sessions(expires_at);
  `);
  const deleteExpired = db.prepare('DELETE FROM ms_sessions WHERE expires_at <= ? OR password_version != ?');
  const getSession = db.prepare('SELECT expires_at FROM ms_sessions WHERE token_hash = ? AND password_version = ?');
  const insertSession = db.prepare('INSERT INTO ms_sessions (token_hash, password_version, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const removeSession = db.prepare('DELETE FROM ms_sessions WHERE token_hash = ?');
  deleteExpired.run(now(), passwordVersion);

  function authenticated(req) {
    if (!required) return true;
    if (!configured) return false;
    const token = sessionToken(req);
    if (!token) return false;
    const stored = getSession.get(hash(token), passwordVersion);
    return !!stored && stored.expires_at > now();
  }

  function unavailable(res) {
    return res.status(503).json({ error: 'O acesso está indisponível até a senha do painel ser configurada no servidor.' });
  }

  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(sameOrigin);
  router.get('/status', (req, res) => {
    res.json({ authenticated: authenticated(req), required: !!required, configured });
  });

  router.post('/login', async (req, res) => {
    if (!configured) {
      if (required) return unavailable(res);
      return res.json({ authenticated: true, required: false });
    }
    const time = now();
    for (const [key, attempt] of attempts) {
      if (attempt.resetAt <= time) attempts.delete(key);
    }
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let attempt = attempts.get(key);
    if (!attempt) {
      if (attempts.size >= MAX_LIMITER_KEYS) {
        res.set('Retry-After', String(LOGIN_WINDOW_MS / 1000));
        return res.status(429).json({ error: 'Muitas tentativas de acesso. Tente novamente em 15 minutos.' });
      }
      attempt = { count: 0, resetAt: time + LOGIN_WINDOW_MS };
      attempts.set(key, attempt);
    }
    if (attempt.count >= LOGIN_LIMIT) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((attempt.resetAt - time) / 1000))));
      return res.status(429).json({ error: 'Muitas tentativas de acesso. Tente novamente em 15 minutos.' });
    }
    // Count every attempt before asynchronous verification, including successes.
    // A concurrent request or successful guess cannot reset the rate limit.
    attempt.count += 1;
    const supplied = req.body?.password;
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied, 'utf8') > 256) {
      return res.status(400).json({ error: 'Informe uma senha com até 256 bytes.' });
    }
    const actualKey = await deriveKey(supplied, PASSWORD_SALT, 64);
    if (!timingSafeEqual(expectedKey, actualKey)) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    const token = randomBytes(32).toString('base64url');
    const issuedAt = now();
    deleteExpired.run(issuedAt, passwordVersion);
    insertSession.run(hash(token), passwordVersion, issuedAt, issuedAt + SESSION_TTL_MS);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: SESSION_TTL_MS,
    });
    return res.json({ authenticated: true, required: !!required });
  });

  router.post('/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) removeSession.run(hash(token));
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
    res.status(204).end();
  });

  function middleware(req, res, next) {
    if ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/health') return next();
    return sameOrigin(req, res, () => {
      if (required && !configured) return unavailable(res);
      if (!authenticated(req)) return res.status(401).json({ error: 'Entre com sua senha para acessar o painel.' });
      return next();
    });
  }

  return { router, middleware, authenticated, required: !!required, configured };
}
