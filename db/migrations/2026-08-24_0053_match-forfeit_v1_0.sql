-- Boomtown Platform — migration 0053: the forfeit marker on a match
-- File: db/migrations/2026-08-24_0053_match-forfeit_v1_0.sql · Date: 2026-08-24
-- Ships in: v0.192.0 · roadmap §-1r RF-3 (owner ruling 2026-08-24)
--
-- FULLY ADDITIVE. One nullable TEXT column, no index, nothing existing altered. NOTHING READS IT
-- until scoreMatch writes it and refreshStandings/computeStandings consult it, in the same release.
--
-- WHY A COLUMN AND NOT THE SCORE. The owner's ruling: a forfeit DISPLAYS as a 25-0 win for the
-- opponent, but the point-differential standings move by ONE point, not twenty-five ("does not
-- change differential standings too much"). A 25-0 score alone cannot carry that rule — 25-0 can
-- be EARNED, and an earned 25-0 must keep its full differential. The flag is the only honest
-- discriminator, and it makes the differential rule a one-line change if the owner ever revises it.
--
-- VALUES: 'a' or 'b' — WHICH TEAM FORFEITED (not who won). NULL = played normally. The score
-- route enforces the vocabulary; a normal score entry (winner/diff or exact) CLEARS the flag,
-- because a correction that types a real score is saying the game was actually played.

ALTER TABLE matches ADD COLUMN forfeit_by TEXT;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0053',
  '2026-08-24_0053_match-forfeit_v1_0.sql',
  'matches.forfeit_by — which side forfeited (''a''|''b'', NULL = played). Owner ruling 2026-08-24: forfeit displays 25-0 but moves the differential by one point either way; the flag, not the score, carries that rule. Additive; nothing reads it until the same release''s code.'
);
