-- Boomtown Platform — migration 0024
-- File: db/migrations/2026-07-26_0024_uploads-and-reg-price_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.30.0
-- STATUS: NOT YET APPLIED   <-- change this line to APPLIED 2026-XX-XX the moment it runs.
--         A stale NOT-YET-APPLIED line on an applied migration is a double-application hazard.
--         Migration 0021 carried a wrong STATUS line for five releases (standards §6.3).
--
-- REVERSAL (copy-pasteable, standards §9.3):
--   DROP TABLE IF EXISTS uploads;
--   -- registrations.price_cents cannot be dropped in SQLite without a table rebuild. It is
--   -- nullable with no default, so leaving it in place is inert: COALESCE(r.price_cents,
--   -- e.price_cents) returns the event list price exactly as it did before this migration.
--
-- ADDITIVE ONLY. No column is dropped, no CHECK is altered, no existing row is rewritten.

-- ============================================================================
-- 1. uploads — generic org-scoped file index
-- ============================================================================
-- R2 holds the bytes; D1 holds the index. Same split as member_profiles.avatar_r2_key, which
-- has been in production since v0.5.0 — the pattern is proven, this generalises it.
--
-- DELIBERATELY NOT IN THIS TABLE:
--   * no compliance, eligibility, screening or clearance columns of any kind. Those live in an
--     external system by owner decision (2026-07-26). A second store for the same facts is worse
--     than none, because two records drift and nobody knows which one is authoritative.
--   * no expiry / review-due dates. Same reason.
--   * no approval workflow. An upload is a file, not a request.
CREATE TABLE IF NOT EXISTS uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),

  r2_key        TEXT    NOT NULL UNIQUE,   -- uploads/{org_id}/{yyyymm}/{uuid}.{ext}
  filename      TEXT    NOT NULL,          -- sanitised original name, for display + download
  content_type  TEXT    NOT NULL,
  bytes         INTEGER NOT NULL,
  sha256        TEXT,                      -- hex; lets a re-upload be recognised as identical

  -- Free-text label chosen by the operator. Deliberately NOT a CHECK constraint: altering a
  -- CHECK in SQLite requires a table rebuild, and the set of things an operator wants to file
  -- is not knowable in advance. Validated against a code-side list instead (uploads.js
  -- UPLOAD_KINDS), which is one edit rather than a migration.
  kind          TEXT    NOT NULL DEFAULT 'other',

  -- Optional link to any record, without an FK per entity type. 'contact' | 'event' | 'document'
  -- | 'league' | 'team' | 'org' | NULL. Unenforced by design: an FK per entity means a migration
  -- every time a new screen wants to attach a file.
  entity        TEXT,
  entity_id     INTEGER,

  -- private = staff of this org only · members = any signed-in member of this org
  -- public  = anyone with the URL. Enforced in uploads.js on every read, never in the UI alone.
  visibility    TEXT    NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','members','public')),

  uploaded_by_user_id    INTEGER REFERENCES users(id),
  uploaded_by_contact_id INTEGER REFERENCES contacts(id),
  notes         TEXT,

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_uploads_org      ON uploads(org_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_uploads_entity   ON uploads(org_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_uploads_kind     ON uploads(org_id, kind, deleted_at);
CREATE INDEX IF NOT EXISTS idx_uploads_sha      ON uploads(org_id, sha256);

-- ============================================================================
-- 2. registrations.price_cents — F-6, applyTierDiscount call site
-- ============================================================================
-- applyTierDiscount() shipped in v0.26.0 and has had zero call sites for four releases (F-6).
-- Wiring it at registration alone would have created a split price: the confirmation screen
-- quoting the discounted figure while retryPayment recomputed from events.price_cents and
-- charged list. The quoted price is therefore stored, and checkout reads
-- COALESCE(r.price_cents, e.price_cents) so the rows written before this migration behave
-- exactly as they do today.
ALTER TABLE registrations ADD COLUMN price_cents INTEGER;

-- ============================================================================
-- 3. Ledger
-- ============================================================================
-- schema_migrations shape verified live 2026-07-26: (id, version, filename, applied_at, note,
-- created_at). version is NOT NULL, so it must be supplied. There is no UNIQUE constraint on
-- filename, so OR IGNORE would NOT dedupe — the NOT EXISTS guard is what makes a second run inert.
INSERT INTO schema_migrations (version, filename, applied_at, note)
SELECT '0024',
       '2026-07-26_0024_uploads-and-reg-price_v1_0.sql',
       datetime('now'),
       'uploads table (generic org-scoped file index, R2 bytes + D1 index); registrations.price_cents added as the applyTierDiscount call site so the quoted price is the charged price'
WHERE NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0024');
