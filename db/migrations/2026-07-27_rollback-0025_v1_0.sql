-- Boomtown Platform — ROLLBACK for migration 0025
-- File: 2026-07-27_rollback-0025_v1_0.sql · Version: v1.0 · Date: 2026-07-27
-- Captured live from sqlite_master on boomtown-prod IMMEDIATELY BEFORE 0025 was applied.
-- access_tokens held 0 rows at capture time, so this reversal loses nothing.
-- Run ONLY if 0025 must be undone. Ask before doing it (install-v0_32_0 §"If something goes wrong").

DROP INDEX IF EXISTS ux_access_tokens_guardian_invite;
DROP INDEX IF EXISTS ux_access_tokens_sha;
DROP INDEX IF EXISTS idx_access_tokens_owner;
DROP INDEX IF EXISTS ux_access_tokens_public_cal;
DROP TABLE IF EXISTS access_tokens;

CREATE TABLE access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK (kind IN ('calendar_member','calendar_public','waiver_sign')),
  token_sha TEXT NOT NULL,
  contact_id INTEGER,
  team_member_id INTEGER,
  label TEXT,
  expires_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER,
  revoked_at TEXT,
  deleted_at TEXT
);

CREATE UNIQUE INDEX ux_access_tokens_sha ON access_tokens(token_sha);
CREATE INDEX idx_access_tokens_owner ON access_tokens(org_id, kind, contact_id);
CREATE UNIQUE INDEX ux_access_tokens_public_cal ON access_tokens(org_id)
  WHERE kind = 'calendar_public' AND revoked_at IS NULL AND deleted_at IS NULL;

-- SQLite cannot DROP COLUMN on these safely in D1; leaving the added columns in place is
-- harmless (they are nullable / defaulted) and is the correct partial reversal.
-- contacts.activation_state, guardianships.certified_* stay.

DELETE FROM schema_migrations WHERE version = '0025';
