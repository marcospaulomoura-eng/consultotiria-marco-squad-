const SCHEMA = 'marcos_squad';
const RETRYABLE = new Set(['40001', '40P01']);
const NUMERIC_OIDS = new Set([20, 1700]);

// Queries are application-owned. Values always remain bind parameters; quoted
// strings/identifiers and comments must not be rewritten as SQL instructions.
function tokenize(sql) {
  const result = [];
  const pattern = /(?:'(?:(?:'')|[^'])*'|"(?:(?:"")|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\s+|[A-Za-z_][A-Za-z_0-9]*|\?|.)/g;
  for (const match of sql.matchAll(pattern)) {
    const value = match[0];
    const type = /^\s|^--|^\/\*/.test(value) ? 'trivia'
      : /^'|^"/.test(value) ? 'quoted' : /^[A-Za-z_]/.test(value) ? 'word' : 'symbol';
    result.push({ value, type });
  }
  return result;
}

function normalizeRows(result) {
  const numeric = new Set((result.fields ?? []).filter(field => NUMERIC_OIDS.has(field.dataTypeID)).map(field => field.name));
  return (result.rows ?? []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === 'boolean') return [key, value ? 1 : 0];
    if (typeof value === 'bigint' || (numeric.has(key) && typeof value === 'string')) {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('O banco retornou um número fora do intervalo permitido.');
      return [key, number];
    }
    return [key, value];
  })));
}

/** Translate the limited SQLite dialect used by the shared asynchronous API. */
export function compilePostgresQuery(sql, bindings = [], previousChanges = 0) {
  if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('Consulta SQL inválida.');
  const tokens = tokenize(sql);
  const significant = tokens.map((token, index) => ({ ...token, index })).filter(token => token.type !== 'trivia');
  const upper = index => significant[index]?.value.toUpperCase();
  const blank = token => { tokens[token.index].value = ''; };
  let ignoreConflict = false;
  let table = '';
  for (let i = 0; i < significant.length; i += 1) {
    const token = significant[i];
    if (token.type !== 'word') continue;
    if (upper(i) === 'INSERT') {
      if (upper(i + 1) === 'OR' && upper(i + 2) === 'IGNORE') {
        ignoreConflict = true; blank(significant[i + 1]); blank(significant[i + 2]);
        if (upper(i + 3) === 'INTO') table = significant[i + 4]?.value ?? '';
      } else if (upper(i + 1) === 'INTO') table = significant[i + 2]?.value ?? '';
    }
    if (upper(i) === 'AS' && significant[i + 1]?.type === 'word' && /[A-Z]/.test(significant[i + 1].value)) {
      tokens[significant[i + 1].index].value = `"${significant[i + 1].value}"`;
    }
    if (upper(i) === 'ROWID') tokens[token.index].value = 'sequence_id';
    if (upper(i) === 'COLLATE' && upper(i + 1) === 'NOCASE') {
      let start = i - 1;
      while (significant[start - 1]?.value === '.' && start >= 2) start -= 2;
      tokens[significant[start].index].value = `lower(${tokens[significant[start].index].value}`;
      tokens[significant[i - 1].index].value += ')';
      blank(token); blank(significant[i + 1]);
    }
    if (upper(i) === 'MIN' && significant[i + 1]?.value === '(') {
      let depth = 0;
      for (let j = i + 1; j < significant.length; j += 1) {
        if (significant[j].value === '(') depth += 1;
        else if (significant[j].value === ')') { depth -= 1; if (!depth) break; }
        else if (significant[j].value === ',' && depth === 1) { tokens[token.index].value = 'LEAST'; break; }
      }
    }
  }
  // Both rate-limit UPSERTs read the existing row, not EXCLUDED's new row.
  const conflict = significant.findIndex((token, index) => upper(index) === 'DO' && upper(index + 1) === 'UPDATE' && upper(index + 2) === 'SET');
  if (conflict >= 0 && table) {
    for (let i = conflict + 3; i < significant.length; i += 1) {
      if (!['count', 'reset_at'].includes(significant[i].value.toLowerCase())) continue;
      const previous = significant[i - 1]?.value;
      const assignment = significant[i + 1]?.value === '=' && [',', 'SET'].includes(previous?.toUpperCase());
      if (!assignment && previous !== '.' && significant[i + 1]?.value !== '(') {
        tokens[significant[i].index].value = `${table}.${significant[i].value}`;
      }
    }
  }
  const values = [];
  let supplied = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type === 'symbol' && tokens[i].value === '?') {
      if (supplied >= bindings.length) throw new Error('Faltam parâmetros na consulta.');
      values.push(bindings[supplied++]); tokens[i].value = `$${values.length}`;
    } else if (tokens[i].type === 'word' && tokens[i].value.toLowerCase() === 'changes') {
      const following = [];
      for (let j = i + 1; j < tokens.length && following.length < 2; j += 1) {
        if (tokens[j].type !== 'trivia') following.push(j);
      }
      if (tokens[following[0]]?.value === '(' && tokens[following[1]]?.value === ')') {
        values.push(previousChanges); tokens[i].value = `$${values.length}`;
        tokens[following[0]].value = ''; tokens[following[1]].value = '';
      }
    }
  }
  if (supplied !== bindings.length) throw new Error('Há parâmetros excedentes na consulta.');
  let text = tokens.map(token => token.value).join('').trim().replace(/;\s*$/, '');
  if (ignoreConflict) text += ' ON CONFLICT DO NOTHING';
  return { text, values };
}

