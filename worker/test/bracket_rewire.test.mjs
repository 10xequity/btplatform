/**
 * Boomtown Platform — §-1j T2-5: the "Break to bracket" button reaches the engine that exists
 * File: worker/test/bracket_rewire.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.121.0
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

  const modernCalls = js.match(/\/api\/admin\/events\/\$\{currentEvent\.id\}\/brackets`/g) || [];
  assert.equal(modernCalls.length, 1, "exactly one modern bracket call site — uniqueness is the anchor's licence");
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
