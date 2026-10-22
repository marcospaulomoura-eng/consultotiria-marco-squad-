import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, addDays, addMonths, formatDate, monthRangeInSaoPaulo, PLANS, summarizeFinance } from './domain.mjs';

const DEFAULT_DB = fileURLToPath(new URL('../data/app.sqlite', import.meta.url));

export function openDatabase(path = process.env.DATABASE_PATH || DEFAULT_DB) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL,
      service TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      client_name TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_name TEXT NOT NULL, plan TEXT NOT NULL,
      service TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, sold_at TEXT NOT NULL,
      tracking_status TEXT NOT NULL CHECK (tracking_status IN ('pending', 'unconfirmed'))
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      method TEXT NOT NULL CHECK (method IN ('Pix', 'Transferência', 'Dinheiro', 'Cartão', 'Outro')),
      paid_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, plan TEXT NOT NULL, service TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
      stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'negotiation', 'won', 'lost')),
      follow_up_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS clients_end_date ON clients(end_date);
    CREATE INDEX IF NOT EXISTS activities_created_at ON activities(created_at);
    CREATE INDEX IF NOT EXISTS contracts_sold_at ON contracts(sold_at);
    CREATE INDEX IF NOT EXISTS contracts_client_id ON contracts(client_id);
    CREATE INDEX IF NOT EXISTS payments_contract_id ON payments(contract_id);
    CREATE INDEX IF NOT EXISTS payments_paid_at ON payments(paid_at);
    CREATE INDEX IF NOT EXISTS leads_follow_up_at ON leads(follow_up_at);
    CREATE INDEX IF NOT EXISTS leads_stage ON leads(stage);
    CREATE TABLE IF NOT EXISTS whatsapp_dispatches (
      dispatch_key TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
      provider_message_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO contracts
      (id, client_id, client_name, plan, service, amount_cents, start_date, end_date, sold_at, tracking_status)
    SELECT 'legacy-' || c.id, c.id, c.name, c.plan, c.service, c.amount_cents, c.start_date, c.end_date,
      COALESCE((SELECT MAX(a.created_at) FROM activities a WHERE a.client_name = c.name AND a.is_demo = 0 AND a.type IN ('created', 'renewed')), c.created_at), 'unconfirmed'
    FROM clients c LEFT JOIN contracts saved ON saved.client_id = c.id
    WHERE c.is_demo = 0 AND saved.id IS NULL;
  `);
  const clientColumns = new Set(db.prepare('PRAGMA table_info(clients)').all().map((column) => column.name));
  if (!clientColumns.has('whatsapp_opt_in')) db.exec('ALTER TABLE clients ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
  const leadColumns = new Set(db.prepare('PRAGMA table_info(leads)').all().map((column) => column.name));
  if (!leadColumns.has('whatsapp_opt_in')) db.exec('ALTER TABLE leads ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
  return db;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = work();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
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

export function getClient(db, id) { return clientFromRow(db.prepare('SELECT * FROM clients WHERE id = ?').get(id)); }
export function getClients(db) { return db.prepare('SELECT * FROM clients ORDER BY end_date, name').all().map(clientFromRow); }
export function getSettings(db) { return JSON.parse(db.prepare('SELECT value FROM settings WHERE id = 1').get().value); }
export function saveSettings(db, settings) { db.prepare('INSERT OR REPLACE INTO settings (id, value) VALUES (1, ?)').run(JSON.stringify(settings)); }
export function getDemoStatus(db) { return !!db.prepare('SELECT 1 FROM clients WHERE is_demo = 1 LIMIT 1').get(); }
export function isDemoClient(db, id) { return db.prepare('SELECT is_demo FROM clients WHERE id = ?').get(id)?.is_demo === 1; }

export function getActivities(db) {
  return db.prepare('SELECT id, type, client_name AS clientName, description, created_at AS createdAt FROM activities ORDER BY created_at DESC, rowid DESC LIMIT 40').all();
}

export function getSalesThisMonth(db, today) {
  const [start, end] = monthRangeInSaoPaulo(today);
  return db.prepare("SELECT COUNT(*) AS count FROM activities WHERE is_demo = 0 AND type IN ('created', 'renewed') AND created_at >= ? AND created_at < ?")
    .get(start, end).count;
}

export function addContract(db, client, { soldAt = new Date().toISOString(), status = 'pending' } = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO contracts
    (id, client_id, client_name, plan, service, amount_cents, start_date, end_date, sold_at, tracking_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, client.id, client.name, client.plan, client.service, Math.round(client.amount * 100),
    client.startDate, client.endDate, soldAt, status,
  );
  return id;
}

function paymentFromRow(row) {
  return {
    id: row.id, amount: row.amount_cents / 100, method: row.method,
    paidAt: row.paid_at, notes: row.notes, createdAt: row.created_at,
  };
}

export function getFinance(db, clients, today) {
  const rows = db.prepare(`SELECT c.*, COALESCE(SUM(p.amount_cents), 0) AS received_cents
    FROM contracts c LEFT JOIN payments p ON p.contract_id = c.id
    GROUP BY c.id ORDER BY c.sold_at DESC, c.client_name COLLATE NOCASE`).all();
  const payments = db.prepare(`SELECT p.*, contract_id AS contractId FROM payments p
    ORDER BY paid_at DESC, created_at DESC`).all();
  const paymentsByContract = new Map();
  for (const row of payments) {
    const list = paymentsByContract.get(row.contractId) ?? [];
    list.push(paymentFromRow(row));
    paymentsByContract.set(row.contractId, list);
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

export function setContractTracking(db, id, status) {
  return db.prepare("UPDATE contracts SET tracking_status = ? WHERE id = ? AND tracking_status IN ('pending', 'unconfirmed')")
    .run(status, id).changes === 1;
}

export function addPayment(db, contractId, payment, now = new Date().toISOString()) {
  const id = randomUUID();
  const result = db.prepare(`INSERT INTO payments (id, contract_id, amount_cents, method, paid_at, notes, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM contracts c WHERE c.id = ? AND
      COALESCE((SELECT SUM(amount_cents) FROM payments WHERE contract_id = c.id), 0) + ? <= c.amount_cents
    )`).run(
    id, contractId, Math.round(payment.amount * 100), payment.method, payment.paidAt, payment.notes, now,
    contractId, Math.round(payment.amount * 100),
  );
  if (result.changes !== 1) return null;
  return paymentFromRow(db.prepare('SELECT * FROM payments WHERE id = ?').get(id));
}

function leadFromRow(row) {
  return row ? {
    id: row.id, name: row.name, phone: row.phone, plan: row.plan, service: row.service,
    amount: row.amount_cents / 100, stage: row.stage, followUpAt: row.follow_up_at,
    notes: row.notes, whatsappOptIn: row.whatsapp_opt_in === 1, createdAt: row.created_at, updatedAt: row.updated_at,
  } : null;
}

export function getLeads(db) {
  return db.prepare(`SELECT * FROM leads ORDER BY
    CASE stage WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 WHEN 'negotiation' THEN 2 ELSE 3 END,
    follow_up_at, name COLLATE NOCASE`).all().map(leadFromRow);
}

export function getLead(db, id) { return leadFromRow(db.prepare('SELECT * FROM leads WHERE id = ?').get(id)); }

export function insertLead(db, lead, now = new Date().toISOString()) {
  const id = randomUUID();
  db.prepare(`INSERT INTO leads
    (id, name, phone, plan, service, amount_cents, stage, follow_up_at, notes, whatsapp_opt_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, lead.name, lead.phone, lead.plan, lead.service, Math.round(lead.amount * 100),
    lead.stage, lead.followUpAt, lead.notes, lead.whatsappOptIn ? 1 : 0, now, now,
  );
  return getLead(db, id);
}

