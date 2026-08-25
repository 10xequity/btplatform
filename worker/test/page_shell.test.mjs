/**
 * Boomtown Platform — page-shell prerequisites guard
 * File: worker/test/page_shell.test.mjs · Version: v1.3 · Date: 2026-08-02 · Ships in: v0.53.0 (v1.2 v0.52.0 · v1.1 v0.51.0 · v1.0 v0.49.1)
 * v1.3: MEMBER pre-paint theme snippet — the 14 canonical member pages + index.html apply
 * saved bt_theme (else system preference) before the first stylesheet, byte-identical
 * (theme half only; member pages carry no rail-collapse state).
 *
 * WHY (the v0.49.1 outage): five admin pages (facility, faq, sms, waitlists, waivers) loaded
 * admin-nav.js WITHOUT config.js. BT_CONFIG.apiBase was undefined, guard()'s /api/me fetch hit
 * the static host instead of the worker, and every admin — including real admins — was bounced
 * to index.html. Five pages were unreachable in production and every existing guard reported
 * clean, because no guard asserted the page-level PREREQUISITES of the shared scripts
 * (failure class 3: a guard narrower than its subject).
 *
 * Separately, lfg.html and help.html carried no <header> element, so the v0.48/v0.49 header
 * injectors (#btHdrMail, and #btHdrAdmin until RF-12 removed it — both targeted header.header)
 * silently mounted nothing. header_actions.test.mjs verified the injectors, not the TARGET.
 *
 * This guard holds the page-level prerequisites, widest set, self-counted:
 *   1. Every web/*.html that loads assets/admin-nav.js loads assets/config.js EARLIER in the file.
 *   2. Every web/*.html that loads assets/site-nav.js contains <header class="header.
 *   3. (v1.1, v0.51.0 — uiux-review §4) Every admin-nav.js page carries the pre-paint collapse
 *      snippet: an inline <head> script reading the bt_nav cookie BEFORE the first stylesheet,
 *      byte-identical across all pages (N copies that can drift = failure class 3, the
 *      rail_static lesson). admin-nav.js itself must write that cookie on toggle and must NOT
 *      keep a post-paint localStorage read — a late read is exactly the snap this fixes.
 * NCs mutate the exact subject line (the §2 lesson: a loose NC that mutates the wrong
 * occurrence proves nothing).
 *
 * v1.2 (v0.52.0): the snippet grows pre-paint THEME (uiux-review §6.4) — renamed "Pre-paint
 * state"; regex + assertions follow, incl. the system-preference fallback the deleted
 * per-page theme blocks used to provide. v1.1 (v0.51.0): check 3 + NC-5/6/7. v1.0 (v0.49.1): checks 1–2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

/* ── pure verdicts — real corpus and every NC go through these ── */

/** Pages loading admin-nav.js must load config.js at a smaller offset. */
function configBeforeNavVerdict(html) {
  const nav = html.search(/<script[^>]+src="assets\/admin-nav\.js[^"]*"/);
  if (nav === -1) return { applies: false, ok: true };
  const cfg = html.search(/<script[^>]+src="assets\/config\.js[^"]*"/);
  return { applies: true, ok: cfg !== -1 && cfg < nav };
}

/** Pages loading site-nav.js must carry the header element the injectors target. */
function headerPresentVerdict(html) {
  const nav = /<script[^>]+src="assets\/site-nav\.js[^"]*"/.test(html);
  if (!nav) return { applies: false, ok: true };
  return { applies: true, ok: /<header class="header/.test(html) };
}

function corpus() {
  const map = new Map();
  for (const f of readdirSync(WEB_DIR)) {
    if (f.endsWith(".html")) map.set(f, stripHtmlComments(readFileSync(new URL(f, WEB_DIR), "utf8")));
  }
  return map;
}

test("every admin-nav.js page loads config.js first (v0.49.1 outage class)", () => {
  const offenders = [];
  let applied = 0;
  for (const [name, html] of corpus()) {
    const v = configBeforeNavVerdict(html);
    if (!v.applies) continue;
    applied++;
    if (!v.ok) offenders.push(name);
  }
  assert.ok(applied >= 25,
    `guard floor: expected >=25 admin-nav pages, saw ${applied} — an empty scan must fail (failure class 4)`);
  assert.deepEqual(offenders, [],
    `admin pages missing config.js (or loading it after admin-nav.js): ${offenders.join(", ")}`);
});

test("every site-nav.js page carries the header element the injectors target", () => {
  const offenders = [];
  let applied = 0;
  for (const [name, html] of corpus()) {
    const v = headerPresentVerdict(html);
    if (!v.applies) continue;
    applied++;
    if (!v.ok) offenders.push(name);
  }
  assert.ok(applied >= 12,
    `guard floor: expected >=12 site-nav pages, saw ${applied} (failure class 4)`);
  assert.deepEqual(offenders, [],
    `member pages with no <header class="header — #btHdrMail mounts nothing: ${offenders.join(", ")}`);
});

/* ── negative controls — mutate the EXACT subject line in real input ── */

