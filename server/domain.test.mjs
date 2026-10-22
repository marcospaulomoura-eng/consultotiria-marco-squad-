import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, todayInSaoPaulo, validDate, addDays, daysBetween, addMonths,
  validateClient, validateLead, validateSettings, summarize, summarizeFinance, validatePayment, renewalDetails, renderMessage, normalizePhone,
} from './domain.mjs';

const baseClient = {
  id: 'client-1', name: 'Ana da Silva', email: 'ana@example.com', phone: '5511999999999',
  plan: 'Mensal', service: 'Treino + dieta', amount: 219, startDate: '2026-09-19',
  endDate: '2026-10-19', notes: '',
};

test('datas seguem São Paulo e aritmética não depende da timezone do processo', () => {
  assert.equal(todayInSaoPaulo(new Date('2026-10-19T01:00:00Z')), '2026-10-18');
  assert.equal(todayInSaoPaulo(new Date('2026-10-19T03:00:00Z')), '2026-10-19');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-2-01'), false);
});

test('renovação preserva fim do mês e usa vencimento ou hoje como base', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(renewalDetails({ ...baseClient, endDate: '2026-10-31' }, {}, '2026-10-19').endDate, '2026-11-30');
  assert.equal(renewalDetails({ ...baseClient, endDate: '2026-10-01' }, {}, '2026-10-19').endDate, '2026-11-19');
  assert.equal(renewalDetails(baseClient, { plan: 'Trimestral' }, '2026-10-19').endDate, '2027-01-19');
  assert.throws(() => renewalDetails(baseClient, { endDate: '2026-10-18' }, '2026-10-19'), /posterior/);
});

test('renovação antecipada preserva atividade e receita; contratos futuros e vencidos mantêm a data correta', () => {
  const today = '2026-10-19';
  const active = { ...baseClient, endDate: '2026-10-31' };
  const renewed = { ...active, ...renewalDetails(active, {}, today) };
  assert.equal(renewed.startDate, active.startDate);
  assert.equal(renewed.endDate, '2026-11-30');
  const result = summarize([renewed], DEFAULT_SETTINGS, today);
  assert.equal(result.stats.activeClients, 1);
  assert.equal(result.stats.monthlyForecast, 219);

  const future = { ...baseClient, startDate: '2026-10-28', endDate: '2026-11-28' };
  const futureRenewed = { ...future, ...renewalDetails(future, {}, today) };
  assert.equal(futureRenewed.startDate, '2026-10-28');
  assert.equal(summarize([futureRenewed], DEFAULT_SETTINGS, today).stats.activeClients, 0);

  const overdue = { ...baseClient, endDate: '2026-10-01' };
  assert.equal(renewalDetails(overdue, {}, today).startDate, today);
  assert.equal(renewalDetails(baseClient, {}, today).startDate, baseClient.startDate);
});

test('alertas incluem atrasados, hoje e limite da janela; receita considera contratos ativos', () => {
  const clients = [
    { ...baseClient, id: 'late', endDate: '2026-10-18' },
    { ...baseClient, id: 'today', endDate: '2026-10-19' },
    { ...baseClient, id: 'boundary', plan: 'Trimestral', amount: 600, endDate: '2026-10-26' },
    { ...baseClient, id: 'outside', endDate: '2026-10-27' },
    { ...baseClient, id: 'future', startDate: '2026-10-28', endDate: '2026-11-28' },
  ];
  const result = summarize(clients, DEFAULT_SETTINGS, '2026-10-19');
  assert.deepEqual(result.reminders.map((item) => [item.clientId, item.status]), [
    ['late', 'overdue'], ['today', 'today'], ['boundary', 'upcoming'],
  ]);
  assert.deepEqual(result.stats, { activeClients: 3, salesThisMonth: 0, monthlyForecast: 638, dueSoon: 2, overdue: 1 });
});

test('lembrete no dia aceita zero e inclui somente hoje e atrasados na janela', () => {
  const settings = validateSettings({ reminderDays: [0] });
  assert.deepEqual(settings.reminderDays, [0]);
  const result = summarize([
    { ...baseClient, id: 'overdue', endDate: '2026-10-18' },
    { ...baseClient, id: 'today', endDate: '2026-10-19' },
    { ...baseClient, id: 'tomorrow', endDate: '2026-10-20' },
  ], settings, '2026-10-19');
  assert.deepEqual(result.reminders.map((item) => item.clientId), ['overdue', 'today']);
  assert.equal(result.stats.dueSoon, 1);
  assert.equal(result.stats.overdue, 1);
});

test('mensagem interpola valores e link preserva acentos, emojis e caracteres especiais', () => {
  const client = { ...baseClient, name: 'João Silva' };
  const result = summarize([client], DEFAULT_SETTINGS, '2026-10-19');
  const reminder = result.reminders[0];
  assert.match(reminder.message, /Olá, João!/);
  assert.match(reminder.message, /19\/10\/2026/);
  assert.match(reminder.message, /219,00/);
  assert.equal(new URL(reminder.whatsappUrl).searchParams.get('text'), reminder.message);
  assert.equal(summarize([{ ...client, phone: '' }], DEFAULT_SETTINGS, '2026-10-19').reminders[0].whatsappUrl, null);
  assert.equal(renderMessage(client, { ...DEFAULT_SETTINGS, messageTemplate: '{treinador}: {dias}' }, '2026-10-18'), 'Marcos: 1');
});

