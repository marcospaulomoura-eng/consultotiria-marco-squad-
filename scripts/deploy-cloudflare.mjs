import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { setGlobalProxyFromEnv } from 'node:http';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const APP_ID = 'marcos-squad-dashboard-v1';
const API_BASE = 'https://api.cloudflare.com/client/v4';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class DeploymentError extends Error {
  constructor(message, { status, codes = [] } = {}) {
    super(message);
    this.name = 'DeploymentError';
    this.status = status;
    this.codes = codes;
  }
}

export function deploymentOptions(env) {
  const missing = ['CLOUDFLARE_API_TOKEN', 'MARCOS_DASHBOARD_PASSWORD']
    .filter((name) => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) {
    throw new DeploymentError(`Configure ${missing.join(' e ')} com segurança nas configurações do ambiente e execute novamente. Nenhum recurso foi alterado.`);
  }
  if (Array.from(env.MARCOS_DASHBOARD_PASSWORD).length < 12 || Buffer.byteLength(env.MARCOS_DASHBOARD_PASSWORD, 'utf8') > 256) {
    throw new DeploymentError('MARCOS_DASHBOARD_PASSWORD deve ter pelo menos 12 caracteres e no máximo 256 bytes. Ajuste a senha nas configurações do ambiente; nenhum recurso foi alterado.');
  }
  const workerName = env.CLOUDFLARE_WORKER_NAME || 'marcos-squad-painel';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(workerName)) {
    throw new DeploymentError('CLOUDFLARE_WORKER_NAME deve ter de 1 a 60 letras minúsculas, números ou hífens, sem hífen nas extremidades.');
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID || undefined;
  if (accountId && !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new DeploymentError('CLOUDFLARE_ACCOUNT_ID deve ser o identificador de 32 caracteres da conta Cloudflare.');
  }
  return { workerName, databaseName: `${workerName}-db`, accountId };
}

