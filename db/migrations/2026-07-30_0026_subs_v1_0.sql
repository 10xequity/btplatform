-- Boomtown Platform — Migration 0026: League sub finder
-- File: db/migrations/2026-07-30_0026_subs_v1_0.sql · Version: v1.0 · Date: 2026-07-30
-- Ships in: v0.38.0 · Owner requirement #7 (verbatim): report missing / search for a sub;
-- people who want to substitute sign up for notifications, listing skill-level preference,
-- gender requirements and type of game. Additive only. org_id + deleted_at per standards §3.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 0. Orphan reconciliation (found during live apply, 2026-07-30). Live D1 carried a
--    0-row sub_requests table in a DIFFERENT shape (requester_contact_id / level /
--    claimed_*) — undocumented DDL from an earlier session: no repo migration, no
--    ledger row, no audit trail. Dropped and rebuilt to this spec, per the 0025
--    access_tokens "rebuilt (0 rows)" precedent. On a fresh DB this is a no-op.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS sub_requests;

-- ---------------------------------------------------------------------------
-- 1. sub_signups — "I'm available to sub." One LIVE signup per contact per org.
--    Preference columns are lowercase CSV lists ('any' matches everything);
--    normalization is enforced in worker/src/subs.js normalizeSignup(), the only writer.
-- ---------------------------------------------------------------------------
CREATE TABLE sub_signups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  contact_id    INTEGER NOT NULL REFERENCES contacts(id),
  skill_levels  TEXT NOT NULL DEFAULT 'any',   -- csv of: any,b,bb,a,aa,open
  genders       TEXT NOT NULL DEFAULT 'any',   -- csv of: any,coed,mens,womens,reverse
  game_types    TEXT NOT NULL DEFAULT 'any',   -- csv of: any,2s,4s,6s
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_sub_signups_live
  ON sub_signups(org_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sub_signups_org ON sub_signups(org_id, deleted_at);

-- ---------------------------------------------------------------------------
-- 2. sub_requests — "We're short a player." status CHECK mirrors the registrations
--    pattern; filled_by records who claimed it so the requester knows who is coming.
-- ---------------------------------------------------------------------------
CREATE TABLE sub_requests (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                  INTEGER NOT NULL REFERENCES orgs(id),
  event_id                INTEGER REFERENCES events(id),   -- optional link to a league event
  requested_by_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  needed_at               TEXT,                            -- when the body is needed on court
  skill_level             TEXT NOT NULL DEFAULT 'any',     -- single value: any,b,bb,a,aa,open
  gender_requirement      TEXT NOT NULL DEFAULT 'any',     -- single value: any,coed,mens,womens,reverse
  game_type               TEXT NOT NULL DEFAULT 'any',     -- single value: any,2s,4s,6s
  note                    TEXT,
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  filled_by_contact_id    INTEGER REFERENCES contacts(id),
  filled_at               TEXT,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at              TEXT
);
CREATE INDEX idx_sub_requests_open ON sub_requests(org_id, status, deleted_at);
CREATE INDEX idx_sub_requests_requester ON sub_requests(org_id, requested_by_contact_id);

-- ---------------------------------------------------------------------------
-- 3. Ledger. version + filename required; a release is not shipped until this
--    row exists (recurring pattern 4).
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (version, filename, applied_at, note)
VALUES ('0026', '2026-07-30_0026_subs_v1_0.sql', datetime('now'),
        'v0.38.0 — league sub finder (owner req #7): sub_signups (one live per contact/org, CSV prefs) + sub_requests (open/filled/cancelled, optional event link)');
