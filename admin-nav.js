-- Boomtown Platform — Migration 0012: POS-lite, promo codes, sponsors, staff shifts (M15)
-- File: db/migrations/2026-07-25_0012_pos_v1_0.sql · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.18.0
-- ADDITIVE ONLY. Applied live via Cloudflare MCP by Claude — this file is the repo record.
-- D-M15-1: promo codes reuse the dormant day-one `discounts` table (+3 columns) — no new table.

ALTER TABLE discounts ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE discounts ADD COLUMN starts_at TEXT;
ALTER TABLE discounts ADD COLUMN expires_at TEXT;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,      -- basis points: 820 = 8.20%
  stock INTEGER,                               -- NULL = untracked
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  contact_id INTEGER REFERENCES contacts(id),  -- NULL = walk-in
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  discount_id INTEGER REFERENCES discounts(id),
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','square','comp')),
  square_payment_id TEXT,                      -- NULL in sandbox
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided')),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at TEXT,
  void_reason TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER REFERENCES products(id),  -- NULL = custom line item
  label TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sponsors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  name TEXT NOT NULL,
  logo_url TEXT,
  link_url TEXT,
  placement TEXT NOT NULL DEFAULT 'home',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  user_id INTEGER REFERENCES users(id),
  name_snapshot TEXT,                          -- shift holder if not a platform user
  role_label TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_org_created ON sales(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sponsors_org_placement ON sponsors(org_id, placement, active);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_org_start ON staff_shifts(org_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_products_org_active ON products(org_id, active);
