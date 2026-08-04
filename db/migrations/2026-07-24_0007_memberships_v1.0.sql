-- Boomtown Platform — Migration 0007: Memberships & recurring billing
-- File: db/2026-07-24_0007_memberships_v1.0.sql · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.10.0
--
-- ⚠️ RECORD ONLY — this migration was ALREADY APPLIED to the live D1 database
-- (boomtown-prod) via Cloudflare MCP on 2026-07-24. Do NOT run it again.
-- (Statements are IF NOT EXISTS, so a re-run is harmless, but there is no need.)
--
-- Additive only: two new tables + three indexes. No existing table is altered.

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'USD',
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('MONTHLY','ANNUAL')),
  perks TEXT,                                -- one perk per line; rendered as bullets
  square_plan_id TEXT,                       -- Catalog SUBSCRIPTION_PLAN id
  square_variation_id TEXT,                  -- Catalog SUBSCRIPTION_PLAN_VARIATION id (what buyers subscribe to)
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
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
  current_period_end TEXT,                   -- Square charged_through_date
  raw_json TEXT,                             -- last webhook payload (truncated), for debugging
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_org_active ON plans(org_id, active);
