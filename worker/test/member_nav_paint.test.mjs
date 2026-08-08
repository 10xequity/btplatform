/**
 * Boomtown Platform — member rail paints before its badge fetches (§-1c D-15)
 * File: worker/test/member_nav_paint.test.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.105.0
 *
 * ── D-15'S RECORDED CANDIDATE MECHANISM WAS WRONG, AND FINDING THAT OUT IS THE UNIT ─────────
 * D-15 was filed as "site-nav.js:273 rebuilds the whole rail with aside.innerHTML on every
 * interaction" and explicitly marked NOT DIAGNOSED. It is not what happens. `init()` is called
 * ONCE, from a single call site (`site-nav.js:152`), and nothing re-invokes it — there is no
 * re-render path at all. The recorded suspicion, chased instead of checked, would have produced a
 * DOM-patching rewrite of a function that runs exactly once.
 *
 * ── WHAT ACTUALLY HAPPENS, AND IT MATCHES THE OWNER'S WORDS LITERALLY ────────────────────────
 * The owner reported that the member menus "shift and reload every interaction". Both halves are
 * true and they have different causes:
 *   · RELOAD — every rail item is an <a href="*.html">. Each click is a real page navigation, so
 *     the nav is genuinely rebuilt every interaction: the whole document is. That is the
 *     multi-page architecture, and it is what §-1d/§-1g C-2's "frame that does not reload"
 *     proposes to change. NOT this unit.
 *   · SHIFT — this unit. The rail is not in static markup on any member page: it is
 *     `document.createElement("nav")` (`:270`), populated (`:273`), and only then appended to the
 *     layout (`:280`). And the append is gated behind THREE SERIALLY AWAITED fetches —
 *     `/api/me`, then `/api/notifications`, then `/api/messages/unread-count`. So on every page
 *     load the page renders with NO navigation column at all, three round trips pass, and then an
 *     entire column is inserted, displacing everything beside it.
 *
 * ── THE INVARIANT THIS FILE PINS ─────────────────────────────────────────────────────────────
 * The rail's STRUCTURE depends only on the caller's role. The two badge COUNTS are decoration on
 * two of its items. So: **the rail must be appended before either badge endpoint is awaited**, and
 * the counts must be filled into the live DOM afterwards. That removes two of the three round
 * trips from the critical path and makes the shift a badge appearing, not a column appearing.
 *
 * This does NOT claim the shift is fully gone — `/api/me` is still awaited before the append, and
 * `applyOrgBrand` (`:282`, a fourth fetch) still rewrites the brand name and logo after the rail is
 * on screen, which can change its width. Both are recorded rather than chased. A check that reports
 * clean must say what it did not cover.
 *
 * ── WHY COMMENTS ARE BLANKED, WHICH IS NOT A DETAIL HERE ─────────────────────────────────────
 * `site-nav.js`'s own header comment names BOTH badge endpoints (`:56`, `:68`) — far above the code.
 * A naive `indexOf` finds the COMMENT first, at an offset earlier than the append, so the ordering
 * assertion below would fail permanently no matter how correct the code was. NC-N3 reproduces
 * exactly that. `blankComments` preserves length and newlines, so offsets stay true — the same
 * primitive, and the same reason, as the §-1e route extractor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const NAV_SRC = new URL("../../web/assets/site-nav.js", import.meta.url);
const readNav = () => readFileSync(NAV_SRC, "utf8");

/* ── THE MARKERS, AND WHY THEY ARE SHAPED THIS WAY ───────────────────────────────────────────
   The first draft of this file anchored on `fetch(API + "/api/notifications"` — the literal call
   shape. THE CORRECT FIX DELETED THAT SHAPE (the endpoints became arguments to a shared `count()`
   helper), so the marker vanished and the guard reddened against code that had just been fixed.
   That is §-1c D-17 happening live, inside the guard written to respect it.
   The repair is to anchor on the INVARIANT rather than on a call shape: no badge endpoint may be
   REQUESTED in the critical path between the start of `init()` and the moment the rail is
   appended. Endpoint paths are the stable thing — they are the contract with the worker — and a
   REGION check does not care whether the fetch is inline, wrapped, or three helpers deep. */
const INIT = "async function init()";
const APPEND = "layout.appendChild(aside)";
const FILL = "fillNavBadges(";
const BADGE_ENDPOINTS = ["/api/notifications", "/api/messages/unread-count"];

/** CALL SITES of `name`, never its definition — an occurrence preceded by `function` is rejected.
 *  The same rule, for the same reason, as `gateCallsIn` in worker/testkit/route-extract.mjs: this
 *  file's own first run counted `async function fillNavBadges(` as a second call site and reported
 *  the marker ambiguous. Where a helper is DEFINED says nothing about when it runs. */
export function callSitesOf(t, name) {
  const out = [];
  let i = t.indexOf(name);
  while (i >= 0) {
    if (!/\bfunction\s+$/.test(t.slice(Math.max(0, i - 24), i))) out.push(i);
    i = t.indexOf(name, i + 1);
  }
  return out;
}

