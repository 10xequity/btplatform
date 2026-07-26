-- Boomtown Platform — migration 0019
-- File: 2026-07-26_0019_families-orgprofile-hand_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.27.0
-- STATUS: ALREADY APPLIED to boomtown-prod on 2026-07-26 via Cloudflare MCP, and verified.
--         Paste this file so the repo matches the database. DO NOT RUN IT AGAIN.
--
-- Three groups, all additive.
--
--  1. families + contacts.family_id — household grouping for the guardian/minor model. A family
--     holds one Square customer id so a parent's card on file covers the whole household, which
--     is what "both accounts can pay" requires without storing a card twice.
--
--  2. guardianships gains the 18th-birthday transition. The table already existed with
--     status/started_at/ended_at/end_reason; what was missing was the aged-out decision:
--       aged_out_at       — when the minor turned 18 and was prompted
--       separation_choice — 'kept' | 'separated' (owner's choice at the prompt)
--       separated_at      — when a separated account was actually split
--     A separated account keeps the guardianship row rather than deleting it, so the connection
--     stays visible ("connected / family") and the signature history stays reconstructable.
--
--  3. orgs gains a real profile: website, admin_email, phone, four address lines, is_owned and
--     active. is_owned is the important one — it decides whether an org may send email under its
--     own domain. Boomtown/Match Point/Queens Club/Colorado Boom are owned; the six facility
--     renters are not, and send as "<Name> via Boomtown" from a domain we control. Sending as
--     Special Olympics CO from their domain would fail SPF/DKIM and would be impersonation.
--
-- NOT in this migration, deliberately:
--   * date_of_birth — member_profiles.date_of_birth ALREADY EXISTS. The minor check reads it
--     rather than adding a second birthdate column. (profiles vs member_profiles duplication is
--     roadmap R-15; member_profiles is the live table, profiles is the deprecated twin.)
--   * A stored is_minor flag. Age is derived from date_of_birth at read time. A stored boolean
--     goes stale on a birthday and would silently keep an adult in a guardian-signed state.

/* ==================== 1. Families ==================== */

CREATE TABLE IF NOT EXISTS families (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id             INTEGER NOT NULL REFERENCES orgs(id),
  name               TEXT NOT NULL,
  primary_contact_id INTEGER REFERENCES contacts(id),
  square_customer_id TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_families_org ON families(org_id, deleted_at);

ALTER TABLE contacts ADD COLUMN family_id INTEGER REFERENCES families(id);
CREATE INDEX IF NOT EXISTS idx_contacts_family ON contacts(family_id, deleted_at);

/* ==================== 2. Guardianship age-out + player bio ==================== */

ALTER TABLE guardianships ADD COLUMN aged_out_at TEXT;
ALTER TABLE guardianships ADD COLUMN separation_choice TEXT;  -- 'kept' | 'separated'
ALTER TABLE guardianships ADD COLUMN separated_at TEXT;

-- Volleyball-relevant bio field. A left-handed opposite is a real roster consideration.
-- SQLite cannot add a CHECK constraint via ALTER, so the allowed set
-- ('left','right','ambidextrous') is enforced in the worker as a whitelist, the same way
-- orgs.timezone is. Free text here would reach the public player card.
ALTER TABLE member_profiles ADD COLUMN dominant_hand TEXT;

/* ==================== 3. Org profile ==================== */

ALTER TABLE orgs ADD COLUMN website TEXT;
ALTER TABLE orgs ADD COLUMN admin_email TEXT;
ALTER TABLE orgs ADD COLUMN phone TEXT;
ALTER TABLE orgs ADD COLUMN address_line1 TEXT;
ALTER TABLE orgs ADD COLUMN address_line2 TEXT;
ALTER TABLE orgs ADD COLUMN city TEXT;
ALTER TABLE orgs ADD COLUMN state TEXT;
ALTER TABLE orgs ADD COLUMN postal_code TEXT;
ALTER TABLE orgs ADD COLUMN is_owned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

/* ==================== 4. Seed the known org identities ==================== */
-- The facility address is shared by every org operating out of it. It is code-enforced on
-- marketing email (CAN-SPAM physical address gate, design spec §4).

UPDATE orgs SET address_line1='14200 E Alameda Ave', address_line2='FieldhouseUSA',
                city='Aurora', state='CO', postal_code='80012'
 WHERE deleted_at IS NULL;

UPDATE orgs SET is_owned=1, website='boomtownvb.com',    admin_email='admin@boomtownvb.com',
       email_sender_address='admin@boomtownvb.com',    email_sender_name='Boomtown Volleyball' WHERE id=1;
UPDATE orgs SET is_owned=1, website='matchptsocial.com', admin_email='admin@matchptsocial.com',
       email_sender_address='admin@matchptsocial.com', email_sender_name='Match Point Social'  WHERE id=2;
-- Queens Club has no domain of its own; owner directed it to use the Boomtown address.
UPDATE orgs SET is_owned=1, website='boomtownvb.com',    admin_email='admin@boomtownvb.com',
       email_sender_address='admin@boomtownvb.com',    email_sender_name='Queens Club'         WHERE id=3;
UPDATE orgs SET is_owned=1, website='coloradoboom.com',  admin_email='admin@coloradoboom.com',
       email_sender_address='admin@coloradoboom.com',  email_sender_name='Colorado Boom'       WHERE id=4;

-- Facility renters: our domain, their display name. Not impersonation, and SPF/DKIM passes.
UPDATE orgs SET is_owned=0, admin_email='admin@boomtownvb.com',
       email_sender_address='admin@boomtownvb.com', email_sender_name=name||' via Boomtown'
 WHERE id>=5;
