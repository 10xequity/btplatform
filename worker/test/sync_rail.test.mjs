/* Boomtown Platform — static rail sync guard
   File: worker/test/sync_rail.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.59.0

   rail_static.test.mjs already proves the 28 rails are identical to EACH OTHER and agree with the
   NAV array. This adds the third leg: they must also match `web/assets/rail.partial.html`, the file
   sync-rail.mjs writes from. Without it the partial could rot while the pages stayed consistent,
   and the next --write would quietly revert 28 pages to a stale rail.

   Together: partial == pages == NAV. Any two agreeing is not enough. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { railPages, applyRail, RAIL_RE, PARTIAL, REPO } from "../scripts/sync-rail.mjs";

const WEB = join(REPO, "web");
const partial = readFileSync(PARTIAL, "utf8");

test("the rail partial is byte-identical to every page that carries a rail", () => {
  const pages = railPages(WEB);
  assert.ok(pages.length >= 25,
    `expected >=25 pages with a static rail, saw ${pages.length} — a shrinking corpus is its own finding`);
  const drifted = pages.filter((f) => !applyRail(readFileSync(join(WEB, f), "utf8"), partial).matches);
  assert.deepEqual(drifted, [],
    `these pages differ from rail.partial.html — run: node worker/scripts/sync-rail.mjs --write`);
});

test("the partial is a complete rail, not a fragment someone half-saved", () => {
  assert.match(partial, /^\s*<aside class="sidebar" data-static="rail"/, "must start at the aside");
  assert.match(partial, /<\/aside>\r?\n$/, "must end at the closing aside plus its newline");
  const items = (partial.match(/class="nav-item"/g) || []).length;
  assert.ok(items >= 25, `the partial carries only ${items} nav items — that is not the full rail`);
});

test("NC-1: a one-character drift in one page is detected", () => {
  const pages = railPages(WEB);
  const victim = readFileSync(join(WEB, pages[0]), "utf8");
  const mutated = victim.replace('<span class="txt">Dashboard</span>', '<span class="txt">Dashboardd</span>');
  assert.notEqual(mutated, victim, "mutation did not land — NC is vacuous");
  assert.equal(applyRail(mutated, partial).matches, false,
    "a drifted rail must not compare equal — this guard would then prove nothing");
});

test("NC-2: applyRail repairs a drifted page back to byte-equality", () => {
  const pages = railPages(WEB);
  const original = readFileSync(join(WEB, pages[0]), "utf8");
  const mutated = original.replace('<span class="txt">Dashboard</span>', '<span class="txt">Dashboardd</span>');
  const fixed = applyRail(mutated, partial).next;
  assert.equal(fixed, original, "the repair must reproduce the original file exactly, not approximately");
});

test("NC-3: a page with no rail is reported, never silently skipped", () => {
  const r = applyRail("<html><body>no rail here</body></html>", partial);
  assert.equal(r.matches, false);
  assert.equal(r.next, null, "there is nothing to repair, and pretending otherwise would insert a rail into a member page");
});

test("the rail regex does not run past the first </aside>", () => {
  // A greedy match would swallow the whole page on any document with a second aside, and the
  // "repair" would then delete real content. Non-greedy is load-bearing, so it is asserted.
  const twoAsides = `  <aside class="sidebar" data-static="rail">A</aside>\n<aside>B</aside>\n`;
  const m = twoAsides.match(RAIL_RE);
  assert.ok(m, "the rail block should still match");
  assert.ok(!m[0].includes("B"), "the match ran past the first </aside> — a repair would eat page content");
});
