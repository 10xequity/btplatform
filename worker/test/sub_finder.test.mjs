/**
 * Boomtown Platform — Sub-Finder is ONE module with ONE home (owner req 2026-08-22)
 * File: worker/test/sub_finder.test.mjs · Version: v1.0 · Date: 2026-08-22 · Ships in: v0.180.0
 *
 * His words: "make it 1 button on the menu called Sub-Finder ... additional links to that menu on
 * the league page and tournament page and community page as well, but it should lead to that
 * module, so buttons along the top." The sub finder used to be a section EMBEDDED in leagues.html
 * (leagues.js v1.1, #subFinder). It is now its own page — web/subs.html + web/assets/subs.js —
 * reached by the rail item and by a top button on the leagues and community (lfg) pages.
 *
 * The failure this guards is a HALF-MOVE: the module ships but the old embed is left behind (two
 * homes, two spellings that drift — the class this repo has paid for repeatedly), or an entry
 * button points nowhere, or the rail item is dropped so "1 button on the menu" never happened.
 * Every check has a negative control that mutates the REAL source to the broken shape and proves
 * the check reddens (standards §6). The credentialed-fetch rule for subs.js is NOT re-derived here
 * — token_convention.test.mjs already owns that for the whole assets corpus (§C: trust a green
 * assertion, don't grow a second one that can disagree).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");

const subsHtml = read("subs.html");
const subsJs = read("assets/subs.js");
const leaguesHtml = read("leagues.html");
const leaguesJs = read("assets/leagues.js");
const lfgHtml = read("lfg.html");
const navJs = read("assets/site-nav.js");

/* ── predicates, pure so the NCs can feed mutated real source ─────────────────────────────── */
const mountsFinder = (html) => /id="subFinder"/.test(html);
const linksToModule = (html) => /href="subs\.html"/.test(blankComments(html));
const touchesSubsApi = (js) => /\/api\/subs\//.test(blankComments(js));

/** Signed-in rail items, {href,text}, from the You push to the signed-out else-branch —
 *  the same slice and shape member_nav_paint.test.mjs parses. */
function signedInRailItems(src) {
  const t = blankComments(src);
  const you = t.indexOf('NAV.push({ label: "You"');
  const elseAt = t.indexOf("} else {", you);
  const slice = you === -1 ? "" : t.slice(you, elseAt === -1 ? undefined : elseAt);
  return [...slice.matchAll(/\{ href: "([^"]+)",\s*ico: "[^"]*",\s*text: "([^"]+)"/g)]
    .map((m) => ({ href: m[1], text: m[2] }));
}

/* ── the module exists and mounts the finder ─────────────────────────────────────────────── */

test("subs.html is the module: it mounts #subFinder and loads subs.js", () => {
  assert.ok(mountsFinder(subsHtml), "subs.html has no #subFinder mount — the module renders nothing");
  assert.match(subsHtml, /assets\/subs\.js/, "subs.html does not load its own script");
});

test("subs.js is the moved finder: it reads the mount and talks to /api/subs/*", () => {
  assert.match(subsJs, /getElementById\("subFinder"\)/, "subs.js does not read the #subFinder mount");
  assert.ok(touchesSubsApi(subsJs), "subs.js never calls /api/subs/* — the finder logic did not move");
  assert.match(subsJs, /function renderSubs\(/, "subs.js is missing the render — an empty shell moved");
});

/* ── ONE home: the embed is gone from the leagues page ───────────────────────────────────── */

test("the sub finder has ONE home — leagues.html no longer embeds it", () => {
  assert.equal(mountsFinder(leaguesHtml), false,
    "leagues.html still carries #subFinder — the finder was copied, not moved (two homes drift)");
  assert.equal(touchesSubsApi(leaguesJs), false,
    "leagues.js still calls /api/subs/* — the finder code was left behind on the leagues page");
});

test("NC-1: re-embedding #subFinder in leagues.html is caught", () => {
  const mutated = leaguesHtml.replace('<div id="lgTonight"></div>', '<div id="subFinder"></div>\n    <div id="lgTonight"></div>');
  assert.notEqual(mutated, leaguesHtml, "mutation did not land — NC is vacuous");
  assert.equal(mountsFinder(mutated), true, "a re-embedded finder must be seen by the one-home check");
});

test("NC-2: leaving a /api/subs/* call in leagues.js is caught", () => {
  const mutated = leaguesJs.replace("load();", 'api("/api/subs/me");\n  load();');
  assert.notEqual(mutated, leaguesJs, "mutation did not land — NC is vacuous");
  assert.equal(touchesSubsApi(mutated), true, "a stray subs call in leagues.js must be seen");
});

/* ── the entry buttons lead to the module ────────────────────────────────────────────────── */

test('"buttons along the top": the league and community pages link to the module', () => {
  assert.ok(linksToModule(leaguesHtml), "leagues.html has no button linking to subs.html");
  assert.ok(linksToModule(lfgHtml), "the community page (lfg.html) has no button linking to subs.html");
});

test("NC-3: removing the leagues entry link is caught", () => {
  const mutated = leaguesHtml.replace('href="subs.html"', 'href="nowhere.html"');
  assert.notEqual(mutated, leaguesHtml, "mutation did not land — NC is vacuous");
  assert.equal(linksToModule(mutated), false, "with the entry link gone the check must fail");
});

/* ── one rail button, named Sub-Finder, pointing at the module ───────────────────────────── */

test("the rail carries exactly one Sub-Finder button and it leads to the module", () => {
  const items = signedInRailItems(navJs);
  assert.ok(items.length >= 12, `rail item extraction collapsed: ${items.length}`);
  const finder = items.filter((i) => i.text === "Sub-Finder");
  assert.equal(finder.length, 1, `expected exactly one "Sub-Finder" rail item, found ${finder.length}`);
  assert.equal(finder[0].href, "subs.html", `the Sub-Finder rail item points at ${finder[0].href}, not the module`);
});

test("NC-4: pointing the rail item away from the module is caught", () => {
  const mutated = navJs.replace('{ href: "subs.html",     ico: "◈", text: "Sub-Finder" },',
    '{ href: "leagues.html",  ico: "◈", text: "Sub-Finder" },');
  assert.notEqual(mutated, navJs, "mutation did not land — NC is vacuous");
  const finder = signedInRailItems(mutated).filter((i) => i.text === "Sub-Finder");
  assert.notEqual(finder[0].href, "subs.html", "a mis-pointed rail item must be seen");
});
