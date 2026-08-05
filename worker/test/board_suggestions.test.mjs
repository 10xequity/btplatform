/* Boomtown Platform — seeding suggestions (roadmap §-1b W-D)
   File: worker/test/board_suggestions.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.95.0

   Guards docs/2026-08-05_spec_seeding-suggestions_v1_0.md §5. The load-bearing properties, in the
   order they would do damage if they broke:

   1. THIS FEATURE WRITES NOTHING. A suggestion that moved a team would be the formula the owner
      explicitly refused. Asserted by recording every SQL statement the request prepares, so even a
      no-op `UPDATE teams SET pool_id=pool_id` is caught — NC-3 proves that detector fires.

   2. IT MUST NOT READ `standings.rank`. `rank` is an event-wide POOL-PLAY finish written across all
      divisions together (tournaments.js refreshStandings), and live D1 *looks* per-division only
      because sandbox.js hand-writes standings blocks. The fixture therefore sets `rank` to a value
      that DISAGREES with pool play in every case that matters, so a module reading `rank` fails here.

   3. ABSENCE PRODUCES SILENCE. A first event has no history, and a panel that explains its own
      emptiness would say so on every first event forever.

   The fixture is deliberately built so all FOUR kinds fire. divisions.test.mjs:296-310 records a
   fixture that produced only one kind and therefore never exercised the engine that produced
   another; a no-write assertion over a payload that proposed nothing is a vacuous no-write
   assertion. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const MOD_URL = new URL("../src/board_suggest.js", import.meta.url);
const MOD = readFileSync(MOD_URL, "utf8");
/* Comments stripped, because every assertion below is about what the module DOES. A guard's own
   explanation of a rule setting off the check for that rule has happened four times now across
   v0.85.0–v0.95.0 — the module's comment saying it invents no "N Co" taxonomy tripped the check for
   an invented "N Co" taxonomy. The stripper has its own control at the bottom of this file. */
