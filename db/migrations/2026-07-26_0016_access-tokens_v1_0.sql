-- Boomtown Platform — Migration 0016: shared capability tokens
-- File: 2026-07-26_0016_access-tokens_v1_0.sql · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.23.0
-- ADDITIVE ONLY. Safe to re-run (every statement is IF NOT EXISTS).
--
-- Why one table instead of two: the iCal feed (v0.23.0) and the teammate waiver-sign link
-- (v0.24.0) need the same primitive — an unguessable, revocable string that grants ONE narrow
-- capability to somebody who is not signed in. Two tables would mean two revocation paths, two
-- rate-limit stories, and two places to get hashing wrong. D-TOK-1.
--
-- SECURITY: token_sha stores SHA-256 of the raw token. The raw value is shown to the owner
-- exactly once at mint time and never persisted. A dump of this table therefore hands out
-- nothing. Lookup is by hash of the presented token.
--
-- NOT restorable: like waivers/signatures/waiver_versions (M13 rule, D-WV-4), access_tokens is
-- deliberately excluded from RESTORE_WHITELIST. Undeleting a revoked credential is not a
-- feature. security_portal.test.mjs v1.2 enforces this.

CREATE TABLE IF NOT EXISTS access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL
    CHECK (kind IN ('calendar_member','calendar_public','waiver_sign')),
  token_sha TEXT NOT NULL,                    -- SHA-256 hex of the raw token. Never the raw value.
  contact_id INTEGER,                         -- calendar_member, waiver_sign
  team_member_id INTEGER,                     -- waiver_sign (v0.24.0)
  label TEXT,                                 -- shown in the revoke list: "Ava's phone", "Public feed"
  expires_at TEXT,                            -- NULL = no expiry (calendar feeds); set for waiver_sign
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER,
  revoked_at TEXT,
  deleted_at TEXT
);

-- Lookup path. UNIQUE because a hash collision would cross capability boundaries.
CREATE UNIQUE INDEX IF NOT EXISTS ux_access_tokens_sha
  ON access_tokens(token_sha);

CREATE INDEX IF NOT EXISTS idx_access_tokens_owner
  ON access_tokens(org_id, kind, contact_id);

-- At most one live public calendar feed per org. Rotating replaces rather than accumulates,
-- so "revoke the public feed" always means one thing. Mirrors ux_waiver_versions_active.
CREATE UNIQUE INDEX IF NOT EXISTS ux_access_tokens_public_cal
  ON access_tokens(org_id) WHERE kind = 'calendar_public' AND revoked_at IS NULL AND deleted_at IS NULL;

-- ---------- Verify (run after applying) ----------
-- SELECT COUNT(*) FROM access_tokens;                                  -- 0, this table starts empty
-- SELECT name FROM sqlite_master WHERE name LIKE '%access_tokens%';    -- table + 3 indexes
