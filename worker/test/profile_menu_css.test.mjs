/**
 * Boomtown Platform — the header profile-menu CSS has ONE home: app.css (§-1d / owner 2026-08-26)
 * File: worker/test/profile_menu_css.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.205.0
 *
 * The profile-menu styles (.hdr-profile-wrap, .profile-menu, .pm-item, .pm-sep) lived ONLY inside
 * site-nav.js's injected <style> string — member pages only. Adding the same menu to the admin
 * header (which loads admin-nav.js, not site-nav.js) needed those styles somewhere BOTH shells
 * load. app.css is the one stylesheet both shells link, so the rules were PROMOTED there and
 * REMOVED from site-nav.js. Two rule sets for one concept is the defect this repo has paid for
 * twice (D-23, D-24); this guard keeps it at one — the rules are in app.css, and site-nav.js's
 * injected string no longer carries them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const APP_CSS = read("assets/app.css");
const SITE_NAV = read("assets/site-nav.js");

const SELECTORS = [".hdr-profile-wrap", ".profile-menu", ".profile-menu .pm-item", ".profile-menu .pm-sep"];

test("app.css is the home of the profile-menu rules", () => {
  for (const sel of SELECTORS) {
    assert.ok(APP_CSS.includes(sel), `app.css is missing the profile-menu rule '${sel}' — the admin header would be unstyled`);
  }
});

test("site-nav.js no longer injects the profile-menu rules — one home, not two", () => {
  // The member header markup still USES .profile-menu/.pm-item (that is correct — the classes are
  // shared); what must be gone is the DUPLICATE CSS DEFINITION in the injected <style> string.
  assert.equal(SITE_NAV.includes(".profile-menu {"), false,
    "site-nav.js still defines .profile-menu in its injected CSS — promote to app.css and delete here (D-23/D-24 class)");
  assert.equal(SITE_NAV.includes(".hdr-profile-wrap {"), false,
    "site-nav.js still defines .hdr-profile-wrap — one home only");
});

test("NC: the app.css check would fail if the rule were absent", () => {
  const stripped = APP_CSS.replace(/\.profile-menu \{[^}]*\}/, "");
  assert.notEqual(stripped, APP_CSS, "the strip control found no .profile-menu rule to remove");
  assert.equal(stripped.includes(".profile-menu {"), false, "the presence check cannot fail");
});
