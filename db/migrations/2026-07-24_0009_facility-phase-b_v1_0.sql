-- Boomtown Platform — Migration 0009: M12 Phase B (auto-claim source + rental requests)
-- File: db/migrations/2026-07-24_0009_facility-phase-b_v1_0.sql · Version: v1.0 · Date: 2026-07-24
-- ⚠️ STATUS: ALREADY APPLIED TO LIVE D1 (boomtown-prod) via Cloudflare MCP on 2026-07-24.
-- ⚠️ THIS FILE IS A RECORD. NEVER RUN IT AGAINST THE LIVE DATABASE.
-- Additive only: 1 column, 1 table, 1 index. No existing data changed.

-- Distinguishes manual bookings from scheduler auto-claims and approved rentals.
ALTER TABLE space_bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'; -- 'manual'|'auto'|'rental'

CREATE TABLE rental_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 10 REFERENCES orgs(id),   -- External / Rental
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_phone TEXT,
  date TEXT NOT NULL,                                       -- YYYY-MM-DD
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  spaces_text TEXT,                                         -- free-text wish ("2 courts", "Yoga-Den")
  est_attendees INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  booking_id INTEGER REFERENCES space_bookings(id),         -- set on approval
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_rental_requests_status ON rental_requests(status);

-- Changelog: v1.0 (2026-07-24) — applied live via MCP; DB now 53 tables.
