ALTER TABLE clients ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS whatsapp_dispatches (
  dispatch_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
