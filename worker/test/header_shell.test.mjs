/**
 * Boomtown Platform — unified admin header guard
 * File: worker/test/header_shell.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.52.0
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

/** admin-nav.js must own the theme toggle listener. */
const navThemeVerdict = (src) =>
  src.includes('document.getElementById("themeToggle")') &&
  src.includes('localStorage.setItem("bt_theme", next)');

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

test("NC-4: stripping the theme persistence write from admin-nav.js fails the theme verdict", () => {
  const mutated = read("assets/admin-nav.js").replace('localStorage.setItem("bt_theme", next)', "");
  assert.equal(navThemeVerdict(mutated), false, "an unpersisted theme flip must fail — it reverts on the next page");
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
