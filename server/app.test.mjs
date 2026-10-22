import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.mjs';

const fixedNow = () => new Date('2026-10-19T12:00:00.000Z');

async function start(options = {}) {
  const instance = createApp({ now: fixedNow, serveFrontend: false, ...options });
  const server = await new Promise((resolve) => {
    const running = instance.app.listen(0, '127.0.0.1', () => resolve(running));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...instance,
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      instance.close();
    },
    async request(path, { method = 'GET', data, raw } = {}) {
      const res = await fetch(`${base}/api${path}`, {
        method,
        headers: data !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: raw ?? (data !== undefined ? JSON.stringify(data) : undefined),
      });
      return { status: res.status, data: res.status === 204 ? null : await res.json() };
    },
  };
}

const clientInput = {
  name: 'Cliente Real', email: 'cliente@example.com', phone: '(11) 99999-9999',
  plan: 'Mensal', service: 'Treino + dieta', amount: 219,
  startDate: '2026-09-30', endDate: '2026-10-31', notes: 'Preferência de horário: manhã.',
};

test('API mantém dados reais e configuração ao limpar demonstração e reiniciar', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'marco-squad-api-'));
  const path = join(directory, 'test.sqlite');
  let api = await start({ databasePath: path });
  t.after(async () => { await api.stop(); await rm(directory, { recursive: true, force: true }); });

  assert.deepEqual(await api.request('/health'), { status: 200, data: { status: 'ok', database: 'ok' } });
  const initial = (await api.request('/dashboard')).data;
  assert.equal(initial.clients.length, 9);
  assert.equal(initial.demoMode, true);
  assert.equal(initial.today, '2026-10-19');
  assert.ok(initial.clients.every((client) => client.phone === ''));
  assert.ok(initial.reminders.every((reminder) => reminder.whatsappUrl === null));

  const created = await api.request('/clients', { method: 'POST', data: clientInput });
  assert.equal(created.status, 201);
  assert.equal(created.data.phone, '+5511999999999');
  const clientId = created.data.id;
  const settings = await api.request('/settings', { method: 'PUT', data: { businessName: 'Consultoria Teste', reminderDays: [10, 2] } });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.coachName, 'Marcos');

  const contact = await api.request(`/clients/${clientId}/contact`, { method: 'POST', data: { channel: 'whatsapp' } });
  assert.equal(contact.status, 200);
  assert.match(contact.data.activity.description, /manualmente/);
  assert.ok(!/enviada|entregue/i.test(contact.data.activity.description));
  assert.equal(new URL(contact.data.whatsappUrl).searchParams.get('text'), contact.data.message);

  const renewed = await api.request(`/clients/${clientId}/renew`, { method: 'POST', data: {} });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.data.startDate, '2026-09-30');
  assert.equal(renewed.data.endDate, '2026-11-30');

  assert.equal((await api.request('/demo', { method: 'DELETE' })).status, 200);
  const clean = (await api.request('/dashboard')).data;
  assert.equal(clean.clients.length, 1);
  assert.equal(clean.clients[0].id, clientId);
  assert.equal(clean.demoMode, false);
  assert.ok(clean.activities.some((activity) => activity.type === 'renewed'));
  assert.ok(clean.activities.every((activity) => activity.type !== 'demo'));
  assert.equal(clean.settings.businessName, 'Consultoria Teste');

  await api.stop();
  api = await start({ databasePath: path });
  const restored = (await api.request('/dashboard')).data;
  assert.equal(restored.clients.length, 1);
  assert.equal(restored.clients[0].endDate, '2026-11-30');
  assert.equal(restored.demoMode, false);
  assert.equal(restored.settings.businessName, 'Consultoria Teste');
  const updated = await api.request(`/clients/${clientId}`, { method: 'PUT', data: { name: 'Nome atualizado' } });
  assert.equal(updated.data.name, 'Nome atualizado');
  assert.equal(updated.data.amount, 219);
  assert.equal((await api.request(`/clients/${clientId}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api.request('/dashboard')).data.clients.length, 0);
});

test('API rejeita entradas inválidas e retorna erros úteis sem alterar clientes', async (t) => {
  const api = await start({ databasePath: ':memory:', seedDemo: false });
  t.after(() => api.stop());
  assert.equal((await api.request('/clients', { method: 'POST', data: { ...clientInput, endDate: '2026-02-31' } })).status, 400);
  assert.equal((await api.request('/clients', { method: 'POST', raw: '{quebrado' })).status, 400);
  assert.equal((await api.request('/clients', { method: 'POST', data: [] })).status, 400);
  assert.equal((await api.request('/clients', { method: 'POST', data: { ...clientInput, notes: 'a'.repeat(40_000) } })).status, 413);
  assert.equal((await api.request('/settings', { method: 'PUT', data: { reminderDays: [-1] } })).status, 400);
  assert.equal((await api.request('/settings', { method: 'PUT', data: { messageTemplate: 'Olá, {segredo}!' } })).status, 400);
  assert.equal((await api.request('/inexistente')).status, 404);
  assert.equal((await api.request('/clients/unknown/renew', { method: 'POST', data: {} })).status, 404);
  const dashboard = (await api.request('/dashboard')).data;
  assert.equal(dashboard.clients.length, 0);
  assert.equal(dashboard.settings.businessName, 'Marcos Squad');
  const created = (await api.request('/clients', { method: 'POST', data: { ...clientInput, phone: '' } })).data;
  assert.equal((await api.request(`/clients/${created.id}/contact`, { method: 'POST', data: { channel: 'whatsapp' } })).status, 400);
  assert.equal((await api.request(`/clients/${created.id}/contact`, { method: 'POST', data: { channel: 'copy' } })).status, 200);
});

test('financeiro registra pagamentos parciais, impede saldo negativo e separa vendas do caixa', async (t) => {
  const api = await start({ databasePath: ':memory:', seedDemo: false });
  t.after(() => api.stop());
  const created = await api.request('/clients', { method: 'POST', data: clientInput });
  const contract = (await api.request('/dashboard')).data.finance.contracts[0];
  assert.equal(contract.status, 'pending');
  assert.equal(contract.balance, 219);
  assert.equal((await api.request('/dashboard')).data.finance.stats.salesValueThisMonth, 219);
  assert.equal((await api.request('/dashboard')).data.finance.stats.receivedThisMonth, 0);

  const first = await api.request(`/contracts/${contract.id}/payments`, {
    method: 'POST', data: { amount: 100, method: 'Pix', paidAt: '2026-10-18', notes: 'Entrada' },
  });
  assert.equal(first.status, 201);
  const partial = (await api.request('/dashboard')).data.finance;
  assert.equal(partial.stats.receivedThisMonth, 100);
  assert.equal(partial.stats.pendingBalance, 119);
  assert.equal(partial.contracts[0].status, 'partial');
  assert.equal((await api.request(`/contracts/${contract.id}/payments`, {
    method: 'POST', data: { amount: 120, method: 'Pix' },
  })).status, 400);

  assert.equal((await api.request(`/contracts/${contract.id}/payments`, {
    method: 'POST', data: { amount: 119, method: 'Cartão' },
  })).status, 201);
  const settled = (await api.request('/dashboard')).data.finance;
  assert.equal(settled.stats.receivedThisMonth, 219);
  assert.equal(settled.stats.pendingBalance, 0);
  assert.equal(settled.contracts[0].status, 'paid');
  assert.equal(settled.contracts[0].payments.length, 2);
  assert.equal(created.status, 201);
});

test('agenda comercial guarda interessados, valores propostos e etapas do funil', async (t) => {
  const api = await start({ databasePath: ':memory:', seedDemo: false });
  t.after(() => api.stop());
  const created = await api.request('/leads', {
    method: 'POST', data: {
      name: 'Maria Interessada', phone: '(11) 98888-7777', plan: 'Semestral',
      service: 'Treino + dieta', amount: 997.9, followUpAt: '2026-10-20',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.phone, '+5511988887777');
  let dashboard = (await api.request('/dashboard')).data;
  assert.equal(dashboard.leads.length, 1);
  assert.equal(dashboard.leads[0].stage, 'new');
  assert.equal(dashboard.leads[0].amount, 997.9);
  const updated = await api.request(`/leads/${created.data.id}`, {
    method: 'PUT', data: { stage: 'negotiation', notes: 'Vai confirmar na sexta.' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.stage, 'negotiation');
  assert.equal(updated.data.phone, '+5511988887777');
  dashboard = (await api.request('/dashboard')).data;
  assert.equal(dashboard.leads[0].notes, 'Vai confirmar na sexta.');
  assert.equal((await api.request(`/leads/${created.data.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await api.request('/dashboard')).data.leads.length, 0);
});


