import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.mjs';
import { runWhatsAppAutomation } from './automation.mjs';

const origin = 'https://marcos-squad.example';
const password = 'test-only-password';
const migrationDirectory = new URL('./migrations/', import.meta.url);
const migrationFiles = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
const migration = (await Promise.all(migrationFiles.map((file) => readFile(new URL(file, migrationDirectory), 'utf8')))).join('\n');

// Use actual SQLite constraints and transactions while exposing D1's async API.
// A failing statement in batch must roll back every previous statement.
function d1Database(sqlite) {
  const adapter = {
    failure: null,
    afterFirst: null,
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) { bindings = values; return statement; },
        execute() {
          if (adapter.failure?.test(sql)) throw new Error('secret-table SELECT internal_database_failure');
          const results = sqlite.prepare(sql).all(...bindings);
          return {
            success: true,
            results,
            meta: { changes: Number(sqlite.prepare('SELECT changes() AS count').get().count) },
          };
        },
        async first(column) {
          const row = statement.execute().results[0];
          if (adapter.afterFirst) await adapter.afterFirst(sql, row);
          return row === undefined ? null : column === undefined ? row : row[column];
        },
        async all() { return statement.execute(); },
        async run() { return statement.execute(); },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return adapter;
}

function setup(t, overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(migration);
  t.after(() => sqlite.close());
  const DB = d1Database(sqlite);
  const assetRequests = [];
  const env = {
    DB,
    DASHBOARD_PASSWORD: password,
    ASSETS: { async fetch(request) { assetRequests.push(request.url); return new Response('assets'); } },
    ...overrides,
  };
  async function request(path, { method = 'GET', data, raw, cookie, headers = {} } = {}) {
    const response = await worker.fetch(new Request(`${origin}${path}`, {
      method,
      headers: {
        'CF-Connecting-IP': '203.0.113.10',
        ...(data !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: raw ?? (data !== undefined ? JSON.stringify(data) : undefined),
    }), env, { waitUntil() {} });
    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : null; } catch { result = text; }
    return { status: response.status, data: result, headers: response.headers };
  }
  async function login(headers) {
    const response = await request('/api/auth/login', { method: 'POST', data: { password }, headers });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.headers.get('set-cookie').split(';')[0];
  }
  return { env, sqlite, DB, request, login, assetRequests };
}

const clientInput = {
  name: 'Cliente Real', email: 'cliente@example.com', phone: '(11) 99999-9999',
  plan: 'Mensal', service: 'Treino + dieta', amount: 219,
  startDate: '2099-01-01', endDate: '2099-01-31', notes: 'Preferência de horário: manhã.',
};

test('produção começa vazia, exige autenticação e mantém saúde e arquivos públicos', async (t) => {
  const api = setup(t);
  const status = await api.request('/api/auth/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.data, { authenticated: false, required: true, configured: true });
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await api.request('/api/health')).data, { status: 'ok', database: 'ok' });
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal((await api.request('/api/dashboard', { method })).status, 401);
  }
  const publicAsset = await api.request('/assets/logo.webp');
  assert.equal(publicAsset.data, 'assets');
  assert.deepEqual(api.assetRequests, [`${origin}/assets/logo.webp`]);
  const cookie = await api.login();
  const initial = await api.request('/api/dashboard', { cookie });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.demoMode, false);
  assert.deepEqual(initial.data.clients, []);
  assert.deepEqual(initial.data.activities, []);
  assert.equal(initial.data.timezone, 'America/Sao_Paulo');
  assert.equal(initial.data.settings.businessName, 'Marcos Squad');
});

