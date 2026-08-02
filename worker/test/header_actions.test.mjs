/**
 * Boomtown Platform — header-actions guard
 * File: worker/test/header_actions.test.mjs · Version: v2.0 · Date: 2026-08-02 · Ships in: v0.52.0
 *
 * v2.0 (v0.52.0, uiux-review §6 step 4): the ADMIN shell's header is STATIC now — the mail
 * icon ships in every admin page's markup (header_shell.test.mjs holds the 27 copies
 * byte-identical, which is what replaces the old single-source-by-injection guarantee), and
 * admin-nav.js must NOT keep an injector (a surviving injector would double the icon).
 * The MEMBER shell is untouched: site-nav.js still injects, and no member page may carry a
 * static copy. The v1.x "no static page hardcodes btHdrMail" check therefore inverts for
 * admin-nav pages and holds for everything else.
 * v1.1 (v0.49.0): header "Admin" switch checks (unchanged here — member shell).
 * v1.0 (v0.48.0): header mail icon, both shells, injected.
 *
 * NCs prove the checks can fail on mutated sources (tokens.test.mjs precedent).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const read = (p) => readFileSync(new URL(p, WEB_DIR), "utf8");

/* pure verdicts — real corpus and NCs share them */
const memberVerdict = (src) =>
  src.includes('a.id = "btHdrMail"') && src.includes('a.href = "member-inbox.html"') && src.includes("min-width:44px");
/* v2.0: the admin shell must NOT inject — the icon is static. The signature scanned is the
   injector's assignment form, which cannot appear in static markup. */
const adminNoInjectorVerdict = (src) => !src.includes('a.id = "btHdrMail"');
/* v1.1: the Admin switch must be role-gated AND target admin.html */
const switchVerdict = (src) =>
  src.includes('if (role === "admin" || role === "staff") (function headerAdminSwitch()') &&
  src.includes('a.id = "btHdrAdmin"') && src.includes('a.href = "admin.html"');

test("site-nav.js injects the role-gated header Admin switch (v0.49.0)", () => {
  assert.ok(switchVerdict(read("assets/site-nav.js")), "Admin switch injector missing, retargeted, or un-gated");
});

test("no static page hardcodes btHdrAdmin (single-source rule)", () => {
  const pages = readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"));
  const offenders = pages.filter((f) => read(f).includes("btHdrAdmin"));
  assert.deepEqual(offenders, [], `static copies of the Admin switch found: ${offenders.join(", ")}`);
});

test("NC-3: an un-gated Admin switch fails the check", () => {
  const mutated = read("assets/site-nav.js")
    .replace('if (role === "admin" || role === "staff") (function headerAdminSwitch()', "(function headerAdminSwitch()");
  assert.equal(switchVerdict(mutated), false, "the role-gate check must notice a stripped gate");
});

test("site-nav.js injects the member header mail icon (inbox link, 44px target)", () => {
  assert.ok(memberVerdict(read("assets/site-nav.js")), "member header mail injector missing or altered");
});

test("admin-nav.js keeps NO mail injector (v2.0 — the icon is static; a survivor doubles it)", () => {
  assert.ok(adminNoInjectorVerdict(read("assets/admin-nav.js")),
    "an #btHdrMail injector survived in admin-nav.js — with the static icon this renders twice");
});

test("static btHdrMail appears ONLY on admin-nav pages (member shell stays injected), widest set", () => {
  const pages = readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length >= 39, `web corpus shrank: ${pages.length} html files`);
  let adminPages = 0;
  const offenders = [];
  for (const f of pages) {
    const html = read(f);
    const isAdmin = /<script[^>]+src="assets\/admin-nav\.js[^"]*"/.test(html);
    if (isAdmin) adminPages++;
    if (!isAdmin && html.includes("btHdrMail")) offenders.push(f);
  }
  assert.ok(adminPages >= 27, `guard floor: expected >=27 admin-nav pages, saw ${adminPages} (failure class 4)`);
  assert.deepEqual(offenders, [],
    `static mail icon on NON-admin pages (member shell injects — a static copy doubles it): ${offenders.join(", ")}`);
});

test("NC-1: a stripped member injector fails the presence check", () => {
  assert.equal(memberVerdict(read("assets/site-nav.js").replace('a.href = "member-inbox.html"', "")), false);
});

test("NC-2: a re-added admin injector fails the no-injector check (v2.0 subject line)", () => {
  const mutated = read("assets/admin-nav.js") + '\n  const a = document.createElement("a"); a.id = "btHdrMail";';
  assert.equal(adminNoInjectorVerdict(mutated), false,
    "re-introducing the injector signature must fail — if it passes, the verdict is blind");
});
