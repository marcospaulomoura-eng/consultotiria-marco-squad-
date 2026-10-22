import { formatDate } from './domain.mjs';

export class WhatsAppApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.status = status;
  }
}

export function whatsappConfig(env = {}) {
  return {
    configured: typeof env.WHATSAPP_ACCESS_TOKEN === 'string'
      && !!env.WHATSAPP_ACCESS_TOKEN.trim()
      && typeof env.WHATSAPP_PHONE_NUMBER_ID === 'string'
      && /^\d+$/.test(env.WHATSAPP_PHONE_NUMBER_ID),
    apiVersion: env.WHATSAPP_GRAPH_API_VERSION || 'v23.0',
    language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR',
    renewalTemplate: env.WHATSAPP_RENEWAL_TEMPLATE || 'marcos_squad_renovacao',
    salesTemplate: env.WHATSAPP_SALES_TEMPLATE || 'marcos_squad_retorno',
  };
}

export function whatsappStatus(env = {}) {
  const config = whatsappConfig(env);
  return {
    configured: config.configured,
    templates: { renewal: config.renewalTemplate, sales: config.salesTemplate },
    language: config.language,
  };
}

function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 11 || digits.length > 15) throw new WhatsAppApiError('O telefone precisa incluir o código do país e o DDD.', 400);
  return digits;
}

function textParameter(text) {
  return { type: 'text', text: String(text).slice(0, 1024) };
}

export function renewalTemplate(client, settings) {
  const config = {
    name: client.name.trim().split(/\s+/)[0],
    plan: client.plan,
    business: settings.businessName,
    endDate: formatDate(client.endDate),
    amount: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(client.amount),
  };
  return {
    name: 'renewal',
    parameters: [config.name, config.plan, config.business, config.endDate, config.amount].map(textParameter),
  };
}

export function salesTemplate(lead, settings) {
  const amount = lead.amount > 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.amount)
    : 'a combinar';
  return {
    name: 'sales',
    parameters: [
      lead.name.trim().split(/\s+/)[0], lead.plan, lead.service.toLowerCase(), settings.businessName, amount,
    ].map(textParameter),
  };
}

export async function sendWhatsAppTemplate(env, phone, template, { fetchFn = fetch } = {}) {
  const config = whatsappConfig(env);
  if (!config.configured) throw new WhatsAppApiError('A Cloud API do WhatsApp ainda não está configurada no servidor.', 503);
  if (!/^v\d+\.\d+$/.test(config.apiVersion)) throw new WhatsAppApiError('A versão da API da Meta está inválida.');
  const name = template.name === 'renewal' ? config.renewalTemplate : config.salesTemplate;
  const url = `https://graph.facebook.com/${config.apiVersion}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneDigits(phone),
        type: 'template',
        template: {
          name,
          language: { code: config.language },
          components: [{ type: 'body', parameters: template.parameters }],
        },
      }),
    });
  } catch {
    throw new WhatsAppApiError('Não foi possível conectar à API da Meta. Confira a configuração e tente novamente.');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  const messageId = payload?.messages?.[0]?.id;
  if (!response.ok || typeof messageId !== 'string') {
    const code = payload?.error?.code;
    const hint = code === 132001 || code === 132000
      ? ' Confira se o modelo aprovado e os parâmetros coincidem.'
      : code === 190 ? ' O token da Meta expirou ou não tem permissão.' : '';
    throw new WhatsAppApiError(`A Meta não aceitou o envio (HTTP ${response.status}).${hint}`);
  }
  return { messageId };
}