test('migração importa os contratos atuais sem inventar pagamentos', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const initial = await readFile(new URL('./migrations/0001_initial.sql', import.meta.url), 'utf8');
  const revision = await readFile(new URL('./migrations/0002_client_revision.sql', import.meta.url), 'utf8');
  const finance = await readFile(new URL('./migrations/0003_finance_tracking.sql', import.meta.url), 'utf8');
  sqlite.exec(`${initial}\n${revision}`);
  sqlite.prepare(`INSERT INTO clients
    (id, name, plan, service, amount_cents, start_date, end_date, created_at, updated_at)
    VALUES ('c-1', 'Aluna Antiga', 'Semestral', 'Treino + dieta', 99790, '2026-11-17', '2027-05-17', '2026-10-01T15:00:00.000Z', '2026-10-01T15:00:00.000Z')`).run();
  sqlite.prepare(`INSERT INTO activities (id, type, client_name, description, created_at)
    VALUES ('a-1', 'created', 'Aluna Antiga', 'Cadastro', '2026-10-01T15:00:00.000Z')`).run();
  sqlite.exec(finance);
  const contract = sqlite.prepare('SELECT * FROM contracts').get();
  assert.equal(contract.amount_cents, 99790);
  assert.equal(contract.tracking_status, 'unconfirmed');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM payments').get().count, 0);
});

test('Worker mostra saldo sem baixa e registra recebimentos parciais dentro do limite', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/clients', { method: 'POST', data: clientInput, cookie });
  assert.equal(created.status, 201);
  let dashboard = await api.request('/api/dashboard', { cookie });
  const contract = dashboard.data.finance.contracts[0];
  assert.equal(contract.status, 'pending');
  assert.equal(contract.balance, clientInput.amount);
  assert.equal(dashboard.data.finance.stats.salesValueThisMonth, clientInput.amount);

  const payment = await api.request(`/api/contracts/${contract.id}/payments`, {
    method: 'POST', data: { amount: 50, method: 'Pix' }, cookie,
  });
  assert.equal(payment.status, 201);
  dashboard = await api.request('/api/dashboard', { cookie });
  assert.equal(dashboard.data.finance.stats.receivedThisMonth, 50);
  assert.equal(dashboard.data.finance.stats.pendingBalance, 169);
  assert.equal(dashboard.data.finance.contracts[0].status, 'partial');
  const overpayment = await api.request(`/api/contracts/${contract.id}/payments`, {
    method: 'POST', data: { amount: 170, method: 'Pix' }, cookie,
  });
  assert.equal(overpayment.status, 400);
});

