/* Boomtown Platform — pools run the day
   File: worker/test/pools_run_the_day.test.mjs · Version: v1.0 · Date: 2026-11-23 · Ships in: v0.217.0

   Owner 2026-11-23, after the gap analysis of the autumn's three tournaments: every real day was two
   or three SEPARATE pools, each with its own round robin on its own courts, its own standings and
   its own bracket. The platform ran one round robin over the whole event. These tests pin the new
   shape end to end through the real router:
     1. generate-schedule writes one round robin PER POOL, each on the pool's own courts, pool_id set.
     2. standings rank WITHIN the pool — two #1s for two pools.
     3. a bracket drawn for a pool takes that pool's teams only, and replacing it leaves the other
        pool's bracket alone.
     4. the 3rd-place match: fed by the semi-final LOSERS, labelled, and 3rd/4th falls back to seed
        when it is not played.
     5. the captain's scoring page carries the pool's standings.
   Negative controls: the single-pool path is unchanged (by_pool:false, and an event with no pools),
   and a bracket without third_place has no round-1 slot-2 row. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { standingsByPool } from "../src/tournaments.js";
import { courtsForPools } from "../src/formats.js";
import { pendingAdvances } from "../src/brackets.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot({ pools = true } = {}) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','QC Finals','published',8)");
  if (pools) {
    DB.exec("INSERT INTO pools (id, org_id, event_id, name, sort_order, court_from, court_to) VALUES (1,1,1,'Upper',0,1,4)");
    DB.exec("INSERT INTO pools (id, org_id, event_id, name, sort_order, court_from, court_to) VALUES (2,1,1,'Lower',1,5,8)");
  }
  for (let i = 1; i <= 16; i++) {
    const pool = pools ? (i <= 8 ? 1 : 2) : "NULL";
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, seed, pool_id, board_order, score_token)
             VALUES (${i},1,1,'Team ${i}',${i},${pool},${i},'${"ab".repeat(8)}${String(i).padStart(2, "0")}')`);
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
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", "s@bt.test");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1,${u.id},'s@bt.test','Staff')`);
  return v.data.token;
}

/** Score every pool game so that lower team ids win by their id gap — deterministic standings. */
async function playPools(env, token) {
  const games = env.DB.query("SELECT id, team_a_id, team_b_id FROM matches WHERE bracket_id IS NULL AND deleted_at IS NULL");
  for (const g of games) {
    const winner = g.team_a_id < g.team_b_id ? "a" : "b";
    const r = await call(env, "POST", `/api/matches/${g.id}/score`, { token, body: { winner, diff: Math.abs(g.team_a_id - g.team_b_id) } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
}

/* ============================ 1. one round robin per pool ============================ */

test("generate-schedule with saved pools writes one round robin PER POOL on that pool's courts", async () => {
  const env = boot();
  const token = await staff(env);
  const gen = await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { rounds: 7, points_to: 25, cap: 0 } });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  assert.equal(gen.data.by_pool, true);
  assert.equal(gen.data.pools.length, 2);

  const upper = env.DB.query("SELECT court, team_a_id, team_b_id, cap FROM matches WHERE pool_id=1 AND deleted_at IS NULL");
  const lower = env.DB.query("SELECT court, team_a_id, team_b_id FROM matches WHERE pool_id=2 AND deleted_at IS NULL");
  assert.equal(upper.length, 28, "8 teams, 7 rounds, 4 courts: a full round robin in Upper");
  assert.equal(lower.length, 28);
  assert.ok(upper.every((m) => m.court >= 1 && m.court <= 4), "Upper plays only on courts 1–4");
  assert.ok(lower.every((m) => m.court >= 5 && m.court <= 8), "Lower plays only on courts 5–8");
  assert.ok(upper.every((m) => m.team_a_id <= 8 && m.team_b_id <= 8), "no Upper game involves a Lower team");
  assert.ok(lower.every((m) => m.team_a_id >= 9 && m.team_b_id >= 9), "no Lower game involves an Upper team");
  assert.ok(upper.every((m) => m.cap === 0), "cap 0 is stored as no cap, not turned into points+2");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE pool_id IS NULL AND deleted_at IS NULL").n, 0,
    "every game carries its pool");
  env.DB.close();
});

test("NEGATIVE CONTROL: by_pool:false, and an event with no pools, still write ONE round robin with no pool_id", async () => {
  const env = boot();
  const token = await staff(env);
  const off = await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 8, rounds: 15, by_pool: false } });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal(off.data.by_pool, undefined);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE pool_id IS NOT NULL AND deleted_at IS NULL").n, 0);
  env.DB.close();

  const env2 = boot({ pools: false });
  const token2 = await staff(env2);
  const plain = await call(env2, "POST", "/api/admin/events/1/generate-schedule", { token: token2, body: { courts: 8, rounds: 15 } });
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  assert.equal(plain.data.by_pool, undefined, "no pools saved → the old single-pool path, untouched");
  env2.DB.close();
});

