import { DEFAULT_SETTINGS, monthRangeInSaoPaulo, summarizeFinance } from '../server/domain.mjs';

export class ConcurrentWriteError extends Error {
  constructor() {
    super('Este cliente foi alterado em outra solicitação. Atualize o painel e tente novamente.');
    this.name = 'ConcurrentWriteError';
  }
}

export function clientFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone,
    plan: row.plan, service: row.service, amount: row.amount_cents / 100,
    startDate: row.start_date, endDate: row.end_date, notes: row.notes,
    whatsappOptIn: row.whatsapp_opt_in === 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function initializeSettings(db) {
  // Never overwrite settings on deploy or on the first request to a new isolate.
  await db.prepare('INSERT OR IGNORE INTO settings (id, value) VALUES (1, ?)')
    .bind(JSON.stringify(DEFAULT_SETTINGS)).run();
}

export async function checkDatabase(db) {
  if (!db?.prepare) throw new Error('Database binding unavailable');
  // Check the actual binding and migration, rather than just Worker availability.
  await db.prepare('SELECT (SELECT 1 FROM settings LIMIT 1) AS settings, (SELECT revision FROM clients LIMIT 1) AS clients, (SELECT 1 FROM activities LIMIT 1) AS activities, (SELECT 1 FROM ms_sessions LIMIT 1) AS sessions, (SELECT 1 FROM ms_login_attempts LIMIT 1) AS attempts, (SELECT 1 FROM contracts LIMIT 1) AS contracts, (SELECT 1 FROM payments LIMIT 1) AS payments, (SELECT 1 FROM leads LIMIT 1) AS leads, (SELECT 1 FROM whatsapp_dispatches LIMIT 1) AS whatsapp_dispatches, (SELECT 1 FROM fitness_access LIMIT 1) AS fitness_access, (SELECT 1 FROM fitness_workouts LIMIT 1) AS fitness_workouts, (SELECT 1 FROM fitness_diets LIMIT 1) AS fitness_diets, (SELECT 1 FROM fitness_posts LIMIT 1) AS fitness_posts').first();
}

export async function getClient(db, id) {
  return clientFromRow(await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first());
}

export async function getClientSnapshot(db, id) {
  const row = await db.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  return row ? { client: clientFromRow(row), revision: row.revision, demo: row.is_demo === 1 } : null;
}

export async function getClients(db) {
  const { results } = await db.prepare('SELECT * FROM clients ORDER BY end_date, name').all();
  return results.map(clientFromRow);
}

export async function getSettings(db) {
  await initializeSettings(db);
  const row = await db.prepare('SELECT value FROM settings WHERE id = 1').first();
  return JSON.parse(row.value);
}

export async function saveSettings(db, settings) {
  await db.prepare('INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value')
    .bind(JSON.stringify(settings)).run();
}

export async function getDemoStatus(db) {
  return !!(await db.prepare('SELECT 1 FROM clients WHERE is_demo = 1 LIMIT 1').first());
}

export async function isDemoClient(db, id) {
  return (await db.prepare('SELECT is_demo FROM clients WHERE id = ?').bind(id).first())?.is_demo === 1;
}

export async function getActivities(db) {
  const { results } = await db.prepare('SELECT id, type, client_name AS clientName, description, created_at AS createdAt FROM activities ORDER BY created_at DESC, rowid DESC LIMIT 40').all();
  return results;
}

export async function getSalesThisMonth(db, today) {
  const [start, end] = monthRangeInSaoPaulo(today);
  const row = await db.prepare("SELECT COUNT(*) AS count FROM activities WHERE is_demo = 0 AND type IN ('created', 'renewed') AND created_at >= ? AND created_at < ?")
    .bind(start, end).first();
  return row?.count ?? 0;
}

export async function getFinance(db, clients, today) {
  const { results: rows } = await db.prepare(`SELECT c.*, COALESCE(SUM(p.amount_cents), 0) AS received_cents
    FROM contracts c LEFT JOIN payments p ON p.contract_id = c.id
    GROUP BY c.id ORDER BY c.sold_at DESC, c.client_name COLLATE NOCASE`).all();
  const { results: paymentRows } = await db.prepare('SELECT * FROM payments ORDER BY paid_at DESC, created_at DESC').all();
  const paymentsByContract = new Map();
  for (const row of paymentRows) {
    const list = paymentsByContract.get(row.contract_id) ?? [];
    list.push({
      id: row.id, amount: row.amount_cents / 100, method: row.method,
      paidAt: row.paid_at, notes: row.notes, createdAt: row.created_at,
    });
    paymentsByContract.set(row.contract_id, list);
  }
  const contracts = rows.map((row) => {
    const amount = row.amount_cents / 100;
    const received = row.received_cents / 100;
    const status = received >= amount ? 'paid' : received > 0 ? 'partial' : row.tracking_status;
    return {
      id: row.id, clientId: row.client_id, clientName: row.client_name,
      plan: row.plan, service: row.service, amount,
      startDate: row.start_date, endDate: row.end_date, soldAt: row.sold_at,
      received, balance: status === 'unconfirmed' ? null : Math.max(0, amount - received),
      status, payments: paymentsByContract.get(row.id) ?? [],
    };
  });
  return summarizeFinance(clients, contracts, today);
}

function contractStatement(db, client, soldAt, status = 'pending', onlyAfterChange = false, excludeDemo = false) {
  return db.prepare(`INSERT INTO contracts
    (id, client_id, client_name, plan, service, amount_cents, start_date, end_date, sold_at, tracking_status)
    ${onlyAfterChange ? 'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1 AND ? = 0' : 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'}
  `).bind(
    crypto.randomUUID(), client.id, client.name, client.plan, client.service, Math.round(client.amount * 100),
    client.startDate, client.endDate, soldAt, status,
    ...(onlyAfterChange ? [excludeDemo ? 1 : 0] : []),
  );
}

