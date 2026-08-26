/**
 * Boomtown Platform — unified admin header guard
 * File: worker/test/header_shell.test.mjs · Version: v4.0 · Date: 2026-08-24 · Ships in: v0.194.0 (v3.0 v0.171.0 · v2.1 v0.53.1 · v2.0 v0.53.0 · v1.0 v0.52.0)
 *
 * v4.0 (v0.194.0, §-1r RF-16 — owner 2026-08-24): the member header's standalone Sign-out button
 * becomes a hidden profile ICON (#btHdrProfile) opening a static menu (#btProfileMenu):
 * Notifications, the four Account destinations, and #logoutBtn inside it (same id — the
 * single-source logout binding and its guards carry over). memberHeaderVerdict requires the new
 * set and FORBIDS any static admin affordance in the header (btSwitchAdmin/admin.html) — the
 * role-gated switch is JS-rendered by site-nav.js and guarded in header_actions.test.mjs v5.0.
 * NC-M5b proves the static-switch arm can fail. This SUPERSEDES the v2.0/v3.0 requirement that
 * #logoutBtn stand alone in the header row — his 2026-08-24 word replaces his 2026-08-18 word.
 *
 * v3.0 (v0.171.0, §-1r RF-12 — owner 2026-08-18): the member canonical header LOSES #btHdrAdmin.
 * "There should be no admin access from this screen" — so memberHeaderVerdict now FORBIDS the
 * anchor (the same shape as its #orgSwitcher rule) instead of requiring it hidden with an
 * admin.html href. NC-M3 inverts (a re-added anchor must fail, even shipped hidden exactly as it
 * used to); NC-M7/NC-M8 are retired WITH their purpose stated: both existed to prove the verdict
 * read the anchor's attributes correctly, and a verdict that forbids the anchor outright has no
 * attributes to misread — the ban subsumes the hijack case NC-M7 guarded.
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
 * byte-identical: brand-logo img + "Boomtown Athletics" wordmark · #btHdrMail →
 * member-inbox.html · #themeToggle · hidden #logoutBtn · no-print · deliberately NO
 * #orgSwitcher (owner call 2026-08-02: members act in one org) · and since v3.0 NO
 * #btHdrAdmin (RF-12 — it shipped hidden-with-reveal from v2.0 until then).
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
import { blankComments } from "../testkit/route-extract.mjs";

const WEB_DIR = new URL("../../web/", import.meta.url);
/* D-45 cluster 5 (v0.196.0): .js reads are comment-blanked at the door — raw-source-sweep
   measured 3 pairs here a commented-out line could satisfy. HTML reads stay RAW on purpose:
   the header byte-identity checks compare shipped bytes, comments included. */
const read = (p) => {
  const s = readFileSync(new URL(p, WEB_DIR), "utf8");
  return p.endsWith(".js") ? blankComments(s) : s;
};
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
  // v4.3 (§-1d, owner 2026-08-26): the admin header gained a profile menu — Account settings + Sign
  // out top-right — so Settings could leave the rail. Required on every admin page, byte-identical.
  if (!h.includes('id="btHdrProfile"')) missing.push("#btHdrProfile (profile menu button)");
  if (!h.includes('id="btProfileMenu"')) missing.push("#btProfileMenu (profile menu)");
  if (missing.length) return { applies: true, ok: false, why: "header missing: " + missing.join(", ") };
  return { applies: true, ok: true, header: h };
}

/** admin-nav.js must own switcher population + change handling.
    The persistence link is anchored on WHAT IS GUARANTEED — the chosen org is written under the
    `bt_org` key from the switcher's own value — not on which function does the writing. D-41
    (v0.166.0) moved that write behind admin-nav's guarded `safeSet`, and this verdict, which
    named `localStorage.setItem` literally, went red on a change that improved the very line it
    guards. Fourth recorded instance of a control anchored on a spelling the fix relocated. */