test('WhatsApp internacional preserva DDI após edições parciais e formulário completo', async (t) => {
  const api = await start({ databasePath: ':memory:', seedDemo: false });
  t.after(() => api.stop());
  const created = await api.request('/clients', {
    method: 'POST', data: { ...clientInput, phone: '+1 (415) 555-0123' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.phone, '+14155550123');
  const id = created.data.id;
  const partial = await api.request(`/clients/${id}`, { method: 'PUT', data: { name: 'Cliente internacional' } });
  assert.equal(partial.status, 200);
  assert.equal(partial.data.phone, '+14155550123');
  const complete = await api.request(`/clients/${id}`, {
    method: 'PUT', data: { ...clientInput, name: partial.data.name, phone: partial.data.phone },
  });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.phone, '+14155550123');
  const contact = await api.request(`/clients/${id}/contact`, { method: 'POST', data: { channel: 'whatsapp' } });
  assert.equal(contact.status, 200);
  assert.equal(new URL(contact.data.whatsappUrl).pathname, '/14155550123');
});

test('envia modelo pela Cloud API só com autorização, sem revelar token ao painel', async (t) => {
  const outgoing = [];
  const api = await start({
    databasePath: ':memory:', seedDemo: false,
    env: {
      WHATSAPP_ACCESS_TOKEN: 'token-apenas-de-teste',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_RENEWAL_TEMPLATE: 'ms_renewal_test',
      WHATSAPP_TEMPLATE_LANGUAGE: 'pt_BR',
    },
    fetchFn: async (url, options) => {
      outgoing.push({ url, options, body: JSON.parse(options.body) });
      return Response.json({ messages: [{ id: 'wamid.test-1' }] });
    },
  });
  t.after(() => api.stop());
  const created = await api.request('/clients', { method: 'POST', data: clientInput });
  const blocked = await api.request('/whatsapp/send', {
    method: 'POST', data: { recipientType: 'client', id: created.data.id },
  });
  assert.equal(blocked.status, 400);
  assert.equal(outgoing.length, 0);

  await api.request(`/clients/${created.data.id}`, { method: 'PUT', data: { whatsappOptIn: true } });
  const sent = await api.request('/whatsapp/send', {
    method: 'POST', data: { recipientType: 'client', id: created.data.id },
  });
  assert.deepEqual(sent, { status: 200, data: { accepted: true } });
  assert.equal(outgoing[0].url, 'https://graph.facebook.com/v23.0/1234567890/messages');
  assert.equal(outgoing[0].options.headers.Authorization, 'Bearer token-apenas-de-teste');
  assert.equal(outgoing[0].body.template.name, 'ms_renewal_test');
  assert.deepEqual(outgoing[0].body.template.components[0].parameters.map((item) => item.text), [
    'Cliente', 'Mensal', 'Marcos Squad', '31/10/2026', 'R$ 219,00',
  ]);
  const dashboard = await api.request('/dashboard');
  assert.equal(dashboard.data.whatsapp.configured, true);
  assert.ok(!JSON.stringify(dashboard.data).includes('token-apenas-de-teste'));
});
