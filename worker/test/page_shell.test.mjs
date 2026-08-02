/**
 * Boomtown Platform — page-shell prerequisites guard
 * File: worker/test/page_shell.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.49.1
 *
 * WHY (the v0.49.1 outage): five admin pages (facility, faq, sms, waitlists, waivers) loaded
 * admin-nav.js WITHOUT config.js. BT_CONFIG.apiBase was undefined, guard()'s /api/me fetch hit
 * the static host instead of the worker, and every admin — including real admins — was bounced
 * to index.html. Five pages were unreachable in production and every existing guard reported
 * clean, because no guard asserted the page-level PREREQUISITES of the shared scripts
 * (failure class 3: a guard narrower than its subject).
 *
 * Separately, lfg.html and help.html carried no <header> element, so the v0.48/v0.49 header
 * injectors (#btHdrMail, #btHdrAdmin — both target header.header) silently mounted nothing.
 * header_actions.test.mjs verified the injectors, not the injection TARGET.
 *
 * This guard holds both prerequisites, widest set, self-counted:
 *   1. Every web/*.html that loads assets/admin-nav.js loads assets/config.js EARLIER in the file.
 *   2. Every web/*.html that loads assets/site-nav.js contains <header class="header.
 * NCs mutate the exact subject line (the §2 lesson: a loose NC that mutates the wrong
 * occurrence proves nothing).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

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
    `member pages with no <header class="header — #btHdrMail/#btHdrAdmin mount nothing: ${offenders.join(", ")}`);
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
