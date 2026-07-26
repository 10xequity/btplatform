-- Boomtown Platform — migration 0017: media-release consent record
-- File: db/migrations/2026-07-26_0017_media-consent_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.25.0 · ADDITIVE ONLY.
--
-- WHY: waiver text v2 §6 grants an irrevocable likeness release with the only decline path
-- being a written request to a named address (D-WV-10). The policy existed with nowhere to
-- record its use, so an opt-out could be honoured once by whoever read the email and then
-- forgotten. This table is that record.
--
-- HISTORY IS PRESERVED. Withdrawing an opt-out soft-deletes the prior row rather than
-- editing it, so the sequence of decisions is reconstructable. The partial unique index
-- allows exactly one LIVE opt-out per contact and does not constrain the history.

CREATE TABLE IF NOT EXISTS media_consents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id              INTEGER NOT NULL DEFAULT 1 REFERENCES orgs(id),
  contact_id          INTEGER NOT NULL REFERENCES contacts(id),
  status              TEXT NOT NULL CHECK (status IN ('opted_out','restored')),
  received_via        TEXT CHECK (received_via IN ('email','in_person','phone','post','other')),
  reference           TEXT,
  note                TEXT,
  requested_at        TEXT,
  recorded_by_user_id INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_media_consents_contact
  ON media_consents(org_id, contact_id, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS ux_media_consents_live_optout
  ON media_consents(org_id, contact_id)
  WHERE status = 'opted_out' AND deleted_at IS NULL;
