-- Boomtown Platform — Migration 0030: Marketing SMS, scope C (owner req #17)
-- File: db/migrations/2026-08-01_0030_sms_campaigns_v1_0.sql · Version: v1.0 · Date: 2026-08-01 · Ships in: v0.44.0
--
-- Owner decision of record (2026-08-01): build Marketing SMS DORMANT, ahead of live SMS
-- proof — explicit override of the "marketing blasts wait" sequencing in sms.js v1.0.
-- No Twilio secrets are set; every send path fails closed until they are (sms.js pattern).
--
-- Additive only (standards §3). NO new table: campaigns gains a channel discriminator and
-- an SMS body; per-recipient records live in the existing sms_log (target='campaign:ID').
-- pragma_table_info('campaigns') checked live 2026-08-01: neither column exists.
-- SQLite ALTER cannot add a CHECK — channel values are enforced in code (normalizeChannel).

ALTER TABLE campaigns ADD COLUMN channel TEXT NOT NULL DEFAULT 'email';

ALTER TABLE campaigns ADD COLUMN sms_body TEXT;

INSERT INTO schema_migrations (version, filename, note)
VALUES ('0030', '2026-08-01_0030_sms_campaigns_v1_0.sql',
        'Marketing SMS scope C: campaigns.channel + campaigns.sms_body; recipients ride sms_log (req #17)');