test('validações impedem datas impossíveis, valores inválidos e configurações não suportadas', () => {
  const { id: _id, ...clientInput } = baseClient;
  assert.equal(validateClient(clientInput).amount, 219);
  assert.equal(validateClient({ amount: 199.999 }, { existing: baseClient }).amount, 200);
  assert.equal(normalizePhone('(11) 99999-9999'), '+5511999999999');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(normalizePhone('+1 (415) 555-0123')), '+14155550123');
  assert.equal(normalizePhone('+1 (415) 555-0123'), '+14155550123');
  assert.equal(normalizePhone('+351 912 345 678'), '+351912345678');
  assert.throws(() => validateClient({ ...clientInput, endDate: '2026-02-30' }), /datas válidas/);
  assert.throws(() => validateClient({ ...clientInput, amount: -1 }), /valor/);
  assert.throws(() => validateClient({ ...clientInput, name: ' ' }), /obrigatório/);
  assert.throws(() => validateClient({ ...clientInput, plan: 'toString' }), /plano válido/);
  assert.throws(() => validateClient({ ...clientInput, phone: 'abc11999999999' }), /WhatsApp válido/);
  assert.throws(() => validateSettings({ reminderDays: [-1, 3] }), /lembrete/);
  assert.throws(() => validateSettings({ messageTemplate: '{senha}' }), /desconhecida/);
  assert.throws(() => validateSettings({ messageTemplate: '{nome' }), /chaves/);
  assert.deepEqual(validateSettings({ reminderDays: [1, 7, 3, 7] }).reminderDays, [7, 3, 1]);
});

test('controle financeiro separa venda, recebimentos, previsão e saldo não confirmado', () => {
  const client = { ...baseClient, id: 'c-1', amount: 600, plan: 'Trimestral', startDate: '2026-10-01', endDate: '2026-12-31' };
  const contracts = [
    {
      id: 'k-1', clientId: 'c-1', clientName: client.name, plan: 'Trimestral', service: 'Treino + dieta',
      amount: 600, soldAt: '2026-10-04T12:00:00.000Z', received: 150, balance: 450, status: 'partial',
      payments: [{ id: 'p-1', amount: 150, method: 'Pix', paidAt: '2026-10-18', notes: '', createdAt: '2026-10-18T12:00:00Z' }],
    },
    {
      id: 'k-2', clientId: 'old', clientName: 'Outro aluno', plan: 'Mensal', service: 'Treino',
      amount: 219, soldAt: '2026-09-03T12:00:00.000Z', received: 0, balance: null, status: 'unconfirmed', payments: [],
    },
  ];
  const result = summarizeFinance([client], contracts, '2026-10-19');
  assert.equal(result.stats.salesThisMonth, 1);
  assert.equal(result.stats.salesValueThisMonth, 600);
  assert.equal(result.stats.receivedThisMonth, 150);
  assert.equal(result.stats.monthlyForecast, 200);
  assert.equal(result.stats.pendingBalance, 450);
  assert.equal(result.stats.unconfirmedContracts, 1);
  assert.equal(result.months.at(-1).receivedValue, 150);
  assert.equal(result.months.at(-1).salesCount, 1);
});

test('pagamentos exigem valor positivo, método permitido e data não futura', () => {
  assert.deepEqual(validatePayment({ amount: 99.999, method: 'Pix' }, { today: '2026-10-19' }), {
    amount: 100, method: 'Pix', paidAt: '2026-10-19', notes: '',
  });
  assert.throws(() => validatePayment({ amount: 0, method: 'Pix' }), /maior que zero/);
  assert.throws(() => validatePayment({ amount: 10, method: 'Cripto' }), /forma de pagamento/);
  assert.throws(() => validatePayment({ amount: 10, method: 'Pix', paidAt: '2026-10-20' }, { today: '2026-10-19' }), /futuro/);
  assert.throws(() => validatePayment({ amount: 10, method: 'Pix', other: 'x' }), /desconhecido/);
});

test('leads exigem WhatsApp e guardam proposta, etapa e data de retorno', () => {
  const lead = validateLead({
    name: 'Maria Interessada', phone: '(11) 98888-7777', plan: 'Semestral',
    service: 'Treino + dieta', amount: 997.9, followUpAt: '2026-10-21',
  }, { today: '2026-10-19' });
  assert.deepEqual(lead, {
    name: 'Maria Interessada', phone: '+5511988887777', plan: 'Semestral',
    service: 'Treino + dieta', amount: 997.9, stage: 'new', followUpAt: '2026-10-21', notes: '', whatsappOptIn: false,
  });
  assert.throws(() => validateLead({ name: 'Sem telefone', plan: 'Mensal', service: 'Treino' }), /WhatsApp/);
  assert.throws(() => validateLead({ name: 'Maria', phone: '11988887777', stage: 'qualificado' }), /etapa/);
});
