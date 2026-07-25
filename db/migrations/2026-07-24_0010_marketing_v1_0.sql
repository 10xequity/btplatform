-- Boomtown Platform — Migration 0010: Marketing & Comms (M14 Phase A)
-- File: db/migrations/2026-07-24_0010_marketing_v1_0.sql · Version: v1.0 · Date: 2026-07-24
-- Additive only (standing rule 6). Ships in v0.16.0.

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  filter_json TEXT NOT NULL DEFAULT '{}',   -- { tags:[], played:'any'|'league'|'tournament'|'none', since:'YYYY-MM-DD' }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  segment_id INTEGER REFERENCES segments(id),
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed')),
  sandbox INTEGER NOT NULL DEFAULT 0,        -- 1 = sent without a real email provider
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  contact_id INTEGER REFERENCES contacts(id),
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_status ON campaign_sends(campaign_id, status);

-- Consent + suppression plumbing (CAN-SPAM/deliverability, spec §3.3 non-negotiables)
ALTER TABLE contacts ADD COLUMN consent_source TEXT;   -- 'signup-widget' | 'registration' | 'import' | NULL
ALTER TABLE contacts ADD COLUMN consented_at TEXT;
ALTER TABLE contacts ADD COLUMN unsub_token TEXT;      -- random hex, generated on first send
ALTER TABLE orgs ADD COLUMN mailing_address TEXT;      -- physical address; campaign send is BLOCKED until set

-- Changelog: v1.0 (2026-07-24) — initial marketing schema (segments, campaigns,
-- campaign_sends; contacts consent columns; orgs.mailing_address).
