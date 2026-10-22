import { daysBetween, todayInSaoPaulo } from '../server/domain.mjs';
import { clientFromRow, getSettings } from './storage.mjs';
import {
  sendWhatsAppTemplate, whatsappConfig, renewalTemplate, salesTemplate,
} from '../server/whatsapp.mjs';

async function claimDispatch(db, key, timestamp) {
  const result = await db.prepare(`INSERT INTO whatsapp_dispatches
    (dispatch_key, status, provider_message_id, created_at, updated_at)
    VALUES (?, 'sending', '', ?, ?)
    ON CONFLICT(dispatch_key) DO UPDATE SET status = 'sending', updated_at = excluded.updated_at
    WHERE whatsapp_dispatches.status = 'failed'`).bind(key, timestamp, timestamp).run();
  return result.meta.changes === 1;
}

async function dispatch(db, env, { key, phone, template, timestamp, fetchFn }) {
  const old = await db.prepare('SELECT status FROM whatsapp_dispatches WHERE dispatch_key = ?').bind(key).first();
  if (old && old.status !== 'failed') return false;
  if (!(await claimDispatch(db, key, timestamp))) return false;
  try {
    const result = await sendWhatsAppTemplate(env, phone, template, { fetchFn });
    await db.prepare(`UPDATE whatsapp_dispatches SET status = 'sent', provider_message_id = ?, updated_at = ?
      WHERE dispatch_key = ? AND status = 'sending'`).bind(result.messageId, timestamp, key).run();
  } catch {
    await db.prepare(`UPDATE whatsapp_dispatches SET status = 'failed', updated_at = ?
      WHERE dispatch_key = ? AND status = 'sending'`).bind(timestamp, key).run();
  }
  return true;
}

export async function runWhatsAppAutomation(env, now = new Date(), { fetchFn = fetch } = {}) {
  if (!env?.DB?.prepare || !whatsappConfig(env).configured) return { sent: 0 };
  const db = env.DB;
  const today = todayInSaoPaulo(now);
  const timestamp = now.toISOString();
  const settings = await getSettings(db);
  const clientRows = await db.prepare(`SELECT * FROM clients
    WHERE is_demo = 0 AND whatsapp_opt_in = 1 AND phone <> '' AND start_date <= ? AND end_date >= ?`).bind(today, today).all();
  const leadRows = await db.prepare(`SELECT * FROM leads
    WHERE whatsapp_opt_in = 1 AND phone <> '' AND stage IN ('new', 'contacted', 'negotiation') AND follow_up_at <= ?`).bind(today).all();
  let sent = 0;

  for (const row of clientRows.results) {
    const client = clientFromRow(row);
    const daysUntil = daysBetween(today, client.endDate);
    if (daysUntil < 0) continue;
    for (const targetDay of settings.reminderDays) {
      const key = `renewal:${client.id}:${client.endDate}:${targetDay}`;
      if (daysUntil !== targetDay) {
        const old = await db.prepare('SELECT status FROM whatsapp_dispatches WHERE dispatch_key = ?').bind(key).first();
        if (old?.status !== 'failed') continue;
      }
      if (await dispatch(db, env, {
        key, phone: client.phone, template: renewalTemplate(client, settings), timestamp, fetchFn,
      })) sent += 1;
    }
  }

  for (const row of leadRows.results) {
    const lead = {
      id: row.id, name: row.name, phone: row.phone, plan: row.plan, service: row.service,
      amount: row.amount_cents / 100, stage: row.stage, followUpAt: row.follow_up_at,
      whatsappOptIn: row.whatsapp_opt_in === 1,
    };
    const key = `lead:${lead.id}:${lead.followUpAt}`;
    if (await dispatch(db, env, {
      key, phone: lead.phone, template: salesTemplate(lead, settings), timestamp, fetchFn,
    })) sent += 1;
  }

  return { sent };
}