export function createPostgresDatabase({ pool, schema = SCHEMA, maxRetries = 3 } = {}) {
  if (!pool?.connect) throw new TypeError('Configure um pool PostgreSQL válido.');
  if (schema !== SCHEMA) throw new Error('O banco deve usar o schema privado marcos_squad.');
  const ownedStatements = new WeakSet();
  async function transaction(statements) {
    for (let attempt = 0; ; attempt += 1) {
      const connection = await pool.connect();
      let begun = false;
      try {
        await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); begun = true;
        await connection.query('SET LOCAL search_path TO marcos_squad, pg_catalog');
        await connection.query("SET LOCAL statement_timeout = '15000ms'");
        let changes = 0;
        const results = [];
        for (const statement of statements) {
          if (!ownedStatements.has(statement)) throw new TypeError('A consulta pertence a outra conexão.');
          const query = compilePostgresQuery(statement.sql, statement.bindings, changes);
          const result = await connection.query(query.text, query.values);
          const command = result.command ?? query.text.match(/^\s*(\w+)/)?.[1]?.toUpperCase();
          if (['INSERT', 'UPDATE', 'DELETE'].includes(command)) changes = result.rowCount ?? result.affectedRows ?? 0;
          results.push({ results: normalizeRows(result), meta: { changes: ['INSERT', 'UPDATE', 'DELETE'].includes(command) ? changes : 0 } });
        }
        await connection.query('COMMIT'); begun = false;
        return results;
      } catch (error) {
        if (begun) await connection.query('ROLLBACK').catch(() => {});
        if (!RETRYABLE.has(error.code) || attempt >= maxRetries) throw error;
      } finally { connection.release(); }
    }
  }
  return {
    prepare(sql) {
      const statement = {
        sql, bindings: [],
        bind(...values) {
          const bound = { ...statement, bindings: values };
          ownedStatements.add(bound);
          return bound;
        },
        async all() { return (await transaction([this]))[0]; },
        async run() { return (await transaction([this]))[0]; },
        async first(column) {
          const row = (await transaction([this]))[0].results[0] ?? null;
          return column === undefined ? row : row?.[column] ?? null;
        },
      };
      ownedStatements.add(statement);
      return statement;
    },
    async batch(statements) {
      if (!Array.isArray(statements)) throw new TypeError('Envie uma lista de consultas.');
      if (!statements.length) return [];
      return transaction(statements);
    },
    async close() { await pool.end?.(); },
  };
}

export function postgresPoolOptions(env = process.env) {
  const connectionString = env.SUPABASE_DB_URL;
  if (typeof connectionString !== 'string' || !connectionString.trim()) throw new Error('Configure SUPABASE_DB_URL no servidor.');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password) {
    throw new Error('SUPABASE_DB_URL deve ser a conexão PostgreSQL do Supabase.');
  }
  // URL sslmode options can disable node-postgres certificate validation.
  // Keep one explicit, verified TLS configuration for production connections.
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('ssl') || key.toLowerCase() === 'uselibpqcompat') url.searchParams.delete(key);
  }
  return {
    connectionString: url.toString(), ssl: { rejectUnauthorized: true },
    ...(env.SUPABASE_DB_CA ? { ssl: { rejectUnauthorized: true, ca: env.SUPABASE_DB_CA } } : {}),
    max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true, application_name: 'marcos-squad-vercel',
  };
}

export async function createPostgresPool(env = process.env) {
  const options = postgresPoolOptions(env);
  const { Pool } = await import('pg');
  const pool = new Pool(options);
  pool.on('error', () => { /* No credentials or SQL are written to logs. */ });
  return pool;
}

let defaultDatabase;
let defaultUrl;
export async function getPostgresDatabase(env = process.env) {
  // Validate synchronously even when a previous invocation already has a pool.
  postgresPoolOptions(env);
  if (defaultDatabase && defaultUrl === env.SUPABASE_DB_URL) return defaultDatabase;
  const previous = defaultDatabase;
  defaultUrl = env.SUPABASE_DB_URL;
  const pending = (async () => {
    const pool = await createPostgresPool(env);
    if (previous) await (await previous.catch(() => null))?.close();
    return createPostgresDatabase({ pool });
  })();
  defaultDatabase = pending;
  try { return await pending; }
  catch (error) { if (defaultDatabase === pending) { defaultDatabase = undefined; defaultUrl = undefined; } throw error; }
}