test('Worker persiste leads e permite atualizar etapa e data de retorno', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/leads', {
    method: 'POST', cookie, data: {
      name: 'Interessada Cloud', phone: '(11) 97777-6666', plan: 'Quadrimestral',
      service: 'Treino', amount: 550, followUpAt: '2099-02-03',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.phone, '+5511977776666');
  const updated = await api.request(`/api/leads/${created.data.id}`, {
    method: 'PUT', cookie, data: { stage: 'contacted', followUpAt: '2099-02-05' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.stage, 'contacted');
  assert.equal(updated.data.followUpAt, '2099-02-05');
  const dashboard = await api.request('/api/dashboard', { cookie });
  assert.equal(dashboard.data.leads.length, 1);
  assert.equal(dashboard.data.leads[0].amount, 550);
  assert.equal((await api.request(`/api/leads/${created.data.id}`, { method: 'DELETE', cookie })).status, 204);
});

test('rotina diária envia apenas contatos autorizados e não repete mensagens aceitas', async (t) => {
  const api = setup(t, {
    WHATSAPP_ACCESS_TOKEN: 'token-de-teste',
    WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  });
  const cookie = await api.login();
  const student = await api.request('/api/clients', {
    method: 'POST', cookie, data: {
      ...clientInput, startDate: '2026-10-01', endDate: '2026-10-26', whatsappOptIn: true,
    },
  });
  const lead = await api.request('/api/leads', {
    method: 'POST', cookie, data: {
      name: 'Lead autorizado', phone: '(11) 97777-6666', plan: 'Mensal',
      service: 'Treino', amount: 219, followUpAt: '2026-10-19', whatsappOptIn: true,
    },
  });
  assert.equal(student.status, 201);
  assert.equal(lead.status, 201);
  const sentPayloads = [];
  const fetchFn = async (_url, options) => {
    sentPayloads.push(JSON.parse(options.body));
    return Response.json({ messages: [{ id: `wamid.${sentPayloads.length}` }] });
  };
  const now = new Date('2026-10-19T12:00:00.000Z');
  assert.deepEqual(await runWhatsAppAutomation(api.env, now, { fetchFn }), { sent: 2 });
  assert.deepEqual(await runWhatsAppAutomation(api.env, now, { fetchFn }), { sent: 0 });
  assert.equal(sentPayloads.length, 2);
  assert.deepEqual(sentPayloads.map((payload) => payload.template.name).sort(), [
    'marcos_squad_renovacao', 'marcos_squad_retorno',
  ]);
  assert.equal(api.sqlite.prepare("SELECT COUNT(*) AS count FROM whatsapp_dispatches WHERE status = 'sent'").get().count, 2);
  const stored = JSON.stringify(api.sqlite.prepare('SELECT * FROM whatsapp_dispatches').all());
  assert.ok(!stored.includes('token-de-teste'));
});

test('senha ausente fecha a API privada e informa configuração sem expor dados', async (t) => {
  const api = setup(t, { DASHBOARD_PASSWORD: '' });
  assert.deepEqual((await api.request('/api/auth/status')).data, {
    authenticated: false, required: true, configured: false,
  });
  assert.equal((await api.request('/api/dashboard')).status, 503);
  assert.equal((await api.request('/api/auth/login', { method: 'POST', data: { password } })).status, 503);
  assert.equal((await api.request('/api/health')).status, 200);
});

test('senha curta do ambiente mantém o painel fechado e orienta configurar ao menos 12 caracteres', async (t) => {
  const shortPassword = 'curta12345';
  const api = setup(t, { DASHBOARD_PASSWORD: shortPassword });
  assert.deepEqual((await api.request('/api/auth/status')).data, {
    authenticated: false, required: true, configured: false,
  });
  const blocked = await api.request('/api/dashboard');
  assert.equal(blocked.status, 503);
  assert.match(blocked.data.error, /12 caracteres/);
  assert.ok(!JSON.stringify(blocked.data).includes(shortPassword));
  assert.equal((await api.request('/api/auth/login', {
    method: 'POST', data: { password: shortPassword },
  })).status, 503);
  assert.equal(api.sqlite.prepare('SELECT COUNT(*) AS count FROM ms_sessions').get().count, 0);
});

test('sessões usam token aleatório protegido, são revogadas no logout e não guardam credenciais', async (t) => {
  const api = setup(t);
  assert.equal((await api.request('/api/auth/login', { method: 'POST', data: { password: 'incorrect' } })).status, 401);
  const login = await api.request('/api/auth/login', { method: 'POST', data: { password } });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data, { authenticated: true, required: true });
  const setCookie = login.headers.get('set-cookie');
  for (const flag of [/; Secure/i, /; HttpOnly/i, /; SameSite=Strict/i, /; Path=\//i, /; Max-Age=604800/i]) {
    assert.match(setCookie, flag);
  }
  const cookie = setCookie.split(';')[0];
  assert.match(cookie, /^ms_session=[A-Za-z0-9_-]{43}$/);
  const token = cookie.slice('ms_session='.length);
  const tables = api.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const storedData = JSON.stringify(tables.map(({ name }) => api.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()));
  assert.ok(!storedData.includes(token));
  assert.ok(!storedData.includes(password));
  assert.equal((await api.request('/api/auth/status', { cookie })).data.authenticated, true);
  assert.equal((await api.request('/api/dashboard', { cookie })).status, 200);
  assert.equal((await api.request('/api/dashboard', { cookie: `${cookie}; ${cookie}` })).status, 401);
  const logout = await api.request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal((await api.request('/api/dashboard', { cookie })).status, 401);
  assert.equal((await api.request('/api/auth/status', { cookie })).data.authenticated, false);
});

test('trocar a senha do ambiente invalida uma sessão já emitida', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  api.env.DASHBOARD_PASSWORD = 'another-test-password';
  assert.equal((await api.request('/api/dashboard', { cookie })).status, 401);
  assert.equal((await api.request('/api/auth/status', { cookie })).data.authenticated, false);
});