export function activityStatement(db, activity, onlyAfterChange = false) {
  return db.prepare(`INSERT INTO activities (id, type, client_name, description, created_at, is_demo)
    ${onlyAfterChange ? 'SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1' : 'VALUES (?, ?, ?, ?, ?, ?)'}`)
    .bind(activity.id, activity.type, activity.clientName, activity.description, activity.createdAt, activity.demo ? 1 : 0);
}

export function createActivity({ type, clientName, description, createdAt, demo = false }) {
  return { id: crypto.randomUUID(), type, clientName, description, createdAt, demo };
}

export function publicActivity({ id, type, clientName, description, createdAt }) {
  return { id, type, clientName, description, createdAt };
}

export async function insertClient(db, client, timestamp, activity) {
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO clients
      (id, name, email, phone, plan, service, amount_cents, start_date, end_date, notes, whatsapp_opt_in, is_demo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).bind(
      id, client.name, client.email, client.phone, client.plan, client.service,
      Math.round(client.amount * 100), client.startDate, client.endDate, client.notes,
      client.whatsappOptIn ? 1 : 0, timestamp, timestamp,
    ),
    activityStatement(db, activity),
    contractStatement(db, { ...client, id }, timestamp),
  ]);
  return getClient(db, id);
}

export async function updateClient(db, id, client, timestamp, activity, snapshot, newContract = false) {
  const statements = [
    db.prepare(`UPDATE clients SET name = ?, email = ?, phone = ?, plan = ?, service = ?, amount_cents = ?,
      start_date = ?, end_date = ?, notes = ?, whatsapp_opt_in = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?`).bind(
      client.name, client.email, client.phone, client.plan, client.service, Math.round(client.amount * 100),
      client.startDate, client.endDate, client.notes, client.whatsappOptIn ? 1 : 0, timestamp, id, snapshot.revision,
    ),
    // D1 batch is atomic. A stale mutation must not create a phantom activity.
    activityStatement(db, activity, true),
  ];
  if (newContract) statements.push(contractStatement(db, { ...client, id }, timestamp, 'pending', true, snapshot.demo));
  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) throw new ConcurrentWriteError();
  return { ...client, id, createdAt: snapshot.client.createdAt, updatedAt: timestamp };
}

export async function setContractTracking(db, id, status) {
  const result = await db.prepare("UPDATE contracts SET tracking_status = ? WHERE id = ? AND tracking_status = 'unconfirmed'")
    .bind(status, id).run();
  return result.meta.changes === 1;
}

export async function addPayment(db, contractId, payment, now = new Date().toISOString()) {
  const id = crypto.randomUUID();
  const result = await db.prepare(`INSERT INTO payments
    (id, contract_id, amount_cents, method, paid_at, notes, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM contracts c WHERE c.id = ? AND
      COALESCE((SELECT SUM(amount_cents) FROM payments WHERE contract_id = c.id), 0) + ? <= c.amount_cents
    )`).bind(
    id, contractId, Math.round(payment.amount * 100), payment.method, payment.paidAt, payment.notes, now,
    contractId, Math.round(payment.amount * 100),
  ).run();
  if (result.meta.changes !== 1) return null;
  return { id, ...payment, createdAt: now };
}

function leadFromRow(row) {
  return row ? {
    id: row.id, name: row.name, phone: row.phone, plan: row.plan, service: row.service,
    amount: row.amount_cents / 100, stage: row.stage, followUpAt: row.follow_up_at,
    notes: row.notes, whatsappOptIn: row.whatsapp_opt_in === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
}

export async function getLeads(db) {
  const { results } = await db.prepare(`SELECT * FROM leads ORDER BY
    CASE stage WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'negotiation' THEN 2 ELSE 3 END,
    follow_up_at, name COLLATE NOCASE`).all();
  return results.map(leadFromRow);
}

export async function getLead(db, id) {
  return leadFromRow(await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first());
}

export async function insertLead(db, lead, timestamp) {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO leads
    (id, name, phone, plan, service, amount_cents, stage, follow_up_at, notes, whatsapp_opt_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    id, lead.name, lead.phone, lead.plan, lead.service, Math.round(lead.amount * 100),
    lead.stage, lead.followUpAt, lead.notes, lead.whatsappOptIn ? 1 : 0, timestamp, timestamp,
  ).run();
  return getLead(db, id);
}

export async function updateLead(db, id, lead, timestamp) {
  await db.prepare(`UPDATE leads SET name = ?, phone = ?, plan = ?, service = ?, amount_cents = ?,
    stage = ?, follow_up_at = ?, notes = ?, whatsapp_opt_in = ?, updated_at = ? WHERE id = ?`).bind(
    lead.name, lead.phone, lead.plan, lead.service, Math.round(lead.amount * 100),
    lead.stage, lead.followUpAt, lead.notes, lead.whatsappOptIn ? 1 : 0, timestamp, id,
  ).run();
  return getLead(db, id);
}

export async function deleteLead(db, id) {
  const result = await db.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
  return result.meta.changes === 1;
}

export async function deleteClient(db, id, activity, snapshot) {
  const results = await db.batch([
    db.prepare('DELETE FROM clients WHERE id = ? AND revision = ?').bind(id, snapshot.revision),
    activityStatement(db, activity, true),
  ]);
  if (results[0].meta.changes !== 1) throw new ConcurrentWriteError();
}

export async function removeDemo(db) {
  await db.batch([
    db.prepare('DELETE FROM clients WHERE is_demo = 1'),
    db.prepare('DELETE FROM activities WHERE is_demo = 1'),
  ]);
}
