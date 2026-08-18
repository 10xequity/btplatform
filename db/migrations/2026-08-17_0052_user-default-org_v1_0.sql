-- Boomtown Platform — migration 0052: the account's own default organization
-- File: db/migrations/2026-08-17_0052_user-default-org_v1_0.sql · Date: 2026-08-17
-- Ships in: v0.169.0 · handoff §6 item 1 (owner raised 2026-08-06)
--
-- FULLY ADDITIVE. One nullable column, no index, nothing existing altered. NOTHING READS IT until
-- `me()` selects it and `admin-nav.js` prefers it, both in the same release.
--
-- WHY THE SERVER AND NOT localStorage. `bt_org` already persists the last-used org per BROWSER, so
-- a local-only "default" is consulted only on a fresh browser — which is exactly where it is also
-- absent. A default that cannot survive a new device is not a default. It has to be server-side to
-- mean anything, which is why this is a column and not a preference key.
--
-- NULLABLE WITH NO DEFAULT, DELIBERATELY, AND SQLITE REQUIRES IT. Foreign keys are ENFORCED on live
-- D1 (`PRAGMA foreign_keys` reads 1 — measured 2026-08-16), and SQLite refuses `ADD COLUMN` with a
-- REFERENCES clause unless the default is NULL. NULL is also the honest starting value: every one
-- of the existing accounts has never chosen a default, and a migration that guessed one for them
-- would be inventing a preference nobody expressed. NULL means "no choice made" and the switcher's
-- existing first-org fallback continues to apply.
--
-- THE REFERENCE IS NOT THE PERMISSION CHECK. `REFERENCES orgs(id)` only proves the org exists; it
-- says nothing about whether this account may see it. A user could hold a default for an org whose
-- role was later revoked, so the WRITE path validates the role and the READ path (admin-nav.js)
-- consults the default only if it is in the role-filtered list it already computes. Both sides
-- refuse independently — a stale default degrades to the old first-org behaviour rather than
-- granting anything. `default_org.test.mjs` pins both directions.
--
-- NO ON DELETE CLAUSE, matching every other org reference in this schema: orgs are SOFT-deleted
-- (`deleted_at`), so a row is never removed and a cascade would never fire. A hard delete would
-- be refused by the constraint, which is the correct outcome and not one this migration invents.

ALTER TABLE users ADD COLUMN default_org_id INTEGER REFERENCES orgs(id);

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0052',
  '2026-08-17_0052_user-default-org_v1_0.sql',
  'users.default_org_id — the account''s own default organization, nullable (NULL = no choice made, first-org fallback still applies). Additive; server-side because bt_org persists per browser and a local default is absent exactly where it would be needed. The role check lives in the route and the switcher, not in the constraint.'
);
