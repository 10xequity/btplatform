-- Boomtown Platform — end-to-end journey schema fixture
-- File: worker/testkit/journey-schema.sql · Version: v1.1 · Date: 2026-08-08 · Ships in: v0.107.0
-- v1.1 (migration 0043, v0.107.0): `sessions` re-read from live sqlite_master after
-- `ALTER TABLE sessions ADD COLUMN acting_role TEXT` — which is why that column trails the closing
-- paren on its own line rather than sitting in the column list. It is copied VERBATIM, including
-- the odd formatting ALTER produces, because the provenance rule below is the whole point: a
-- prettier hand-typed version is a schema that has never existed anywhere.
--
-- PROVENANCE — this is not hand-written. Every CREATE TABLE below was read VERBATIM from live D1
-- (db 6cde5d11-4199-4e57-b10f-2b7e968264ea) via `sqlite_master` on 2026-08-02, at ledger 0033.
-- Hand-typing a schema for a test is how you build a harness that passes against a database that
-- does not exist: the columns drift, the CHECK constraints soften, and the green tick means
-- nothing. Copying the real DDL costs nothing and keeps the harness honest.
--
-- WHY NOT REPLAY db/migrations/ INSTEAD? Because it cannot rebuild this schema. Migrations
-- 0004–0007 and 0011 were pruned from the repo after being applied (library §3); the directory
-- holds 20 files while the ledger reports 33. `schema_migrations` is the record, not the folder.
-- Replaying what remains would produce a schema that has never existed anywhere.
--
-- WHY 37 OF 82 TABLES? Foreign keys are OFF here, exactly as they are in D1, so a
-- REFERENCES clause pointing at an absent table is inert. These are the tables the operating loop
-- actually reaches — and note that number, because it is the finding. The loop was scoped at 14
-- from reading the code; building it revealed 23 more, discovered one at a time by SQLite
-- raising "no such table: X". Registering for one tournament touches waivers, documents,
-- document_requirements, guardianships, media consent, membership grants and the waitlist. That
-- breadth is worth knowing before anyone estimates a change to registration.
--
-- The loud failure is the design. A fixture that quietly covered all 82 would have hidden it.
--
-- DRIFT: this is a snapshot. A live migration that alters one of these tables will not appear
-- here, and the harness would keep passing against the old shape. Re-read it from sqlite_master
-- whenever a migration touches a table below, and bump the version in this header.

CREATE TABLE orgs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  brand_json TEXT DEFAULT '{}',
  email_sender_name TEXT,
  email_sender_address TEXT,
  square_location_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, mailing_address TEXT, timezone TEXT NOT NULL DEFAULT 'America/Denver', website TEXT, admin_email TEXT, phone TEXT, address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, postal_code TEXT, is_owned INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, legal_entity TEXT, rules_url TEXT, deactivated_at TEXT, legal_entity_verified INTEGER NOT NULL DEFAULT 0, legal_entity_short TEXT, payments_parent_org_id INTEGER REFERENCES orgs(id), modules_off_json TEXT);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, acting_role TEXT);

