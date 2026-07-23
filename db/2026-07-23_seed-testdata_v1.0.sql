-- Boomtown Platform — TEST DATA SEED (NOT a migration — safe to run once, easy to remove)
-- File: db/2026-07-23_seed-testdata_v1.0.sql · Version: v1.0 · Date: 2026-07-23
-- Purpose: realistic data to exercise Schedule, Leagues, Tournament Ops, Registrations,
--          Standings, and Profiles without touching real records.
-- Safety: every row uses explicit IDs in the 90000+ range (real AUTOINCREMENT rows are far
--         below this), every name carries the "TEST" marker, every email is @example.com
--         (reserved domain — mail can never actually send). org_id = 1 (Boomtown Volleyball).
-- Remove: run the CLEANUP block at the bottom.

-- ---------- contacts (8 test players) ----------
INSERT INTO contacts (id, org_id, email, full_name, phone, city, state, instagram) VALUES
 (90001, 1, 'test.ava@example.com',    'TEST Ava Stone',     '555-0101', 'Colorado Springs', 'CO', 'test_ava'),
 (90002, 1, 'test.ben@example.com',    'TEST Ben Ortiz',     '555-0102', 'Colorado Springs', 'CO', NULL),
 (90003, 1, 'test.cami@example.com',   'TEST Cami Reyes',    '555-0103', 'Denver',           'CO', 'test_cami'),
 (90004, 1, 'test.drew@example.com',   'TEST Drew Park',     '555-0104', 'Pueblo',           'CO', NULL),
 (90005, 1, 'test.elle@example.com',   'TEST Elle Nguyen',   '555-0105', 'Monument',         'CO', NULL),
 (90006, 1, 'test.finn@example.com',   'TEST Finn Walker',   '555-0106', 'Fountain',         'CO', NULL),
 (90007, 1, 'test.gia@example.com',    'TEST Gia Romano',    '555-0107', 'Colorado Springs', 'CO', NULL),
 (90008, 1, 'test.hank@example.com',   'TEST Hank Ellis',    '555-0108', 'Castle Rock',      'CO', NULL);

-- ---------- waiver (so one registration shows the full happy path) ----------
INSERT INTO waivers (id, org_id, contact_id, waiver_text_version, signed_at, expires_at, signature_name) VALUES
 (90001, 1, 90001, 'v1', datetime('now','-30 days'), datetime('now','+335 days'), 'TEST Ava Stone');

-- ---------- events ----------
-- 1) COMPLETED tournament — feeds standings, results résumés, seeding
INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, format_template, status, price_cents) VALUES
 (90001, 1, 'tournament', 'TEST Spring Slam (sample data)', datetime('now','-14 days','start of day','+9 hours'), datetime('now','-14 days','start of day','+16 hours'), 'Boomtown Courts', 8, 2, '4-on-2', 'completed', 4500);
-- 2) UPCOMING tournament — open registration, exercises payment states
INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, format_template, status, price_cents, cash_option_enabled) VALUES
 (90002, 1, 'tournament', 'TEST Summer Open (sample data)', datetime('now','+10 days','start of day','+9 hours'), datetime('now','+10 days','start of day','+16 hours'), 'Boomtown Courts', 12, 3, '7-on-3', 'published', 6000, 1);
-- 3) LEAGUE — populates the new Leagues area
INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, status, price_cents) VALUES
 (90003, 1, 'league', 'TEST Thursday Coed 4s League (sample data)', datetime('now','+7 days','start of day','+18 hours'), datetime('now','+63 days','start of day','+21 hours'), 'Boomtown Courts', 10, 'published', 12000);

-- ---------- teams for the completed tournament (4 teams, partial RR = 6 games) ----------
INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed) VALUES
 (90001, 1, 90001, 'TEST Set to Kill',   'BB/A', 'Coed', 90001, 1),
 (90002, 1, 90001, 'TEST Block Party',   'BB/A', 'Coed', 90003, 2),
 (90003, 1, 90001, 'TEST Net Gains',     'BB/A', 'Coed', 90005, 3),
 (90004, 1, 90001, 'TEST Ace Ventura',   'BB/A', 'Coed', 90007, 4);

INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
 (1, 90001, 90001, 'TEST Ava Stone',   'test.ava@example.com'),
 (1, 90001, 90002, 'TEST Ben Ortiz',   'test.ben@example.com'),
 (1, 90002, 90003, 'TEST Cami Reyes',  'test.cami@example.com'),
 (1, 90002, 90004, 'TEST Drew Park',   'test.drew@example.com'),
 (1, 90003, 90005, 'TEST Elle Nguyen', 'test.elle@example.com'),
 (1, 90003, 90006, 'TEST Finn Walker', 'test.finn@example.com'),
 (1, 90004, 90007, 'TEST Gia Romano',  'test.gia@example.com'),
 (1, 90004, 90008, 'TEST Hank Ellis',  'test.hank@example.com');

-- ---------- scored matches (full RR of 4: 6 games, 2 courts × 3 rounds) ----------
INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
 (90001, 1, 90001, 'pool', 1, 1, 90001, 90004, NULL, 21, 23, 21, 15),
 (90002, 1, 90001, 'pool', 1, 2, 90002, 90003, NULL, 21, 23, 21, 18),
 (90003, 1, 90001, 'pool', 2, 1, 90001, 90003, NULL, 21, 23, 21, 19),
 (90004, 1, 90001, 'pool', 2, 2, 90002, 90004, NULL, 21, 23, 17, 21),
 (90005, 1, 90001, 'pool', 3, 1, 90001, 90002, NULL, 21, 23, 21, 12),
 (90006, 1, 90001, 'pool', 3, 2, 90003, 90004, NULL, 21, 23, 21, 16);

-- ---------- standings (wins → point diff, matches the 6 games above) ----------
INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
 (1, 90001, 90001, 3, 0,  17, 63, 46, 1),
 (1, 90001, 90003, 1, 2,  -2, 58, 60, 3),
 (1, 90001, 90002, 1, 2,  -7, 50, 57, 2),
 (1, 90001, 90004, 1, 2,  -8, 52, 60, 4);
-- (ranks 2/3 intentionally test the tiebreak display: Net Gains beats Block Party on diff,
--  but Block Party won head-to-head — flip them in the UI if head-to-head governs.)

-- ---------- registrations for the UPCOMING tournament (every payment state) ----------
INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method, waiver_id) VALUES
 (90001, 1, 90002, 90001, 'paid',         'square', 90001),
 (90002, 1, 90002, 90003, 'pending',      NULL,     NULL),
 (90003, 1, 90002, 90005, 'cash-pending', 'cash',   NULL),
 (90004, 1, 90002, 90007, 'comped',       'comp',   NULL);

-- ---------- registrations for the LEAGUE (so the Leagues page shows a count) ----------
INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
 (90005, 1, 90003, 90002, 'paid',    'square'),
 (90006, 1, 90003, 90004, 'pending', NULL);

-- ================================================================
-- CLEANUP (run this whole block to remove every test row):
-- DELETE FROM registrations WHERE id BETWEEN 90000 AND 90999;
-- DELETE FROM standings     WHERE event_id BETWEEN 90000 AND 90999;
-- DELETE FROM matches       WHERE id BETWEEN 90000 AND 90999;
-- DELETE FROM team_members  WHERE team_id BETWEEN 90000 AND 90999;
-- DELETE FROM teams         WHERE id BETWEEN 90000 AND 90999;
-- DELETE FROM events        WHERE id BETWEEN 90000 AND 90999;
-- DELETE FROM waivers       WHERE id BETWEEN 90000 AND 90999;
-- DELETE FROM contacts      WHERE id BETWEEN 90000 AND 90999;
-- ================================================================
