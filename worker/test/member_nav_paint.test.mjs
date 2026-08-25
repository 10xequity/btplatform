/**
 * Boomtown Platform — member rail paints before its badge fetches (§-1c D-15)
 * File: worker/test/member_nav_paint.test.mjs · Version: v2.0 · Date: 2026-08-24 · Ships in: v0.194.0
 *
 * v2.0 (v0.194.0, §-1r RF-16 — owner 2026-08-24): the rail's content contract is REWRITTEN to his
 * new word, which supersedes the 2026-08-18 order v1.1 pinned. His words: "Change Sign Out button
 * to profile icon then menu that opens that has Account sub choices underneath and remove from
 * left side menu. Add sign out as an option there too. Also move notifications there too … Explore
 * and Player library can go under Inbox." So: Notifications and the Account group LEAVE the rail
 * (they live in the header's profile menu now — presence pinned there, the forbid-needs-an-exit
 * rule), and the signed-in rail leads Home · Inbox · Explore · Player Library. The D-50 fragment
 * contract widens to the profile menu, whose Notifications item carries the rail's old fragment.
 *
 * v1.1 (v0.172.0, §-1r RF-12(4) + §-1c D-50 — owner 2026-08-18): this file also owns the member
 * rail's CONTENT contract now. His order pinned verbatim ("Inbox should be 2 or 3, while Home at
 * #1, then notifications"), one named route to the public grid (Explore — his option B), no two
 * items sharing a name (D-19's class), and the FRAGMENT CONTRACT: a rail item that promises a
 * page section must point at an id that exists in that page's static markup — D-50 was
 * "Notifications" pointing at home.html#notifications while no such id existed anywhere, so the
 * click silently landed at the top of the page. Two correct halves (a rail that names an anchor,
 * a page that renders a box) with nothing asserting the seam — the v0.170.0 class again.
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

/* ═══════════ v1.1 — §-1r RF-12(4) + §-1c D-50: the member rail's content contract ═══════════ */

const WEB_DIR = new URL("../../web/", import.meta.url);
/* one item per line is the file's own idiom; the ≥ floors below are what notice this extractor
   going blind if the idiom ever changes (the v0.171.0 script-src lesson) */
const navItemsOf = (src) =>
  [...src.matchAll(/\{ href: "([^"]+)",\s*ico: "[^"]*",\s*text: "([^"]+)"/g)]
    .map((m) => ({ href: m[1], text: m[2] }));
/* the signed-in slice: from the You push to the signed-out else-branch */
const signedInItemsOf = (src) => {
  const t = blankComments(src);
  const you = t.indexOf('NAV.push({ label: "You"');
  if (you === -1) return null;
  const elseAt = t.indexOf("} else {", you);
  return navItemsOf(t.slice(you, elseAt === -1 ? undefined : elseAt));
};
/* v2.0 (RF-16): his 2026-08-24 word supersedes the 2026-08-18 three — Notifications moved into
   the profile menu, and "Explore and Player library can go under Inbox". */
const HIS_ORDER = [
  ["Home", "home.html"],
  ["Inbox", "member-inbox.html"],
  ["Explore", "index.html"],
  ["Player Library", "library.html"],
];
/* the rail items RF-16 moves into the header's profile menu — forbidden on the rail, and the
   menu markup (home.html, byte-identical across pages per header_shell v4.0) is the pinned exit */
const MENU_ONLY_HREFS = ["profile.html", "membership.html", "settings.html", "help.html"];
const deadFragmentsOf = (src) => {
  const dead = [];
  for (const i of navItemsOf(blankComments(src))) {
    const hash = i.href.indexOf("#");
    if (hash === -1) continue;
    const page = i.href.slice(0, hash), frag = i.href.slice(hash + 1);
    const html = readFileSync(new URL(page, WEB_DIR), "utf8");
    if (!html.includes(`id="${frag}"`)) dead.push(`${i.text} → ${i.href}`);
  }
  return dead;
};

test("RF-16: the signed-in rail leads with HIS order — Home, Inbox, then Explore and Player Library under it", () => {
  const items = signedInItemsOf(readNav());
  assert.ok(items && items.length >= 9, `signed-in item extraction collapsed: ${items && items.length}`);
  assert.deepEqual(items.slice(0, 4).map((i) => [i.text, i.href]), HIS_ORDER,
    'owner 2026-08-24: "Explore and Player library can go under Inbox" — and Notifications moved to the profile menu');
  /* and You is the FIRST thing a signed-in member sees: the base literal carries no groups,
     so the first push in the file — the signed-in branch runs first — is the top of the rail */
  const t = blankComments(readNav());
  assert.match(t, /const NAV = \[\];/, "the base NAV literal must be empty — groups are pushed per state");
  assert.equal(t.indexOf("NAV.push("), t.indexOf('NAV.push({ label: "You"'),
    "a group is pushed above You — Home is no longer #1 for a signed-in member");
});

