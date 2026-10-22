export const TIMEZONE = 'America/Sao_Paulo';
export const PLANS = Object.freeze({ Mensal: 1, Trimestral: 3, Quadrimestral: 4, Semestral: 6, Anual: 12 });
export const SERVICES = ['Treino + dieta', 'Treino', 'Dieta'];
export const DEFAULT_SETTINGS = Object.freeze({
  businessName: 'Marcos Squad',
  coachName: 'Marcos',
  reminderDays: [7, 3, 1],
  messageTemplate: 'Olá, {nome}! 💛 Seu plano {plano} da {consultoria} vence em {vencimento}. Vamos renovar para manter seu treino e sua dieta em dia? O investimento é de {valor}. Me avise por aqui e eu cuido de tudo para você!',
});
const DAY_MS = 86_400_000;
const KNOWN_VARIABLES = new Set(['nome', 'plano', 'consultoria', 'vencimento', 'valor', 'treinador', 'dias']);

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

export function todayInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function monthRangeInSaoPaulo(date) {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  const nextMonth = month === 12 ? [year + 1, 1] : [year, month + 1];
  const midnightUtc = (targetYear, targetMonth) => {
    const localMidnightAsUtc = Date.UTC(targetYear, targetMonth - 1, 1);
    const probe = new Date(Date.UTC(targetYear, targetMonth - 1, 1, 12));
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(probe);
    const part = (type) => Number(parts.find((item) => item.type === type).value);
    const zonedAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    return new Date(localMidnightAsUtc - (zonedAsUtc - probe.getTime())).toISOString();
  };
  return [midnightUtc(year, month), midnightUtc(...nextMonth)];
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= '1900-01-01' && value <= '2200-12-31';
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date, count) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

export function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function objectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Envie os dados em um objeto JSON.');
}

