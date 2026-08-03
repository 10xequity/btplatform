/* Boomtown Platform — tryouts tests (cards, evaluations, team builder)
   File: worker/test/tryouts.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.60.0
   Pure decisions · source guards (§6.5/F-15 + org scope) · live routes on the in-memory harness.
   Every guard ships a negative control that mutates real input and proves it can fail. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { POSITIONS, parseList, cmToImperial, normalizeCard, normalizeEval, squadNeeds, rollUp }
  from "../src/tryouts.js";

const SRC = readFileSync(new URL("../src/tryouts.js", import.meta.url), "utf8");
const INDEX_SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/* ============================ 1. pure decisions ============================ */

test("parseList accepts JSON, CSV and arrays; drops anything off the whitelist", () => {
  assert.deepEqual(parseList('["OH","MB"]', POSITIONS), ["OH", "MB"]);
  assert.deepEqual(parseList("OH, MB", POSITIONS), ["OH", "MB"]);
  assert.deepEqual(parseList(["S", "S", "L"], POSITIONS), ["S", "L"], "duplicates collapse");
  assert.deepEqual(parseList(["OH", "GOALKEEPER"], POSITIONS), ["OH"], "an unknown position is dropped, not stored");
  assert.deepEqual(parseList(null, POSITIONS), []);
  assert.deepEqual(parseList("not json at all", POSITIONS), []);
});

test("NC-1: parseList caps the list — a paste bomb cannot become 500 positions", () => {
  assert.equal(parseList(Array.from({ length: 99 }, (_, i) => "P" + i), null, 6).length, 6);
});

test("cmToImperial speaks the room's language", () => {
  assert.equal(cmToImperial(180), "5'11\"");
  assert.equal(cmToImperial(152), "5'0\"");
  assert.equal(cmToImperial(null), null);
  assert.equal(cmToImperial("nonsense"), null);
});

test("normalizeCard rejects a height that is obviously wrong", () => {
  assert.equal(normalizeCard({ height_cm: 511 }).ok, false, "5'11\" typed as 511 must be caught");
  assert.equal(normalizeCard({ height_cm: 10 }).ok, false);
  assert.equal(normalizeCard({ height_cm: 180 }).ok, true);
  assert.equal(normalizeCard({ height_cm: "" }).value.height_cm, null, "blank is allowed");
});

test("normalizeEval holds the 1–5 scale and the three verdicts", () => {
  assert.equal(normalizeEval({ rating: 3, verdict: "offer" }).value.rating, 3);
  assert.equal(normalizeEval({ rating: 0 }).ok, false);
  assert.equal(normalizeEval({ rating: 6 }).ok, false);
  assert.equal(normalizeEval({ rating: 2.5 }).ok, false);
  assert.equal(normalizeEval({ rating: "" }).value.rating, null, "blank rating is allowed — a coach may only want to write");
  assert.equal(normalizeEval({ verdict: "maybe" }).ok, false);
  assert.equal(normalizeEval({}).value.verdict, "undecided", "the safe default is undecided, never offer");
});

test("squadNeeds: full means headcount AND positions, not headcount alone", () => {
  const needs = { S: 1, MB: 2 };
  const nearly = squadNeeds(needs, [{ position: "OH" }, { position: "OH" }, { position: "MB" }], 3);
  assert.equal(nearly.filled, 3);
  assert.deepEqual(nearly.shortfall, { S: 1, MB: 1 });
  assert.equal(nearly.full, false, "a squad at headcount with no setter is not full — that is the whole point");

  const done = squadNeeds(needs, [{ position: "S" }, { position: "MB" }, { position: "MB" }], 3);
  assert.deepEqual(done.shortfall, {});
  assert.equal(done.full, true);
});

test("NC-2: a squad that meets positions but is under headcount is still not full", () => {
  const v = squadNeeds({ S: 1 }, [{ position: "S" }], 10);
  assert.deepEqual(v.shortfall, {});
  assert.equal(v.full, false, "1 of 10 with the setter filled must not report as a complete team");
});

test("rollUp reports the SPLIT and the RANGE, never an average", () => {
  const rows = [
    { contact_id: 1, full_name: "Alex P", rating: 5, verdict: "offer" },
    { contact_id: 1, full_name: "Alex P", rating: 2, verdict: "no_offer" },
    { contact_id: 1, full_name: "Alex P", rating: 4, verdict: "offer" },
  ];
  const [p] = rollUp(rows);
  assert.equal(p.evaluations, 3);
  assert.equal(p.offer, 2);
  assert.equal(p.no_offer, 1);
  assert.equal(p.split, "2/3 offer");
  assert.equal(p.rating_low, 2);
  assert.equal(p.rating_high, 5);
  // A mean of 3.67 would hide that one coach thought this player was a 2. That disagreement is
  // the single most useful thing on the page.
  assert.ok(!("average" in p) && !("mean" in p), "no averaged rating may appear");
});