export function updateLead(db, id, lead, now = new Date().toISOString()) {
  db.prepare(`UPDATE leads SET name = ?, phone = ?, plan = ?, service = ?, amount_cents = ?,
    stage = ?, follow_up_at = ?, notes = ?, whatsapp_opt_in = ?, updated_at = ? WHERE id = ?`).run(
    lead.name, lead.phone, lead.plan, lead.service, Math.round(lead.amount * 100),
    lead.stage, lead.followUpAt, lead.notes, lead.whatsappOptIn ? 1 : 0, now, id,
  );
  return getLead(db, id);
}

export function deleteLead(db, id) { return db.prepare('DELETE FROM leads WHERE id = ?').run(id).changes === 1; }

export function addActivity(db, { type, clientName, description, createdAt = new Date().toISOString(), demo = false }) {
  const id = randomUUID();
  db.prepare('INSERT INTO activities (id, type, client_name, description, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, type, clientName, description, createdAt, demo ? 1 : 0);
  return { id, type, clientName, description, createdAt };
}

export function insertClient(db, client, { demo = false, now = new Date().toISOString() } = {}) {
  const id = randomUUID();
  db.prepare(`INSERT INTO clients
    (id, name, email, phone, plan, service, amount_cents, start_date, end_date, notes, whatsapp_opt_in, is_demo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, client.name, client.email, client.phone, client.plan, client.service,
    Math.round(client.amount * 100), client.startDate, client.endDate, client.notes,
    client.whatsappOptIn ? 1 : 0, demo ? 1 : 0, now, now,
  );
  return getClient(db, id);
}

export function updateClient(db, id, client, now = new Date().toISOString()) {
  db.prepare(`UPDATE clients SET name = ?, email = ?, phone = ?, plan = ?, service = ?, amount_cents = ?,
    start_date = ?, end_date = ?, notes = ?, whatsapp_opt_in = ?, updated_at = ? WHERE id = ?`).run(
    client.name, client.email, client.phone, client.plan, client.service, Math.round(client.amount * 100),
    client.startDate, client.endDate, client.notes, client.whatsappOptIn ? 1 : 0, now, id,
  );
  return getClient(db, id);
}

export function initializeDatabase(db, today, now = new Date().toISOString(), seedDemo = true) {
  if (db.prepare("SELECT 1 FROM metadata WHERE key = 'initialized'").get()) return;
  transaction(db, () => {
    saveSettings(db, DEFAULT_SETTINGS);
    if (seedDemo) {
      const examples = [
        ['Ana Carolina Silva', 'ana.carolina', 'Mensal', 'Treino + dieta', 219, -4],
        ['Rafael Oliveira', 'rafael.oliveira', 'Trimestral', 'Treino', 399, -1],
        ['Mariana Santos', 'mariana.santos', 'Mensal', 'Treino + dieta', 219, 0],
        ['Lucas Ferreira', 'lucas.ferreira', 'Trimestral', 'Treino + dieta', 597, 1],
        ['Beatriz Almeida', 'beatriz.almeida', 'Mensal', 'Dieta', 159, 3],
        ['Gabriel Costa', 'gabriel.costa', 'Semestral', 'Treino + dieta', 1099, 5],
        ['Camila Rodrigues', 'camila.rodrigues', 'Mensal', 'Treino', 149, 8],
        ['Pedro Henrique', 'pedro.henrique', 'Trimestral', 'Treino + dieta', 597, 20],
        ['Juliana Lima', 'juliana.lima', 'Anual', 'Treino + dieta', 1999, 35],
      ];
      examples.forEach(([name, email, plan, service, amount, offset]) => {
        const endDate = addDays(today, offset);
        insertClient(db, {
          name, email: `${email}@example.com`, phone: '', plan, service, amount,
          startDate: addMonths(endDate, -PLANS[plan]), endDate,
          notes: 'Cliente fictício para demonstração. Cadastre os dados reais antes de usar o WhatsApp.',
        }, { demo: true, now });
      });
      addActivity(db, {
        type: 'demo', clientName: 'Demonstração',
        description: `Dados fictícios preparados para conhecer o painel em ${formatDate(today)}.`, createdAt: now, demo: true,
      });
    }
    db.prepare("INSERT INTO metadata (key, value) VALUES ('initialized', '1')").run();
  });
}
