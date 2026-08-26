/**
 * Boomtown Platform — the admin rail carries no outbound member-page links (§-1d N-5)
 * File: worker/test/admin_rail_brevity.test.mjs · Version: v1.0 · Date: 2026-08-26 · Ships in: v0.203.0
 *
 * §-1d N-5, the menu brevity pass (owner: "Menus need to optimzied and reviewed for brevity"),
 * taken after RF-4 (v0.184.0) already collapsed the eight event-scoped tools into the manager hub.
 * The measured remainder: the admin rail's "Member site" group mixed FOUR pure outbound links to
 * member pages (Home, Schedule Page, Live Scoreboard, Leagues Page) with two admin config pages.
 * The four are the §-1c N-1c defect in the rail — clicking one swaps the ENTIRE admin shell for the
 * member site, and none ever receives an active state (those pages load the MEMBER rail, so the
 * admin rail is not even on screen there). Removed in v0.203.0.
 *
 * THE INVARIANT IS DERIVED, NOT A LIST OF FOUR: an admin rail item must not point at a page that
 * ships `site-nav.js` (the member rail). That captures the N-1c class generally — re-adding any
 * member page to the rail reddens, not only the four removed today. The two public-output CONFIG
 * pages (Views & Embed → admin-events.html, Calendar Feeds → admin-calendar.html) load admin-nav.js
 * and stay: the reduction was surgical, not a blanket group delete.
 *
 * THE FORBID CARRIES ITS EXIT (the forbid-guards-need-an-exit rule): the four are reachable another
 * way, and this file pins those ways in the same breath as the removal — the admin header's
 * "Member site" link (→ index.html) and the Sandbox group's "View as member".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const PARTIAL = read("assets/rail.partial.html");
const NAVJS = blankComments(read("assets/admin-nav.js"));

/** True when a web page ships the MEMBER rail (site-nav.js) rather than the admin one. */
const isMemberPage = (page) =>
  existsSync(new URL(page, WEB)) && /<script[^>]+src="assets\/site-nav\.js/.test(read(page));

/* THE ONE SANCTIONED EXCEPTION. `settings.html` is the SHARED personal-account page (theme,
   notifications, sign-in) that every signed-in user reaches, admins included — and there is no
   admin-side equivalent (admin-org-settings.html is ORGANIZATION settings, a different surface).
   The four removed in v0.203.0 were member VIEWS of data managed elsewhere (the schedule, the
   scoreboard, leagues) plus the member home; Settings is account infrastructure, not a view. It
   is deliberately kept, and whether it too should leave the admin rail is an OPEN owner question
   (recorded at the v0.203.0 close). Pinned as the ONLY exception so a sixth member link cannot
   ride in behind it. */
const ALLOWED_MEMBER_PAGES = new Set(["settings.html"]);
const forbiddenMemberLinks = (pages) =>
  [...new Set(pages)].filter((p) => isMemberPage(p) && !ALLOWED_MEMBER_PAGES.has(p));

