import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { migrateSupabase, APP_ID } from './migrate-supabase.mjs';
import { importSupabase, IMPORT_TABLES } from './import-supabase.mjs';

const timestamp = '2026-10-22T12:00:00.000Z';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

// PostgreSQL runs in-process, without credentials or a connection to live data.
// Parameterized queries use PGlite.query; unparameterized SQL uses exec so the
// actual multi-statement migration and PL/pgSQL blocks run intact.
function pglitePool(pg) {
  let released = 0;
  return {
    get released() { return released; },
    async connect() {
      return {
        async query(text, values) {
          const result = values === undefined ? (await pg.exec(text)).at(-1) : await pg.query(text, values);
          return { ...result, rows: result?.rows ?? [], rowCount: result?.affectedRows ?? result?.rows?.length ?? 0 };
        },
        release() { released++; },
      };
    },
  };
}

async function postgresFixture(t, { migrated = true } = {}) {
  const pg = new PGlite();
  await pg.waitReady;
  t.after(() => pg.close());
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  const pool = pglitePool(pg);
  if (migrated) await migrateSupabase({ pool });
  return { pg, pool };
}

function insert(source, table, row) {
  const columns = Object.keys(row);
  source.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...columns.map(column => row[column]));
}

async function sqliteFixture(t) {
  const source = new DatabaseSync(':memory:');
  t.after(() => source.close());
  const directory = new URL('../cloudflare/migrations/', import.meta.url);
  for (const filename of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    source.exec(await readFile(new URL(filename, directory), 'utf8'));
  }
  const common = {
    email: 'fixture@example.com', phone: '', plan: 'Mensal', service: 'Treino + dieta', amount_cents: 12900,
    start_date: '2026-10-01', end_date: '2026-10-31', notes: 'Anotação privada da fixture',
    created_at: timestamp, updated_at: timestamp, whatsapp_opt_in: 0, revision: 3,
  };
  insert(source, 'clients', { ...common, id: 'real-client', name: 'Aluna real de teste', is_demo: 0 });
  insert(source, 'clients', { ...common, id: 'demo-client', name: 'Cliente demonstrativo', is_demo: 1 });
  for (const [id, is_demo] of [['real-activity-1', 0], ['demo-activity', 1], ['real-activity-2', 0]]) {
    insert(source, 'activities', { id, type: 'created', client_name: is_demo ? 'Cliente demonstrativo' : 'Aluna real de teste', description: id, created_at: timestamp, is_demo });
  }
  insert(source, 'settings', { id: 1, value: JSON.stringify({ brandName: 'Consultoria da fixture', trainerName: 'Professor de teste', reminderDays: [7, 3, 1] }) });
  const contract = { client_name: 'Aluna real de teste', plan: 'Mensal', service: 'Treino + dieta', amount_cents: 12900,
    start_date: '2026-10-01', end_date: '2026-10-31', sold_at: timestamp, tracking_status: 'pending' };
  insert(source, 'contracts', { ...contract, id: 'real-contract', client_id: 'real-client' });
  // Financial snapshots of deleted real clients must continue to exist.
  insert(source, 'contracts', { ...contract, id: 'historical-contract', client_id: 'deleted-real-client', client_name: 'Cliente real excluído' });
  insert(source, 'contracts', { ...contract, id: 'demo-contract', client_id: 'demo-client', client_name: 'Cliente demonstrativo' });
  for (const [id, contract_id, amount_cents] of [['real-payment', 'real-contract', 4900], ['historical-payment', 'historical-contract', 12900], ['demo-payment', 'demo-contract', 100]]) {
    insert(source, 'payments', { id, contract_id, amount_cents, method: 'Pix', paid_at: '2026-10-22', notes: 'Recibo de fixture', created_at: timestamp });
  }
  insert(source, 'leads', { id: 'real-lead', name: 'Interessado de teste', phone: '5511999990000', plan: 'Mensal', service: 'Treino', amount_cents: 9000,
    stage: 'contacted', follow_up_at: '2026-10-23', notes: 'Proposta de teste', whatsapp_opt_in: 1, created_at: timestamp, updated_at: timestamp });
  insert(source, 'whatsapp_dispatches', { dispatch_key: 'renewal:real-client:2026-10-31:7', status: 'sent', provider_message_id: 'fixture-provider-id', created_at: timestamp, updated_at: timestamp });
  for (const [client_id, prefix] of [['real-client', 'real'], ['demo-client', 'demo']]) {
    insert(source, 'fitness_access', { client_id, code_hash: prefix.repeat(16), display_name: `${prefix} atleta`, community: 1, created_at: timestamp });
    insert(source, 'fitness_workouts', { id: `${prefix}-workout`, client_id, data: JSON.stringify({ name: 'Treino A', items: [{ exerciseId: 'wger-12', sets: 3, reps: '12', rest: 60 }] }), updated_at: timestamp });
    insert(source, 'fitness_diets', { client_id, data: JSON.stringify({ name: 'Plano alimentar', meals: [{ name: 'Almoço', items: [{ foodId: 'taco-3', grams: 150 }] }] }), updated_at: timestamp });
    insert(source, 'fitness_logs', { id: `${prefix}-log`, client_id, workout_id: `${prefix}-workout`, workout_name: 'Treino A', day: '2026-10-22', created_at: timestamp });
    insert(source, 'fitness_posts', { id: `${prefix}-post`, client_id, caption: `Publicação ${prefix}`, image: 'data:image/jpeg;base64,Zml4dHVyZQ==', created_at: timestamp });
    insert(source, 'fitness_sessions', { token_hash: `${prefix}-private-session`, client_id, expires_at: 9999999999999 });
  }
  insert(source, 'fitness_catalog', { id: 'custom-exercise', kind: 'exercise', data: JSON.stringify({ name: 'Exercício personalizado', videoUrl: 'https://example.com/fixture.mp4' }) });
  insert(source, 'fitness_likes', { post_id: 'real-post', client_id: 'real-client' });
  insert(source, 'fitness_likes', { post_id: 'demo-post', client_id: 'real-client' });
  insert(source, 'fitness_likes', { post_id: 'real-post', client_id: 'demo-client' });
  insert(source, 'fitness_comments', { id: 'real-comment', post_id: 'real-post', client_id: 'real-client', text: 'Comentário preservado', created_at: timestamp });
  insert(source, 'fitness_comments', { id: 'comment-on-demo', post_id: 'demo-post', client_id: 'real-client', text: 'Não importar', created_at: timestamp });
  insert(source, 'fitness_comments', { id: 'comment-by-demo', post_id: 'real-post', client_id: 'demo-client', text: 'Não importar', created_at: timestamp });
  insert(source, 'ms_sessions', { token_hash: 'private-professor-session', password_version: 'fixture-password-hash', created_at: 1, expires_at: 9999999999999 });
  insert(source, 'ms_login_attempts', { ip_key: 'fixture-hashed-ip', count: 4, reset_at: 9999999999999 });
  insert(source, 'fitness_attempts', { ip_key: 'fixture-hashed-student-ip', count: 7, reset_at: 9999999999999 });
  return source;
}

