-- Boomtown Platform — migration 0046: an event can point at someone else's registration
-- File: db/migrations/2026-08-13_0046_external-registration_v1_0.sql · Date: 2026-08-13
-- Ships in: v0.147.0 · roadmap §-1m PM-1, §-0 B6
--
-- Two additive columns, exactly as §-1m specifies. Owner (§-1m Q4): "If it is outside
-- registration, to an outside registration." An event with an `external_url` sends people to
-- Volleyball Life / Volo instead of registering them here; `external_label` is what the button
-- says ("Register on Volleyball Life"). Both NULL on every existing row, so nothing changes on
-- any screen until an operator fills one in.
--
-- NAMED COLUMNS RATHER THAN `config_json`, WHICH ALREADY EXISTS AND WAS THE CHEAPER OPTION.
-- The deciding reason is §-1m's third rule: "it must be impossible to set both a price and an
-- external URL, or the product contradicts itself". That is a validation against `price_cents`,
-- a sibling COLUMN, and it has to run on the RESULT of a write rather than on its input — a
-- PATCH that sets only `external_url` on an event that is already priced must fail. Reading one
-- side of that comparison out of a JSON blob, in the write path and again in three payloads,
-- buys nothing and costs a parse in four places. Live D1 on 2026-08-13: 6 of 7 events carry a
-- price, so this rule is the common case, not a corner.
--
-- NO CHECK CONSTRAINT ON THE PAIR, DELIBERATELY. SQLite cannot add a table-level CHECK with
-- ALTER TABLE, and a column-level one cannot see `price_cents`. The exclusion is enforced in the
-- one write path every event edit goes through (events_admin.js's EVENT_FIELDS bag) and pinned
-- by external_registration.test.mjs in both directions. Recorded here so the next reader knows
-- the absence is a SQLite limit and a placed control, not an oversight.

ALTER TABLE events ADD COLUMN external_url TEXT;
ALTER TABLE events ADD COLUMN external_label TEXT;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0046',
  '2026-08-13_0046_external-registration_v1_0.sql',
  'events.external_url + events.external_label — PM-1: an event can point at an outside registration system instead of registering here. Both NULL on every existing row, so no screen changes until an operator fills one in. Named columns rather than config_json because the mutual exclusion with price_cents is a column comparison evaluated on the RESULT of every write. No table CHECK: SQLite cannot add one via ALTER, so the rule lives in events_admin.js''s single write path and is pinned in both directions by external_registration.test.mjs.'
);
