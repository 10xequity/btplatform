-- Boomtown Platform — Migration 0032: Org reconciliation
-- File: 2026-08-01_0032_org-reconciliation_v1_0.sql · Version: v1.0 · Date: 2026-08-01
-- Source of decision: 2026-08-01_decisions_org-roster_v1_2 (D-ORG-5..9) + handoff v0_45_1 §2.
-- Owner explicit go on the destructive DELETE: 2026-08-01 session ("2. yes, and yes").
--
-- PRE-CHECK (must return 0 before the DELETE below is run — re-run every time):
--   SELECT
--    (SELECT COUNT(*) FROM contacts        WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM events          WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM registrations   WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM payments        WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM teams           WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM form_responses  WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM user_org_roles  WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM rental_requests WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM waivers         WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM membership_grants WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM standings       WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM documents       WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM uploads         WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM campaigns       WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM notifications   WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM event_templates WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM membership_tiers WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM sponsors        WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM schedule_views  WHERE org_id IN (6,7,8,9)) +
--    (SELECT COUNT(*) FROM programs        WHERE org_id IN (6,7,8,9)) AS dependent_rows;
--   Run 2026-08-01 (this session, live): dependent_rows = 0. PASSED.
--
-- sqlite_master check (F-41): no new table created here; ALTER on existing `orgs` only.
-- Column pre-check run 2026-08-01: `payments_parent_org_id` NOT present on orgs. PASSED.

-- 1) Additive: payments parent binding (D-ORG-7 — seeded binding, never a source literal / F-10).
ALTER TABLE orgs ADD COLUMN payments_parent_org_id INTEGER REFERENCES orgs(id);

-- 2) Org 1 — display stays "Boomtown Volleyball"; legal entity is the parent company
--    (owner confirm Q-A, 2026-08-01: "Boomtown Athletics, LLC").
UPDATE orgs SET legal_entity = 'Boomtown Athletics, LLC',
                legal_entity_short = 'BTA',
                updated_at = datetime('now')
 WHERE id = 1;

-- 3) Colorado Boom (org 4) — standalone, activate (D-ORG-5).
UPDATE orgs SET active = 1, deactivated_at = NULL, updated_at = datetime('now') WHERE id = 4;

-- 4) Queens Club (org 3) — part of BT; payments inherit BTA via the seeded binding (D-ORG-7).
UPDATE orgs SET payments_parent_org_id = 1, updated_at = datetime('now') WHERE id = 3;

-- 5) D-ORG-8 — hard-delete the four empty placeholder shells (zero dependents, pre-check above).
--    Orgs 5 (Oda Up — kept, events+scheduling only, D-ORG-9) and 10 (External/Rental — kept,
--    deactivated system bucket) are deliberately NOT in this set.
--    Reseed snippets if ever needed again:
--      INSERT INTO orgs (id,name,slug,is_owned,active) VALUES (6,'Rocky Mountain Rumble','rocky-mountain-rumble',0,0);
--      INSERT INTO orgs (id,name,slug,is_owned,active) VALUES (7,'Real Futsal','real-futsal',0,0);
--      INSERT INTO orgs (id,name,slug,is_owned,active) VALUES (8,'Special Olympics CO','special-olympics-co',0,0);
--      INSERT INTO orgs (id,name,slug,is_owned,active) VALUES (9,'Zara Gymnastics','zara-gymnastics',0,0);
DELETE FROM orgs WHERE id IN (6, 7, 8, 9) AND is_owned = 0;

-- 6) Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0032', '2026-08-01_0032_org-reconciliation_v1_0.sql',
        'Org reconciliation: +payments_parent_org_id; org1 legal_entity=Boomtown Athletics, LLC; COBO active; Queens->BTA binding; hard-delete empty orgs 6-9 (D-ORG-8, pre-check 0)');
