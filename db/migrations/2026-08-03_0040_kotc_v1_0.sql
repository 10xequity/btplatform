-- Boomtown Platform — Migration 0040: King / Queen of the Court
-- File: 2026-08-03_0040_kotc_v1_0.sql · Version: v1.0 · Date: 2026-08-03
--
-- Source of decision: owner 2026-08-03, verbatim (full text in docs/2026-08-03_spec_kotc_v1_0.md §1):
--   "that singleplayer is usually a league format for a single entry - queens or kings style
--    tournament, where they are paired with another person - draft format. This is just a format to
--    play. they will play with everyone then change the next round where the top players on that net
--    move to the next completing 4 to a net. They will enter scores, which tally and then ranked and
--    seeded. They then fill the next net based on number of nets - determine number of players going
--    up."
--   And on repeats: "yes they can repeat - idealy not if possible, but it can happen, not a fixed
--    position."
--
-- sqlite_master check (F-41), run live against 6cde5d11 on 2026-08-03 BEFORE this file was written:
--   SELECT type, name FROM sqlite_master WHERE name LIKE 'kotc%' → zero rows.
--   Live ledger MAX(version) = '0039', 39 rows applied. Repo highest = 0039. Agreed.
--   None of the four table names below exist in any form.
--
-- WHY NOTHING THAT ALREADY EXISTS CAN HOLD THIS.
-- `teams` is the unit of play in every other format: a team registers, a team is scheduled, a team
-- appears in standings, a team wins. Here an INDIVIDUAL registers and a partnership lasts exactly one
-- game. Writing throwaway two-person rows into `teams` would put roughly three rows per player per
-- round into the table every other report reads, and `standings` would fill with pairs that existed
-- for eleven minutes. There is no column to add that fixes that; the unit of play is different.
--
-- STANDINGS ARE DERIVED FROM `kotc_games`, NEVER STORED.
-- No per-player points column anywhere below. This is the lesson the passes module already paid for
-- (F-26): a stored counter and the rows it was computed from WILL disagree eventually, and the
-- counter is the one people will have been reading off a screen. A player's total is a SUM over the
-- games they were in, computed on read, every time.
--
-- `move_up` IS A NUMBER THE DIRECTOR SETS, NOT A FORMULA. Owner 2026-08-03, asked directly for the
-- rule: "We take the top 8 scores amongst nets, usually its 1 per net for equity. But with fewer
-- nets, we may take more than 1." Offered four candidate formulas — including two that reproduce
-- "top 8" exactly at four and eight nets — the owner chose **"Director sets it each session."** So it
-- is stored per session and defaults to 1, which is the owner's own "usually 1 per net for equity".
-- No formula is encoded anywhere, deliberately: a formula here would be this file guessing at a rule
-- the owner declined to fix, and the guess would then be quoted back as a decision.
--
-- `points_to` IS PER SESSION, DEFAULT 21. Owner chose "first to 21, no cap, director can change it"
-- over the pool rule of 25 (cap 27): a round is three games on one net, and a net still playing while
-- three others have finished is what stalls the night. NO `cap` COLUMN — "no cap" was the choice, and
-- a nullable cap column would invite a default that quietly reinstated one.
--
-- THE EIGHT-GAME FLOOR DOES NOT APPLY HERE. Owner 2026-08-03: asked whether `MIN_GAMES_PER_TEAM = 8`
-- (a pool-play promise about a tournament day) should reach this format, the answer was "No — this
-- format sets its own length." A league night finishes when it finishes. There is no minimum-rounds
-- column and no check, and that absence is a recorded decision rather than an omission.
--
-- A NET OF FIVE IS A REAL SHAPE, NOT A DEGRADED ONE. Owner, on a field that is not a multiple of
-- four: "we would fill each person to join an existing net and do a 5 team rotation rotating pairs.
-- However, this should not happen where people drop, we would go in with even numbers." Five players
-- on a net play FIVE games in which every pair partners exactly once and every player sits out
-- exactly one game — C(5,2) = 10 pairs, 5 games × 2 pairs = 10. It is a complete rotation, not a
-- compromise, so no scaling or scoring adjustment is needed and none is stored. `seat` therefore runs
-- 0..4, not 0..3. (This is a distinct thing from the "rotating pairs" FORMAT the owner descoped on
-- 2026-08-03 — that was a whole tournament shape; this is one net's internal rotation.)

CREATE TABLE IF NOT EXISTS kotc_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  -- 4 normally; a net of 5 is a per-net fact the engine derives, not a session-wide setting.
  players_per_net INTEGER NOT NULL DEFAULT 4,
  -- Director-set, per session. 1 = "the top scorer on each net goes up, the bottom scorer goes down".
  move_up INTEGER NOT NULL DEFAULT 1,
  points_to INTEGER NOT NULL DEFAULT 21,
  rounds_planned INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS kotc_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  session_id INTEGER NOT NULL REFERENCES kotc_sessions(id),
  round_no INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Who stood on which net for one round. `seat` is a position within the net, 0-based, and it is what
-- the pairing rotation indexes — so it decides which three (or five) games get generated, and two
-- players on the same seat would generate a game nobody can play.
CREATE TABLE IF NOT EXISTS kotc_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  round_id INTEGER NOT NULL REFERENCES kotc_rounds(id),
  net_no INTEGER NOT NULL,                        -- 1 is the top net
  seat INTEGER NOT NULL,                          -- 0..3, or 0..4 on a net of five
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- THE FOUR PLAYERS ARE STORED ON THE GAME, not looked up through the slots. A director moves people
-- between nets on the day — that is the whole premise of the format — and a game that resolved its
-- players through `kotc_slots` would silently change who played it every time somebody was dragged.
-- The result of a game that has been played is a fact about four named people at a moment.
CREATE TABLE IF NOT EXISTS kotc_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  round_id INTEGER NOT NULL REFERENCES kotc_rounds(id),
  net_no INTEGER NOT NULL,
  game_no INTEGER NOT NULL,                       -- 1..3 on a net of four, 1..5 on a net of five
  a1_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  a2_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  b1_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  b2_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  score_a INTEGER,
  score_b INTEGER,
  points_to INTEGER NOT NULL DEFAULT 21,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_kotc_sessions_event
  ON kotc_sessions (org_id, event_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_rounds_no
  ON kotc_rounds (org_id, session_id, round_no) WHERE deleted_at IS NULL;
-- One player cannot be in two seats, and one seat cannot hold two players. Both directions, because
-- the board writes a whole round at a time and either mistake produces a game that cannot be played.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_slots_seat
  ON kotc_slots (org_id, round_id, net_no, seat) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_slots_person
  ON kotc_slots (org_id, round_id, contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_games_no
  ON kotc_games (org_id, round_id, net_no, game_no) WHERE deleted_at IS NULL;
-- The index every standings read goes through: sum a player's games without scanning the table.
CREATE INDEX IF NOT EXISTS idx_kotc_games_round
  ON kotc_games (org_id, round_id, net_no) WHERE deleted_at IS NULL;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0040', '2026-08-03_0040_kotc_v1_0.sql',
        'King / Queen of the Court: kotc_sessions, kotc_rounds, kotc_slots, kotc_games. Individuals enter rather than teams and a partnership lasts one game, so nothing in `teams` can hold it — throwaway two-person team rows would pollute teams, standings and every report reading them. Per-player standings are DERIVED from kotc_games and never stored (the F-26 lesson). move_up is a number the director sets per session, default 1, with no formula encoded: the owner was offered four candidate formulas and chose "director sets it each session". points_to defaults to 21 with NO cap column, because "no cap" was the choice. The eight-game floor deliberately does not apply — owner: "this format sets its own length". A net of five is a complete rotation (all 10 pairs, each player sitting out once), not a degraded four, so seat runs 0..4 and no scoring adjustment is stored.');
