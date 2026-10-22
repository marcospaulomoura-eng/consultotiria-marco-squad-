import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.mjs';
import { fitnessMiddleware } from './fitness-local.mjs';
import {
  TIMEZONE, ValidationError, todayInSaoPaulo, validateClient, validateSettings, validatePayment, validateLead,
  summarize, renewalDetails, makeReminder, formatDate,
} from './domain.mjs';
import {
  openDatabase, transaction, initializeDatabase, getClient, getClients, getSettings,
  saveSettings, getDemoStatus, isDemoClient, getActivities, addActivity, insertClient, updateClient,
  addContract, getFinance, setContractTracking, addPayment, getLeads, getLead, insertLead, updateLead, deleteLead,
} from './database.mjs';
import { WhatsAppApiError, sendWhatsAppTemplate, whatsappStatus, renewalTemplate, salesTemplate } from './whatsapp.mjs';

export function createApp({ databasePath, now = () => new Date(), seedDemo = true, serveFrontend = true, authOptions, env = process.env, fetchFn = fetch } = {}) {
  const db = openDatabase(databasePath);
  const timestamp = () => now().toISOString();
  const today = () => todayInSaoPaulo(now());
  initializeDatabase(db, today(), timestamp(), seedDemo);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/fitness/feed', express.json({ limit: '300kb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const auth = createAuth(db, { ...authOptions, now });
  app.use('/api/fitness', fitnessMiddleware(db, auth, now));
  app.use('/api/auth', auth.router);
  app.use('/api', auth.middleware);

  const requireClient = (id) => {
    const client = getClient(db, id);
    if (!client) {
      const error = new Error('Cliente não encontrado.');
      error.status = 404;
      throw error;
    }
    return client;
  };

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'ok' });
  });

  app.get('/api/dashboard', (_req, res) => {
    const clients = getClients(db);
    const settings = getSettings(db);
    const date = today();
    const finance = getFinance(db, clients, date);
    res.json({
      today: date, timezone: TIMEZONE, demoMode: getDemoStatus(db), clients, settings,
      ...summarize(clients, settings, date, finance.stats.salesThisMonth), finance, leads: getLeads(db),
      activities: getActivities(db), whatsapp: whatsappStatus(env),
    });
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    const input = req.body;
    if (!input || !['client', 'lead'].includes(input.recipientType) || typeof input.id !== 'string'
      || Object.keys(input).some((key) => !['recipientType', 'id'].includes(key))) {
      throw new ValidationError('Selecione um cliente ou interessado válido para o envio.');
    }
    const recipient = input.recipientType === 'client' ? requireClient(input.id) : getLead(db, input.id);
    if (!recipient) {
      const error = new Error('Contato não encontrado.');
      error.status = 404;
      throw error;
    }
    if (!recipient.whatsappOptIn) throw new ValidationError('Marque primeiro que este contato autorizou receber mensagens pelo WhatsApp.');
    if (!recipient.phone) throw new ValidationError('Cadastre o telefone com DDD antes de enviar.');
    const settings = getSettings(db);
    const template = input.recipientType === 'client'
      ? renewalTemplate(recipient, settings)
      : salesTemplate(recipient, settings);
    await sendWhatsAppTemplate(env, recipient.phone, template, { fetchFn });
    addActivity(db, {
      type: 'contact', clientName: recipient.name,
      description: 'Mensagem enviada à API do WhatsApp para entrega.',
      createdAt: timestamp(), demo: input.recipientType === 'client' && isDemoClient(db, input.id),
    });
    res.json({ accepted: true });
  });

  app.post('/api/leads', (req, res) => {
    const lead = validateLead(req.body, { today: today() });
    res.status(201).json(insertLead(db, lead, timestamp()));
  });

  app.put('/api/leads/:id', (req, res) => {
    const existing = getLead(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Interessado não encontrado.' });
    const lead = validateLead(req.body, { existing, today: today() });
    res.json(updateLead(db, req.params.id, lead, timestamp()));
  });

  app.delete('/api/leads/:id', (req, res) => {
    if (!deleteLead(db, req.params.id)) return res.status(404).json({ error: 'Interessado não encontrado.' });
    res.status(204).end();
  });

  app.post('/api/clients', (req, res) => {
    const data = validateClient(req.body, { today: today() });
    const client = transaction(db, () => {
      const created = insertClient(db, data, { now: timestamp() });
      addActivity(db, { type: 'created', clientName: created.name, description: `Cliente cadastrado no plano ${created.plan.toLowerCase()}.`, createdAt: timestamp() });
      addContract(db, created, { soldAt: timestamp() });
      return created;
    });
    res.status(201).json(client);
  });

  app.put('/api/clients/:id', (req, res) => {
    const existing = requireClient(req.params.id);
    const data = validateClient(req.body, { existing, today: today() });
    const client = transaction(db, () => {
      const updated = updateClient(db, existing.id, data, timestamp());
      addActivity(db, {
        type: 'updated', clientName: updated.name, description: 'Dados do cliente atualizados.',
        createdAt: timestamp(), demo: isDemoClient(db, existing.id),
      });
      return updated;
    });
    res.json(client);
  });

  app.post('/api/contracts/:id/payments', (req, res) => {
    const contract = db.prepare('SELECT id FROM contracts WHERE id = ?').get(req.params.id);
    if (!contract) {
      const error = new Error('Contrato não encontrado.');
      error.status = 404;
      throw error;
    }
    const payment = validatePayment(req.body, { today: today() });
    const recorded = transaction(db, () => addPayment(db, req.params.id, payment, timestamp()));
    if (!recorded) throw new ValidationError('O recebimento ultrapassa o saldo que falta deste plano. Atualize os dados e tente novamente.');
    res.status(201).json(recorded);
  });

  app.patch('/api/contracts/:id/tracking', (req, res) => {
    if (!req.body || req.body.status !== 'pending' || Object.keys(req.body).some((key) => key !== 'status')) {
      throw new ValidationError('Confirme o recebimento pendente para este contrato.');
    }
    if (!setContractTracking(db, req.params.id, 'pending')) {
      const error = new Error('Este contrato já está sendo acompanhado ou não foi encontrado.');
      error.status = 404;
      throw error;
    }
    res.json({ status: 'pending' });
  });

  app.delete('/api/clients/:id', (req, res) => {
    const existing = requireClient(req.params.id);
    transaction(db, () => {
      const demo = isDemoClient(db, existing.id);
      db.prepare('DELETE FROM clients WHERE id = ?').run(existing.id);
      addActivity(db, { type: 'deleted', clientName: existing.name, description: 'Cliente removido do painel.', createdAt: timestamp(), demo });
    });
    res.status(204).end();
  });

  app.post('/api/clients/:id/renew', (req, res) => {
    const existing = requireClient(req.params.id);
    const renewal = renewalDetails(existing, req.body ?? {}, today());
    const client = transaction(db, () => {
      const updated = updateClient(db, existing.id, { ...existing, ...renewal }, timestamp());
      addActivity(db, {
        type: 'renewed', clientName: updated.name,
        description: `Plano ${updated.plan.toLowerCase()} renovado até ${formatDate(updated.endDate)}.`,
        createdAt: timestamp(), demo: isDemoClient(db, existing.id),
      });
      if (!isDemoClient(db, existing.id)) addContract(db, updated, { soldAt: timestamp() });
      return updated;
    });
    res.json(client);
  });

  app.post('/api/clients/:id/contact', (req, res) => {
    const client = requireClient(req.params.id);
    const channel = req.body?.channel;
    if (!['whatsapp', 'copy'].includes(channel)) throw new ValidationError('Selecione WhatsApp ou copiar mensagem.');
    const reminder = makeReminder(client, getSettings(db), today());
    if (channel === 'whatsapp' && !reminder.whatsappUrl) throw new ValidationError('Cadastre o WhatsApp do cliente antes de abrir a conversa.');
    const activity = addActivity(db, {
      type: 'contact', clientName: client.name,
      description: channel === 'whatsapp'
        ? 'Mensagem preparada para abrir no WhatsApp. O envio é feito manualmente.'
        : 'Mensagem preparada para copiar. O envio é feito manualmente.',
      createdAt: timestamp(), demo: isDemoClient(db, client.id),
    });
    res.json({ ...reminder, activity });
  });

  app.put('/api/settings', (req, res) => {
    const settings = validateSettings(req.body, getSettings(db));
    saveSettings(db, settings);
    res.json(settings);
  });

  app.delete('/api/demo', (_req, res) => {
    transaction(db, () => {
      db.prepare('DELETE FROM clients WHERE is_demo = 1').run();
      db.prepare('DELETE FROM activities WHERE is_demo = 1').run();
    });
    res.json({ demoMode: false });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  const frontendPath = fileURLToPath(new URL('../dist', import.meta.url));
  if (serveFrontend && existsSync(`${frontendPath}/index.html`)) {
    app.use(express.static(frontendPath));
    app.get('/{*path}', (_req, res) => res.sendFile(`${frontendPath}/index.html`));
  }

  app.use((error, _req, res, _next) => {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    if (error instanceof WhatsAppApiError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Os dados enviados excedem o tamanho permitido.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'O JSON enviado é inválido.' });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('Erro interno na API:', error.message);
    return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
  });

  return { app, db, close: () => db.close() };
}