test("courtsForPools: own ranges are kept; unranged pools share the event's courts in board order", () => {
  const ranged = courtsForPools([{ id: 1, court_from: 1, court_to: 4 }, { id: 2, court_from: 9, court_to: 12 }], 12);
  assert.deepEqual(ranged.get(1), [1, 2, 3, 4]);
  assert.deepEqual(ranged.get(2), [9, 10, 11, 12]);
  const dealt = courtsForPools([{ id: 1 }, { id: 2 }, { id: 3 }], 12);
  assert.deepEqual([dealt.get(1), dealt.get(2), dealt.get(3)], [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]);
});

/* ============================ 2. standings per pool ============================ */

test("standings rank WITHIN the pool: two pools, two #1s, and the flat list carries pool names", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { rounds: 7 } });
  await playPools(env, token);
  const st = await call(env, "GET", "/api/events/1/standings");
  assert.equal(st.status, 200);
  const firsts = st.data.standings.filter((r) => r.rank === 1);
  assert.deepEqual(firsts.map((r) => r.name).sort(), ["Team 1", "Team 9"], "each pool has its own #1");
  assert.deepEqual(st.data.pools.map((p) => p.pool), ["Upper", "Lower"]);
  assert.equal(st.data.pools[1].standings[0].name, "Team 9");
  assert.equal(st.data.pools[1].standings[0].wins, 7);
  env.DB.close();
});

test("standingsByPool (pure): a game with no pool never leaks into a pool's table — NEGATIVE CONTROL", () => {
  const rows = [
    { teamA: 1, teamB: 2, scoreA: 25, scoreB: 20, poolId: 1 },
    { teamA: 3, teamB: 4, scoreA: 25, scoreB: 10, poolId: 2 },
    { teamA: 5, teamB: 6, scoreA: 25, scoreB: 23, poolId: null },
  ];
  const teams = [1, 2].map((id) => ({ id, poolId: 1 })).concat([3, 4].map((id) => ({ id, poolId: 2 })), [{ id: 5, poolId: null }, { id: 6, poolId: null }]);
  const out = standingsByPool(rows, teams);
  assert.equal(out.filter((r) => r.rank === 1).length, 3, "three groups, three #1s");
  assert.deepEqual(out.filter((r) => r.poolId === 1).map((r) => r.team).sort(), [1, 2]);
  assert.deepEqual(out.filter((r) => r.poolId === null).map((r) => r.team).sort(), [5, 6]);
  // Mutate: put the loose game into pool 1 and the pool-1 table must now hold four teams.
  rows[2].poolId = 1;
  assert.equal(standingsByPool(rows, teams).filter((r) => r.poolId === 1).length, 4);
});

/* ============================ 3. a bracket per pool ============================ */

test("a bracket drawn for a pool takes ONLY that pool's teams, and replacing it leaves the other pool's bracket alone", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { rounds: 7 } });
  await playPools(env, token);

  const up = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { pool_id: 1, a_size: 8, include_rest: false } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const low = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { pool_id: 2, a_size: 8, include_rest: false } });
  assert.equal(low.status, 200, JSON.stringify(low.data));

  const list = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.equal(list.data.brackets.length, 2);
  const upper = list.data.brackets.find((b) => b.pool === "Upper");
  const lower = list.data.brackets.find((b) => b.pool === "Lower");
  assert.ok(upper && lower, "each bracket names its pool");
  const teamsIn = (b) => b.rounds.flatMap((r) => r.matches.flatMap((m) => [m.team_a_id, m.team_b_id])).filter(Boolean);
  assert.ok(teamsIn(upper).every((id) => id <= 8), "Upper's bracket holds only Upper teams");
  assert.ok(teamsIn(lower).every((id) => id >= 9), "Lower's bracket holds only Lower teams");
  assert.equal(upper.rounds[0].matches[0].team_a_id, 1, "seeded from the POOL's standings: Upper's #1 is Team 1");
  assert.equal(lower.rounds[0].matches[0].team_a_id, 9, "Lower's #1 is Team 9, not the event's #9");

  // Redraw Upper only. Lower's games must survive untouched.
  const again = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { pool_id: 1, a_size: 8, include_rest: false } });
  assert.equal(again.status, 409, "a second draw for the same pool is refused without replace");
  const redo = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { pool_id: 1, a_size: 8, include_rest: false, replace: true } });
  assert.equal(redo.status, 200, JSON.stringify(redo.data));
  assert.equal(redo.data.matches_replaced, 7, "only Upper's 7 games were set aside");
  const after = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.equal(after.data.brackets.filter((b) => b.pool === "Lower").length, 1, "Lower's bracket is still there");
  assert.equal(after.data.brackets.filter((b) => b.pool === "Upper").length, 1);
  env.DB.close();
});

