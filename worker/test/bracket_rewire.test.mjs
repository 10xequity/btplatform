/**
 * Boomtown Platform — §-1j T2-5: the "Break to bracket" button reaches the engine that exists
 * File: worker/test/bracket_rewire.test.mjs · Version: v1.1 · Date: 2026-08-22 · Ships in: v0.175.0
 *
 * v1.1 (§-1r RF-1(f), owner 2026-08-18): T2-5 rewired the button to the engine; RF-1's
 * measurement found the press still read as "nothing happens" — TWO defects wearing one button.
 * The engine answers 409 unless replace:true and this page never offered it (the second press
 * was strictly silent in effect), and the outcome rendered into #warningsBox, a whole grid ABOVE
 * the button that was pressed. admin-brackets.js generate() is the behaviour, copied: confirm
 * with the server's own sentence, re-POST with replace (through the ONE gen() writer site, so
 * the uniqueness pin below keeps its licence), and speak the outcome AT the button
 * (#bracketNote). The v1.1 tests pin all three, with NCs that silence each.
 *
 * WHY. The owner: "after scores are assessed, breaking does nothing on the button screen." The
 * button was wired to the LEGACY POST /api/events/:id/bracket — tournaments.createBracket — which
 * wrote only FIRST-ROUND games and skipped byes, while the complete modern engine (generate,
 * preview, advance, slot, forfeit; division court ranges) already shipped at
 * POST /api/admin/events/:id/brackets. "Does nothing" was the owner reading a first-round-only
 * bracket honestly. league_bracket.test.mjs's own header records that the two paths DISAGREE and
 * pins the modern one as "the one the UI actually calls" — this file makes that sentence true.
 *
 * THE REWIRE IS PINNED AS A RELATIONSHIP, NOT A STRING PAIR: the client's path is asserted to
 * match a route regex that exists in brackets.js source (two lists, one source — the cors_methods
 * shape), and the modern BODY KEY is pinned too, because the engine takes `a_size` and the legacy
 * key `aSize` would be silently ignored — a wrong-sized bracket with a 200, the quiet failure.
 *
 * THE LEGACY ROUTE IS REMOVED, NOT ORPHANED: an uncalled route would grow route_reachability's
 * baseline (which only shrinks), and a dead door that still opens is how the two paths drift
 * back apart. Its absence is asserted BEHAVIOURALLY through the worker — a 404 where 401 lived.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const TOURNAMENT_JS = readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8");
const BRACKETS_PAGE_JS = readFileSync(new URL("../../web/assets/admin-brackets.js", import.meta.url), "utf8");
const BRACKETS_SRC = readFileSync(new URL("../src/brackets.js", import.meta.url), "utf8");
const TOURNAMENTS_SRC = readFileSync(new URL("../src/tournaments.js", import.meta.url), "utf8");

test("the button posts the MODERN route with the MODERN body key, and the legacy path is gone from the client", () => {
  const js = blankComments(TOURNAMENT_JS);

  /* v0.163.0 (P-E/B19): the day sheet added a GET of this same route (a READ — the pool board
     and bracket sections compose from existing reads). The uniqueness this pin licences was
     always about the GENERATE — one writer, one body key — so the anchor moved to the POST
     grain: the route followed by a method option. The read is deliberately not counted. */
  const modernPosts = js.match(/\/api\/admin\/events\/\$\{currentEvent\.id\}\/brackets`, \{ method: "POST"/g) || [];
  assert.equal(modernPosts.length, 1, "exactly one modern bracket GENERATE site — uniqueness is the anchor's licence");
  assert.match(js, /a_size:\s*\+\$\("aSize"\)\.value/,
    "the body must send a_size — the engine ignores unknown keys, so the legacy key aSize would " +
    "produce a defaulted bracket with a 200: success it did not achieve");

  assert.doesNotMatch(js, /\/api\/events\/\$\{[^}]+\}\/bracket`/,
    "the client still knows the LEGACY path — the rewire regressed");
});

