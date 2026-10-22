import { setGlobalProxyFromEnv } from 'node:http';
import { verifyDeployment } from './deploy-cloudflare.mjs';

let restoreProxy;
try {
  const [value, ...extra] = process.argv.slice(2);
  const url = new URL(value);
  if (extra.length || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('URL inválida.');
  restoreProxy = setGlobalProxyFromEnv();
  await verifyDeployment(url.origin);
  console.log(`Publicação verificada: ${url.origin}`);
} catch {
  console.error('A publicação ainda não foi validada. Informe uma URL HTTPS e confira login, banco, área do aluno e arquivos de mídia.');
  process.exitCode = 1;
} finally { restoreProxy?.(); }
