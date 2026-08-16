/**
 * Boomtown Platform — unified admin header guard
 * File: worker/test/header_shell.test.mjs · Version: v2.1 · Date: 2026-08-02 · Ships in: v0.53.1 (v2.0 v0.53.0 · v1.0 v0.52.0)
 *
 * v2.1 (v0.53.1, external code review): TWO GUARD DEFECTS FIXED, both of the class this file
 * exists to prevent — an assertion that passes while the thing it claims to check is broken.
 *   (a) the v2.0 #btHdrAdmin check was an alternation whose second branch omitted the href, so
 *       a hijacked `href="https://evil.example/"` passed. Proven: the sabotaged header returned
 *       true. Replaced with per-attribute assertions on the extracted tag, which is also immune
 *       to attribute ORDER (the reviewer's proposed regex still failed on `hidden` before `href`).
 *   (b) nothing asserted that the nav module runs AFTER the header parses. The entire
 *       single-source binding model depends on it: if site-nav.js ran first,
 *       getElementById("btHdrMail") returns null, canonHdr goes false, and the theme toggle
 *       silently stops binding on all 14 pages with every string-scan still green. Member pages
 *       satisfy this with `defer`, admin pages with end-of-body placement, so the guard accepts
 *       EITHER. (The first draft demanded defer and went red on 27 correct admin pages — the
 *       guard was wrong, not the code. Kept as a worked example of investigating before fixing.)
 *
 * v2.0 (v0.53.0): the MEMBER canonical header — 14 site-nav pages (every site-nav page
 * except index.html, whose reduced login header app.js owns) ship ONE static header,
 * byte-identical: brand-logo img + "Boomtown Athletics" wordmark · hidden #btHdrAdmin →
 * admin.html · #btHdrMail → member-inbox.html · #themeToggle · hidden #logoutBtn ·
 * no-print · deliberately NO #orgSwitcher (owner call 2026-08-02: members act in one org).
 * site-nav.js v2.13 is the single behavior source (theme + logout); the per-page theme
 * copies in register.js/score.js/settings.js are DELETED and must not return (app.js is
 * the documented exception — it owns index.html's reduced header).
 *
 * WHY (uiux-review §6 step 4): v0.52.0 makes the admin header fully STATIC — the brand logo
 * and mail icon that admin-nav.js used to inject after first paint are markup now, the org
 * switcher lands on the 16 admin pages that never had it (the handoff's "8 former admin-shell
 * pages" was stale; the widest scan found 16 — failure class 3), and the theme toggle appears
 * on every admin page with pre-paint theme applied by the shared <head> snippet.
 *
 * The old single-source-by-injection guarantee (header_actions v1.x) is replaced by
 * single-source-by-identity: 27 static copies are safe ONLY while a guard holds them
 * byte-identical (the pre-paint snippet precedent, page_shell check 3). This guard holds:
 *
 *   1. IDENTITY + COMPLETENESS — every admin-nav.js page carries exactly one
 *      <header class="header chrome-glass no-print"> block, byte-identical across all pages,
 *      containing: .brand-logo img (static fallback src), #orgSwitcher, #btHdrMail →
 *      admin-messages.html, #themeToggle, and the Member site link.
 *   2. SINGLE-SOURCE BEHAVIORS — admin-nav.js populates #orgSwitcher (from /api/orgs, persists
 *      bt_org, honors body[data-org-switch-href]) and owns the #themeToggle listener; NO other
 *      admin page script touches either (the 12 deleted per-page copies must not return —
 *      a returning copy double-binds the toggle, which toggles twice = a dead button).
 *   3. DETAIL-PAGE OVERRIDE — admin-event.html declares data-org-switch-href (a plain reload
 *      there 404s the event under the new org).
 *
 * Scans count their own misses (floor assertions); NCs mutate the exact subject line and
 * prove every verdict can fail (tokens.test.mjs precedent). Proven-fails-live on pristine
 * v0.51.0: 27 pages fail identity/completeness (16 no switcher, 27 no static mail/logo),
 * admin-nav.js fails both behavior checks, 12 page scripts fail the no-copy scan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const read = (p) => readFileSync(new URL(p, WEB_DIR), "utf8");
const htmlPages = () => readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"));
const isAdminPage = (html) => /<script[^>]+src="assets\/admin-nav\.js[^"]*"/.test(html);

const HEADER_RE = /<header class="header chrome-glass no-print">[\s\S]*?<\/header>/;

/* ── pure verdicts — real corpus and every NC go through these ── */

