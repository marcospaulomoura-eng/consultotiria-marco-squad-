import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.mjs';

async function start(authOptions) {
  const instance = createApp({
    databasePath: ':memory:', seedDemo: false, serveFrontend: false,
    now: () => new Date('2026-10-19T12:00:00.000Z'), authOptions,
  });
  const server = await new Promise((resolve) => {
    const running = instance.app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...instance,
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      instance.close();
    },
    async request(path, { method = 'GET', cookie, data } = {}) {
      const res = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return {
        status: res.status, data: res.status === 204 ? null : await res.json(),
        cookie: res.headers.get('set-cookie')?.split(';')[0],
      };
    },
  };
}

const clientInput = {
  name: 'Cliente de teste', email: 'cliente@example.com', phone: '(11) 99999-9999',
  plan: 'Mensal', service: 'Treino + dieta', amount: 219,
  startDate: '2026-10-01', endDate: '2026-10-31', notes: '',
};

test('real application requires login before reading or changing client data', async (t) => {
  const password = randomBytes(32).toString('base64url');
  const api = await start({ password, required: true });
  t.after(() => api.stop());
  assert.deepEqual((await api.request('/auth/status')).data, {
    authenticated: false, required: true, configured: true,
  });
  assert.equal((await api.request('/health')).status, 200);
  assert.equal((await api.request('/dashboard')).status, 401);
  assert.equal((await api.request('/clients', { method: 'POST', data: clientInput })).status, 401);
  assert.equal((await api.request('/settings', { method: 'PUT', data: { coachName: 'Outro' } })).status, 401);
  assert.equal((await api.request('/demo', { method: 'DELETE' })).status, 401);
  assert.equal(api.db.prepare('SELECT count(*) AS count FROM clients').get().count, 0);

  const login = await api.request('/auth/login', { method: 'POST', data: { password } });
  assert.equal(login.status, 200);
  const cookie = login.cookie;
  assert.equal((await api.request('/auth/status', { cookie })).data.authenticated, true);
  assert.equal((await api.request('/dashboard', { cookie })).status, 200);
  const created = await api.request('/clients', { method: 'POST', cookie, data: clientInput });
  assert.equal(created.status, 201);
  assert.equal((await api.request('/dashboard', { cookie })).data.clients.length, 1);
  const updated = await api.request(`/clients/${created.data.id}`, {
    method: 'PUT', cookie, data: { name: 'Cliente atualizado' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.name, 'Cliente atualizado');
  assert.equal((await api.request('/settings', {
    method: 'PUT', cookie, data: { coachName: 'Marcos' },
  })).status, 200);
  assert.equal((await api.request(`/clients/${created.data.id}`, { method: 'DELETE', cookie })).status, 204);
  assert.equal((await api.request('/auth/logout', { method: 'POST', cookie })).status, 204);
  assert.equal((await api.request('/dashboard', { cookie })).status, 401);
  assert.equal((await api.request('/clients', { method: 'POST', cookie, data: clientInput })).status, 401);
});

test('required authentication without a configured secret closes the real dashboard', async (t) => {
  const api = await start({ password: '', required: true });
  t.after(() => api.stop());
  assert.deepEqual((await api.request('/auth/status')).data, {
    authenticated: false, required: true, configured: false,
  });
  assert.equal((await api.request('/dashboard')).status, 503);
  assert.equal((await api.request('/clients', { method: 'POST', data: clientInput })).status, 503);
  assert.equal((await api.request('/health')).status, 200);
});

test('explicit local development mode preserves the existing workflow', async (t) => {
  const api = await start({ password: '', required: false });
  t.after(() => api.stop());
  assert.deepEqual((await api.request('/auth/status')).data, {
    authenticated: true, required: false, configured: false,
  });
  assert.equal((await api.request('/dashboard')).status, 200);
  assert.equal((await api.request('/clients', { method: 'POST', data: clientInput })).status, 201);
});
