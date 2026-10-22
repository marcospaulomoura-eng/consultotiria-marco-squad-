import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createVercelHandler, handleVercelRequest } from './vercel-runtime.mjs';

const password = 'senha-apenas-do-teste-local';
const database = { prepare() { throw new Error('Unexpected database operation'); }, batch() { throw new Error('Unexpected batch'); } };
const available = () => database;

function request(path, options = {}) {
  return new Request(`https://marcos.example${path}`, options);
}

function nodeRequest(path, { method = 'GET', body, headers = {}, encrypted = false } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.url = path;
  req.method = method;
  req.headers = { host: 'marcos.example', ...headers };
  req.socket = { encrypted };
  return req;
}

function nodeResponse() {
  const headers = {};
  return {
    statusCode: 0, body: null, headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { this.body = body ? Buffer.from(body).toString('utf8') : ''; },
  };
}

test('Vercel sem Supabase fecha a API, mas mantém os status de login legíveis', async () => {
  const options = { env: { DASHBOARD_PASSWORD: password }, databaseFactory() { throw new Error('postgres://private-credential'); } };
  for (const path of ['/api/health', '/api/dashboard', '/api/clients']) {
    const res = await handleVercelRequest(request(path), options);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(!(await res.text()).includes('private-credential'));
  }
  const status = await handleVercelRequest(request('/api/auth/status'), options);
  assert.deepEqual(await status.json(), { required: true, configured: true, authenticated: false });
  const student = await handleVercelRequest(request('/api/fitness/auth/status'), options);
  assert.deepEqual(await student.json(), { student: null });
  const missingPassword = await handleVercelRequest(request('/api/auth/status'), { ...options, env: {} });
  assert.equal((await missingPassword.json()).configured, false);
});

test('Vercel reutiliza as proteções do professor e os status públicos sem SQLite', async () => {
  const options = { env: { DASHBOARD_PASSWORD: password }, databaseFactory: available };
  const status = await handleVercelRequest(request('/api/auth/status'), options);
  assert.deepEqual(await status.json(), { required: true, configured: true, authenticated: false });
  const student = await handleVercelRequest(request('/api/fitness/auth/status'), options);
  assert.deepEqual(await student.json(), { student: null });
  for (const path of ['/api/dashboard', '/api/fitness/coach/overview', '/api/rota-ausente']) {
    const res = await handleVercelRequest(request(path), options);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('content-type'), /^application\/json/);
  }
  const nonApi = await handleVercelRequest(request('/aluno'), options);
  assert.equal(nonApi.status, 404);
});

test('Vercel sobrescreve CF-Connecting-IP e só confia no IP fornecido pela plataforma', async () => {
  for (const [env, forwarded, expected] of [
    [{ VERCEL: '1' }, '203.0.113.5', '203.0.113.5'],
    [{ VERCEL: '1' }, '203.0.113.5, 203.0.113.6', 'unknown'],
    [{ VERCEL: '1' }, '', 'unknown'],
    [{}, '203.0.113.5', 'unknown'],
  ]) {
    let received;
    await handleVercelRequest(request('/api/auth/status', { headers: {
      'CF-Connecting-IP': '192.0.2.9', 'x-vercel-forwarded-for': forwarded,
      'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http',
    } }), { env, databaseFactory: available, appHandler(incoming, bindings) {
      received = incoming;
      assert.equal(bindings.DB, database);
      return new Response('{}');
    } });
    assert.equal(received.headers.get('CF-Connecting-IP'), expected);
    assert.equal(received.url, 'https://marcos.example/api/auth/status');
    assert.equal(received.headers.get('x-forwarded-host'), null);
    assert.equal(received.headers.get('x-forwarded-proto'), null);
  }
});

