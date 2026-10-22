import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { APP_ID, runDeployment, verifyDeployment } from './deploy-cloudflare.mjs';

const accountId = 'a'.repeat(32);
const anotherAccountId = 'b'.repeat(32);
const databaseId = 'c'.repeat(32);
const env = { CLOUDFLARE_API_TOKEN: 'test-token-never-print', MARCOS_DASHBOARD_PASSWORD: 'test-password-never-print' };
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function response(result, { status = 200, info } = {}) {
  return new Response(JSON.stringify({ success: status < 400, result, ...(info ? { result_info: info } : {}) }), {
    status, headers: { 'content-type': 'application/json' },
  });
}

async function fixture(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'marcos-deploy-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  for (const directory of ['node_modules/wrangler/bin', 'cloudflare/migrations', 'dist/brand']) {
    await mkdir(join(rootDir, directory), { recursive: true });
  }
  await Promise.all([
    writeFile(join(rootDir, 'node_modules/wrangler/bin/wrangler.js'), ''),
    writeFile(join(rootDir, 'cloudflare/worker.mjs'), ''),
    writeFile(join(rootDir, 'dist/index.html'), '<html></html>'),
    writeFile(join(rootDir, 'dist/brand/marcos-squad-logo.png'), png),
    writeFile(join(rootDir, 'wrangler.jsonc'), JSON.stringify({
      name: 'marcos-squad-painel', main: 'cloudflare/worker.mjs', vars: { APP_ID }, workers_dev: true,
      assets: { binding: 'ASSETS', directory: './dist', run_worker_first: ['/api/*'] },
      d1_databases: [{ binding: 'DB', database_name: 'marcos-squad-painel-db', database_id: 'placeholder', migrations_dir: 'cloudflare/migrations' }],
    })),
  ]);
  return rootDir;
}

function mocks({ accounts = [{ id: accountId }], settings = null, databases = [], noSubdomain = false, failSecret = false } = {}) {
  const events = [];
  const logs = [];
  let registered = !noSubdomain;
  const fetchFn = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = options.method || 'GET';
    const path = parsed.pathname.replace('/client/v4', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    events.push({ kind: 'fetch', method, path, body, headers: options.headers });
    if (parsed.hostname.endsWith('.workers.dev')) {
      if (path === '/api/auth/status') return new Response(JSON.stringify({ required: true, configured: true, authenticated: false }));
      if (path === '/api/dashboard') return new Response('{}', { status: 401 });
      if (path === '/api/fitness/auth/status') return new Response(JSON.stringify({ student: null }));
      if (path === '/api/fitness/coach/overview') return new Response('{}', { status: 401 });
      if (path === '/aluno') return new Response('<html><div id="root"></div></html>', { headers: { 'content-type': 'text/html' } });
      if (path === '/api/health') return new Response(JSON.stringify({ status: 'ok', database: 'ok' }));
      if (path === '/brand/marcos-squad-logo.png') return new Response(png, { headers: { 'content-type': 'image/png' } });
      if (path === '/videos/wger-12.webp') return new Response(Buffer.from('RIFF0000WEBP'), { headers: { 'content-type': 'image/webp' } });
      if (path === '/videos/wger-12.mp4') return new Response(Buffer.from('0000ftypisom'), { status: 206, headers: { 'content-type': 'video/mp4' } });
    }
    if (path === '/accounts') return response(accounts);
    if (path.endsWith('/settings')) return response(settings, { status: settings ? 200 : 404 });
    if (path.endsWith('/d1/database')) return response(method === 'GET' ? databases : { uuid: databaseId, name: body.name });
    if (path.endsWith('/workers/subdomain')) {
      if (method === 'PUT') { registered = true; return response({ subdomain: body.subdomain }); }
      return response(registered ? { subdomain: 'actual-cloudflare-account' } : {});
    }
    if (path.endsWith('/secrets')) return response({}, { status: failSecret ? 403 : 200 });
    throw new Error(`Unexpected mocked request: ${method} ${path}`);
  };
  const execFileFn = async (command, args, options) => {
    events.push({ kind: 'exec', command, args, options });
    return { stdout: env.CLOUDFLARE_API_TOKEN, stderr: env.MARCOS_DASHBOARD_PASSWORD };
  };
  return { events, logs, fetchFn, execFileFn, logger: { log: (line) => logs.push(line) } };
}

