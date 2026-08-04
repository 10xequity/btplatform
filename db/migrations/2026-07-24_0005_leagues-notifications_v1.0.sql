-- Boomtown Platform — Migration 0005: Leagues + Notifications columns
-- File: db/2026-07-24_0005_leagues-notifications_v1.0.sql · Version: v1.0 (record) · Date: 2026-07-24
--
-- ⚠️ ALREADY APPLIED to live boomtown-prod on 2026-07-23 via Cloudflare MCP and
-- schema-verified (see handoff v1.2). This file exists so the repo's db/ folder
-- is a complete record — the original shipped in the v0.7.0 ZIP that was never
-- uploaded. DO NOT RUN AGAIN (ALTER TABLE ADD COLUMN fails on existing columns).
--
-- Additive only:
ALTER TABLE events ADD COLUMN staff_contact_id INTEGER REFERENCES contacts(id);
ALTER TABLE teams ADD COLUMN level_num INTEGER;
ALTER TABLE team_members ADD COLUMN invited_at TEXT;
ALTER TABLE team_members ADD COLUMN reminded_at TEXT;
ALTER TABLE notifications ADD COLUMN contact_id INTEGER REFERENCES contacts(id);
ALTER TABLE notifications ADD COLUMN title TEXT;
ALTER TABLE notifications ADD COLUMN body TEXT;
ALTER TABLE notifications ADD COLUMN link TEXT;
ALTER TABLE notifications ADD COLUMN read_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_contact ON notifications(contact_id, read_at);
CREATE INDEX IF NOT EXISTS idx_teams_event_level ON teams(event_id, level_num);