/** Rail hrefs from the partial (the shipped bytes) — page only, hash stripped. */
const partialPages = (src) =>
  [...src.matchAll(/class="nav-item"\s+href="([^"#]+)[^"]*"/g)].map((m) => m[1]);

/** Rail hrefs from the NAV array in admin-nav.js — the other source sync_rail ties to the partial. */
const navPages = (src) => {
  const m = src.match(/const NAV = \[([\s\S]*?)\n {2}\];/);
  assert.ok(m, "admin-nav.js no longer defines a NAV array — this guard's source moved");
  return [...m[1].matchAll(/href: "([^"#]+)[^"]*"/g)].map((x) => x[1]);
};

test("the isMemberPage oracle actually distinguishes the two rails (positive control)", () => {
  // A silent oracle that calls everything an admin page would pass this whole file vacuously.
  assert.equal(isMemberPage("schedule.html"), true, "schedule.html ships the member rail — the oracle must see it");
  assert.equal(isMemberPage("admin-calendar.html"), false, "admin-calendar.html ships the admin rail — the oracle must not flag it");
});

test("no item in rail.partial.html points at a member-rail page (N-1c: no shell-swap links)", () => {
  const offenders = forbiddenMemberLinks(partialPages(PARTIAL));
  assert.deepEqual(offenders, [],
    `the admin rail links out to member pages, swapping the whole shell on click: ${offenders.join(", ")}`);
});

test("no item in admin-nav.js's NAV array points at a member-rail page", () => {
  // The partial and the NAV array are the two sources sync_rail keeps equal; both must be clean, or
  // the next `sync-rail --write` reintroduces what this removed.
  const offenders = forbiddenMemberLinks(navPages(NAVJS));
  assert.deepEqual(offenders, [],
    `admin-nav.js's NAV array still lists member pages: ${offenders.join(", ")}`);
});

test("settings.html is the SOLE member-rail exception, and it is really there (not a dead allowance)", () => {
  // The allowance must name something that exists, or it silently permits nothing while reading as
  // a considered exception. Assert Settings is actually on the rail; if it is ever removed, delete
  // the allowance in the same change rather than leaving a rule that guards air.
  assert.ok(partialPages(PARTIAL).includes("settings.html"),
    "settings.html left the rail — remove it from ALLOWED_MEMBER_PAGES too, or the exception guards nothing");
  // And the allowance is exactly one: every member page on the rail is the sanctioned one.
  const memberOnRail = [...new Set(partialPages(PARTIAL))].filter(isMemberPage);
  assert.deepEqual(memberOnRail, ["settings.html"],
    `the admin rail carries a member page other than the one sanctioned exception: ${memberOnRail.join(", ")}`);
});

test("the surgical removal kept the two public-output config pages on the rail", () => {
  // Views & Embed and Calendar Feeds are ADMIN pages (they configure public output); the brevity
  // pass removed the four member links, not the whole group. Assert they survived, or the removal
  // over-reached into real admin surfaces.
  const pages = new Set(partialPages(PARTIAL));
  assert.ok(pages.has("admin-events.html"), "Views & Embed (admin-events.html) fell off the rail — the removal over-reached");
  assert.ok(pages.has("admin-calendar.html"), "Calendar Feeds (admin-calendar.html) fell off the rail — the removal over-reached");
});

test("the forbid carries its exits: the header 'Member site' link and Sandbox 'View as member'", () => {
  // A guard that only forbids can delete the last way out. The four member pages stay reachable:
  const adminHome = read("admin.html");
  assert.match(adminHome, /href="index\.html">Member site</,
    "the admin header lost its 'Member site' link — removing the rail's member links left no way to the member site (header_shell also pins this)");
  assert.match(NAVJS, /btViewMember|View as member/,
    "the Sandbox 'View as member' affordance is gone — the full member preview was the other exit");
});

/* ── negative controls — mutate the real source and prove the checks fire ── */

test("NC-1: re-adding a member page to the partial is caught", () => {
  const mutated = PARTIAL.replace(
    /(<a class="nav-item" href="admin-calendar\.html")/,
    '<a class="nav-item" href="schedule.html" title="Schedule Page"><span class="txt">Schedule Page</span></a>\n$1');
  assert.notEqual(mutated, PARTIAL, "the mutation did not land — the anchor line moved");
  const offenders = [...new Set(partialPages(mutated))].filter(isMemberPage);
  assert.ok(offenders.includes("schedule.html"), "a re-added member link must be seen");
});

test("NC-2: re-adding a member page to the NAV array is caught", () => {
  const mutated = NAVJS.replace(
    'href: "admin-calendar.html",',
    'href: "leagues.html", ico: "league", text: "Leagues Page" },\n      { href: "admin-calendar.html",');
  assert.notEqual(mutated, NAVJS, "the mutation did not land — the anchor moved");
  const offenders = [...new Set(navPages(mutated))].filter(isMemberPage);
  assert.ok(offenders.includes("leagues.html"), "a re-added NAV member link must be seen");
});
