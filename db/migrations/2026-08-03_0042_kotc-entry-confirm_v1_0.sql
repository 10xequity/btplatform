-- Boomtown Platform — Migration 0042: the KOTC entry list, per-player links, and confirmation
-- File: 2026-08-03_0042_kotc-entry-confirm_v1_0.sql · Version: v1.0 · Date: 2026-08-03
--
-- Source of decision: owner 2026-08-03, answering the last open question on King / Queen of the Court:
--   "lets do both - but ideally 1 person fill it out for everyone would be nice. then back up each
--    person can get a link and if submitted first, the link resolves to confirm - yes or no - then edit."
--
-- sqlite_master check (F-41), run live against 6cde5d11 on 2026-08-03 BEFORE this file was written:
--   kotc tables present: kotc_games, kotc_rounds, kotc_sessions, kotc_slots (migration 0040).
--   No kotc_players table. kotc_slots has no confirmed / confirmed_at / score_token.
--   kotc_games has no entered_by_contact_id / entered_at. Live ledger MAX(version) = '0041' = repo.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════════
-- THE ENTRY LIST WAS MISSING, AND NOTHING SAID SO.
--
-- Migration 0040 gave the format sessions, rounds, seatings and games — but no record of WHO ENTERED.
-- The roster was implied by whoever happened to be seated in round 1, which means: a session cannot be
-- set up before it starts, a player who arrives and is not seated does not exist, and a player who goes
-- home after round 2 is indistinguishable from one who was never there. Individuals entering rather
-- than teams is the whole premise of this format, so the entry list is the one table it could least
-- afford to be missing. `kotc_players` is that list.
--
-- THE LINK BELONGS TO THE PLAYER FOR THE WHOLE SESSION, NOT TO A SEAT FOR ONE ROUND.
-- `kotc_slots` is already exactly one row per player per round, so a token there would have been the
-- obvious place — and would have minted a new link every round. Four rounds means texting somebody four
-- links, three of which are dead, and the one they kept is the wrong one. So the token lives on
-- `kotc_players`: one link per person per night, which follows them up and down the nets.
--
-- ONE PERSON FILLING IT IN FOR EVERYONE IS THE PRIMARY PATH, and that needs no schema at all — any
-- player's link can enter every game on their net. The owner's "ideally" is honoured by making that the
-- path of least resistance, not by restricting the others.
--
-- WHAT THE CONFIRMATION IS FOR, and why it is not a dispute log.
-- The owner's flow: whoever gets there first enters the scores; anyone else opening their link is shown
-- what was entered and asked to confirm — yes or no — and "no" leads to an edit. So the second person
-- through the door is not competing with the first, they are checking them. That is a much better shape
-- than the last-write-wins it replaces, and better than the symmetric dispute model built in v0.79.0:
-- there is always one current answer on the table, and disagreement is a person saying so rather than
-- two rows the software has to choose between.
--
-- `kotc_slots.confirmed` is therefore per player, per round: 'pending' until they look, then 'confirmed'
-- or 'disputed'. It is a record of who has CHECKED, which is the question a director actually has ("has
-- anyone else looked at net 3?").
--
-- AN EDIT RESETS EVERYONE ELSE TO 'pending', deliberately. A confirmation is about specific numbers, so
-- once those numbers change it is stale — carrying it forward would show three ticks against a scoreline
-- nobody but the editor has seen. That is the failure mode this whole feature exists to prevent.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════

-- The entry list. One row per person per session — this is what "a single entry" means in this format.
CREATE TABLE IF NOT EXISTS kotc_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  session_id INTEGER NOT NULL REFERENCES kotc_sessions(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  -- Their link for the night. Hex, same shape as the captain score tokens in registrations.js, so the
  -- existing route pattern `[a-f0-9]{16,64}` covers it and there is one convention rather than two.
  score_token TEXT,
  -- Seeding order for round 1. Null means "no opinion" and they are dealt after those who have one.
  seed INTEGER,
  -- A player who goes home is withdrawn, not deleted: their games were played and their points are real,
  -- and `deleted_at` would take them out of the leaderboard they earned a place in.
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Who has checked this net's scores, and what they said. Per player, per round.
ALTER TABLE kotc_slots ADD COLUMN confirmed TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE kotc_slots ADD COLUMN confirmed_at TEXT;

-- Who put the numbers in, so the confirm screen can say "entered by Ava S." rather than asking somebody
-- to vouch for a scoreline of unknown origin.
ALTER TABLE kotc_games ADD COLUMN entered_by_contact_id INTEGER REFERENCES contacts(id);
ALTER TABLE kotc_games ADD COLUMN entered_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_players_once
  ON kotc_players (org_id, session_id, contact_id) WHERE deleted_at IS NULL;
-- The index the public token route goes through. It is hit on every open of every link, by people
-- standing in a gym on one bar of signal, so it is not optional.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_players_token
  ON kotc_players (score_token) WHERE score_token IS NOT NULL AND deleted_at IS NULL;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0042', '2026-08-03_0042_kotc-entry-confirm_v1_0.sql',
        'KOTC entry list, per-player links, and confirmation. kotc_players is the roster migration 0040 never had — the entry list was implied by whoever was seated in round 1, so a session could not be set up before it started and a player who went home was indistinguishable from one who never came. The score token lives on the PLAYER for the whole session, not on kotc_slots (one row per player per round), because a token there would mint a new link every round: four rounds, four links, three of them dead. kotc_slots.confirmed/confirmed_at record who has CHECKED a net, per round — owner 2026-08-03: "1 person fill it out for everyone... then back up each person can get a link and if submitted first, the link resolves to confirm - yes or no - then edit." An edit resets everyone else to pending, because a confirmation is about specific numbers and is stale the moment they change. kotc_games.entered_by_contact_id/entered_at so the confirm screen can name who to ask.');
