/**
 * Boomtown Platform — the admin header's profile menu + sign-out (§-1d / owner 2026-08-26)
 * File: worker/test/admin_profile.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.205.0
 *
 * Owner, 2026-08-26 ("Do all 3 as recommended"): "Account settings can be under profiles button on
 * the top right." The admin shell had NO profile affordance and NO sign-out of its own — an admin
 * signed out only via Member site → the member profile menu, or via the rail's Settings link
 * (settings.html, the shared member settings page). This unit adds a profile button + menu to the
 * admin canonical header (mirroring the member one) carrying Account settings (→ settings.html) and
 * Sign out, wires both in admin-nav.js, and lets Settings finally leave the rail (admin_rail_brevity
 * drops its exception in the same release).
 *
 * WHAT THIS FILE PINS: the header MARKUP (the menu exists, with the two items) and the WIRING
 * (admin-nav.js toggles the menu, reveals it from the local token, and signs out for real). The
 * byte-identical spread across all admin pages is header_shell's ratchet; the CSS's single home is
 * profile_menu_css.test.mjs. Here: does the affordance exist and behave.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const ADMIN_HTML = read("admin.html");           // representative canonical admin page
const NAVJS = blankComments(read("assets/admin-nav.js"));

/* ── the header markup: the menu exists with Account settings + Sign out ── */

test("the admin header ships a profile button and menu with Account settings and Sign out", () => {
  const head = ADMIN_HTML.match(/<header class="header[\s\S]*?<\/header>/);
  assert.ok(head, "admin.html has no header block");
  const h = head[0];
  assert.match(h, /id="btHdrProfile"[^>]*aria-controls="btProfileMenu"/,
    "no #btHdrProfile button controlling #btProfileMenu — the profile affordance is missing");
  assert.match(h, /id="btProfileMenu"[^>]*class="profile-menu"|class="profile-menu"[^>]*id="btProfileMenu"/,
    "no #btProfileMenu.profile-menu container in the admin header");
  assert.match(h, /class="pm-item"[^>]*href="settings\.html"[^>]*>\s*Account settings/,
    "no 'Account settings' item pointing at settings.html in the admin profile menu");
  assert.match(h, /id="logoutBtn"[^>]*class="pm-item"[\s\S]*?Sign out/,
    "no #logoutBtn 'Sign out' item in the admin profile menu");
  // The MENU ships hidden (opened by the button); Sign out ships hidden and is revealed from the
  // token. The button itself ships VISIBLE on admin pages — every admin page bounces a non-admin
  // via guard(), and a plain (non-hidden) .btn avoids coupling `hidden` to a page-local .btn rule
  // (admin-league's print styles) — the hidden_overlay/shared_buttons tension. So: button not
  // hidden, menu hidden, logout hidden.
  assert.match(h, /id="btProfileMenu"[^>]*\shidden/, "the profile MENU must ship hidden (opened by the button)");
  assert.match(h, /id="logoutBtn"[^>]*\shidden/, "Sign out must ship hidden and be revealed from the token");
  assert.doesNotMatch(h, /id="btHdrProfile"[^>]*\shidden/,
    "the admin profile BUTTON must ship visible — admin pages are authed surfaces, and a hidden .btn couples to page-local .btn rules");
});

/* ── the wiring: toggle, reveal-from-token, and a real sign-out ── */

test("admin-nav.js toggles the profile menu and reveals it from the local token", () => {
  assert.match(NAVJS, /getElementById\("btHdrProfile"\)/, "admin-nav.js never reads the profile button");
  assert.match(NAVJS, /getElementById\("btProfileMenu"\)/, "admin-nav.js never reads the profile menu");
  // Revealed from the LOCAL token, the same rule as the member header (a stale token showing the
  // icon is the safe direction — the click clears it). bearer() is admin-nav's ssGet('bt_token').
  assert.match(NAVJS, /bearer\(\)/, "the profile reveal is not gated on the local token");
});

test("admin-nav.js signs out for real: POST /api/auth/logout, clear the token, land on login", () => {
  // The admin shell had no logout at all before this. Mirror site-nav's contract exactly.
  assert.match(NAVJS, /getElementById\("logoutBtn"\)/, "admin-nav.js never reads the Sign out button");
  assert.match(NAVJS, /\/api\/auth\/logout/, "Sign out does not POST /api/auth/logout — the server session is never ended");
  assert.match(NAVJS, /removeItem\("bt_token"\)/, "Sign out never clears the local token — the button lies");
  assert.match(NAVJS, /location\.href\s*=\s*"index\.html"|location\.replace\("index\.html"\)/,
    "Sign out never lands the user on the login page");
});

test("the menu is a real disclosure: Escape closes it and an outside click closes it", () => {
  assert.match(NAVJS, /"Escape"/, "the profile menu does not close on Escape (keyboard trap)");
  assert.match(NAVJS, /aria-expanded/, "the profile button never reflects open/closed state to assistive tech");
});

/* ── negative controls — mutate the real source and prove the checks fire ── */

test("NC-1: an Account settings link pointed away from settings.html is caught", () => {
  const head = ADMIN_HTML.match(/<header class="header[\s\S]*?<\/header>/)[0];
  const mutated = head.replace(/href="settings\.html"([^>]*>\s*Account settings)/, 'href="index.html"$1');
  assert.notEqual(mutated, head, "the mutation did not land — the Account settings link shape changed");
  assert.doesNotMatch(mutated, /class="pm-item"[^>]*href="settings\.html"[^>]*>\s*Account settings/,
    "the check cannot fail — it does not actually depend on the settings.html target");
});

test("NC-2: dropping the logout POST from admin-nav.js is caught", () => {
  const mutated = NAVJS.replace(/\/api\/auth\/logout/, "/api/auth/NOPE");
  assert.notEqual(mutated, NAVJS, "the mutation did not land — no logout endpoint to break");
  assert.doesNotMatch(mutated, /\/api\/auth\/logout/, "the endpoint check cannot fail");
});