test('mutações recusam origem externa ou opaca sem alterar clientes nem encerrar sessão', async (t) => {
  const api = setup(t);
  assert.equal((await api.request('/api/auth/login', {
    method: 'POST', data: { password }, headers: { Origin: 'https://other.example' },
  })).status, 403);
  const cookie = await api.login({ Origin: origin });
  for (const badOrigin of ['https://other.example', 'null', `${origin}/unexpected-path`]) {
    assert.equal((await api.request('/api/clients', {
      method: 'POST', cookie, data: clientInput, headers: { Origin: badOrigin },
    })).status, 403);
    assert.equal((await api.request('/api/settings', {
      method: 'PUT', cookie, data: { businessName: 'Rejected' }, headers: { Origin: badOrigin },
    })).status, 403);
    assert.equal((await api.request('/api/demo', {
      method: 'DELETE', cookie, headers: { Origin: badOrigin },
    })).status, 403);
    assert.equal((await api.request('/api/auth/logout', {
      method: 'POST', cookie, headers: { Origin: badOrigin },
    })).status, 403);
  }
  const dashboard = await api.request('/api/dashboard', { cookie });
  assert.equal(dashboard.status, 200);
  assert.deepEqual(dashboard.data.clients, []);
  assert.equal(dashboard.data.settings.businessName, 'Marcos Squad');
  assert.equal((await api.request('/api/clients', {
    method: 'POST', cookie, data: clientInput, headers: { Origin: origin },
  })).status, 201);
});

test('limite de cinco acessos por IP inclui sucessos e não é burlado por X-Forwarded-For', async (t) => {
  const api = setup(t);
  await api.login();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const failed = await api.request('/api/auth/login', {
      method: 'POST', data: { password: 'wrong' }, headers: { 'X-Forwarded-For': `198.51.100.${attempt + 1}` },
    });
    assert.equal(failed.status, 401);
  }
  const limited = await api.request('/api/auth/login', { method: 'POST', data: { password } });
  assert.equal(limited.status, 429);
  const retryAfter = Number(limited.headers.get('retry-after'));
  assert.ok(retryAfter > 0 && retryAfter <= 900);
  assert.equal((await api.request('/api/auth/login', {
    method: 'POST', data: { password }, headers: { 'CF-Connecting-IP': '203.0.113.11' },
  })).status, 200);
});

test('tentativas de login simultâneas respeitam o limite no banco compartilhado', async (t) => {
  const api = setup(t);
  const responses = await Promise.all(Array.from({ length: 6 }, () => api.request('/api/auth/login', {
    method: 'POST', data: { password: 'wrong' },
  })));
  assert.equal(responses.filter((response) => response.status === 401).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 1);
});

test('login rejeita tipos inválidos e senhas com mais de 256 bytes UTF-8', async (t) => {
  const api = setup(t);
  for (const [index, invalid] of [null, {}, [], 12, 'á'.repeat(129)].entries()) {
    const response = await api.request('/api/auth/login', {
      method: 'POST', data: { password: invalid }, headers: { 'CF-Connecting-IP': `192.0.2.${index + 1}` },
    });
    assert.equal(response.status, 400);
  }
});

