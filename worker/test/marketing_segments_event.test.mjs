/* Boomtown Platform — segment by event (roadmap §-1b W-F, registration → members → comms)
   File: worker/test/marketing_segments_event.test.mjs · Version: v1.0 · Date: 2026-08-06 · Ships in: v0.99.0

   W-F's premise was checked before anything was written and it held in three of four parts:
   `contacts` IS populated by checkout (registrations.js), the members screen DOES render name /
   email / phone / opt-in, and the segments + campaigns engine is built AND fully called (15 call
   sites in admin-marketing.js — no D-4 entry). The missing part was the join between them:
   the filter vocabulary was tags · played · since, where `played` knows only the event TYPE.
   "Email the people who registered for the Valentines tournament" was not expressible.

   THE LOAD-BEARING PROPERTY IS THAT A DROPPED EVENT FILTER WIDENS THE SEGMENT.
   A <select> hands back the STRING "7", never the number 7. Validating with Number.isInteger
   alone drops it silently, and a dropped filter does not match nobody — it removes the clause,
   leaving BASE_WHERE alone, i.e. EVERY reachable contact in the org. The operator meant fourteen
   registrants and would email forty-nine people. This is the parseList shape from v0.98.0 with a
   worse blast radius, so A2/A3 prove it against the real `asEventId` and `cleanFilter` rather
   than describing it in a comment.

   THE SECOND PROPERTY IS THAT THE CLAUSE CANNOT REACH ACROSS ORGS. `e.org_id` reuses ?1 — the
   org bind BASE_WHERE already carries — so the pin costs no bind and a stored filter_json holding
   another org's event id still matches nothing. A5 asserts it in the emitted SQL (immune to
   comments) and NC-1 removes it from the real source to prove this file catches that.

   Comments are stripped once into CODE/SRC — a guard's own comment has tripped the guard for the
   rule it explains five times in this repo. NC-4 controls the stripper in BOTH directions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asEventId, cleanFilter, buildSegmentWhere } from "../src/marketing.js";

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const SRC = readFileSync(new URL("../src/marketing.js", import.meta.url), "utf8");
const MKT = readFileSync(new URL("../../web/assets/admin-marketing.js", import.meta.url), "utf8");
const REG = readFileSync(new URL("../../web/assets/admin-registrations.js", import.meta.url), "utf8");
const REG_HTML = readFileSync(new URL("../../web/admin-registrations.html", import.meta.url), "utf8");
const CODE = strip(SRC), CODE_MKT = strip(MKT), CODE_REG = strip(REG);

/* ── the helpers under test, as predicates, so a negative control can re-run them on mutated input ── */
const orgPinned = (src) => /e\.org_id = \?1 AND e\.id = \?/.test(strip(src));
const postsEvent = (code) => /event:\s*\$\("mSegEvent"\)\.value/.test(code);
const rendersPicker = (code) => /id="mSegEvent"/.test(code) && /for="mSegEvent"/.test(code);
const linksToMarketing = (code) => /admin-marketing\.html\?event=/.test(code);
const hasHandler = (code) => /\$\("emailRegistrants"\)\.onclick/.test(code);

/* ─────────────────────────── the trap, proved against the real code ─────────────────────────── */

test("A1 — asEventId keeps the string a <select> posts, and rejects everything else", () => {
  assert.equal(asEventId("7"), 7, "the narrow input: a <select> value is a STRING");
  assert.equal(asEventId(7), 7);
  assert.equal(asEventId("0"), 0);
  assert.equal(asEventId("-3"), 0);
  assert.equal(asEventId("1.5"), 0);
  assert.equal(asEventId("abc"), 0);
  assert.equal(asEventId(""), 0);
  assert.equal(asEventId(null), 0);
  assert.equal(asEventId(undefined), 0);
  assert.equal(asEventId(true), 0, "Number(true) === 1 — booleans must not become event 1");
  assert.equal(asEventId({}), 0);
});

test("A2 — the naive check would drop it, which is why asEventId exists", () => {
  /* Not a style note. This is the exact line that would have shipped. */
  assert.equal(Number.isInteger("7"), false);
  assert.equal(asEventId("7"), 7);
});

test("A3 — a dropped event filter WIDENS the segment to the whole org, it does not empty it", () => {
  const kept = buildSegmentWhere(cleanFilter({ event: "7" }));
  assert.match(kept.where, /r\.event_id/, "the string survived cleanFilter and reached the SQL");
  assert.deepEqual(kept.binds, [7]);
  /* The counterfactual, run for real: no event key means no clause at all — BASE_WHERE alone. */
  const dropped = buildSegmentWhere(cleanFilter({ event: "abc" }));
  assert.equal(dropped.where, "", "no clause: every reachable contact in the org");
  assert.deepEqual(dropped.binds, []);
});

test("A4 — cleanFilter normalises to a number so filter_json never stores a string", () => {
  assert.deepEqual(cleanFilter({ event: "7" }), { event: 7 });
  assert.deepEqual(cleanFilter({ event: 7 }), { event: 7 });
  assert.deepEqual(cleanFilter({ event: "abc" }), {});
  assert.deepEqual(cleanFilter({ event: 0 }), {});
});

/* ─────────────────────────────────── the SQL it builds ─────────────────────────────────── */

