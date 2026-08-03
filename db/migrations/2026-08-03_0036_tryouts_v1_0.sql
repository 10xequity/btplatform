-- Boomtown Platform — Migration 0036: Tryouts — player card, coach evaluation, team building
-- File: 2026-08-03_0036_tryouts_v1_0.sql · Version: v1.0 · Date: 2026-08-03
-- Source of decision: owner 2026-08-03, verbatim intent:
--   "we need an easy way to put notes for players when they come through the registration. when
--    they try out or register for try out, this should populate a coaches or evaluator page which
--    is simply name - position - age - prev club (asked during registration) - then a blank area
--    for coaches to write or type - then a quick check to offer not offer mark."
--   plus a team builder whose blocks show "players name, position, height, rating (coach
--    assigned), age group willing to play … a small note section from notes recorded".
--
-- sqlite_master check (F-41), run live 2026-08-03 BEFORE this design was fixed:
--   nothing matching tryout / evaluation / placement exists (only idx_sponsors_org_placement,
--   which is ad placement on a page — unrelated).
--   `member_profiles` HAS positions / skill_level / height_reach, but those are the member's own
--   standing profile. A tryout is a POINT IN TIME for ONE event: what they said that day, and what
--   a coach thought that day. Overwriting the standing profile each tryout would destroy last
--   season's answers, so this is separate and event-scoped.
--   `member_fields` (0034) is the generic custom-field registry. It is the right tool for an org's
--   own one-off questions, and the wrong one here: the evaluator page and the team builder need to
--   SORT and FILTER on position, age group and rating, which means real columns, not a key/value
--   bag. Both exist; they answer different questions.
--
-- WHY TWO TABLES. `tryout_profiles` is what the PLAYER said at registration. `tryout_evaluations`
-- is what a COACH wrote after watching. Mixing them would let an evaluation edit overwrite the
-- player's own answers, and would make "who said this" unanswerable.
--
-- ONE EVALUATION PER COACH PER PLAYER PER TRYOUT, enforced by a partial unique index. Several
-- coaches evaluating the same player independently is the point — a director wants to see that
-- two of three said offer. A coach accidentally creating five rows for one player is not.
--
-- NO SCREENING OR CLEARANCE FIELDS (owner 2026-07-26, standing). Nothing here records a background
-- check, and nothing should be added later that does.
--
-- Additive only (standards §3). org_id + deleted_at on every table (D-MIG, multi-company day-1).

CREATE TABLE tryout_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  event_id      INTEGER NOT NULL REFERENCES events(id),
  contact_id    INTEGER NOT NULL REFERENCES contacts(id),
  -- JSON arrays: ["OH","RS"] and ["14U","15U"]. Small, bounded lists the UI filters on.
  positions     TEXT NOT NULL DEFAULT '[]',
  age_groups    TEXT NOT NULL DEFAULT '[]',
  height_cm     INTEGER,
  prev_club     TEXT,
  jersey_size   TEXT,
  player_note   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_tryout_profiles_live
  ON tryout_profiles (org_id, event_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tryout_profiles_event
  ON tryout_profiles (org_id, event_id) WHERE deleted_at IS NULL;

CREATE TABLE tryout_evaluations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id               INTEGER NOT NULL REFERENCES orgs(id),
  event_id             INTEGER NOT NULL REFERENCES events(id),
  contact_id           INTEGER NOT NULL REFERENCES contacts(id),
  evaluator_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  -- 1–5, coach's own scale. Feeds the team builder's block; never shown to the player, and
  -- never combined into a public rating (owner 2026-08-03: results belong to a team).
  rating               INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  notes                TEXT,
  verdict              TEXT NOT NULL DEFAULT 'undecided'
                       CHECK (verdict IN ('offer','no_offer','undecided')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at           TEXT
);
CREATE UNIQUE INDEX ux_tryout_eval_live
  ON tryout_evaluations (org_id, event_id, contact_id, evaluator_contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tryout_eval_event
  ON tryout_evaluations (org_id, event_id) WHERE deleted_at IS NULL;

-- Team building. A "squad" is a team being assembled during placement — deliberately NOT the
-- `teams` table, which is a team ENTERED IN AN EVENT with a bracket and standings. Placement is a
-- planning exercise that must be safe to shuffle, discard and redo; committing a squad to a real
-- roster is a separate, deliberate step.
CREATE TABLE tryout_squads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  event_id      INTEGER NOT NULL REFERENCES events(id),
  name          TEXT NOT NULL,
  age_group     TEXT,
  colour        TEXT,
  target_size   INTEGER NOT NULL DEFAULT 10,
  -- JSON object of position → how many this squad still wants, e.g. {"S":1,"MB":2}
  needs_json    TEXT NOT NULL DEFAULT '{}',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX idx_tryout_squads_event ON tryout_squads (org_id, event_id) WHERE deleted_at IS NULL;

CREATE TABLE tryout_squad_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES orgs(id),
  squad_id     INTEGER NOT NULL REFERENCES tryout_squads(id),
  contact_id   INTEGER NOT NULL REFERENCES contacts(id),
  position     TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);
-- A player may sit in only ONE squad per tryout at a time. The board is a placement, not a
-- wishlist: two coaches each dragging the same setter into their own squad is the exact confusion
-- this prevents, and the index makes it impossible rather than merely discouraged.
CREATE UNIQUE INDEX ux_tryout_squad_member_live
  ON tryout_squad_members (org_id, contact_id, squad_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tryout_squad_members_squad
  ON tryout_squad_members (org_id, squad_id) WHERE deleted_at IS NULL;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0036', '2026-08-03_0036_tryouts_v1_0.sql',
        'Tryouts: tryout_profiles (what the player said at registration — positions, age groups, height, prev club), tryout_evaluations (per-coach notes + 1-5 rating + offer/no_offer, one per coach per player per event), tryout_squads + tryout_squad_members (placement board, one squad per player, separate from real teams)');