test('credenciais ausentes interrompem antes de arquivos, comandos ou requisições', async () => {
  for (const supplied of [{}, { CLOUDFLARE_API_TOKEN: 'set' }, { MARCOS_DASHBOARD_PASSWORD: 'set' }]) {
    let called = false;
    await assert.rejects(runDeployment({ env: supplied, rootDir: '/does-not-exist', fetchFn: () => { called = true; }, execFileFn: () => { called = true; } }), /configurações do ambiente/);
    assert.equal(called, false);
  }
  let called = false;
  await assert.rejects(runDeployment({
    env: { ...env, MARCOS_DASHBOARD_PASSWORD: 'á'.repeat(129) }, rootDir: '/does-not-exist',
    fetchFn: () => { called = true; }, execFileFn: () => { called = true; },
  }), /máximo 256 bytes/);
  assert.equal(called, false);
  await assert.rejects(runDeployment({ env: { ...env, MARCOS_DASHBOARD_PASSWORD: 'curta' }, rootDir: '/does-not-exist' }), /pelo menos 12 caracteres/);
});

test('várias contas sem escolha e colisão com Worker desconhecido não alteram a nuvem', async (t) => {
  const rootDir = await fixture(t);
  for (const options of [
    { accounts: [{ id: accountId }, { id: anotherAccountId }] },
    { settings: { bindings: [{ type: 'plain_text', name: 'APP_ID', text: 'another-project' }] } },
  ]) {
    const mock = mocks(options);
    await assert.rejects(runDeployment({ env, rootDir, ...mock }), /várias contas|sem o marcador/);
    assert.ok(mock.events.every((event) => event.kind === 'fetch' && event.method === 'GET'));
    assert.equal(mock.logs.length, 0);
  }
});

test('erro de autorização no Worker não é confundido com ausência', async (t) => {
  const rootDir = await fixture(t);
  const mock = mocks();
  const original = mock.fetchFn;
  mock.fetchFn = async (url, options) => new URL(url).pathname.endsWith('/settings')
    ? response(null, { status: 403 }) : original(url, options);
  await assert.rejects(runDeployment({ env, rootDir, ...mock }), /HTTP 403/);
  assert.ok(mock.events.every((event) => event.method === 'GET'));
});

test('publicação aplica migrações, deploy, secret HTTPS e valida proteção sem vazar segredos', async (t) => {
  const rootDir = await fixture(t);
  const mock = mocks({ noSubdomain: true });
  const result = await runDeployment({ env, rootDir, ...mock });
  assert.equal(result.url, 'https://marcos-squad-painel.actual-cloudflare-account.workers.dev');
  const mutations = mock.events.filter((event) => event.kind === 'exec' || event.method !== 'GET');
  assert.deepEqual(mutations.map((event) => event.kind === 'exec' ? event.args[1] : `${event.method} ${event.path.split('/').at(-1)}`), [
    'POST database', 'PUT subdomain', 'd1', 'deploy', 'PUT secrets',
  ]);
  const commands = mutations.filter((event) => event.kind === 'exec');
  assert.deepEqual(commands[0].args.slice(1, 6), ['d1', 'migrations', 'apply', 'DB', '--remote']);
  assert.ok(!commands[0].args.includes('--yes'));
  for (const command of commands) {
    assert.equal(command.options.env.MARCOS_DASHBOARD_PASSWORD, undefined);
    assert.equal(command.options.env.NODE_USE_ENV_PROXY, '1');
    assert.equal(command.options.env.CI, '1');
    assert.equal(command.options.env.XDG_CONFIG_HOME, join(rootDir, '.wrangler/config'));
    assert.equal(command.options.env.XDG_CACHE_HOME, join(rootDir, '.wrangler/cache'));
    assert.equal(command.options.env.WRANGLER_LOG_PATH, join(rootDir, '.wrangler/logs/wrangler.log'));
    assert.equal(command.options.cwd, rootDir);
  }
  const secret = mutations.at(-1);
  assert.deepEqual(secret.body, { name: 'DASHBOARD_PASSWORD', text: env.MARCOS_DASHBOARD_PASSWORD, type: 'secret_text' });
  const saved = await readFile(result.configPath, 'utf8');
  const config = JSON.parse(saved);
  assert.equal(config.d1_databases[0].database_id, databaseId);
  assert.equal(config.main, join(rootDir, 'cloudflare/worker.mjs'));
  assert.equal(config.assets.directory, join(rootDir, 'dist'));
  assert.equal(config.d1_databases[0].migrations_dir, join(rootDir, 'cloudflare/migrations'));
  assert.equal(config.vars.APP_ID, APP_ID);
  for (const value of Object.values(env)) {
    assert.ok(!saved.includes(value));
    assert.ok(!mock.logs.join('\n').includes(value));
  }
  assert.match(mock.logs.at(-1), /Publicação verificada/);
});

