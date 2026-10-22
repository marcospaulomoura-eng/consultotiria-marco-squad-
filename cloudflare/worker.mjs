import {
  TIMEZONE, ValidationError, todayInSaoPaulo, validateClient, validateSettings, validatePayment, validateLead,
  summarize, renewalDetails, makeReminder, formatDate,
} from '../server/domain.mjs';
import {
  ConcurrentWriteError, checkDatabase, getClientSnapshot, getClients, getSettings, saveSettings, getDemoStatus,
  getActivities, getFinance, createActivity, publicActivity, activityStatement,
  insertClient, updateClient, deleteClient, removeDemo, setContractTracking, addPayment,
  getLeads, getLead, insertLead, updateLead, deleteLead,
} from './storage.mjs';
import {
  HttpError, assertSameOrigin, configuredPassword, authenticated, requireAuthenticated, login, logout,
} from './auth.mjs';
import {
  WhatsAppApiError, sendWhatsAppTemplate, whatsappStatus, renewalTemplate, salesTemplate,
} from '../server/whatsapp.mjs';
import { runWhatsAppAutomation } from './automation.mjs';
import { handleFitness } from '../server/fitness-api.mjs';

const JSON_LIMIT = 32 * 1024;
const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function json(body, status = 200, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { ...API_HEADERS, ...headers },
  });
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new HttpError(415, 'Envie os dados no formato application/json.');
  }
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (declaredLength > JSON_LIMIT) throw new HttpError(413, 'Os dados enviados excedem o tamanho permitido.');
  let size = 0;
  const chunks = [];
  const reader = request.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > JSON_LIMIT) {
          await reader.cancel();
          throw new HttpError(413, 'Os dados enviados excedem o tamanho permitido.');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new HttpError(400, 'O JSON enviado é inválido.');
  }
}

async function requireClient(db, id) {
  const snapshot = await getClientSnapshot(db, id);
  if (!snapshot) throw new HttpError(404, 'Cliente não encontrado.');
  return snapshot;
}

