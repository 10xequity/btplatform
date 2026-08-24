/**
 * Boomtown Platform — §-1r RF-2 Unit B + RF-3: the structured league night, and the forfeit
 * File: worker/test/league_night.test.mjs · Version: v1.0 · Date: 2026-08-24 · Ships in: v0.192.0
 *
 * Owner rules, 2026-08-24, both recorded verbatim in the roadmap rows:
 *   RF-2B — "We will simply rotate through all the teams more than once, team can go on different
 *   courts. We can even go 3 rounds with 2 games each, meaning 2 games vs 3 teams a night."
 *   RF-3  — forfeit displays as the conventional 25-0 win, "but when assigning point differentials
 *   … +1 … does not change differential standings too much."
 *
 * Everything here drives the REAL router (e2e_journey's harness): real SQL, real auth, no mocks.
 * The properties pinned:
 *   · A structured night stays ONE round — the board/print/standings week grouping is load-bearing.
 *   · Rotations prefer FRESH opponents: 4 teams × 3 rotations = each team meets all 3 others.
 *   · gamesPerMatch writes that many rows per pairing, same court, game_number = play order.
 *   · Hostile shape inputs clamp (99 → 3, 0 → 1) rather than refuse or run away.
 *   · A forfeit stores points_to-0 PLUS the flag; standings move one differential point, while an
 *     EARNED 21-0 keeps its 21 — the discriminator proving the rule rides the flag, not the score.
 *   · A typed correction clears the flag; junk forfeit_by refuses with its own sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function makeEnv() {
  const DB = createD1(SCHEMA);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}

function expectStatus(r, want, what) {
  assert.equal(r.status, want,
    `${what}: expected ${want}, got ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);
}

/** A league with `n` same-level teams on 2 courts, plus a signed-in staff session. */
async function seedLeague(env, n) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO events (id, org_id, type, name, status, court_count, starts_at)
      VALUES (7, 1, 'league', 'Tuesday League', 'in_progress', 2, datetime('now','-1 hour'));
  `);
  for (let i = 1; i <= n; i++) {
    env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, level_num) VALUES (${i}, 1, 7, 'Team ${i}', 3);`);
  }
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "ops@boomtown.test" } });
  const token = String(asked.data.dev_link).split("token=")[1];
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", "ops@boomtown.test");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, 'admin')
    ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin', deleted_at=NULL`);
  return verified.data.token;
}

/* ═══════════════════ RF-2 Unit B: the structured night ═══════════════════ */

test("RF-2B — a plain press stays a plain night: one round, one game per pairing, game_number 1", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const r = await call(env, "POST", "/api/leagues/7/week", { body: {}, token });
  expectStatus(r, 200, "plain week");
  assert.equal(r.data.rounds_per_night, 1);
  assert.equal(r.data.games_per_match, 1);
  const rows = env.DB.query("SELECT round, game_number FROM matches WHERE event_id=7 AND deleted_at IS NULL");
  assert.equal(rows.length, 2, "4 teams pair into 2 games");
  assert.ok(rows.every((m) => m.round === 1 && m.game_number === 1),
    "a plain night wrote structure it does not have");
});

test("RF-2B — 3 rotations × 2 games: ONE round, fresh opponents each rotation, play order on game_number", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const r = await call(env, "POST", "/api/leagues/7/week", {
    body: { roundsPerNight: 3, gamesPerMatch: 2 }, token,
  });
  expectStatus(r, 200, "structured week");
  assert.equal(r.data.matches, 12, "2 pairings × 3 rotations × 2 games = 12 rows");

  const rows = env.DB.query(
    "SELECT round, court, game_number, team_a_id, team_b_id FROM matches WHERE event_id=7 AND deleted_at IS NULL ORDER BY game_number, court");
  // The night is ONE week — every surface that groups by round depends on this staying true.
  assert.equal(new Set(rows.map((m) => m.round)).size, 1, "a structured night split into multiple week numbers");
  // Play order: rotation r, game g → game_number (r-1)*2+g, so the night reads 1..6.
  assert.deepEqual([...new Set(rows.map((m) => m.game_number))].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  // Courts stay within the event's 2.
  assert.ok(rows.every((m) => m.court >= 1 && m.court <= 2), "a court outside the event's court_count");
  // Fresh opponents: 4 teams have exactly 3 possible opponents; 3 rotations must meet all 3 —
  // a rematch here means the meetCount update between rotations regressed.
  for (let t = 1; t <= 4; t++) {
    const opps = new Set(rows.filter((m) => m.team_a_id === t || m.team_b_id === t)
      .map((m) => (m.team_a_id === t ? m.team_b_id : m.team_a_id)));
    assert.equal(opps.size, 3, `team ${t} met ${opps.size} distinct opponents — rotations are rematching early`);
  }
  // Each pairing's two games share a court (played back to back).
  const byPair = new Map();
  for (const m of rows) {
    const k = `${Math.min(m.team_a_id, m.team_b_id)}-${Math.max(m.team_a_id, m.team_b_id)}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(m.court);
  }
  for (const [k, courts] of byPair) {
    assert.equal(courts.length, 2, `pairing ${k} did not get its 2 games`);
    assert.equal(courts[0], courts[1], `pairing ${k}'s two games landed on different courts`);
  }
});