const MOD_CODE = MOD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const PBJS = readFileSync(new URL("../../web/assets/admin-pool-board.js", import.meta.url), "utf8");
const PBHTML = readFileSync(new URL("../../web/admin-pool-board.html", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/* ---------------------------------------------------------------- the fixture ------------------ */

/* People are named so that A8 has something real to look for. No team name contains any of these,
   which is what makes "no suggestion text names a person" a test rather than a coincidence. */
const PEOPLE = [
  "Ada Lovelace", "Grace Hopper", "Alan Kay", "Barbara Liskov", "Edsger Dijkstra",
  "Katherine Johnson", "Radia Perlman", "Frances Allen", "Leslie Lamport", "Margaret Hamilton",
  // 11 and 12 exist so that two assertions can be about ONE claim each. Both were originally folded
  // into people who already held a first place elsewhere, which made "an unscored final credits
  // nobody" and "a future event is not history" pass for the wrong reason — the team was credited
  // through a second, older result the test never mentioned.
  "Donald Knuth",       // 11 — wins a bracket final and has no other result, ever
  "Vint Cerf",          // 12 — wins the FUTURE event and has no other result, ever
];

/**
 * A board with history. Pool sizes are SEVEN on purpose: the 6-11 suppressor needs the source pool
 * to survive losing a team (7-1=6) and the target to survive gaining one (7+1=8), so seven is the
 * smallest size at which any suggestion is allowed to be made at all.
 *
 * @param {object} o
 * @param {boolean} o.history  seed past events at all (false = a first-ever event)
 * @param {number}  o.poolSize teams per pool (6 forces every suggestion to be suppressed)
 */
function boot({ history = true, poolSize = 7 } = {}) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");

  // Contacts. 1-10 are the named people who carry history; 900+ are filler captains with a city.
  PEOPLE.forEach((n, i) => DB.exec(
    `INSERT INTO contacts (id, org_id, email, full_name, city)
     VALUES (${i + 1},1,'p${i + 1}@bt.test','${n}','Fountain')`));

  // ---- the event being seeded ----
  DB.exec(`INSERT INTO events (id, org_id, type, name, status, court_count, starts_at)
           VALUES (1,1,'tournament','TEST 12-Court Classic','published',12,'2026-12-01 09:00:00')`);
  DB.exec(`INSERT INTO divisions (id, org_id, event_id, name, rank) VALUES
             (10,1,1,'Open',1), (20,1,1,'A',2), (30,1,1,'BB',3)`);
  DB.exec(`INSERT INTO pools (id, org_id, event_id, division_id, name, sort_order) VALUES
             (100,1,1,10,'Pool A',1), (101,1,1,10,'Pool B',2),
             (200,1,1,20,'Pool A',3), (201,1,1,20,'Pool B',4),
             (300,1,1,30,'Pool A',5), (301,1,1,30,'Pool B',6)`);

  // Current teams, seven per pool. Ids are 5000 + (pool offset × 10) + index, which keeps them clear
  // of the 2000-2799 block the past events use — an overlap here is a UNIQUE constraint, not a
  // subtle wrong answer, but the arithmetic is stated because it is the reason the ranges are odd.
  /* Open's Pool A is deliberately MIXED so that Pueblo is the unambiguous largest group in the
     division. An even 7/7 split between two cities is a tie for "largest", and a tie is the wrong
     thing for a fixture to rest on — it makes the assertion depend on which city the module happens
     to sort first. (The module now breaks that tie by name, but the fixture should not need it to.)
     A and BB are single-city on purpose: the area signal must NOT fire there, because a group split
     evenly across two pools is already spread. */
  const CITY = { 100: "fountain", 101: "pueblo", 200: "aurora", 201: "aurora", 300: "denver", 301: "denver" };
  const cityFor = (pool, i) => (pool === 100 && i < 3 ? "denver" : CITY[pool]);
  let cid = 900;
  const teamsIn = {};
  for (const pool of [100, 101, 200, 201, 300, 301]) {
    teamsIn[pool] = [];
    for (let i = 0; i < poolSize; i++) {
      const id = 5000 + (pool - 100) * 10 + i;
      teamsIn[pool].push(id);
      cid++;
      DB.exec(`INSERT INTO contacts (id, org_id, email, full_name, city)
               VALUES (${cid},1,'f${cid}@bt.test','Filler ${cid}','${cityFor(pool, i)}')`);
      const div = pool < 200 ? 10 : pool < 300 ? 20 : 30;
      DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id, pool_id, captain_contact_id, board_order)
               VALUES (${id},1,1,'TEST Squad ${id}',${div},${pool},${cid},${i})`);
    }
  }
  if (!history) return { env: envOf(DB), DB, teamsIn };

  /* ---- past events ----
     Event 2: 30 days ago, completed. Two divisions, so tiers differ and the strength signal has a
     gap to find. Event 3: 60 days ago, completed, and the champion trap lives here.
     Event 4: FIVE DAYS IN THE FUTURE and `in_progress` — the C-2 trap. Live D1 really does hold
     three of these, and a history filter written on `status` alone reads them as the past. */
  DB.exec(`INSERT INTO events (id, org_id, type, name, status, court_count, starts_at) VALUES
    (2,1,'tournament','TEST Spring Slam','completed',12,datetime('now','-30 days')),
    (3,1,'tournament','TEST Winter Jam','completed',12,datetime('now','-60 days')),
    (4,1,'tournament','TEST Next Week','in_progress',12,datetime('now','+5 days'))`);
  DB.exec(`INSERT INTO divisions (id, org_id, event_id, name, rank) VALUES
    (40,1,2,'Open',1), (41,1,2,'BB',2), (42,1,3,'Open',1), (50,1,4,'Open',1)`);

  /* A past team, its standings row, and its captain.
     `rank` is written to DISAGREE with pool play wherever the two can be told apart — that is the
     whole point of C-1. A module that read `rank` would get a different answer here. */
  const pastTeam = (id, ev, div, captain, wins, rank, diff = wins * 4, pf = 100 + wins) => {
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id, captain_contact_id)
             VALUES (${id},1,${ev},'TEST Old ${id}',${div},${captain})`);
    DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, rank)
             VALUES (1,${ev},${id},${wins},${6 - wins},${diff},${pf},${rank})`);
  };

  // Event 2, division 40 "Open" (tier 400) — four teams, so placement runs 1..4.
  pastTeam(2000, 2, 40, 1, 6, 4);          // Ada — 1st on pool play, rank says 4th
  pastTeam(2001, 2, 40, 2, 4, 3);          // Grace — 2nd
  pastTeam(2002, 2, 40, 3, 2, 2);          // Alan  — 3rd
  pastTeam(2003, 2, 40, 4, 0, 1);          // Barbara — LAST on pool play, rank says 1st
  // Event 2, division 41 "BB" (tier 200) — the low end of the strength gap.
  pastTeam(2010, 2, 41, 5, 6, 1);          // Edsger
  pastTeam(2011, 2, 41, 6, 4, 2);          // Katherine
  pastTeam(2012, 2, 41, 7, 2, 3);          // Radia
  pastTeam(2013, 2, 41, 8, 0, 4);          // Frances

  // Event 3, division 42 "Open" — THE CHAMPION TRAP.
  pastTeam(2600, 3, 42, 9, 0, 1);          // Leslie — rank=1 but placed LAST, and LOSES the final
  pastTeam(2601, 3, 42, 10, 6, 4);         // Margaret — placed 1st, rank says 4th
  pastTeam(2602, 3, 42, 11, 2, 3);         // Knuth — placed 3rd but WINS the final, and that is his
                                           //   only result anywhere: the bracket is the whole claim
  pastTeam(2603, 3, 42, 2, 1, 2);
  // bracket_round = 1 IS the final (brackets.js). Scored, and not a tie: without `score_a <> score_b`
  // a drawn final would silently credit team_b through the ELSE branch.
  DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id,
                                score_a, score_b, bracket_round, bracket_slot)
           VALUES (1,3,'final',9,1,2600,2602,15,21,1,1)`);

  // Event 4 — FUTURE. Vint's only result anywhere is this first place, so a module that counted it
  // would be caught by exactly one assertion and nothing else could rescue the team.
  DB.exec(`INSERT INTO teams (id, org_id, event_id, name, division_id, captain_contact_id)
           VALUES (2700,1,4,'TEST Future Winner',50,12), (2701,1,4,'TEST Future B',50,4),
                  (2702,1,4,'TEST Future C',50,5)`);
  DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, rank) VALUES
             (1,4,2700,6,0,24,120,1), (1,4,2701,3,3,0,100,2), (1,4,2702,0,6,-24,80,3)`);

  /* ---- linking history to the board ----
     Every link is a ROSTER row, because history resolves through people, never through a team name. */
  const member = (team, contact, email = null, sub = 0) => DB.exec(
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email, is_sub)
     VALUES (1,${team},${contact == null ? "NULL" : contact},'roster',${email == null ? "NULL" : `'${email}'`},${sub})`);

  const P = teamsIn;
  // Open / Pool A — the winners cluster, and every branch of "won before" in one pool.
  member(P[100][0], 10);                     // Margaret: placed 1st at event 3 → WINNER (not rank)
  member(P[100][1], 11);                     // Knuth: won the final at event 3 → WINNER (champion only)
  member(P[100][2], 9);                      // Leslie: rank=1 but placed last AND lost the final → NOT
  member(P[100][3], 12);                     // Vint: 1st at the FUTURE event 4 → NOT (C-2)
  // Identity, resolved rather than split: no contact_id, and the address differs in CASE from the one
  // on `contacts`. `contacts.email` is COLLATE NOCASE, so this is still one person. Ada placed FIRST
  // at event 2, so this row is the only thing that can credit this team.
  member(P[100][4], null, "P1@BT.TEST");     // Ada: one person, reached by email rather than by id
  // …and a PADDED address deliberately does not resolve. Neither side of the join is wrapped in
  // trim(), because that would defeat idx_contacts_org_email for every lookup to rescue a case that
  // should be fixed on the way in. P[100][5] therefore stays uncredited, and the test below says so
  // out loud rather than leaving it as a silent gap.
  member(P[100][5], null, "  P1@BT.TEST  "); // Ada again, unreachable — a stated limit, not a bug

  // A / Pool A vs Pool B — the strength gap. Open finishers (tier 400) against BB finishers (200).
  member(P[200][0], 1); member(P[200][1], 2); member(P[200][2], 3);
  member(P[201][0], 5); member(P[201][1], 6); member(P[201][2], 7);

  // BB / Pool A — two current teams whose people keep sharing a roster. Two DISTINCT past rosters,
  // each holding one person from each team, so the pair counts twice and not once per person-pair.
  DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id)
           VALUES (2500,1,2,'TEST Old Friends I',NULL), (2501,1,3,'TEST Old Friends II',NULL)`);
  member(2500, 4); member(2500, 8);
  member(2501, 4); member(2501, 8);
  member(P[300][0], 4);
  member(P[300][1], 8);

  // A sub on a past roster, and a sub on the board. Owner 2026-08-05: subs are a non-issue for
  // tournaments, so neither may become a previous winner or a friend.
  member(2000, 6, null, 1);
  member(P[301][0], 6, null, 1);

  return { env: envOf(DB), DB, teamsIn };
}

const envOf = (DB) => ({ DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN });

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

/** Every statement the code under test prepares, so a write is caught even when it changes nothing. */
function recordSql(env) {
  const seen = [];
  const real = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) => { seen.push(sql); return real(sql); };
  return seen;
}
const WRITES = /^\s*(insert|update|delete|replace|drop|alter|create|truncate)\b/i;
const writesIn = (seen) => seen.filter((s) => WRITES.test(s));

const kindsOf = (data) => new Set((data.suggestions || []).map((s) => s.kind));
const oneOf = (data, kind) => (data.suggestions || []).find((s) => s.kind === kind);

/* ---------------------------------------------------------------- A1 ---------------------------- */

test("A1 — drawing the board proposes without writing anything at all", async () => {
  const { env, DB } = boot();
  const token = await staff(env);
  const before = {
    teams: DB.query("SELECT id, pool_id, division_id, board_order, note, updated_at FROM teams ORDER BY id"),
    standings: DB.query("SELECT event_id, team_id, wins, rank, updated_at FROM standings ORDER BY event_id, team_id"),
  };
  const seen = recordSql(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // Not vacuous: the payload genuinely proposed something, in every kind the module can produce.
  assert.deepEqual([...kindsOf(r.data)].sort(),
    ["split_repeat", "spread_area", "spread_strength", "spread_winners"],
    `the fixture stopped exercising every signal — a no-write assertion over an empty payload proves nothing.\n${JSON.stringify(r.data.suggestions, null, 2)}`);
  assert.deepEqual(writesIn(seen), [], "drawing a board must not write");
  assert.deepEqual(DB.query("SELECT id, pool_id, division_id, board_order, note, updated_at FROM teams ORDER BY id"), before.teams);
  assert.deepEqual(DB.query("SELECT event_id, team_id, wins, rank, updated_at FROM standings ORDER BY event_id, team_id"), before.standings);
  DB.close();
});

/* ---------------------------------------------------------------- A2 ---------------------------- */

/* The spec's §5 A2 says a first event ever returns `suggestions: []` flat. That is very slightly too
   broad, and the spec is the thing that is wrong: its own §2 records the area signal as reading the
   CURRENT event only, so same-area clustering is knowable on a first event and worth saying. The
   invariant this pair of tests holds instead is the one that actually matters — *history* produces
   nothing without history, and absence never produces a sentence about itself. */
test("A2 — a first event ever has no history-derived suggestion, and says nothing about why", async () => {
  const { env, DB } = boot({ history: false });
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const kind of ["spread_winners", "spread_strength", "split_repeat"]) {
    assert.equal(oneOf(r.data, kind), undefined, `${kind} fired with no past event to read`);
  }
  // The four original keys are untouched: a fifth key must not reshape the payload it joined.
  assert.equal(r.data.divisions.length, 3);
  assert.equal(r.data.workspace.length, 0);
  assert.deepEqual(r.data.loose_pools, []);
  assert.equal(r.data.event.id, 1);
  assert.ok(!/not enough|insufficient|no history|unable|couldn't work out/i.test(JSON.stringify(r.data)),
    "absence must produce silence — a panel that explains its own emptiness does it on every new event forever");
  DB.close();
});

test("A2b — with nothing knowable at all, the key is an empty array and not an explanation", async () => {
  const { env, DB } = boot({ history: false });
  env.DB.exec("UPDATE contacts SET city=NULL");     // no history AND no area: the emptiest real case
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.deepEqual(r.data.suggestions, []);
  assert.equal(r.status, 200);
  DB.close();
});

test("A2c — the panel is hidden when there is nothing to say, and ships no empty-state copy", () => {
  assert.match(PBHTML, /<section id="pbSug"[^>]*\shidden\b/, "the panel must ship hidden");
  assert.match(PBJS, /if \(!items\.length\) \{ panel\.hidden = true;/, "an empty list must hide the panel, not fill it");
  // Comments stripped FIRST. A guard's own explanation of a rule is the commonest way it trips over
  // itself — this file's earlier draft failed here on a comment saying there is no empty state.
  const shipped = PBJS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/no suggestions|nothing to suggest|no ideas/i.test(shipped), "there must be no empty-state copy at all");
  // …and the stripping gets its own control in BOTH directions, so it cannot become a quiet way of
  // switching the check off. The phrase really is in the file, as a comment, and really is gone once
  // comments are removed — while the code itself survives.
  assert.ok(/no suggestions/i.test(PBJS), "the comment this control relies on moved — it now proves nothing");
  assert.match(shipped, /renderSuggestions/, "the stripper ate the code as well, so the check above was vacuous");
});

/* ---------------------------------------------------------------- A3, A4, A5, A6 ---------------- */

test("A3/A4/A5/A6 — placement is recomputed per division; rank, ties, future events and split identities all handled", async () => {
  const { env, DB, teamsIn } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const w = oneOf(r.data, "spread_winners");
  assert.ok(w, `spread_winners did not fire: ${JSON.stringify(r.data.suggestions, null, 2)}`);
  const credited = new Set(w.team_ids);

  // A5 — placement WITHIN a division, not `standings.rank`. Margaret's old team placed first on pool
  // play and carries rank=4; Leslie's carries rank=1 and placed LAST. A module reading `rank` would
  // return exactly the opposite pair, which is why both halves are asserted.
  assert.ok(credited.has(teamsIn[100][0]), "a team whose player finished first on pool play must count");
  assert.ok(!credited.has(teamsIn[100][2]), "standings.rank=1 must NOT count as a division win — rank is an event-wide pool finish");

  // A4 — the champion trap. Ada placed third and won the scored final: credited. Leslie held rank=1
  // and lost that same final: not credited, on either ground.
  assert.ok(credited.has(teamsIn[100][1]), "winning a scored bracket final must count");

  // A3 — a future-dated in_progress event is not history, however cleanly its team won.
  assert.ok(!credited.has(teamsIn[100][3]),
    "an event starting in five days is not the past — `status` alone does not identify history");

  // A6 — one person, not two. No contact_id on the past roster, and the address differs in case;
  // `contacts.email` is COLLATE NOCASE, so it resolves to the same person.
  assert.ok(credited.has(teamsIn[100][4]), "a player linked only by email must resolve to the same person");
  DB.close();
});

test("A6b — a whitespace-padded address does NOT resolve, and that is a recorded trade, not a bug", async () => {
  const { env, DB, teamsIn } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const w = oneOf(r.data, "spread_winners");
  assert.ok(!new Set(w.team_ids).has(teamsIn[100][5]),
    "if padded addresses now resolve, the join gained a trim() — check whether idx_contacts_org_email still gets used");
  // The reason, pinned so the trade cannot be quietly reversed in one direction only.
  assert.ok(!/trim\(cx\.email\)|lower\(cx\.email\)/.test(MOD_CODE),
    "wrapping the contacts side of the join defeats idx_contacts_org_email for every lookup");
  DB.close();
});

test("A4b — an UNSCORED final credits nobody, which is live D1's real state today", async () => {
  const { env, DB, teamsIn } = boot();
  env.DB.exec("UPDATE matches SET score_a=NULL, score_b=NULL WHERE bracket_round=1");
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const w = oneOf(r.data, "spread_winners");
  // Margaret still placed first on pool play, so the signal survives; Ada's only claim was the final.
  assert.ok(w.team_ids.includes(teamsIn[100][0]), "a pool-play first place does not depend on the bracket");
  assert.ok(!w.team_ids.includes(teamsIn[100][1]), "an unscored final must credit nobody");
  DB.close();
});

test("A4c — a drawn final credits nobody either, rather than crediting team_b by accident", async () => {
  const { env, DB, teamsIn } = boot();
  env.DB.exec("UPDATE matches SET score_a=21, score_b=21 WHERE bracket_round=1");
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const w = oneOf(r.data, "spread_winners");
  assert.ok(!w.team_ids.includes(teamsIn[100][1]),
    "without `score_a <> score_b` a tie falls through the ELSE branch and silently crowns team_b");
  DB.close();
});

test("A5b — a three-way tie for first credits nobody", async () => {
  const { env, DB, teamsIn } = boot();
  // Make the top of event 3's Open division a dead heat on every tiebreak the module uses.
  env.DB.exec(`UPDATE standings SET wins=6, point_diff=24, points_for=106
                WHERE event_id=3 AND team_id IN (2600,2601,2602)`);
  env.DB.exec("UPDATE matches SET score_a=NULL, score_b=NULL WHERE bracket_round=1");
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const w = oneOf(r.data, "spread_winners");
  const credited = new Set(w ? w.team_ids : []);
  for (const t of [teamsIn[100][0], teamsIn[100][1], teamsIn[100][2]]) {
    assert.ok(!credited.has(t), "an unbroken tie for first must credit nobody rather than pick one");
  }
  DB.close();
});

/* ---------------------------------------------------------------- A7 ---------------------------- */

test("A7 — the 6-11 range suppresses a suggestion and never blocks a save", async () => {
  const { env, DB } = boot({ poolSize: 6 });
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(r.status, 200);
  // The history is identical to A1's; only the pool sizes changed. Every implied move would take a
  // pool of six down to five, so every signal must fall silent.
  assert.deepEqual(r.data.suggestions, [],
    `a move that would take a pool under six must not be suggested:\n${JSON.stringify(r.data.suggestions, null, 2)}`);

  // And the board still saves, with the pools exactly as small as the director made them.
  const save = await call(env, "POST", "/api/admin/events/1/board", {
    token,
    body: { pools: [{ id: 100, division_id: 10, name: "Pool A", team_ids: DB.query("SELECT id FROM teams WHERE pool_id=100 ORDER BY id").map((t) => t.id) }] },
  });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.ok(!/cannot|refuse|too small|at least/i.test(JSON.stringify(save.data)), "the size preference is advisory");
  DB.close();
});

/* ---------------------------------------------------------------- A8 ---------------------------- */

test("A8 — a suggestion names teams, pools and counts, and never a person", async () => {
  const { env, DB } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const text = (r.data.suggestions || []).map((s) => s.text).join("\n");
  assert.ok(text.length > 0, "nothing was proposed, so this assertion would pass vacuously");

  // Every full_name in the fixture, not a hand-written list — a name added to the fixture is covered
  // the moment it is added.
  for (const row of DB.query("SELECT full_name FROM contacts WHERE full_name IS NOT NULL")) {
    assert.ok(!text.includes(row.full_name), `a suggestion named a person: ${row.full_name}\n${text}`);
    const first = row.full_name.split(" ")[0];
    assert.ok(!new RegExp(`\\b${first}\\b`).test(text), `a suggestion named a person: ${first}\n${text}`);
  }
  // The module itself must own this rule: names.test.mjs's one-name check reads only live.js,
  // brackets.js and divisions.js, so a hand-rolled name rule in a new module passes it green.
  assert.ok(!/full_name|captain_name|personName|member_name/.test(MOD_CODE),
    "board_suggest.js must not select or render a person's name at all");
  DB.close();
});

test("A8b — a sub is neither a previous winner nor a friend (owner: subs are a non-issue for tournaments)", async () => {
  const { env, DB, teamsIn } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const ids = new Set((r.data.suggestions || []).flatMap((s) => s.team_ids));
  assert.ok(!ids.has(teamsIn[301][0]), "a sub's history must not reach the board");
  assert.match(MOD_CODE, /is_sub = 0/, "the roster reads must exclude subs explicitly");
  DB.close();
});

/* ---------------------------------------------------------------- the other three kinds -------- */

test("the strength signal compares divisions, states the gap in divisions, and leaks no raw number", async () => {
  const { env, DB } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const s = oneOf(r.data, "spread_strength");
  assert.ok(s, `spread_strength did not fire: ${JSON.stringify(r.data.suggestions, null, 2)}`);
  assert.match(s.text, /^A —/, "it must name the division it is talking about");
  assert.match(s.text, /divisions?' worth/, "the gap is stated in divisions, which a director already understands");
  // The internal score is a unit nobody has been taught. It must not appear on screen.
  assert.ok(!/\b[2-9]\d\d\b/.test(s.text), `a raw strength number leaked into the copy: ${s.text}`);
  DB.close();
});

test("two teams who keep sharing a roster are counted once per roster, not once per pair of people", async () => {
  const { env, DB, teamsIn } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const f = oneOf(r.data, "split_repeat");
  assert.ok(f, `split_repeat did not fire: ${JSON.stringify(r.data.suggestions, null, 2)}`);
  assert.deepEqual(f.team_ids.slice().sort((a, b) => a - b), [teamsIn[300][0], teamsIn[300][1]]);
  assert.match(f.text, /twice before/, "two shared rosters is twice — not four times, once per person-pair");
  assert.equal(f.id, `f:${Math.min(teamsIn[300][0], teamsIn[300][1])}-${Math.max(teamsIn[300][0], teamsIn[300][1])}`,
    "the id must be unordered, or the same pair produces two mirrored suggestions");
  DB.close();
});

test("the area signal groups on the stored city and invents no region taxonomy", async () => {
  const { env, DB } = boot();
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const a = oneOf(r.data, "spread_area");
  assert.ok(a, `spread_area did not fire: ${JSON.stringify(r.data.suggestions, null, 2)}`);
  assert.match(a.text, /Pueblo/, "the city is named as stored");
  // No alias map, no abbreviation expansion, no "N Co" — that needs an owner mapping first, and
  // guessing one would encode a taxonomy nobody has given.
  assert.ok(!/\bN Co\b|northern colorado|front range/i.test(MOD_CODE), "there must be no invented region taxonomy");
  DB.close();
});

test("a city spelled two ways stays two groups — the signal understates rather than guessing", async () => {
  const { env, DB } = boot();
  env.DB.exec("UPDATE contacts SET city='Ft Collins' WHERE city='pueblo' AND id % 2 = 0");
  env.DB.exec("UPDATE contacts SET city='Fort Collins' WHERE city='pueblo'");
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  const a = oneOf(r.data, "spread_area");
  // Whatever it now says, it must not have merged the two spellings into one group of seven.
  if (a) assert.ok(!/\b7 teams from (Fort|Ft) Collins/.test(a.text), "two spellings must not silently merge");
  assert.equal(r.status, 200);
  DB.close();
});

/* ---------------------------------------------------------------- A9 ---------------------------- */

test("A9 — the panel sits between the board and the workspace, and is wired outside render()", () => {
  const iBoard = PBHTML.indexOf('id="pbBoard"');
  const iSug = PBHTML.indexOf('id="pbSug"');
  const iWork = PBHTML.indexOf('class="pb-workspace"');
  assert.ok(iBoard > 0 && iSug > 0 && iWork > 0, "all three landmarks must exist");
  assert.ok(iBoard < iSug && iSug < iWork,
    "the panel must sit outside #pbBoard (render() rewrites it, fail() replaces it) and above the workspace");

  // wire() runs at the end of every render() and already stacks handlers on the never-recreated
  // #pbWork node. A panel wired there would reproduce that leak exactly.
  const wire = PBJS.slice(PBJS.indexOf("function wire()"), PBJS.indexOf("function onTileKey"));
  assert.ok(wire.length > 100, "the wire() slice moved — this assertion is reading the wrong code");
  assert.ok(!/pbSug/.test(wire), "the suggestions panel must not be wired from wire()");
  const render = PBJS.slice(PBJS.indexOf("function render()"), PBJS.indexOf("function wire()"));
  assert.ok(!/renderSuggestions/.test(render), "and must not be redrawn from render()");
  assert.match(PBJS, /tempSeq = -1;\s*\n\s*renderSuggestions\(\);/, "it is drawn from ingest(), where new server data arrives");

  // The reason a suggestion is being made is not small print.
  assert.match(PBHTML, /\.pb-sug-text \{[^}]*font-size: 13px/, ".pb-sug-text must be 13px");
  // Gold is a rule here, never ink.
  assert.match(PBHTML, /\.pb-sug \{[^}]*border-left: 3px solid var\(--accent\)/, "the gold edge is a border");
  assert.ok(!/\.pb-sug[a-z-]* \{[^}]*color: var\(--accent\)/.test(PBHTML), "gold must never be text");
});

test("A9b — one delegated listener on the static list node, so re-rendering cannot stack handlers", () => {
  const adds = PBJS.match(/pbSugList"\)\.addEventListener/g) || [];
  assert.equal(adds.length, 1, "exactly one listener, attached once");
  assert.match(PBJS, /\$\("pbSugList"\)\.addEventListener\("click"/, "and it is delegated from the list");
  assert.match(PBJS, /data-sugshow|data-sughide/, "the delegate resolves its target from a data attribute");
});

/* ---------------------------------------------------------------- negative controls ------------- */

/** Write a mutated copy of the REAL module to a temp dir and import it. It has no imports of its own,
    so a copy behaves identically — and the tree is never touched. */
async function mutantOf(find, replace) {
  assert.ok(MOD.includes(find), `the mutation target moved: ${find} — this control was testing nothing`);
  const mutated = MOD.replace(find, replace);
  assert.notEqual(mutated, MOD, "the mutation did not apply");
  const dir = mkdtempSync(join(tmpdir(), "bt-nc-"));
  const file = join(dir, "board_suggest.mjs");
  writeFileSync(file, mutated);
  return (await import(pathToFileURL(file).href)).boardSuggestions;
}

/** The arguments loadBoard passes, read straight out of the fixture DB. */
function boardArgs(DB) {
  return {
    shaped: DB.query("SELECT id, name, pool_id, division_id FROM teams WHERE event_id=1 AND deleted_at IS NULL ORDER BY board_order, id"),
    divisions: DB.query("SELECT id, name, rank FROM divisions WHERE event_id=1 AND deleted_at IS NULL ORDER BY rank"),
    pools: DB.query("SELECT id, name, division_id, sort_order FROM pools WHERE event_id=1 AND deleted_at IS NULL ORDER BY sort_order"),
  };
}

test("NC-1 — a renamed column in the real module degrades to silence, it does not throw", async () => {
  const { env, DB } = boot();
  const { shaped, divisions, pools } = boardArgs(DB);
  // Sanity: unmutated, this fixture proposes something. Without this the control could pass because
  // the fixture went quiet for an unrelated reason.
  const { boardSuggestions } = await import("../src/board_suggest.js");
  assert.ok((await boardSuggestions(env, 1, 1, shaped, divisions, pools)).length > 0, "the fixture stopped proposing");

  const broken = await mutantOf("COALESCE(s.wins,0) AS wins", "COALESCE(s.winz,0) AS wins");
  const out = await broken(env, 1, 1, shaped, divisions, pools);
  const kinds = new Set(out.map((s) => s.kind));
  // It did not throw, and the two signals that needed that column went silent.
  for (const k of ["spread_winners", "spread_strength", "split_repeat"]) {
    assert.ok(!kinds.has(k), `${k} survived a column that no longer exists`);
  }
  // And the signal that never touched standings still answers — which is the per-signal isolation
  // being real rather than asserted. A blanket `[]` here would have hidden a module that collapses
  // whole the moment any one read fails.
  assert.ok(kinds.has("spread_area"), "a broken history read must not take the area signal down with it");
  DB.close();
});

test("NC-2 — a database that throws on every statement still returns a board", async () => {
  const { env, DB } = boot();
  const token = await staff(env);
  const real = env.DB.prepare.bind(env.DB);
  let calls = 0;
  // Only the suggestion module's reads are broken; loadBoard's own four reads must still work, or
  // this control would prove nothing about the fifth key specifically.
  env.DB.prepare = (sql) => {
    // Matched on fragments unique to THIS module. `JOIN contacts cap` was the first attempt and it
    // also matches names.js's shared CAPTAIN_JOIN, so it broke loadBoard's own teams read and the
    // control was proving that a 500 is a 500.
    if (/FROM events\s+JOIN teams|WITH me AS|m\.bracket_round = 1|lower\(trim\(cap\.city\)\)/.test(sql)) {
      calls++; throw new Error("D1 is down");
    }
    return real(sql);
  };
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.ok(calls > 0, "the stub was never reached — this control was testing nothing");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.suggestions, []);
  assert.equal(r.data.divisions.length, 3, "the four original keys must survive the fifth one failing");
  assert.equal(r.data.event.id, 1);
  DB.close();
});

test("NC-3 — a single no-op write inserted into the real module is caught by A1's detector", async () => {
  const { env, DB } = boot();
  const seen = recordSql(env);
  // `SET pool_id=pool_id` changes no value, so a before/after snapshot alone would NOT catch it.
  // That is the point: the detector must see the statement, not just its effect.
  const writer = await mutantOf(
    "  const history = await loadHistory(env, orgId, eventId).catch(() => null);",
    "  await env.DB.prepare(\"UPDATE teams SET pool_id=pool_id WHERE org_id=?1\").bind(orgId).run();\n  const history = await loadHistory(env, orgId, eventId).catch(() => null);");
  const { shaped, divisions, pools } = boardArgs(DB);
  await writer(env, 1, 1, shaped, divisions, pools);
  assert.equal(writesIn(seen).length, 1,
    "A1's write detector did not see a propose-then-apply module — the no-write assertion cannot fail, so it proves nothing");
  assert.match(writesIn(seen)[0], /UPDATE teams/);
  DB.close();
});

test("NC-4 — the real module contains no write of any kind", () => {
  // The static half of A1. A guard that only watches one request cannot see a write on a path the
  // fixture never took.
  const code = MOD_CODE;
  // Matched as SQL statements, not as bare words: `\bREPLACE\b` also matches JavaScript's own
  // `.replace(`, which is how this control first reported a write that did not exist.
  const STATEMENTS = [
    /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
    /\bREPLACE\s+INTO\b/i, /\bDROP\s+(TABLE|INDEX|VIEW)\b/i, /\bALTER\s+TABLE\b/i,
  ];
  for (const re of STATEMENTS) assert.ok(!re.test(code), `board_suggest.js contains a write: ${re}`);
  // The mechanism, not just the vocabulary: a D1 write goes through .run(), and this module only
  // ever calls .all(). This is the assertion that would catch a write spelled some new way.
  assert.ok(!/\.run\(\)/.test(code), "a read-only module never calls .run()");
  assert.ok(!/audit\(/.test(code), "a read-only module has nothing to audit");
  // Proof the stripper did not simply eat everything.
  assert.match(code, /SELECT/, "the comment stripper removed the code as well — this check was vacuous");
});
