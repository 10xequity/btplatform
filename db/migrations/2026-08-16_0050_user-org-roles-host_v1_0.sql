-- Boomtown Platform — migration 0050: user_org_roles admits a fourth role, 'host'
-- File: db/migrations/2026-08-16_0050_user-org-roles-host_v1_0.sql · Date: 2026-08-16
-- Ships in: (no bump — schema only) · roadmap §-1q, build unit SG-3a
--
-- THE ONE NON-ADDITIVE STEP IN THE WHOLE §-1q PROGRAM, and it ran on the owner's explicit go
-- (2026-08-16, "Approve"), with the SQL below shown to him beforehand exactly as written.
--
-- WHY A REBUILD. `user_org_roles.role` carries a day-one CHECK from the foundation migration
-- (line 12, 2026-07-21): role IN ('admin','staff','member'). SQLite cannot ALTER a CHECK
-- constraint, so admitting a fourth value means create-copy-drop-rename. There is no additive
-- form of this change. The alternative that lost was modelling hosts as 'member' plus grant
-- rows — fully additive, but it erases the visible "limited admin" marker and makes a grant row
-- the only discriminator. Three rebuilt rows were judged worth the honest semantics.
--
-- WHAT 'host' IS. A host passes NO existing gate. It is the tier that opens one module at a
-- time via `user_module_grants` (migration 0051, additive, still to come) and `staffGateFor`
-- bindings at the wire. Admin and staff behaviour is untouched by this migration: the two
-- authorization queries that read this column — leagues_admin.js:113 and reports.js:153 — both
-- filter role IN ('admin','staff'), so a host matches neither and reaches nothing until it is
-- granted something. That is the intended shape, not an omission.
--
-- MEASURED BEFORE IT RAN (live D1, 2026-08-16):
--   · sqlite_master had exactly ONE object mentioning user_org_roles — the table itself.
--     No index, no view, no trigger, no foreign key from any other table pointed at it.
--   · 3 rows: user_id 1, org_id 1/2/3, all role 'admin', deleted_at NULL. The owner's own.
--   · Column order in the new table is byte-identical to the old (6 columns, same order), which
--     is what makes `INSERT ... SELECT *` safe. Verified against the live DDL, not assumed.
--
-- HOW IT RAN. All four statements went in ONE multi-statement call. Sequenced as separate
-- round trips there is a window between DROP and RENAME in which the table does not exist —
-- and since this table is what `requireStaff` reads, that window is one where the owner is
-- locked out of his own admin screens. The connector had already returned one transient 403
-- earlier in the same session (1 of 5 reads, recovered instantly on retry), so the window was
-- not theoretical. One call, no window.
--
-- READ BACK AFTER (live D1, same session): 3 rows, roles unchanged, timestamps preserved
-- byte-for-byte (2026-07-22 17:06:26), no orphan user_org_roles_new, and sqlite_master's SQL
-- carries 'host'. Ledger then 50/50/'0050'.

CREATE TABLE user_org_roles_new (
  user_id INTEGER NOT NULL REFERENCES users(id),
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL CHECK (role IN ('admin','staff','member','host')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, org_id)
);
INSERT INTO user_org_roles_new SELECT * FROM user_org_roles;  -- 3 rows, the owner's own admin roles
DROP TABLE user_org_roles;
ALTER TABLE user_org_roles_new RENAME TO user_org_roles;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0050',
  '2026-08-16_0050_user-org-roles-host_v1_0.sql',
  'user_org_roles.role CHECK widened to admit ''host'' (SG-3a, roadmap §-1q). Rebuild, not ALTER — SQLite cannot alter a CHECK. 3 live rows copied unchanged. Nothing else referenced the table. Owner''s explicit go, 2026-08-16.'
);
