-- Boomtown Platform — Migration 0031: LFG & community play (lfg.js, v0.45.0)
-- File: db/migrations/2026-08-01_0031_lfg_v1_0.sql · Version: v1.0 · Date: 2026-08-01
-- STATUS: APPLIED to live D1 on 2026-08-01 (schema_migrations row 0031 exists). This file
-- was reconstructed byte-faithful from the live sqlite_master so the repo matches D1 —
-- the original release ZIP carrying it was never uploaded. Every statement is idempotent
-- (IF NOT EXISTS / INSERT OR IGNORE): re-running it is a no-op, not a failure.
-- ADDITIVE ONLY. org_id + soft-delete on every table (standards §3).

CREATE TABLE IF NOT EXISTS lfg_listings (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                 INTEGER NOT NULL REFERENCES orgs(id),
  kind                   TEXT NOT NULL CHECK (kind IN ('team_need','player_avail','casual')),
  forming                INTEGER NOT NULL DEFAULT 0,          -- team_need: the shell exists immediately
  created_by_contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  team_name              TEXT,
  skill_level            TEXT NOT NULL DEFAULT 'any',
  gender_requirement     TEXT NOT NULL DEFAULT 'any',
  game_type              TEXT NOT NULL DEFAULT 'any',
  positions              TEXT,
  spots                  INTEGER,
  play_at                TEXT,                                 -- optional; casual play may be free-form
  location_note          TEXT,
  note                   TEXT,
  status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','closed')),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_lfg_listings_open  ON lfg_listings(org_id, status, kind, deleted_at);
CREATE INDEX IF NOT EXISTS idx_lfg_listings_owner ON lfg_listings(org_id, created_by_contact_id);

CREATE TABLE IF NOT EXISTS lfg_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  listing_id    INTEGER NOT NULL REFERENCES lfg_listings(id),
  contact_id    INTEGER NOT NULL REFERENCES contacts(id),
  status        TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','withdrawn')),
  is_bail       INTEGER NOT NULL DEFAULT 0,                    -- withdrawal inside BAIL_WINDOW_HOURS
  joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_lfg_members_listing ON lfg_members(org_id, listing_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_lfg_members_contact ON lfg_members(org_id, contact_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lfg_members_live
  ON lfg_members(org_id, listing_id, contact_id) WHERE status='committed' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lfg_strikes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                  INTEGER NOT NULL REFERENCES orgs(id),
  contact_id              INTEGER NOT NULL REFERENCES contacts(id),
  listing_id              INTEGER REFERENCES lfg_listings(id),
  kind                    TEXT NOT NULL CHECK (kind IN ('no_show','bail')),
  reported_by_contact_id  INTEGER REFERENCES contacts(id),
  cleared_at              TEXT,                                -- set when consumed by a ban
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT
);
CREATE INDEX IF NOT EXISTS idx_lfg_strikes_contact ON lfg_strikes(org_id, contact_id, kind, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lfg_strikes_once
  ON lfg_strikes(org_id, listing_id, contact_id, kind) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS lfg_bans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES orgs(id),
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  reason      TEXT,
  starts_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at     TEXT NOT NULL,                                   -- auto-unban: gate checks ends_at < now
  lifted_at   TEXT,                                            -- staff early lift
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_lfg_bans_contact ON lfg_bans(org_id, contact_id, ends_at);

-- Ledger row (already present on live D1 — OR IGNORE keeps this file a safe no-op there).
INSERT OR IGNORE INTO schema_migrations (version, filename, note)
VALUES ('0031', '2026-08-01_0031_lfg_v1_0.sql', 'LFG & community play — listings, commitments, reliability strikes/bans (v0.45.0)');
