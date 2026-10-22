import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import express from 'express';
import { createAuth } from './auth.mjs';

const testPassword = 'senha-exclusiva-de-teste';

async function start({ password = testPassword, required = true, now, db: suppliedDb, trustProxy = false } = {}) {
  const db = suppliedDb ?? new DatabaseSync(':memory:');
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());
  const auth = createAuth(db, { password, required, now });
  app.use('/api/auth', auth.router);
  app.use('/api', auth.middleware);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.all('/api/private', (_req, res) => res.json({ protected: true }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, base,
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (!suppliedDb) db.close();
    },
    async request(path, { method = 'GET', password: submittedPassword, cookie, origin, headers = {}, data } = {}) {
      const body = submittedPassword !== undefined ? { password: submittedPassword } : data;
      const res = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: res.status, data: res.status === 204 ? null : await res.json(),
        cookie: res.headers.get('set-cookie'), retryAfter: res.headers.get('retry-after'),
      };
    },
  };
}

test('authentication protects every API method and persists only a hashed session token', async (t) => {
  const api = await start();
  t.after(() => api.stop());
  assert.deepEqual((await api.request('/auth/status')).data, { authenticated: false, required: true, configured: true });
  assert.equal((await api.request('/health')).status, 200);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await api.request('/private', { method })).status, 401);
  }
  assert.equal((await api.request('/auth/login', { method: 'POST', password: 'incorrect' })).status, 401);
  const login = await api.request('/auth/login', { method: 'POST', password: testPassword });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /HttpOnly/);
  assert.match(login.cookie, /SameSite=Strict/);
  assert.match(login.cookie, /Path=\//);
  assert.match(login.cookie, /Max-Age=604800/);
  const cookie = login.cookie.split(';')[0];
  const token = cookie.split('=')[1];
  assert.equal(token.length, 43);
  const rows = api.db.prepare('SELECT * FROM ms_sessions').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.ok(!JSON.stringify(rows).includes(testPassword));
  assert.equal((await api.request('/auth/status', { cookie })).data.authenticated, true);
  assert.equal((await api.request('/private', { cookie })).status, 200);
  assert.equal((await api.request('/private', { cookie: `${cookie}; ${cookie}` })).status, 401);
  assert.equal((await api.request('/auth/logout', { method: 'POST', cookie })).status, 204);
  assert.equal((await api.request('/private', { cookie })).status, 401);
  assert.equal(api.db.prepare('SELECT count(*) AS count FROM ms_sessions').get().count, 0);
});

test('sessions expire after seven days and can survive restart with the same password', async (t) => {
  let clock = 1000000;
  const db = new DatabaseSync(':memory:');
  let api = await start({ db, now: () => clock });
  t.after(async () => { await api.stop(); db.close(); });
  const login = await api.request('/auth/login', { method: 'POST', password: testPassword });
  const cookie = login.cookie.split(';')[0];
  await api.stop();
  api = await start({ db, now: () => clock });
  assert.equal((await api.request('/private', { cookie })).status, 200);
  clock += 7 * 24 * 60 * 60 * 1000;
  assert.equal((await api.request('/private', { cookie })).status, 401);
  assert.equal((await api.request('/auth/status', { cookie })).data.authenticated, false);
});

test('changing the configured password invalidates sessions from before the restart', async (t) => {
  const db = new DatabaseSync(':memory:');
  let api = await start({ db });
  t.after(async () => { await api.stop(); db.close(); });
  const login = await api.request('/auth/login', { method: 'POST', password: testPassword });
  const cookie = login.cookie.split(';')[0];
  await api.stop();
  api = await start({ db, password: 'outra-senha-apenas-para-testes' });
  assert.equal((await api.request('/private', { cookie })).status, 401);
  assert.equal(db.prepare('SELECT count(*) AS count FROM ms_sessions').get().count, 0);
});

