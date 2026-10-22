import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createVercelHandler } from './vercel-runtime.mjs';
import { getPostgresDatabase } from './postgres.mjs';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta válida.');
const api = createVercelHandler();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return api(req, res);
  next();
});
const frontend = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(`${frontend}/index.html`)) {
  app.use(express.static(frontend));
  app.get('/{*path}', (_req, res) => res.sendFile(`${frontend}/index.html`));
}
const server = app.listen(port, host, () => console.log(`Marcos Squad · Supabase disponível em http://${host}:${port}`));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  server.close(async () => {
    if (process.env.SUPABASE_DB_URL) await (await getPostgresDatabase()).close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
});