test("RF-2B NC — hostile shape inputs CLAMP (99 → 3, 0 → 1) instead of refusing or running away", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const r = await call(env, "POST", "/api/leagues/7/week", {
    body: { roundsPerNight: 99, gamesPerMatch: -5 }, token,
  });
  expectStatus(r, 200, "clamped week");
  assert.equal(r.data.rounds_per_night, 3, "roundsPerNight did not clamp at 3");
  assert.equal(r.data.games_per_match, 1, "a junk gamesPerMatch did not clamp at 1");
  const n = env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE event_id=7 AND deleted_at IS NULL").n;
  assert.equal(n, 6, "2 pairings × 3 rotations × 1 game = 6 rows");
});

/* ═══════════════════ RF-3: the forfeit ═══════════════════ */

/** One scored-ready league night; returns the two match ids of the plain week. */
async function seedNight(env, token) {
  const r = await call(env, "POST", "/api/leagues/7/week", { body: {}, token });
  expectStatus(r, 200, "seed week");
  return env.DB.query("SELECT id, team_a_id, team_b_id, points_to FROM matches WHERE event_id=7 AND deleted_at IS NULL ORDER BY id");
}

test("RF-3 — a forfeit stores the conventional score AND the flag; standings move ONE point", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const [m1] = await seedNight(env, token);
  const r = await call(env, "POST", `/api/matches/${m1.id}/score`, { body: { forfeit_by: "b" }, token });
  expectStatus(r, 200, "forfeit entry");
  const row = env.DB.one("SELECT score_a, score_b, forfeit_by FROM matches WHERE id=?1", m1.id);
  assert.equal(row.score_a, m1.points_to, "the opponent's score is not the conventional points_to");
  assert.equal(row.score_b, 0);
  assert.equal(row.forfeit_by, "b", "the flag did not persist — the differential rule has nothing to ride");
  const win = env.DB.one("SELECT wins, losses, point_diff FROM standings WHERE event_id=7 AND team_id=?1", m1.team_a_id);
  const los = env.DB.one("SELECT wins, losses, point_diff FROM standings WHERE event_id=7 AND team_id=?1", m1.team_b_id);
  assert.equal(win.wins, 1, "a forfeit win must count as a FULL win");
  assert.equal(win.point_diff, 1, `owner's rule: +1 differential, got +${win.point_diff}`);
  assert.equal(los.losses, 1);
  assert.equal(los.point_diff, -1, `owner's rule: -1 differential, got ${los.point_diff}`);
});

test("RF-3 — the discriminator: an EARNED 21-0 keeps its 21 points of differential", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const [m1] = await seedNight(env, token);
  const r = await call(env, "POST", `/api/matches/${m1.id}/score`, { body: { score_a: 21, score_b: 0 }, token });
  expectStatus(r, 200, "earned shutout");
  const win = env.DB.one("SELECT point_diff FROM standings WHERE event_id=7 AND team_id=?1", m1.team_a_id);
  assert.equal(win.point_diff, 21,
    "an earned shutout lost its differential — the rule leaked from the flag onto the score");
});

test("RF-3 — a typed correction clears the flag and restores the full differential", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const [m1] = await seedNight(env, token);
  await call(env, "POST", `/api/matches/${m1.id}/score`, { body: { forfeit_by: "a" }, token });
  const r = await call(env, "POST", `/api/matches/${m1.id}/score`, { body: { score_a: 21, score_b: 15 }, token });
  expectStatus(r, 200, "correction after forfeit");
  const row = env.DB.one("SELECT forfeit_by FROM matches WHERE id=?1", m1.id);
  assert.equal(row.forfeit_by, null, "typing a real score must clear the forfeit — the game was played");
  const win = env.DB.one("SELECT point_diff FROM standings WHERE event_id=7 AND team_id=?1", m1.team_a_id);
  assert.equal(win.point_diff, 6, "the corrected game must count its real 21-15 differential");
});

test("RF-3 NC — junk forfeit_by refuses with its own sentence and writes nothing", async () => {
  const env = makeEnv();
  const token = await seedLeague(env, 4);
  const [m1] = await seedNight(env, token);
  const r = await call(env, "POST", `/api/matches/${m1.id}/score`, { body: { forfeit_by: "x" }, token });
  expectStatus(r, 400, "junk forfeit refusal");
  assert.match(String(r.data.error || ""), /forfeit_by/, "the refusal does not name what was wrong");
  const row = env.DB.one("SELECT score_a, forfeit_by FROM matches WHERE id=?1", m1.id);
  assert.equal(row.score_a, null, "a refused forfeit still wrote a score");
  assert.equal(row.forfeit_by, null, "a refused forfeit still set the flag");
});