test("RF-12(2)+D-19: ONE route to the public grid, named Explore — and no two items share a name", () => {
  const items = signedInItemsOf(readNav());
  const grid = items.filter((i) => i.href.split("#")[0] === "index.html");
  assert.deepEqual(grid.map((i) => i.text), ["Explore"],
    "a signed-in member keeps exactly one route to the public card grid, named Explore (his option B)");
  const texts = items.map((i) => i.text);
  assert.equal(new Set(texts).size, texts.length,
    `two rail items share a name, so a member cannot predict which screen they get (D-19): ${texts.join(" · ")}`);
});

test("D-50: every fragment href in the rail points at an id that EXISTS in the target page", () => {
  /* v2.0: the rail legitimately carries ZERO fragments today (RF-16 moved Notifications, its one
     fragment item, into the profile menu) — so the extractor-blindness protection lives in
     NC-D50a's mutation, not in a some() precondition the correct rail can no longer satisfy. */
  const all = navItemsOf(blankComments(readNav()));
  assert.ok(all.length >= 15, `rail item extraction collapsed: ${all.length}`);
  assert.deepEqual(deadFragmentsOf(readNav()), [],
    "rail items promise page sections that do not exist — the click silently lands at the top (D-50)");
});

/* v2.0 (RF-16): the fragment contract WIDENS to the profile menu — its Notifications item carries
   the rail's old home.html#notifications promise, and the same seam (an anchor naming a section
   nothing renders) fails the same silent way. The menu is byte-identical across the 18 canonical
   pages (header_shell v4.0), so home.html speaks for all of them. */
