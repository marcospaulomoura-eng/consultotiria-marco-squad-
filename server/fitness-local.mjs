import { readFileSync } from 'node:fs';
import { handleFitness } from './fitness-api.mjs';

// Identical domain logic and queries in local SQLite and production D1.
export function fitnessDatabase(sqlite) {
  sqlite.exec(readFileSync(new URL('../cloudflare/migrations/0006_student_app.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) { bindings = values; return statement; },
        execute() {
          const results = sqlite.prepare(sql).all(...bindings);
          return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) } };
        },
        async first() { return statement.execute().results[0] ?? null; },
        async all() { return statement.execute(); },
        async run() { return statement.execute(); },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try { const results = statements.map(x => x.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
export function fitnessMiddleware(db, auth, now) {
  const DB = fitnessDatabase(db);
  return async (req, res, next) => {
    if (!req.originalUrl.startsWith('/api/fitness/')) return next();
    try {
      const headers = new Headers();
      for (const name of ['cookie', 'origin', 'content-type']) if (req.get(name)) headers.set(name, req.get(name));
      headers.set('CF-Connecting-IP', req.ip || 'local');
      const request = new Request(`${req.protocol}://${req.host}${req.originalUrl}`, {
        method: req.method, headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      });
      const response = await handleFitness(request, { DB }, { isAdmin: auth.authenticated(req), now: now() });
      for (const [name, value] of response.headers) res.set(name, value);
      res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (Number.isInteger(error.status)) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  };
}
