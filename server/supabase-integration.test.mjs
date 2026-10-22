import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import worker from '../cloudflare/worker.mjs';
import { createPostgresDatabase } from './postgres.mjs';
import { ConcurrentWriteError, createActivity, getClientSnapshot, updateClient } from '../cloudflare/storage.mjs';

const origin = 'https://supabase-test.example';
const password = 'supabase-integration-password';
const workout = {
  name: 'A · Inferiores', days: [1, 3, 5], notes: 'Controle a descida.',
  items: [{ exerciseId: 'wger-371', sets: 3, reps: '10–12', rest: 60, load: '20 kg' }],
};
const diet = {
  name: 'Plano individual', notes: '',
  meals: [{ name: 'Almoço', time: '12:30', items: [{ foodId: 'taco-3', grams: 150 }] }],
};
const clientInput = {
  name: 'Aluna PostgreSQL', email: 'aluna@example.com', phone: '(11) 99999-9999',
  plan: 'Mensal', service: 'Treino + dieta', amount: 219,
  startDate: '2099-01-01', endDate: '2099-01-31', notes: 'Dado privado da aluna.',
};

// PGlite runs PostgreSQL itself in WASM. A lease serializes transactions because
// this in-process engine has one connection. It does not emulate a live pooler's
// networking or PostgreSQL's conflicts between independent server connections.
function pglitePool(pg) {
  let queue = Promise.resolve();
  return {
    async connect() {
      let unlock;
      const previous = queue;
      queue = new Promise(resolve => { unlock = resolve; });
      await previous;
      let released = false;
      return {
        async query(text, values = []) {
          const result = await pg.query(text, values);
          // node-postgres sends int8 and numeric values as strings by default.
          // Match that transport behavior so aggregate conversion is tested too.
          const strings = new Set(result.fields.filter(field => [20, 1700].includes(field.dataTypeID)).map(field => field.name));
          const rows = result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
            [key, value === null || !strings.has(key) ? value : String(value)])));
          return { ...result, rows, rowCount: result.affectedRows ?? rows.length };
        },
        release() { if (!released) { released = true; unlock(); } },
      };
    },
  };
}

