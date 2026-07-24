-- Boomtown Platform — Migration 0008: Court & Facility Management (Module 12)
-- File: db/migrations/2026-07-24_0008_facility_v1_0.sql · Version: v1.0 · Date: 2026-07-24
-- ⚠️ STATUS: ALREADY APPLIED TO LIVE D1 (boomtown-prod) via Cloudflare MCP on 2026-07-24.
-- ⚠️ THIS FILE IS A RECORD. NEVER RUN IT AGAINST THE LIVE DATABASE.
-- Additive only: 5 new tables, 2 indexes, seed rows (19 spaces, 8 presets), 7 new operator orgs
-- (ids 4–10), facility_color added to brand_json on orgs 1–3. No existing table altered.

CREATE TABLE spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                                -- 'VB 1'…'VB 13', 'Dance-Den 1', …
  kind TEXT NOT NULL CHECK (kind IN ('court','room')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE space_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                                -- 'Full Hardwood (VB 1–8)', …
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE preset_spaces (                          -- which atoms a preset reserves
  preset_id INTEGER NOT NULL REFERENCES space_presets(id),
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  PRIMARY KEY (preset_id, space_id)
);

CREATE TABLE space_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),        -- operator
  event_id INTEGER REFERENCES events(id),             -- NULL for rentals/closures (Phase B links schedulers)
  title TEXT NOT NULL,
  date TEXT NOT NULL,                                 -- YYYY-MM-DD
  start_min INTEGER NOT NULL,                         -- minutes from midnight
  end_min INTEGER NOT NULL,
  preset_id INTEGER REFERENCES space_presets(id),     -- how it was booked (display only; atoms are truth)
  share_ok INTEGER NOT NULL DEFAULT 0,                -- Court Share flag: both sides 1 → warning not conflict
  is_closure INTEGER NOT NULL DEFAULT 0,              -- closures always hard-conflict
  staffing_json TEXT DEFAULT '{}',                    -- {"facility":2,"bar":1,"roles":"…"}
  catering TEXT,
  door_charge_cents INTEGER,
  poc_name TEXT, poc_email TEXT, poc_phone TEXT,
  est_attendees INTEGER,
  series_id TEXT,                                     -- weekly repeat groups share one uuid
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE booking_spaces (                          -- atoms a booking reserves
  booking_id INTEGER NOT NULL REFERENCES space_bookings(id),
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  PRIMARY KEY (booking_id, space_id)
);

CREATE INDEX idx_space_bookings_date ON space_bookings(date);
CREATE INDEX idx_booking_spaces_space ON booking_spaces(space_id);

-- ---- seed: atoms ----
INSERT INTO spaces (id, name, kind, sort) VALUES
 (1,'VB 1','court',1),(2,'VB 2','court',2),(3,'VB 3','court',3),(4,'VB 4','court',4),
 (5,'VB 5','court',5),(6,'VB 6','court',6),(7,'VB 7','court',7),(8,'VB 8','court',8),
 (9,'VB 9','court',9),(10,'VB 10','court',10),(11,'VB 11','court',11),(12,'VB 12','court',12),
 (13,'VB 13','court',13),
 (14,'Dance-Den 1','room',14),(15,'Dance-Den 2','room',15),(16,'Yoga-Den','room',16),
 (17,'Social Den','room',17),(18,'Event-Den','room',18),(19,'Oda','room',19);

-- ---- seed: presets (owner-confirm the basketball overlay mapping — [INTERPRETATION]) ----
INSERT INTO space_presets (id, name, sort) VALUES
 (1,'All Courts (VB 1–13)',1),(2,'Full Hardwood (VB 1–8)',2),(3,'Sports Court (VB 9–13)',3),
 (4,'Basketball Ct 1 (VB 1–2)',4),(5,'Basketball Ct 2 (VB 3–4)',5),
 (6,'Basketball Ct 3 (VB 5–6)',6),(7,'Basketball Ct 4 (VB 7–8)',7),
 (8,'Whole Facility (closure)',8);
INSERT INTO preset_spaces (preset_id, space_id) SELECT 1, id FROM spaces WHERE id BETWEEN 1 AND 13;
INSERT INTO preset_spaces (preset_id, space_id) SELECT 2, id FROM spaces WHERE id BETWEEN 1 AND 8;
INSERT INTO preset_spaces (preset_id, space_id) SELECT 3, id FROM spaces WHERE id BETWEEN 9 AND 13;
INSERT INTO preset_spaces (preset_id, space_id) VALUES (4,1),(4,2),(5,3),(5,4),(6,5),(6,6),(7,7),(7,8);
INSERT INTO preset_spaces (preset_id, space_id) SELECT 8, id FROM spaces;

-- ---- seed: operator orgs (decision D-M12-1) ----
INSERT INTO orgs (id, name, slug, brand_json) VALUES
 (4,'Colorado Boom','colorado-boom','{"facility_color":"#5B9BD5","facility_only":0}'),
 (5,'Oda Up','oda-up','{"facility_color":"#E09540","facility_only":1}'),
 (6,'Rocky Mountain Rumble','rmr','{"facility_color":"#8E6BC8","facility_only":1}'),
 (7,'Real Futsal','real-futsal','{"facility_color":"#3FA66A","facility_only":1}'),
 (8,'Special Olympics CO','special-olympics-co','{"facility_color":"#C94F4F","facility_only":1}'),
 (9,'Zara Gymnastics','zara-gymnastics','{"facility_color":"#4FB8B0","facility_only":1}'),
 (10,'External / Rental','external-rental','{"facility_color":"#7A7F87","facility_only":1}');
UPDATE orgs SET brand_json = json_set(brand_json,'$.facility_color','#F5C400') WHERE id = 1; -- Boomtown
UPDATE orgs SET brand_json = json_set(brand_json,'$.facility_color','#D46FA8') WHERE id = 2; -- Match Point Social
UPDATE orgs SET brand_json = json_set(brand_json,'$.facility_color','#B08D2F') WHERE id = 3; -- Queens Club

-- Changelog: v1.0 (2026-07-24) — initial facility schema + seed, applied live via MCP.