test("two lists, one source: the path the client posts is a route brackets.js actually declares", () => {
  const client = blankComments(TOURNAMENT_JS);
  const server = blankComments(BRACKETS_SRC);
  assert.match(client, /\/api\/admin\/events\/\$\{currentEvent\.id\}\/brackets`/, "client call site missing");
  assert.match(server, /\^\\\/api\\\/admin\\\/events\\\/\(\\d\+\)\\\/brackets\$/,
    "brackets.js no longer declares the exact route the button posts — the pair has drifted");
});

test("the bracket board honours event context handed to it, and keeps its first-event fallback", () => {
  const js = blankComments(BRACKETS_PAGE_JS);
  assert.match(js, /URLSearchParams\(location\.search\)\.get\("event"\)/,
    "admin-brackets.js ignores ?event= — the button's link would land on the FIRST event, not the one just broken (the T2-10 class)");
  assert.match(js, /eventId = list\.length \? list\[0\]\.id : null/,
    "the first-event fallback is gone — a bare visit to the page would select nothing");
});

test("BEHAVIOURAL — the legacy route no longer exists in the worker: 404 where 401 used to live", async () => {
  const env = { DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (5,1,'tournament','T','published')");

  // Anonymous POST. While the legacy route lived, this reached createBracket, FOUND the event,
  // and refused at requireStaff with a 401 — so a 404 here can only mean the door itself is gone.
  const res = await worker.fetch(new Request(`${ORIGIN}/api/events/5/bracket`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" },
    body: JSON.stringify({ aSize: 8 }),
  }), env);
  const data = await res.json();
  assert.equal(res.status, 404, `the legacy bracket route still answers (${res.status}) — remove it, don't orphan it`);
  assert.equal(data.error, "Not found", "the 404 must be the router's, not the handler's Event-not-found");

  assert.doesNotMatch(blankComments(TOURNAMENTS_SRC), /createBracket/,
    "tournaments.js still carries createBracket — dead code behind a removed door drifts back");
});

test("NC — restoring the legacy path into the REAL client source makes the checker fire", () => {
  const js = blankComments(TOURNAMENT_JS);
  const mutated = js.replace(/\/api\/admin\/events\/\$\{currentEvent\.id\}\/brackets`/, "/api/events/${currentEvent.id}/bracket`");
  assert.notEqual(mutated, js, "mutation did not land — nothing was rewired back");
  assert.doesNotMatch(js, /\/api\/events\/\$\{[^}]+\}\/bracket`/, "pre-mutation sanity failed");
  assert.match(mutated, /\/api\/events\/\$\{[^}]+\}\/bracket`/,
    "the mutated source does not match the legacy pattern — the assertion reads something else and every pass above is vacuous");
});

/* ═══════════ v1.1 — RF-1(f): the press must SAY, at the button, why it refused ═══════════ */

/** The bracket press handler, as a region: from its assignment to the next handler. */
const pressRegionOf = (src) => {
  const t = blankComments(src);
  const start = t.indexOf('$("bracketBtn").onclick');
  const end = t.indexOf('$("printBtn").onclick');
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end);
};
const pressVerdict = (src) => {
  const region = pressRegionOf(src);
  if (region === null) return null;
  return {
    handles409: /status === 409/.test(region) && region.includes("existing_matches"),
    confirms: region.includes("window.confirm"),
    replaces: /replace:\s*true/.test(region),
    speaksAtButton: region.includes('$("bracketNote")'),
    speaksAGridAbove: region.includes("warningsBox"),
  };
};

test("RF-1(f): the 409 gets a confirm and a replace re-POST — the second press is no longer mute", () => {
  const v = pressVerdict(readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8"));
  assert.ok(v, "the bracketBtn handler region could not be extracted — update pressRegionOf WITH the code");
  assert.ok(v.handles409, "the handler no longer recognises the engine's 409 + existing_matches refusal");
  assert.ok(v.confirms, "the handler no longer asks the operator before replacing — a silent replace is worse than a silent refusal");
  assert.ok(v.replaces, "the confirmed path no longer re-POSTs with replace: true — the operator says yes and nothing happens, the original complaint");
});

test("RF-1(f): the outcome speaks AT the button, not into the box a whole grid above it", () => {
  const v = pressVerdict(readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8"));
  assert.ok(v.speaksAtButton, "the handler no longer writes #bracketNote — the outcome went back above the fold");
  assert.equal(v.speaksAGridAbove, false,
    "the handler writes #warningsBox again — right words, wrong place (it sits above the tall grid and the button that was pressed); #warningsBox belongs to the schedule generator");
  const html = readFileSync(new URL("../../web/tournament.html", import.meta.url), "utf8");
  assert.ok(/id="bracketNote"[^>]*aria-live="polite"/.test(html.replace(/\n\s*/g, " ")),
    "tournament.html lost the #bracketNote element (or its aria-live) — the handler would write into nothing");
});

test("NC-F1: stripping the replace re-POST from the real source FAILS the verdict", () => {
  /* The mutation targets the press handler's own gen() call — a bare "replace: true" would hit
     the SCHEDULE generator's earlier confirm+replace (plCommit, the in-file precedent) and
     mutate the wrong handler. */
  const src = readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8");
  const mutated = src.replace("gen({ ...body, replace: true })", "gen({ ...body })");
  assert.notEqual(mutated, src, "mutation did not land — the press's re-POST changed shape; update this NC with it");
  assert.equal(pressVerdict(mutated).replaces, false,
    "with the re-POST stripped the verdict still reports replaces — it is reading something else");
});

test("NC-F2: pointing the outcome back at #warningsBox FAILS the placement verdict", () => {
  const src = readFileSync(new URL("../../web/assets/tournament.js", import.meta.url), "utf8");
  const mutated = src.replace('$("bracketNote")', '$("warningsBox")');
  assert.notEqual(mutated, src, "mutation did not land — the note write changed shape; update this NC with it");
  const v = pressVerdict(mutated);
  assert.ok(!v.speaksAtButton || v.speaksAGridAbove,
    "the outcome was pointed back above the fold and the verdict still passed");
});
