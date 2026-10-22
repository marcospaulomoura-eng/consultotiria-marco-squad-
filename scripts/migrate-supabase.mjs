import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPostgresPool } from '../server/postgres.mjs';

export const APP_ID = 'marcos-squad-dashboard-v1';
const migrationDirectory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

export async function migrateSupabase({ pool, directory = migrationDirectory } = {}) {
  const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error('Não foram encontradas migrações do Supabase.');
  const migrations = await Promise.all(files.map(async name => {
    const sql = await readFile(resolve(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('marcos_squad_migrations'))");
    const existing = await connection.query("SELECT tablename FROM pg_tables WHERE schemaname = 'marcos_squad'");
    if (existing.rows.length) {
      if (!existing.rows.some(row => row.tablename === 'metadata')) throw new Error('O schema existente não foi identificado como Marcos Squad.');
      const marker = await connection.query("SELECT value FROM marcos_squad.metadata WHERE key = 'app_id'");
      if (marker.rows[0]?.value !== APP_ID) throw new Error('O schema existente pertence a outra aplicação.');
    }
    await connection.query('CREATE SCHEMA IF NOT EXISTS marcos_squad');
    await connection.query('REVOKE ALL ON SCHEMA marcos_squad FROM PUBLIC');
    await connection.query(`CREATE TABLE IF NOT EXISTS marcos_squad.schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = [];
    for (const migration of migrations) {
      const previous = await connection.query('SELECT checksum FROM marcos_squad.schema_migrations WHERE version = $1', [migration.name]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== migration.checksum) throw new Error('Uma migração já aplicada foi alterada. Preserve o histórico do banco.');
        continue;
      }
      await connection.query(migration.sql);
      await connection.query('INSERT INTO marcos_squad.schema_migrations (version, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await connection.query('COMMIT');
    return { applied };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { connection.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool;
  try {
    pool = await createPostgresPool();
    const result = await migrateSupabase({ pool });
    console.log(result.applied.length ? `Supabase: ${result.applied.length} migração(ões) aplicada(s).` : 'Supabase: banco já atualizado.');
  } catch {
    console.error('A migração não concluiu. Verifique SUPABASE_DB_URL, o certificado TLS, o acesso de rede e o histórico do schema. Nenhuma credencial foi exibida.');
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
