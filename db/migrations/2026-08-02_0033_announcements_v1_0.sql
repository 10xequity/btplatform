-- Boomtown Platform — Migration 0033: Announcements, mutes, sub availability
-- File: 2026-08-02_0033_announcements_v1_0.sql · Version: v1.0 · Date: 2026-08-02
-- Source of decision: handoff v0_49_0 §3 (owner 2026-08-02, announcement box R3) + §4.
--
-- sqlite_master check (F-41), run live 2026-08-02 BEFORE this design was fixed:
--   no `announcements` table exists; `notifications` is a per-contact DELIVERY row
--   (kind/target/payload/read_at), not an authored, pinned, non-mutable admin post;
--   `member_mutes` is a MODERATION table (muting a member). New tables are correct.
--
-- Owner rules encoded here (handoff §3, verbatim intent):
--   (1) kind='cta' posts are the admin priority CTA: pinned first, CANNOT be muted —
--       the mute table has no rows for them because the worker refuses to write any
--       (announcements.js fail-closed rule); the schema does not need to duplicate it.
--   (2) members can hide/mute everything else: this-one (scope='item') or
--       all-future (scope='category').
--   (3) sub availability is opt-in with passive vs actively-looking state; actively-
--       looking members post the level they want (feeds LFG player_avail).
--
-- Additive only (standards §3): two new tables + three member_profiles columns.
-- org_id + deleted_at on every table (D-MIG, multi-company day-1).

CREATE TABLE announcements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id              INTEGER NOT NULL REFERENCES orgs(id),
  kind                TEXT NOT NULL DEFAULT 'news' CHECK (kind IN ('cta','news')),
  title               TEXT NOT NULL,
  body                TEXT,
  link_url            TEXT,
  link_label          TEXT,
  starts_at           TEXT,
  ends_at             TEXT,
  created_by_user_id  INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT
);
CREATE INDEX idx_announcements_org_live
  ON announcements (org_id, kind, starts_at) WHERE deleted_at IS NULL;

CREATE TABLE announcement_mutes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES orgs(id),
  contact_id       INTEGER NOT NULL REFERENCES contacts(id),
  scope            TEXT NOT NULL CHECK (scope IN ('item','category')),
  category         TEXT,                                   -- feed category key when scope='category'
  announcement_id  INTEGER REFERENCES announcements(id),   -- when scope='item'
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT,
  UNIQUE (org_id, contact_id, scope, category, announcement_id)
);
CREATE INDEX idx_announcement_mutes_member
  ON announcement_mutes (org_id, contact_id) WHERE deleted_at IS NULL;

-- Sub availability (owner rule 3). sub_opt_in / sub_opt_in_at already exist (migration 0026);
-- these refine an opted-in member: passive (findable) vs active (posts to LFG at a level).
-- sub_lfg_listing_id links the ONE availability-managed player_avail listing so toggling
-- off/passive can close exactly that listing and never a hand-posted one.
ALTER TABLE member_profiles ADD COLUMN sub_mode TEXT NOT NULL DEFAULT 'passive';
ALTER TABLE member_profiles ADD COLUMN sub_level TEXT;
ALTER TABLE member_profiles ADD COLUMN sub_lfg_listing_id INTEGER REFERENCES lfg_listings(id);

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0033', '2026-08-02_0033_announcements_v1_0.sql',
        'R3 member home: announcements (cta pinned non-mutable + news), announcement_mutes (per-item + per-category), member_profiles sub_mode/sub_level/sub_lfg_listing_id');
