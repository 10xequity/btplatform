-- Boomtown Platform — migration 0045: the frozen team number (roadmap §-1k K-1 tier 2, §-0 B5)
-- File: db/migrations/2026-08-13_0045_team-no_v1_0.sql · Date: 2026-08-13 · Ships in: v0.146.0
--
-- One additive column. It stores the team number a director's own tile arrangement produced, as
-- the owner described it: "1 being top down for each division". It is written by the pool board's
-- SAVE and by nothing else, and NULL means "this team has no number from an arrangement yet", so
-- the read falls back to tier 3 (registration order, shipped v0.125.0 as the derived `board_no`).
-- Every existing row is NULL on arrival, so the deploy changes no number on any screen.
--
-- WHY IT IS STORED RATHER THAN DERIVED, WHICH WAS MEASURED AND NOT ASSUMED. The obvious cheaper
-- design is to compute the number on every read from (division, pools.sort_order, board_order) and
-- skip the column. That was tested against the writers and REFUTED: `pools.sort_order` and
-- `teams.board_order` are indeed written only by the board save, but `teams.division_id` has two
-- other writers — `divisions.assign` (divisions.js:417) and the promote/relegate moves
-- (divisions.js:491) — and `teams.pool_id` is also cleared when a pool is deleted. Any of those
-- would silently renumber a board nobody had re-saved, which is precisely the failure K-1's spec
-- names: "the sheet in their hand disagrees with the screen". Freezing at Save has to be a write.
--
-- NOT UNIQUE, DELIBERATELY. The owner's numbering restarts at 1 in every division, so two teams in
-- one event legitimately share a number. Uniqueness is per (event, division), which is a property
-- of how the writer computes the sequence, not a constraint this column can carry.

ALTER TABLE teams ADD COLUMN team_no INTEGER;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0045',
  '2026-08-13_0045_team-no_v1_0.sql',
  'teams.team_no — K-1 tier 2: the team number produced by the admin''s own tile arrangement, 1..N top-down within each division, written ONLY by the pool board save and frozen until the next one. NULL falls back to tier 3 (registration order), so every existing row keeps the number it already showed. Stored rather than derived because teams.division_id has writers outside the board save (divisions.assign, promote/relegate), which would otherwise renumber a saved board silently.'
);
