-- Boomtown Platform — Migration 0027: Kiosk check-in (PIN/barcode)
-- File: db/migrations/2026-07-30_0027_kiosk_v1_0.sql · Version: v1.0 · Date: 2026-07-30
-- Ships in: v0.39.0 · Owner requirement #20 (verbatim): profiles collect pictures, plus a
-- bar code scanner option or PIN, displaying the profile and payment/overdue status and
-- denying where appropriate; "should be able to run off an ipad or tablet."
--
-- Additive only (standards §3). Pre-flight per F-41: sqlite_master checked 2026-07-30 —
-- no kiosk/pin/barcode column or table exists; the 0-row `checkins` table from migration
-- 0001 is documented and untouched. Apply via Cloudflare MCP ONE STATEMENT PER CALL.

-- 1. The member's check-in code. Stored uppercase, minted from a 31-char alphabet with no
--    0/O/1/I/L (unambiguous when typed at a desk). This single value is BOTH the barcode
--    payload (Code 128 on the profile page) and the typeable fallback — one field, one scan.
ALTER TABLE contacts ADD COLUMN kiosk_code TEXT;

-- 2. One live code per org. Partial: soft-deleted contacts release their code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_contacts_kiosk_code_live
  ON contacts(org_id, kiosk_code)
  WHERE kiosk_code IS NOT NULL AND deleted_at IS NULL;

-- 3. Double-scan race guard: at most one LIVE attendance row per roster member per event.
--    Walk-ins and unmatched self check-ins carry team_member_id NULL and are excluded.
--    The staff undo flow soft-deletes before any re-insert, so toggling stays legal.
--    Live data verified duplicate-free before this ships (query 2026-07-30: 0 rows).
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_member_live
  ON attendance(event_id, team_member_id)
  WHERE team_member_id IS NOT NULL AND deleted_at IS NULL;

-- 4. Ledger. A release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0027', '2026-07-30_0027_kiosk_v1_0.sql',
        'Kiosk check-in (req #20): contacts.kiosk_code + live-unique index; attendance double-scan guard. Ships in v0.39.0.');