/* ============================ 4. the 3rd-place match ============================ */

test("third_place: the semi-final LOSERS meet at round 1 slot 2; unplayed, 3rd/4th go by seed", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { rounds: 7 } });
  await playPools(env, token);
  const g = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { pool_id: 1, a_size: 4, include_rest: false, third_place: true } });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const rows = env.DB.query("SELECT id, bracket_round, bracket_slot, team_a_id, team_b_id FROM matches WHERE bracket_id IS NOT NULL AND deleted_at IS NULL ORDER BY bracket_round DESC, bracket_slot");
  assert.equal(rows.length, 4, "two semis, a final, and a 3rd-place match");
  const third = rows.find((r) => r.bracket_round === 1 && r.bracket_slot === 2);
  assert.ok(third, "the 3rd-place node exists at round 1 slot 2");
  assert.equal(third.team_a_id, null, "nobody in it until the semis are played");

  // Semis: 1 v 4 and 2 v 3. Let the favourites win.
  const semis = rows.filter((r) => r.bracket_round === 2);
  for (const s of semis) {
    const r = await call(env, "POST", `/api/matches/${s.id}/score`, { token, body: { winner: "a", diff: 5 } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  const fed = env.DB.one("SELECT team_a_id, team_b_id FROM matches WHERE id=?1", third.id);
  assert.deepEqual([fed.team_a_id, fed.team_b_id], [4, 3], "losers of semi 1 (seed 4) and semi 2 (seed 3) land in the 3rd-place match");
  const final = env.DB.one("SELECT team_a_id, team_b_id FROM matches WHERE bracket_round=1 AND bracket_slot=1");
  assert.deepEqual([final.team_a_id, final.team_b_id], [1, 2], "the winners' path is untouched");

  const list = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  const br = list.data.brackets[0];
  const node = br.rounds.find((r) => r.bracket_round === 1).matches.find((m) => m.third_place);
  assert.equal(node.label, "3rd place");
  assert.equal(br.has_third_place, true);
  assert.equal(br.third_place.decided_by, "seed", "not played yet: owner's rule, placement by seed");
  assert.equal(br.third_place.third, "Team 3", "seed 3 outranks seed 4");
  assert.equal(br.champion, null, "a 3rd-place result is never mistaken for a champion");

  await call(env, "POST", `/api/matches/${third.id}/score`, { token, body: { winner: "a", diff: 2 } });
  const played = (await call(env, "GET", "/api/admin/events/1/brackets", { token })).data.brackets[0];
  assert.equal(played.third_place.decided_by, "match");
  assert.equal(played.third_place.third, "Team 4", "the match beats the seed once it is played");
  env.DB.close();
});

test("NEGATIVE CONTROL: without third_place there is no round-1 slot-2 row, and pendingAdvances feeds no loser", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { rounds: 7 } });
  await playPools(env, token);
  const g = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { pool_id: 1, a_size: 4, include_rest: false } });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE bracket_round=1 AND bracket_slot=2 AND deleted_at IS NULL").n, 0);
  env.DB.close();

  const semis = [
    { id: 1, bracket_round: 2, bracket_slot: 1, team_a_id: 1, team_b_id: 4, score_a: 25, score_b: 20 },
    { id: 2, bracket_round: 2, bracket_slot: 2, team_a_id: 2, team_b_id: 3, score_a: 25, score_b: 20 },
    { id: 3, bracket_round: 1, bracket_slot: 1, team_a_id: null, team_b_id: null, score_a: null, score_b: null },
  ];
  assert.equal(pendingAdvances(semis).filter((c) => c.loser_feed).length, 0);
  const withThird = semis.concat([{ id: 4, bracket_round: 1, bracket_slot: 2, team_a_id: null, team_b_id: null, score_a: null, score_b: null }]);
  const feeds = pendingAdvances(withThird).filter((c) => c.loser_feed);
  assert.deepEqual(feeds.map((c) => [c.side, c.team_id]), [["a", 4], ["b", 3]]);
});

/* ============================ 5. captain's page ============================ */

test("the captain's scoring page carries the pool's standings and the pool name", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { rounds: 7 } });
  await playPools(env, token);
  const tok = env.DB.one("SELECT score_token FROM teams WHERE id=9").score_token;
  const r = await call(env, "GET", `/api/score/${tok}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.pool, "Lower");
  assert.equal(r.data.standings.length, 8, "only the team's own pool is on the page");
  assert.equal(r.data.standings[0].name, "Team 9");
  assert.ok(r.data.standings.every((s) => s.team_id >= 9), "no Upper team on a Lower captain's page");
});
