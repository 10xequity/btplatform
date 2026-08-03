-- Boomtown Platform — Migration 0035: Pass/credit ledger + staff pay rates
-- File: 2026-08-03_0035_passes-staff-pay_v1_0.sql · Version: v1.0 · Date: 2026-08-03
-- Source of decision: owner 2026-08-03 — "add the configurable membership and payment system as
-- well as ability to assign like class pass or mindbody and assign staff/coaches with variable
-- pay rates. We can add a time and payroll function in a future build."
--
-- sqlite_master check (F-41), run live 2026-08-03 BEFORE this design was fixed:
--   no passes / credits / redemptions table of any kind exists. `staff_shifts` DOES exist
--   (user_id, role_label, starts_at, ends_at, note) but carries NO pay information at all, so
--   variable pay is additive columns on a real table rather than a new one.
--   `membership_tiers.guest_passes_per_month` exists and is DISPLAYED by tiers.js — but nothing
--   in the codebase can spend one. The platform promises guest passes it cannot honour. This
--   migration is what makes that column mean something.
--
-- WHY A LEDGER AND NOT A COUNTER. There is deliberately NO `used_sessions` column. Remaining is
-- derived: total_sessions minus the count of live redemption rows. A stored counter is a second
-- source of truth for the same fact, and this codebase already has the scar (F-26: one definition
-- of "has a live waiver", written twice, drifted, and passed a gate it should have failed). A
-- counter drifts silently on a reversal, a soft delete or a retry; a COUNT() cannot.
--
-- ONE PRIMITIVE, THREE PRODUCTS. A pass is "N sessions, valid between two dates". That is
-- simultaneously: a class pass (Mindbody/ClassPass model), a lesson pack (buy 10, deduct on
-- booking), and a membership guest-pass allowance. Building the ledger once means each of those
-- is a row shape, not a new subsystem.
--
-- Additive only (standards §3): two new tables + six ALTERs on staff_shifts + one new rate table.
-- org_id + deleted_at on every table (D-MIG, multi-company day-1).

-- ============================ passes ============================

CREATE TABLE passes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES orgs(id),
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'session'
                  CHECK (kind IN ('session','guest','trial','open_gym')),
  source          TEXT NOT NULL DEFAULT 'purchase'
                  CHECK (source IN ('purchase','tier_grant','comp','manual')),
  -- NULL total_sessions = unlimited WITHIN the date window (a monthly open-gym pass).
  -- A finite number = a punch card. Both are the same row shape.
  total_sessions  INTEGER,
  starts_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT,
  price_cents     INTEGER,
  tier_id         INTEGER REFERENCES membership_tiers(id),
  sale_id         INTEGER REFERENCES sales(id),
  note            TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX idx_passes_contact_live ON passes (org_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_passes_expiry ON passes (org_id, expires_at) WHERE deleted_at IS NULL;

CREATE TABLE pass_redemptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES orgs(id),
  pass_id         INTEGER NOT NULL REFERENCES passes(id),
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  event_id        INTEGER REFERENCES events(id),
  attendance_id   INTEGER REFERENCES attendance(id),
  -- A guest pass is spent BY the member ON someone else; this records who walked in.
  guest_name      TEXT,
  redeemed_at     TEXT NOT NULL DEFAULT (datetime('now')),
  redeemed_by     INTEGER REFERENCES users(id),
  -- Reversal is a state change, never a delete: the desk mis-scans, and the audit trail must
  -- show both the mistake and the correction. A reversed row stops counting against the balance.
  reversed_at     TEXT,
  reversed_by     INTEGER REFERENCES users(id),
  reverse_reason  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX idx_pass_redemptions_pass ON pass_redemptions (org_id, pass_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_pass_redemptions_contact ON pass_redemptions (org_id, contact_id) WHERE deleted_at IS NULL;

-- ============================ staff pay ============================

-- Standing rate card per person (and optionally per role, so one coach can be paid one rate for
-- coaching and another for reffing). The SHIFT freezes its own numbers at approval time, so
-- changing a rate next season never rewrites what someone was already paid.
CREATE TABLE staff_rates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES orgs(id),
  contact_id     INTEGER NOT NULL REFERENCES contacts(id),
  role_label     TEXT,
  pay_basis      TEXT NOT NULL DEFAULT 'hourly'
                 CHECK (pay_basis IN ('hourly','flat','per_session')),
  rate_cents     INTEGER NOT NULL,
  effective_from TEXT NOT NULL DEFAULT (datetime('now')),
  effective_to   TEXT,
  note           TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
);
CREATE INDEX idx_staff_rates_contact ON staff_rates (org_id, contact_id) WHERE deleted_at IS NULL;

-- Pay on the shift itself. Frozen at approval (F-34 discipline applied to money): an approved
-- shift keeps the rate it was approved at, so a later rate change cannot silently restate history.
ALTER TABLE staff_shifts ADD COLUMN contact_id INTEGER REFERENCES contacts(id);
ALTER TABLE staff_shifts ADD COLUMN pay_basis TEXT;
ALTER TABLE staff_shifts ADD COLUMN pay_rate_cents INTEGER;
ALTER TABLE staff_shifts ADD COLUMN pay_units REAL;
ALTER TABLE staff_shifts ADD COLUMN pay_amount_cents INTEGER;
ALTER TABLE staff_shifts ADD COLUMN approved_at TEXT;
ALTER TABLE staff_shifts ADD COLUMN approved_by INTEGER REFERENCES users(id);
ALTER TABLE staff_shifts ADD COLUMN event_id INTEGER REFERENCES events(id);

-- ============================ configurable pricing ============================

-- `plans.billing_interval` is CHECK-constrained to MONTHLY|ANNUAL and cannot be widened without a
-- table rebuild, which is not additive. pricing_type is an additive column alongside it: the
-- Gymdesk vocabulary (recurring / one-time / per-session / trial) without touching the Square
-- subscription path that MONTHLY|ANNUAL already drives.
ALTER TABLE plans ADD COLUMN pricing_type TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE plans ADD COLUMN sessions_included INTEGER;
ALTER TABLE plans ADD COLUMN pass_valid_days INTEGER;
ALTER TABLE plans ADD COLUMN signup_fee_cents INTEGER;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0035', '2026-08-03_0035_passes-staff-pay_v1_0.sql',
        'Pass/credit ledger (passes + pass_redemptions, balance DERIVED not counted) makes membership_tiers.guest_passes_per_month redeemable and gives class-pass/lesson-pack one primitive; staff_rates + 8 staff_shifts pay columns frozen at approval (payroll foundation); plans pricing_type/sessions_included/pass_valid_days/signup_fee_cents');
