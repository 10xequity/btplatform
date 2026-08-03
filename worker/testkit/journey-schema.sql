-- Boomtown Platform — end-to-end journey schema fixture
-- File: worker/testkit/journey-schema.sql · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.57.0
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
, mailing_address TEXT, timezone TEXT NOT NULL DEFAULT 'America/Denver', website TEXT, admin_email TEXT, phone TEXT, address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, postal_code TEXT, is_owned INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, legal_entity TEXT, rules_url TEXT, deactivated_at TEXT, legal_entity_verified INTEGER NOT NULL DEFAULT 0, legal_entity_short TEXT, payments_parent_org_id INTEGER REFERENCES orgs(id));

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
);

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
, price_cents INTEGER, series_id TEXT, program_id INTEGER REFERENCES programs(id), recurrence_json TEXT, staff_contact_id INTEGER REFERENCES contacts(id), checkin_token TEXT);

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

CREATE TABLE webauthn_credentials (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, device_label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT, deleted_at TEXT);

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
, score_token TEXT, level_num INTEGER, division_id INTEGER REFERENCES divisions(id), pool_id INTEGER REFERENCES pools(id), note TEXT, board_order INTEGER NOT NULL DEFAULT 0);

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