export function createCloudflareApi({ token, fetchFn = fetch }) {
  return async function request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchFn(`${API_BASE}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new DeploymentError('Não foi possível acessar api.cloudflare.com com HTTPS. Confira a rede e o proxy do ambiente antes de repetir.');
    }
    let payload;
    try { payload = await response.json(); } catch {
      throw new DeploymentError(`A API Cloudflare retornou uma resposta inválida (HTTP ${response.status}).`);
    }
    if (!response.ok || payload?.success === false) {
      const codes = Array.isArray(payload?.errors)
        ? payload.errors.map((error) => error?.code).filter(Number.isInteger) : [];
      throw new DeploymentError(`A API Cloudflare recusou ${method} ${path.split('?')[0]} (HTTP ${response.status}${codes.length ? `, códigos ${codes.join(', ')}` : ''}). Confira as permissões e a configuração do ambiente.`, { status: response.status, codes });
    }
    if (!payload || !Object.hasOwn(payload, 'result')) {
      throw new DeploymentError('A API Cloudflare retornou dados incompletos; a publicação foi interrompida.');
    }
    return payload;
  };
}

export async function listAll(api, path) {
  const rows = [];
  const perPage = 50;
  for (let page = 1; page <= 1000; page++) {
    const payload = await api(`${path}?page=${page}&per_page=${perPage}`);
    if (!Array.isArray(payload.result)) throw new DeploymentError('A listagem Cloudflare não contém uma lista válida.');
    rows.push(...payload.result);
    const info = payload.result_info;
    if (Number.isInteger(info?.total_pages)) {
      if (page >= info.total_pages) return rows;
    } else if (Number.isInteger(info?.total_count)) {
      if (rows.length >= info.total_count) return rows;
    } else if (payload.result.length < perPage) return rows;
    if (!payload.result.length) throw new DeploymentError('A paginação Cloudflare está incompleta; nenhum recurso adicional foi criado.');
  }
  throw new DeploymentError('A listagem Cloudflare excedeu o limite seguro de páginas.');
}

export function chooseAccount(accounts, requestedId) {
  const unique = [...new Map(accounts.map((account) => [account.id, account])).values()];
  if (requestedId) {
    if (!unique.some((account) => account.id === requestedId)) {
      throw new DeploymentError('CLOUDFLARE_ACCOUNT_ID não aparece nas contas acessíveis pelo token. Confira as permissões nas configurações do ambiente.');
    }
    return requestedId;
  }
  if (unique.length !== 1 || !unique[0]?.id) {
    throw new DeploymentError(unique.length
      ? 'O token acessa várias contas. Configure CLOUDFLARE_ACCOUNT_ID nas configurações do ambiente; nenhum recurso foi criado.'
      : 'O token não lista nenhuma conta Cloudflare. Confira as permissões nas configurações do ambiente.');
  }
  return unique[0].id;
}

export function buildDeploymentConfig(base, { rootDir, workerName, accountId, databaseId, databaseName }) {
  if (base?.vars?.APP_ID !== APP_ID) throw new DeploymentError('A configuração base não contém o marcador esperado desta aplicação.');
  const db = base.d1_databases?.find((binding) => binding.binding === 'DB');
  if (!db || !base.main || !base.assets?.directory || base.assets.binding !== 'ASSETS') {
    throw new DeploymentError('A configuração base precisa definir o Worker, ASSETS e o banco D1 DB.');
  }
  const absolute = (path) => isAbsolute(path) ? path : resolve(rootDir, path);
  return {
    ...base, name: workerName, account_id: accountId, workers_dev: true,
    main: absolute(base.main),
    assets: { ...base.assets, directory: absolute(base.assets.directory) },
    d1_databases: base.d1_databases.map((binding) => binding.binding === 'DB' ? {
      ...binding, database_name: databaseName, database_id: databaseId,
      migrations_dir: absolute(binding.migrations_dir || 'cloudflare/migrations'),
    } : binding),
  };
}

async function workerSettings(api, path) {
  try {
    const { result } = await api(`${path}/settings`);
    if (!Array.isArray(result?.bindings) || !result.bindings.some((binding) =>
      binding.type === 'plain_text' && binding.name === 'APP_ID' && binding.text === APP_ID)) {
      throw new DeploymentError('Já existe um Worker com esse nome sem o marcador desta aplicação. Escolha outro CLOUDFLARE_WORKER_NAME para preservar o projeto existente.');
    }
    return result;
  } catch (error) {
    if (error instanceof DeploymentError && error.status === 404) return null;
    throw error;
  }
}

async function ensureSubdomain(api, accountPath, accountId) {
  let subdomain;
  try { subdomain = (await api(`${accountPath}/workers/subdomain`)).result?.subdomain; } catch (error) {
    if (!(error instanceof DeploymentError) || (error.status !== 404 && !error.codes.includes(10007))) throw error;
  }
  if (!subdomain) {
    await api(`${accountPath}/workers/subdomain`, {
      method: 'PUT', body: { subdomain: `marcos-squad-${accountId.slice(0, 10)}` },
    });
    subdomain = (await api(`${accountPath}/workers/subdomain`)).result?.subdomain;
  }
  if (typeof subdomain !== 'string' || subdomain.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
    throw new DeploymentError('A Cloudflare não confirmou um subdomínio workers.dev válido.');
  }
  return subdomain;
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new DeploymentError('Um registro local de publicação está inválido ou inacessível. Preserve os arquivos em .wrangler e confira a configuração antes de publicar.');
  }
}

function knownDatabase({ receipt, config, accountId, workerName, database }) {
  if (!database?.uuid) return false;
  if (receipt?.APP_ID === APP_ID && receipt.accountId === accountId && receipt.workerName === workerName
    && receipt.databaseId === database.uuid && receipt.databaseName === database.name) return true;
  return config?.vars?.APP_ID === APP_ID && config.account_id === accountId && config.name === workerName
    && config.d1_databases?.some((binding) => binding.binding === 'DB'
      && binding.database_id === database.uuid && binding.database_name === database.name);
}

export async function verifyDeployment(url, fetchFn = fetch) {
  async function get(path, headers) {
    try { return await fetchFn(`${url}${path}`, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...(headers ? { headers } : {}) }); } catch {
      throw new DeploymentError('O serviço publicado não respondeu ao teste HTTPS. A publicação ainda não foi validada.');
    }
  }
  const statusResponse = await get('/api/auth/status');
  let status;
  try { status = await statusResponse.json(); } catch { /* Fail closed below. */ }
  if (statusResponse.status !== 200 || status?.required !== true || status.configured !== true || status.authenticated !== false) {
    throw new DeploymentError('A publicação não confirmou o login obrigatório com senha configurada. Nenhum endereço será apresentado como pronto.');
  }
  if ((await get('/api/dashboard')).status !== 401) {
    throw new DeploymentError('A publicação não bloqueou o painel sem autenticação. Verifique a proteção antes de divulgar o serviço.');
  }
  const studentResponse = await get('/api/fitness/auth/status');
  let studentStatus;
  try { studentStatus = await studentResponse.json(); } catch { /* Fail closed below. */ }
  if (studentResponse.status !== 200 || studentStatus?.student !== null) {
    throw new DeploymentError('A nova área do aluno não respondeu corretamente. A versão publicada ainda não foi validada.');
  }
  if ((await get('/api/fitness/coach/overview')).status !== 401) {
    throw new DeploymentError('A publicação não bloqueou a área do professor sem autenticação.');
  }
  const studentPage = await get('/aluno');
  if (studentPage.status !== 200 || !studentPage.headers.get('content-type')?.startsWith('text/html')
    || !(await studentPage.text()).includes('id="root"')) {
    throw new DeploymentError('A página de acesso do aluno não foi servida corretamente.');
  }
  const healthResponse = await get('/api/health');
  let health;
  try { health = await healthResponse.json(); } catch { /* Fail closed below. */ }
  if (healthResponse.status !== 200 || health?.status !== 'ok' || health.database !== 'ok') {
    throw new DeploymentError('O banco D1 publicado não passou na verificação de saúde.');
  }
  const logo = await get('/brand/marcos-squad-logo.png');
  const signature = Buffer.from(await logo.arrayBuffer()).subarray(0, PNG_SIGNATURE.length);
  if (logo.status !== 200 || !logo.headers.get('content-type')?.startsWith('image/png') || !signature.equals(PNG_SIGNATURE)) {
    throw new DeploymentError('A imagem da marca não foi servida corretamente pela publicação.');
  }
  const thumbnail = await get('/videos/wger-12.webp');
  const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
  if (thumbnail.status !== 200 || !thumbnail.headers.get('content-type')?.startsWith('image/webp')
    || thumbnailBytes.toString('ascii', 0, 4) !== 'RIFF' || thumbnailBytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new DeploymentError('A miniatura de exercício não foi servida corretamente pela publicação.');
  }
  const video = await get('/videos/wger-12.mp4', { Range: 'bytes=0-31' });
  const videoBytes = Buffer.from(await video.arrayBuffer());
  if (![200, 206].includes(video.status) || !video.headers.get('content-type')?.startsWith('video/mp4')
    || videoBytes.toString('ascii', 4, 8) !== 'ftyp') {
    throw new DeploymentError('O vídeo de exercício não foi servido corretamente pela publicação.');
  }
}

export async function runDeployment({
  env = process.env, rootDir = ROOT, fetchFn = fetch, execFileFn = execute, logger = console,
} = {}) {
  // Credentials are checked before any file write, subprocess or cloud mutation.
  const options = deploymentOptions(env);
  let base;
  try { base = JSON.parse(await readFile(resolve(rootDir, 'wrangler.jsonc'), 'utf8')); } catch {
    throw new DeploymentError('Não foi possível ler wrangler.jsonc como JSON. Execute este comando na aplicação preparada.');
  }
  // Validate configuration and required local artifacts before contacting the account.
  const preliminary = buildDeploymentConfig(base, { ...options, rootDir, accountId: '', databaseId: '' });
  const wrangler = resolve(rootDir, 'node_modules/wrangler/bin/wrangler.js');
  try {
    await Promise.all([access(wrangler), access(preliminary.main), access(resolve(preliminary.assets.directory, 'index.html')),
      access(resolve(preliminary.assets.directory, 'brand/marcos-squad-logo.png')), access(preliminary.d1_databases.find((item) => item.binding === 'DB').migrations_dir)]);
  } catch {
    throw new DeploymentError('Faltam dependências, build ou migrações locais. Execute npm ci e npm run build antes de publicar.');
  }
  const api = createCloudflareApi({ token: env.CLOUDFLARE_API_TOKEN, fetchFn });
  const accountId = chooseAccount(await listAll(api, '/accounts'), options.accountId);
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new DeploymentError('A Cloudflare retornou um identificador de conta inválido.');
  const accountPath = `/accounts/${accountId}`;
  const workerPath = `${accountPath}/workers/scripts/${options.workerName}`;
  const settings = await workerSettings(api, workerPath);
  const configPath = resolve(rootDir, '.wrangler/deploy-config.json');
  const receiptPath = resolve(rootDir, '.wrangler/provisioning.json');
  const [previousConfig, receipt] = await Promise.all([readOptionalJson(configPath), readOptionalJson(receiptPath)]);
  const databases = (await listAll(api, `${accountPath}/d1/database`)).filter((database) => database.name === options.databaseName);
  if (databases.length > 1) throw new DeploymentError('Há mais de um D1 com o nome esperado. Confira a conta antes de publicar.');
  let database = databases[0];
  const currentDatabaseId = settings?.bindings.find((binding) => binding.type === 'd1' && binding.name === 'DB')?.id;
  if (settings && (!currentDatabaseId || currentDatabaseId !== database?.uuid)) {
    throw new DeploymentError('O banco D1 atualmente vinculado ao Worker não coincide com o banco esperado. A publicação parou para preservar os dados existentes.');
  }
  if (!settings && database && !knownDatabase({ receipt, config: previousConfig, accountId, workerName: options.workerName, database })) {
    throw new DeploymentError('Já existe um D1 com esse nome sem vínculo ou registro conhecido desta aplicação. A publicação parou para preservar o banco existente.');
  }
  if (!database) {
    if (receipt !== null) {
      throw new DeploymentError('Já existe um recibo local de provisionamento de outro banco. Preserve esse registro e confira a conta antes de criar outro D1.');
    }
    await mkdir(dirname(receiptPath), { recursive: true });
    database = (await api(`${accountPath}/d1/database`, { method: 'POST', body: { name: options.databaseName } })).result;
    if (typeof database?.uuid !== 'string' || !database.uuid) throw new DeploymentError('A Cloudflare não confirmou o identificador do banco D1.');
    // Persist ownership immediately, so an interrupted first deploy can safely resume.
    await writeFile(receiptPath, `${JSON.stringify({
      APP_ID, accountId, workerName: options.workerName, databaseId: database.uuid, databaseName: options.databaseName,
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }
  if (typeof database?.uuid !== 'string' || !database.uuid) throw new DeploymentError('A Cloudflare não confirmou o identificador do banco D1.');
  const subdomain = await ensureSubdomain(api, accountPath, accountId);
  const config = buildDeploymentConfig(base, { ...options, rootDir, accountId, databaseId: database.uuid });
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const configHome = resolve(rootDir, '.wrangler/config');
  const cacheHome = resolve(rootDir, '.wrangler/cache');
  const logDirectory = resolve(rootDir, '.wrangler/logs');
  await Promise.all([configHome, cacheHome, logDirectory].map((directory) => mkdir(directory, { recursive: true })));

  // The password is sent only in the HTTPS secret API body, never to files or CLI input.
  const commandEnv = {
    ...env, CLOUDFLARE_ACCOUNT_ID: accountId, NODE_USE_ENV_PROXY: '1', CI: '1', WRANGLER_SEND_METRICS: 'false',
    XDG_CONFIG_HOME: configHome, XDG_CACHE_HOME: cacheHome,
    WRANGLER_LOG_PATH: resolve(logDirectory, 'wrangler.log'),
  };
  delete commandEnv.MARCOS_DASHBOARD_PASSWORD;
  delete commandEnv.DASHBOARD_PASSWORD;
  async function wranglerCommand(args, label) {
    logger.log(label);
    try {
      await execFileFn(process.execPath, [wrangler, ...args], {
        cwd: rootDir, env: commandEnv, timeout: 300_000, maxBuffer: 2 * 1024 * 1024,
      });
    } catch {
      // Do not echo CLI output: upstream tools can include authentication material.
      throw new DeploymentError(`${label} não concluiu. Confira a rede e as permissões da conta antes de repetir a publicação.`);
    }
  }
  await wranglerCommand(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath], 'Aplicando migrações no D1');
  await wranglerCommand(['deploy', '--config', configPath], 'Publicando o Worker com acesso protegido');
  await api(`${workerPath}/secrets`, {
    method: 'PUT', body: { name: 'DASHBOARD_PASSWORD', text: env.MARCOS_DASHBOARD_PASSWORD, type: 'secret_text' },
  });
  const url = `https://${options.workerName}.${subdomain}.workers.dev`;
  await verifyDeployment(url, fetchFn);
  logger.log(`Publicação verificada: ${url}`);
  return { url, accountId, databaseId: database.uuid, workerName: options.workerName, configPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let restoreProxy;
  try {
    deploymentOptions(process.env);
    restoreProxy = setGlobalProxyFromEnv();
    await runDeployment();
  } catch (error) {
    console.error(error instanceof DeploymentError ? error.message : 'A publicação foi interrompida por uma falha local. Nenhum endereço foi confirmado.');
    process.exitCode = 1;
  } finally {
    restoreProxy?.();
  }
}