CREATE TABLE magic_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_org_roles (
  user_id INTEGER NOT NULL REFERENCES users(id),
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL CHECK (role IN ('admin','staff','member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER REFERENCES users(id),
  email TEXT COLLATE NOCASE,
  full_name TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  instagram TEXT,
  tags_json TEXT DEFAULT '[]',
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, consent_source TEXT, consented_at TEXT, unsub_token TEXT, family_id INTEGER REFERENCES families(id), activation_state TEXT NOT NULL DEFAULT 'active', kiosk_code TEXT, sms_opt_in INTEGER NOT NULL DEFAULT 0, sms_opt_in_at TEXT);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  type TEXT NOT NULL CHECK (type IN ('tournament','league','training','event','court_rental')),
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  location TEXT,
  capacity INTEGER,
  court_count INTEGER,
  format_template TEXT,
  config_json TEXT DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','in_progress','completed','cancelled')),
  cash_option_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, price_cents INTEGER, series_id TEXT, program_id INTEGER REFERENCES programs(id), recurrence_json TEXT, staff_contact_id INTEGER REFERENCES contacts(id), checkin_token TEXT, external_url TEXT, external_label TEXT, square_item_id TEXT, square_variation_id TEXT, min_signups INTEGER);

CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER REFERENCES contacts(id),
  team_id INTEGER REFERENCES teams(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','email-sent','paid','cash-pending','comped','cancelled')),
  payment_method TEXT CHECK (payment_method IN ('square','cash','comp') OR payment_method IS NULL),
  square_order_id TEXT,
  waiver_id INTEGER REFERENCES waivers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, checkout_url TEXT, last_reminded_at TEXT, price_cents INTEGER);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  registration_id INTEGER REFERENCES registrations(id),
  square_payment_id TEXT UNIQUE,
  square_order_id TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'USD',
  status TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER REFERENCES contacts(id),
  team_member_id INTEGER REFERENCES team_members(id),
  name_snapshot TEXT,
  method TEXT NOT NULL DEFAULT 'staff',
  checked_by_user_id INTEGER,
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER REFERENCES events(id),
  contact_id INTEGER REFERENCES contacts(id),
  method TEXT CHECK (method IN ('qr','pin','admin')),
  checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  pool_id INTEGER REFERENCES pools(id),
  stage TEXT NOT NULL DEFAULT 'pool' CHECK (stage IN ('pool','quarter','semi','final')),
  round INTEGER NOT NULL,
  court INTEGER NOT NULL,
  team_a_id INTEGER REFERENCES teams(id),
  team_b_id INTEGER REFERENCES teams(id),
  ref_team_id INTEGER REFERENCES teams(id),
  points_to INTEGER NOT NULL DEFAULT 21,
  cap INTEGER NOT NULL DEFAULT 23,
  game_number INTEGER NOT NULL DEFAULT 1,
  score_a INTEGER,
  score_b INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, bracket_id INTEGER REFERENCES brackets(id), bracket_round INTEGER, bracket_slot INTEGER);

-- 0037. Trailing-comma form because that is how ALTER TABLE ADD COLUMN leaves it in sqlite_master,
-- and this file is a verbatim capture of live — prettifying it would hide a real difference.
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_bracket_slot
  ON matches (org_id, bracket_id, bracket_round, bracket_slot)
  WHERE bracket_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL,
  target TEXT,
  payload_json TEXT DEFAULT '{}',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, contact_id INTEGER REFERENCES contacts(id), title TEXT, body TEXT, link TEXT, read_at TEXT);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── added as the journey reached them (see header: an absent table raises "no such table") ──

CREATE TABLE webauthn_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, device_label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT, deleted_at TEXT, uv_required INTEGER NOT NULL DEFAULT 0);

CREATE TABLE member_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, avatar_r2_key TEXT, instagram_handle TEXT, bio TEXT, date_of_birth TEXT, visibility TEXT NOT NULL DEFAULT 'members', show_history INTEGER NOT NULL DEFAULT 1, show_instagram INTEGER NOT NULL DEFAULT 1, reminder_opt_in INTEGER NOT NULL DEFAULT 0, reminder_opt_in_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, sub_opt_in INTEGER NOT NULL DEFAULT 0, sub_opt_in_at TEXT, positions TEXT, skill_level TEXT, gender_division TEXT, height_reach TEXT, dominant_hand TEXT, sub_mode TEXT NOT NULL DEFAULT 'passive', sub_level TEXT, sub_lfg_listing_id INTEGER REFERENCES lfg_listings(id), UNIQUE(org_id, contact_id));

CREATE TABLE families (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id             INTEGER NOT NULL REFERENCES orgs(id),
  name               TEXT NOT NULL,
  primary_contact_id INTEGER REFERENCES contacts(id),
  square_customer_id TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  level TEXT,
  gender_division TEXT,
  captain_contact_id INTEGER REFERENCES contacts(id),
  seed INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, score_token TEXT, level_num INTEGER, division_id INTEGER REFERENCES divisions(id), pool_id INTEGER REFERENCES pools(id), note TEXT, board_order INTEGER NOT NULL DEFAULT 0, team_no INTEGER);

CREATE TABLE team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  contact_id INTEGER REFERENCES contacts(id),
  member_name TEXT,
  member_email TEXT,
  is_sub INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, invited_at TEXT, reminded_at TEXT);

