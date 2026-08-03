/* Boomtown Platform — manual bracket override
   File: worker/test/bracket_override.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.72.0

   Owner 2026-08-03: "brackets should auto populate but can be overrided with drag and drop or type
   entry. Please list the pool they were from in their tile. The reason this is needed is teams might
   forfeit so we can replace them in the bracket. additionally, this allows us to move teams from
   other pools down as needed or around as desired." And: "The assignment of bracket will be dependent
   on the admin running it ... many people quit at this point too, so we want to have flexibility."

   THE PROPERTY THAT MATTERS: the override must accept a team the seeding would never have chosen —
   a different pool, a different division, a losing record. A slot editor that only allowed teams the
   algorithm already approved of would be useless on the one day it is needed.

   THE TRAP THAT MATTERS: advancement is recomputed from scores, so a hand-placed team in a slot whose
   feeder has not been played WILL be overwritten by that game's winner. That is correct behaviour and
   it is also exactly what looks like the software losing your edit, so it must be reported. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../../web/assets/admin-brackets.js", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot(teamCount = 10) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Override Test','published',4)");
  DB.exec("INSERT INTO pools (id, org_id, event_id, name) VALUES (5,1,1,'Pool A'),(6,1,1,'Pool B')");
  for (let i = 1; i <= teamCount; i++) {
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, seed, pool_id) VALUES (${i},1,1,'Team ${i}',${i},${i <= 5 ? 5 : 6})`);
    DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES (1,1,${i},${teamCount - i},${i},${i})`);
  }
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/** An 8-team bracket seeded off standings, leaving teams 9 and 10 on the bench. */
async function withBracket(teamCount = 10) {
  const env = boot(teamCount);
  const token = await staff(env);
  const g = await call(env, "POST", "/api/admin/events/1/brackets", {
    token, body: { a_size: 8, include_rest: false, points_to: 25 },
  });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  return { env, token };
}

const qf = (env, slot = 1) => env.DB.one(
  "SELECT id, team_a_id, team_b_id FROM matches WHERE event_id=1 AND bracket_round=3 AND bracket_slot=?1", slot);

/* ================================ the pool travels with the team ================================ */

test("every bracket tile names the pool the team came out of", async () => {
  // Owner: "Please list the pool they were from in their tile." A name alone does not answer the only
  // question that matters when somebody has to be substituted in.
  const { env, token } = await withBracket();
  const r = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  const first = r.data.brackets[0].rounds.find((x) => x.bracket_round === 3).matches[0];
  assert.ok(first.pool_a, "no pool on side A");
  assert.ok(first.pool_b, "no pool on side B");
  assert.match(first.pool_a, /Pool [AB]/);
  assert.ok(first.rank_a, "where they finished must travel too");
  env.DB.close();
});

test("the bench lists every team in the event, with pool and finish, and flags who is already in", async () => {
  // ALL of them, not just the unplaced. Pulling a team across from another pool is the move the owner
  // described, and filtering the list would hide the option.
  const { env, token } = await withBracket(10);
  const r = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.equal(r.data.bench.length, 10);
  assert.equal(r.data.bench.filter((t) => t.in_bracket).length, 8);
  assert.equal(r.data.bench.filter((t) => !t.in_bracket).length, 2, "teams 9 and 10 missed the cut");
  for (const t of r.data.bench) {
    assert.ok(t.pool, `team ${t.id} has no pool on the bench`);
    assert.equal(typeof t.wins, "number");
  }
  env.DB.close();
});

/* ================================ overriding a slot ================================ */

test("a team the seeding never picked can be dropped into any slot", async () => {
  // The whole point. Team 10 finished last and is not in the bracket; on the day, that is exactly who
  // is standing there when somebody else has gone home.
  const { env, token } = await withBracket(10);
  const m = qf(env, 1);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: m.id, side: "a", team_id: 10 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(env.DB.one("SELECT team_a_id FROM matches WHERE id=?1", m.id).team_a_id, 10);
  env.DB.close();
});

test("a slot can be cleared, which is how a mistake is undone", async () => {
  const { env, token } = await withBracket();
  const m = qf(env, 1);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: m.id, side: "b", team_id: null },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(env.DB.one("SELECT team_b_id FROM matches WHERE id=?1", m.id).team_b_id, null);
  assert.match(r.data.note, /cleared/i);
  env.DB.close();
});

test("a team cannot be put on both sides of the same game", async () => {
  const { env, token } = await withBracket();
  const m = qf(env, 1);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: m.id, side: "a", team_id: m.team_b_id },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /can't play itself/);
  env.DB.close();
});

test("a team from another event is refused", async () => {
  const { env, token } = await withBracket();
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (99,1,2,'Outsider')");
  const m = qf(env, 1);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: m.id, side: "a", team_id: 99 },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /isn't in this event/);
  env.DB.close();
});

test("a pool game is not a bracket slot and says so", async () => {
  const { env, token } = await withBracket();
  env.DB.exec(`INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id)
               VALUES (500,1,1,'pool',1,1,1,2)`);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: 500, side: "a", team_id: 3 },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /pool play, not a bracket/);
  env.DB.close();
});

/* ================================ the overwrite warning ================================ */

