PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  plan TEXT NOT NULL,
  service TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  sold_at TEXT NOT NULL,
  tracking_status TEXT NOT NULL CHECK (tracking_status IN ('pending', 'unconfirmed'))
);
CREATE INDEX IF NOT EXISTS contracts_sold_at ON contracts(sold_at);
CREATE INDEX IF NOT EXISTS contracts_client_id ON contracts(client_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('Pix', 'Transferência', 'Dinheiro', 'Cartão', 'Outro')),
  paid_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_contract_id ON payments(contract_id);
CREATE INDEX IF NOT EXISTS payments_paid_at ON payments(paid_at);

INSERT OR IGNORE INTO contracts
  (id, client_id, client_name, plan, service, amount_cents, start_date, end_date, sold_at, tracking_status)
SELECT 'legacy-' || c.id, c.id, c.name, c.plan, c.service, c.amount_cents, c.start_date, c.end_date,
  COALESCE(MAX(a.created_at), c.created_at), 'unconfirmed'
FROM clients c
LEFT JOIN activities a ON a.client_name = c.name AND a.is_demo = 0 AND a.type IN ('created', 'renewed')
WHERE c.is_demo = 0
GROUP BY c.id;
