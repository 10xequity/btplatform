/* Boomtown Platform — divisions and bracket balancing
   File: worker/test/divisions.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.69.0

   Every rule here came from the owner on 2026-08-03, and each test names the sentence it enforces.
   That matters more than usual: these are judgement calls about which teams get to keep playing, so
   when one changes, the test should be the thing that argues back.

   The load-bearing property is that NOTHING MOVES BY ITSELF. Asked directly, the owner chose
   "Propose, you approve." A plan endpoint that quietly reassigned a team would be defensible code
   and the wrong product — so it is asserted directly, twice. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import {
  bestSplit, median, rankTeams, findOutliers, planDivisions,
  ALLOWED_BRACKET_SIZES, TOP_DIVISION_TARGET,
} from "../src/divisions.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const IDX = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/** A team with a pool record. Wins is the only thing most of these rules look at. */
const T = (id, wins, gamesPlayed = 10) => ({ id, name: `Team ${id}`, wins, losses: gamesPlayed - wins, gamesPlayed, pointDiff: wins * 4 - 10, pointsFor: 100 + wins });

/* ================================ splitting ================================ */

test("nine teams split 6 + 3, not 8 + 1", () => {
  // Greedy-largest-first gives 8 and leaves one team standing on their own. One team is not a
  // bracket, and this is the smallest field where the naive answer breaks.
  assert.deepEqual(bestSplit(9), [6, 3]);
});

test("every field size from 2 to 40 splits into legal brackets", () => {
  for (let n = 2; n <= 40; n++) {
    const s = bestSplit(n);
    assert.ok(s, `n=${n} could not be split at all`);
    assert.equal(s.reduce((a, b) => a + b, 0), n, `n=${n}: sizes ${s} do not add to ${n}`);
    for (const size of s) assert.ok(ALLOWED_BRACKET_SIZES.includes(size), `n=${n}: ${size} is not an allowed bracket size`);
  }
});

test("one team cannot be bracketed, and says so instead of guessing", () => {
  assert.equal(bestSplit(1), null);
  assert.deepEqual(bestSplit(0), []);
});

test("the split prefers fewer, larger brackets", () => {
  assert.deepEqual(bestSplit(14), [8, 6]);
  assert.deepEqual(bestSplit(12), [8, 4]);   // 6+6 is also two, but the larger opening wins
  assert.deepEqual(bestSplit(10), [8, 2]);
  assert.deepEqual(bestSplit(16), [8, 8]);
});

/* ================================ ranking and outliers ================================ */

test("median, not mean — one hopeless team must not hide the next one", () => {
  // Owner's example: everyone on 5-6 wins, two teams on 1-2. The mean is dragged to ~4.9 and a
  // 2-win team stops looking unusual. The median stays at 5.5 and both stay visible.
  const wins = [6, 6, 5, 6, 5, 6, 5, 6, 1, 2];
  assert.equal(median(wins), 5.5);
  const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
  assert.ok(mean < median(wins), "this fixture must actually have a mean below its median, or it proves nothing");
});

test("the owner's example: 8 teams on 5-6 wins, 2 on 1-2, both get flagged", () => {
  const teams = [T(1, 6), T(2, 6), T(3, 5), T(4, 6), T(5, 5), T(6, 6), T(7, 5), T(8, 6), T(9, 1), T(10, 2)];
  const odd = findOutliers(teams);
  assert.deepEqual(odd.map((t) => t.id).sort((a, b) => a - b), [9, 10]);
});

test("a tight division flags nobody", () => {
  const teams = [T(1, 6), T(2, 5), T(3, 5), T(4, 4), T(5, 4), T(6, 4), T(7, 3), T(8, 3)];
  assert.deepEqual(findOutliers(teams), []);
});

test("ranking breaks ties, and never leaves the order to chance", () => {
  const a = { id: 1, name: "A", wins: 5, pointDiff: 10, pointsFor: 200 };
  const b = { id: 2, name: "B", wins: 5, pointDiff: 20, pointsFor: 150 };
  const c = { id: 3, name: "C", wins: 5, pointDiff: 20, pointsFor: 180 };
  assert.deepEqual(rankTeams([a, b, c]).map((t) => t.id), [3, 2, 1]);
});

/* ================================ the top division ================================ */

