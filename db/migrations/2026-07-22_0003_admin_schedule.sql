-- Boomtown Platform — Migration 0003 · Version: v0.4.0 · Date: 2026-07-22
-- Additive only (same rule as 0002). Adds: schedule view profiles (spec §3.7),
-- event templates, programs, and recurring-series columns on events.

ALTER TABLE events ADD COLUMN series_id TEXT;          -- shared by all instances of a recurring series
ALTER TABLE events ADD COLUMN program_id INTEGER REFERENCES programs(id);
ALTER TABLE events ADD COLUMN recurrence_json TEXT;    -- rule stored on each instance for audit

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'event' CHECK (type IN ('tournament','league','training','event','court_rental')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS event_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',   -- {type,name,location,price_cents,capacity,court_count,format_template,cash_option_enabled,config_json}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS schedule_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                 -- 'public', 'internal', or random token for custom views
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('public','internal','custom')),
  show_names INTEGER NOT NULL DEFAULT 0,     -- participant names (default hidden, spec §3.7)
  show_counts INTEGER NOT NULL DEFAULT 0,    -- participant counts (default hidden)
  org_id INTEGER REFERENCES orgs(id),        -- NULL = all orgs
  type_filter TEXT,                          -- comma list of event types, NULL = all
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

INSERT INTO schedule_views (slug, name, kind, show_names, show_counts)
  SELECT 'public', 'Public', 'public', 0, 0
  WHERE NOT EXISTS (SELECT 1 FROM schedule_views WHERE slug='public');
INSERT INTO schedule_views (slug, name, kind, show_names, show_counts)
  SELECT 'internal', 'Internal', 'internal', 1, 1
  WHERE NOT EXISTS (SELECT 1 FROM schedule_views WHERE slug='internal');

CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
