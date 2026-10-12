-- Boomtown Platform — migration 0054: prizes and prize inventory
-- File: db/migrations/2026-10-12_0054_prizes_v1_0.sql · Date: 2026-10-12
-- Ships in: v0.213.0 · owner ask 2026-10-12 ("prize and inventory management system")
--
-- FULLY ADDITIVE. Four new tables, one partial unique index. Nothing existing is altered and
-- nothing reads these until prizes.js mounts in the same release.
--
-- SHAPE. Stock is NEVER stored — it is derived: on hand = SUM(receipt lines) − SUM(awards), the
-- same "derived, never stored" rule brackets.js uses for who-feeds-whom. A stored counter drifts
-- the first time a receipt is voided after an award; a sum cannot. An opening count or shrinkage
-- is a receipt with source 'adjustment' (lines may be negative there, nowhere else).
--
-- CASH. The finance sheets (2022 Tournament Finances, Open Money, Womens 6s) pay 1st/2nd/3rd in
-- CASH and give gear to the lower places, so an award carries EITHER an item (qty) or cash_cents,
-- or both. Cash is logged, not stocked.
--
-- EMAIL. A receipt logged from an invoice email carries the Gmail message id so the same invoice
-- cannot be logged twice (partial unique index — manual receipts have no id and are unconstrained).
CREATE TABLE IF NOT EXISTS prize_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0,      -- last known cost; receipts carry their own
  sponsor_id INTEGER REFERENCES sponsors(id),      -- who donated it, if anyone
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS prize_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  vendor TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT,                               -- YYYY-MM-DD as typed or read off the invoice
  total_cents INTEGER,                             -- the invoice total, NULL when unknown
  upload_id INTEGER REFERENCES uploads(id),        -- the invoice file (kind 'receipt'), if attached
  source TEXT NOT NULL DEFAULT 'manual',           -- 'manual' | 'email' | 'adjustment' (code-side list)
  email_message_id TEXT,                           -- Gmail message id when logged from an email
  notes TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prize_receipts_email
  ON prize_receipts (org_id, email_message_id) WHERE email_message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS prize_receipt_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  receipt_id INTEGER NOT NULL REFERENCES prize_receipts(id),
  item_id INTEGER NOT NULL REFERENCES prize_items(id),
  qty INTEGER NOT NULL,                            -- negative only on an 'adjustment' receipt
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prize_receipt_lines_item ON prize_receipt_lines (org_id, item_id);
CREATE TABLE IF NOT EXISTS prize_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  team_id INTEGER REFERENCES teams(id),            -- NULL when the recipient is typed (an MVP, a raffle)
  recipient TEXT,                                  -- display name snapshot: the team name or a typed name
  place INTEGER,                                   -- 1, 2, 3 … NULL for a non-placing award
  bracket_name TEXT,                               -- 'A', 'Gold' … which bracket the place is in
  item_id INTEGER REFERENCES prize_items(id),      -- NULL for a cash-only award
  qty INTEGER NOT NULL DEFAULT 1,
  cash_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  awarded_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_prize_awards_event ON prize_awards (org_id, event_id);
INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0054',
  '2026-10-12_0054_prizes_v1_0.sql',
  'Prizes + inventory: prize_items, prize_receipts (+lines, invoice upload, email dedupe), prize_awards (item and/or cash per finisher). Stock derived = receipts - awards, never stored.'
);
