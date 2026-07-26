-- Boomtown Platform — migration 0022
-- File: 2026-07-26_0022_legal-entities_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.28.0
-- STATUS: APPLIED to boomtown-prod 2026-07-26 21:08 UTC via Cloudflare MCP, and verified.
--         Paste this file so the repo matches the database. DO NOT RUN IT AGAIN.
--
-- Unblocks the waiver v2 publish. D-ORG-1 refuses to publish on an unset {{ENTITY}}, so
-- Match Point Social and Queens Club could not publish a waiver at all.
--
-- Two additions and three seeds.
--
--  1. orgs.legal_entity_short -- the defined abbreviation the waiver body uses after the first
--     mention: Boomtown Athletics, LLC ("BT"). Before this, the waiver text hardcoded both the
--     full name and "BT" in prose, which meant publishing it to Queens Club would have produced
--     a document where Queens Club members release Boomtown Athletics, LLC and Queens Club is
--     released by nobody. That is exactly the substitution D-ORG-1 exists to prevent, and the
--     publish validator could not catch it because there was no token to validate.
--     See waiver-text v2.2 (F-8). {{ENTITY_SHORT}} has no fallback, same rule as {{ENTITY}}.
--
--  2. orgs.legal_entity_verified -- 0 until someone confirms the name against the Colorado
--     Secretary of State business search. Owner supplied "Match Point Social LLC" and
--     "Queens Club LLC" by appending LLC to the brand names on 2026-07-26. Those are
--     PLACEHOLDERS, not confirmed registered entities.
--
--     Why the flag rather than just setting the values: D-ORG-1 deliberately refused a fallback
--     because naming the wrong company as the party a family releases from liability is the one
--     substitution that must never be guessed. Seeding a guess silently DEFEATS that guard --
--     the publish now succeeds, and nothing anywhere records that the name was invented. The
--     flag keeps the uncertainty visible: the org settings screen shows an unverified badge and
--     the publish confirmation names which entities are unverified. It does not block.
--
--     A release naming an entity that was never registered runs to nobody. Five minutes on the
--     SOS search flips this to 1.
--
-- Colorado Boom (org 4) gets no entity name -- deactivated per owner, and a deactivated org
-- cannot publish a waiver, so there is nothing to unblock.

ALTER TABLE orgs ADD COLUMN legal_entity_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN legal_entity_short TEXT;

-- Org 1: from the owner's existing signed Google Forms waiver, so this one is real.
UPDATE orgs SET legal_entity_short = 'BT',
                legal_entity_verified = 1
 WHERE id = 1;

-- Orgs 2 and 3: owner-supplied placeholders 2026-07-26. verified = 0.
UPDATE orgs SET legal_entity = 'Match Point Social LLC',
                legal_entity_short = 'MPS',
                legal_entity_verified = 0
 WHERE id = 2;

UPDATE orgs SET legal_entity = 'Queens Club LLC',
                legal_entity_short = 'QC',
                legal_entity_verified = 0
 WHERE id = 3;

INSERT OR IGNORE INTO schema_migrations (version, filename, applied_at, note) VALUES
  ('0022','2026-07-26_0022_legal-entities_v1_0.sql', datetime('now'),
   'legal_entity_verified + legal_entity_short added; MPS and QC seeded with owner-supplied placeholder names, verified=0');

/* ==================== Verification -- PASSED 2026-07-26 ====================
   SELECT id, name, legal_entity, legal_entity_short, legal_entity_verified
     FROM orgs WHERE active=1 ORDER BY id;

   1 | Boomtown Volleyball | Boomtown Athletics, LLC | BT  | 1     PASS
   2 | Match Point Social  | Match Point Social LLC  | MPS | 0     PASS
   3 | Queens Club         | Queens Club LLC         | QC  | 0     PASS

   ==================== WORKER CHANGES REQUIRED ====================
   1. Waiver publish resolves {{ENTITY}} AND {{ENTITY_SHORT}}. Both refuse on unset or empty
      (D-ORG-1, D-WV-11). Resolution happens at publish, never at render, so a signed document
      does not change retroactively when an org edits its name.
   2. Publish confirmation surfaces legal_entity_verified=0 as a named warning listing the org.
      A warning, not a block -- owner decision.
   3. Org settings screen (roadmap R2 bundle) exposes legal_entity, legal_entity_short and a
      "I have confirmed this against the Secretary of State" checkbox writing
      legal_entity_verified. Editing legal_entity resets verified to 0.
   4. Editing legal_entity on an org with published waivers must NOT retroactively alter them.
      body_sha pins the resolved text; a name change applies to the next published version only.
   ================================================================= */
