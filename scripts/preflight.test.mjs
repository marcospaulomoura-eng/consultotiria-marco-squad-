import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight } from './preflight.mjs';
import { PGlite } from '@electric-sql/pglite';
import { migrateSupabase } from './migrate-supabase.mjs';

// Generate isolated test values at runtime; never export fixed credentials.
const testValue = () => randomBytes(24).toString('hex');
const env = { SUPABASE_DB_URL: `postgres://test:${testValue()}@db.example:6543/postgres`,
  DASHBOARD_PASSWORD: testValue(), CRON_SECRET: testValue() };
const migration = '-- fixture migration';
const version = '202610220001_fixture.sql';
const columns = {
  metadata: ['key', 'value'], schema_migrations: ['version', 'checksum'], clients: ['id', 'revision', 'whatsapp_opt_in'],
  activities: ['id', 'sequence_id'], settings: ['id', 'value'], contracts: ['id', 'amount_cents'], payments: ['id', 'contract_id'],
  leads: ['id'], whatsapp_dispatches: ['dispatch_key'], ms_sessions: ['token_hash', 'password_version'], ms_login_attempts: ['ip_key'],
  fitness_access: ['client_id', 'code_hash'], fitness_sessions: ['token_hash'], fitness_attempts: ['ip_key'], fitness_catalog: ['id'],
  fitness_workouts: ['id'], fitness_diets: ['client_id'], fitness_logs: ['id'], fitness_posts: ['id'], fitness_likes: ['post_id'], fitness_comments: ['id'],
};

async function fixture(t) {
  const rootDir = await mkdtemp(join(tmpdir(), 'marcos-preflight-'));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  for (const directory of ['.vercel', 'dist/brand', 'dist/videos', 'api', 'supabase/migrations']) await mkdir(join(rootDir, directory), { recursive: true });
  await Promise.all([
    writeFile(join(rootDir, '.vercel/project.json'), JSON.stringify({ projectId: 'project-fixture', orgId: 'team-fixture' })),
    ...['dist/index.html', 'dist/brand/marcos-squad-logo.png', 'dist/videos/wger-12.mp4', 'dist/videos/wger-12.webp', 'api/index.mjs'].map(file => writeFile(join(rootDir, file), 'fixture')),
    writeFile(join(rootDir, 'supabase/migrations', version), migration),
  ]);
  return rootDir;
}

function poolFixture({ fault } = {}) {
  const events = [];
  return {
    events,
    async factory() {
      events.push('pool');
      return {
        async connect() {
          events.push('connect');
          if (fault === 'network') throw Object.assign(new Error(env.SUPABASE_DB_URL), { code: 'ETIMEDOUT' });
          return {
            async query(sql) {
              events.push(sql);
              if (sql.includes('SELECT value')) return { rows: [{ value: fault === 'marker' ? 'other-app' : 'marcos-squad-dashboard-v1' }] };
              if (sql.includes('information_schema.columns')) return { rows: Object.entries(columns).flatMap(([table_name, fields]) =>
                fields.filter(field => !(fault === 'schema' && field === 'revision')).map(column_name => ({ table_name, column_name }))) };
              if (sql.includes('SELECT version')) return { rows: [{ version, checksum: fault === 'checksum' ? 'modified' : createHash('sha256').update(migration).digest('hex') }] };
              return { rows: [] };
            },
            release() { events.push('release'); },
          };
        },
        async end() { events.push('end'); },
      };
    },
  };
}

test('preflight local verifica arquivos/configuração sem rede nem alegar conexão remota', async t => {
  const rootDir = await fixture(t);
  let connected = false;
  const result = await preflight({ rootDir, env, nodeVersion: '24.19.0', poolFactory() { connected = true; } });
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'local_only');
  assert.equal(result.databaseVerified, false);
  assert.equal(result.vercelRemoteVerified, false);
  assert.equal(connected, false);
  for (const secret of Object.values(env)) assert.ok(!JSON.stringify(result).includes(secret));
});

test('preflight informa nomes das pendências locais sem tentar conexão ou ler arquivos .env', async t => {
  const rootDir = await fixture(t);
  await writeFile(join(rootDir, '.env'), 'SUPABASE_DB_URL=must-not-read');
  await rm(join(rootDir, '.vercel/project.json'));
  await rm(join(rootDir, 'dist/videos/wger-12.mp4'));
  let connected = false;
  const result = await preflight({ rootDir, env: {}, nodeVersion: '22.0.0', database: true, poolFactory() { connected = true; } });
  assert.equal(result.ok, false);
  assert.equal(connected, false);
  assert.deepEqual(result.checks.filter(check => !check.ok).map(check => check.name),
    ['node', 'supabase_configuration', 'dashboard_password', 'cron_secret', 'vercel_link', 'build_files', 'database']);
  assert.ok(!JSON.stringify(result).includes('must-not-read'));
});

