/**
 * Boomtown Platform — §-0 B3: seed numbers on the bracket tiles, connector lines, and the live dot
 * File: worker/test/bracket_tiles.test.mjs · Version: v1.0 · Date: 2026-08-11 · Ships in: v0.131.0
 *
 * Owner (K-2/K-3/K-4): seed numbers on the tiles — "1 v 8" OR "1 A v 4 B" — a bracket drawn with
 * connecting lines like a real tournament sheet, and a green dot for the live games.
 *
 * K-2'S HONEST SHAPE REQUIRED A SERVER CHANGE, and the v0.125.0 lesson is why: the seed order
 * exists only IN MEMORY while `generateBracketFor` builds the tree — nothing wrote it anywhere.
 * `teams.seed` is read as the FALLBACK seeding source (entry seeds) but no real path populates it,
 * so a client that rendered `teams.seed` would have shown numbers in every fixture (which inserts
 * seeds) and NOTHING on any real event — the exact fixtures-hide-it trap, caught at design time.
 * Generation now STAMPS each bracketed team's seed (its position in the arranged group order,
 * 1..n per group, A and BB restarting) — so the number on the tile is the number the generator
 * actually used, regeneration restamps, and a team dragged to another slot KEEPS its stamped seed,
 * which is how real brackets talk ("the #6 seed upset the #1").
 *
 * THE PAIR-SUM PROPERTY, DERIVED NOT DECLARED (the v0.124.0 rule): buildTree pairs positions
 * (i, size+1-i), so for a full field of n=2^k every round-one match's two seeds sum to n+1.
 * The guard asserts THAT — never a hand-written list of pairs, which would just restate the
 * implementation and agree with any bug it shares.
 *
 * K-4'S "LIVE" IS DEFINED FROM THE DATA, NOT GUESSED: score entry is a single POST of the final
 * result, so "in progress" does not exist as a stored state. What the data CAN say truthfully is
 * READY — both slots filled, no winner yet — and that is what the green dot marks. The done
 * marker migrates from the 3px coloured side-tab (D-10's recorded cliché, on this very line of
 * this very page) to the same dot idiom.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const WEB = new URL("../../web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), "utf8");
const PAGE = read("admin-brackets.html");
const JS = read("assets/admin-brackets.js");
const STYLES = blankComments(
  [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));
const ORIGIN = "https://boomtown.test";

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

/** Teams WITHOUT entry seeds — the real-event shape. Pool standings drive the seeding. */
function boot(teamCount = 8) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Test Cup','published',4)");
  DB.exec("INSERT INTO pools (id, org_id, event_id, name, sort_order) VALUES (11,1,1,'Pool A',0),(12,1,1,'Pool B',1)");
  for (let i = 1; i <= teamCount; i++) {
    const pool = i % 2 === 1 ? 11 : 12;
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, pool_id) VALUES (${i},1,1,'Team ${i}',${pool})`);
    // Event-wide finish 1..n — the seeding source for a pool-played event.
    DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES (1,1,${i},${teamCount - i},${i - 1},${i})`);
  }
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

const generate = (env, token, body = {}) =>
  call(env, "POST", "/api/admin/events/1/brackets", { token, body: { points_to: 25, ...body } });
const board = (env, token) => call(env, "GET", "/api/admin/events/1/brackets", { token });

/* ==================== the fixture can exhibit the defect ==================== */

test("PRE-FIX CHECK — no real path has written teams.seed, so a render of it would show nothing", () => {
  const env = boot();
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE seed IS NOT NULL").n, 0,
    "the fixture pre-seeded teams — every stamping assertion below would be vacuous");
  env.DB.close();
});

/* ==================== K-2 server half: generation STAMPS the seed ==================== */

test("generation stamps every bracketed team's seed, and round-one pairs sum to n+1 (derived, not declared)", async () => {
  const env = boot(8);
  const token = await staff(env);
  const r = await generate(env, token);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));

  const seeds = env.DB.query("SELECT id, seed FROM teams WHERE seed IS NOT NULL ORDER BY seed");
  assert.equal(seeds.length, 8, "not every bracketed team was stamped");
  assert.deepEqual(seeds.map((t) => t.seed), [1, 2, 3, 4, 5, 6, 7, 8], "seeds are not 1..n");

  // The derived pair property: standard seeding pairs (i, n+1-i) for a full power-of-two field.
  // rounds[] is built depth→1, so index 0 is the FIRST round played; the last index is the Final,
  // whose slots are TBD — the first draft of this test read the wrong end and accused the payload.
  const b = await board(env, token);
  const roundOne = b.data.brackets[0].rounds[0].matches;
  for (const m of roundOne) {
    assert.ok(m.seed_a >= 1 && m.seed_b >= 1, "a round-one tile is missing its seed");
    assert.equal(m.seed_a + m.seed_b, 9,
      `round-one seeds ${m.seed_a} v ${m.seed_b} do not sum to n+1 — the stamp order is not the order the tree used`);
  }
  env.DB.close();
});