test('migração Supabase aplica o schema privado uma vez, confere checksum e preserva dados ao reexecutar', async t => {
  const { pg, pool } = await postgresFixture(t, { migrated: false });
  const first = await migrateSupabase({ pool });
  assert.equal(first.applied.length, 1);
  assert.equal((await pg.query("SELECT value FROM marcos_squad.metadata WHERE key = 'app_id'")).rows[0].value, APP_ID);
  await pg.query("INSERT INTO marcos_squad.settings (id, value) VALUES (1, $1)", ['{"brandName":"Preservar"}']);
  assert.deepEqual(await migrateSupabase({ pool }), { applied: [] });
  assert.equal((await pg.query('SELECT value FROM marcos_squad.settings WHERE id = 1')).rows[0].value, '{"brandName":"Preservar"}');
  const temporary = await mkdtemp(join(tmpdir(), 'marcos-migration-checksum-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const filename of first.applied) {
    const sql = await readFile(new URL(filename, migrationDirectory), 'utf8');
    await writeFile(join(temporary, filename), `${sql}\n-- Mudança posterior deve ser recusada.\n`);
  }
  await assert.rejects(migrateSupabase({ pool, directory: temporary }), /migração já aplicada foi alterada/);
  assert.equal((await pg.query('SELECT COUNT(*) AS n FROM marcos_squad.schema_migrations')).rows[0].n, 1);
  assert.equal((await pg.query('SELECT value FROM marcos_squad.settings WHERE id = 1')).rows[0].value, '{"brandName":"Preservar"}');
  assert.equal(pool.released, 3);
});

test('migração Supabase recusa schema sem identificação ou pertencente a outra aplicação', async t => {
  const { pg, pool } = await postgresFixture(t, { migrated: false });
  await pg.exec('CREATE SCHEMA marcos_squad; CREATE TABLE marcos_squad.other_app (value TEXT); INSERT INTO marcos_squad.other_app VALUES (\'preserve\');');
  await assert.rejects(migrateSupabase({ pool }), /schema existente não foi identificado/);
  assert.deepEqual((await pg.query('SELECT value FROM marcos_squad.other_app')).rows, [{ value: 'preserve' }]);
  await pg.exec("CREATE TABLE marcos_squad.metadata (key TEXT PRIMARY KEY, value TEXT); INSERT INTO marcos_squad.metadata VALUES ('app_id', 'another-application');");
  await assert.rejects(migrateSupabase({ pool }), /pertence a outra aplicação/);
  assert.equal((await pg.query("SELECT COUNT(*) AS n FROM pg_tables WHERE schemaname = 'marcos_squad' AND tablename = 'clients'")).rows[0].n, 0);
  assert.equal(pool.released, 2);
});

test('importação Supabase preserva dados reais e históricos, remove demonstração e exige novo login', async t => {
  const { pg, pool } = await postgresFixture(t);
  const source = await sqliteFixture(t);
  const result = await importSupabase({ source, pool });
  assert.equal(result.sessionsImported, false);
  assert.equal(result.counts.clients, 1);
  assert.equal(result.counts.activities, 2);
  assert.equal(result.counts.contracts, 2);
  assert.equal(result.counts.payments, 2);
  const client = (await pg.query('SELECT * FROM marcos_squad.clients')).rows[0];
  assert.equal(client.id, 'real-client');
  assert.equal(client.amount_cents, 12900);
  assert.equal(client.revision, 3);
  assert.equal(client.notes, 'Anotação privada da fixture');
  assert.deepEqual((await pg.query('SELECT id FROM marcos_squad.activities ORDER BY sequence_id')).rows.map(row => row.id), ['real-activity-1', 'real-activity-2']);
  assert.deepEqual((await pg.query('SELECT id FROM marcos_squad.contracts ORDER BY id')).rows.map(row => row.id), ['historical-contract', 'real-contract']);
  assert.equal(Number((await pg.query('SELECT SUM(amount_cents) AS n FROM marcos_squad.payments')).rows[0].n), 17800);
  assert.equal((await pg.query('SELECT value FROM marcos_squad.settings WHERE id = 1')).rows[0].value, source.prepare('SELECT value FROM settings WHERE id = 1').get().value);
  assert.deepEqual((await pg.query('SELECT * FROM marcos_squad.leads')).rows[0], { ...source.prepare('SELECT * FROM leads').get() });
  assert.deepEqual((await pg.query('SELECT * FROM marcos_squad.whatsapp_dispatches')).rows[0], { ...source.prepare('SELECT * FROM whatsapp_dispatches').get() });
  for (const table of ['fitness_access', 'fitness_catalog', 'fitness_workouts', 'fitness_diets', 'fitness_logs', 'fitness_posts', 'fitness_likes', 'fitness_comments']) {
    assert.equal(result.counts[table], 1, table);
    const rows = (await pg.query(`SELECT * FROM marcos_squad.${table}`)).rows;
    assert.equal(rows.length, 1, table);
    const sourceRow = table === 'fitness_catalog' ? source.prepare(`SELECT * FROM ${table}`).get()
      : source.prepare(`SELECT * FROM ${table} WHERE ${table === 'fitness_likes' ? "post_id = 'real-post' AND" : ''} client_id = 'real-client'${table === 'fitness_comments' ? " AND id = 'real-comment'" : ''}`).get();
    assert.deepEqual(rows[0], { ...sourceRow }, table);
  }
  for (const table of ['ms_sessions', 'ms_login_attempts', 'fitness_sessions', 'fitness_attempts']) {
    assert.equal(Number((await pg.query(`SELECT COUNT(*) AS n FROM marcos_squad.${table}`)).rows[0].n), 0, table);
  }
  assert.equal((await pg.query("SELECT value FROM marcos_squad.metadata WHERE key = 'app_id'")).rows[0].value, APP_ID);
});

test('importação Supabase recusa destino ocupado sem substituir dados existentes', async t => {
  const { pg, pool } = await postgresFixture(t);
  const source = await sqliteFixture(t);
  await pg.query('INSERT INTO marcos_squad.settings (id, value) VALUES (1, $1)', ['{"brandName":"Dados existentes"}']);
  await assert.rejects(importSupabase({ source, pool }), /destino já contém dados/);
  assert.equal((await pg.query('SELECT value FROM marcos_squad.settings WHERE id = 1')).rows[0].value, '{"brandName":"Dados existentes"}');
  assert.equal((await pg.query('SELECT COUNT(*) AS n FROM marcos_squad.clients')).rows[0].n, 0);
  assert.equal(pool.released, 2);
});

test('importação Supabase recusa origem incompleta antes de abrir uma conexão de destino', async t => {
  const source = new DatabaseSync(':memory:');
  t.after(() => source.close());
  source.exec('CREATE TABLE clients (id TEXT PRIMARY KEY, is_demo INTEGER);');
  let connected = false;
  await assert.rejects(importSupabase({ source, pool: { async connect() { connected = true; throw new Error('Should not connect'); } } }), /origem não contém o banco Marcos Squad completo/);
  assert.equal(connected, false);
});

test('importação usa um único snapshot mesmo se a origem mudar enquanto aguarda a conexão', async t => {
  const { pg, pool } = await postgresFixture(t);
  const source = await sqliteFixture(t);
  const originalClient = { ...source.prepare("SELECT * FROM clients WHERE id = 'real-client'").get() };
  let changed = false;
  const delayedPool = {
    async connect() {
      await Promise.resolve();
      // This represents new source writes after the network wait begins.
      insert(source, 'clients', { ...originalClient, id: 'client-after-snapshot', name: 'Cadastrada durante a conexão' });
      insert(source, 'fitness_access', { client_id: 'client-after-snapshot', code_hash: 'after-snapshot-code-hash', display_name: 'Nova atleta', community: 0, created_at: timestamp });
      source.prepare("UPDATE clients SET name = 'Nome atualizado durante a conexão' WHERE id = 'real-client'").run();
      changed = true;
      return pool.connect();
    },
  };
  const imported = await importSupabase({ source, pool: delayedPool });
  assert.equal(changed, true);
  assert.equal(imported.counts.clients, 1);
  assert.equal(imported.counts.fitness_access, 1);
  assert.deepEqual((await pg.query('SELECT id, name FROM marcos_squad.clients')).rows, [{ id: 'real-client', name: originalClient.name }]);
  assert.deepEqual((await pg.query('SELECT client_id FROM marcos_squad.fitness_access')).rows, [{ client_id: 'real-client' }]);
  assert.equal(source.prepare("SELECT COUNT(*) AS n FROM clients WHERE id = 'client-after-snapshot'").get().n, 1);
  assert.equal(source.prepare("SELECT COUNT(*) AS n FROM fitness_access WHERE client_id = 'client-after-snapshot'").get().n, 1);
  assert.equal(source.prepare("SELECT name FROM clients WHERE id = 'real-client'").get().name, 'Nome atualizado durante a conexão');
});

test('importação Supabase reverte todos os registros quando um pagamento viola a chave estrangeira', async t => {
  const { pg, pool } = await postgresFixture(t);
  const source = await sqliteFixture(t);
  source.exec('PRAGMA foreign_keys = OFF');
  insert(source, 'payments', { id: 'orphan-payment', contract_id: 'nonexistent-contract', amount_cents: 100, method: 'Pix', paid_at: '2026-10-22', notes: '', created_at: timestamp });
  source.exec('PRAGMA foreign_keys = ON');
  await assert.rejects(importSupabase({ source, pool }), error => error.code === '23503');
  for (const table of IMPORT_TABLES) {
    assert.equal(Number((await pg.query(`SELECT COUNT(*) AS n FROM marcos_squad.${table}`)).rows[0].n), 0, table);
  }
  assert.equal((await pg.query("SELECT value FROM marcos_squad.metadata WHERE key = 'app_id'")).rows[0].value, APP_ID);
  assert.equal((await pg.query('SELECT COUNT(*) AS n FROM marcos_squad.schema_migrations')).rows[0].n, 1);
  assert.equal(source.prepare('SELECT COUNT(*) AS n FROM clients').get().n, 2);
  assert.equal(pool.released, 2);
});