test('missing production password fails closed while exposing safe authentication status', async (t) => {
  const api = await start({ password: '', required: true });
  t.after(() => api.stop());
  assert.deepEqual((await api.request('/auth/status')).data, { authenticated: false, required: true, configured: false });
  assert.equal((await api.request('/health')).status, 200);
  assert.equal((await api.request('/private')).status, 503);
  assert.equal((await api.request('/auth/login', { method: 'POST', password: 'anything' })).status, 503);
});

test('production defaults to required authentication even with no configured password', () => {
  const previousMode = process.env.NODE_ENV;
  const previousPassword = process.env.DASHBOARD_PASSWORD;
  const db = new DatabaseSync(':memory:');
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.DASHBOARD_PASSWORD;
    const auth = createAuth(db);
    assert.equal(auth.required, true);
    assert.equal(auth.configured, false);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousMode;
    if (previousPassword === undefined) delete process.env.DASHBOARD_PASSWORD; else process.env.DASHBOARD_PASSWORD = previousPassword;
    db.close();
  }
});

test('cross-origin mutations are rejected for login, logout and private APIs', async (t) => {
  const api = await start();
  t.after(() => api.stop());
  const badOrigin = 'https://outro-site.example';
  assert.equal((await api.request('/auth/login', { method: 'POST', password: testPassword, origin: badOrigin })).status, 403);
  const login = await api.request('/auth/login', { method: 'POST', password: testPassword, origin: api.base });
  const cookie = login.cookie.split(';')[0];
  assert.equal(login.status, 200);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await api.request('/private', { method, cookie, origin: badOrigin })).status, 403);
    assert.equal((await api.request('/private', { method, cookie, origin: api.base })).status, 200);
  }
  assert.equal((await api.request('/auth/logout', { method: 'POST', cookie, origin: 'null' })).status, 403);
  assert.equal((await api.request('/private', { cookie })).status, 200);
});

test('login is limited to five attempts per IP for 15 minutes, including concurrent requests', async (t) => {
  let clock = 1000000;
  const api = await start({ now: () => clock });
  t.after(() => api.stop());
  const tries = await Promise.all(Array.from({ length: 5 }, (_, index) => api.request('/auth/login', {
    method: 'POST', password: 'wrong', headers: { 'X-Forwarded-For': `203.0.113.${index + 1}` },
  })));
  assert.ok(tries.every((attempt) => attempt.status === 401));
  const blocked = await api.request('/auth/login', { method: 'POST', password: testPassword });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfter, '900');
  clock += 15 * 60 * 1000;
  assert.equal((await api.request('/auth/login', { method: 'POST', password: testPassword })).status, 200);
});

test('invalid password payloads count toward the limit without accepting oversized values', async (t) => {
  const api = await start();
  t.after(() => api.stop());
  for (const password of [null, {}, [], 12, 'á'.repeat(129)]) {
    assert.equal((await api.request('/auth/login', { method: 'POST', data: { password } })).status, 400);
  }
  assert.equal((await api.request('/auth/login', { method: 'POST', password: testPassword })).status, 429);
});

test('HTTPS through an explicitly trusted proxy uses secure cookies and validates the public origin', async (t) => {
  const api = await start({ trustProxy: 1 });
  t.after(() => api.stop());
  const headers = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'painel.example' };
  const login = await api.request('/auth/login', {
    method: 'POST', password: testPassword, origin: 'https://painel.example', headers,
  });
  assert.equal(login.status, 200);
  assert.match(login.cookie, /; Secure/);
  const cookie = login.cookie.split(';')[0];
  assert.equal((await api.request('/private', {
    method: 'PUT', origin: 'https://painel.example', cookie, headers,
  })).status, 200);
  const logout = await api.request('/auth/logout', {
    method: 'POST', origin: 'https://painel.example', cookie, headers,
  });
  assert.equal(logout.status, 204);
  assert.match(logout.cookie, /; Secure/);
});

test('local development may explicitly disable authentication without a password', async (t) => {
  const api = await start({ password: '', required: false });
  t.after(() => api.stop());
  assert.deepEqual((await api.request('/auth/status')).data, { authenticated: true, required: false, configured: false });
  assert.equal((await api.request('/private')).status, 200);
});