function textInput(value, label, max, required = false) {
  if (typeof value !== 'string') throw new ValidationError(`${label} deve ser um texto.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ValidationError(`${label} é obrigatório.`);
  if (trimmed.length > max) throw new ValidationError(`${label} deve ter até ${max} caracteres.`);
  return trimmed;
}

export function normalizePhone(value) {
  const phone = textInput(value, 'WhatsApp', 30);
  if (!phone) return '';
  if (!/^\+?[\d\s().-]+$/.test(phone)) throw new ValidationError('Informe um WhatsApp válido com DDD.');
  let digits = phone.replace(/\D/g, '');
  if (!phone.startsWith('+') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  if (digits.length < 11 || digits.length > 15 || digits.startsWith('0')) {
    throw new ValidationError('Informe um WhatsApp válido com DDD e código do país.');
  }
  return `+${digits}`;
}

function amountInput(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new ValidationError('O valor deve ser um número entre R$ 0 e R$ 1.000.000.');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validateClient(input, { existing, today = todayInSaoPaulo() } = {}) {
  objectInput(input);
  const allowed = ['name', 'email', 'phone', 'plan', 'service', 'amount', 'startDate', 'endDate', 'notes', 'whatsappOptIn'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError(`Campo de cliente desconhecido: ${key}.`);
  }
  const merged = { email: '', phone: '', notes: '', startDate: today, service: 'Treino + dieta', whatsappOptIn: false, ...existing, ...input };
  const output = {
    name: textInput(merged.name, 'Nome', 120, true),
    email: textInput(merged.email, 'E-mail', 254),
    phone: normalizePhone(merged.phone),
    plan: merged.plan,
    service: merged.service,
    amount: amountInput(merged.amount),
    startDate: merged.startDate,
    endDate: merged.endDate,
    notes: textInput(merged.notes, 'Observações', 3000),
    whatsappOptIn: merged.whatsappOptIn,
  };
  if (typeof output.whatsappOptIn !== 'boolean') throw new ValidationError('Confirme a autorização de mensagens pelo WhatsApp.');
  if (output.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(output.email)) throw new ValidationError('Informe um e-mail válido.');
  if (!Object.hasOwn(PLANS, output.plan)) throw new ValidationError('Selecione um plano válido.');
  if (!SERVICES.includes(output.service)) throw new ValidationError('Selecione um serviço válido.');
  if (!validDate(output.startDate) || !validDate(output.endDate)) throw new ValidationError('Informe datas válidas no formato AAAA-MM-DD.');
  if (output.endDate < output.startDate) throw new ValidationError('O vencimento deve ser igual ou posterior ao início do plano.');
  return output;
}

export function validateLead(input, { existing, today = todayInSaoPaulo() } = {}) {
  objectInput(input);
  const allowed = ['name', 'phone', 'plan', 'service', 'amount', 'stage', 'followUpAt', 'notes', 'whatsappOptIn'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError(`Campo de interessado desconhecido: ${key}.`);
  }
  const merged = {
    phone: '', plan: 'Mensal', service: 'Treino + dieta', amount: 0,
    stage: 'new', followUpAt: today, notes: '', whatsappOptIn: false, ...existing, ...input,
  };
  const lead = {
    name: textInput(merged.name, 'Nome', 120, true),
    phone: normalizePhone(merged.phone), plan: merged.plan, service: merged.service,
    amount: amountInput(merged.amount), stage: merged.stage,
    followUpAt: merged.followUpAt, notes: textInput(merged.notes, 'Observações', 1000),
    whatsappOptIn: merged.whatsappOptIn,
  };
  if (typeof lead.whatsappOptIn !== 'boolean') throw new ValidationError('Confirme a autorização de mensagens pelo WhatsApp.');
  if (!lead.phone) throw new ValidationError('Informe o WhatsApp do interessado com DDD.');
  if (!Object.hasOwn(PLANS, lead.plan)) throw new ValidationError('Selecione um plano válido.');
  if (!SERVICES.includes(lead.service)) throw new ValidationError('Selecione um serviço válido.');
  if (!['new', 'contacted', 'negotiation', 'won', 'lost'].includes(lead.stage)) throw new ValidationError('Selecione uma etapa válida para o interessado.');
  if (!validDate(lead.followUpAt)) throw new ValidationError('Informe uma data válida para o próximo contato.');
  return lead;
}

export function validateSettings(input, existing = DEFAULT_SETTINGS) {
  objectInput(input);
  const allowed = ['businessName', 'coachName', 'reminderDays', 'messageTemplate'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError(`Configuração desconhecida: ${key}.`);
  }
  const merged = { ...existing, ...input };
  const result = {
    businessName: textInput(merged.businessName, 'Nome da consultoria', 100, true),
    coachName: textInput(merged.coachName, 'Nome do treinador', 100, true),
    messageTemplate: textInput(merged.messageTemplate, 'Mensagem', 3000, true),
  };
  if (!Array.isArray(merged.reminderDays) || merged.reminderDays.length < 1 || merged.reminderDays.length > 10
    || merged.reminderDays.some((day) => !Number.isInteger(day) || day < 0 || day > 90)) {
    throw new ValidationError('Informe entre 1 e 10 dias de lembrete, de 0 a 90. Use 0 para lembrar no dia do vencimento.');
  }
  result.reminderDays = [...new Set(merged.reminderDays)].sort((a, b) => b - a);
  const vars = result.messageTemplate.matchAll(/\{([^{}]*)\}/g);
  for (const match of vars) {
    if (!KNOWN_VARIABLES.has(match[1])) throw new ValidationError(`Variável de mensagem desconhecida: {${match[1]}}.`);
  }
  const withoutVariables = result.messageTemplate.replace(/\{[^{}]*\}/g, '');
  if (/[{}]/.test(withoutVariables)) throw new ValidationError('Revise as chaves das variáveis da mensagem.');
  return result;
}

const PAYMENT_METHODS = ['Pix', 'Transferência', 'Dinheiro', 'Cartão', 'Outro'];

export function validatePayment(input, { today = todayInSaoPaulo() } = {}) {
  objectInput(input);
  const allowed = ['amount', 'method', 'paidAt', 'notes'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError(`Campo de pagamento desconhecido: ${key}.`);
  }
  const amount = amountInput(input.amount);
  if (amount <= 0) throw new ValidationError('Informe um valor de recebimento maior que zero.');
  const paidAt = input.paidAt ?? today;
  if (!validDate(paidAt) || paidAt > today) throw new ValidationError('A data do recebimento deve ser válida e não pode estar no futuro.');
  if (!PAYMENT_METHODS.includes(input.method)) throw new ValidationError('Selecione uma forma de pagamento válida.');
  return {
    amount, method: input.method, paidAt,
    notes: textInput(input.notes ?? '', 'Observação', 500),
  };
}

export function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

export function formatMoney(amount) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
}

export function renderMessage(client, settings, today) {
  const values = {
    nome: client.name.split(' ')[0], plano: client.plan.toLowerCase(), consultoria: settings.businessName,
    vencimento: formatDate(client.endDate), valor: formatMoney(client.amount), treinador: settings.coachName,
    dias: String(daysBetween(today, client.endDate)),
  };
  return settings.messageTemplate.replace(/\{([^{}]+)\}/g, (_, key) => values[key] ?? '');
}

export function makeReminder(client, settings, today) {
  const daysUntil = daysBetween(today, client.endDate);
  const message = renderMessage(client, settings, today);
  return {
    id: `${client.id}:${client.endDate}`, clientId: client.id, clientName: client.name,
    endDate: client.endDate, daysUntil,
    status: daysUntil < 0 ? 'overdue' : daysUntil === 0 ? 'today' : 'upcoming',
    message,
    whatsappUrl: client.phone ? `https://wa.me/${client.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}` : null,
  };
}

