-- Boomtown Platform — migration 0023
-- File: 2026-07-26_0023_document-library_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.28.0
-- STATUS: APPLIED to boomtown-prod 2026-07-26 via Cloudflare MCP, and verified.
--         Paste this file so the repo matches the database. DO NOT RUN IT AGAIN.
--
-- PURPOSE: retire hardcoded waiver text. Each org uploads its own documents, tokens resolve from
-- the org profile, an org may require several documents, and the required version is swappable
-- with a retroactive / future-only choice at assignment time. Gymdesk's Documents pattern.
--
-- WHAT ALREADY EXISTED (checked before writing anything, standards section 6.4):
--   waivers          1 row  -- legacy per-contact record. DEPRECATED by this migration.
--   signatures       0 rows -- ALREADY document-agnostic: document_type, document_ref,
--                              subject_contact_id, signer_contact_id, on_behalf,
--                              minor_age_at_signing, ip, user_agent, version_id.
--                              This is the table to build on.
--   waiver_versions  1 row  -- 'v1-legacy', org 1. Structurally generic already:
--                              label, body, body_sha, material, status, supersedes_id.
--
-- So this is an extension, not a parallel system. Creating a fourth signature table would have
-- repeated the profiles / member_profiles duplication logged as R-15.
--
-- NAMING NOTE: waiver_versions keeps its name and is now the document-version table for every
-- document kind. Renaming it would require a table rebuild and would break two foreign keys
-- (waivers.version_id, signatures.version_id) for zero functional gain. Read it as
-- "document_versions" and do not add a second versions table.

/* ============ 1. documents — one row per signable document per org ============ */

CREATE TABLE IF NOT EXISTS documents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id             INTEGER NOT NULL REFERENCES orgs(id),
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'waiver'
                       CHECK (kind IN ('waiver','policy','consent','media','code_of_conduct','other')),
  description        TEXT,
  requires_signature INTEGER NOT NULL DEFAULT 1,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);
-- Partial unique: slug is reusable after soft delete, same pattern as membership tier codes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_org_slug
  ON documents(org_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id, active, deleted_at);

/* ============ 2. waiver_versions becomes the document-version table ============ */

ALTER TABLE waiver_versions ADD COLUMN document_id INTEGER REFERENCES documents(id);

-- body_template holds the text AS AUTHORED, with every token intact.
-- body holds the ORG-RESOLVED text and is what body_sha hashes.
-- The split is the whole point: org tokens freeze at publish so a signed document cannot change
-- when the org later edits its phone number (D-WV-11 generalised). Signer tokens stay unresolved
-- in body and are substituted at render only.
ALTER TABLE waiver_versions ADD COLUMN body_template TEXT;

-- Original uploaded file, when the owner uploaded rather than pasted. Reference copy only.
-- A PDF cannot be reliably token-substituted, so a PDF-sourced version must carry its resolved
-- text in body as well, or be published with no tokens at all.
ALTER TABLE waiver_versions ADD COLUMN source_r2_key TEXT;

-- Snapshot of every token value used at publish, as JSON. Makes a signed document explainable
-- years later without reconstructing what orgs.phone happened to be that day.
ALTER TABLE waiver_versions ADD COLUMN tokens_json TEXT;

CREATE INDEX IF NOT EXISTS idx_waiver_versions_document
  ON waiver_versions(document_id, status, deleted_at);

/* ============ 3. document_requirements — what an org requires, of whom ============ */

CREATE TABLE IF NOT EXISTS document_requirements (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id                    INTEGER NOT NULL REFERENCES orgs(id),
  document_id               INTEGER NOT NULL REFERENCES documents(id),
  version_id                INTEGER NOT NULL REFERENCES waiver_versions(id),
  applies_to                TEXT NOT NULL DEFAULT 'all'
                              CHECK (applies_to IN ('all','adults','minors','staff')),
  signer_rule               TEXT NOT NULL DEFAULT 'either'
                              CHECK (signer_rule IN ('self','guardian','either')),
  term_days                 INTEGER,          -- 365 = annual re-sign; NULL = no expiry
  effective_from            TEXT NOT NULL DEFAULT (datetime('now')),
  retroactive               INTEGER NOT NULL DEFAULT 0,
  invalidated_count         INTEGER,          -- recorded at assignment when retroactive=1
  superseded_requirement_id INTEGER REFERENCES document_requirements(id),
  active                    INTEGER NOT NULL DEFAULT 1,
  created_by_user_id        INTEGER,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at                TEXT
);

