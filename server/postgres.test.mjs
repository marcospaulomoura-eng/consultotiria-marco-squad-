import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePostgresQuery, createPostgresDatabase, postgresPoolOptions } from './postgres.mjs';

test('PostgreSQL binds values without rewriting SQL literals, comments or quoted identifiers', () => {
  const value = "Robert'); DROP TABLE clients; --";
  const query = compilePostgresQuery(`SELECT '?' AS sample, name AS clientName, "?" FROM clients
    -- ? changes() AS fakeAlias
    WHERE id = ? AND notes <> 'changes() OR IGNORE MIN(a, b)'`, [value]);
  assert.deepEqual(query.values, [value]);
  assert.ok(query.text.includes('id = $1'));
  assert.ok(query.text.includes("'?' AS sample"));
  assert.ok(query.text.includes('name AS "clientName"'));
  assert.ok(query.text.includes('"?"'));
  assert.ok(query.text.includes('-- ? changes() AS fakeAlias'));
  assert.ok(query.text.includes("'changes() OR IGNORE MIN(a, b)'"));
  assert.ok(!query.text.includes(value));
  assert.throws(() => compilePostgresQuery('SELECT ?', []), /Faltam parâmetros/);
  assert.throws(() => compilePostgresQuery('SELECT 1', ['extra']), /excedentes/);
});

test('PostgreSQL preserves case-insensitive ordering, aliases and both aggregate/scalar MIN', () => {
  const sort = compilePostgresQuery('SELECT client_name AS clientName FROM contracts c ORDER BY c.client_name COLLATE NOCASE, rowid DESC');
  assert.ok(sort.text.includes('AS "clientName"'));
  assert.ok(sort.text.includes('lower(c.client_name)'));
  assert.ok(sort.text.includes('sequence_id DESC'));
  const aggregate = compilePostgresQuery('SELECT MIN(l.created_at) FROM fitness_logs l');
  assert.ok(aggregate.text.includes('MIN(l.created_at)'));
  const limiter = compilePostgresQuery(`INSERT INTO ms_login_attempts (ip_key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(ip_key) DO UPDATE SET count = CASE WHEN reset_at <= ? THEN 1 ELSE MIN(count + 1, 6) END,
    reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END`, ['ip', 100, 50, 50, 100]);
  assert.ok(limiter.text.includes('LEAST(ms_login_attempts.count + 1, 6)'));
  assert.ok(limiter.text.includes('WHEN ms_login_attempts.reset_at <= $3'));
  assert.ok(limiter.text.includes('reset_at = CASE'));
  assert.deepEqual(limiter.values, ['ip', 100, 50, 50, 100]);
  const ignored = compilePostgresQuery('INSERT OR IGNORE INTO fitness_likes (post_id, client_id) VALUES (?, ?);', ['p', 'c']);
  assert.match(ignored.text, /^INSERT\s+INTO fitness_likes/);
  assert.ok(ignored.text.endsWith('ON CONFLICT DO NOTHING'));
});

function mockPool(execute) {
  const calls = [];
  let connections = 0;
  const pool = {
    async connect() {
      const id = ++connections;
      return {
        async query(text, values) {
          calls.push({ id, text, values });
          if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(text)) return { rows: [], rowCount: 0 };
          return execute(text, values, id);
        },
        release() { calls.push({ id, release: true }); },
      };
    },
  };
  return { pool, calls };
}

test('PostgreSQL batch uses prior mutation count and keeps changes inside one transaction', async () => {
  const { pool, calls } = mockPool((text, values) => ({
    command: text.startsWith('UPDATE') ? 'UPDATE' : 'INSERT', rows: [],
    rowCount: text.startsWith('UPDATE') ? 0 : values.at(-1) === 0 ? 0 : 1,
  }));
  const db = createPostgresDatabase({ pool });
  const result = await db.batch([
    db.prepare('UPDATE clients SET revision = revision + 1 WHERE id = ?').bind('stale'),
    db.prepare('INSERT INTO activities (id) SELECT ? WHERE changes() = 1').bind('activity'),
  ]);
  assert.deepEqual(result.map(row => row.meta.changes), [0, 0]);
  assert.deepEqual(calls.find(call => call.text?.startsWith('INSERT')).values, ['activity', 0]);
  assert.ok(calls.some(call => call.text === 'BEGIN ISOLATION LEVEL SERIALIZABLE'));
  assert.equal(calls.filter(call => call.text === 'COMMIT').length, 1);
  assert.ok(calls.every(call => call.id === 1));
  assert.equal(calls.at(-1).release, true);
});

test('PostgreSQL retries serialization failure with rollback and returns numeric D1-compatible rows', async () => {
  const { pool, calls } = mockPool((_text, _values, connection) => {
    if (connection === 1) throw Object.assign(new Error('retry fixture'), { code: '40001' });
    return { command: 'SELECT', rows: [{ count: '2', expires_at: '1900000000000', phone: '00123', liked: true }],
      fields: [{ name: 'count', dataTypeID: 20 }, { name: 'expires_at', dataTypeID: 20 }, { name: 'phone', dataTypeID: 25 }] };
  });
  const db = createPostgresDatabase({ pool });
  assert.deepEqual(await db.prepare('SELECT 1').first(), { count: 2, expires_at: 1900000000000, phone: '00123', liked: 1 });
  assert.equal(calls.filter(call => call.text === 'ROLLBACK').length, 1);
  assert.equal(calls.filter(call => call.text === 'COMMIT').length, 1);
  assert.equal(calls.filter(call => call.release).length, 2);
});

test('PostgreSQL rolls back a failed batch and rejects statements from another database', async () => {
  const { pool, calls } = mockPool(() => { throw Object.assign(new Error('constraint fixture'), { code: '23505' }); });
  const db = createPostgresDatabase({ pool });
  await assert.rejects(db.batch([db.prepare('INSERT INTO clients (id) VALUES (?)').bind('first'), db.prepare('DELETE FROM clients')]), /constraint fixture/);
  assert.equal(calls.filter(call => call.text === 'ROLLBACK').length, 1);
  assert.ok(!calls.some(call => call.text?.startsWith('DELETE')));
  assert.ok(!calls.some(call => call.text === 'COMMIT'));
  const other = createPostgresDatabase({ pool });
  await assert.rejects(db.batch([other.prepare('SELECT 1')]), /outra conexão/);
});

test('Supabase pool options enforce certificate validation and one serverless connection', () => {
  assert.throws(() => postgresPoolOptions({}), /SUPABASE_DB_URL/);
  assert.throws(() => postgresPoolOptions({ SUPABASE_DB_URL: 'https://example.com' }), /PostgreSQL/);
  const options = postgresPoolOptions({ SUPABASE_DB_URL: 'postgresql://postgres.example:fixture-only@pooler.supabase.com:6543/postgres?sslmode=disable&ssl=false&application_name=fixture' });
  assert.equal(options.max, 1);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(options.connectionString).searchParams.has('ssl'), false);
  const withCa = postgresPoolOptions({ SUPABASE_DB_URL: 'postgresql://postgres:fixture@pooler.supabase.com/postgres', SUPABASE_DB_CA: 'fixture certificate' });
  assert.deepEqual(withCa.ssl, { rejectUnauthorized: true, ca: 'fixture certificate' });
});
