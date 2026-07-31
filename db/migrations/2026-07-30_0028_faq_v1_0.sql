-- Boomtown Platform — Migration 0028: FAQ (owner req #21, phase 1)
-- File: db/migrations/2026-07-30_0028_faq_v1_0.sql · Version: v1.0 · Date: 2026-07-30
-- STATUS: APPLIED LIVE 2026-07-30 via Cloudflare MCP (one DDL per call), ledger row 28
-- present, CHECK constraint proven against production (published=2 rejected). DO NOT RE-RUN.
-- sqlite_master checked first per F-41 — no orphan faq* table existed.
-- Build/buy call of record (library §1): FAQ search FIRST, LLM later.

CREATE TABLE faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT,                                        -- comma-separated, lowercase, search boost
  sort_order INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT                                   -- soft delete per D-MIG
);

CREATE INDEX idx_faqs_org_pub ON faqs (org_id, published, deleted_at, sort_order);

INSERT INTO schema_migrations (version, filename, note) VALUES
  ('0028', '2026-07-30_0028_faq_v1_0.sql',
   'FAQ table for req #21 phase 1 (FAQ search first, LLM later). org_id + soft-delete per D-MIG.');
