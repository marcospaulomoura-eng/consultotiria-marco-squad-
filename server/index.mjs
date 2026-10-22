import { createApp } from './app.mjs';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT deve ser uma porta válida.');
const { app, close } = createApp();
const server = app.listen(port, host, () => {
  console.log(`Marcos Squad API disponível em http://${host}:${port}`);
});
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { close(); process.exit(0); });
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
