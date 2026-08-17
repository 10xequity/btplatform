-- Boomtown Platform — migration 0051: the per-account module grant
-- File: db/migrations/2026-08-16_0051_user-module-grants_v1_0.sql · Date: 2026-08-16
-- Ships in: (no bump — schema only) · roadmap §-1q, build unit SG-3a
--
-- FULLY ADDITIVE. A new table and one index; nothing existing is altered, and NOTHING READS THIS
-- TABLE until `staffGateFor` ships. Migration 0050 admitted the 'host' role; a host passes no
-- existing gate at all, so until grants exist a host account can reach nothing. This is the table
-- that opens doors, one module at a time.
--
-- WHY A PARTIAL UNIQUE INDEX RATHER THAN A PLAIN ONE. Grants are soft-deleted (`deleted_at`), so a
-- straight UNIQUE(org_id, user_id, module_key) would make a revoked grant permanently un-regrantable
-- — the revoked row would still occupy the unique slot. `WHERE deleted_at IS NULL` constrains only
-- LIVE grants: at most one live grant per (org, account, module), while every revocation stays on
-- the record for audit. It also serves as the lookup index for the gate's own query, which reads
-- exactly these three columns plus the null check.
--
-- GRANTS ARE PER-ORG, and the composite index leads with org_id to say so structurally: a grant in
-- one organization grants nothing in another. `cross_org_isolation` gets a pin for this.
--
-- `granted_by` is nullable REFERENCES users(id) deliberately — a grant created by a migration,
-- a seed, or a future automated process has no human granter, and recording NULL is honest where
-- inventing an id would not be.
--
-- MODULE_KEYS (the worker constant) is the vocabulary for `module_key`. It is NOT a CHECK
-- constraint here on purpose: the key list changes when a module ships, and migration 0050 is a
-- standing reminder of what it costs to put a mutable vocabulary in a CHECK on this platform.
-- The guard is at the wire and in `module_keys.test.mjs`, where it can move without a rebuild.
--
-- APPLIED AND READ BACK live 2026-08-16: ledger 51/51, 0 rows, 2 objects under tbl_name
-- (the table and idx_umg_live).

CREATE TABLE user_module_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  module_key TEXT NOT NULL,
  granted_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX idx_umg_live ON user_module_grants (org_id, user_id, module_key) WHERE deleted_at IS NULL;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0051',
  '2026-08-16_0051_user-module-grants_v1_0.sql',
  'user_module_grants — the per-org, per-account module grant a ''host'' needs to reach anything (SG-3a, §-1q). Additive. Partial UNIQUE index on the live rows only, so a revoked grant can be re-granted while its revocation stays on the record.'
);