test("the A and BB groups each restart from seed 1 — a tile's number is within ITS bracket", async () => {
  const env = boot(10);
  const token = await staff(env);
  const r = await generate(env, token, { a_size: 8, include_rest: true });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const b = await board(env, token);
  assert.equal(b.data.brackets.length, 2, "expected an A and a BB bracket");
  for (const br of b.data.brackets) {
    const seen = br.rounds.flatMap((rd) => rd.matches).flatMap((m) => [m.seed_a, m.seed_b])
      .filter((s) => s != null);
    assert.ok(seen.includes(1), `bracket ${br.name} has no #1 seed — numbering did not restart per group`);
  }
  env.DB.close();
});

test("regenerating with replace restamps — the numbers always describe the CURRENT bracket", async () => {
  const env = boot(8);
  const token = await staff(env);
  await generate(env, token);
  const before = env.DB.query("SELECT id FROM teams WHERE seed=1")[0].id;
  // Invert the finish order and regenerate: a different team must be seed 1.
  env.DB.exec("UPDATE standings SET rank = 9 - rank");
  const r = await generate(env, token, { replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const after = env.DB.query("SELECT id FROM teams WHERE seed=1")[0].id;
  assert.notEqual(after, before,
    "the finish order was inverted and regeneration kept the old seed 1 — the stamp is not restamping");
  env.DB.close();
});

test("a slot edit never touches seeds — the subbed-in team honestly has NO chip, everyone else keeps theirs", async () => {
  // "The #6 seed upset the #1" is how brackets talk; a seed that followed the drag would erase the
  // story. Substituting an UNBRACKETED team also pins the other half: a walk-on was never seeded,
  // so it gets no chip — an invented number would misdirect a court. (The first draft of this test
  // set a side to the OTHER side's team and the server rightly refused "a team can't play itself"
  // — the mutation was illegal, not the code.)
  const env = boot(10);
  const token = await staff(env);
  // include_rest defaults TRUE (the owner's "a tenth-place team still plays" rule) and would put
  // teams 9-10 into a BB bracket, stamped — the explicit false is what keeps a genuine walk-on.
  const r = await generate(env, token, { a_size: 8, include_rest: false });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(env.DB.one("SELECT seed FROM teams WHERE id=9").seed, null,
    "precondition: the bench team must be unstamped, or the no-chip half proves nothing");
  const b = await board(env, token);
  const m = b.data.brackets[0].rounds[0].matches[0]; // rounds[0] = first round played — both slots filled
  const before = env.DB.query("SELECT id, seed FROM teams ORDER BY id").map((t) => t.seed);

  const swap = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: m.id, side: "a", team_id: 9 },
  });
  assert.equal(swap.status, 200, JSON.stringify(swap.data).slice(0, 200));
  assert.deepEqual(env.DB.query("SELECT id, seed FROM teams ORDER BY id").map((t) => t.seed), before,
    "editing a slot rewrote teams.seed — the stamp must record the GENERATED order, not the current layout");
  const after = await board(env, token);
  const m2 = after.data.brackets[0].rounds[0].matches.find((x) => x.id === m.id);
  assert.equal(m2.seed_a, null, "the walk-on acquired a seed it was never given");
  env.DB.close();
});

/* ==================== K-2 client half: the chip, executed as shipped bytes ==================== */

function pure(name) {
  const body = functionBodyAfter(blankComments(JS), `function ${name}`);
  assert.ok(body, `${name} is gone or no longer a plain function declaration`);
  return body;
}

test("poolTag derives a short tag from real pool names and refuses to invent one", () => {
  const fn = new Function("name", pure("poolTag").slice(1, -1));
  assert.equal(fn("Pool A"), "A");
  assert.equal(fn("A"), "A");
  assert.equal(fn("Open BB"), "BB");
  assert.equal(fn("Pool 2"), "2");
  assert.equal(fn("North Court"), null, "a name with no trailing tag must yield null, not a guess");
  assert.equal(fn(null), null);
});

// seedChip calls poolTag, so the executed copy receives the REAL poolTag as a third argument —
// composing the two shipped functions rather than inlining a stub that could mask a poolTag bug.
const realPoolTag = () => new Function("name", pure("poolTag").slice(1, -1));

