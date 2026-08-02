/**
 * Boomtown Platform — header-actions guard
 * File: worker/test/header_actions.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.48.0
 *
 * v0.48.0 adds a header mail icon to BOTH shells (owner 2026-08-02), injected from the two
 * shared nav scripts — single source, brandLogo precedent — instead of edited into ~40 static
 * headers. This guard holds the single-source rule in both directions:
 *
 *   1. PRESENCE — site-nav.js injects #btHdrMail → member-inbox.html; admin-nav.js injects
 *      #btHdrMail → admin-messages.html. Both carry the 44px minimum target inline.
 *   2. NO PER-PAGE COPIES — no web/*.html hardcodes btHdrMail (a static copy would drift the
 *      moment the injector changes; failure class 3, widest-set scan).
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
const adminVerdict = (src) =>
  src.includes('a.id = "btHdrMail"') && src.includes('a.href = "admin-messages.html"') && src.includes("min-width:44px");

test("site-nav.js injects the member header mail icon (inbox link, 44px target)", () => {
  assert.ok(memberVerdict(read("assets/site-nav.js")), "member header mail injector missing or altered");
});

test("admin-nav.js injects the admin header mail icon (message-reports link, 44px target)", () => {
  assert.ok(adminVerdict(read("assets/admin-nav.js")), "admin header mail injector missing or altered");
});

test("no static page hardcodes btHdrMail (single-source rule, widest set)", () => {
  const pages = readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length >= 39, `web corpus shrank: ${pages.length} html files`);
  const offenders = pages.filter((f) => read(f).includes("btHdrMail"));
  assert.deepEqual(offenders, [], `static copies of the header mail icon found: ${offenders.join(", ")}`);
});

test("NC-1: a stripped member injector fails the presence check", () => {
  assert.equal(memberVerdict(read("assets/site-nav.js").replace('a.href = "member-inbox.html"', "")), false);
});

test("NC-2: a retargeted admin injector fails the presence check", () => {
  assert.equal(adminVerdict(read("assets/admin-nav.js").replace('a.href = "admin-messages.html"', 'a.href = "evil.html"')), false);
});