CREATE TABLE waiver_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  body_sha TEXT NOT NULL,
  material INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','legacy')),
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_by_user_id INTEGER,
  supersedes_id INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, document_id INTEGER REFERENCES documents(id), body_template TEXT, source_r2_key TEXT, tokens_json TEXT);

CREATE TABLE waivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  waiver_text_version TEXT NOT NULL DEFAULT 'v1',
  signed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  signature_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, version_id INTEGER REFERENCES waiver_versions(id));

CREATE TABLE signatures (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, subject_contact_id INTEGER NOT NULL, signer_contact_id INTEGER NOT NULL, on_behalf INTEGER NOT NULL DEFAULT 0, minor_age_at_signing INTEGER, document_type TEXT NOT NULL, document_ref TEXT, signed_name TEXT NOT NULL, signed_at TEXT NOT NULL DEFAULT (datetime('now')), ip TEXT, user_agent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, version_id INTEGER REFERENCES waiver_versions(id), document_id INTEGER REFERENCES documents(id), requirement_id INTEGER REFERENCES document_requirements(id), expires_at TEXT);

CREATE TABLE guardianships (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, guardian_contact_id INTEGER NOT NULL, minor_contact_id INTEGER NOT NULL, relationship TEXT NOT NULL DEFAULT 'parent', status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT, end_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, aged_out_at TEXT, separation_choice TEXT, separated_at TEXT, certified_by_contact_id INTEGER, certified_at TEXT, certified_name TEXT, certification_sha TEXT, UNIQUE(org_id, guardian_contact_id, minor_contact_id));

CREATE TABLE form_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER REFERENCES events(id),
  label TEXT NOT NULL,
  field_type TEXT NOT NULL CHECK (field_type IN ('text','email','phone','select','checkbox','file','textarea')),
  options_json TEXT DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE form_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  field_id INTEGER REFERENCES form_fields(id),
  field_label TEXT,
  value TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE media_consents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id              INTEGER NOT NULL DEFAULT 1 REFERENCES orgs(id),
  contact_id          INTEGER NOT NULL REFERENCES contacts(id),
  status              TEXT NOT NULL CHECK (status IN ('opted_out','restored')),
  received_via        TEXT CHECK (received_via IN ('email','in_person','phone','post','other')),
  reference           TEXT,
  note                TEXT,
  requested_at        TEXT,
  recorded_by_user_id INTEGER,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'waiver' CHECK (kind IN ('waiver','policy','consent','media','code_of_conduct','other')),
  description TEXT,
  requires_signature INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE document_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  document_id INTEGER NOT NULL REFERENCES documents(id),
  version_id INTEGER NOT NULL REFERENCES waiver_versions(id),
  applies_to TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','adults','minors','staff')),
  signer_rule TEXT NOT NULL DEFAULT 'either' CHECK (signer_rule IN ('self','guardian','either')),
  term_days INTEGER,
  effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  retroactive INTEGER NOT NULL DEFAULT 0,
  invalidated_count INTEGER,
  superseded_requirement_id INTEGER REFERENCES document_requirements(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  amount INTEGER NOT NULL,
  usage_cap INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, active INTEGER NOT NULL DEFAULT 1, starts_at TEXT, expires_at TEXT);

CREATE TABLE programs (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, description TEXT, type TEXT NOT NULL DEFAULT 'event' CHECK (type IN ('tournament','league','training','event','court_rental')), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);

CREATE TABLE pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, division_id INTEGER REFERENCES divisions(id), sort_order INTEGER NOT NULL DEFAULT 0, court_from INTEGER, court_to INTEGER);

-- Verbatim from live sqlite_master 2026-08-03. It was missing from this capture, which is exactly
-- the gap that lets a test pass against a table the real database does not have.
CREATE TABLE brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL DEFAULT 'A',
  split_rule TEXT,
  config_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
, division_id INTEGER REFERENCES divisions(id));

-- 0038. Divisions own a COURT RANGE, not a court count: 12 courts split three ways is courts 1-4,
-- 5-8 and 9-12, and which is which matters to everyone in the building.
CREATE TABLE divisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 1,
  court_from INTEGER,
  court_to INTEGER,
  target_bracket_size INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_divisions_event_rank
  ON divisions (org_id, event_id, rank) WHERE deleted_at IS NULL;