test("placing a team where a winner will land warns that it will be replaced", async () => {
  // A quarter-final feeds a semi-final. Hand-placing a team into that semi slot before the QF is
  // played is legitimate — and the next advance pass will overwrite it, because advancement is
  // derived from scores. Silence here would look like the software discarding the edit.
  const { env, token } = await withBracket();
  const semi = env.DB.one("SELECT id FROM matches WHERE event_id=1 AND bracket_round=2 AND bracket_slot=1");
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: semi.id, side: "a", team_id: 9 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.overwritten_by_advance_risk, true);
  assert.match(r.data.note, /has not been played yet/);
  env.DB.close();
});

test("placing a team in a first-round slot carries no such warning — nothing feeds it", async () => {
  const { env, token } = await withBracket();
  const m = qf(env, 1);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: m.id, side: "a", team_id: 9 },
  });
  assert.equal(r.data.overwritten_by_advance_risk, false);
  assert.ok(!/has not been played yet/.test(r.data.note));
  env.DB.close();
});

test("and the warning is true: advancing really does overwrite the hand-placed team", async () => {
  // Asserted rather than assumed, because the whole warning is worthless if the behaviour differs.
  const { env, token } = await withBracket();
  const semi = env.DB.one("SELECT id FROM matches WHERE event_id=1 AND bracket_round=2 AND bracket_slot=1");
  await call(env, "POST", "/api/admin/events/1/brackets/slot", {
    token, body: { match_id: semi.id, side: "a", team_id: 9 },
  });
  const feeder = qf(env, 1);
  env.DB.exec(`UPDATE matches SET score_a=25, score_b=10 WHERE id=${feeder.id}`);
  await call(env, "POST", "/api/admin/events/1/brackets/advance", { token });
  assert.equal(env.DB.one("SELECT team_a_id FROM matches WHERE id=?1", semi.id).team_a_id, feeder.team_a_id,
    "the feeder's winner should have taken the slot back");
  env.DB.close();
});

/* ================================ forfeits ================================ */

test("a forfeit is recorded as a result, and the other team moves on", async () => {
  // Owner: "teams might forfeit." Emptying their slot would leave the opponent waiting for a game
  // nobody will play; recording it means the bracket advances on its own.
  const { env, token } = await withBracket();
  const m = qf(env, 1);
  const r = await call(env, "POST", "/api/admin/events/1/brackets/forfeit", {
    token, body: { match_id: m.id, side: "a" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = env.DB.one("SELECT score_a, score_b FROM matches WHERE id=?1", m.id);
  assert.deepEqual([after.score_a, after.score_b], [0, 25], "a forfeit is the full game to nil");

  const semi = env.DB.one("SELECT team_a_id FROM matches WHERE event_id=1 AND bracket_round=2 AND bracket_slot=1");
  assert.equal(semi.team_a_id, m.team_b_id, "the surviving team should already be in the semi");
  env.DB.close();
});

test("a forfeit with no opponent yet is refused", async () => {
  // Nobody can win a game that has only one team in it.
  const { env, token } = await withBracket();
  const semi = env.DB.one("SELECT id FROM matches WHERE event_id=1 AND bracket_round=2 AND bracket_slot=1");
  const r = await call(env, "POST", "/api/admin/events/1/brackets/forfeit", {
    token, body: { match_id: semi.id, side: "a" },
  });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /no opponent/);
  env.DB.close();
});

/* ================================ access ================================ */

test("a member cannot override a slot or record a forfeit", async () => {
  const { env } = await withBracket();
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  for (const path of ["/api/admin/events/1/brackets/slot", "/api/admin/events/1/brackets/forfeit"]) {
    const r = await call(env, "POST", path, { token: v.data.token, body: {} });
    assert.equal(r.status, 403, `${path} let a member through (${r.status})`);
  }
  env.DB.close();
});

/* ================================ the page contract ================================ */

test("the page offers BOTH ways in — drag, and pick from a list", () => {
  // Owner: "can be overrided with drag and drop or type entry." Either alone leaves somebody stuck:
  // drag is unusable with a keyboard, and a list is slow when the bracket is on a big screen.
  assert.match(PAGE, /dragstart/, "no drag path");
  assert.match(PAGE, /function openChooser/, "no pick-from-list path");
  assert.match(PAGE, /bPickFilter/, "the list must be filterable — 30 teams is a long list");
  assert.match(PAGE, /Leave empty/, "clearing a slot must be reachable from the list too");
});

test("the chooser can be closed with the keyboard", () => {
  // A modal with no keyboard exit is a trap.
  assert.match(PAGE, /e\.key === "Escape" && picking/);
  assert.match(PAGE, /bPickClose/);
});

test("slots and bench tiles are buttons, so they are focusable and announced", () => {
  assert.match(PAGE, /<button class="br-side/, "a slot must be a real control, not a styled div");
  assert.match(PAGE, /aria-label="\$\{name \? esc\(name\) : esc\(waiting/, "a slot needs an accessible name");
  assert.match(PAGE, /Choose a different team for this slot/);
});

test("a forfeit is confirmed before it is recorded", () => {
  // It writes a score and advances the bracket. A mis-click that does that silently is expensive.
  assert.match(PAGE, /window\.confirm\(`Record \$\{who\} as forfeiting\?/);
});

test("the page shows the pool origin on both the tile and the bench", () => {
  assert.match(PAGE, /const origin = \(pool, rank\)/);
  assert.match(PAGE, /class="br-from"/);
  assert.match(PAGE, /mt\.pool_a/);
});