test('redeploy preserva D1 existente e recusa mudar silenciosamente o vínculo', async (t) => {
  const rootDir = await fixture(t);
  const settings = { bindings: [
    { type: 'plain_text', name: 'APP_ID', text: APP_ID }, { type: 'd1', name: 'DB', id: databaseId },
  ] };
  const database = { name: 'marcos-squad-painel-db', uuid: databaseId };
  const good = mocks({ settings, databases: [database] });
  await runDeployment({ env: { ...env, CLOUDFLARE_ACCOUNT_ID: accountId }, rootDir, ...good });
  assert.ok(!good.events.some((event) => event.path?.endsWith('/d1/database') && event.method === 'POST'));
  for (const databases of [[], [{ ...database, uuid: 'another-database' }]]) {
    const bad = mocks({ settings, databases });
    await assert.rejects(runDeployment({ env, rootDir, ...bad }), /preservar os dados/);
    assert.ok(bad.events.every((event) => event.kind === 'fetch' && event.method === 'GET'));
  }
});

test('paginação encontra D1 da segunda página sem criar duplicata', async (t) => {
  const rootDir = await fixture(t);
  await mkdir(join(rootDir, '.wrangler'), { recursive: true });
  await writeFile(join(rootDir, '.wrangler/provisioning.json'), JSON.stringify({
    APP_ID, accountId, workerName: 'marcos-squad-painel', databaseId, databaseName: 'marcos-squad-painel-db',
  }));
  const mock = mocks();
  const original = mock.fetchFn;
  mock.fetchFn = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/d1/database') && !options?.method) throw new Error('API wrapper must specify GET');
    if (parsed.pathname.endsWith('/d1/database') && options.method === 'GET') {
      return response(parsed.searchParams.get('page') === '1' ? [{ name: 'another', uuid: 'other' }] : [{ name: 'marcos-squad-painel-db', uuid: databaseId }], { info: { total_pages: 2 } });
    }
    return original(url, options);
  };
  await runDeployment({ env, rootDir, ...mock });
  assert.ok(!mock.events.some((event) => event.path?.endsWith('/d1/database') && event.method === 'POST'));
});

