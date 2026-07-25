-- Boomtown Platform — Migration 0014: Web Push subscriptions
-- File: 2026-07-25_0014_push_v1_0.sql · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.20.0
-- Additive only. One row per browser/device subscription. endpoint is globally unique.
-- email mirrors users.email at subscribe time so email-keyed flows (waitlist offers)
-- can push without a join through sessions.

CREATE TABLE IF NOT EXISTS push_subscriptions (
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

CREATE INDEX IF NOT EXISTS idx_push_email ON push_subscriptions(email) ;
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