async function fixture(t) {
  const pg = new PGlite();
  await pg.waitReady;
  t.after(() => pg.close());
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const migration = await readFile(new URL('../supabase/migrations/202610220001_marcos_squad.sql', import.meta.url), 'utf8');
  await pg.exec(`BEGIN;\n${migration}\nCOMMIT;`);
  const DB = createPostgresDatabase({ pool: pglitePool(pg) });
  const env = { DB, DASHBOARD_PASSWORD: password };
  async function request(path, { method = 'GET', data, cookie, headers = {} } = {}) {
    const response = await worker.fetch(new Request(`${origin}/api${path}`, {
      method,
      headers: {
        'CF-Connecting-IP': '203.0.113.30',
        ...(data === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}), ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    }), env);
    const bytes = Buffer.from(await response.arrayBuffer());
    let body;
    try { body = bytes.length ? JSON.parse(bytes.toString()) : null; } catch { body = bytes; }
    return { status: response.status, data: body, bytes, headers: response.headers };
  }
  async function login() {
    const result = await request('/auth/login', { method: 'POST', data: { password } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.match(result.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
    return result.headers.get('set-cookie').split(';')[0];
  }
  async function createClient(admin, input = {}) {
    const result = await request('/clients', { method: 'POST', cookie: admin, data: { ...clientInput, ...input } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  }
  async function studentAccess(id, admin) {
    const access = await request(`/fitness/coach/clients/${id}/access`, { method: 'POST', cookie: admin, data: {} });
    assert.equal(access.status, 200, JSON.stringify(access.data));
    const result = await request('/fitness/auth/login', { method: 'POST', data: { code: access.data.code } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return { code: access.data.code, cookie: result.headers.get('set-cookie').split(';')[0] };
  }
  async function reset() {
    const tables = (await pg.query("SELECT tablename FROM pg_tables WHERE schemaname = 'marcos_squad'")).rows;
    if (tables.length) await pg.exec(`TRUNCATE ${tables.map(row => `marcos_squad."${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  return { pg, DB, env, request, login, createClient, studentAccess, reset };
}

test('Supabase/PostgreSQL preserva autenticação, financeiro e área do aluno com SQL real', async t => {
  const api = await fixture(t);

  await t.test('schema privado, dados vazios, saúde e conversão dos resultados PostgreSQL', async () => {
    const permissions = (await api.pg.query(`SELECT
      has_schema_privilege('anon', 'marcos_squad', 'USAGE') AS anon,
      has_schema_privilege('authenticated', 'marcos_squad', 'USAGE') AS authenticated,
      has_table_privilege('anon', 'marcos_squad.clients', 'SELECT') AS clients`)).rows[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false, clients: false });
    const tables = (await api.pg.query("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'marcos_squad'")).rows;
    assert.ok(tables.length >= 20);
    assert.ok(tables.every(table => table.rowsecurity));
    assert.deepEqual((await api.request('/health')).data, { status: 'ok', database: 'ok' });
    assert.deepEqual((await api.request('/auth/status')).data, { authenticated: false, required: true, configured: true });
    assert.equal((await api.request('/dashboard')).status, 401);
    const cookie = await api.login();
    const dashboard = await api.request('/dashboard', { cookie });
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
    assert.equal(dashboard.data.demoMode, false);
    assert.deepEqual(dashboard.data.clients, []);
    assert.equal(dashboard.data.settings.businessName, 'Marcos Squad');
    const result = await api.DB.prepare('SELECT COUNT(*) AS trainingDays FROM clients').first();
    assert.deepEqual(result, { trainingDays: 0 });
  });

  await t.test('cadastro, edição e renovação preservam contratos, agregações e limite de pagamentos', async () => {
    await api.reset();
    const cookie = await api.login();
    const client = await api.createClient(cookie);
    assert.equal(client.amount, 219);
    assert.equal(client.phone, '+5511999999999');
    let dashboard = await api.request('/dashboard', { cookie });
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
    assert.equal(dashboard.data.finance.contracts.length, 1);
    const contract = dashboard.data.finance.contracts[0];
    const payments = await Promise.all([50, 170].map(amount => api.request(`/contracts/${contract.id}/payments`, {
      method: 'POST', cookie, data: { amount, method: 'Pix' },
    })));
    assert.deepEqual(payments.map(value => value.status).sort(), [201, 400]);
    const received = payments.find(value => value.status === 201).data.amount;
    dashboard = await api.request('/dashboard', { cookie });
    assert.equal(dashboard.data.finance.contracts[0].received, received);
    assert.equal(dashboard.data.finance.contracts[0].balance, clientInput.amount - received);
    assert.equal(dashboard.data.finance.stats.receivedThisMonth, received);
    const update = await api.request(`/clients/${client.id}`, { method: 'PUT', cookie, data: { name: 'Nome atualizado' } });
    assert.equal(update.status, 200, JSON.stringify(update.data));
    assert.equal(update.data.notes, clientInput.notes);
    const renewal = await api.request(`/clients/${client.id}/renew`, { method: 'POST', cookie, data: {} });
    assert.equal(renewal.status, 200, JSON.stringify(renewal.data));
    assert.equal(renewal.data.endDate, '2099-02-28');
    dashboard = await api.request('/dashboard', { cookie });
    assert.equal(dashboard.data.finance.contracts.length, 2);
    assert.equal(dashboard.data.activities.filter(value => value.type === 'renewed').length, 1);
    assert.equal((await api.request('/settings', { method: 'PUT', cookie, data: { businessName: 'Consultoria PostgreSQL' } })).status, 200);
    const contact = await api.request(`/clients/${client.id}/contact`, { method: 'POST', cookie, data: { channel: 'copy' } });
    assert.equal(contact.status, 200);
    assert.match(contact.data.message, /Consultoria PostgreSQL/);
    const lead = await api.request('/leads', { method: 'POST', cookie, data: {
      name: 'Interessada', phone: '(11) 97777-6666', plan: 'Mensal', service: 'Treino', amount: 219, followUpAt: '2099-02-01',
    } });
    assert.equal(lead.status, 201, JSON.stringify(lead.data));
    assert.equal((await api.request(`/leads/${lead.data.id}`, { method: 'PUT', cookie, data: { stage: 'contacted' } })).status, 200);
    assert.equal((await api.request(`/leads/${lead.data.id}`, { method: 'DELETE', cookie })).status, 204);
  });

  await t.test('batch reverte falhas e snapshot antigo não cria atividade ou contrato fantasma', async () => {
    await api.reset();
    const cookie = await api.login();
    const client = await api.createClient(cookie);
    await assert.rejects(api.DB.batch([
      api.DB.prepare("INSERT INTO metadata (key,value) VALUES (?,?)").bind('rollback-test', 'secret'),
      api.DB.prepare('INSERT INTO payments (id,contract_id,amount_cents,method,paid_at,notes,created_at) VALUES (?,?,?,?,?,?,?)')
        .bind('bad-payment', 'missing-contract', 1, 'Pix', '2026-10-22', '', '2026-10-22'),
    ]));
    assert.equal(await api.DB.prepare('SELECT value FROM metadata WHERE key = ?').bind('rollback-test').first(), null);
    const snapshot = await getClientSnapshot(api.DB, client.id);
    const now = new Date().toISOString();
    const activity = name => createActivity({ type: 'renewed', clientName: name, description: 'Teste', createdAt: now });
    await updateClient(api.DB, client.id, { ...snapshot.client, name: 'Primeira atualização' }, now, activity('Primeira atualização'), snapshot, true);
    await assert.rejects(updateClient(api.DB, client.id, { ...snapshot.client, name: 'Atualização obsoleta' }, now,
      activity('Atualização obsoleta'), snapshot, true), ConcurrentWriteError);
    const dashboard = (await api.request('/dashboard', { cookie })).data;
    assert.equal(dashboard.clients[0].name, 'Primeira atualização');
    assert.equal(dashboard.finance.contracts.length, 2);
    assert.equal(dashboard.activities.filter(value => value.clientName === 'Atualização obsoleta').length, 0);
  });

  await t.test('treino, dieta, isolamento do aluno, idempotência e ranking mantêm nomes e tipos da API', async () => {
    await api.reset();
    const admin = await api.login();
    const a = await api.createClient(admin);
    const b = await api.createClient(admin, { name: 'Outro aluno' });
    const accessA = await api.studentAccess(a.id, admin);
    const accessB = await api.studentAccess(b.id, admin);
    const persisted = await api.DB.prepare('SELECT code_hash FROM fitness_access WHERE client_id = ?').bind(a.id).first();
    assert.notEqual(persisted.code_hash, accessA.code);
    assert.equal((await api.request('/dashboard', { cookie: accessA.cookie })).status, 401);
    assert.equal((await api.request(`/fitness/coach/clients/${b.id}`, { cookie: accessA.cookie })).status, 401);
    const saved = await api.request(`/fitness/coach/clients/${a.id}/workouts`, { method: 'POST', cookie: admin, data: workout });
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    const savedDiet = await api.request(`/fitness/coach/clients/${a.id}/diet`, { method: 'PUT', cookie: admin, data: diet });
    assert.equal(savedDiet.status, 200, JSON.stringify(savedDiet.data));
    const own = await api.request('/fitness/me', { cookie: accessA.cookie });
    assert.equal(own.status, 200, JSON.stringify(own.data));
    assert.equal(own.data.student.endDate, clientInput.endDate);
    assert.equal(own.data.trainingDays, 0);
    assert.equal(own.data.diet.totals.kcal, 192);
    assert.doesNotMatch(JSON.stringify(own.data), /Dado privado|amount_cents|code_hash/);
    assert.deepEqual((await api.request('/fitness/me', { cookie: accessB.cookie })).data.workouts, []);
    const completed = { workoutId: saved.data.id, completed: [0], updatedAt: own.data.workouts[0].updatedAt };
    assert.equal((await api.request('/fitness/me/complete', { method: 'POST', cookie: accessB.cookie, data: completed })).status, 404);
    assert.equal((await api.request('/fitness/me/complete', { method: 'POST', cookie: accessA.cookie, data: { ...completed, completed: [] } })).status, 400);
    assert.equal((await api.request('/fitness/me/complete', { method: 'POST', cookie: accessA.cookie, data: completed })).status, 200);
    assert.equal((await api.request('/fitness/me/complete', { method: 'POST', cookie: accessA.cookie, data: completed })).status, 200);
    assert.equal((await api.DB.prepare('SELECT COUNT(*) AS n FROM fitness_logs').first()).n, 1);
    await api.request('/fitness/me/profile', { method: 'PUT', cookie: accessA.cookie, data: { name: 'Ana', community: true } });
    const overview = await api.request('/fitness/coach/overview', { cookie: admin });
    assert.equal(overview.status, 200, JSON.stringify(overview.data));
    const coachA = overview.data.clients.find(value => value.id === a.id);
    assert.equal(coachA.workouts, 1);
    assert.ok(coachA.hasDiet);
    assert.equal(coachA.trainingDays, 1);
    assert.equal(typeof coachA.endDate, 'string');
    const rank = await api.request('/fitness/ranking', { cookie: accessA.cookie });
    assert.equal(rank.status, 200, JSON.stringify(rank.data));
    assert.equal(rank.data.ranking[0].days, 1);
    assert.equal(rank.data.ranking[0].name, 'Ana');
    const rotated = await api.request(`/fitness/coach/clients/${a.id}/access`, { method: 'POST', cookie: admin, data: {} });
    assert.equal(rotated.status, 200);
    assert.equal((await api.request('/fitness/me', { cookie: accessA.cookie })).status, 401);
    assert.equal((await api.request('/fitness/auth/login', { method: 'POST', data: { code: accessA.code } })).status, 401);
  });

  await t.test('feed privado preserva fotos, curtidas únicas, comentários e cursor composto PostgreSQL', async () => {
    await api.reset();
    const admin = await api.login();
    const a = await api.createClient(admin);
    const b = await api.createClient(admin, { name: 'Bia' });
    const accessA = await api.studentAccess(a.id, admin);
    const accessB = await api.studentAccess(b.id, admin);
    for (const [access, name] of [[accessA, 'Ana'], [accessB, 'Bia']]) {
      assert.equal((await api.request('/fitness/me/profile', { method: 'PUT', cookie: access.cookie, data: { name, community: true } })).status, 200);
    }
    const image = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(120), Buffer.from([255, 217])]);
    const post = await api.request('/fitness/feed', { method: 'POST', cookie: accessA.cookie, data: { caption: 'Treinei!', image: `data:image/jpeg;base64,${image.toString('base64')}` } });
    assert.equal(post.status, 201, JSON.stringify(post.data));
    const path = `/fitness/feed/${post.data.id}`;
    for (let i = 0; i < 2; i++) assert.equal((await api.request(`${path}/like`, { method: 'PUT', cookie: accessB.cookie })).status, 200);
    assert.equal((await api.request(`${path}/comments`, { method: 'POST', cookie: accessB.cookie, data: { text: 'Vamos!' } })).status, 201);
    const feed = await api.request('/fitness/feed', { cookie: accessB.cookie });
    assert.equal(feed.status, 200, JSON.stringify(feed.data));
    assert.equal(feed.data.posts[0].likes, 1);
    assert.ok(feed.data.posts[0].liked);
    assert.equal(feed.data.posts[0].hasImage, 1);
    assert.equal(feed.data.posts[0].comments[0].text, 'Vamos!');
    const media = await api.request(`/fitness/media/${post.data.id}`, { cookie: accessA.cookie });
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(media.bytes, image);
    assert.equal((await api.request(`/fitness/media/${post.data.id}`)).status, 401);
    assert.equal((await api.request(path, { method: 'DELETE', cookie: accessB.cookie })).status, 403);
    assert.equal((await api.request(path, { method: 'DELETE', cookie: admin })).status, 204);
    assert.equal((await api.DB.prepare('SELECT COUNT(*) AS n FROM fitness_comments').first()).n, 0);
    assert.equal((await api.DB.prepare('SELECT COUNT(*) AS n FROM fitness_likes').first()).n, 0);
    const timestamp = '2026-10-22T12:00:00.000Z';
    const statements = Array.from({ length: 41 }, (_, i) => api.DB.prepare('INSERT INTO fitness_posts (id,client_id,caption,created_at) VALUES (?,?,?,?)')
      .bind(`page-${String(i).padStart(2, '0')}`, a.id, `Post ${i}`, timestamp));
    await api.DB.batch(statements);
    const expected = (await api.DB.prepare('SELECT id FROM fitness_posts ORDER BY created_at DESC,id DESC').all()).results.map(value => value.id);
    const seen = []; const sizes = []; let before = '';
    for (let i = 0; i < 3; i++) {
      const response = await api.request(`/fitness/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`, { cookie: admin });
      assert.equal(response.status, 200, JSON.stringify(response.data));
      sizes.push(response.data.posts.length);
      seen.push(...response.data.posts.map(value => value.id));
      before = response.data.next;
    }
    assert.deepEqual(sizes, [20, 20, 1]);
    assert.deepEqual(seen, expected);
    assert.equal(before, null);
  });

  await t.test('limites de login persistem no PostgreSQL e exclusão remove acesso do aluno', async () => {
    await api.reset();
    const admin = await api.login();
    const a = await api.createClient(admin);
    const access = await api.studentAccess(a.id, admin);
    const attempts = await Promise.all(Array.from({ length: 6 }, () => api.request('/auth/login', {
      method: 'POST', data: { password: 'wrong' }, headers: { 'CF-Connecting-IP': '203.0.113.99' },
    })));
    assert.equal(attempts.filter(value => value.status === 401).length, 5);
    assert.equal(attempts.filter(value => value.status === 429).length, 1);
    assert.equal((await api.request('/fitness/me/profile', { method: 'PUT', cookie: access.cookie,
      data: { name: 'Intruso', community: true }, headers: { origin: 'https://other.example' } })).status, 403);
    assert.equal((await api.request(`/clients/${a.id}`, { method: 'DELETE', cookie: admin })).status, 204);
    assert.equal((await api.request('/fitness/me', { cookie: access.cookie })).status, 401);
    assert.equal((await api.DB.prepare('SELECT COUNT(*) AS n FROM fitness_sessions').first()).n, 0);
    assert.equal((await api.DB.prepare('SELECT COUNT(*) AS n FROM contracts').first()).n, 1);
  });
});
