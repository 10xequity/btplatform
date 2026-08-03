-- Boomtown Platform — Migration 0039: the pool board
-- File: 2026-08-03_0039_pool-board_v1_0.sql · Version: v1.0 · Date: 2026-08-03
--
-- Source of decision: owner 2026-08-03 — "Add drag and drop for me to sort which teams go where and
-- allow me to write a note that is displayed on the tile. I will need areas to drag and drop for
-- each division, and if i drag to a square or block with + it will add a pool. and if it is empty,
-- itll auto delete. i will also need a workspace area to arrange teams to move."
--
-- sqlite_master check (F-41), run live 2026-08-03 BEFORE this design was fixed:
--   pools  = id, org_id, event_id, name, created_at, updated_at, deleted_at
--   teams  = id, org_id, event_id, name, level, gender_division, captain_contact_id, seed,
--            created_at, updated_at, deleted_at, score_token, level_num, division_id
--   So a pool has no idea which division it belongs to, and a team has no pool. `matches.pool_id`
--   exists and points at pools, which means pool membership was until now implied by which games a
--   team had been given — readable only after a schedule existed, and unwritable before one did.
--   That is exactly backwards for a board whose whole job is arranging teams BEFORE any schedule.
--
-- THE WORKSPACE IS `pool_id IS NULL`, NOT A SPECIAL ROW.
-- The owner asked for "a workspace area to arrange teams to move". The tempting move is a magic pool
-- named "Workspace"; the cheaper and more honest one is that a team with no pool is a team not yet
-- placed. Nothing to create, nothing to accidentally schedule, nothing to clean up — and it is
-- already the state every team starts in.
--
-- POOLS ARE DELETED, NOT SOFT-DELETED, WHEN THEY GO EMPTY.
-- "if it is empty, itll auto delete." An empty pool holds no history worth keeping: it never had a
-- team, so it never had a game or a result. Soft-deleting would leave the board accumulating
-- invisible rows that the unique name index would then collide with. Pools that HAVE held teams are
-- still soft-deleted, because their matches reference them.
--
-- `sort_order` EXISTS BECAUSE A BOARD HAS AN ORDER ON SCREEN.
-- Two pools created in the same second are otherwise ordered by id, and dragging one before another
-- would silently do nothing. This is the column that makes the arrangement the director sees the
-- arrangement that is stored.

ALTER TABLE pools ADD COLUMN division_id INTEGER REFERENCES divisions(id);
ALTER TABLE pools ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pools ADD COLUMN court_from INTEGER;
ALTER TABLE pools ADD COLUMN court_to INTEGER;

ALTER TABLE teams ADD COLUMN pool_id INTEGER REFERENCES pools(id);
-- The note the owner asked to see on the tile. Deliberately on the TEAM, not on the placement: a
-- note like "asked to finish by 4" or "two players sharing with another team" is true wherever the
-- team ends up, and losing it because somebody dragged the tile would be its own small betrayal.
ALTER TABLE teams ADD COLUMN note TEXT;
ALTER TABLE teams ADD COLUMN board_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pools_division
  ON pools (org_id, event_id, division_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_teams_pool
  ON teams (org_id, pool_id, board_order) WHERE pool_id IS NOT NULL AND deleted_at IS NULL;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0039', '2026-08-03_0039_pool-board_v1_0.sql',
        'The pool board: pools.division_id / sort_order / court_from / court_to, and teams.pool_id / note / board_order. Pool membership was previously implied by matches.pool_id — readable only after a schedule existed and unwritable before one did, which is backwards for a board that arranges teams before any schedule. The workspace is deliberately pool_id IS NULL rather than a magic pool row. teams.note lives on the team, not the placement, so dragging a tile never loses it.');
