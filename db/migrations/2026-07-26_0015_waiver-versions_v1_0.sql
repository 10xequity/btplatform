-- Boomtown Platform — Migration 0015: Waiver versioning
-- File: 2026-07-26_0015_waiver-versions_v1_0.sql · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.22.0
-- ADDITIVE ONLY. Safe to re-run (every statement is IF NOT EXISTS / guarded / idempotent).
--
-- Why: waiver text lived as a hardcoded JS constant in web/assets/register.js, so a signature
-- could never be tied to the language actually shown. This table makes the text a DB record;
-- waivers.version_id and signatures.version_id pin each signature to the exact text signed.
--
-- Concurrency guard: ux_waiver_versions_active enforces AT MOST ONE active version per org at
-- the database level. Two staff publishing at once => the second write fails the UNIQUE
-- constraint inside its batch and rolls back. This is deliberate; do not drop this index.
--
-- Backfill: every pre-existing waivers row (tagged 'v1' by registrations.js OR 'v1-PLACEHOLDER'
-- by profiles.js) is pinned to a single 'v1-legacy' row per org. NEVER left NULL.
-- The legacy row is seeded 'active' so /api/waiver/current keeps answering the moment this
-- migration lands — the registration form must not break between migration and first publish.

-- ---------- 1. Version store ----------
CREATE TABLE IF NOT EXISTS waiver_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL,                        -- human tag shown to members: 'v1', 'v2', 'v2.1'
  body TEXT NOT NULL,                         -- the full text, exactly as displayed at signing
  body_sha TEXT NOT NULL,                     -- SHA-256 hex of body; tamper/dupe detection
  material INTEGER NOT NULL DEFAULT 1,        -- 1 = substantive change -> prompts re-sign; 0 = typo/format
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','retired','legacy')),
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_by_user_id INTEGER,
  supersedes_id INTEGER,                      -- previous active version at publish time
  notes TEXT,                                 -- staff-only changelog line ("added arbitration clause")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- At most one active version per org. THIS IS THE CONCURRENT-PUBLISH GUARD.
CREATE UNIQUE INDEX IF NOT EXISTS ux_waiver_versions_active
  ON waiver_versions(org_id) WHERE status = 'active' AND deleted_at IS NULL;

-- Labels are unique per org so "you signed v2" is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS ux_waiver_versions_label
  ON waiver_versions(org_id, label) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_versions_org
  ON waiver_versions(org_id, published_at DESC);

-- ---------- 2. Pin columns (additive; SQLite ADD COLUMN is metadata-only) ----------
-- Guarded by pragma checks at the app layer; re-running these two lines on an already-migrated
-- DB errors with "duplicate column name" and is HARMLESS — the table is already correct.
ALTER TABLE waivers ADD COLUMN version_id INTEGER REFERENCES waiver_versions(id);
ALTER TABLE signatures ADD COLUMN version_id INTEGER REFERENCES waiver_versions(id);

CREATE INDEX IF NOT EXISTS idx_waivers_version ON waivers(version_id);
CREATE INDEX IF NOT EXISTS idx_signatures_version ON signatures(version_id);

-- ---------- 3. Legacy anchor, one per org that already has waivers ----------
-- body records the placeholder that was actually on screen, verbatim, so the legal record is
-- honest about what those signers saw. Do not "improve" this string.
INSERT INTO waiver_versions (org_id, label, body, body_sha, material, status, published_at, notes)
SELECT DISTINCT w.org_id,
       'v1-legacy',
       'BOOMTOWN ATHLETICS LLC — RELEASE OF LIABILITY (PLACEHOLDER — admin must replace with the full official waiver text before going live). By signing below I acknowledge the risks inherent to athletic activity and release Boomtown Athletics LLC, its organizations (Boomtown Volleyball, Match Point Social, Queens Club), staff, and venues from liability for injury or loss arising from my participation.',
       'legacy-unhashed',
       1,
       'active',
       COALESCE((SELECT MIN(signed_at) FROM waivers x WHERE x.org_id = w.org_id), datetime('now')),
       'Auto-created by migration 0015. Pre-versioning signatures pin here. This is the placeholder text those members actually saw.'
FROM waivers w
WHERE w.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM waiver_versions v
    WHERE v.org_id = w.org_id AND v.label = 'v1-legacy' AND v.deleted_at IS NULL
  );

-- Org 1 always gets an anchor even with zero waivers, so a fresh org can still serve /current.
INSERT INTO waiver_versions (org_id, label, body, body_sha, material, status, notes)
SELECT 1,
       'v1-legacy',
       'BOOMTOWN ATHLETICS LLC — RELEASE OF LIABILITY (PLACEHOLDER — admin must replace with the full official waiver text before going live). By signing below I acknowledge the risks inherent to athletic activity and release Boomtown Athletics LLC, its organizations (Boomtown Volleyball, Match Point Social, Queens Club), staff, and venues from liability for injury or loss arising from my participation.',
       'legacy-unhashed',
       1,
       'active',
       'Auto-created by migration 0015 (no prior waivers in this org).'
WHERE NOT EXISTS (
  SELECT 1 FROM waiver_versions v WHERE v.org_id = 1 AND v.deleted_at IS NULL
);

-- ---------- 4. Pin every existing signature. Both historical tags map here. ----------
UPDATE waivers
   SET version_id = (SELECT v.id FROM waiver_versions v
                     WHERE v.org_id = waivers.org_id AND v.label = 'v1-legacy' AND v.deleted_at IS NULL),
       updated_at = datetime('now')
 WHERE version_id IS NULL
   AND EXISTS (SELECT 1 FROM waiver_versions v
               WHERE v.org_id = waivers.org_id AND v.label = 'v1-legacy' AND v.deleted_at IS NULL);

UPDATE signatures
   SET version_id = (SELECT v.id FROM waiver_versions v
                     WHERE v.org_id = signatures.org_id AND v.label = 'v1-legacy' AND v.deleted_at IS NULL)
 WHERE version_id IS NULL
   AND document_type = 'waiver'
   AND EXISTS (SELECT 1 FROM waiver_versions v
               WHERE v.org_id = signatures.org_id AND v.label = 'v1-legacy' AND v.deleted_at IS NULL);

-- ---------- 5. Verify (run manually after applying; both must return 0) ----------
-- SELECT COUNT(*) FROM waivers WHERE version_id IS NULL AND deleted_at IS NULL;
-- SELECT COUNT(*) FROM signatures WHERE version_id IS NULL AND document_type='waiver' AND deleted_at IS NULL;
-- SELECT org_id, COUNT(*) FROM waiver_versions WHERE status='active' AND deleted_at IS NULL GROUP BY 1;  -- 1 per org
