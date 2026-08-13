-- Boomtown Platform — migration 0047: a priced event gets a Square catalog item
-- File: db/migrations/2026-08-13_0047_event-square-item_v1_0.sql · Date: 2026-08-13
-- Ships in: v0.148.0 · roadmap §-1m K-15 (Q5 rider 2), §-0 B22
--
-- Two additive columns mirroring plans.square_plan_id / plans.square_variation_id, which is the
-- shape the EXISTING catalog-write pattern (memberships.js) already stores. When a pricing write
-- lands on an event — creation with a price, or a bulk price edit — ensureEventSquareItem creates
-- one Square catalog ITEM (with one ITEM_VARIATION carrying the price) named from the event, and
-- these columns remember its ids so the write happens once. Both NULL on every existing row:
-- nothing reads them until the code that writes them ships, and no existing event gets an item
-- until its next pricing action — the plans precedent ("edit + save to retry"), stated rather
-- than backfilled.
--
-- THE ITEM IS SCOPED TO A LOCATION, NOT A TOKEN. One platform token (env.SQUARE_ACCESS_TOKEN) is
-- what every Square call in this repo already uses; "under the appropriate organization" is
-- expressed as present_at_location_ids = [orgs.square_location_id || env.SQUARE_LOCATION_ID],
-- the exact fallback registrations.js's payment links have always used. Live D1 2026-08-13:
-- square_location_id is NULL on all 6 orgs — nothing writes it yet — so today every item lands on
-- the platform location, which is where every payment link already lands.

ALTER TABLE events ADD COLUMN square_item_id TEXT;
ALTER TABLE events ADD COLUMN square_variation_id TEXT;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0047',
  '2026-08-13_0047_event-square-item_v1_0.sql',
  'events.square_item_id + events.square_variation_id — K-15: a pricing write creates one Square catalog ITEM named from the event, scoped to the org''s location (platform fallback), and these columns remember its ids so the write is idempotent. Both NULL everywhere until the next pricing action; no backfill. An event with external_url never gets an item (PM-1''s exclusion, re-checked at the writer). Square stays sandbox until SQUARE_ENV says production.'
);
