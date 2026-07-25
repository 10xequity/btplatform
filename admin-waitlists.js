-- Boomtown Platform — Migration 0013: Waitlists
-- File: db/migrations/2026-07-25_0013_waitlists_v1_0.sql · Version: v1.0 · Date: 2026-07-25
-- Ships in: v0.19.0 · APPLIED LIVE 2026-07-25 via Cloudflare MCP (additive-only, rule 6).
-- registrations.status already allowed 'cancelled' (day-one CHECK) — no ALTER needed.
CREATE TABLE IF NOT EXISTS waitlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER REFERENCES contacts(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  team_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','offered','claimed','expired','removed')),
  position INTEGER NOT NULL,
  offer_token TEXT,
  offer_expires_at TEXT,
  offered_at TEXT,
  claimed_registration_id INTEGER REFERENCES registrations(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_waitlists_event ON waitlists(event_id, status, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlists_token ON waitlists(offer_token) WHERE offer_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlists_email ON waitlists(event_id, email);
