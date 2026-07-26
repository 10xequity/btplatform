-- Boomtown Platform — migration 0021
-- File: 2026-07-26_0021_ledger-org-scope_v1_1.sql · Version: v1.1 · Date: 2026-07-26
-- Ships in: v0.28.0
-- STATUS: APPLIED to boomtown-prod 2026-07-26 21:08 UTC via Cloudflare MCP, and verified.
--         Paste this file so the repo matches the database. DO NOT RUN IT AGAIN.
--
-- v1.1 change from v1.0: the Colorado Boom block is no longer conditional. Owner confirmed
-- 2026-07-26 "do not add colorado boom for now", so org 4 is deactivated with the rest.
--
-- Three groups, all additive. Nothing dropped, nothing hard-deleted.
--
--   1. schema_migrations ledger. Twenty migrations had been applied to boomtown-prod with zero
--      record in the database of which ones ran; the only source of truth was a handoff MD.
--      That is how a migration gets double-applied. Backfilled from the repo's db/migrations/
--      listing, with applied_at NULL where the real date is unknown -- an honest NULL beats an
--      invented timestamp.
--
--   2. Org scope reduction to the three named brands: Boomtown Volleyball (1), Match Point
--      Social (2), Queens Club (3). Everything else DEACTIVATED, not deleted.
--
--      Verified before applying: orgs 2-10 held zero contacts, events, registrations,
--      member_profiles and waivers. Every row in the platform belongs to org 1. So this was
--      cost-free and is reversible with one UPDATE.
--
--      Deleting them would be wrong regardless of row counts: orgs(id) is an FK target across
--      the schema, and the owner said "we can add them later" -- a renter that returns next
--      season should return with its id and history, not as a new org.
--
--   3. orgs.deactivated_at, so "when did this stop being selectable" stays answerable.
--
-- NOT in this migration, deliberately:
--   * No is_minor or visibility_locked column. Minor status is derived from
--     member_profiles.date_of_birth at read time (D-MIN-2). A stored flag goes stale on a
--     birthday.
--   * No override_reason column on audit_log. Override reasons go in audit_log.detail_json;
--     the table already has the right shape and adding a column for one caller is premature.
--   * No changes to media_consents. It stays dormant per D-CON-5 / D-CON-6.

/* ==================== 1. Schema migration ledger ==================== */

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL,
  filename    TEXT NOT NULL,
  applied_at  TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_schema_migrations_version
  ON schema_migrations(version);

INSERT OR IGNORE INTO schema_migrations (version, filename, applied_at, note) VALUES
  ('0001','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0002','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0003','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0004','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0005','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0006','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0007','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0008','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0009','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0010','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0011','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0012','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0013','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0014','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0015','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0016','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0017','(see db/migrations/)',NULL,'backfilled 2026-07-26, original date unrecorded'),
  ('0018','2026-07-26_0018_tiers-views-timezone_v1_0.sql','2026-07-26','applied via Cloudflare MCP, 13 assertions verified'),
  ('0019','2026-07-26_0019_families-orgprofile-hand_v1_0.sql','2026-07-26','applied via Cloudflare MCP, verified'),
  ('0020','(legal_entity, rules_url)','2026-07-26','applied via Cloudflare MCP; columns confirmed present');

/* ==================== 2. Deactivation timestamp ==================== */

ALTER TABLE orgs ADD COLUMN deactivated_at TEXT;

/* ==================== 3. Org scope reduction ==================== */
-- id 4  Colorado Boom          -- held off per owner 2026-07-26, not a live brand for now
-- id 5  Oda Up                 -- facility renter
-- id 6  Rocky Mountain Rumble  -- facility renter
-- id 7  Real Futsal            -- facility renter
-- id 8  Special Olympics CO    -- facility renter; also closes handoff v0.27.0 section 4b,
--                                 since the no-decline likeness release no longer reaches
--                                 their participants
-- id 9  Zara Gymnastics        -- facility renter
-- id 10 External / Rental      -- catch-all

UPDATE orgs
   SET active = 0,
       deactivated_at = datetime('now')
 WHERE id IN (4,5,6,7,8,9,10)
   AND deleted_at IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, filename, applied_at, note) VALUES
  ('0021','2026-07-26_0021_ledger-org-scope_v1_0.sql', datetime('now'),
   'ledger created and backfilled; orgs 4-10 deactivated (active=0), none deleted; Colorado Boom held off per owner 2026-07-26');

/* ==================== Verification -- ALL THREE PASSED 2026-07-26 ====================
   SELECT id, name, active FROM orgs WHERE active=1 ORDER BY id;
     -> 1 Boomtown Volleyball, 2 Match Point Social, 3 Queens Club          PASS
   SELECT COUNT(*) total, SUM(active) act FROM orgs WHERE deleted_at IS NULL;
     -> total 10, act 3                                                     PASS
   SELECT COUNT(*) FROM schema_migrations;  -> 22 (after 0022)              PASS

   Reversal, if a renter comes back:
     UPDATE orgs SET active=1, deactivated_at=NULL WHERE id=<id>;

   ==================== CODE CHANGE STILL REQUIRED ====================
   orgs.active was added in migration 0019, AFTER the org switcher was built. This migration
   is a NO-OP IN THE UI until the worker filters on it. Grep before calling it done:

       grep -rn "orgs.active\|active = 1\|active=1" worker/src/

   Same failure mode as guardianGate and applyTierDiscount shipping uncalled (handoff v0.27.0
   section 2e): a column with no reader is not a feature.
   ==================================================================== */