test("top division holds at 8, and the 9th and 10th are proposed for dropping once they have played a full day", () => {
  // Owner: "if they are 9th or 10th, we will drop them to get to 8 and if they played 8-10 games.
  // They will have received sufficient game play."
  const teams = Array.from({ length: 10 }, (_, i) => T(i + 1, 10 - i, 10));
  const { divisions, proposals } = planDivisions([{ id: 1, name: "Open", rank: 1, teams }]);
  assert.equal(divisions[0].brackets.length, 1);
  assert.equal(divisions[0].brackets[0].size, TOP_DIVISION_TARGET);
  assert.equal(proposals.length, 2);
  assert.ok(proposals.every((p) => p.kind === "drop_from_bracket"));
  assert.match(proposals[0].reason, /9th.*played 10 games/);
});

test("a 9th-place team that has NOT had a full day is moved down, not dropped", () => {
  // The games-played half of the rule is the whole point of it. Dropping a team that has played
  // four games sends them home early, which is the opposite of what the rule is for.
  const top = Array.from({ length: 9 }, (_, i) => T(i + 1, 9 - i, i === 8 ? 4 : 10));
  const { proposals } = planDivisions([
    { id: 1, name: "Open", rank: 1, teams: top },
    { id: 2, name: "A", rank: 2, teams: [T(20, 5), T(21, 4), T(22, 4), T(23, 3)] },
  ]);
  const p = proposals.find((x) => x.team_id === 9);
  assert.equal(p.kind, "move_down");
  assert.equal(p.to_division, "A");
  assert.match(p.reason, /only played 4 games/);
});

test("a top division of 8 or fewer is left alone", () => {
  const { divisions, proposals } = planDivisions([
    { id: 1, name: "Open", rank: 1, teams: Array.from({ length: 8 }, (_, i) => T(i + 1, 8 - i)) },
  ]);
  assert.deepEqual(proposals, []);
  assert.equal(divisions[0].brackets[0].size, 8);
});

/* ================================ lower divisions ================================ */

test("a misplaced team in a middle division is proposed for the division below", () => {
  // Owner: "In the lower divisions, we will put them into a lower division."
  const { proposals } = planDivisions([
    { id: 1, name: "Open", rank: 1, teams: Array.from({ length: 6 }, (_, i) => T(i + 1, 6 - i)) },
    { id: 2, name: "A", rank: 2, teams: [T(10, 6), T(11, 6), T(12, 5), T(13, 6), T(14, 5), T(15, 1)] },
    { id: 3, name: "BB", rank: 3, teams: [T(20, 4), T(21, 3), T(22, 3), T(23, 2)] },
  ]);
  const p = proposals.find((x) => x.team_id === 15);
  assert.equal(p.kind, "move_down");
  assert.equal(p.to_division, "BB");
  assert.match(p.reason, /1 win against a A median of 5.5/);
});

test("in the BOTTOM division there is nowhere to move to, so two adrift teams play each other", () => {
  // Owner: "or have them play against themselves (2 opponents)."
  const { proposals } = planDivisions([
    { id: 1, name: "Open", rank: 1, teams: Array.from({ length: 4 }, (_, i) => T(i + 1, 4 - i)) },
    { id: 2, name: "BB", rank: 2, teams: [T(10, 6), T(11, 6), T(12, 5), T(13, 6), T(14, 1), T(15, 1)] },
  ]);
  const mini = proposals.filter((p) => p.kind === "mini_bracket");
  assert.equal(mini.length, 2, "both adrift teams should be offered a bracket against each other");
  assert.match(mini[0].reason, /no division below/);
});

test("a division is never gutted to fix it", () => {
  // Three teams where two are adrift: removing both leaves one, who cannot play anyone. Better to
  // leave the division alone than to produce a plan that strands somebody.
  const { proposals, divisions } = planDivisions([
    { id: 1, name: "Open", rank: 1, teams: [T(1, 5), T(2, 5), T(3, 5), T(4, 5)] },
    { id: 2, name: "BB", rank: 2, teams: [T(10, 8), T(11, 1), T(12, 1)] },
  ]);
  assert.deepEqual(proposals.filter((p) => p.from_division === "BB"), []);
  assert.equal(divisions[1].count, 3);
});

/* ================================ the trailing-group rule ================================ */

test("22 teams become 8 / 8 / 6 when the bottom six are competitive", () => {
  // Owner, choosing between the two shapes he had described: "I prefer A ... Otherwise, if they are
  // competitive, then 1st one."
  // A smooth ladder with no cliff at the bottom: every team is within 3 wins of its neighbours, so
  // the trailing six is competitive and stays whole.
  const teams = Array.from({ length: 22 }, (_, i) => T(i + 1, 12 - Math.floor(i / 2)));
  const { divisions, proposals } = planDivisions([{ id: 1, name: "Open", rank: 1, teams }], { gapWins: 3 });
  assert.deepEqual(divisions[0].brackets.map((b) => b.size), [8, 8, 6]);
  assert.deepEqual(proposals, [],
    "fourteen teams over is a second and third bracket, not fourteen teams to drop");
  assert.deepEqual(divisions[0].brackets.map((b) => b.label), ["Open A", "Open B", "Open C"]);
});