const menuBlockOf = (html) => {
  const at = html.indexOf('id="btProfileMenu"');
  if (at === -1) return null;
  const end = html.indexOf("</header>", at);
  return end === -1 ? null : html.slice(at, end);
};
const deadMenuFragmentsOf = (html) => {
  const menu = menuBlockOf(html);
  if (menu === null) return ["NO MENU — id=\"btProfileMenu\" missing from the header"];
  const dead = [];
  for (const m of menu.matchAll(/href="([^"#]+)#([^"]+)"/g)) {
    const target = readFileSync(new URL(m[1], WEB_DIR), "utf8");
    if (!target.includes(`id="${m[2]}"`)) dead.push(`${m[1]}#${m[2]}`);
  }
  return dead;
};

test("RF-16 + D-50: the profile menu's fragment hrefs point at ids that EXIST", () => {
  const html = readFileSync(new URL("home.html", WEB_DIR), "utf8");
  const menu = menuBlockOf(html);
  assert.ok(menu !== null, "home.html carries no #btProfileMenu — the menu the rail items moved into is gone");
  assert.match(menu, /href="home\.html#notifications"/,
    "the menu's Notifications item lost its fragment — the rail gave that promise up to the menu (RF-16)");
  assert.deepEqual(deadMenuFragmentsOf(html), [],
    "profile-menu items promise page sections that do not exist (D-50's class, menu edition)");
});

test("NC-D50a: a rail fragment pointed at a missing id IS reported", () => {
  const src = readNav();
  const mutated = src.replace('{ href: "home.html",     ico: "⌂", text: "Home" }',
    '{ href: "home.html#nope-never-an-id", ico: "⌂", text: "Home" }');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(deadFragmentsOf(mutated), ["Home → home.html#nope-never-an-id"],
    "a dead fragment must be reported by name — if this passes, the contract check is blind");
});

test("NC-D50c: a MENU fragment pointed at a missing id IS reported", () => {
  const html = readFileSync(new URL("home.html", WEB_DIR), "utf8");
  const mutated = html.replace('href="home.html#notifications"', 'href="home.html#nope-never-an-id"');
  assert.notEqual(mutated, html, "mutation did not land — NC is vacuous");
  assert.deepEqual(deadMenuFragmentsOf(mutated), ["home.html#nope-never-an-id"],
    "a dead menu fragment must be reported — if this passes, the menu contract check is blind");
});

test("NC-D50b: swapping Explore above Inbox FAILS the order pin", () => {
  const src = readNav();
  const items = signedInItemsOf(src);
  assert.deepEqual(items.slice(0, 4).map((i) => [i.text, i.href]), HIS_ORDER,
    "the real source must satisfy his order or this NC proves nothing");
  const mutated = src
    .replace('{ href: "member-inbox.html", ico: "✉", text: "Inbox", key: "inbox" },', "@@HOLD@@")
    .replace('{ href: "index.html",    ico: "▦", text: "Explore" },',
      '{ href: "index.html",    ico: "▦", text: "Explore" },\n        { href: "member-inbox.html", ico: "✉", text: "Inbox", key: "inbox" },')
    .replace("@@HOLD@@\n", "");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.notDeepEqual(signedInItemsOf(mutated).slice(0, 4).map((i) => [i.text, i.href]), HIS_ORDER,
    "with Inbox demoted the order pin must fail — his order is the assertion");
});

/* ═══ v2.0 (RF-16): what LEFT the rail is forbidden on it — and pinned present at its new home ═══ */

test("RF-16: Notifications and the Account group are OFF the rail — they live in the profile menu", () => {
  const items = signedInItemsOf(readNav());
  assert.ok(items && items.length >= 9, `signed-in item extraction collapsed: ${items && items.length}`);
  const offenders = items.filter((i) =>
    i.text === "Notifications" || MENU_ONLY_HREFS.includes(i.href.split("#")[0]));
  assert.deepEqual(offenders.map((i) => `${i.text} → ${i.href}`), [],
    "a rail item RF-16 moved into the profile menu is back on the rail — his 2026-08-24 word: " +
    '"remove from left side menu" / "Also move notifications there too"');
  /* the forbid's EXIT, pinned in the same breath: every moved destination is reachable from the
     menu markup (byte-identical across pages per header_shell v4.0 — home.html speaks for all) */
  const menu = menuBlockOf(readFileSync(new URL("home.html", WEB_DIR), "utf8"));
  assert.ok(menu !== null, "no profile menu in home.html — the moved items would have NO home at all");
  for (const href of [...MENU_ONLY_HREFS, "home.html#notifications"]) {
    assert.ok(menu.includes(`href="${href}"`),
      `${href} is neither on the rail nor in the profile menu — the move became a deletion`);
  }
});

test("NC-RF16a: an Account destination put back on the rail IS reported", () => {
  const src = readNav();
  const mutated = src.replace('{ href: "library.html",  ico: "◎", text: "Player Library" },',
    '{ href: "library.html",  ico: "◎", text: "Player Library" },\n        { href: "settings.html", ico: "⚙", text: "Settings" },');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  const offenders = signedInItemsOf(mutated).filter((i) =>
    i.text === "Notifications" || MENU_ONLY_HREFS.includes(i.href.split("#")[0]));
  assert.deepEqual(offenders.map((i) => i.href), ["settings.html"],
    "a re-added Account rail item must be reported — if this passes, the forbid is blind");
});

/* ═══ RF-17 (v0.193.0, owner 2026-08-24): no brand row; sign-in lands on Home ═══ */

test("RF-17 — the rail emits NO brand row, and Explore keeps index.html reachable (the exit pin)", () => {
  const src = readNav();
  // Forbidding on the BUILD string, so a re-added row reddens here carrying its reason.
  assert.ok(!src.includes('class="nav-brand"'),
    "the brand row is back on the rail — the owner removed it as redundant (RF-17)");
  // The forbid needs its exit: index.html stays reachable through the Explore item. Removing
  // the brand row deleted a DUPLICATE way in, never the last one.
  assert.match(src, /href: "index\.html",\s+ico: [^,]+, text: "Explore"/,
    "Explore no longer points at index.html — removing the brand row deleted the last way in");
});

test("RF-17 — the org-brand fetch SURVIVES the card: it still feeds the contact filler (B29)", () => {
  const src = readNav();
  const start = src.indexOf("async function applyOrgBrand");
  assert.ok(start > -1, "applyOrgBrand is gone — and it was the one path feeding btOrgContact");
  const body = src.slice(start, src.indexOf("\n  }", start));
  assert.match(body, /btOrgContact\(brand\)/,
    "applyOrgBrand no longer hands the payload to btOrgContact — org contact addresses go dark");
});

test("RF-17 — a fresh sign-in lands on the member's home; the carried return page still wins", () => {
  const app = blankComments(readFileSync(new URL("../../web/assets/app.js", import.meta.url), "utf8")); // D-45
  const at = app.indexOf("async function verifyToken");
  assert.ok(at > -1, "verifyToken is gone");
  const body = app.slice(at, app.indexOf("\n  }", at));
  assert.match(body, /if \(returnTo\) \{ location\.replace\(returnTo\); return; \}/,
    "the D-48 carry lost priority — an expired-session return must beat the default landing");
  assert.match(body, /location\.replace\("home\.html"\)/,
    "sign-in no longer lands on home.html — the owner's 'Default view to home'");
});

test("RF-17 NC — a re-added brand row is caught (mutation on the real source)", () => {
  const src = readNav();
  const mutated = src.replace("aside.innerHTML = NAV.map",
    'aside.innerHTML = `<a class="nav-brand" href="index.html">Boomtown</a>` + NAV.map');
  assert.notEqual(mutated, src, "the mutation did not land — the build line moved");
  assert.ok(mutated.includes('class="nav-brand"'),
    "the planted brand row is invisible to the forbidding check — it is spelling-blind");
});