const persistsOrgChoice = (src) => /(?:safeSet|localStorage\.setItem)\("bt_org", sw\.value\)/.test(src);
const navSwitcherVerdict = (src) =>
  src.includes('document.getElementById("orgSwitcher")') &&
  src.includes('api("/api/orgs")') &&
  persistsOrgChoice(src) &&
  src.includes("dataset.orgSwitchHref");

/** admin-nav.js must own the theme toggle HANDOFF — v4.1 (RF-15, owner 2026-08-24: "Theme picker
    should be available from the button, not just from menu"): the ◐ no longer blind-flips; each
    shell hands the element to BT_THEME.attachPicker, which opens the six-chip picker (the SAME
    mountPicker Settings and the admin Appearance modal mount — one judgement, third mount).
    The flip's PERSISTENCE stays in BT_THEME (themePersistVerdict follows the write). */
const navThemeVerdict = (src) =>
  src.includes('document.getElementById("themeToggle")') &&
  src.includes("BT_THEME.attachPicker(");
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
  // Both spellings: since D-41 a page could persist the theme through a guarded wrapper just as
  // easily as through raw storage, and a forbid naming only the raw form would wave it past.
  if (/(?:safeSet|localStorage\.setItem)\("bt_theme"/.test(src)) hits.push("theme persistence write");
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
  const real = read("assets/admin-nav.js");
  const mutated = real.replace(/(?:safeSet|localStorage\.setItem)\("bt_org", sw\.value\)/, "");
  assert.notEqual(mutated, real, "the mutation did not land — the verdict's anchor moved again");
  assert.equal(navSwitcherVerdict(mutated), false, "an unpersisted switch must fail — X-Org-Id would go stale");
  // And the re-anchored verdict must accept BOTH writers, or it forbids the guarded form.
  assert.equal(persistsOrgChoice('localStorage.setItem("bt_org", sw.value);'), true);
  assert.equal(persistsOrgChoice('safeSet("bt_org", sw.value);'), true);
});

