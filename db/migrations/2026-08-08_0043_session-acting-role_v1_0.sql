-- Boomtown Platform — Migration 0043: the acting-role, so "view as member" is a real privilege drop
-- File: 2026-08-08_0043_session-acting-role_v1_0.sql · Version: v1.0 · Date: 2026-08-08
--
-- Source of decision: owner 2026-08-08, answering §-1f O-F1 ("UI filter or real privilege drop?"):
--   "yes agreed drop privileges."
--
-- sqlite_master check (F-41), run live against 6cde5d11 on 2026-08-08 BEFORE this file was written:
--   CREATE TABLE sessions (
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     user_id INTEGER NOT NULL REFERENCES users(id),
--     token_hash TEXT NOT NULL UNIQUE,
--     expires_at TEXT NOT NULL,
--     revoked_at TEXT,
--     created_at TEXT NOT NULL DEFAULT (datetime('now'))
--   )
--   No acting_role column. No new table is created here. Live ledger MAX(version) = '0042' = repo.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════════
-- WHY A COLUMN, WHEN "VIEW AS MEMBER" HAS EXISTED SINCE v0.15.0 AND LOOKED FINE.
--
-- It existed entirely in the browser. `sessionStorage.bt_demo_member` is set by the admin rail, read
-- by the member rail, and used to bounce admin pages back to home.html. Every byte of that is
-- presentation: the SERVER never knew. An admin previewing as a member kept every admin privilege
-- for the whole preview, so the preview showed them a member's SCREENS while their SESSION could
-- still delete a user. The one thing the feature is for — seeing what a member sees — is precisely
-- what it could not do, because a 403 the member would hit came back 200 for them.
--
-- v0.103.0's authorization matrix established why this could not be fixed in the client: `isStaff`
-- (index.js) and `isAdmin` (admin.js) each SELECT user_org_roles by user_id + org_id AT REQUEST
-- TIME, and NOTHING anywhere read a role carried on the session. There was no seam to put a drop
-- into. This column is that seam, and it is deliberately the narrowest one that works.
--
-- ON THE SESSION, NOT THE USER, AND THE DIFFERENCE IS A PRODUCT DECISION.
-- Stored per user, an admin previewing on a laptop would lose admin on their phone mid-preview, and
-- two people sharing an account would fight over one flag. Per session, the preview is where you
-- started it and nowhere else. authorization_matrix.test.mjs pins that semantic directly, because
-- it is invisible without a test that signs the same user in twice.
--
-- NULL MEANS FULL PRIVILEGES, WHICH IS THE SAFE DEFAULT FOR A BACKFILL.
-- Every existing session row gets NULL, so nobody is dropped by the migration itself. The failure
-- direction matters: a column defaulting to 'member' would have logged every admin out of their own
-- privileges the moment it applied, on a live system, with no UI to clear it.
--
-- THE ESCAPE HATCH CANNOT BE GATED BY THE THING IT CLEARS. `POST /api/auth/act-as` is gated on a
-- SESSION, exactly like /api/me — never on a role. Gating it on requireStaff would mean an admin who
-- pressed "View as member" could not press it again to get back: a self-inflicted lockout with no
-- way out but waiting for the session to expire. That is asserted, not assumed.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════

-- NULL = act with your real roles. 'member' = drop to member for THIS session only.
-- TEXT rather than a boolean so a future "act as staff" needs no second migration.
ALTER TABLE sessions ADD COLUMN acting_role TEXT;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0043', '2026-08-08_0043_session-acting-role_v1_0.sql',
        'sessions.acting_role — the seam that makes "view as member" a REAL privilege drop rather than a screen filter. Owner 2026-08-08 (§-1f O-F1): "yes agreed drop privileges." Before this, bt_demo_member lived only in sessionStorage: the server never knew, so an admin previewing as a member kept every admin privilege and could not see the 403s a member would actually hit — the one thing the feature exists for. v0.103.0''s matrix showed there was no seam to use: isStaff (index.js) and isAdmin (admin.js) both SELECT user_org_roles by user_id + org_id at request time and nothing read a session-carried role. Stored PER SESSION, not per user, so a preview on a laptop does not drop admin on a phone. NULL = full privileges, which is the safe backfill direction — a column defaulting to member would have dropped every live admin on apply. Both predicates honour it; a drop only requireStaff honoured would leave all four requireAdmin routes open to a member, which authorization_matrix.test.mjs asserts separately per tier. POST /api/auth/act-as is gated on a SESSION, never a role, because an escape hatch gated by the thing it clears is a lockout.');
