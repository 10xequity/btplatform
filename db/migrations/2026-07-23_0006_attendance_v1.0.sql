-- Boomtown Platform — Migration 0006: Check-in & attendance (Module 10)
-- File: db/2026-07-23_0006_attendance_v1.0.sql · Version: v1.0 · Date: 2026-07-23
-- ADDITIVE ONLY. Safe to run once on live D1 AFTER 0005. No data modified or dropped.

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER REFERENCES contacts(id),        -- matched member (nullable for walk-ins)
  team_member_id INTEGER REFERENCES team_members(id),-- roster row this check-in belongs to (nullable)
  name_snapshot TEXT,                                -- what was shown/typed at the door
  method TEXT NOT NULL DEFAULT 'staff',              -- 'staff' (door tap) | 'self' (QR link)
  checked_by_user_id INTEGER,                        -- staff user for method='staff'
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT                                    -- soft delete = "undo check-in"
);
CREATE INDEX IF NOT EXISTS idx_attendance_event ON attendance (event_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_attendance_contact ON attendance (contact_id, deleted_at);

-- Rotating token that makes the public self-check-in link/QR work (like score links).
ALTER TABLE events ADD COLUMN checkin_token TEXT;