test('preflight de banco verifica identificação, schema e checksum com SQL somente de leitura', async t => {
  const rootDir = await fixture(t);
  const pool = poolFixture();
  const result = await preflight({ rootDir, env, nodeVersion: '24.19.0', database: true, poolFactory: pool.factory });
  assert.equal(result.ok, true);
  assert.equal(result.databaseVerified, true);
  assert.equal(result.vercelRemoteVerified, false);
  assert.ok(pool.events.includes('BEGIN READ ONLY'));
  assert.ok(pool.events.includes('ROLLBACK'));
  assert.deepEqual(pool.events.slice(-2), ['release', 'end']);
  assert.ok(pool.events.filter(value => value !== 'pool' && value !== 'connect' && value !== 'release' && value !== 'end')
    .every(sql => /^(BEGIN READ ONLY|SET LOCAL|SELECT|ROLLBACK)/.test(sql)));
});

test('preflight recusa banco errado, schema incompleto, histórico alterado e erro de rede sem vazar credenciais', async t => {
  const rootDir = await fixture(t);
  for (const [fault, expected] of [['marker', 'wrong_application'], ['schema', 'schema_incomplete'], ['checksum', 'migration_mismatch'], ['network', 'ETIMEDOUT']]) {
    const pool = poolFixture({ fault });
    const result = await preflight({ rootDir, env, nodeVersion: '24.19.0', database: true, poolFactory: pool.factory });
    assert.equal(result.ok, false);
    assert.equal(result.databaseVerified, false);
    assert.equal(result.checks.find(check => check.name === 'database').state, expected);
    assert.equal(pool.events.at(-1), 'end');
    for (const secret of Object.values(env)) assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('preflight consulta PostgreSQL real em modo somente leitura e detecta checksum ou coluna incompatível', async t => {
  const rootDir = await fixture(t);
  const directory = join(rootDir, 'supabase/migrations');
  await rm(join(directory, version));
  const source = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(source)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name));
  for (const file of files) await copyFile(new URL(file, source), join(directory, file));

  const pg = new PGlite();
  await pg.waitReady;
  t.after(() => pg.close());
  const readOnlyStates = [];
  let releases = 0;
  const pool = {
    async connect() {
      return {
        async query(sql, values) {
          // exec preserves the real multi-statement migration; query checks
          // parameterized SQL against PostgreSQL itself.
          const result = values === undefined ? (await pg.exec(sql)).at(-1) : await pg.query(sql, values);
          if (sql === 'BEGIN READ ONLY') readOnlyStates.push((await pg.query('SHOW transaction_read_only')).rows[0].transaction_read_only);
          return { ...result, rows: result?.rows ?? [] };
        },
        release() { releases++; },
      };
    },
  };
  await migrateSupabase({ pool, directory });
  await pg.query('INSERT INTO marcos_squad.settings (id, value) VALUES (1, $1)', ['{"name":"Preservar fixture"}']);
  const before = await pg.query('SELECT * FROM marcos_squad.settings');
  const options = { rootDir, env, nodeVersion: '24.19.0', database: true, poolFactory: async () => pool };
  const success = await preflight(options);
  assert.equal(success.ok, true);
  assert.equal(success.databaseVerified, true);

  const changedFile = join(directory, files[0]);
  const original = await readFile(changedFile, 'utf8');
  await writeFile(changedFile, `${original}\n-- Checksum alterado apenas na fixture.\n`);
  const mismatch = await preflight(options);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.checks.find(check => check.name === 'database').state, 'migration_mismatch');

  await writeFile(changedFile, original);
  await pg.exec('ALTER TABLE marcos_squad.clients RENAME COLUMN revision TO incompatible_revision');
  const incomplete = await preflight(options);
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.checks.find(check => check.name === 'database').state, 'schema_incomplete');
  assert.deepEqual(readOnlyStates, ['on', 'on', 'on']);
  assert.equal(releases, 4); // migration plus all three read-only inspections
  assert.deepEqual((await pg.query('SELECT * FROM marcos_squad.settings')).rows, before.rows);
  assert.equal((await pg.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
});
