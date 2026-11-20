-- Boomtown Platform — migration 0055: 15 courts, Zone 1–7 presets, party rooms, corrals, Shoot 360
-- File: db/migrations/2026-11-20_0055_facility-zones_v1_0.sql · Date: 2026-11-20
-- Ships in: no version bump (data only) · spec docs/2026-11-20_spec_party-booking_v1_1.md, unit 1
--
-- DATA ONLY. No table, column or index changes — journey-schema.sql is untouched. Every statement
-- is an INSERT, or an UPDATE of a display name / sort order. Nothing is deleted.
--
-- WHY. Migration 0008 seeded 13 volleyball courts. The building has 15 (owner, 2026-11-20). The
-- operations sheet's weekly grid is Zones 1–7, and the party page sells by those zones:
--   Zone 1 = VB 1–2 · Zone 2 = VB 3–4 · Zone 3 = VB 5–6 · Zone 4 = VB 7–8   (hardwood; one
--     basketball court each, three pickleball courts each)
--   Zone 5 = VB 9–10 ("A1") · Zone 6 = VB 11–12 ("SC") · Zone 7 = VB 13–15 (futsal, inflatables)
-- The four basketball presets already held exactly the Zone 1–4 pairs, so they are RENAMED, not
-- rebuilt: their ids and atoms stand. Live D1 had 0 bookings pointing at any preset (all 272 carry
-- preset_id NULL, measured 2026-11-20), so there is no booking to re-point.
--
-- EXISTING BOOKINGS. A booking that holds ALL of VB 9–13 was booked as "Sports Court" or
-- "All Courts" under the 13-court model, where VB 13 was the last court. It gains VB 14 and VB 15
-- so the two new courts cannot be sold underneath a tournament that already has that whole end of
-- the floor. Over-reserving is the safe direction; the unit 2 sheet import replaces these coarse
-- rows with zone-exact ones. A booking holding only some of 9–13 is left exactly as it is.
--
-- NOT ADDED, ON PURPOSE. Shoot 360 bays: the sheet shows Shoot 360 in Zone 1 from 4 to 5 PM, so it
-- is unsettled whether the hoops are their own area or share Zone 1 — an atom for a space that
-- overlaps another atom would let the same floor be sold twice. Asked of the owner. Party Rooms
-- 1–2 are new atoms; whether they are the same physical rooms as Dance-Den 1–2 is also asked
-- (spec §7.5). Neither pair has a single live booking, so nothing can double-book before he answers.

-- 1. Atoms. Courts keep sort 1–15 (chooseCourts takes courts in sort order); rooms move behind.
UPDATE spaces SET sort = sort + 10, updated_at = datetime('now') WHERE id BETWEEN 14 AND 19;
INSERT INTO spaces (id, name, kind, sort) VALUES
 (20,'VB 14','court',14),(21,'VB 15','court',15),
 (22,'Party Room 1','room',30),(23,'Party Room 2','room',31),
 (24,'Corral 1','room',32),(25,'Corral 2','room',33);

-- 2. Presets.
UPDATE space_presets SET name = 'All Courts (VB 1–15)',            updated_at = datetime('now') WHERE id = 1;
UPDATE space_presets SET name = 'Sports Court (VB 9–15)',          updated_at = datetime('now') WHERE id = 3;
UPDATE space_presets SET name = 'Zone 1 · Basketball 1 (VB 1–2)',  updated_at = datetime('now') WHERE id = 4;
UPDATE space_presets SET name = 'Zone 2 · Basketball 2 (VB 3–4)',  updated_at = datetime('now') WHERE id = 5;
UPDATE space_presets SET name = 'Zone 3 · Basketball 3 (VB 5–6)',  updated_at = datetime('now') WHERE id = 6;
UPDATE space_presets SET name = 'Zone 4 · Basketball 4 (VB 7–8)',  updated_at = datetime('now') WHERE id = 7;
UPDATE space_presets SET sort = 20,                                updated_at = datetime('now') WHERE id = 8;
INSERT INTO space_presets (id, name, sort) VALUES
 (9,'Zone 5 · A1 (VB 9–10)',8),(10,'Zone 6 · SC (VB 11–12)',9),
 (11,'Zone 7 · Futsal / Inflatables (VB 13–15)',10),(12,'Studio (Party Rooms 1–2)',11);
INSERT INTO preset_spaces (preset_id, space_id) VALUES
 (1,20),(1,21),(3,20),(3,21),
 (9,9),(9,10),(10,11),(10,12),(11,13),(11,20),(11,21),(12,22),(12,23);
INSERT INTO preset_spaces (preset_id, space_id) SELECT 8, id FROM spaces WHERE id BETWEEN 20 AND 25;

-- 3. Existing whole-end bookings gain the two new courts (see EXISTING BOOKINGS above).
INSERT INTO booking_spaces (booking_id, space_id)
SELECT w.booking_id, n.id
FROM (SELECT booking_id FROM booking_spaces WHERE space_id BETWEEN 9 AND 13
      GROUP BY booking_id HAVING COUNT(*) = 5) w
JOIN spaces n ON n.id IN (20, 21);

-- 4. Shoot 360 Denver: an operator label on the facility calendar, shaped exactly like
--    External / Rental (org 10) — not a tenant, so inactive and not owned.
INSERT INTO orgs (name, slug, brand_json, is_owned, active, deactivated_at) VALUES
 ('Shoot 360 Denver','shoot-360-denver','{"facility_color":"#C94F4F","facility_only":1}',0,0,datetime('now'));

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0055',
  '2026-11-20_0055_facility-zones_v1_0.sql',
  'Facility: VB 14-15 (15 courts), Zone 1-7 presets (basketball presets renamed), Party Room 1-2, Corral 1-2, Shoot 360 Denver operator org. Whole-end bookings (all of VB 9-13) gain VB 14-15. Data only, no DDL.'
);