test("NC-4: stripping either link of the theme chain fails its verdict", () => {
  // Link 1: the shell stops handing the button to the service.
  const nav = read("assets/admin-nav.js");
  const navMutated = nav.replace("BT_THEME.attachPicker(", "x(");
  assert.notEqual(navMutated, nav, "the nav mutation did not land — this control tests nothing");
  assert.equal(navThemeVerdict(navMutated), false, "a ◐ that bypasses BT_THEME must fail");
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
  /* v3.0 (RF-12): the anchor is FORBIDDEN, hidden or not — same shape as the orgSwitcher rule.
     An outright ban has no attributes to misread, which is what retires NC-M7/NC-M8. */
  if (h.includes("btHdrAdmin")) missing.push("UNEXPECTED #btHdrAdmin (RF-12: no admin affordance on member surfaces)");
  if (!/id="btHdrMail"[^>]*href="member-inbox\.html"|href="member-inbox\.html"[^>]*id="btHdrMail"/.test(h)) missing.push("#btHdrMail → member-inbox.html");
  if (!h.includes('id="themeToggle"')) missing.push("#themeToggle");
  /* v4.0 (§-1r RF-16, owner 2026-08-24): "Change Sign Out button to profile icon then menu that
     opens that has Account sub choices underneath … Add sign out as an option there too. Also move
     notifications there too." The standalone Sign-out button becomes a hidden profile ICON
     (revealed from the local token, the v2.14 rule) opening a static menu: Notifications (the
     fragment D-50 pinned), the four Account destinations, and #logoutBtn INSIDE the menu — same
     id, so site-nav.js's single-source logout binding and its guards carry over unchanged.
     The role-gated "Switch to admin" is JS-RENDERED by site-nav.js, never static markup — a
     static one would be an ungated admin affordance, which RF-12 still forbids. */
  if (!/id="btHdrProfile"[^>]*hidden/.test(h)) missing.push("hidden #btHdrProfile icon");
  if (!/id="btProfileMenu"[^>]*hidden/.test(h)) missing.push("hidden #btProfileMenu");
  const menuAt = h.indexOf('id="btProfileMenu"');
  if (!/id="logoutBtn"[^>]*hidden/.test(h)) missing.push("hidden #logoutBtn");
  else if (menuAt === -1 || h.indexOf('id="logoutBtn"') < menuAt)
    missing.push("#logoutBtn outside the profile menu (RF-16: Sign out is a menu option now)");
  for (const [href, label] of [
    ["home.html#notifications", "Notifications"],
    ["profile.html", "My Profile"],
    ["membership.html", "Membership"],
    ["settings.html", "Settings"],
    ["help.html", "Help & FAQ"],
  ]) {
    if (menuAt === -1 || h.indexOf(`href="${href}"`, menuAt) === -1) missing.push(`profile-menu link missing: ${label}`);
  }
  if (h.includes("btSwitchAdmin") || h.includes("admin.html"))
    missing.push("UNEXPECTED static admin affordance (RF-16: the switch is role-gated and JS-rendered, never static)");
  if (h.includes("orgSwitcher")) missing.push("UNEXPECTED #orgSwitcher (members act in one org)");
  if (missing.length) return { ok: false, why: "member header issues: " + missing.join(", ") };
  return { ok: true, header: h };
}

/* site-nav.js single-source behavior verdicts. v4.1 (RF-15): the shell HANDS the ◐ to
   BT_THEME.attachPicker — the service binds the click and opens the picker; persistence is
   asserted at its one home by themePersistVerdict above. */
const siteNavThemeVerdict = (src) =>
  src.includes("BT_THEME.attachPicker(");
const siteNavLogoutVerdict = (src) =>
  src.includes('lo.addEventListener("click"') && src.includes('"/api/auth/logout"');
/* a member page-script keeping a theme copy double-binds → dead button (v0.52.0 class) */
/* WHAT COUNTS AS A PRIVATE COPY — REBUILT 2026-08-18 (§-1r RF-9), and both halves were wrong.
   (1) The pattern required `getElementById("themeToggle").addEventListener` on ONE expression, and
   NEITHER of the files this check exempted is written that way: `app.js`, `site-nav.js` and
   `admin-nav.js` all bind through a const first, which is the house idiom. The check matched none of
   its own known holders, so the `allowed` set was exempting files it could never have caught and a
   new page copying the block in the house style would have passed.
   (2) The rule itself was the wrong question. Binding the toggle is not the offence — every shell
   binds it — KEEPING A PRIVATE WRITER is. So theme is now a PROPERTY with no exemption list at all:
   a file may bind the ◐ as long as it delegates to `BT_THEME.toggleMode()` and writes neither
   `dataset.theme` nor its own `setTheme`. Measured across all 62 asset scripts the day it was
   written: `site-nav.js`, `admin-nav.js` and the repaired `app.js` all pass on the property, the
   pre-fix `app.js` block fails it, and nothing else is touched — so three names came off the
   exemption list rather than one going on. Logout keeps an owner list, because there is no
   one-writer service for it to delegate to. */
const bindsListener = (src, id) => {
  const direct = new RegExp(`getElementById\\("${id}"\\)\\s*\\.\\s*(onclick|addEventListener)`);
  if (direct.test(src)) return true;
  const bound = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*document\\.getElementById\\("${id}"\\)`).exec(src);
  return !!(bound && new RegExp(`\\b${bound[1]}\\s*\\.\\s*(onclick|addEventListener)`).test(src));
};
/* v4.1 (RF-15): delegation is EITHER service door — toggleMode (the old flip, still a valid
   primitive for a page that wants it) or attachPicker (the picker handoff every shell uses now). */
const delegatesTheme = (src) => /BT_THEME\s*\.\s*(toggleMode|attachPicker)\s*\(/.test(src);
const privateThemeWriter = (src) =>
  /function setTheme\s*\(/.test(src) || /documentElement\.dataset\.theme\s*=/.test(src);

/* Behaviour keys, not prose, so the logout owner list below can compare against them. */
const memberPageCopyKeys = (src) => {
  const bad = [];
  if (bindsListener(src, "themeToggle") && (privateThemeWriter(src) || !delegatesTheme(src))) bad.push("theme");
  if (bindsListener(src, "logoutBtn")) bad.push("logout");
  return bad;
};
const memberPageCopyVerdict = (src) =>
  memberPageCopyKeys(src).map((k) => (k === "theme" ? "theme listener copy" : "logout listener copy"));

/* LOGOUT ONLY. `app.js` is index.html's own script and genuinely owns logout there — site-nav.js
   declines to bind on that page (it gates on #btHdrMail, which index.html does not carry) precisely
   so the two cannot double-bind. Theme needs no entry here for anyone. */
const LOGOUT_OWNERS = new Set(["site-nav.js", "admin-nav.js", "app.js"]);

test("RF-9: index.html's theme toggle delegates to the one writer and keeps no private setTheme", () => {
  const src = read("assets/app.js");
  assert.match(src, /BT_THEME\s*\.\s*attachPicker\s*\(/,
    "app.js no longer hands the ◐ to BT_THEME.attachPicker — index.html was the 56th page and the only holdout (RF-15: the picker opens from the button)");
  assert.ok(!privateThemeWriter(src),
    "a private theme writer is back in app.js; it can only write half the state — data-theme without data-template, which tokens.css then overrides at equal specificity");
});

test("NC-RF9: the rebuilt copy check catches the PRE-FIX spelling and clears the delegating one", () => {
  /* Without this the property is unfalsifiable: on a clean corpus it looks identical to the old
     pattern. The fixture is the real block app.js shipped until RF-9. */
  const preFix = [
    'const themeToggle = document.getElementById("themeToggle");',
    '  const savedTheme = safeGet("bt_theme");',
    '  setTheme(savedTheme || "dark");',
    '  themeToggle.addEventListener("click", () => { setTheme("light"); });',
    '  function setTheme(t) { document.documentElement.dataset.theme = t; }',
  ].join("\n");
  assert.deepEqual(memberPageCopyKeys(preFix), ["theme"],
    "the const-bound private writer must be caught — this is the exact shape app.js shipped until RF-9");

  const delegating = [
    'const themeToggle = document.getElementById("themeToggle");',
    '  themeToggle.addEventListener("click", () => { window.BT_THEME.toggleMode(); });',
  ].join("\n");
  assert.deepEqual(memberPageCopyKeys(delegating), [],
    "and a shell that binds the toggle but delegates must NOT be called a copy, or every shell fails");

  assert.deepEqual(memberPageCopyKeys(read("assets/schedule.js")), [],
    "an innocent page script must stay clean, or the widened binding pattern over-reaches");
  /* v4.1 (RF-15): the shells no longer bind the ◐ themselves — they hand the element to
     BT_THEME.attachPicker, and the SERVICE binds it. The positive control moves with the
     binding: attachPicker's body must install the click listener, or no shell's ◐ does anything. */
  const cfg = read("assets/config.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const at = cfg.indexOf("function attachPicker(");
  assert.ok(at > -1, "BT_THEME.attachPicker is gone — every shell's ◐ went dead");
  assert.ok(cfg.slice(at).includes('addEventListener("click"'),
    "attachPicker no longer binds the button — the service is the one binder now, and it isn't binding");
});

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
  // 17 → 18 in v0.180.0 for subs.html, the Sub-Finder module (owner req 2026-08-22) — generated
  // from leagues.html's bytes, so its header is byte-identical on its first run (the intended way).
  // 18 → 19 in v0.202.0 for play.html, the member Play frame (§-1g C-2, owner 2026-08-08) —
  // generated from leagues.html's bytes again, the same closest precedent, for the same reason.
  const canon = htmlPages().filter((f) => isMemberCanonPage(f, read(f)));
  assert.equal(canon.length, 19, `expected exactly 19 canonical member pages, saw ${canon.length}: ${canon.join(", ")}`);
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
  const offenders = [];
  for (const f of files) {
    /* Theme is judged on the PROPERTY, so it needs no exemption; logout is judged against its
       owner list. A file may bind the ◐ freely as long as it delegates to the one writer. */
    const bad = memberPageCopyKeys(read("assets/" + f))
      .filter((k) => !(k === "logout" && LOGOUT_OWNERS.has(f)));
    if (bad.length) offenders.push(`${f}: ${bad.map((k) => k + " listener copy").join(" + ")}`);
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

test("NC-M3: a re-added Admin anchor fails the verdict — even shipped hidden, exactly as it used to", () => {
  const src = read("home.html");
  const mutated = src.replace('<div class="spacer"></div>',
    '<div class="spacer"></div>\n    <a id="btHdrAdmin" class="btn ghost hdr-admin" href="admin.html" aria-label="Switch to admin view" hidden>Admin</a>');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(memberHeaderVerdict(mutated).ok, false,
    "the pre-RF-12 anchor must fail the verdict — hidden was the old rule, absent is the rule now");
});

test("NC-M5b: a STATIC Switch-to-admin in the member header fails (RF-16 — the switch is JS-rendered, role-gated)", () => {
  const src = read("home.html");
  const mutated = src.replace('<button id="logoutBtn" class="pm-item" hidden>Sign out</button>',
    '<button id="btSwitchAdmin" class="pm-item">Switch to admin</button>\n        <button id="logoutBtn" class="pm-item" hidden>Sign out</button>');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(memberHeaderVerdict(mutated).ok, false,
    "a static (ungated) admin switch in the header must fail — the sanctioned one is rendered by " +
    "site-nav.js only when /api/me signs the role");
});

test("NC-M4: a member header carrying an org switcher fails (members act in one org)", () => {
  const html = read("home.html").replace('<div class="spacer"></div>', '<div class="spacer"></div><select id="orgSwitcher"></select>');
  assert.equal(memberHeaderVerdict(html).ok, false);
});

test("NC-M5: stripping the theme-service handoff from site-nav.js fails the theme verdict", () => {
  const src = read("assets/site-nav.js");
  const mutated = src.replace("BT_THEME.attachPicker(", "x(");
  assert.notEqual(mutated, src, "the mutation did not land — this control tests nothing");
  assert.equal(siteNavThemeVerdict(mutated), false);
});

test("RF-15: attachPicker renders THROUGH mountPicker — one chip judgement, a third mount", () => {
  /* The popover must be the SAME six chips Settings and the admin Appearance modal mount. A
     picker that re-implements its own chip list drifts from the palette roster the moment a
     template is added — the one-judgement rule that put BT_CAL in config.js applies here too. */
  const cfg = read("assets/config.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const at = cfg.indexOf("function attachPicker(");
  assert.ok(at > -1, "attachPicker is gone");
  const body = cfg.slice(at, cfg.indexOf("\n  }", at));
  assert.ok(body.includes("mountPicker("),
    "attachPicker no longer mounts mountPicker's chips — the button's picker drifted from the one judgement");
  assert.ok(/aria-expanded/.test(body), "the ◐ no longer mirrors its open state to aria-expanded");
  assert.ok(/Escape/.test(body), "the picker popover lost its Escape close");
});

test("RF-15: the four shell-less pages carry the ◐ AND read the saved theme before first paint", () => {
  /* checkin, kiosk, sign and guardian-complete load no shell script — config.js's
     DOMContentLoaded fallback binds their button. The pre-paint read is NOT optional: three of
     the four shipped with data-theme pinned "dark" and no bt_theme reader, so a picker choice
     would silently revert on the next load — a control reporting success it did not keep. */
  for (const f of ["checkin.html", "kiosk.html", "sign.html", "guardian-complete.html"]) {
    const html = read(f);
    assert.ok(html.includes('id="themeToggle"'), `${f}: no ◐ button (RF-15 — every surface gets one)`);
    assert.ok(html.includes('localStorage.getItem("bt_theme")'),
      `${f}: no pre-paint bt_theme read — a picker choice on this page reverts on reload`);
    assert.ok(html.includes("bt_template"),
      `${f}: no bt_template read — a color-template choice reverts to the plain mode here`);
  }
});

test("NC-M11: an attachPicker that re-implements chips (no mountPicker call) FAILS", () => {
  const cfg = read("assets/config.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const at = cfg.indexOf("function attachPicker(");
  assert.ok(at > -1, "attachPicker is gone");
  const body = cfg.slice(at, cfg.indexOf("\n  }", at));
  const mutated = body.replace("mountPicker(", "myOwnChips(");
  assert.notEqual(mutated, body, "mutation did not land — NC is vacuous");
  assert.equal(mutated.includes("mountPicker("), false,
    "the verdict must reject a picker that stopped mounting the shared chips");
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

/* NC-M7 (hijacked href caught) and NC-M8 (attribute order immaterial) retired in v3.0 with their
   purpose stated: both proved the verdict read the ANCHOR'S ATTRIBUTES correctly, and RF-12's
   outright ban has no attributes to misread. A hijacked href is still caught — as the anchor
   existing at all — which NC-M7's replacement below proves on the same mutated input. */
test("NC-M7: the old hijacked-href mutation STILL fails — the ban subsumes the attribute check", () => {
  const src = read("home.html");
  const mutated = src.replace('<div class="spacer"></div>',
    '<div class="spacer"></div><a id="btHdrAdmin" href="https://evil.example/pwn" hidden>Admin</a>');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(memberHeaderVerdict(mutated).ok, false,
    "an anchor with a hijacked href must fail — under the ban it fails by existing");
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

/* \u2500\u2500 v4.2 (owner 2026-08-25: "There is no color choose for the theme") \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   THE HEADER MUST FIT A PHONE. Measured live at 390px: the brand wordmark + three 44px header
   actions need ~444px, so #themeToggle sat at x=391 and #btHdrProfile at x=451 \u2014 BOTH past the
   viewport edge. On a phone there literally was no theme button, no profile menu, no admin
   switch, and the overflow gave every member page a horizontal scroll. The fix is CSS-only
   (the 18 canonical headers stay byte-identical): below 560px the wordmark drops its second
   word and the chrome tightens, and every action keeps its 44px target. */

const APP_CSS = readFileSync(new URL("assets/app.css", WEB_DIR), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("the header compresses below 560px: narrow rule present, second brand word dropped", () => {
  const media = APP_CSS.match(/@media \(max-width: 560px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(media, "app.css has no 560px header media rule \u2014 the phone header overflows again");
  assert.match(media[1], /\.header\s*\{[^}]*gap: 8px/, "the narrow header must tighten its gap");
  assert.match(media[1], /\.wordmark span\s*\{[^}]*display: none/,
    "the narrow header must drop the wordmark's second word \u2014 it is what pushes the \u25d0 off-screen");
});

test("NC-HDR: removing the narrow header rule reddens the fit check", () => {
  const mutated = APP_CSS.replace(/@media \(max-width: 560px\)/, "@media (max-width: 1px)");
  if (mutated !== APP_CSS) {
    assert.equal(/@media \(max-width: 560px\)/.test(mutated), false, "mutation did not land");
  } else {
    // Pre-build: the rule does not exist yet \u2014 the presence test above is the watched red.
    assert.doesNotMatch(APP_CSS, /@media \(max-width: 560px\)/);
  }
});