/** One canonical header per admin page, with every required element. */
function headerVerdict(html) {
  if (!isAdminPage(html)) return { applies: false, ok: true };
  const m = html.match(HEADER_RE);
  if (!m) return { applies: true, ok: false, why: "canonical header block missing" };
  const h = m[0];
  const missing = [];
  if (!/<img class="brand-logo" src="assets\/logo-boom-icon-512\.png\?v=/.test(h)) missing.push("static .brand-logo img");
  if (!h.includes('id="orgSwitcher"')) missing.push("#orgSwitcher");
  if (!/id="btHdrMail"[^>]*href="admin-messages\.html"|href="admin-messages\.html"[^>]*id="btHdrMail"/.test(h)) missing.push("#btHdrMail → admin-messages.html");
  if (!h.includes('id="themeToggle"')) missing.push("#themeToggle");
  if (!h.includes('href="index.html">Member site<')) missing.push("Member site link");
  if (missing.length) return { applies: true, ok: false, why: "header missing: " + missing.join(", ") };
  return { applies: true, ok: true, header: h };
}

/** admin-nav.js must own switcher population + change handling. */
const navSwitcherVerdict = (src) =>
  src.includes('document.getElementById("orgSwitcher")') &&
  src.includes('api("/api/orgs")') &&
  src.includes('localStorage.setItem("bt_org", sw.value)') &&
  src.includes("dataset.orgSwitchHref");

/** admin-nav.js must own the theme toggle listener — and since v0.160.0 (T2-15) the flip's
    PERSISTENCE lives in BT_THEME (config.js), so the listener's load-bearing line is the
    delegation. The reverts-on-next-page failure this verdict exists for is now caught by
    themePersistVerdict below, which follows the write to its one home. */
const navThemeVerdict = (src) =>
  src.includes('document.getElementById("themeToggle")') &&
  src.includes("BT_THEME.toggleMode()");
/** config.js's BT_THEME must actually persist a flip: choose() writes the mode through put(),
    and put() is a real setItem. Strip either and every toggle reverts on the next page. */
const themePersistVerdict = (src) =>
  src.includes('put("bt_theme", mode)') &&
  src.includes("localStorage.setItem(k, v)");

/** A page script keeps NO switcher/theme copy. The signatures scanned are the two deleted
    blocks' load-bearing lines — population markup and the toggle's persistence write. Every
    orgSwitcher line is checked (first-match-only was this verdict's own failure-class-3 bug
    in draft: a note line above a returned copy would have blinded it). */
const pageCopyVerdict = (src) => {
  const hits = [];
  const swLines = src.split("\n").filter((l) => l.includes("orgSwitcher"));
  if (swLines.some((l) => !l.includes("single-source now"))) hits.push("orgSwitcher reference");
  if (src.includes('localStorage.setItem("bt_theme"')) hits.push("theme persistence write");
  return { ok: hits.length === 0, hits };
};

/* ── check 1: identity + completeness, widest set, self-counted ── */

test("every admin-nav page carries the complete canonical header, byte-identical across all", () => {
  const offenders = [];
  const variants = new Set();
  let applied = 0;
  for (const f of htmlPages()) {
    const v = headerVerdict(read(f));
    if (!v.applies) continue;
    applied++;
    if (!v.ok) { offenders.push(`${f}: ${v.why}`); continue; }
    variants.add(v.header);
  }
  assert.ok(applied >= 27, `guard floor: expected >=27 admin-nav pages, saw ${applied} (failure class 4)`);
  assert.deepEqual(offenders, [], "pages failing the canonical header:\n" + offenders.join("\n"));
  assert.equal(variants.size, 1,
    `the header must be byte-identical everywhere; saw ${variants.size} variants (drift = failure class 3)`);
});

/* ── check 2: single-source behaviors in admin-nav.js, no copies elsewhere ── */

test("admin-nav.js owns org-switcher population, persistence and the data-org-switch-href override", () => {
  assert.ok(navSwitcherVerdict(read("assets/admin-nav.js")),
    "unified switcher block missing or altered in admin-nav.js — 27 pages just lost their switcher");
});

test("admin-nav.js owns the theme toggle listener", () => {
  assert.ok(navThemeVerdict(read("assets/admin-nav.js")),
    "theme toggle listener missing in admin-nav.js — 27 header buttons just went dead");
  assert.ok(themePersistVerdict(read("assets/config.js")),
    "BT_THEME no longer persists the flip — every toggle reverts on the next page");
});

test("no admin page script keeps a switcher/theme copy (the 12 deleted blocks must not return)", () => {
  /* The scan set is DERIVED from the admin pages' own <script> tags — not a hand list (which
     would rot) and not all of assets/ (member-shell scripts like register.js legitimately
     handle their own theme; sweeping them is the over-wide inverse of failure class 3). */
  const shared = new Set(["admin-nav.js", "config.js", "build-status.js"]);
  const scripts = new Set();
  for (const f of htmlPages()) {
    const html = read(f);
    if (!isAdminPage(html)) continue;
    for (const m of html.matchAll(/<script[^>]+src="assets\/([\w.-]+\.js)/g)) {
      if (!shared.has(m[1])) scripts.add(m[1]);
    }
  }
  assert.ok(scripts.size >= 12, `guard floor: expected >=12 admin page scripts, saw ${scripts.size} (failure class 4)`);
  const offenders = [];
  for (const f of scripts) {
    const v = pageCopyVerdict(read("assets/" + f));
    if (!v.ok) offenders.push(`${f}: ${v.hits.join(", ")}`);
  }
  assert.deepEqual(offenders, [],
    "page scripts carrying a returned switcher/theme copy (double-binds the toggle → dead button):\n" + offenders.join("\n"));
});

/* ── check 3: the detail-page override ── */

test("admin-event.html declares data-org-switch-href (a reload there 404s under the new org)", () => {
  assert.ok(/<body[^>]*data-org-switch-href="admin-events\.html"/.test(read("admin-event.html")),
    "admin-event.html lost its org-switch landing override");
});

/* ── negative controls — mutate the EXACT subject line in real input ── */

test("NC-1: removing #orgSwitcher from a real page's header fails completeness", () => {
  const f = htmlPages().find((f) => headerVerdict(read(f)).ok && headerVerdict(read(f)).applies);
  const mutated = read(f).replace(/[ \t]*<select id="orgSwitcher"[^>]*><\/select>\n?/, "");
  const v = headerVerdict(mutated);
  assert.equal(v.ok, false, `stripping the switcher from ${f} must fail`);
  assert.ok(v.why.includes("#orgSwitcher"), "the verdict must name the missing element");
});

test("NC-2: a one-byte drift in one page's header breaks byte-identity", () => {
  const pages = htmlPages().filter((f) => headerVerdict(read(f)).applies && headerVerdict(read(f)).ok);
  assert.ok(pages.length >= 2, "need two header pages to prove identity can fail");
  const variants = new Set();
  pages.forEach((f, i) => {
    let h = headerVerdict(read(f)).header;
    if (i === 0) h = h.replace('aria-label="Messages"', 'aria-label="messages"'); // mutate the exact subject
    variants.add(h);
  });
  assert.ok(variants.size > 1, "a drifted copy must register as a second variant");
});

test("NC-3: stripping the change-persistence line from admin-nav.js fails the switcher verdict", () => {
  const mutated = read("assets/admin-nav.js").replace('localStorage.setItem("bt_org", sw.value)', "");
  assert.equal(navSwitcherVerdict(mutated), false, "an unpersisted switch must fail — X-Org-Id would go stale");
});

test("NC-4: stripping either link of the theme chain fails its verdict", () => {
  // Link 1: the listener stops routing through the one writer.
  const nav = read("assets/admin-nav.js");
  const navMutated = nav.replace("BT_THEME.toggleMode()", "");
  assert.notEqual(navMutated, nav, "the nav mutation did not land — this control tests nothing");
  assert.equal(navThemeVerdict(navMutated), false, "a flip that bypasses BT_THEME must fail");
  // Link 2: the writer stops persisting.
  const cfg = read("assets/config.js");
  const cfgMutated = cfg.replace('put("bt_theme", mode)', "");
  assert.notEqual(cfgMutated, cfg, "the config mutation did not land — this control tests nothing");
  assert.equal(themePersistVerdict(cfgMutated), false, "an unpersisted theme flip must fail — it reverts on the next page");
});

test("NC-5: a re-added per-page theme block fails the no-copy scan", () => {
  const real = read("assets/admin-checkin.js");
  const mutated = real + '\n  localStorage.setItem("bt_theme", next);';
  assert.equal(pageCopyVerdict(mutated).ok, false, "a returned theme write must fail — it double-binds the toggle");
});

test("NC-6: a re-added per-page switcher population fails the no-copy scan", () => {
  const real = read("assets/admin-checkin.js");
  const mutated = real + '\n  const sw = $("orgSwitcher"); sw.innerHTML = "";';
  assert.equal(pageCopyVerdict(mutated).ok, false, "a returned population block must fail");
});

test("NC-7: removing the body override from admin-event.html fails check 3", () => {
  const mutated = read("admin-event.html").replace(' data-org-switch-href="admin-events.html"', "");
  assert.equal(/<body[^>]*data-org-switch-href="admin-events\.html"/.test(mutated), false);
});

/* ═══════════════ v2.0 — MEMBER canonical header (v0.53.0) ═══════════════ */

const isMemberCanonPage = (f, html) =>
  f !== "index.html" && /<script[^>]+src="assets\/site-nav\.js[^"]*"/.test(html);

function memberHeaderVerdict(html) {
  const m = html.match(HEADER_RE);
  if (!m) return { ok: false, why: "canonical header block missing" };
  const h = m[0];
  const missing = [];
  if (!/<img class="brand-logo" src="assets\/logo-boom-icon-512\.png\?v=/.test(h)) missing.push("static .brand-logo img");
  if (!/Boomtown <span>Athletics<\/span>/.test(h)) missing.push("Athletics wordmark");
  const adminTag = h.match(/<a[^>]*id="btHdrAdmin"[^>]*>/);
  if (!adminTag) missing.push("#btHdrAdmin");
  else {
    /* per-attribute, order-independent — v2.0's alternation let a hijacked href through */
    if (!/\shref="admin\.html"/.test(adminTag[0])) missing.push('#btHdrAdmin href must be admin.html');
    if (!/\shidden(\s|>)/.test(adminTag[0])) missing.push("#btHdrAdmin must ship hidden");
  }
  if (!/id="btHdrMail"[^>]*href="member-inbox\.html"|href="member-inbox\.html"[^>]*id="btHdrMail"/.test(h)) missing.push("#btHdrMail → member-inbox.html");
  if (!h.includes('id="themeToggle"')) missing.push("#themeToggle");
  if (!/id="logoutBtn"[^>]*hidden/.test(h)) missing.push("hidden #logoutBtn");
  if (h.includes("orgSwitcher")) missing.push("UNEXPECTED #orgSwitcher (members act in one org)");
  if (missing.length) return { ok: false, why: "member header issues: " + missing.join(", ") };
  return { ok: true, header: h };
}

/* site-nav.js single-source behavior verdicts. The theme flip delegates to BT_THEME since
   v0.160.0 (T2-15); persistence is asserted at its one home by themePersistVerdict above. */
const siteNavThemeVerdict = (src) =>
  src.includes('tt.addEventListener("click"') && src.includes("BT_THEME.toggleMode()");
const siteNavLogoutVerdict = (src) =>
  src.includes('lo.addEventListener("click"') && src.includes('"/api/auth/logout"');
/* a member page-script keeping a theme copy double-binds → dead button (v0.52.0 class) */
const memberPageCopyVerdict = (src) => {
  const bad = [];
  if (/getElementById\("themeToggle"\)\s*\.\s*(onclick|addEventListener)/.test(src)) bad.push("theme listener copy");
  if (/getElementById\("logoutBtn"\)\s*\.\s*addEventListener/.test(src)) bad.push("logout listener copy");
  return bad;
};

test("the 16 canonical member pages carry the complete member header, byte-identical", () => {
  // The count is a deliberate ratchet: it reddens whenever a member page is added, so whoever added
  // one has to confirm it ships the real header rather than a lookalike. 13 → 14 in v0.73.0 for
  // live.html, the public scoreboard, which passed the byte-identical check on its first run because
  // it was generated from an existing member page rather than hand-written.
  // 14 → 15 in v0.85.0 for kotc.html, the KOTC player link. It did NOT pass on its first run — it was
  // hand-written with a reduced header (brand + theme only), and this ratchet is what caught it. The
  // header was then taken from score.html, the closest precedent: also a no-login token page, where
  // the Admin and mail links ship hidden and site-nav reveals them only if a local token exists.
  // 15 → 16 in v0.86.0 for kotc-live.html, the public KOTC standings. It passed on its first run
  // because the lesson above was applied at the start: the page was GENERATED from kotc.html's bytes
  // — the closest precedent again, and already inside this ratchet — rather than written by hand.
  // That is the intended way to add a member page, and the reason this ratchet exists is that it is
  // cheaper to be forced into it than to be caught by it.
  // 16 → 17 in v0.132.0 for sheet.html, the public drop-in sheet (SG-1) — generated from
  // register.html's bytes, the closest precedent: also a no-login public page with the full header.
  const canon = htmlPages().filter((f) => isMemberCanonPage(f, read(f)));
  assert.equal(canon.length, 17, `expected exactly 17 canonical member pages, saw ${canon.length}: ${canon.join(", ")}`);
  const headers = new Map();
  for (const f of canon) {
    const v = memberHeaderVerdict(read(f));
    assert.ok(v.ok, `${f}: ${v.why}`);
    headers.set(f, v.header);
  }
  const uniq = new Set(headers.values());
  assert.equal(uniq.size, 1,
    `member header not byte-identical — ${uniq.size} variants across: ${[...headers.keys()].join(", ")}`);
});

test("index.html keeps the reduced login header: brand img + Athletics + theme, NO mail/Admin", () => {
  const html = read("index.html");
  assert.match(html, /<img class="brand-logo" src="assets\/logo-boom-icon-512\.png\?v=/, "login brand img missing");
  assert.match(html, /Boomtown <span>Athletics<\/span>/, "login wordmark not renamed");
  assert.ok(html.includes('id="themeToggle"'), "login theme toggle missing");
  assert.ok(!html.includes("btHdrMail"), "mail icon leaked onto the login page");
  assert.ok(!html.includes("btHdrAdmin"), "Admin link leaked onto the login page");
});

test("site-nav.js v2.13 owns the member theme-toggle listener and logout", () => {
  const src = read("assets/site-nav.js");
  assert.ok(siteNavThemeVerdict(src), "single-source theme listener missing from site-nav.js");
  assert.ok(siteNavLogoutVerdict(src), "single-source logout missing from site-nav.js");
  assert.ok(src.includes('getElementById("btHdrMail")'),
    "the canonical-header marker gate is gone — site-nav would double-bind on index.html");
});

test("no member page script keeps a theme/logout copy (deleted blocks must not return), widest set", () => {
  const files = readdirSync(new URL("assets/", WEB_DIR)).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 25, `assets corpus shrank: ${files.length} js files`);
  const allowed = new Set(["site-nav.js", "admin-nav.js", "app.js"]); // app.js = index.html owner, documented
  const offenders = [];
  for (const f of files) {
    if (allowed.has(f)) continue;
    const bad = memberPageCopyVerdict(read("assets/" + f));
    if (bad.length) offenders.push(`${f}: ${bad.join(" + ")}`);
  }
  assert.deepEqual(offenders, [], `per-page header-behavior copies returned:\n${offenders.join("\n")}`);
});

test("NC-M1: removing #btHdrMail from a member header fails completeness", () => {
  // \r?\n, not \n: core.autocrlf checks home.html out CRLF on Windows, so the strip never
  // matched and the NC passed an UNMUTATED page — proving nothing. Assert the cut landed.
  const raw = read("home.html");
  const html = raw.replace(/<a id="btHdrMail"[^>]*>✉<\/a>\r?\n/, "");
  assert.notEqual(html, raw, "mutation did not land — NC is vacuous");
  assert.equal(memberHeaderVerdict(html).ok, false);
});

test("NC-M2: a one-byte drift in one member page's header breaks byte-identity", () => {
  const a = memberHeaderVerdict(read("home.html")).header;
  const b = memberHeaderVerdict(read("lfg.html").replace("Sign out", "Sign Out")).header;
  assert.notEqual(a, b, "the identity comparison must notice a one-byte drift");
});

test("NC-M3: an un-hidden Admin link fails the verdict (it must ship hidden)", () => {
  const html = read("home.html").replace(/(id="btHdrAdmin"[^>]*) hidden/, "$1");
  assert.equal(memberHeaderVerdict(html).ok, false);
});

test("NC-M4: a member header carrying an org switcher fails (members act in one org)", () => {
  const html = read("home.html").replace('<div class="spacer"></div>', '<div class="spacer"></div><select id="orgSwitcher"></select>');
  assert.equal(memberHeaderVerdict(html).ok, false);
});

test("NC-M5: stripping the theme-service delegation from site-nav.js fails the theme verdict", () => {
  const src = read("assets/site-nav.js");
  const mutated = src.replace("BT_THEME.toggleMode()", "x()");
  assert.notEqual(mutated, src, "the mutation did not land — this control tests nothing");
  assert.equal(siteNavThemeVerdict(mutated), false);
});

test("NC-M6: a re-added per-page theme copy fails the no-copy scan (exact subject line)", () => {
  const mutated = read("assets/score.js") + '\n  document.getElementById("themeToggle").onclick = () => {};';
  assert.ok(memberPageCopyVerdict(mutated).length >= 1, "the no-copy scan must catch a returned theme listener");
});

/* ═══════════════ v2.1 — script-loading contract (v0.53.1) ═══════════════ */

/* The single-source model is only correct if the nav module runs AFTER the header markup is
   parsed. TWO ways to satisfy that: `defer`, or a script tag positioned below the <header>.
   Member pages use defer; admin pages put the tag at end-of-body. The guard asserts the
   INVARIANT, not one implementation of it — the first draft demanded defer and went red on 27
   correct admin pages. Either mechanism passes; neither present fails. */
const runsAfterHeaderVerdict = (html, src) => {
  const hdrAt = html.search(/<header[\s>]/);
  const tags = [...html.matchAll(new RegExp(`<script[^>]+src="assets/${src}[^"]*"[^>]*>`, "g"))];
  if (!tags.length) return { applies: false, ok: true };
  const bad = tags.filter((m) => !/\sdefer(\s|>)/.test(m[0]) && !(hdrAt !== -1 && m.index > hdrAt));
  return { applies: true, ok: bad.length === 0, bad: bad.map((m) => m[0]) };
};

test("every nav script runs after the header parses (defer, or positioned below it)", () => {
  let checked = 0;
  const offenders = [];
  for (const f of htmlPages()) {
    const html = read(f);
    for (const src of ["site-nav.js", "admin-nav.js"]) {
      const v = runsAfterHeaderVerdict(html, src);
      if (!v.applies) continue;
      checked++;
      if (!v.ok) offenders.push(`${f} (${src}): ${v.bad.join(" ")}`);
    }
  }
  assert.ok(checked >= 41, `guard floor: expected >=41 nav script tags, saw ${checked} (failure class 4)`);
  assert.deepEqual(offenders, [],
    `nav script may run before its header \u2014 header controls will not bind:\n${offenders.join("\n")}`);
});

test("NC-M7: a hijacked #btHdrAdmin href FAILS the verdict (v2.0 passed this — the fixed defect)", () => {
  const html = read("home.html").replace('href="admin.html"', 'href="https://evil.example/pwn"');
  assert.equal(memberHeaderVerdict(html).ok, false,
    "the href hijack must fail — if it passes, the check is blind again");
});

test("NC-M8: attribute order on #btHdrAdmin does NOT matter (hidden before href still passes)", () => {
  const html = read("home.html").replace(
    /<a id="btHdrAdmin"([^>]*)href="admin\.html"([^>]*)hidden>/,
    '<a id="btHdrAdmin"$1hidden$2href="admin.html">');
  assert.equal(memberHeaderVerdict(html).ok, true, "the check must be order-independent");
});

test("NC-M9: a nav script ABOVE the header with no defer fails the verdict", () => {
  const html = read("home.html");
  const tag = html.match(/<script[^>]+src="assets\/site-nav\.js[^"]*"[^>]*>/)[0];
  /* strip defer AND hoist it above the header — neither mechanism left */
  const mutated = html.replace(tag, "").replace(/<header/, tag.replace(/\s*defer/, "") + "</script><header");
  assert.equal(runsAfterHeaderVerdict(mutated, "site-nav.js").ok, false,
    "a hoisted, non-deferred nav script must fail");
});

test("NC-M10: dropping defer is FINE when the tag already sits below the header (no false positive)", () => {
  const mutated = read("home.html").replace('site-nav.js?v=0.53.1" defer', 'site-nav.js?v=0.53.1"');
  assert.equal(runsAfterHeaderVerdict(mutated, "site-nav.js").ok, true,
    "position alone satisfies the invariant \u2014 the guard must not demand defer specifically");
});
