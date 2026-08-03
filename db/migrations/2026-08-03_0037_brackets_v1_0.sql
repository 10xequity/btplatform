-- Boomtown Platform — Migration 0037: playable brackets
-- File: 2026-08-03_0037_brackets_v1_0.sql · Version: v1.0 · Date: 2026-08-03
-- Source of decision: owner 2026-08-03 — the tournament must "run any format I end up having with
-- registrations", and "we try to avoid pigtails as often as possible with too many people waiting."
--
-- sqlite_master check (F-41), run live 2026-08-03 BEFORE this design was fixed:
--   `brackets` EXISTS (id, org_id, event_id, name, split_rule, config_json). `scheduler.js`
--   already computes a seeded first round and stores it in `config_json`. That is a PICTURE of a
--   bracket, not a bracket: nothing can be scored, nothing advances, and later rounds are never
--   generated. Failure class 1 — built, and not actually playable.
--   `matches` EXISTS with team_a_id / team_b_id / court / round / score_a / score_b, and every
--   screen that matters — score entry, the score page, court assignment, the new drag-and-drop
--   schedule editor — already operates on it.
--
-- WHY NOT A NEW `bracket_matches` TABLE. It would be a cleaner schema and the wrong call. A bracket
-- game is a game: it is played on a court, in a round, by two teams, and someone types a score into
-- the same phone. Putting it in a second table means a second score path, a second score page, a
-- second court assignment, and a second editor — four chances for the two to disagree. One match
-- table keeps one answer to "what is being played right now".
--
-- WHY NOT WIDEN `stage`. `matches.stage` carries CHECK (stage IN ('pool','quarter','semi','final')).
-- Widening a CHECK in SQLite requires a full table rebuild — create, copy, drop, rename — against a
-- live database holding real scores. That is not additive, and the rule here is additive-only.
--
--   So: `stage` stays as it is and becomes the COARSE label. `bracket_round` is authoritative.
--   Rounds are numbered BACKWARDS from the final, because that is the only numbering that does not
--   change meaning when the bracket size changes:
--       bracket_round 1 = final · 2 = semi · 3 = quarter · 4 = round of 16 · 5 = round of 32
--   `stage` is written as final / semi / quarter and CLAMPS at 'quarter' for round 4 and beyond,
--   which is the closest legal value. Anything that needs the real round reads `bracket_round`.
--   One definition, stated out loud, so nobody later reads `stage` and believes it (F-26).
--
-- WHAT IS DERIVED, NOT STORED. A match at (round r, slot s) feeds (round r-1, slot ceil(s/2)), and
-- lands on side A when s is odd, side B when s is even. Storing a feeds_match_id would be a second
-- copy of a fact arithmetic already gives, and a second copy is a thing that can drift.

ALTER TABLE matches ADD COLUMN bracket_id INTEGER REFERENCES brackets(id);
ALTER TABLE matches ADD COLUMN bracket_round INTEGER;
ALTER TABLE matches ADD COLUMN bracket_slot INTEGER;

-- One match per (bracket, round, slot). Without this, generating a bracket twice quietly produces
-- two overlapping trees and the second one wins every read — the same defect the schedule generator
-- already refuses by hand.
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_bracket_slot
  ON matches (org_id, bracket_id, bracket_round, bracket_slot)
  WHERE bracket_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_bracket
  ON matches (org_id, event_id, bracket_id, bracket_round)
  WHERE bracket_id IS NOT NULL AND deleted_at IS NULL;

-- `brackets.config_json` already holds the split rule and the seed list it was built from. Nothing
-- new is needed there; the tree itself now lives in `matches` where it can be played.

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0037', '2026-08-03_0037_brackets_v1_0.sql',
        'Playable brackets: matches.bracket_id / bracket_round / bracket_slot so a knockout tree lives in the same table as pool play and reuses score entry, courts and the schedule editor. bracket_round counts BACKWARDS from the final (1=final, 2=semi, 3=quarter, 4=R16) and is authoritative; matches.stage stays a coarse legacy label clamped at quarter because widening its CHECK would need a non-additive table rebuild. Feeds-into is derived (r-1, ceil(s/2), side a if s odd), never stored.');