test("NC-1: removing the config.js tag from a real admin page fails the verdict", () => {
  const [name, html] = [...corpus()].find(([, h]) => {
    const v = configBeforeNavVerdict(h);
    return v.applies && v.ok;
  });
  const mutated = html.replace(/[ \t]*<script[^>]+src="assets\/config\.js[^"]*"[^>]*><\/script>\n?/, "");
  assert.equal(configBeforeNavVerdict(mutated).ok, false,
    `stripping config.js from ${name} must fail — if it passes, the verdict is blind`);
});

test("NC-2: moving config.js BELOW admin-nav.js fails (order matters, not mere presence)", () => {
  const [name, html] = [...corpus()].find(([, h]) => {
    const v = configBeforeNavVerdict(h);
    return v.applies && v.ok;
  });
  const cfgTag = html.match(/[ \t]*<script[^>]+src="assets\/config\.js[^"]*"[^>]*><\/script>\n?/)[0];
  const mutated = html.replace(cfgTag, "").replace(/(<\/body>)/, cfgTag + "$1");
  assert.equal(configBeforeNavVerdict(mutated).ok, false,
    `config.js after admin-nav.js in ${name} must fail — guard() runs before a late config loads`);
});

test("NC-3: stripping the header element from a real site-nav page fails the verdict", () => {
  const [name, html] = [...corpus()].find(([, h]) => {
    const v = headerPresentVerdict(h);
    return v.applies && v.ok;
  });
  const mutated = html.replace(/<header class="header[\s\S]*?<\/header>/, "");
  assert.equal(headerPresentVerdict(mutated).ok, false,
    `removing the header from ${name} must fail — the injectors would mount nothing`);
});

test("NC-4: a header hidden inside an HTML comment does not satisfy the verdict", () => {
  const html = stripHtmlComments(
    `<!-- <header class="header chrome-glass"></header> -->\n` +
    `<script src="assets/site-nav.js?v=0.49.1" defer></script>`
  );
  assert.equal(headerPresentVerdict(html).ok, false,
    "comment-only markup must not satisfy the scan (tokens.test.mjs lesson)");
});

/* ── check 3 (v1.1): pre-paint collapse snippet — present, first, identical ── */

const SNIPPET_RE = /<script>\/\* Pre-paint state[\s\S]*?<\/script>/;  /* v1.2: "collapse" → "state" — the snippet now applies the theme too */

/** Raw file read — the snippet lives in real bytes, not the comment-stripped corpus. */
function rawCorpus() {
  const map = new Map();
  for (const f of readdirSync(WEB_DIR)) {
    if (f.endsWith(".html")) map.set(f, readFileSync(new URL(f, WEB_DIR), "utf8"));
  }
  return map;
}

/** Verdict: admin-nav pages must carry the snippet before the first stylesheet link. */
function prePaintVerdict(html) {
  if (!/<script[^>]+src="assets\/admin-nav\.js[^"]*"/.test(html)) return { applies: false, ok: true };
  const m = html.match(SNIPPET_RE);
  if (!m) return { applies: true, ok: false, why: "snippet missing" };
  const firstLink = html.search(/<link rel="stylesheet"/);
  if (firstLink !== -1 && html.indexOf(m[0]) > firstLink) {
    return { applies: true, ok: false, why: "snippet after the first stylesheet — not pre-paint" };
  }
  return { applies: true, ok: true, snippet: m[0] };
}

test("every admin-nav.js page carries the pre-paint state snippet (collapse + theme), before CSS, byte-identical", () => {
  const offenders = [];
  const variants = new Set();
  let applied = 0;
  for (const [name, html] of rawCorpus()) {
    const v = prePaintVerdict(html);
    if (!v.applies) continue;
    applied++;
    if (!v.ok) { offenders.push(`${name}: ${v.why}`); continue; }
    variants.add(v.snippet);
  }
  assert.ok(applied >= 27,
    `guard floor: expected >=27 admin-nav pages, saw ${applied} (failure class 4)`);
  assert.deepEqual(offenders, [], "pages without a pre-paint snippet:\n" + offenders.join("\n"));
  assert.equal(variants.size, 1,
    `the snippet must be byte-identical everywhere; saw ${variants.size} variants (drift = failure class 3)`);
  const s = [...variants][0];
  assert.ok(s.includes("bt_nav") && s.includes('dataset.nav="min"'),
    "the snippet must read the bt_nav cookie and set data-nav before paint");
  /* v1.2 (v0.52.0): the snippet also owns pre-paint THEME — saved bt_theme, else the system
     preference — so no admin page snaps from the hardcoded dark to the user's light. */
  assert.ok(s.includes('localStorage.getItem("bt_theme")') && s.includes("dataset.theme"),
    "the snippet must apply the saved (or system) theme before paint");
  assert.ok(s.includes("prefers-color-scheme"),
    "with no saved theme the snippet must honor the system preference (the per-page blocks it replaced did)");
});

test("admin-nav.js writes the bt_nav cookie on toggle and keeps NO post-paint read", () => {
  const src = blankComments(readFileSync(new URL("assets/admin-nav.js", WEB_DIR), "utf8")); // D-45
  assert.ok(src.includes('document.cookie = "bt_nav="'),
    "the collapse toggle must persist to the bt_nav cookie the snippet reads");
  assert.ok(!/localStorage\.getItem\("bt_nav_collapsed"\)/.test(src),
    "a post-paint localStorage read survived in admin-nav.js — that is the snap uiux-review §4 names");
});

test("NC-5: removing the snippet from a real admin page fails the verdict", () => {
  const [name, html] = [...rawCorpus()].find(([, h]) => prePaintVerdict(h).applies && prePaintVerdict(h).ok);
  const mutated = html.replace(SNIPPET_RE, "");
  assert.equal(prePaintVerdict(mutated).ok, false,
    `stripping the snippet from ${name} must fail — the page would snap post-paint`);
});

test("NC-6: moving the snippet BELOW the stylesheets fails (pre-paint means before CSS)", () => {
  const [name, html] = [...rawCorpus()].find(([, h]) => prePaintVerdict(h).applies && prePaintVerdict(h).ok);
  const snip = html.match(SNIPPET_RE)[0];
  // Cut by index, not by matching snip + "\n": core.autocrlf checks these pages out CRLF on
  // Windows, so the literal \n never matched, the snippet was never removed, and the "moved"
  // copy just made it appear twice — the verdict still passed and the NC proved nothing.
  const at = html.indexOf(snip);
  const withoutSnip = html.slice(0, at) + html.slice(at + snip.length).replace(/^\r?\n/, "");
  const mutated = withoutSnip.replace("</head>", snip + "\n</head>");
  assert.equal(prePaintVerdict(mutated).ok, false,
    `snippet after CSS in ${name} must fail — order is the subject, not presence`);
});

test("NC-7: a one-byte drift in one page's snippet breaks byte-identity", () => {
  const pages = [...rawCorpus()].filter(([, h]) => prePaintVerdict(h).applies && prePaintVerdict(h).ok);
  assert.ok(pages.length >= 2, "need two snippet pages to prove identity can fail");
  const variants = new Set();
  pages.forEach(([, h], i) => {
    let s = prePaintVerdict(h).snippet;
    if (i === 0) s = s.replace("bt_nav", "bt_naV"); // mutate the exact subject
    variants.add(s);
  });
  assert.ok(variants.size > 1, "a drifted copy must register as a second variant");
});

/* ═══════════════ v1.3 — member pre-paint theme snippet (v0.53.0) ═══════════════ */

const MEMBER_SNIPPET_PAGES = ["help.html","home.html","index.html","leagues.html","lfg.html",
  "library.html","member-inbox.html","member.html","membership.html","profile.html",
  "register.html","schedule.html","score.html","settings.html"];

function memberSnippetVerdict(html) {
  const m = html.match(/<script>\/\* Pre-paint theme \(v[\d.]+\):[\s\S]*?<\/script>/);
  if (!m) return { ok: false, why: "member pre-paint theme snippet missing" };
  const cssAt = html.indexOf('<link rel="stylesheet"');
  if (cssAt !== -1 && html.indexOf(m[0]) > cssAt) return { ok: false, why: "snippet sits BELOW the stylesheets" };
  if (!m[0].includes('localStorage.getItem("bt_theme")')) return { ok: false, why: "snippet does not read bt_theme" };
  if (!m[0].includes("prefers-color-scheme")) return { ok: false, why: "snippet lost the system-preference fallback" };
  return { ok: true, snippet: m[0] };
}

test("every member page carries the pre-paint THEME snippet, before CSS, byte-identical", () => {
  const snippets = new Map();
  for (const f of MEMBER_SNIPPET_PAGES) {
    const v = memberSnippetVerdict(readFileSync(new URL(f, WEB_DIR), "utf8"));
    assert.ok(v.ok, `${f}: ${v.why}`);
    snippets.set(f, v.snippet);
  }
  assert.equal(new Set(snippets.values()).size, 1, "member snippet not byte-identical across pages");
});

/* \r?\n, not \n: core.autocrlf checks web/*.html out CRLF on Windows, so a trailing literal
   \n never matched — NC-8's strip silently no-opped and NC-9's match threw. Both NCs proved
   nothing locally while reporting clean on CI. Same defect class as NC-6 above. */
const MEMBER_SNIPPET_RE = /<script>\/\* Pre-paint theme[\s\S]*?<\/script>\r?\n/;

test("NC-8: removing the member snippet from a real page fails the verdict", () => {
  const raw = readFileSync(new URL("home.html", WEB_DIR), "utf8");
  const html = raw.replace(MEMBER_SNIPPET_RE, "");
  assert.notEqual(html, raw, "mutation did not land — NC is vacuous");
  assert.equal(memberSnippetVerdict(html).ok, false);
});

test("NC-9: a member snippet moved below the stylesheets fails (pre-paint means before CSS)", () => {
  const html = readFileSync(new URL("home.html", WEB_DIR), "utf8");
  const m = html.match(MEMBER_SNIPPET_RE)[0];
  const moved = html.replace(m, "").replace("</head>", m + "</head>");
  assert.equal(memberSnippetVerdict(moved).ok, false);
});
