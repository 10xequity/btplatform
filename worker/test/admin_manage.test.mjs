/**
 * Boomtown Platform — the management pickers (§-1r RF-4 option C + RF-4b)
 * File: worker/test/admin_manage.test.mjs · Version: v1.0 · Date: 2026-08-21 · Ships in: v0.173.0
 *
 * HIS WORDS (2026-08-18, verbatim): "A - but create an option C - whre tournaments and Leagues
 * have their own buttons for management that sorts which they can pick of a filtered list. This
 * also adds the caveate that as the list grows, the events that past must be removed from the
 * active management list. They should still be available in the events page as an option to
 * duplicate and historical data, but should not force a user to scroll through every event over
 * time."
 *
 * THE RULE IS DATE-DERIVED BECAUSE THE DATA SAID SO — live D1, 2026-08-21: 4 of 7 events carried
 * ends_at in the past while status was still published/in_progress, and the one 'completed' row
 * was sandbox seed (event 90001). Nothing in real use writes status='completed'; a status filter
 * would show every old event forever, which is the complaint itself. So this file EXECUTES the
 * shipped rule — extracted from admin-manage.js source, never re-implemented here — against the
 * exact trap the measurement found. A re-implementation would pass whether or not the shipped
 * rule did (the shared-definition vacuity class).
 *
 * RAIL PARITY IS GUARDED HERE because sync-rail.mjs --write propagates rail.partial.html into
 * every admin page but does NOT check the partial against admin-nav.js's runtime NAV list — the
 * two can drift silently. Two correct halves; this file asserts the seam.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WEB = new URL("../../web/", import.meta.url);
const read = (p) => readFileSync(new URL(p, WEB), "utf8");

const ENTRIES = ["admin-manage.html#tournaments", "admin-manage.html#leagues"];

test("RF-4: both management entries exist in BOTH rail sources — the parity sync-rail never checks", () => {
  const partial = read("assets/rail.partial.html");
  const nav = read("assets/admin-nav.js");
  for (const e of ENTRIES) {
    assert.ok(partial.includes(`href="${e}"`), `rail.partial.html lost ${e}`);
    assert.ok(nav.includes(`"${e}"`),
      `admin-nav.js's NAV list lost ${e} — the runtime fallback rail has drifted from the partial`);
  }
});

test("RF-4: the picker page ships the synced static rail carrying its own two entries", () => {
  const page = read("admin-manage.html");
  assert.ok(page.includes('data-static="rail"'),
    "admin-manage.html must carry the synced static rail (sync-rail owns the region)");
  for (const e of ENTRIES) {
    assert.ok(page.includes(`href="${e}"`), `the synced rail on admin-manage.html is stale: missing ${e}`);
  }
  assert.match(page, /<script src="assets\/admin-manage\.js\?v=/, "the page no longer loads its module");
});

test("RF-4: a bare visit gets a default scope — hash entries highlight nothing without one", () => {
  /* Both rail entries carry hashes, so markActive() on a hash-less deep visit matches nothing and
     the rail sits dark (the exact defect nav_highlight.test.mjs exists for). The module must set a
     default hash rather than render un-located. */
  const js = read("assets/admin-manage.js");
  assert.ok(js.includes('location.replace("#tournaments")'),
    "admin-manage.js no longer defaults a hash-less visit to #tournaments");
});

/* ── the active/past rule, EXECUTED against the measured trap — never re-implemented ── */

const ruleSrc = () => {
  const m = read("assets/admin-manage.js").match(/const isPast = \(ev, now\) =>[\s\S]*?;\n/);
  return m ? m[0] : null;
};
const ruleOf = (src) => new Function(`${src}\n  return isPast;`)();

test("RF-4b: the shipped rule is date-derived — the D1-measured trap falls off the active list", () => {
  const src = ruleSrc();
  assert.ok(src, "isPast not found in admin-manage.js — if its shape changed, update the extractor WITH it");
  const isPast = ruleOf(src);
  const NOW = "2026-08-21 06:00";
  assert.equal(isPast({ ends_at: "2026-07-01 21:00", status: "published" }, NOW), true,
    "an event that ENDED must fall off the active list even though nothing ever wrote " +
    "status='completed' — 4 of 7 live events sat in exactly this state when measured");
  assert.equal(isPast({ ends_at: "2026-07-01 21:00", status: "in_progress" }, NOW), true,
    "same trap with status still in_progress");
  assert.equal(isPast({ ends_at: "2026-12-01 21:00", status: "published" }, NOW), false,
    "a future event is active");
  assert.equal(isPast({ ends_at: null, status: "draft" }, NOW), false,
    "no end date means not ended — a draft under construction stays manageable");
  assert.equal(isPast({ ends_at: "2026-12-01 21:00", status: "cancelled" }, NOW), true,
    "the operator's explicit word (cancelled) outranks a future date");
  assert.equal(isPast({ ends_at: "2026-12-01 21:00", status: "completed" }, NOW), true,
    "completed is the operator's explicit word too");
});