test("seedChip renders the owner's two forms and disappears when there is nothing honest to say", () => {
  const fn = new Function("seed", "pool", "poolTag", pure("seedChip").slice(1, -1));
  const pt = realPoolTag();
  assert.match(fn(1, "Pool A", pt), />#1\s?A</, "with a pool tag the chip reads '#1 A'");
  assert.match(fn(3, "North Court", pt), />#3</, "with no derivable tag the chip falls back to the plain form");
  assert.doesNotMatch(fn(3, "North Court", pt), /North/, "the chip must not swallow a long pool name");
  assert.equal(fn(null, "Pool A", pt), "", "no seed, no chip — an empty chip is a lie about data we lack");
});

test("NC — neutralising seedChip's seed check makes the no-seed case emit a chip, and the test can tell", () => {
  const body = pure("seedChip");
  const broken = body.replace(/if\s*\(!?\s*seed\b[^)]*\)\s*return\s*""/, 'if (false) return ""');
  assert.notEqual(broken, body, "mutation did not land — the guard clause was not found");
  const fn = new Function("seed", "pool", "poolTag", broken.slice(1, -1));
  assert.notEqual(fn(null, "Pool A", realPoolTag()), "", "the sabotaged chip still returned empty — the assertion above proves nothing");
});

/* ==================== K-4: ready/done as data states, dots not tabs ==================== */

test("a match with both teams and no winner is READY; a scored one is DONE; a TBD one is neither", () => {
  // matchCard is DOM-free string building — execute the shipped bytes with the page's own inputs.
  const esc = (s) => String(s == null ? "" : s);
  const sideStub = () => "";
  const body = pure("matchCard");
  const fn = new Function("mt", "side", "esc", body.slice(1, -1));
  const ready = fn({ id: 1, court: 1, team_a: "X", team_b: "Y", team_a_id: 5, team_b_id: 6, winner: null }, sideStub, esc);
  const done = fn({ id: 2, court: 1, team_a: "X", team_b: "Y", team_a_id: 5, team_b_id: 6, winner: "X" }, sideStub, esc);
  const tbd = fn({ id: 3, court: 1, team_a: "X", team_b: null, team_a_id: 5, team_b_id: null, winner: null }, sideStub, esc);
  assert.match(ready, /data-ready="1"/, "both teams present and unscored must read as READY — that is the green dot");
  assert.doesNotMatch(done, /data-ready="1"/, "a finished match must never show the live dot");
  assert.match(done, /data-done="1"/);
  assert.doesNotMatch(tbd, /data-ready="1"/, "a slot still waiting on a feeder is not ready to play");
});

test("the DONE marker is the dot idiom now — D-10's 3px side-tab is gone from this page", () => {
  assert.doesNotMatch(STYLES, /\[data-done="1"\]\s*\{[^}]*border-left:\s*3px/,
    "the 3px coloured side-tab survives — D-10 records exactly this cliché on exactly this line");
  assert.match(STYLES, /\[data-done="1"\][^{]*::before\s*\{[^}]*content/,
    "done needs a non-colour-only marker in the dot idiom");
  assert.match(STYLES, /\[data-ready="1"\][^{]*::before\s*\{[^}]*--positive/,
    "the ready dot must use the token built for it, not a hex literal");
});

test("the ready dot's pulse respects prefers-reduced-motion, and nothing else on the tile animates forever", () => {
  const pulseBlock = STYLES.match(/@media\s*\(prefers-reduced-motion:\s*no-preference\)[^{]*\{[\s\S]*?\n\s*\}\s*\n/);
  assert.ok(pulseBlock && /brPulse|data-ready/.test(pulseBlock[0]),
    "the pulse must live INSIDE a no-preference media block — a glow that ignores reduced-motion is the one animation class this project bans");
  // Position, not excision: stripping a nested media block with a regex is exactly the kind of
  // bracket-matching a regex cannot do (the keyframes' braces defeated the first draft). Instead:
  // there is exactly ONE `infinite` in the stylesheet, and it sits AFTER the gate opens.
  const gateAt = STYLES.indexOf("prefers-reduced-motion: no-preference");
  const infinites = [...STYLES.matchAll(/animation:[^;}]*infinite/g)];
  assert.equal(infinites.length, 1, "a second infinite animation appeared — each needs its own reduced-motion review");
  assert.ok(gateAt >= 0 && infinites[0].index > gateAt,
    "the infinite animation sits BEFORE the reduced-motion gate opens — it runs for everyone");
});

/* ==================== K-3: the connectors ==================== */

test("the tree draws real connectors: an svg layer per tree, positioned, ignoring the pointer", () => {
  assert.match(blankComments(JS), /class="br-links"/, "no connector layer is emitted");
  assert.match(blankComments(JS), /function drawConnectors/, "no connector drawing function exists");
  assert.match(blankComments(JS), /getBoundingClientRect/,
    "connectors must be measured from the real tiles — a hardcoded geometry breaks on the first long team name");
  const scroll = STYLES.match(/\.br-scroll\s*\{[^}]*\}/);
  assert.ok(scroll && /position:\s*relative/.test(scroll[0]),
    ".br-scroll must anchor the absolute svg layer, or the lines drift from the tiles on scroll");
  const links = STYLES.match(/\.br-links\s*\{[^}]*\}/);
  assert.ok(links && /position:\s*absolute/.test(links[0]) && /pointer-events:\s*none/.test(links[0]),
    "the svg layer must be absolute and pointer-transparent — lines that eat clicks kill the slot editor");
});

test("connectors are redrawn on render and on resize, and the resize listener is wired ONCE at boot", () => {
  const js = blankComments(JS);
  const renderBody = functionBodyAfter(js, "function render");
  assert.ok(renderBody.includes("drawConnectors"), "render never draws the connectors");
  const wireBody = functionBodyAfter(js, "function wire");
  assert.ok(!wireBody.includes("resize"),
    "the resize listener is inside wire(), which runs per render — D-6's stacking-listener defect");
  assert.match(js, /addEventListener\("resize"/, "no resize handling — lines drift the moment the window changes");
});
