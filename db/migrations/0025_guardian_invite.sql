-- Boomtown Platform — Migration 0025
-- File: 0025_guardian_invite.sql · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.32.0
-- STATUS: APPLIED 2026-07-27 16:41:27 UTC (schema_migrations version '0025')
--   ^ Applied via Cloudflare MCP, statement by statement, preconditions re-verified at write
--     time. Do NOT re-run. A stale
--     NOT-YET-APPLIED on an applied migration is a double-application hazard (0021 carried
--     a wrong one for five releases).
--
-- D-MIN-9  a minor's account is created but not activated until an adult guardian is linked
-- D-MIN-11 a blank guardian DOB is not a form error — invite the parent, they certify, block holds
-- Owner decision 2026-07-26: option B — registration itself is blocked, not merely activation.
--
-- Verified against live D1 before writing (standards §5.5):
--   access_tokens ....... 0 rows, all kinds  → the rebuild below moves no data
--   contacts ............ has no status column of any kind
--   member_profiles ..... already carries date_of_birth; NOT touched here
--   guardianships ....... has status/aged_out_at/separation_choice; no certification columns
--   schema_migrations ... (id, version TEXT NOT NULL, filename TEXT NOT NULL, applied_at, note, created_at)

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- 1. Activation state on the contact.  D-MIN-9's third state.
--    'active'           — normal
--    'pending_guardian' — created by an under-18 registration attempt, no guardian linked yet
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ADD COLUMN activation_state TEXT NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_contacts_activation
  ON contacts(org_id, activation_state) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Certification on the guardianship.  The guardian attests that what they entered
--    is accurate.  Recorded as fact: who, when, the name they typed, and a hash of the
--    exact attestation text they were shown — same shape as D-DOC-8, where a signature is
--    pinned permanently to the text the signer saw and is never re-pointed.
-- ---------------------------------------------------------------------------
ALTER TABLE guardianships ADD COLUMN certified_by_contact_id INTEGER;
ALTER TABLE guardianships ADD COLUMN certified_at TEXT;
ALTER TABLE guardianships ADD COLUMN certified_name TEXT;
ALTER TABLE guardianships ADD COLUMN certification_sha TEXT;

-- ---------------------------------------------------------------------------
-- 3. access_tokens — widen the kind CHECK to admit 'guardian_invite'.
--    SQLite cannot ALTER a CHECK constraint, so the table is rebuilt.  This is the one
--    non-additive step in this migration and it was approved explicitly by the owner on
--    2026-07-26 after the row count was quoted: the table holds ZERO rows, so the rebuild
--    moves no data and no live calendar feed depends on it.
--    All three indexes are recreated below — dropping the table drops them silently.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS ux_access_tokens_sha;
DROP INDEX IF EXISTS idx_access_tokens_owner;
DROP INDEX IF EXISTS ux_access_tokens_public_cal;
DROP TABLE IF EXISTS access_tokens;

CREATE TABLE access_tokens (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id             INTEGER NOT NULL DEFAULT 1,
  kind               TEXT NOT NULL CHECK (kind IN ('calendar_member','calendar_public','waiver_sign','guardian_invite')),
  token_sha          TEXT NOT NULL,
  contact_id         INTEGER,
  team_member_id     INTEGER,
  label              TEXT,
  expires_at         TEXT,
  last_used_at       TEXT,
  use_count          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER,
  revoked_at         TEXT,
  deleted_at         TEXT
);

CREATE UNIQUE INDEX ux_access_tokens_sha ON access_tokens(token_sha);
CREATE INDEX idx_access_tokens_owner ON access_tokens(org_id, kind, contact_id);
CREATE UNIQUE INDEX ux_access_tokens_public_cal ON access_tokens(org_id)
  WHERE kind = 'calendar_public' AND revoked_at IS NULL AND deleted_at IS NULL;

-- One live invite per pending minor. A second attempt revokes and re-mints rather than
-- accumulating tokens, which is the pattern consent.js already uses for waiver_sign.
CREATE UNIQUE INDEX ux_access_tokens_guardian_invite
  ON access_tokens(org_id, contact_id)
  WHERE kind = 'guardian_invite' AND revoked_at IS NULL AND deleted_at IS NULL;

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 4. Ledger.  version is TEXT NOT NULL and filename is TEXT NOT NULL — both required.
--    A release is not shipped until this row exists (recurring pattern 4).
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (version, filename, applied_at, note)
VALUES ('0025', '0025_guardian_invite.sql', datetime('now'),
        'v0.32.0 — contacts.activation_state; guardianship certification columns; access_tokens rebuilt (0 rows) to admit guardian_invite');