test("the trim only applies to a SMALL overflow — 11 teams is a second bracket, not three drops", () => {
  // The line between the owner's two statements. At 9 or 10 the extras have had their day and are
  // proposed for dropping; at 11 they are a bracket of their own.
  const ten = planDivisions([{ id: 1, name: "Open", rank: 1, teams: Array.from({ length: 10 }, (_, i) => T(i + 1, 10 - i)) }]);
  assert.equal(ten.proposals.length, 2, "10 teams: trim the two");
  assert.deepEqual(ten.divisions[0].brackets.map((b) => b.size), [8]);

  const eleven = planDivisions([{ id: 1, name: "Open", rank: 1, teams: Array.from({ length: 11 }, (_, i) => T(i + 1, 11 - i)) }]);
  assert.deepEqual(eleven.proposals, [], "11 teams: nobody is dropped");
  assert.deepEqual(eleven.divisions[0].brackets.map((b) => b.size), [8, 3]);
});

test("a trailing group of six splits 4 + 2 when its own bottom two are adrift", () => {
  // Owner: "if the bottom 6 - 4 and 2 if the bottom 2 are very low, then they can be in the lowest
  // division." Judged inside the group, not against the whole division.
  const teams = [
    ...Array.from({ length: 8 }, (_, i) => T(i + 1, 9)),        // a tight A bracket
    T(9, 6), T(10, 6), T(11, 6), T(12, 6),                       // a competent middle
    T(13, 0), T(14, 0),                                          // adrift, even of the middle
  ];
  const { divisions } = planDivisions([{ id: 1, name: "Open", rank: 1, teams }], { gapWins: 3 });
  const sizes = divisions[0].brackets.map((b) => b.size);
  assert.deepEqual(sizes, [8, 4, 2], `expected 8/4/2, got ${sizes.join("/")}`);
});

test("the same trailing six stays whole when it is competitive", () => {
  const teams = [
    ...Array.from({ length: 8 }, (_, i) => T(i + 1, 9)),
    T(9, 5), T(10, 5), T(11, 4), T(12, 4), T(13, 4), T(14, 3),   // a real bracket, close together
  ];
  const { divisions } = planDivisions([{ id: 1, name: "Open", rank: 1, teams }], { gapWins: 3 });
  assert.deepEqual(divisions[0].brackets.map((b) => b.size), [8, 6]);
});

/* ================================ live routes ================================ */

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','12 Court Classic','published',12)");
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

const THREE = {
  divisions: [
    { name: "Open", rank: 1, court_from: 1, court_to: 4 },
    { name: "A", rank: 2, court_from: 5, court_to: 8 },
    { name: "BB", rank: 3, court_from: 9, court_to: 12 },
  ],
};

test("twelve courts split three ways, as a range each", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = env.DB.query("SELECT name, rank, court_from, court_to FROM divisions ORDER BY rank");
  assert.deepEqual(rows.map((d) => [d.court_from, d.court_to]), [[1, 4], [5, 8], [9, 12]]);
  env.DB.close();
});

test("two divisions cannot be given the same court", async () => {
  // Nobody notices an overlap until two teams are sent to court 5 at the same time.
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/divisions", {
    token, body: { divisions: [
      { name: "Open", rank: 1, court_from: 1, court_to: 6 },
      { name: "A", rank: 2, court_from: 5, court_to: 10 },
    ] },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Court 5 is given to both/);
  env.DB.close();
});

test("a court range that runs backwards is refused", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/divisions", {
    token, body: { divisions: [{ name: "Open", rank: 1, court_from: 8, court_to: 4 }] },
  });
  assert.equal(r.status, 400);
  env.DB.close();
});