CREATE TABLE division_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  from_division_id INTEGER REFERENCES divisions(id),
  to_division_id INTEGER REFERENCES divisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('move_down','move_up','drop_from_bracket','mini_bracket')),
  reason TEXT NOT NULL,
  wins INTEGER, losses INTEGER, games_played INTEGER, division_median_wins REAL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected')),
  decided_by_user_id INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE standings (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  point_diff INTEGER NOT NULL DEFAULT 0,
  points_for INTEGER NOT NULL DEFAULT 0,
  points_against INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  PRIMARY KEY (event_id, team_id)
);

CREATE TABLE season_points (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, season TEXT NOT NULL, contact_id INTEGER, team_name TEXT, events_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, best_finish INTEGER, computed_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE TABLE membership_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  name          TEXT NOT NULL,
  code          TEXT NOT NULL,
  rank          INTEGER NOT NULL DEFAULT 0,
  description   TEXT,
  perks         TEXT,
  color         TEXT,
  guest_passes_per_month INTEGER NOT NULL DEFAULT 0,
  open_gym_included      INTEGER NOT NULL DEFAULT 0,
  booking_window_days    INTEGER,
  discount_bps           INTEGER NOT NULL DEFAULT 0,
  visible_to_public      INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE membership_grants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES orgs(id),
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  tier_id         INTEGER NOT NULL REFERENCES membership_tiers(id),
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('subscription','manual','comp','staff','sponsor')),
  subscription_id INTEGER REFERENCES subscriptions(id),
  starts_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at         TEXT,
  note            TEXT,
  granted_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE TABLE waitlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER REFERENCES contacts(id),
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  team_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','offered','claimed','expired','removed')),
  position INTEGER NOT NULL,
  offer_token TEXT,
  offer_expires_at TEXT,
  offered_at TEXT,
  claimed_registration_id INTEGER REFERENCES registrations(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER,
  email TEXT COLLATE NOCASE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- Migration 0040 — King / Queen of the Court. Individuals enter, not teams, and a partnership lasts
-- one game, so nothing in `teams` can hold this shape. Per-player standings are DERIVED from
-- kotc_games and never stored. Mirrored here from live D1 (verified via sqlite_master after 0040 was
-- applied) so route tests for this format run against the same schema the worker will meet.
CREATE TABLE kotc_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  players_per_net INTEGER NOT NULL DEFAULT 4,
  move_up INTEGER NOT NULL DEFAULT 1,
  points_to INTEGER NOT NULL DEFAULT 21,
  rounds_planned INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE kotc_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  session_id INTEGER NOT NULL REFERENCES kotc_sessions(id),
  round_no INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE kotc_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  round_id INTEGER NOT NULL REFERENCES kotc_rounds(id),
  net_no INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE kotc_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  round_id INTEGER NOT NULL REFERENCES kotc_rounds(id),
  net_no INTEGER NOT NULL,
  game_no INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_kotc_sessions_event ON kotc_sessions (org_id, event_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_rounds_no ON kotc_rounds (org_id, session_id, round_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_slots_seat ON kotc_slots (org_id, round_id, net_no, seat) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_slots_person ON kotc_slots (org_id, round_id, contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_games_no ON kotc_games (org_id, round_id, net_no, game_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kotc_games_round ON kotc_games (org_id, round_id, net_no) WHERE deleted_at IS NULL;

-- Migration 0041 — held bracket slots, bracket court ranges, optional wall-clock times.
ALTER TABLE matches ADD COLUMN slot_locked_a INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN slot_locked_b INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN starts_at TEXT;
ALTER TABLE brackets ADD COLUMN court_from INTEGER;
ALTER TABLE brackets ADD COLUMN court_to INTEGER;
CREATE INDEX IF NOT EXISTS idx_matches_court_time
  ON matches (org_id, event_id, court, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matches_held
  ON matches (org_id, event_id) WHERE deleted_at IS NULL AND (slot_locked_a = 1 OR slot_locked_b = 1);

-- Migration 0042 — KOTC entry list, per-player links, confirmation.
CREATE TABLE kotc_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  session_id INTEGER NOT NULL REFERENCES kotc_sessions(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  score_token TEXT,
  seed INTEGER,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
ALTER TABLE kotc_slots ADD COLUMN confirmed TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE kotc_slots ADD COLUMN confirmed_at TEXT;
ALTER TABLE kotc_games ADD COLUMN entered_by_contact_id INTEGER REFERENCES contacts(id);
ALTER TABLE kotc_games ADD COLUMN entered_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_players_once ON kotc_players (org_id, session_id, contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_kotc_players_token ON kotc_players (score_token) WHERE score_token IS NOT NULL AND deleted_at IS NULL;

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════
   THE OTHER HALF OF THE SCHEMA — added 2026-08-03, read verbatim out of live D1 via `sqlite_master`.

   THIS FILE'S HEADER CLAIMED TO BE "the real production schema, read verbatim from live" AND IT WAS
   NOT. It carried 46 of live's 97 tables. The 51 that were missing are below.

   HOW THAT SURVIVED 1127 PASSING TESTS, which is the part worth understanding: every test that needed
   one of these tables created its own fixture by hand, so it passed. Every test that did NOT need one
   never asked. Nothing anywhere compared this file against the database it claims to mirror — so the
   gap was not a test failure, it was the absence of a test, and absences do not go red.

   The cost was 29 endpoints across 16 admin pages returning 500 in a harness that reported itself
   healthy: announcements, marketing, POS, plans, passes, member fields, staff pay, messages, uploads,
   FAQs, facility spaces, schedule views, event templates, tryouts and passkeys. A page whose first
   fetch 500s stops rendering, which is exactly "the screens all terminate".

   `schema_gate.test.mjs` now compares this file's table list against the live migration set, so the
   next divergence is a failing test rather than a discovery.
   ═══════════════════════════════════════════════════════════════════════════════════════════════════ */

CREATE TABLE access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK (kind IN ('calendar_member','calendar_public','waiver_sign','guardian_invite')),
  token_sha TEXT NOT NULL,
  contact_id INTEGER,
  team_member_id INTEGER,
  label TEXT,
  expires_at TEXT,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_user_id INTEGER,
  revoked_at TEXT,
  deleted_at TEXT
);
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL DEFAULT 'news' CHECK (kind IN ('cta','news')),
  title TEXT NOT NULL,
  body TEXT,
  link_url TEXT,
  link_label TEXT,
  starts_at TEXT,
  ends_at TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE announcement_mutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  scope TEXT NOT NULL CHECK (scope IN ('item','category')),
  category TEXT,
  announcement_id INTEGER REFERENCES announcements(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE (org_id, contact_id, scope, category, announcement_id)
);
CREATE TABLE spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('court','room')),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE space_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE preset_spaces (
  preset_id INTEGER NOT NULL REFERENCES space_presets(id),
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  PRIMARY KEY (preset_id, space_id)
);
CREATE TABLE space_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER REFERENCES events(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  preset_id INTEGER REFERENCES space_presets(id),
  share_ok INTEGER NOT NULL DEFAULT 0,
  is_closure INTEGER NOT NULL DEFAULT 0,
  staffing_json TEXT DEFAULT '{}',
  catering TEXT,
  door_charge_cents INTEGER,
  poc_name TEXT,
  poc_email TEXT,
  poc_phone TEXT,
  est_attendees INTEGER,
  series_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
);
CREATE TABLE booking_spaces (
  booking_id INTEGER NOT NULL REFERENCES space_bookings(id),
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  PRIMARY KEY (booking_id, space_id)
);
CREATE TABLE rental_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 10 REFERENCES orgs(id),
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_phone TEXT,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  spaces_text TEXT,
  est_attendees INTEGER,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  booking_id INTEGER REFERENCES space_bookings(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE segments (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, filter_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), segment_id INTEGER REFERENCES segments(id), name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', html_body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed')), sandbox INTEGER NOT NULL DEFAULT 0, recipient_count INTEGER NOT NULL DEFAULT 0, sent_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, channel TEXT NOT NULL DEFAULT 'email', sms_body TEXT);
CREATE TABLE campaign_sends (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), campaign_id INTEGER NOT NULL REFERENCES campaigns(id), contact_id INTEGER REFERENCES contacts(id), email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')), sent_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE community_moderators (org_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, PRIMARY KEY (org_id, user_id));
CREATE TABLE content_flags (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, target_type TEXT NOT NULL CHECK (target_type IN ('message','forum_post','forum_thread')), target_id INTEGER NOT NULL, reporter_contact_id INTEGER NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')), resolved_by_user_id INTEGER, resolved_at TEXT, resolution_note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE event_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE forum_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE forum_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, category_id INTEGER NOT NULL, title TEXT NOT NULL, created_by_contact_id INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, post_count INTEGER NOT NULL DEFAULT 0, last_post_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, deleted_by_user_id INTEGER);
CREATE TABLE forum_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, thread_id INTEGER NOT NULL, author_contact_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), edited_at TEXT, deleted_at TEXT, deleted_by_user_id INTEGER, delete_reason TEXT);
CREATE TABLE lfg_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL CHECK (kind IN ('team_need','player_avail','casual')),
  forming INTEGER NOT NULL DEFAULT 0,
  created_by_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  team_name TEXT,
  skill_level TEXT NOT NULL DEFAULT 'any',
  gender_requirement TEXT NOT NULL DEFAULT 'any',
  game_type TEXT NOT NULL DEFAULT 'any',
  positions TEXT,
  spots INTEGER,
  play_at TEXT,
  location_note TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE lfg_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  listing_id INTEGER NOT NULL REFERENCES lfg_listings(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','withdrawn')),
  is_bail INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE lfg_strikes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  listing_id INTEGER REFERENCES lfg_listings(id),
  kind TEXT NOT NULL CHECK (kind IN ('no_show','bail')),
  reported_by_contact_id INTEGER REFERENCES contacts(id),
  cleared_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE lfg_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  reason TEXT,
  starts_at TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at TEXT NOT NULL,
  lifted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE member_blocks (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, blocker_contact_id INTEGER NOT NULL, blocked_contact_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, UNIQUE(org_id, blocker_contact_id, blocked_contact_id));
CREATE TABLE member_mutes (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, reason TEXT, muted_until TEXT, muted_by_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE member_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text'
             CHECK (field_type IN ('text','textarea','email','phone','number','date','select','checkbox')),
  options_json TEXT NOT NULL DEFAULT '[]',
  help_text TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  member_visible INTEGER NOT NULL DEFAULT 1,
  show_on_forms INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE member_field_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  field_id INTEGER NOT NULL REFERENCES member_fields(id),
  value TEXT,
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE message_threads (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'dm' CHECK (kind IN ('dm','sub_inquiry','join_inquiry')), subject TEXT, created_by_contact_id INTEGER NOT NULL, sub_request_id INTEGER, last_message_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, thread_id INTEGER NOT NULL, sender_contact_id INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, deleted_by_user_id INTEGER, delete_reason TEXT);
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('MONTHLY','ANNUAL')),
  perks TEXT,
  square_plan_id TEXT,
  square_variation_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  tier_id INTEGER REFERENCES membership_tiers(id),
  pricing_type TEXT NOT NULL DEFAULT 'recurring',
  sessions_included INTEGER,
  pass_valid_days INTEGER,
  signup_fee_cents INTEGER
);
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER REFERENCES users(id),
  contact_id INTEGER REFERENCES contacts(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  square_subscription_id TEXT UNIQUE,
  square_customer_id TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','canceled','deactivated')),
  started_at TEXT,
  canceled_at TEXT,
  current_period_end TEXT,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, price_cents INTEGER NOT NULL, tax_rate_bp INTEGER NOT NULL DEFAULT 0, stock INTEGER, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE sales (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), contact_id INTEGER REFERENCES contacts(id), subtotal_cents INTEGER NOT NULL, discount_cents INTEGER NOT NULL DEFAULT 0, discount_id INTEGER REFERENCES discounts(id), tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL, payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','square','comp')), square_payment_id TEXT, status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided')), note TEXT, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), voided_at TEXT, void_reason TEXT);
