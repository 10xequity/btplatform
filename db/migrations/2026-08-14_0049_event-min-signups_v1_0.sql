-- Boomtown Platform — migration 0049: an event knows how many sign-ups it needs to run
-- File: db/migrations/2026-08-14_0049_event-min-signups_v1_0.sql · Date: 2026-08-14
-- Ships in: v0.154.0 · roadmap §-1o SG-2
--
-- One additive column. NULL means "no minimum" — the default for every existing row and for
-- any event whose operator never sets one, so the deploy changes no screen and no behaviour
-- until a threshold is typed in.
--
-- min_signups is the FLOOR of a band whose CEILING (`capacity`) shipped long ago: capacity is
-- when the event stops taking people; min_signups is when it is worth running at all. The
-- admin event screen surfaces the live count against it ("9 of 12 needed to run — 3 short"),
-- and the decision stays the operator's: the sweep never cancels anything, the Cancel button
-- does — and B16's notifyEventCancelled already tells everyone who signed up. The count is
-- activeRegistrationCount (waitlists.js) — the capacity gate's own number, in registration
-- rows, so "9 of 12" and "full at 12" can never contradict each other.

ALTER TABLE events ADD COLUMN min_signups INTEGER;

INSERT INTO schema_migrations (version, filename, note) VALUES (
  '0049',
  '2026-08-14_0049_event-min-signups_v1_0.sql',
  'events.min_signups — SG-2: the threshold under which a session is not worth running. NULL = no minimum (all existing rows). The admin event screen shows the live active-sign-up count against it; cancelling stays a human decision and B16 already notifies every active registrant. Floor of the band whose ceiling is capacity.'
);
