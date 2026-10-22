import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../server/postgres.mjs';

// Parent tables precede their dependents. Live sessions and login attempts are
// deliberately excluded: everyone signs in again on the new origin.
export const IMPORT_TABLES = [
  'clients', 'activities', 'settings', 'contracts', 'payments', 'leads',
  'whatsapp_dispatches', 'fitness_access', 'fitness_catalog', 'fitness_workouts',
  'fitness_diets', 'fitness_logs', 'fitness_posts', 'fitness_likes', 'fitness_comments',
];

export async function importSupabase({ source, pool } = {}) {
  // Read every source table from one SQLite snapshot before waiting for the
  // remote connection. An active source must not produce a mixed-time import.
  let present; let realClients; const snapshot = new Map();
  source.exec('BEGIN');
  try {
    present = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    if (!['clients', 'activities', 'settings', 'contracts', 'payments'].every(table => present.has(table))) {
      throw new Error('A origem não contém o banco Marcos Squad completo.');
    }
    realClients = new Set(source.prepare('SELECT id FROM clients WHERE is_demo = 0').all().map(row => row.id));
    for (const table of IMPORT_TABLES) {
      if (!present.has(table)) continue;
      const ordering = table === 'activities' ? ' ORDER BY rowid' : '';
      snapshot.set(table, source.prepare(`SELECT * FROM ${table}${ordering}`).all());
    }
  } finally { source.exec('ROLLBACK'); }
  const demoClients = new Set(snapshot.get('clients').filter(row => row.is_demo === 1).map(row => row.id));
  const demoContracts = new Set(snapshot.get('contracts').filter(row => demoClients.has(row.client_id)).map(row => row.id));
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await connection.query("SELECT pg_advisory_xact_lock(hashtext('marcos_squad_import'))");
    const marker = await connection.query("SELECT value FROM marcos_squad.metadata WHERE key = 'app_id'");
    if (marker.rows[0]?.value !== 'marcos-squad-dashboard-v1') throw new Error('Aplique primeiro as migrações do Marcos Squad no destino.');
    await connection.query('SET LOCAL search_path TO marcos_squad, pg_catalog');
    // Freeze destination writers during the import. Never merge or overwrite
    // an existing installation silently.
    await connection.query(`LOCK TABLE ${IMPORT_TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of IMPORT_TABLES) {
      const result = await connection.query(`SELECT 1 FROM ${table} LIMIT 1`);
      if (result.rows.length) throw new Error('O destino já contém dados. A importação foi interrompida sem substituir registros.');
    }
    const counts = {};
    const importedPosts = new Set();
    for (const table of IMPORT_TABLES) {
      counts[table] = 0;
      if (!present.has(table)) continue;
      const rows = snapshot.get(table);
      for (const row of rows) {
        if ((table === 'clients' || table === 'activities') && row.is_demo === 1) continue;
        if (table === 'contracts' && demoClients.has(row.client_id)) continue;
        if (table === 'payments' && demoContracts.has(row.contract_id)) continue;
        if (table.startsWith('fitness_') && 'client_id' in row && !realClients.has(row.client_id)) continue;
        if ((table === 'fitness_likes' || table === 'fitness_comments') && !importedPosts.has(row.post_id)) continue;
        const columns = Object.keys(row).filter(column => column !== 'sequence_id');
        if (!columns.every(column => /^[a-z_][a-z0-9_]*$/.test(column))) throw new Error('Colunas inesperadas na origem.');
        const parameters = columns.map((_, index) => `$${index + 1}`).join(', ');
        await connection.query(`INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(', ')}) VALUES (${parameters})`, columns.map(column => row[column]));
        if (table === 'fitness_posts') importedPosts.add(row.id);
        counts[table] += 1;
      }
    }
    for (const table of IMPORT_TABLES) {
      const actual = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`);
      if (Number(actual.rows[0].n) !== counts[table]) throw new Error('A conferência de quantidade de registros não passou.');
    }
    await connection.query('COMMIT');
    return { counts, sessionsImported: false };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { connection.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let source; let pool;
  try {
    const [option, filename, ...extra] = process.argv.slice(2);
    if (!['--sqlite', '--d1-sql'].includes(option) || !filename || extra.length) throw new Error('Uso: --sqlite banco.sqlite ou --d1-sql export.sql');
    if (option === '--sqlite') source = new DatabaseSync(resolve(filename), { readOnly: true });
    else {
      source = new DatabaseSync(':memory:');
      source.exec(await readFile(resolve(filename), 'utf8'));
    }
    pool = await createPostgresPool();
    const result = await importSupabase({ source, pool });
    console.log(JSON.stringify({ imported: result.counts, sessionsImported: false }));
  } catch {
    console.error('A importação não concluiu. Confira o arquivo de origem, a conexão segura, as migrações e se o destino está vazio. Nenhum registro existente foi substituído.');
    process.exitCode = 1;
  } finally { source?.close(); await pool?.end(); }
}