test("the plan is a READ — it never moves a team", async () => {
  // The property the owner actually chose. If this ever fails, the product is wrong even if the
  // code is defensible.
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  const [open, a] = env.DB.query("SELECT id FROM divisions ORDER BY rank").map((d) => d.id);
  for (let i = 1; i <= 10; i++) {
    env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id) VALUES (${i},1,1,'T${i}',${open})`);
    env.DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES (1,1,${i},${11 - i},${i},${i})`);
    for (let g = 0; g < 10; g++) {
      env.DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, score_a, score_b)
                   VALUES (1,1,'pool',${g + 1},1,${i},${(i % 10) + 1},21,15)`);
    }
  }
  // The A division needs adrift teams too, so this covers BOTH proposal kinds. A fixture that only
  // produces `drop_from_bracket` cannot catch a plan endpoint that applies `move_down` — which is
  // exactly what a negative control on this file found the first time it was run.
  for (let i = 11; i <= 18; i++) {
    const wins = i <= 16 ? 6 : 0;
    env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id) VALUES (${i},1,1,'A${i}',${a})`);
    env.DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES (1,1,${i},${wins},${9 - wins},${i})`);
  }

  const before = env.DB.query("SELECT id, division_id FROM teams ORDER BY id");
  const plan = await call(env, "GET", "/api/admin/events/1/divisions/plan", { token });
  assert.equal(plan.status, 200, JSON.stringify(plan.data));
  const kinds = new Set(plan.data.proposals.map((p) => p.kind));
  assert.ok(kinds.has("drop_from_bracket"), "fixture must produce a drop proposal");
  assert.ok(kinds.has("move_down"), "fixture must produce a move proposal, or the move path is untested");

  const after = env.DB.query("SELECT id, division_id FROM teams ORDER BY id");
  assert.deepEqual(after, before, "the plan endpoint moved a team — it must only ever propose");
  assert.match(plan.data.note, /Nothing has moved/);
  env.DB.close();
});

test("accepting a move applies it; declining records it and changes nothing", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  const [open, a] = env.DB.query("SELECT id FROM divisions ORDER BY rank").map((d) => d.id);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id) VALUES (1,1,1,'Mover',${open}),(2,1,1,'Stayer',${open})`);

  const r = await call(env, "POST", "/api/admin/events/1/divisions/moves", {
    token, body: { decisions: [
      { team_id: 1, kind: "move_down", from_division_id: open, to_division_id: a, reason: "2 wins v median 6", status: "accepted", wins: 2 },
      { team_id: 2, kind: "move_down", from_division_id: open, to_division_id: a, reason: "3 wins v median 6", status: "rejected", wins: 3 },
    ] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 1);
  assert.equal(r.data.rejected, 1);
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=1").division_id, a);
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=2").division_id, open, "a declined move must not move anybody");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM division_moves").n, 2,
    "both decisions are recorded — the declined one is the answer to 'was this looked at?'");
  env.DB.close();
});

test("accepting a DROP does not change the team's division", async () => {
  // A dropped team still finished in the division it played in, and that is what belongs on a
  // results sheet. Dropping is about bracket play, not about relabelling their day.
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  const open = env.DB.one("SELECT id FROM divisions WHERE rank=1").id;
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id) VALUES (1,1,1,'Ninth',${open})`);
  await call(env, "POST", "/api/admin/events/1/divisions/moves", {
    token, body: { decisions: [{ team_id: 1, kind: "drop_from_bracket", from_division_id: open, reason: "9th, played 10", status: "accepted" }] },
  });
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=1").division_id, open);
  env.DB.close();
});

test("a member cannot reach any division route", async () => {
  const env = boot();
  await staff(env);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  for (const [m, path] of [
    ["GET", "/api/admin/events/1/divisions"],
    ["POST", "/api/admin/events/1/divisions"],
    ["GET", "/api/admin/events/1/divisions/plan"],
    ["POST", "/api/admin/events/1/divisions/assign"],
    ["POST", "/api/admin/events/1/divisions/moves"],
  ]) {
    const r = await call(env, m, path, { token: v.data.token, body: m === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${path} let a member through (${r.status})`);
  }
  env.DB.close();
});

test("the module is actually mounted (failure class 1)", () => {
  assert.match(IDX, /import \{ divisionRoutes, wireDivisions \} from "\.\/divisions\.js"/);
  assert.match(IDX, /wireDivisions\(wiredHelpers\)/);
  // v0.77.0: the `||` chain became an isolated dispatch TABLE, so the mount is a table entry.
  assert.match(IDX, /\["division",\s+divisionRoutes\],/,
    "divisionRoutes must appear in the dispatch table, not merely on an import line (§6.5)");
});

/* ================================ v0.75.0 — guards that were narrower than their subject ================================ */

test("two divisions in the same place are refused with a sentence, and nothing is written", async () => {
  /* `idx_divisions_event_rank` is UNIQUE, so the DATABASE always refused this. The route did not —
     it validated court overlaps carefully and never looked at the column beside them, then inserted
     one division at a time with no transaction. So the first row landed, the second hit the index,
     and the director got `500 Server error` plus a one-division layout they never asked for.
     Standards §8: errors are human sentences, not codes. */
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/divisions", {
    token, body: { divisions: [{ name: "Open", rank: 1 }, { name: "A", rank: 1 }, { name: "BB", rank: 3 }] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /both in place 1/);
  assert.match(r.data.error, /Open/, "the message must name the divisions, not just the rule");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM divisions").n, 0,
    "the layout was half-written before the refusal — a refusal must leave nothing behind");
  env.DB.close();
});

