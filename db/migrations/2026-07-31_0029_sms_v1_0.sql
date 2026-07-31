-- Boomtown Platform — Migration 0029: SMS phase 3 (owner req #17)
-- File: db/migrations/2026-07-31_0029_sms_v1_0.sql · Version: v1.0 · Date: 2026-07-31 · Ships in: v0.42.0
--
-- *** NOT YET APPLIED (owner directive 2026-07-31: build SMS, do not deploy). ***
-- Apply via Cloudflare MCP, ONE STATEMENT PER CALL, in the session that deploys v0.42.0.
-- sqlite_master checked 2026-07-31: no sms% table exists (F-41 clean).
-- CI schema-gate will fail closed on any deploy until this is applied — by design.
--
-- Additive only (standards §3). Consent is per-contact and defaults OFF: nobody is
-- textable until they opt in (A2P/TCPA requirement, not a preference).

ALTER TABLE contacts ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 0;

ALTER TABLE contacts ADD COLUMN sms_opt_in_at TEXT;

CREATE TABLE sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER REFERENCES contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  to_number TEXT,
  from_number TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  twilio_sid TEXT,
  error TEXT,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX idx_sms_log_org_day ON sms_log (org_id, created_at);

INSERT INTO schema_migrations (version, filename, note)
VALUES ('0029', '2026-07-31_0029_sms_v1_0.sql',
        'SMS phase 3: contacts.sms_opt_in + sms_opt_in_at, sms_log table (req #17)');
