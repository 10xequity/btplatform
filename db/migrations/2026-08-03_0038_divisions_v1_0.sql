-- Boomtown Platform — Migration 0038: divisions as a real thing
-- File: 2026-08-03_0038_divisions_v1_0.sql · Version: v1.0 · Date: 2026-08-03
--
-- Source of decision: owner 2026-08-03 — "build full tournaments (relate to number of courts 12 vb
-- courts) and add x3 4 court divisions", plus a bracket that can "analyze team wins and balance
-- teams in bracket based on number of wins ... those 2 can be dropped or moved into another
-- division."
--
-- sqlite_master check (F-41), run live 2026-08-03 BEFORE this design was fixed:
--   No table matching division / court exists. `pools` EXISTS (id, org_id, event_id, name) and
--   `matches.pool_id` references it. `teams` carries `level` TEXT ('BB/A') and `gender_division`
--   TEXT ('Coed') — free text, with nothing tying either to courts, to a bracket, or to each other.
--
-- WHY NOT REUSE `pools` OR `teams.level`. A pool and a division are different objects and conflating
-- them would make the owner's actual request unanswerable. A DIVISION is a competitive tier that
-- owns a set of courts and produces its own bracket. A POOL is a group inside a division that plays
-- a round-robin; a big division has several. `teams.level` is a label a human typed — you cannot
-- move a team "down a division" by editing a string, because there is nothing on the other end to
-- move it INTO, and nothing that knows how many teams are left on either side afterwards.
--
-- COURTS ARE A RANGE, NOT A COUNT. Twelve courts split three ways is not "4 courts each" — it is
-- courts 1-4, 5-8 and 9-12, and which is which matters to everyone in the building. Storing a count
-- would let two divisions be assigned the same physical court and nothing would notice.
--
-- `rank` IS THE ORDERING THAT MATTERS. 1 is the top division. Every balancing rule the owner
-- described is expressed in terms of it: the top division aims for exactly 8, and a misplaced team
-- moves to rank+1. Sorting by name would put "A" and "AA" in the wrong order on the day it matters.

CREATE TABLE IF NOT EXISTS divisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 1,          -- 1 = top division
  court_from INTEGER,                        -- inclusive; NULL = not yet assigned
  court_to INTEGER,                          -- inclusive
  target_bracket_size INTEGER,               -- the engine's proposal, or an override the director typed
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_divisions_event_rank
  ON divisions (org_id, event_id, rank) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_divisions_event
  ON divisions (org_id, event_id) WHERE deleted_at IS NULL;

ALTER TABLE teams ADD COLUMN division_id INTEGER REFERENCES divisions(id);
ALTER TABLE brackets ADD COLUMN division_id INTEGER REFERENCES divisions(id);

CREATE INDEX IF NOT EXISTS idx_teams_division
  ON teams (org_id, division_id) WHERE division_id IS NOT NULL AND deleted_at IS NULL;

-- Every move the balancer proposes is recorded, whether or not it was accepted.
--
-- WHY KEEP THE REJECTED ONES. Dropping a team out of bracket play, or moving them down a tier, is
-- a conversation with a parent — and the question that follows is always "why?". A row here answers
-- it with the numbers as they stood at the time: 2 wins against a division median of 6. Keeping
-- only the accepted moves would throw away the record of a decision that was considered and
-- deliberately not taken, which is exactly the one somebody asks about later.
CREATE TABLE IF NOT EXISTS division_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  from_division_id INTEGER REFERENCES divisions(id),
  to_division_id INTEGER REFERENCES divisions(id),   -- NULL when the proposal is to drop from bracket play
  kind TEXT NOT NULL CHECK (kind IN ('move_down','move_up','drop_from_bracket','mini_bracket')),
  reason TEXT NOT NULL,                              -- plain English, shown to the director as-is
  wins INTEGER, losses INTEGER, games_played INTEGER, division_median_wins REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected')),
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_division_moves_event
  ON division_moves (org_id, event_id, status) WHERE deleted_at IS NULL;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0038', '2026-08-03_0038_divisions_v1_0.sql',
        'Divisions as a real entity: divisions (name, rank where 1=top, court_from/court_to as an inclusive RANGE not a count, target_bracket_size), teams.division_id, brackets.division_id. Plus division_moves, which records every rebalance the engine PROPOSES along with the numbers behind it and whether the director accepted it — rejected proposals are kept deliberately, because "why was my team moved down" is asked after the fact.');