test("NC-3: rollUp copes with a player nobody evaluated", () => {
  assert.deepEqual(rollUp([]), []);
  const [p] = rollUp([{ contact_id: 7, full_name: "Unseen", rating: null, verdict: null }]);
  assert.equal(p.evaluations, 0);
  assert.equal(p.split, "not evaluated");
  assert.equal(p.rating_low, null);
});

/* ============================ 2. source guards ============================ */

test("§6.5: the module is MOUNTED and WIRED (F-15)", () => {
  assert.ok(INDEX_SRC.includes("|| (await tryoutsRoutes(request, env, url, ctx))"),
    "tryoutsRoutes is imported but never dispatched — built-but-uncalled (failure class 1)");
  assert.match(INDEX_SRC, /wireTryouts\(wiredHelpers\)/);
});

test("NC-4: the mount gate can fail", () => {
  const mutated = INDEX_SRC.replace("|| (await tryoutsRoutes(request, env, url, ctx))", "|| false");
  assert.notEqual(mutated, INDEX_SRC, "mutation did not land — NC is vacuous");
  assert.ok(!mutated.includes("|| (await tryoutsRoutes(request, env, url, ctx))"));
});

test("every SQL statement is org-scoped (F-11)", () => {
  const literals = [
    ...(SRC.match(/`[^`]*`/gs) || []),
    ...(SRC.match(/"[^"\n]{25,}"/g) || []),
  ];
  const sql = literals.filter((t) => /FROM (tryout_|registrations|contacts)|INSERT INTO tryout_|UPDATE tryout_/i.test(t));
  assert.ok(sql.length >= 10, `guard floor: expected >=10 scoped statements, saw ${sql.length}`);
  for (const t of sql) {
    const bound = /org_id\s*=\s*\?|org_id=\?/.test(t);
    const insertScoped = /INSERT INTO \w+ \([^)]*\borg_id\b/i.test(t);
    const correlated = /\b\w+\.org_id\s*=\s*\w+\.org_id\b/.test(t);
    assert.ok(bound || insertScoped || correlated,
      `unscoped SQL — ${t.replace(/\s+/g, " ").slice(0, 100)}…`);
  }
});

test("the evaluator board returns only the CALLER's evaluation", () => {
  // Anchoring is the failure mode: if coach B can see coach A's note before writing, three
  // independent judgements collapse into one. The join must bind the caller's own contact id.
  const board = stripJs(SRC).slice(stripJs(SRC).indexOf("/board$"), stripJs(SRC).indexOf("/card/"));
  assert.match(board, /te\.evaluator_contact_id = \?3/,
    "the board's evaluation join is not filtered to the caller — every coach would see every note");
  assert.match(board, /me \? me\.id : 0/, "the caller's own contact id must be what is bound");
});

test("NC-5: the caller-only guard can fail", () => {
  const mutated = stripJs(SRC).replace("AND te.evaluator_contact_id = ?3", "");
  assert.ok(!/te\.evaluator_contact_id = \?3/.test(mutated),
    "with the filter stripped the guard must see it missing");
});

/* ============================ 3. live routes ============================ */

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8") + `
CREATE TABLE tryout_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL, positions TEXT NOT NULL DEFAULT '[]', age_groups TEXT NOT NULL DEFAULT '[]',
  height_cm INTEGER, prev_club TEXT, jersey_size TEXT, player_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE UNIQUE INDEX ux_tryout_profiles_live ON tryout_profiles (org_id, event_id, contact_id) WHERE deleted_at IS NULL;
CREATE TABLE tryout_evaluations (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL, evaluator_contact_id INTEGER NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)), notes TEXT,
  verdict TEXT NOT NULL DEFAULT 'undecided' CHECK (verdict IN ('offer','no_offer','undecided')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE UNIQUE INDEX ux_tryout_eval_live ON tryout_evaluations (org_id, event_id, contact_id, evaluator_contact_id) WHERE deleted_at IS NULL;
CREATE TABLE tryout_squads (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
  name TEXT NOT NULL, age_group TEXT, colour TEXT, target_size INTEGER NOT NULL DEFAULT 10,
  needs_json TEXT NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE tryout_squad_members (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, squad_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL, position TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE UNIQUE INDEX ux_tryout_squad_member_live ON tryout_squad_members (org_id, contact_id, squad_id) WHERE deleted_at IS NULL;
`;
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec(`INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
           INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status) VALUES (1,1,'w','b','s','active');
           INSERT INTO events (id, org_id, type, name, status, starts_at)
             VALUES (1, 1, 'training', '15U Tryout', 'published', datetime('now','+3 days'));`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function signIn(env, email, role, name) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email=?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, '${role}')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='${role}'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1, ${u.id}, '${email}', '${name}')`);
  return { token: v.data.token, contactId: env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id };
}

/** A player who registered for the tryout. */
function registrant(env, name, email) {
  env.DB.exec(`INSERT INTO contacts (org_id, email, full_name) VALUES (1, '${email}', '${name}')`);
  const id = env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id;
  env.DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES (1, 1, ${id}, 'paid')`);
  return id;
}

test("live: a registrant appears on the evaluator board and a coach can judge them", async () => {
  const env = boot();
  const coach = await signIn(env, "coach@bt.test", "admin", "Coach One");
  const player = registrant(env, "Alex Player", "alex@bt.test");

  await call(env, "PUT", `/api/admin/tryouts/1/card/${player}`, {
    token: coach.token,
    body: { positions: ["OH", "RS"], age_groups: ["15U", "16U"], height_cm: 180, prev_club: "Front Range VBC" },
  });

  const board = await call(env, "GET", "/api/admin/tryouts/1/board", { token: coach.token });
  assert.equal(board.status, 200, JSON.stringify(board.data));
  const row = board.data.players.find((p) => p.contact_id === player);
  assert.ok(row, "the registrant did not reach the evaluator board");
  assert.deepEqual(row.positions, ["OH", "RS"]);
  assert.equal(row.height, "5'11\"");
  assert.equal(row.prev_club, "Front Range VBC");
  assert.equal(row.my_evaluation.verdict, "undecided", "an unjudged player defaults to undecided, never offer");

  const saved = await call(env, "PUT", `/api/admin/tryouts/1/eval/${player}`, {
    token: coach.token, body: { rating: 4, notes: "Great arm swing, needs serve receive reps.", verdict: "offer" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const after = await call(env, "GET", "/api/admin/tryouts/1/board", { token: coach.token });
  const mine = after.data.players.find((p) => p.contact_id === player).my_evaluation;
  assert.equal(mine.rating, 4);
  assert.equal(mine.verdict, "offer");
  assert.match(mine.notes, /arm swing/);
  env.DB.close();
});

test("live: one coach cannot see another coach's note before writing their own", async () => {
  const env = boot();
  const a = await signIn(env, "coacha@bt.test", "admin", "Coach A");
  const b = await signIn(env, "coachb@bt.test", "admin", "Coach B");
  const player = registrant(env, "Sam Setter", "sam@bt.test");

  await call(env, "PUT", `/api/admin/tryouts/1/eval/${player}`, {
    token: a.token, body: { rating: 5, notes: "Best setter here by a mile.", verdict: "offer" },
  });

  const boardB = await call(env, "GET", "/api/admin/tryouts/1/board", { token: b.token });
  const seen = boardB.data.players.find((p) => p.contact_id === player).my_evaluation;
  assert.equal(seen.notes, null, "coach B saw coach A's note — three judgements just became one");
  assert.equal(seen.rating, null);
  assert.equal(seen.verdict, "undecided");
  env.DB.close();
});

test("live: the director roll-up shows the split, including disagreement", async () => {
  const env = boot();
  const a = await signIn(env, "coacha@bt.test", "admin", "Coach A");
  const b = await signIn(env, "coachb@bt.test", "admin", "Coach B");
  const player = registrant(env, "Jo Hitter", "jo@bt.test");

  await call(env, "PUT", `/api/admin/tryouts/1/eval/${player}`, { token: a.token, body: { rating: 5, verdict: "offer" } });
  await call(env, "PUT", `/api/admin/tryouts/1/eval/${player}`, { token: b.token, body: { rating: 2, verdict: "no_offer" } });

  const sum = await call(env, "GET", "/api/admin/tryouts/1/summary", { token: a.token });
  const p = sum.data.players.find((q) => q.contact_id === player);
  assert.equal(p.evaluations, 2);
  assert.equal(p.split, "1/2 offer");
  assert.equal(p.rating_low, 2);
  assert.equal(p.rating_high, 5);
  env.DB.close();
});

test("live: a coach re-saving replaces their own row, never adds a second", async () => {
  const env = boot();
  const a = await signIn(env, "coacha@bt.test", "admin", "Coach A");
  const player = registrant(env, "Kim Libero", "kim@bt.test");
  for (const v of ["undecided", "offer", "no_offer"]) {
    await call(env, "PUT", `/api/admin/tryouts/1/eval/${player}`, { token: a.token, body: { verdict: v } });
  }
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM tryout_evaluations WHERE deleted_at IS NULL").n, 1,
    "re-saving created duplicate evaluations — the roll-up would then count one coach three times");
  assert.equal(env.DB.one("SELECT verdict FROM tryout_evaluations").verdict, "no_offer");
  env.DB.close();
});

test("live: the board moves a player between squads instead of duplicating them", async () => {
  const env = boot();
  const coach = await signIn(env, "coach@bt.test", "admin", "Coach One");
  const player = registrant(env, "Pat Middle", "pat@bt.test");

  const s1 = await call(env, "POST", "/api/admin/tryouts/1/squads", {
    token: coach.token, body: { name: "15U Blue", target_size: 2, needs: { S: 1, MB: 1 } },
  });
  const s2 = await call(env, "POST", "/api/admin/tryouts/1/squads", {
    token: coach.token, body: { name: "15U White", target_size: 2 },
  });
  assert.equal(s1.status, 200, JSON.stringify(s1.data));

  await call(env, "POST", `/api/admin/squads/${s1.data.squad_id}/assign`, { token: coach.token, body: { contact_id: player, position: "MB" } });
  await call(env, "POST", `/api/admin/squads/${s2.data.squad_id}/assign`, { token: coach.token, body: { contact_id: player, position: "MB" } });

  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM tryout_squad_members WHERE deleted_at IS NULL").n, 1,
    "the player is on two squads at once — two coaches would each think they had them");

  const board = await call(env, "GET", "/api/admin/tryouts/1/squads", { token: coach.token });
  const blue = board.data.squads.find((s) => s.name === "15U Blue");
  const white = board.data.squads.find((s) => s.name === "15U White");
  assert.equal(blue.members.length, 0);
  assert.equal(white.members.length, 1);
  assert.deepEqual(blue.shortfall, { S: 1, MB: 1 }, "Blue lost the player, so it needs the middle back");
  env.DB.close();
});

test("live: the director total aggregates what every squad still needs", async () => {
  const env = boot();
  const coach = await signIn(env, "coach@bt.test", "admin", "Coach One");
  const s1 = await call(env, "POST", "/api/admin/tryouts/1/squads", {
    token: coach.token, body: { name: "A", target_size: 1, needs: { S: 1, MB: 2 } },
  });
  await call(env, "POST", "/api/admin/tryouts/1/squads", {
    token: coach.token, body: { name: "B", target_size: 1, needs: { S: 1 } },
  });
  const p = registrant(env, "One Setter", "s1@bt.test");
  await call(env, "POST", `/api/admin/squads/${s1.data.squad_id}/assign`, { token: coach.token, body: { contact_id: p, position: "S" } });

  const board = await call(env, "GET", "/api/admin/tryouts/1/squads", { token: coach.token });
  assert.equal(board.data.totals.squads, 2);
  assert.equal(board.data.totals.placed, 1);
  assert.deepEqual(board.data.totals.shortfall, { MB: 2, S: 1 },
    "the club-wide gap must sum every squad — A still wants 2 middles, B still wants a setter");
  env.DB.close();
});

test("live: deleting a squad releases its players back to the pool", async () => {
  const env = boot();
  const coach = await signIn(env, "coach@bt.test", "admin", "Coach One");
  const s = await call(env, "POST", "/api/admin/tryouts/1/squads", { token: coach.token, body: { name: "Temp" } });
  const p = registrant(env, "Free Agent", "fa@bt.test");
  await call(env, "POST", `/api/admin/squads/${s.data.squad_id}/assign`, { token: coach.token, body: { contact_id: p } });

  const del = await call(env, "DELETE", `/api/admin/squads/${s.data.squad_id}`, { token: coach.token });
  assert.equal(del.status, 200);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM tryout_squad_members WHERE deleted_at IS NULL").n, 0,
    "a deleted squad stranded its members — the one-squad index would then block re-placing them");

  const s2 = await call(env, "POST", "/api/admin/tryouts/1/squads", { token: coach.token, body: { name: "Real" } });
  const re = await call(env, "POST", `/api/admin/squads/${s2.data.squad_id}/assign`, { token: coach.token, body: { contact_id: p } });
  assert.equal(re.status, 200, "the released player could not be re-placed");
  env.DB.close();
});

test("live: a member cannot reach any tryout route", async () => {
  const env = boot();
  const member = await signIn(env, "member@bt.test", "member", "Just A Member");
  for (const [m, path, body] of [
    ["GET", "/api/admin/tryouts/1/board", undefined],
    ["GET", "/api/admin/tryouts/1/summary", undefined],
    ["PUT", "/api/admin/tryouts/1/eval/1", { verdict: "offer" }],
    ["POST", "/api/admin/tryouts/1/squads", { name: "Mine" }],
  ]) {
    const r = await call(env, m, path, body === undefined ? { token: member.token } : { token: member.token, body });
    assert.equal(r.status, 403, `${m} ${path} let a member through (${r.status}) — evaluations are staff-only`);
  }
  env.DB.close();
});