/** THE VERDICT, pure so the negative controls can feed it mutated real source.
 *  Region-scoped on purpose: "anywhere in the file" would let the fetches inside the post-paint
 *  helper count as blocking, and "anywhere before the append" would drag in the header comment.
 *  The question is only ever: does the critical path touch these endpoints? */
export function railPaintsBeforeBadges(src) {
  const t = blankComments(src);
  const initStart = t.indexOf(INIT);
  const append = t.indexOf(APPEND);
  if (initStart < 0 || append < 0) return { ok: false, offenders: [], reason: "a marker vanished", initStart, append };
  if (append < initStart) return { ok: false, offenders: [], reason: "append precedes init", initStart, append };
  const critical = t.slice(initStart, append);
  const offenders = BADGE_ENDPOINTS.filter((e) => critical.includes(e));
  return { ok: offenders.length === 0, offenders, reason: "critical path", initStart, append };
}

test("the markers still exist and are unique after blanking", () => {
  const t = blankComments(readNav());
  for (const m of [INIT, APPEND]) {
    const first = t.indexOf(m);
    assert.ok(first >= 0, `marker vanished from the source: ${m}`);
    assert.equal(t.indexOf(m, first + 1), -1,
      `marker appears more than once, so indexOf picks an arbitrary one: ${m}`);
  }
  assert.equal(callSitesOf(t, FILL).length, 1,
    "expected exactly one fillNavBadges CALL SITE (its definition must not count as one)");
});

test("the rail is still built and appended at all — this file is not vacuous", () => {
  const t = blankComments(readNav());
  assert.match(t, /document\.createElement\("nav"\)/, "the rail element is no longer created");
  assert.ok(t.includes(APPEND), "the rail is no longer appended to the layout");
  assert.match(t, /aside\.innerHTML/, "the rail is no longer populated");
});

test("D-15: no badge endpoint is requested in the critical path before the rail is appended", () => {
  const v = railPaintsBeforeBadges(readNav());
  assert.ok(v.ok,
    `the rail is appended only AFTER ${JSON.stringify(v.offenders)} is requested, so every member ` +
    "page renders with NO navigation column until those round trips finish, then inserts a whole " +
    "column and displaces the content beside it. The rail's structure depends only on role — the " +
    "counts are decoration and belong after the paint.");
});

test("the badge counts are still filled, and the fill is CALLED after the append", () => {
  /* Painting first is only correct if the counts still arrive. Without this, the cheapest way to
     satisfy the test above is to delete the badges outright — "fixing" the shift by removing the
     feature. Asserted on the CALL SITE, never the definition (the standing §-1e rule): where the
     helper is DEFINED in the file says nothing about when it runs. */
  const t = blankComments(readNav());
  const append = t.indexOf(APPEND);
  const calls = callSitesOf(t, FILL);
  assert.equal(calls.length, 1, "no fillNavBadges call site — the fix must move the counts, not drop them");
  assert.ok(calls[0] > append,
    "fillNavBadges is called before the rail is appended, so it has nothing to fill");
  for (const e of BADGE_ENDPOINTS) {
    assert.ok(t.includes(e), `the ${e} count was dropped rather than moved`);
  }
});

/* ---------- negative controls: each MUTATES THE REAL SOURCE ---------- */

test("NC-N1: putting a badge fetch back into the critical path FAILS the verdict", () => {
  /* The defect exactly as it shipped: an awaited badge fetch between init() and the append.
     Injected at the real NAV.push so it lands inside the critical region of the real file. */
  const src = readNav();
  const mutated = src.replace(
    'NAV.push({ label: "You"',
    'const n = await fetch(API + "/api/notifications"); NAV.push({ label: "You"'
  );
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  const v = railPaintsBeforeBadges(mutated);
  assert.equal(v.ok, false, "a badge fetch was restored to the critical path and the verdict still passed");
  assert.deepEqual(v.offenders, ["/api/notifications"], "the verdict must name the offending endpoint");
});

test("NC-N2: deleting the append entirely FAILS the verdict rather than passing vacuously", () => {
  const mutated = readNav().replace(APPEND, "/* gone */");
  const v = railPaintsBeforeBadges(mutated);
  assert.equal(v.ok, false, "with no append at all the verdict must fail, not silently succeed");
});

test("NC-N3: a COMMENT naming an endpoint in the critical path must not be read as a request", () => {
  /* Why blanking is not a detail here. This very fix left a long comment inside init() explaining
     which endpoints moved OUT of the critical path — and it names both of them. A verdict that did
     not blank comments would read that explanation as the defect it describes and accuse correct
     code forever. The mutation inserts exactly that shape, and the verdict must stay green. */
  const src = readNav();
  const mutated = src.replace(
    'NAV.push({ label: "You"',
    '/* moved out of here: /api/notifications and /api/messages/unread-count */ NAV.push({ label: "You"'
  );
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  const v = railPaintsBeforeBadges(mutated);
  assert.equal(v.ok, true,
    `a commented-out endpoint name was counted as a live request: ${JSON.stringify(v.offenders)}`);
});