test('cadastro, edição parcial, renovação, mensagem manual e exclusão preservam os dados corretos', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/clients', { method: 'POST', data: clientInput, cookie });
  assert.equal(created.status, 201);
  assert.equal(created.data.phone, '+5511999999999');
  assert.equal(created.data.amount, 219);
  const id = created.data.id;
  assert.equal(typeof id, 'string');
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const updated = await api.request(`/api/clients/${id}`, {
      method: 'PUT', data: { name: 'Nome atualizado' }, cookie,
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.phone, '+5511999999999');
    assert.equal(updated.data.amount, 219);
    assert.equal(updated.data.notes, clientInput.notes);
  }
  const settings = await api.request('/api/settings', {
    method: 'PUT', data: { businessName: 'Consultoria Real', reminderDays: [10, 2] }, cookie,
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.coachName, 'Marcos');
  const contact = await api.request(`/api/clients/${id}/contact`, {
    method: 'POST', data: { channel: 'whatsapp' }, cookie,
  });
  assert.equal(contact.status, 200);
  assert.equal(new URL(contact.data.whatsappUrl).pathname, '/5511999999999');
  assert.equal(new URL(contact.data.whatsappUrl).searchParams.get('text'), contact.data.message);
  assert.match(contact.data.message, /Consultoria Real/);
  assert.match(contact.data.activity.description, /manualmente/);
  assert.doesNotMatch(contact.data.activity.description, /enviada|entregue/i);
  const renewed = await api.request(`/api/clients/${id}/renew`, { method: 'POST', data: {}, cookie });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.data.startDate, '2099-01-01');
  assert.equal(renewed.data.endDate, '2099-02-28');
  assert.equal((await api.request('/api/demo', { method: 'DELETE', cookie })).status, 200);
  const dashboard = (await api.request('/api/dashboard', { cookie })).data;
  assert.equal(dashboard.demoMode, false);
  assert.equal(dashboard.clients.length, 1);
  assert.equal(dashboard.clients[0].id, id);
  assert.equal(dashboard.settings.businessName, 'Consultoria Real');
  assert.ok(dashboard.activities.some((activity) => activity.type === 'renewed'));
  assert.equal((await api.request(`/api/clients/${id}`, { method: 'DELETE', cookie })).status, 204);
  assert.equal((await api.request('/api/dashboard', { cookie })).data.clients.length, 0);
});

test('WhatsApp internacional mantém o DDI durante edição parcial e formulário completo', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/clients', {
    method: 'POST', data: { ...clientInput, phone: '+1 (415) 555-0123' }, cookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.phone, '+14155550123');
  const id = created.data.id;
  const partial = await api.request(`/api/clients/${id}`, { method: 'PUT', data: { name: 'Cliente internacional' }, cookie });
  const complete = await api.request(`/api/clients/${id}`, {
    method: 'PUT', data: { ...clientInput, name: partial.data.name, phone: partial.data.phone }, cookie,
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.phone, '+14155550123');
  const contact = await api.request(`/api/clients/${id}/contact`, {
    method: 'POST', data: { channel: 'whatsapp' }, cookie,
  });
  assert.equal(contact.status, 200);
  assert.equal(new URL(contact.data.whatsappUrl).pathname, '/14155550123');
});

test('renovações simultâneas não sobrescrevem o plano nem criam uma segunda atividade', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/clients', { method: 'POST', data: clientInput, cookie });
  const id = created.data.id;
  // Both requests must read the same committed snapshot before either writes.
  // Promise.all alone can run sequentially when the crypto scheduler finishes
  // one session check before starting the next request's database lookup.
  let reads = 0;
  let release;
  const bothRead = new Promise((resolve) => { release = resolve; });
  api.DB.afterFirst = async (sql) => {
    if (!/^SELECT \* FROM clients WHERE id = \?/.test(sql)) return;
    reads += 1;
    if (reads === 2) release();
    await bothRead;
  };
  const responses = await Promise.all(Array.from({ length: 2 }, () => api.request(`/api/clients/${id}/renew`, {
    method: 'POST', data: {}, cookie,
  })));
  api.DB.afterFirst = null;
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const dashboard = (await api.request('/api/dashboard', { cookie })).data;
  assert.equal(dashboard.clients[0].endDate, '2099-02-28');
  assert.equal(dashboard.activities.filter((activity) => activity.type === 'renewed').length, 1);
  assert.match(responses.find((response) => response.status === 409).data.error, /Atualize o painel/);
});