test('D1 existente sem Worker nem registro conhecido é preservado sem mutações', async (t) => {
  const rootDir = await fixture(t);
  const mock = mocks({ databases: [{ name: 'marcos-squad-painel-db', uuid: databaseId }] });
  await assert.rejects(runDeployment({ env, rootDir, ...mock }), /preservar o banco existente/);
  assert.ok(mock.events.every((event) => event.kind === 'fetch' && event.method === 'GET'));
  await assert.rejects(readFile(join(rootDir, '.wrangler/provisioning.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(rootDir, '.wrangler/deploy-config.json')), { code: 'ENOENT' });
});

test('recibo imediato permite retomar falha entre criar D1 e publicar Worker', async (t) => {
  const rootDir = await fixture(t);
  const first = mocks();
  await assert.rejects(runDeployment({ env, rootDir, ...first, execFileFn: async () => { throw new Error('interrupted'); } }), /não concluiu/);
  const receiptPath = join(rootDir, '.wrangler/provisioning.json');
  const receipt = await readFile(receiptPath, 'utf8');
  assert.deepEqual(JSON.parse(receipt), {
    APP_ID, accountId, workerName: 'marcos-squad-painel', databaseId, databaseName: 'marcos-squad-painel-db',
  });
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
  for (const value of Object.values(env)) assert.ok(!receipt.includes(value));
  // Prove the receipt is sufficient, without relying on a generated config.
  await rm(join(rootDir, '.wrangler/deploy-config.json'));
  const retry = mocks({ databases: [{ name: 'marcos-squad-painel-db', uuid: databaseId }] });
  await runDeployment({ env, rootDir, ...retry });
  assert.equal(await readFile(receiptPath, 'utf8'), receipt);
  assert.ok(!retry.events.some((event) => event.method === 'POST' && event.path.endsWith('/d1/database')));
});

test('configuração conhecida também permite retomar D1 sem Worker', async (t) => {
  const rootDir = await fixture(t);
  await mkdir(join(rootDir, '.wrangler'), { recursive: true });
  await writeFile(join(rootDir, '.wrangler/deploy-config.json'), JSON.stringify({
    name: 'marcos-squad-painel', account_id: accountId, vars: { APP_ID },
    d1_databases: [{ binding: 'DB', database_id: databaseId, database_name: 'marcos-squad-painel-db' }],
  }));
  const mock = mocks({ databases: [{ name: 'marcos-squad-painel-db', uuid: databaseId }] });
  await runDeployment({ env, rootDir, ...mock });
  assert.ok(!mock.events.some((event) => event.method === 'POST' && event.path.endsWith('/d1/database')));
});

test('falha no upload da senha não anuncia endereço nem expõe valores', async (t) => {
  const rootDir = await fixture(t);
  const mock = mocks({ failSecret: true });
  await assert.rejects(runDeployment({ env, rootDir, ...mock }), /HTTP 403/);
  const output = mock.logs.join('\n');
  assert.ok(!output.includes('.workers.dev'));
  for (const value of Object.values(env)) assert.ok(!output.includes(value));
});

test('falha da CLI suprime saída sensível e interrompe antes do upload de senha', async (t) => {
  const rootDir = await fixture(t);
  const mock = mocks();
  const error = await runDeployment({ env, rootDir, ...mock, execFileFn: async () => {
    throw new Error(`${env.CLOUDFLARE_API_TOKEN}: ${env.MARCOS_DASHBOARD_PASSWORD}`);
  } }).then(() => null, (failure) => failure);
  assert.match(error.message, /não concluiu/);
  const output = `${error.message}\n${mock.logs.join('\n')}`;
  for (const value of Object.values(env)) assert.ok(!output.includes(value));
  assert.ok(!mock.events.some((event) => event.path.endsWith('/secrets')));
  assert.ok(!output.includes('.workers.dev'));
});

test('404 não JSON não autoriza criar recursos e erro de rede não revela credenciais', async (t) => {
  const rootDir = await fixture(t);
  for (const failure of ['html', 'network']) {
    const mock = mocks();
    const original = mock.fetchFn;
    mock.fetchFn = async (url, options) => {
      if (new URL(url).pathname.endsWith('/settings')) {
        if (failure === 'html') return new Response('<html>proxy</html>', { status: 404 });
        throw new Error(env.CLOUDFLARE_API_TOKEN);
      }
      return original(url, options);
    };
    const error = await runDeployment({ env, rootDir, ...mock }).then(() => null, (value) => value);
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(env.CLOUDFLARE_API_TOKEN));
    assert.ok(mock.events.every((event) => event.kind === 'fetch' && event.method === 'GET'));
  }
});

test('smoke recusa login sem senha, painel aberto e logo HTML em vez de PNG', async () => {
  for (const fault of ['password', 'dashboard', 'logo']) {
    const mock = mocks();
    const fetchFn = async (url, options) => {
      if (fault === 'password' && url.endsWith('/api/auth/status')) return new Response(JSON.stringify({ required: true, configured: false, authenticated: false }));
      if (fault === 'dashboard' && url.endsWith('/api/dashboard')) return new Response('{}');
      if (fault === 'logo' && url.endsWith('.png')) return new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } });
      return mock.fetchFn(url, options);
    };
    await assert.rejects(verifyDeployment('https://worker.account.workers.dev', fetchFn));
  }
});

test('smoke rejeita versão antiga, professor desprotegido e falhas na página e mídia do aluno', async () => {
  for (const fault of ['old-worker', 'student-json', 'coach', 'page', 'thumbnail', 'video']) {
    const mock = mocks();
    const fetchFn = async (url, options) => {
      const path = new URL(url).pathname;
      if (fault === 'old-worker' && path === '/api/fitness/auth/status') return new Response('{}', { status: 401 });
      if (fault === 'student-json' && path === '/api/fitness/auth/status') return new Response('{}');
      if (fault === 'coach' && path === '/api/fitness/coach/overview') return new Response('{}');
      if (fault === 'page' && path === '/aluno') return new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
      if (fault === 'thumbnail' && path.endsWith('.webp')) return new Response('<html>fallback</html>', { headers: { 'content-type': 'image/webp' } });
      if (fault === 'video' && path.endsWith('.mp4')) return new Response('<html>fallback</html>', { headers: { 'content-type': 'video/mp4' } });
      return mock.fetchFn(url, options);
    };
    await assert.rejects(verifyDeployment('https://worker.account.workers.dev', fetchFn));
  }
  const mock = mocks();
  await verifyDeployment('https://worker.account.workers.dev', mock.fetchFn);
  assert.equal(mock.events.find(event => event.path.endsWith('.mp4')).headers.Range, 'bytes=0-31');
});