test("NC-R1: stripping the DATE clause from the real rule source lets the trap event stay active", () => {
  /* Proves the fixtures above actually exercise the date half — a vacuous extractor or a fixture
     that never reaches the clause would pass the real test and this one together. */
  const src = ruleSrc();
  const mutated = src.replace("!!ev.ends_at &&", "false &&");
  assert.notEqual(mutated, src, "mutation did not land — the rule's date clause changed shape; update this NC with it");
  const isPast = ruleOf(mutated);
  assert.equal(isPast({ ends_at: "2026-07-01 21:00", status: "published" }, "2026-08-21 06:00"), false,
    "with the date clause stripped the trap case must read active — otherwise these fixtures prove nothing");
});

test("RF-4: every picker row leads to the event hub — the seam the collapse will depend on", () => {
  const js = read("assets/admin-manage.js");
  const hits = js.match(/admin-manager\.html\?event=/g) || [];
  assert.ok(hits.length >= 1, "the picker no longer links admin-manager.html?event= — rows lead nowhere");
  assert.ok(read("admin-manager.html").includes('params.get("event")') || read("assets/admin-manager.js").includes('params.get("event")'),
    "the hub no longer reads ?event= — the picker's links would land on an empty hub");
});

/* ═══ v1.1 (v0.174.0, §-1c D-53) — THE WRITERS. Measured 2026-08-21: every non-NULL ends_at in
   live D1 was sandbox seed; the owner's own creation path could not produce one — the modal never
   sent it, patchEvent's allowed list dropped it (the D-34 "Saved." class), createEvent's INSERT
   never named it, and EVENT_FIELDS stripped it before insertEvent's bind (which named it — dead
   code). Four layers, each locally plausible, jointly guaranteeing NULL — so every real event
   would sit "active" forever and the owner's complaint would return as his data grew. These pins
   hold the whole write path open. ═══ */

test("D-53: every writer on the owner's path carries ends_at — or every real event is active forever", () => {
  const events = read("assets/admin-events.js");
  assert.ok(/ends_at:/.test(events), "the event modal's bag() no longer sends ends_at");
  assert.ok(events.includes('id="m_endTime"'), "the modal lost its end-time input — nothing for bag() to read");
  const t = readFileSync(new URL("../src/tournaments.js", import.meta.url), "utf8");
  const allowed = t.match(/const allowed = \[[^\]]+\]/);
  assert.ok(allowed && allowed[0].includes('"ends_at"'),
    "patchEvent's allowed list dropped ends_at — the modal sends it, the route discards it, the notice says Saved (D-34's class)");
  const ins = t.match(/INSERT INTO events \(([^)]+)\)/);
  assert.ok(ins && ins[1].includes("ends_at"), "createEvent's INSERT no longer names ends_at");
  const ea = readFileSync(new URL("../src/events_admin.js", import.meta.url), "utf8");
  const fields = ea.match(/const EVENT_FIELDS = \[[^\]]+\]/);
  assert.ok(fields && fields[0].includes('"ends_at"'),
    "EVENT_FIELDS strips ends_at, so insertEvent's bag.ends_at bind is dead code and bulk/recurring writes NULL");
});

test("D-53: recurring instances derive their end from their OWN date, never the base's verbatim", () => {
  /* A weekly series is exactly the "as the list grows" engine of his complaint. Stamping the
     base's ends_at datetime on every instance would put a January end on a March night — wrong
     in both directions. Each instance ends on its own date at the base's end TIME. */
  const ea = readFileSync(new URL("../src/events_admin.js", import.meta.url), "utf8");
  assert.ok(/endsForInstance/.test(ea),
    "createRecurring no longer derives per-instance ends_at (endsForInstance is gone)");
  const events = read("assets/admin-events.js");
  assert.ok(events.includes('id="r_endTime"'), "the recurring form lost its end-time input");
});

test("A11y: the Show-past toggle declares what it controls and whether it is open", () => {
  /* Gemini review of v0.173.0, CONFIRMED against the owner's standing ARIA rule: a toggle that
     reveals a region needs aria-controls + a live aria-expanded, or a screen reader hears a
     button that does nothing. */
  const page = read("admin-manage.html");
  assert.ok(/id="mgPastToggle"[^>]*aria-controls="mgPast"/.test(page.replace(/\n\s*/g, " ")),
    "the toggle lost aria-controls=\"mgPast\"");
  const js = read("assets/admin-manage.js");
  assert.ok(js.includes('setAttribute("aria-expanded"'),
    "admin-manage.js no longer maintains aria-expanded on the toggle");
});

test("RF-4b: the staff events list projects ends_at — the column the rule reads", () => {
  /* If the projection loses ends_at, isPast sees NULL for every event and every event reads
     active forever — the owner's complaint returns with every test above still green. */
  const src = readFileSync(new URL("../src/tournaments.js", import.meta.url), "utf8");
  const staffSel = src.match(/staff\s*\r?\n?\s*\?\s*"SELECT ([^"]+)"/);
  assert.ok(staffSel, "listEvents' staff projection not found — update this extractor with the code");
  assert.ok(staffSel[1].includes("ends_at"),
    "staff /api/events lost ends_at — the picker's rule silently reads every event as active");
});