async function handleApi(request, env, path) {
  const db = env.DB;
  const method = request.method;
  if (path === '/api/health' && (method === 'GET' || method === 'HEAD')) {
    try { await checkDatabase(db); } catch {
      throw new HttpError(503, 'O banco de dados está indisponível. Confira a configuração e as migrações.');
    }
    return json(method === 'HEAD' ? null : { status: 'ok', database: 'ok' });
  }

  assertSameOrigin(request);
  if (path.startsWith('/api/fitness/')) {
    return handleFitness(request, env, { isAdmin: await authenticated(request, env) });
  }
  if (path === '/api/auth/status' && method === 'GET') {
    return json({ authenticated: await authenticated(request, env), required: true, configured: configuredPassword(env) });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    if (!configuredPassword(env)) await requireAuthenticated(request, env);
    const cookie = await login(request, env, await readJson(request));
    return json({ authenticated: true, required: true }, 200, { 'Set-Cookie': cookie });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    const cookie = await logout(request, env);
    return json(null, 204, { 'Set-Cookie': cookie });
  }

  await requireAuthenticated(request, env);
  const timestamp = () => new Date().toISOString();
  const today = () => todayInSaoPaulo();
  const activity = (fields) => createActivity({ ...fields, createdAt: timestamp() });

  if (path === '/api/dashboard' && method === 'GET') {
    const clients = await getClients(db);
    const settings = await getSettings(db);
    const date = today();
    const finance = await getFinance(db, clients, date);
    return json({
      today: date, timezone: TIMEZONE, demoMode: await getDemoStatus(db), clients, settings,
      ...summarize(clients, settings, date, finance.stats.salesThisMonth), finance, leads: await getLeads(db),
      activities: await getActivities(db), whatsapp: whatsappStatus(env),
    });
  }

  if (path === '/api/whatsapp/send' && method === 'POST') {
    const input = await readJson(request);
    if (!input || !['client', 'lead'].includes(input.recipientType)
      || typeof input.id !== 'string' || Object.keys(input).some((key) => !['recipientType', 'id'].includes(key))) {
      throw new ValidationError('Selecione um cliente ou interessado válido para o envio.');
    }
    const recipient = input.recipientType === 'client'
      ? (await requireClient(db, input.id)).client
      : await getLead(db, input.id);
    if (!recipient) throw new HttpError(404, 'Contato não encontrado.');
    if (!recipient.whatsappOptIn) throw new ValidationError('Marque primeiro que este contato autorizou receber mensagens pelo WhatsApp.');
    if (!recipient.phone) throw new ValidationError('Cadastre o telefone com DDD antes de enviar.');
    const settings = await getSettings(db);
    const template = input.recipientType === 'client'
      ? renewalTemplate(recipient, settings)
      : salesTemplate(recipient, settings);
    await sendWhatsAppTemplate(env, recipient.phone, template);
    const entry = activity({
      type: 'contact', clientName: recipient.name,
      description: 'Mensagem enviada à API do WhatsApp para entrega.',
      demo: input.recipientType === 'client' && (await requireClient(db, input.id)).demo,
    });
    await activityStatement(db, entry).run();
    return json({ accepted: true });
  }

  if (path === '/api/leads' && method === 'POST') {
    const lead = validateLead(await readJson(request), { today: today() });
    return json(await insertLead(db, lead, timestamp()), 201);
  }

  const leadRoute = path.match(/^\/api\/leads\/([^/]+)$/);
  if (leadRoute) {
    const id = decodeURIComponent(leadRoute[1]);
    if (method === 'PUT') {
      const existing = await getLead(db, id);
      if (!existing) throw new HttpError(404, 'Interessado não encontrado.');
      const lead = validateLead(await readJson(request), { existing, today: today() });
      return json(await updateLead(db, id, lead, timestamp()));
    }
    if (method === 'DELETE') {
      if (!(await deleteLead(db, id))) throw new HttpError(404, 'Interessado não encontrado.');
      return json(null, 204);
    }
  }

  if (path === '/api/clients' && method === 'POST') {
    const data = validateClient(await readJson(request), { today: today() });
    const client = await insertClient(db, data, timestamp(), activity({
      type: 'created', clientName: data.name, description: `Cliente cadastrado no plano ${data.plan.toLowerCase()}.`,
    }));
    return json(client, 201);
  }

  const clientRoute = path.match(/^\/api\/clients\/([^/]+)(?:\/(renew|contact))?$/);
  if (clientRoute) {
    const [, id, action] = clientRoute;
    if (!action && method === 'PUT') {
      const snapshot = await requireClient(db, id);
      const existing = snapshot.client;
      const data = validateClient(await readJson(request), { existing, today: today() });
      return json(await updateClient(db, existing.id, data, timestamp(), activity({
        type: 'updated', clientName: data.name, description: 'Dados do cliente atualizados.', demo: snapshot.demo,
      }), snapshot));
    }
    if (!action && method === 'DELETE') {
      const snapshot = await requireClient(db, id);
      const existing = snapshot.client;
      await deleteClient(db, id, activity({
        type: 'deleted', clientName: existing.name, description: 'Cliente removido do painel.', demo: snapshot.demo,
      }), snapshot);
      return json(null, 204);
    }
    if (action === 'renew' && method === 'POST') {
      const snapshot = await requireClient(db, id);
      const existing = snapshot.client;
      const renewal = renewalDetails(existing, await readJson(request), today());
      return json(await updateClient(db, id, { ...existing, ...renewal }, timestamp(), activity({
        type: 'renewed', clientName: existing.name,
        description: `Plano ${renewal.plan.toLowerCase()} renovado até ${formatDate(renewal.endDate)}.`,
        demo: snapshot.demo,
      }), snapshot, true));
    }
    if (action === 'contact' && method === 'POST') {
      const snapshot = await requireClient(db, id);
      const client = snapshot.client;
      const channel = (await readJson(request))?.channel;
      if (!['whatsapp', 'copy'].includes(channel)) throw new ValidationError('Selecione WhatsApp ou copiar mensagem.');
      const reminder = makeReminder(client, await getSettings(db), today());
      if (channel === 'whatsapp' && !reminder.whatsappUrl) {
        throw new ValidationError('Cadastre o WhatsApp do cliente antes de abrir a conversa.');
      }
      const entry = activity({
        type: 'contact', clientName: client.name,
        description: channel === 'whatsapp'
          ? 'Mensagem preparada para abrir no WhatsApp. O envio é feito manualmente.'
          : 'Mensagem preparada para copiar. O envio é feito manualmente.',
        demo: snapshot.demo,
      });
      await activityStatement(db, entry).run();
      return json({ ...reminder, activity: publicActivity(entry) });
    }
  }

  const paymentRoute = path.match(/^\/api\/contracts\/([^/]+)\/payments$/);
  if (paymentRoute && method === 'POST') {
    const contractId = decodeURIComponent(paymentRoute[1]);
    if (!(await db.prepare('SELECT id FROM contracts WHERE id = ?').bind(contractId).first())) {
      throw new HttpError(404, 'Contrato não encontrado.');
    }
    const payment = validatePayment(await readJson(request), { today: today() });
    const recorded = await addPayment(db, contractId, payment, timestamp());
    if (!recorded) throw new ValidationError('O recebimento ultrapassa o saldo que falta deste plano. Atualize os dados e tente novamente.');
    return json(recorded, 201);
  }

  const trackingRoute = path.match(/^\/api\/contracts\/([^/]+)\/tracking$/);
  if (trackingRoute && method === 'PATCH') {
    const input = await readJson(request);
    if (!input || input.status !== 'pending' || Object.keys(input).some((key) => key !== 'status')) {
      throw new ValidationError('Confirme o recebimento pendente para este contrato.');
    }
    if (!(await setContractTracking(db, decodeURIComponent(trackingRoute[1]), 'pending'))) {
      throw new HttpError(404, 'Este contrato já está sendo acompanhado ou não foi encontrado.');
    }
    return json({ status: 'pending' });
  }

  if (path === '/api/settings' && method === 'PUT') {
    const settings = validateSettings(await readJson(request), await getSettings(db));
    await saveSettings(db, settings);
    return json(settings);
  }
  if (path === '/api/demo' && method === 'DELETE') {
    await removeDemo(db);
    return json({ demoMode: false });
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, path);
    } catch (error) {
      if (error instanceof ValidationError) return json({ error: error.message }, 400);
      if (error instanceof ConcurrentWriteError) return json({ error: error.message }, 409);
      if (error instanceof WhatsAppApiError) return json({ error: error.message }, error.status);
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.headers);
      // Do not disclose SQL, schema details, tokens or environment secrets.
      return json({ error: 'Não foi possível concluir a operação. Tente novamente.' }, 500);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runWhatsAppAutomation(env, new Date(controller.scheduledTime)));
  },
};