-- Exactly ONE active requirement per (org, document, audience). Assigning a new version
-- supersedes the old one rather than stacking two contradictory obligations. Enforcing this in
-- the index rather than the worker means it cannot be bypassed by a second code path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_req_one_active
  ON document_requirements(org_id, document_id, applies_to)
  WHERE active=1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_req_org
  ON document_requirements(org_id, active, deleted_at);

/* ============ 4. signatures joins the document model ============ */

ALTER TABLE signatures ADD COLUMN document_id    INTEGER REFERENCES documents(id);
ALTER TABLE signatures ADD COLUMN requirement_id INTEGER REFERENCES document_requirements(id);
-- expires_at lives on the signature, computed from term_days at signing time. Storing it beats
-- recomputing from a term that may have changed since: the signer agreed to the term they saw.
ALTER TABLE signatures ADD COLUMN expires_at     TEXT;

CREATE INDEX IF NOT EXISTS idx_signatures_subject_doc
  ON signatures(subject_contact_id, document_id, deleted_at);

/* ============ 5. Seed ============ */

INSERT INTO documents (org_id, name, slug, kind, description, requires_signature, sort_order, active)
SELECT id, 'Liability Waiver & Release', 'liability-waiver', 'waiver',
       'Primary participation agreement. Must be current before registration or check-in.', 1, 10, 1
  FROM orgs WHERE active=1 AND deleted_at IS NULL;

UPDATE waiver_versions
   SET document_id = (SELECT d.id FROM documents d
                       WHERE d.org_id = waiver_versions.org_id AND d.slug='liability-waiver')
 WHERE document_id IS NULL;

UPDATE waivers SET version_id = 1 WHERE version_id IS NULL;

INSERT OR IGNORE INTO schema_migrations (version, filename, applied_at, note) VALUES
  ('0023','2026-07-26_0023_document-library_v1_0.sql', datetime('now'),
   'documents + document_requirements; waiver_versions gains document_id/body_template/source_r2_key/tokens_json; signatures gains document_id/requirement_id/expires_at; liability-waiver seeded for 3 active orgs; waivers deprecated in favour of signatures');

/* ==================== Verification — PASSED 2026-07-26 ====================
   1 | Boomtown Volleyball | liability-waiver | waiver | active | 1 version    PASS
   2 | Match Point Social  | liability-waiver | waiver | active | 0 versions   PASS
   3 | Queens Club         | liability-waiver | waiver | active | 0 versions   PASS
   schema_migrations = 23                                                      PASS

   ==================== DEPRECATIONS ====================
   * waivers            — DEPRECATED. Do not write to it. Read path stays until the compliance
                          query in the spec replaces it, then drop the read too. Same treatment
                          as profiles (R-15). Not dropped: 1 row, and dropping to reclaim
                          nothing is not a trade worth making (standards section 9.5).
   * waiver_text_version — the TEXT column on waivers. version_id is the real link.

   ==================== NO SCHEMA CHANGE NEEDED, ON PURPOSE ====================
   * access_tokens.kind CHECK permits only calendar_member / calendar_public / waiver_sign.
     Altering a CHECK in SQLite requires a table rebuild. 'waiver_sign' is reused as the generic
     DOCUMENT-SIGNING SESSION kind — one token, one session, N documents signed. The sign page
     iterates the org's active requirements rather than the token naming a single document.
   * No token registry table. Tokens map to orgs columns in code (spec section 2). A table would
     mean adding a row AND a code change to read the new column — two places instead of one.
   * No resign-request table. "Who must re-sign" is COMPUTED (spec section 4). A materialised
     list drifts from the signatures it summarises.
   ============================================================================= */
