import { access, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configuredPassword } from '../cloudflare/auth.mjs';
import { createPostgresPool, postgresPoolOptions } from '../server/postgres.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP_ID = 'marcos-squad-dashboard-v1';
const REQUIRED_COLUMNS = {
  metadata: ['key', 'value'], schema_migrations: ['version', 'checksum'],
  clients: ['id', 'revision', 'whatsapp_opt_in'], activities: ['id', 'sequence_id'],
  settings: ['id', 'value'], contracts: ['id', 'amount_cents'], payments: ['id', 'contract_id'],
  leads: ['id'], whatsapp_dispatches: ['dispatch_key'], ms_sessions: ['token_hash', 'password_version'],
  ms_login_attempts: ['ip_key'], fitness_access: ['client_id', 'code_hash'],
  fitness_sessions: ['token_hash'], fitness_attempts: ['ip_key'], fitness_catalog: ['id'],
  fitness_workouts: ['id'], fitness_diets: ['client_id'], fitness_logs: ['id'],
  fitness_posts: ['id'], fitness_likes: ['post_id'], fitness_comments: ['id'],
};

function fail(code) { throw Object.assign(new Error('Preflight database check failed'), { preflightCode: code }); }

async function databaseCheck({ env, migrations, poolFactory }) {
  let pool; let connection; let begun = false;
  try {
    pool = await poolFactory(env);
    connection = await pool.connect();
    await connection.query('BEGIN READ ONLY'); begun = true;
    await connection.query("SET LOCAL statement_timeout = '15000ms'");
    const marker = await connection.query("SELECT value FROM marcos_squad.metadata WHERE key = 'app_id'");
    if (marker.rows[0]?.value !== APP_ID) fail('wrong_application');
    const columns = await connection.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'marcos_squad'");
    if (Object.entries(REQUIRED_COLUMNS).some(([table, fields]) => fields.some(field =>
      !columns.rows.some(row => row.table_name === table && row.column_name === field)))) fail('schema_incomplete');
    const history = await connection.query('SELECT version, checksum FROM marcos_squad.schema_migrations');
    if (migrations.some(local => !history.rows.some(remote => remote.version === local.version && remote.checksum === local.checksum))) {
      fail('migration_mismatch');
    }
    await connection.query('ROLLBACK'); begun = false;
    return { name: 'database', ok: true, required: true, state: 'verified_read_only' };
  } catch (error) {
    const code = error.preflightCode || (/^[A-Z0-9_]{1,40}$/.test(String(error.code)) ? String(error.code) : 'connection_failed');
    return { name: 'database', ok: false, required: true, state: code };
  } finally {
    if (begun) await connection?.query('ROLLBACK').catch(() => {});
    connection?.release();
    await pool?.end?.();
  }
}

/** Local checks never read .env files. --database adds only read-only SQL. */
export async function preflight({
  rootDir = ROOT, env = process.env, nodeVersion = process.versions.node,
  database = false, poolFactory = createPostgresPool,
} = {}) {
  const checks = [];
  const [major, minor] = nodeVersion.split('.').map(Number);
  checks.push({ name: 'node', ok: major === 24 && minor >= 14, required: true, state: 'requires_24_14_or_later_in_24_x' });
  try {
    postgresPoolOptions(env);
    checks.push({ name: 'supabase_configuration', ok: true, required: true, state: 'configured' });
  } catch {
    checks.push({ name: 'supabase_configuration', ok: false, required: true, state: 'missing_or_invalid' });
  }
  checks.push({ name: 'dashboard_password', ok: configuredPassword(env), required: true, state: 'requires_12_characters_and_at_most_256_utf8_bytes' });
  checks.push({ name: 'cron_secret', ok: typeof env.CRON_SECRET === 'string' && env.CRON_SECRET.length >= 16, required: true, state: 'requires_16_characters' });
  try {
    const link = JSON.parse(await readFile(resolve(rootDir, '.vercel/project.json'), 'utf8'));
    if (typeof link.projectId !== 'string' || !link.projectId || typeof link.orgId !== 'string' || !link.orgId) throw new Error('Missing project link');
    checks.push({ name: 'vercel_link', ok: true, required: true, state: 'linked_locally_not_remote_authentication' });
  } catch {
    checks.push({ name: 'vercel_link', ok: false, required: true, state: 'missing_or_invalid' });
  }
  try {
    await Promise.all(['dist/index.html', 'dist/brand/marcos-squad-logo.png', 'dist/videos/wger-12.mp4', 'dist/videos/wger-12.webp', 'api/index.mjs']
      .map(file => access(resolve(rootDir, file))));
    checks.push({ name: 'build_files', ok: true, required: true, state: 'present_not_runtime_verified' });
  } catch {
    checks.push({ name: 'build_files', ok: false, required: true, state: 'missing_build_or_api_files' });
  }
  let migrations = [];
  try {
    const directory = resolve(rootDir, 'supabase/migrations');
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!files.length) throw new Error('No migrations');
    migrations = await Promise.all(files.map(async version => ({ version,
      checksum: createHash('sha256').update(await readFile(resolve(directory, version))).digest('hex'),
    })));
    checks.push({ name: 'migration_files', ok: true, required: true, state: 'present' });
  } catch {
    checks.push({ name: 'migration_files', ok: false, required: true, state: 'missing_or_invalid' });
  }
  if (database && checks.find(check => check.name === 'supabase_configuration').ok && migrations.length) {
    checks.push(await databaseCheck({ env, migrations, poolFactory }));
  } else {
    checks.push({ name: 'database', ok: false, required: database, state: database ? 'blocked_by_local_configuration' : 'not_checked' });
  }
  return {
    scope: database ? 'local_and_database_read_only' : 'local_only',
    ok: checks.every(check => !check.required || check.ok),
    databaseVerified: checks.some(check => check.name === 'database' && check.ok),
    // The Vercel account and its remote environment variables are deliberately
    // outside this command's claims; project.json alone cannot verify them.
    vercelRemoteVerified: false,
    checks,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--database')) throw new Error('Invalid arguments');
    const result = await preflight({ database: args.includes('--database') });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('Preflight não concluiu. Uso: node scripts/preflight.mjs [--database]. Nenhum valor de credencial é exibido.');
    process.exitCode = 1;
  }
}
