-- Boomtown Platform — migration 0044: per-organization module visibility (roadmap §-1l P-1)
-- File: db/migrations/2026-08-10_0044_org-modules_v1_0.sql · Date: 2026-08-10 · Ships in: v0.128.0
--
-- One additive column. It stores the modules an organization has switched OFF, as a JSON array of
-- slug keys (e.g. '["pos","marketing"]'). Storing the OFF set rather than the ON set is the whole
-- design: NULL means "hide nothing", so every existing organization keeps its full menu the moment
-- this applies, and a module added to the registry later appears everywhere by default instead of
-- waiting for every org to re-save its list.
--
-- This is NAVIGATION CONFIG, not permission. Route gating is untouched by anything that reads this
-- column; org_modules.test.mjs pins that a hidden module's routes answer exactly as before.

ALTER TABLE orgs ADD COLUMN modules_off_json TEXT;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0044',
  '2026-08-10_0044_org-modules_v1_0.sql',
  'orgs.modules_off_json — the modules an org hides from its admin menu, as a JSON slug array. NULL/empty hides nothing, so existing orgs are untouched and future registry additions default to visible. A view filter only: no route reads it for authorization, and the guard asserts a hidden module''s routes answer unchanged.'
);