CREATE TABLE sale_items (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER REFERENCES products(id), label TEXT NOT NULL, qty INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, tax_rate_bp INTEGER NOT NULL DEFAULT 0, line_total_cents INTEGER NOT NULL);
CREATE TABLE sponsors (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, logo_url TEXT, link_url TEXT, placement TEXT NOT NULL DEFAULT 'home', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE staff_shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs(id), user_id INTEGER REFERENCES users(id), name_snapshot TEXT, role_label TEXT, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, contact_id INTEGER REFERENCES contacts(id), pay_basis TEXT, pay_rate_cents INTEGER, pay_units REAL, pay_amount_cents INTEGER, approved_at TEXT, approved_by INTEGER REFERENCES users(id), event_id INTEGER REFERENCES events(id));
CREATE TABLE staff_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  role_label TEXT,
  pay_basis TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_basis IN ('hourly','flat','per_session')),
  rate_cents INTEGER NOT NULL,
  effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  effective_to TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE passes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'session' CHECK (kind IN ('session','guest','trial','open_gym')),
  source TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','tier_grant','comp','manual')),
  total_sessions INTEGER,
  starts_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  price_cents INTEGER,
  tier_id INTEGER REFERENCES membership_tiers(id),
  sale_id INTEGER REFERENCES sales(id),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE pass_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  pass_id INTEGER NOT NULL REFERENCES passes(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  event_id INTEGER REFERENCES events(id),
  attendance_id INTEGER REFERENCES attendance(id),
  guest_name TEXT,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
  redeemed_by INTEGER REFERENCES users(id),
  reversed_at TEXT,
  reversed_by INTEGER REFERENCES users(id),
  reverse_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  photo_url TEXT,
  positions TEXT,
  skill_level TEXT,
  gender_division TEXT,
  height_reach TEXT,
  bio TEXT,
  privacy_tier TEXT NOT NULL DEFAULT 'hidden' CHECK (privacy_tier IN ('public','members-only','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE schedule_views (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('public','internal','custom')), show_names INTEGER NOT NULL DEFAULT 0, show_counts INTEGER NOT NULL DEFAULT 0, org_id INTEGER REFERENCES orgs(id), type_filter TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, owner_org_id INTEGER REFERENCES orgs(id), visibility TEXT NOT NULL DEFAULT 'public', min_tier_id INTEGER REFERENCES membership_tiers(id), require_membership INTEGER NOT NULL DEFAULT 0);
CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, filename TEXT NOT NULL, applied_at TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER REFERENCES contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  to_number TEXT,
  from_number TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  twilio_sid TEXT,
  error TEXT,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE sub_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  skill_levels TEXT NOT NULL DEFAULT 'any',
  genders TEXT NOT NULL DEFAULT 'any',
  game_types TEXT NOT NULL DEFAULT 'any',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE sub_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER REFERENCES events(id),
  requested_by_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  needed_at TEXT,
  skill_level TEXT NOT NULL DEFAULT 'any',
  gender_requirement TEXT NOT NULL DEFAULT 'any',
  game_type TEXT NOT NULL DEFAULT 'any',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','filled','cancelled')),
  filled_by_contact_id INTEGER REFERENCES contacts(id),
  filled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE thread_participants (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, thread_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, last_read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT, UNIQUE(thread_id, contact_id));
CREATE TABLE tryout_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  positions TEXT NOT NULL DEFAULT '[]',
  age_groups TEXT NOT NULL DEFAULT '[]',
  height_cm INTEGER,
  prev_club TEXT,
  jersey_size TEXT,
  player_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE tryout_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  evaluator_contact_id INTEGER NOT NULL REFERENCES contacts(id),
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  notes TEXT,
  verdict TEXT NOT NULL DEFAULT 'undecided' CHECK (verdict IN ('offer','no_offer','undecided')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE tryout_squads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  age_group TEXT,
  colour TEXT,
  target_size INTEGER NOT NULL DEFAULT 10,
  needs_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE tryout_squad_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  squad_id INTEGER NOT NULL REFERENCES tryout_squads(id),
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  position TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  entity TEXT,
  entity_id INTEGER,
  visibility TEXT NOT NULL DEFAULT 'private'
             CHECK (visibility IN ('private','members','public')),
  uploaded_by_user_id INTEGER REFERENCES users(id),
  uploaded_by_contact_id INTEGER REFERENCES contacts(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE webauthn_challenges (id INTEGER PRIMARY KEY AUTOINCREMENT, challenge TEXT NOT NULL UNIQUE, user_id INTEGER, kind TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