test("the same check catches a collision with a layout that already exists", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  const r = await call(env, "POST", "/api/admin/events/1/divisions", {
    token, body: { divisions: [{ name: "Late entry", rank: 2 }] },
  });
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.match(r.data.error, /already in place 2/);
  assert.match(r.data.error, /replace/, "the message must say how to get past it");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM divisions WHERE deleted_at IS NULL").n, 3);
  env.DB.close();
});

test("NC: distinct places are still accepted, and replace still relays the whole layout", async () => {
  // Without this, a route that rejected every layout would satisfy both tests above.
  const env = boot();
  const token = await staff(env);
  const first = await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM divisions WHERE deleted_at IS NULL").n, 3);

  // Replace reuses ranks 1-3, which are taken by the rows it is about to soft-delete. The unique
  // index is partial (WHERE deleted_at IS NULL), so this must succeed — the check must not have
  // widened into blocking the one path that legitimately reuses a rank.
  const again = await call(env, "POST", "/api/admin/events/1/divisions", {
    token, body: { ...THREE, replace: true },
  });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM divisions WHERE deleted_at IS NULL").n, 3);
  env.DB.close();
});

test("a team cannot be filed under a division belonging to another event", async () => {
  /* Nothing checked that the division id in the request was one of THIS event's. The write is
     org-scoped and event-scoped on the TEAM, so it looked safe — but the division did not have to
     be. The team then sits in a division that no screen for its own event lists, which to a director
     is indistinguishable from the team having been deleted. */
  const env = boot();
  const token = await staff(env);
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank) VALUES (77,1,2,'Foreign',1)");
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (1,1,1,'Mine')");

  const r = await call(env, "POST", "/api/admin/events/1/divisions/assign", {
    token, body: { assign: [{ team_id: 1, division_id: 77 }] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.match(r.data.error, /isn't part of this event/);
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=1").division_id, null,
    "nothing may be written when one pair in the batch is bad");
  env.DB.close();
});

test("and an accepted MOVE cannot point at another event's division either", async () => {
  // The same hole, reached through the propose-then-approve path instead of the assign path.
  const env = boot();
  const token = await staff(env);
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank) VALUES (77,1,2,'Foreign',1)");
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  const open = env.DB.one("SELECT id FROM divisions WHERE event_id=1 AND rank=1").id;
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id) VALUES (1,1,1,'Mine',${open})`);

  const r = await call(env, "POST", "/api/admin/events/1/divisions/moves", {
    token, body: { decisions: [
      { team_id: 1, kind: "move_down", from_division_id: open, to_division_id: 77, reason: "x", status: "accepted" },
    ] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=1").division_id, open);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM division_moves").n, 0,
    "not even the audit row, since the decision was never valid to record");
  env.DB.close();
});

test("NC: a legitimate assign and a legitimate move both still go through", async () => {
  // The control for the two tests above. If the new check rejected every division id, they would
  // pass while the feature was dead.
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/divisions", { token, body: THREE });
  const [open, a] = env.DB.query("SELECT id FROM divisions WHERE event_id=1 ORDER BY rank").map((d) => d.id);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name) VALUES (1,1,1,'T1'),(2,1,1,'T2')`);

  const asg = await call(env, "POST", "/api/admin/events/1/divisions/assign", {
    token, body: { assign: [{ team_id: 1, division_id: open }, { team_id: 2, division_id: open }] },
  });
  assert.equal(asg.status, 200, JSON.stringify(asg.data));
  assert.equal(asg.data.moved, 2);

  const mv = await call(env, "POST", "/api/admin/events/1/divisions/moves", {
    token, body: { decisions: [
      { team_id: 1, kind: "move_down", from_division_id: open, to_division_id: a, reason: "x", status: "accepted" },
    ] },
  });
  assert.equal(mv.status, 200, JSON.stringify(mv.data));
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=1").division_id, a);

  // Clearing a division (null) must also still work — it is not a division id to validate.
  const clear = await call(env, "POST", "/api/admin/events/1/divisions/assign", {
    token, body: { assign: [{ team_id: 2, division_id: null }] },
  });
  assert.equal(clear.status, 200, JSON.stringify(clear.data));
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=2").division_id, null);
  env.DB.close();
});
