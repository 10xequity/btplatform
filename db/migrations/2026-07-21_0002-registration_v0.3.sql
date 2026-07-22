-- Boomtown Platform — Migration 0002: Module 4 (Registration + Square + captain scoring)
-- Version: v0.3 · Date: 2026-07-21
-- STATUS: ALREADY APPLIED to D1 "boomtown-prod" (6cde5d11-4199-4e57-b10f-2b7e968264ea) on 2026-07-21 via MCP.
-- Kept in the repo as the schema of record. Do NOT re-run against prod.
-- All statements are additive (safe): no data touched, no columns removed.

ALTER TABLE events ADD COLUMN price_cents INTEGER;            -- entry fee; NULL/0 = free (registration auto-comped)
ALTER TABLE teams ADD COLUMN score_token TEXT;                -- captain self-scoring link token (per team, per event)
ALTER TABLE registrations ADD COLUMN checkout_url TEXT;       -- Square payment-link URL (re-sent in reminders)
ALTER TABLE registrations ADD COLUMN last_reminded_at TEXT;   -- one-click reminder tracking
CREATE INDEX IF NOT EXISTS idx_teams_score_token ON teams(score_token);
