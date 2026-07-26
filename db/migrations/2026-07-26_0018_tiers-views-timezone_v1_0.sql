-- Boomtown Platform — migration 0018
-- File: 2026-07-26_0018_tiers-views-timezone_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.26.0
--
-- Three things, all additive. Nothing is dropped and nothing is rewritten in place.
--
--  1. membership_tiers + membership_grants — the Gymdesk-shaped "level" concept. A TIER is an
--     entitlement level (Bronze / Silver / All-Access). A PLAN (migration 0007) is how you pay
--     for one. They were conflated before: plans carried a price and some perk text and there
--     was no way to ask "is this member at least Silver?". Splitting them means a tier can be
--     granted by a paid subscription, by hand (comped coach, staff family), or by a sponsor
--     arrangement, and every one of those answers the same entitlement question.
--
--  2. schedule_views gets a real owner and a real visibility gate. `org_id` on that table was
--     never ownership — migration 0003 documents it as "NULL = all orgs", i.e. a CONTENT
--     FILTER. Scoping mutations by it (as an external review suggested) would have made the
--     two built-in views uneditable by everyone, because theirs is NULL. Ownership is a new
--     column. Visibility is a second new column, because `kind` describes structure
--     (built-in vs custom), not who may look.
--
--  3. orgs.timezone. Event times are stored as naive local wall-clock and were being emitted
--     to calendar clients as UTC, shifting every subscribed event 6-7 hours early. The fix
--     needs a timezone to name, and hardcoding one in five files is how it drifts apart again.
--     Default 'America/Denver' — Aurora, Colorado, which is where the facility operates today.

/* ==================== 1. Membership tiers ==================== */

CREATE TABLE IF NOT EXISTS membership_tiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  name          TEXT NOT NULL,                       -- 'All-Access'
  code          TEXT NOT NULL,                       -- 'all_access' — stable key for rules
  rank           INTEGER NOT NULL DEFAULT 0,          -- higher outranks lower; gates compare on this
  description   TEXT,
  perks         TEXT,                                -- one per line, rendered as bullets
  color         TEXT,                                -- chip colour; must pass AA on both --bg values
  -- Entitlements. Deliberately a small fixed set rather than a rules engine: build-thin.
  guest_passes_per_month INTEGER NOT NULL DEFAULT 0,
  open_gym_included      INTEGER NOT NULL DEFAULT 0,
  booking_window_days    INTEGER,                    -- how far ahead this tier may book; NULL = org default
  discount_bps           INTEGER NOT NULL DEFAULT 0, -- basis points off registrations (500 = 5%)
  visible_to_public      INTEGER NOT NULL DEFAULT 1, -- show on the public pricing page
  active        INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_tiers_org ON membership_tiers(org_id, active);

-- One live tier per code per org. Partial index so soft-deleted rows keep history and a code
-- can be reused after deletion. Same shape as ux_media_consents_live_optout (handoff 2.8 §2d).
CREATE UNIQUE INDEX IF NOT EXISTS ux_membership_tiers_live_code
  ON membership_tiers(org_id, code) WHERE deleted_at IS NULL;

/* Who holds which tier, and why. A contact may hold more than one over time; the live one is
   the row with the highest-rank tier whose window covers now(). */
CREATE TABLE IF NOT EXISTS membership_grants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES orgs(id),
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  tier_id         INTEGER NOT NULL REFERENCES membership_tiers(id),
  source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('subscription','manual','comp','staff','sponsor')),
  subscription_id INTEGER REFERENCES subscriptions(id),  -- set when source='subscription'
  starts_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at         TEXT,                                  -- NULL = open-ended
  note            TEXT,
  granted_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_grants_contact
  ON membership_grants(org_id, contact_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_membership_grants_tier
  ON membership_grants(tier_id, deleted_at);

-- A paid plan may grant a tier. NULL = the plan grants no entitlement level (billing only).
ALTER TABLE plans ADD COLUMN tier_id INTEGER REFERENCES membership_tiers(id);

/* ==================== 2. Schedule views — ownership + visibility ==================== */

-- Tenancy owner, distinct from the org_id content filter. NULL = platform-global, which is
-- what the two seeded built-ins are. Only an admin may mutate a NULL-owner view.
ALTER TABLE schedule_views ADD COLUMN owner_org_id INTEGER REFERENCES orgs(id);

-- Who may read this view. 'public' = anyone with the slug. 'internal' = any signed-in member
-- of the owning org. 'staff' = staff or admin only.
ALTER TABLE schedule_views ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';

-- Optional membership gate layered on top of visibility. Both must pass.
ALTER TABLE schedule_views ADD COLUMN min_tier_id INTEGER REFERENCES membership_tiers(id);
ALTER TABLE schedule_views ADD COLUMN require_membership INTEGER NOT NULL DEFAULT 0;

-- Backfill preserves today's behaviour exactly. Custom views are reachable by slug with no
-- auth right now, so they backfill to 'public' — this migration changes no existing access.
UPDATE schedule_views SET visibility = 'internal' WHERE kind = 'internal' AND visibility = 'public';

-- Existing single-tenant rows: adopt the content filter as the owner where one is set.
UPDATE schedule_views SET owner_org_id = org_id WHERE owner_org_id IS NULL AND org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_views_owner ON schedule_views(owner_org_id, deleted_at);

/* ==================== 3. Org timezone ==================== */

-- IANA zone name. Every calendar emission and every wall-clock render reads this instead of
-- hardcoding Denver. Aurora, Colorado is the operating facility, so that is the default.
ALTER TABLE orgs ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Denver';
