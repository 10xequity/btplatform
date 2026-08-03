-- Boomtown Platform — Migration 0041: held bracket slots, real court ranges, real times
-- File: 2026-08-03_0041_bracket-courts-locks_v1_0.sql · Version: v1.0 · Date: 2026-08-03
--
-- Source of decision: owner 2026-08-03, two requests that turn out to need the same migration.
--
--   (1) "Add admin edit scores if incorrect and allow movement in brackets to fix any errors."
--   (2) "bracket generation should honor the fixed court number. However, as brackets collapse
--        courts do become avialable. so there's a need for the scheduling time component if we
--        overlap. We need ability to assign different courts to players based on availability of
--        courts during bracket."
--
-- sqlite_master check (F-41), run live against 6cde5d11 on 2026-08-03 BEFORE this file was written:
--   pragma_table_info('matches')  = id, org_id, event_id, pool_id, stage, round, court, team_a_id,
--     team_b_id, ref_team_id, points_to, cap, game_number, score_a, score_b, created_at, updated_at,
--     deleted_at, bracket_id, bracket_round, bracket_slot
--   pragma_table_info('brackets') = id, org_id, event_id, name, split_rule, config_json, created_at,
--     updated_at, deleted_at, division_id
--   So: no lock of any kind, no clock time on a game, and a bracket's courts were only ever
--   reachable through its division. Live ledger MAX(version) = '0040'. Repo highest = 0040. Agreed.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHY A LOCK HAS TO EXIST, AND WHY IT WAS RIGHT NOT TO GUESS AT IT IN v0.75.0.
--
-- `advanceBracketFor` derives the whole tree from the scores on the table every time it runs. That
-- is deliberate and it is why a corrected score self-heals. It also means a team a director places
-- BY HAND is overwritten the moment the feeding game's winner is computed — and v0.75.0 proved that
-- happens within minutes, because advance runs on every score entered anywhere in the event.
--
-- v0.75.0 made the warning honest in both directions and stopped there, because making the override
-- SURVIVE is a product decision: either the score is always the truth, or a human's edit outranks it.
-- The owner has now answered by asking for "movement in brackets to fix any errors" — an edit that
-- reverts itself does not fix anything. So a hand-placed side is HELD.
--
-- ONE FLAG PER SIDE, not one per game. The two sides of a bracket game are independent: a director
-- substitutes for the team that went home and leaves the other alone. A single per-game flag would
-- freeze the surviving side too, so the next quarter-final result would have nowhere to go and the
-- bracket would silently stop advancing — a bug that looks exactly like the software ignoring scores.
--
-- HELD IS NOT PERMANENT. `POST .../brackets/slot` with `release: true` hands the side back to the
-- algorithm, and the next advance repopulates it from the scores. A lock nobody can release is a
-- trap, and the person who set it in the morning is not the person looking at it in the afternoon.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- `starts_at` IS NULLABLE AND THAT IS THE DESIGN.
-- `round` remains the ordering that everything reads; `starts_at` is an OPTIONAL wall-clock time laid
-- on top for events that need one. Owner: "there's a need for the scheduling time component if we
-- overlap." Two games can share a court only if they are at different times, and until now the only
-- expression of "different time" was a different round number — which is fine for pool play, where
-- every court turns over together, and wrong for a bracket, where a division of 4 finishes while a
-- division of 16 is still on its second round. Making it NOT NULL would have forced a fabricated time
-- onto every historical row, and a made-up time on a results sheet is worse than no time.
--
-- COURT RANGE ON THE BRACKET, not only on the division.
-- A bracket already reaches a court range through `brackets.division_id` → `divisions.court_from/to`,
-- and that stays the default. The override exists because the owner's sentence has two halves that
-- pull apart: courts are FIXED (a division owns 5–8 and may not wander onto 1–4), and courts BECOME
-- AVAILABLE as brackets collapse (the division that finished has freed 1–4, and it is wasteful to
-- leave them empty while sixteen teams queue). Resolution order is bracket → division → the event's
-- whole court count, so the general case needs no configuration and the exception is expressible.

ALTER TABLE matches ADD COLUMN slot_locked_a INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN slot_locked_b INTEGER NOT NULL DEFAULT 0;
-- Optional wall-clock start. ISO-8601 text, same convention as every other timestamp here.
ALTER TABLE matches ADD COLUMN starts_at TEXT;

ALTER TABLE brackets ADD COLUMN court_from INTEGER;
ALTER TABLE brackets ADD COLUMN court_to INTEGER;

-- The index the court-conflict check goes through. A court holding two games at one time is the
-- defect this whole migration exists to make expressible, so finding one must be cheap enough that
-- the check can run on every write rather than in a nightly report nobody reads.
CREATE INDEX IF NOT EXISTS idx_matches_court_time
  ON matches (org_id, event_id, court, starts_at) WHERE deleted_at IS NULL;
-- Held slots are rare, so a partial index over just them stays tiny and answers "what has a human
-- overridden on this event" without scanning the schedule.
CREATE INDEX IF NOT EXISTS idx_matches_held
  ON matches (org_id, event_id) WHERE deleted_at IS NULL AND (slot_locked_a = 1 OR slot_locked_b = 1);

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0041', '2026-08-03_0041_bracket-courts-locks_v1_0.sql',
        'Held bracket slots, bracket court ranges, and an optional wall-clock time on a game. matches.slot_locked_a/_b make a hand-placed team survive advance, which v0.75.0 proved it did not: advancement is derived from scores and runs on every score entered anywhere, so an override reverted within minutes. One flag PER SIDE, not per game — freezing the untouched side would stop the bracket advancing and look like scores being ignored. Releasable, because a lock nobody can undo is a trap. matches.starts_at is nullable by design: round stays the ordering everything reads and the clock time is laid on top only where courts overlap, since NOT NULL would fabricate times on historical rows. brackets.court_from/court_to override the division range (resolution: bracket -> division -> event court_count) so "courts are fixed" and "courts free up as brackets collapse" can both be true. Owner 2026-08-03.');
