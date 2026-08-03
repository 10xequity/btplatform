-- Boomtown Platform — Migration 0034: Membership custom-field registry (M22)
-- File: 2026-08-02_0034_member-fields_v1_0.sql · Version: v1.0 · Date: 2026-08-02
-- Source of decision: requirements §2 (owner 2026-08-01, verbatim intent): "add fields from the
-- system to membership profiles and remove them (make them seen/unseen on forms) as needed;
-- more robust membership system similar to other systems."
--
-- sqlite_master check (F-41), run live 2026-08-02 BEFORE this design was fixed:
--   no member_fields / member_field_values / custom_fields table of any kind exists.
--   `form_fields` DOES exist but is scoped to a single EVENT (form_fields.event_id) — it is the
--   per-event registration form, not a membership profile. This migration generalises that
--   proven pattern to the org level rather than inventing a second vocabulary: same column
--   names (label, field_type, options_json, required, sort_order) so anyone who has read one
--   can read the other.
--   `member_profiles` exists and holds FIXED, product-defined columns (bio, positions,
--   skill_level…). Those stay. This is the OPEN half — fields the org invents.
--
-- Owner rule encoded here: HIDE ≠ DELETE. `active` toggles a field off every form and profile
-- while every recorded value stays on disk, so switching a field back on restores the data
-- rather than starting from nothing. That is why there is an `active` flag AND a `deleted_at`:
-- deactivating is the normal, reversible operation; deleting is the rare one, and it is soft.
--
-- Two visibility switches, deliberately separate — they answer different questions:
--   member_visible : may the MEMBER see and edit this on their own profile?
--   show_on_forms  : does it appear on public signup/registration forms?
-- A dietary-restriction field is member_visible and on forms. An internal "coach notes" field is
-- neither — staff only. Collapsing them into one flag would make that case unrepresentable.
--
-- Additive only (standards §3): two new tables, no ALTER of an existing one.
-- org_id + deleted_at on every table (D-MIG, multi-company day-1).

CREATE TABLE member_fields (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES orgs(id),
  field_key      TEXT NOT NULL,
  label          TEXT NOT NULL,
  field_type     TEXT NOT NULL DEFAULT 'text'
                 CHECK (field_type IN ('text','textarea','email','phone','number','date','select','checkbox')),
  options_json   TEXT NOT NULL DEFAULT '[]',
  help_text      TEXT,
  required       INTEGER NOT NULL DEFAULT 0,
  member_visible INTEGER NOT NULL DEFAULT 1,
  show_on_forms  INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
);

-- field_key is the stable handle a value points at, so renaming a label never orphans data.
-- Unique per org among LIVE rows only: deleting "allergies" must not block ever creating it again.
CREATE UNIQUE INDEX ux_member_fields_live_key
  ON member_fields (org_id, field_key) WHERE deleted_at IS NULL;
CREATE INDEX idx_member_fields_org_sort
  ON member_fields (org_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE member_field_values (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES orgs(id),
  contact_id   INTEGER NOT NULL REFERENCES contacts(id),
  field_id     INTEGER NOT NULL REFERENCES member_fields(id),
  value        TEXT,
  updated_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

-- One live value per person per field. The partial index is what makes the upsert safe.
CREATE UNIQUE INDEX ux_member_field_values_live
  ON member_field_values (org_id, contact_id, field_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_member_field_values_contact
  ON member_field_values (org_id, contact_id) WHERE deleted_at IS NULL;

-- Ledger row — a release is not shipped until this row exists (recurring pattern 4).
INSERT INTO schema_migrations (version, filename, note)
VALUES ('0034', '2026-08-02_0034_member-fields_v1_0.sql',
        'M22 membership custom-field registry: member_fields (org-scoped, hide-not-delete via active, separate member_visible/show_on_forms) + member_field_values (one live value per contact per field)');