test('Vercel mantém cookies seguros online e permite desenvolvimento HTTP explícito', async () => {
  for (const [env, url, secure] of [
    [{ VERCEL: '1' }, 'https://marcos.example/api/auth/login', true],
    [{ NODE_ENV: 'production' }, 'http://marcos.example/api/auth/login', true],
    [{}, 'http://localhost:5173/api/auth/login', false],
  ]) {
    const res = await handleVercelRequest(new Request(url), { env, databaseFactory: available, appHandler() {
      return new Response('{}', { headers: { 'Set-Cookie': 'ms_session=fake; Path=/; HttpOnly; Secure; SameSite=Strict' } });
    } });
    assert.equal(/; Secure\b/.test(res.headers.get('set-cookie')), secure);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
});

test('cron do WhatsApp exige segredo e método corretos antes de acessar o banco', async () => {
  let databaseCalls = 0;
  let automationCalls = 0;
  const env = { CRON_SECRET: 'segredo-de-cron-apenas-de-teste' };
  const options = { env, databaseFactory() { databaseCalls++; return database; }, automation(bindings) {
    automationCalls++;
    assert.equal(bindings.DB, database);
    return { sent: 2 };
  } };
  const noSecret = await handleVercelRequest(request('/api/cron/whatsapp'), { ...options, env: {} });
  assert.equal(noSecret.status, 503);
  const wrong = await handleVercelRequest(request('/api/cron/whatsapp', { headers: { Authorization: 'Bearer wrong' } }), options);
  assert.equal(wrong.status, 401);
  const wrongMethod = await handleVercelRequest(request('/api/cron/whatsapp', { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }), options);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
  assert.equal(databaseCalls, 0);
  assert.equal(automationCalls, 0);
  const accepted = await handleVercelRequest(request('/api/cron/whatsapp', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }), options);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { sent: 2 });
  assert.equal(databaseCalls, 1);
  assert.equal(automationCalls, 1);
});

test('entrypoint Node usa Host original, preserva caminho/body e envia cookies separados', async () => {
  let incoming;
  const handler = createVercelHandler({ env: { VERCEL: '1' }, databaseFactory: available, appHandler(req) {
    incoming = req;
    const headers = new Headers();
    headers.append('Set-Cookie', 'a=one; HttpOnly; Secure');
    headers.append('Set-Cookie', 'b=two; HttpOnly; Secure');
    return new Response('{"saved":true}', { status: 201, headers });
  } });
  const req = nodeRequest('/api/clients?filter=active', { method: 'POST', body: '{"name":"Ana"}', headers: {
    origin: 'https://marcos.example', 'content-type': 'application/json',
    'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'http',
  } });
  const res = nodeResponse();
  await handler(req, res);
  assert.equal(incoming.url, 'https://marcos.example/api/clients?filter=active');
  assert.equal(incoming.headers.get('origin'), 'https://marcos.example');
  assert.deepEqual(await incoming.json(), { name: 'Ana' });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.headers['set-cookie'], ['a=one; HttpOnly; Secure', 'b=two; HttpOnly; Secure']);
  assert.deepEqual(JSON.parse(res.body), { saved: true });
});

test('entrypoint Node recusa payload grande e mantém o limite de foto da comunidade', async () => {
  let calls = 0;
  const handler = createVercelHandler({ env: {}, databaseFactory: available, appHandler() { calls++; return new Response('{}'); } });
  const large = JSON.stringify({ image: 'x'.repeat(40 * 1024) });
  for (const headers of [{}, { 'content-length': String(Buffer.byteLength(large)) }]) {
    const res = nodeResponse();
    await handler(nodeRequest('/api/clients', { method: 'POST', body: large, headers }), res);
    assert.equal(res.statusCode, 413);
  }
  assert.equal(calls, 0);
  const photo = nodeResponse();
  await handler(nodeRequest('/api/fitness/feed', { method: 'POST', body: large }), photo);
  assert.equal(photo.statusCode, 200);
  assert.equal(calls, 1);
  const oversized = nodeResponse();
  await handler(nodeRequest('/api/fitness/feed', { method: 'POST', body: 'x'.repeat(301 * 1024) }), oversized);
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls, 1);
});

test('entrypoint rejeita host/caminho inválido e não devolve detalhes de erros internos', async () => {
  let calls = 0;
  const handler = createVercelHandler({ env: {}, databaseFactory: available, appHandler() { calls++; throw new Error('private SQL postgres://password'); } });
  for (const req of [nodeRequest('//attacker.example/api'), nodeRequest('/api/auth/status', { headers: { host: 'user@attacker.example' } })]) {
    const res = nodeResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
  const res = nodeResponse();
  await handler(nodeRequest('/api/auth/status'), res);
  assert.equal(res.statusCode, 500);
  assert.ok(!res.body.includes('private SQL'));
  assert.ok(!res.body.includes('password'));
});

test('configuração Vercel envia API para função antes do fallback da SPA e agenda uma execução diária', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const route = path => config.routes.find(item => item.src && new RegExp(`^${item.src}$`).test(path));
  assert.equal(route('/api').dest, '/api/index.mjs');
  assert.equal(route('/api/fitness/auth/status').dest, '/api/index.mjs');
  assert.equal(route('/aluno').dest, '/index.html');
  assert.equal(route('/videos/missing.mp4').status, 404);
  assert.equal(config.outputDirectory, 'dist');
  assert.deepEqual(config.crons, [{ path: '/api/cron/whatsapp', schedule: '0 12 * * *' }]);
});
