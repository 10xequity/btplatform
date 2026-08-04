-- Migration 0004 — Member profiles, family accounts, signatures, season seeding, passkeys
-- File: 2026-07-22_0004_profiles-family_v1.1.sql · v1.1 · 2026-07-22 (v1.0 + webauthn_challenges)
-- ADDITIVE ONLY. Never re-run 0001–0003. Target: boomtown-prod (D1).

CREATE TABLE IF NOT EXISTS member_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  avatar_r2_key TEXT,
  instagram_handle TEXT,
  bio TEXT,
  date_of_birth TEXT,                          -- ISO YYYY-MM-DD; drives minor logic + age-out
  visibility TEXT NOT NULL DEFAULT 'members',  -- public | members | private
  show_history INTEGER NOT NULL DEFAULT 1,
  show_instagram INTEGER NOT NULL DEFAULT 1,
  reminder_opt_in INTEGER NOT NULL DEFAULT 0,
  reminder_opt_in_at TEXT,                     -- consent timestamp (kept even after opt-out)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE(org_id, contact_id)
);

CREATE TABLE IF NOT EXISTS guardianships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  guardian_contact_id INTEGER NOT NULL,
  minor_contact_id INTEGER NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'parent', -- parent | legal_guardian
  status TEXT NOT NULL DEFAULT 'active',       -- active | ended
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  end_reason TEXT,                             -- aged_out | removed_by_guardian | admin
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE(org_id, guardian_contact_id, minor_contact_id)
);

-- Single signature ledger: waivers now, Module 6 contracts later (same table).
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  subject_contact_id INTEGER NOT NULL,   -- whom the document covers (the child, for minors)
  signer_contact_id INTEGER NOT NULL,    -- who signed (the parent, for minors)
  on_behalf INTEGER NOT NULL DEFAULT 0,  -- 1 = guardian signing for a minor
  minor_age_at_signing INTEGER,          -- captured at signing time for the record
  document_type TEXT NOT NULL,           -- waiver | contract | consent
  document_ref TEXT,                     -- waiver version tag or contract id
  signed_name TEXT NOT NULL,             -- typed full legal name
  signed_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Season seeding: materialized from standings history. Recompute = delete+insert per (org, season).
-- Does NOT store scores; standings remain the single score source.
CREATE TABLE IF NOT EXISTS season_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  season TEXT NOT NULL,                  -- e.g. '2026'
  contact_id INTEGER,                    -- player-level row (nullable)
  team_name TEXT,                        -- team-level row (nullable)
  events_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  best_finish INTEGER,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Passkeys (Face ID / fingerprint) for admin step-up + faster sign-in.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,    -- base64url
  public_key TEXT NOT NULL,              -- base64url COSE key
  counter INTEGER NOT NULL DEFAULT 0,
  device_label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_profiles_lookup ON member_profiles(org_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_guardian_by_guardian ON guardianships(org_id, guardian_contact_id, status);
CREATE INDEX IF NOT EXISTS idx_guardian_by_minor ON guardianships(org_id, minor_contact_id, status);
CREATE INDEX IF NOT EXISTS idx_signatures_subject ON signatures(org_id, subject_contact_id, document_type);
CREATE INDEX IF NOT EXISTS idx_season_points_rank ON season_points(org_id, season, points DESC);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);

-- v1.1 addition (2026-07-22): single-use passkey challenges (applied live same day).
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  kind TEXT NOT NULL,               -- reg | auth
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenge ON webauthn_challenges(challenge);
