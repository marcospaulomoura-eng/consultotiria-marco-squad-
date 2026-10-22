-- Detect edits/renewals made by another tab or Worker request before committing.
ALTER TABLE clients ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