test('falha ao registrar renovação também reverte vencimento e versão do cliente', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/clients', { method: 'POST', data: clientInput, cookie });
  const id = created.data.id;
  api.DB.failure = /INSERT\s+INTO\s+activities/i;
  const failed = await api.request(`/api/clients/${id}/renew`, { method: 'POST', data: {}, cookie });
  assert.equal(failed.status, 500);
  api.DB.failure = null;
  const dashboard = (await api.request('/api/dashboard', { cookie })).data;
  assert.equal(dashboard.clients[0].endDate, clientInput.endDate);
  assert.equal(dashboard.activities.filter((activity) => activity.type === 'renewed').length, 0);
  assert.equal(api.sqlite.prepare('SELECT revision FROM clients WHERE id = ?').get(id).revision, 0);
});

test('validação recusa JSON inválido, tipos errados, payloads grandes e configuração desconhecida', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const failures = [
    { data: { ...clientInput, endDate: '2099-02-31' }, status: 400 },
    { data: [], status: 400 },
    { raw: '{quebrado', status: 400 },
    { data: { ...clientInput, notes: 'a'.repeat(40_000) }, status: 413 },
    { raw: JSON.stringify(clientInput), headers: { 'Content-Type': 'text/plain' }, status: 415 },
  ];
  for (const { status, ...options } of failures) {
    const result = await api.request('/api/clients', { method: 'POST', cookie, ...options });
    assert.equal(result.status, status, JSON.stringify(result.data));
  }
  assert.equal((await api.request('/api/settings', { method: 'PUT', data: { reminderDays: [-1] }, cookie })).status, 400);
  assert.equal((await api.request('/api/settings', { method: 'PUT', data: { messageTemplate: 'Olá {segredo}!' }, cookie })).status, 400);
  assert.equal((await api.request('/api/inexistente', { cookie })).status, 404);
  assert.equal((await api.request('/api/clients/unknown/renew', { method: 'POST', data: {}, cookie })).status, 404);
  assert.deepEqual((await api.request('/api/dashboard', { cookie })).data.clients, []);
});

test('sem telefone permite copiar mensagem mas impede abrir WhatsApp', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  const created = await api.request('/api/clients', { method: 'POST', data: { ...clientInput, phone: '' }, cookie });
  assert.equal(created.status, 201);
  assert.equal((await api.request(`/api/clients/${created.data.id}/contact`, {
    method: 'POST', data: { channel: 'whatsapp' }, cookie,
  })).status, 400);
  const copy = await api.request(`/api/clients/${created.data.id}/contact`, {
    method: 'POST', data: { channel: 'copy' }, cookie,
  });
  assert.equal(copy.status, 200);
  assert.equal(copy.data.whatsappUrl, null);
  assert.match(copy.data.activity.description, /manualmente/);
});

test('falha ao registrar atividade reverte cadastro e não vaza SQL ao navegador', async (t) => {
  const api = setup(t);
  const cookie = await api.login();
  api.DB.failure = /INSERT\s+INTO\s+activities/i;
  const failed = await api.request('/api/clients', { method: 'POST', data: clientInput, cookie });
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(failed.data), /SELECT|secret-table|internal_database_failure|INSERT|activities/i);
  api.DB.failure = null;
  const dashboard = (await api.request('/api/dashboard', { cookie })).data;
  assert.deepEqual(dashboard.clients, []);
  assert.deepEqual(dashboard.activities, []);
});

test('saúde verifica o banco e não anuncia disponibilidade quando o banco falha', async (t) => {
  const api = setup(t);
  api.DB.failure = /./;
  const health = await api.request('/api/health');
  assert.ok(health.status >= 500);
  assert.doesNotMatch(JSON.stringify(health.data), /SELECT|secret-table|internal_database_failure/i);
});