export function summarize(clients, settings, today, salesThisMonth = 0) {
  const maxDays = Math.max(...settings.reminderDays);
  const active = clients.filter((client) => client.startDate <= today && client.endDate >= today);
  const reminders = clients.filter((client) => daysBetween(today, client.endDate) <= maxDays)
    .map((client) => makeReminder(client, settings, today))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.clientName.localeCompare(b.clientName, 'pt-BR'));
  return {
    reminders,
    stats: {
      activeClients: active.length,
      salesThisMonth,
      monthlyForecast: Math.round(active.reduce((sum, client) => sum + client.amount / PLANS[client.plan], 0) * 100) / 100,
      dueSoon: reminders.filter((item) => item.daysUntil >= 0).length,
      overdue: reminders.filter((item) => item.daysUntil < 0).length,
    },
  };
}

export function summarizeFinance(clients, contracts, today) {
  const month = today.slice(0, 7);
  const within = (date, period) => {
    const [start, end] = monthRangeInSaoPaulo(`${period}-01`).map(Date.parse);
    const time = Date.parse(date);
    return Number.isFinite(time) && time >= start && time < end;
  };
  const periods = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - offset);
    periods.push(date.toISOString().slice(0, 7));
  }
  const salesForMonth = (period) => contracts.filter((contract) => within(contract.soldAt, period));
  const payments = contracts.flatMap((contract) => contract.payments);
  const contractedClientIds = new Set(contracts.map((contract) => contract.clientId));
  const monthlyForecast = clients
    .filter((client) => contractedClientIds.has(client.id) && client.startDate <= today && client.endDate >= today)
    .reduce((total, client) => total + client.amount / PLANS[client.plan], 0);
  return {
    stats: {
      salesThisMonth: salesForMonth(month).length,
      salesValueThisMonth: Math.round(salesForMonth(month).reduce((sum, contract) => sum + contract.amount, 0) * 100) / 100,
      receivedThisMonth: Math.round(payments.filter((payment) => payment.paidAt.startsWith(month))
        .reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100,
      monthlyForecast: Math.round(monthlyForecast * 100) / 100,
      pendingBalance: Math.round(contracts.reduce((sum, contract) => sum + (contract.balance ?? 0), 0) * 100) / 100,
      unconfirmedContracts: contracts.filter((contract) => contract.status === 'unconfirmed').length,
    },
    months: periods.map((period) => {
      const sales = salesForMonth(period);
      return {
        month: period,
        salesCount: sales.length,
        salesValue: Math.round(sales.reduce((sum, contract) => sum + contract.amount, 0) * 100) / 100,
        receivedValue: Math.round(payments.filter((payment) => payment.paidAt.startsWith(period))
          .reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100,
      };
    }),
    contracts,
  };
}

export function renewalDetails(client, input, today) {
  objectInput(input);
  for (const key of Object.keys(input)) {
    if (!['plan', 'amount', 'endDate'].includes(key)) throw new ValidationError(`Campo de renovação desconhecido: ${key}.`);
  }
  const plan = input.plan ?? client.plan;
  if (!Object.hasOwn(PLANS, plan)) throw new ValidationError('Selecione um plano válido.');
  const amount = amountInput(input.amount ?? client.amount);
  const base = client.endDate > today ? client.endDate : today;
  const endDate = input.endDate ?? addMonths(base, PLANS[plan]);
  if (!validDate(endDate) || endDate <= base) throw new ValidationError('O novo vencimento deve ser posterior ao vencimento atual e à data de hoje.');
  const startDate = client.endDate >= today ? client.startDate : today;
  return { plan, amount, startDate, endDate };
}