test("A5 — the event clause pins the org to ?1 and adds exactly one bind", () => {
  const { where, binds } = buildSegmentWhere({ event: 7 });
  assert.match(where, /EXISTS \(SELECT 1 FROM registrations r JOIN events e/);
  assert.match(where, /e\.org_id = \?1/, "the org pin, in the emitted SQL");
  assert.match(where, /e\.id = \?/);
  assert.match(where, /r\.deleted_at IS NULL/);
  assert.match(where, /e\.deleted_at IS NULL/);
  assert.deepEqual(binds, [7], "?1 is reused, so the org costs no extra bind");
});

test("A6 — event sits between played and since, and bind order follows the SQL", () => {
  const { where, binds } = buildSegmentWhere({ tags: ["a"], played: "league", event: 7, since: "2026-06-01" });
  assert.deepEqual(binds, ["a", "league", 7, "2026-06-01"]);
  /* `r.event_id` appears in the played clause's JOIN too, so the marker has to be one only the
     event clause carries. Ordering is what keeps binds aligned with placeholders.
     v0.104.0: THE MARKER MOVED, AND THE REASON IS THE POINT. This asserted on `e.org_id = ?1`
     because only the event clause pinned the org — then §-1c D-11 added that same pin to the
     PLAYED clause, so `indexOf` began finding the played one and this test failed against a
     CORRECT change. The invariant it guards never broke: `binds` above is still exactly
     ["a","league",7,"2026-06-01"], which is the actual alignment claim. Only the marker was wrong.
     `e.id = ?` is unique to the event clause — the played clause joins on `e.id = r.event_id`,
     which does not match. A marker must be unique to the thing under test, and a marker that is
     merely unique TODAY is a test that will accuse the next correct change. */
  assert.ok(where.indexOf("e.type") < where.indexOf("e.id = ?"));
  assert.ok(where.indexOf("e.id = ?") < where.indexOf("created_at"));
});

test("A7 — the existing contract is unchanged: an empty filter still adds nothing", () => {
  assert.equal(buildSegmentWhere({}).where, "");
  assert.deepEqual(buildSegmentWhere({}).binds, []);
  assert.deepEqual(buildSegmentWhere({ played: "league" }).binds, ["league"]);
});

/* ────────────────── call sites, in BOTH directions (a route with no screen is F-1) ────────────────── */

test("A8 — the segment form renders a labelled event picker and posts its value", () => {
  assert.ok(rendersPicker(CODE_MKT), "select#mSegEvent with its <label for>");
  assert.ok(postsEvent(CODE_MKT), "and the value reaches the POST body");
  assert.match(CODE_MKT, /api\("\/api\/events"\)/, "options come from the org-scoped events route");
});

test("A9 — the registrations screen is the entry point, button and handler both", () => {
  assert.match(REG_HTML, /id="emailRegistrants"/, "the control exists in the page");
  assert.ok(hasHandler(CODE_REG), "and something is listening to it");
  assert.ok(linksToMarketing(CODE_REG), "and it carries the event across");
  assert.match(CODE_REG, /if \(!eventId\)/, "no event chosen is a human sentence, not a dead link");
});

test("A10 — the deep link is read back on the marketing side", () => {
  assert.match(CODE_MKT, /URLSearchParams\(location\.search\)\.get\("event"\)/);
  assert.match(CODE_MKT, /segmentModal\(null, fromEvent\)/, "and it opens the form with the event chosen");
});

/* ──────────────────────── negative controls — each mutates the REAL input ──────────────────────── */

test("NC-1 — removing the org pin from the real marketing.js reddens A5", () => {
  assert.ok(orgPinned(SRC), "the shipped source is pinned");
  const mutated = SRC.replace("e.org_id = ?1 AND ", "");
  assert.notEqual(mutated, SRC, "the mutation must actually change the real file");
  assert.ok(!orgPinned(mutated), "and this file catches its removal");
});

test("NC-2 — a form that stops posting the event reddens A8", () => {
  assert.ok(postsEvent(CODE_MKT));
  const mutated = CODE_MKT.replace('event: $("mSegEvent").value', "");
  assert.notEqual(mutated, CODE_MKT);
  assert.ok(!postsEvent(mutated));
});

test("NC-3 — a link that drops the event reddens A9", () => {
  assert.ok(linksToMarketing(CODE_REG));
  const mutated = CODE_REG.replace("admin-marketing.html?event=", "admin-marketing.html");
  assert.notEqual(mutated, CODE_REG);
  assert.ok(!linksToMarketing(mutated), "arriving with no event would silently offer the whole org");
});

test("NC-4 — the comment stripper is controlled in both directions", () => {
  assert.ok(!orgPinned("/* e.org_id = ?1 AND e.id = ? */"), "a comment must not satisfy the check");
  assert.ok(!orgPinned("// e.org_id = ?1 AND e.id = ?"), "nor a line comment");
  assert.ok(orgPinned("x e.org_id = ?1 AND e.id = ? y"), "and real code must still satisfy it");
  assert.ok(!/e\.org_id = \?1 AND e\.id = \?/.test(CODE.split("export function buildSegmentWhere")[0]),
    "the clause lives in the builder, not in the prose above it");
});
