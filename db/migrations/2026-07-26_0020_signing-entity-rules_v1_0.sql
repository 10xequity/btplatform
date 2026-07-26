-- Boomtown Platform — migration 0020
-- File: 2026-07-26_0020_signing-entity-rules_v1_0.sql · Version: v1.0 · Date: 2026-07-26
-- Ships in: v0.27.0
-- STATUS: ALREADY APPLIED to boomtown-prod on 2026-07-26 via Cloudflare MCP, and verified.
--         Paste this file so the repo matches the database. DO NOT RUN IT AGAIN.
--
-- Two columns, both additive.
--
--  legal_entity — each company is its own signing entity (owner decision, D-ORG-1). The waiver's
--    {{ENTITY}} token reads this and has NO FALLBACK: an unset entity refuses the publish rather
--    than silently naming the wrong company as the party a family releases from liability. Only
--    org 1 is seeded, because "Boomtown Athletics, LLC" appears verbatim in the owner's own waiver
--    draft. The other three owned orgs are deliberately NULL — an LLC name is not guessable, and
--    guessing one into a liability waiver is worse than blocking the publish.
--
--  rules_url — §4 of the waiver incorporates facility rules by reference. A live URL is stronger
--    than none, but a DEAD url is weaker than none, and the domain transfer is still pending. So
--    {{RULES_REFERENCE}} renders "posted at the facility and available on request" while this is
--    NULL, and switches to the URL form automatically once it is set. No republish needed to go
--    from one to the other beyond the normal version bump.

ALTER TABLE orgs ADD COLUMN legal_entity TEXT;
ALTER TABLE orgs ADD COLUMN rules_url TEXT;

UPDATE orgs SET legal_entity = 'Boomtown Athletics, LLC' WHERE id = 1;
