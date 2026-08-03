/* Boomtown Platform — KOTC play surface: entry list, per-player links, confirm-or-edit
   File: worker/test/kotc_play.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.80.0

   Owner 2026-08-03, the last open question on this format, answered:
     "lets do both - but ideally 1 person fill it out for everyone would be nice. then back up each
      person can get a link and if submitted first, the link resolves to confirm - yes or no - then edit."

   THE PROPERTY THAT MATTERS MOST: there is always exactly ONE current answer on the table. The second
   person through the door is CHECKING the first, not competing with them. So the tests are built around
   the three states a link can be in — enter, confirm, done — and around the thing that breaks the whole
   idea: a confirmation surviving an edit it never saw. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot(players = 8) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'league','Thursday Nets','published',4)");
  for (let i = 1; i <= players; i++) {
    DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES (${i},1,'p${i}@bt.test','Player ${i}surname')`);
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

/** A player's link needs NO Authorization header at all — the token is the credential. */
async function link(env, method, tok, body) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  const res = await worker.fetch(new Request(`${ORIGIN}/api/kotc/${tok}`, {
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

/** A session with `n` players entered and round 1 dealt. Returns tokens keyed by contact id. */
async function night(n = 8) {
  const env = boot(n);
  const token = await staff(env);
  const s = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: { name: "Thursday", move_up: 1 } });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const sessionId = s.data.session_id;
  const players = Array.from({ length: n }, (_, i) => ({ contact_id: i + 1, seed: i + 1 }));
  const r = await call(env, "POST", `/api/admin/kotc/${sessionId}/players`, { token, body: { players } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rd = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(rd.status, 200, JSON.stringify(rd.data));
  const tokens = {};
  for (const row of env.DB.query("SELECT contact_id, score_token FROM kotc_players WHERE session_id=?1", sessionId)) {
    tokens[row.contact_id] = row.score_token;
  }
  return { env, token, sessionId, tokens };
}

/* ================================ the entry list ================================ */

test("every player gets a link at entry, not on request", async () => {
  /* A link minted on demand later would mean the backup path only works for people somebody remembered
     to prepare — which is the opposite of a backup. */
  const { env, tokens } = await night(8);
  assert.equal(Object.keys(tokens).length, 8);
  for (const [cid, tok] of Object.entries(tokens)) {
    assert.match(tok, /^[a-f0-9]{24}$/, `player ${cid}'s token is not the house shape`);
  }
  assert.equal(new Set(Object.values(tokens)).size, 8, "no two players may share a link");
  env.DB.close();
});

test("a session can be set up before it starts, which is what the entry list is for", async () => {
  // Migration 0040 had no roster: the entry list was implied by whoever was seated in round 1, so a
  // session could not exist before it started. Asserted directly, because it is the gap 0042 closes.
  const env = boot(8);
  const token = await staff(env);
  const s = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: { name: "Thursday" } });
  const r = await call(env, "POST", `/api/admin/kotc/${s.data.session_id}/players`, {
    token, body: { players: [{ contact_id: 1 }, { contact_id: 2 }, { contact_id: 3 }, { contact_id: 4 }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.roster.length, 4, "the roster exists with no round dealt");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM kotc_rounds").n, 0, "and no round has been created");
  for (const p of r.data.roster) assert.ok(p.link, "every entered player has a link before round 1");
  env.DB.close();
});

test("a player count that cannot be made into nets is refused with numbers that would work", async () => {
  const env = boot(7);
  const token = await staff(env);
  const s = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: {} });
  await call(env, "POST", `/api/admin/kotc/${s.data.session_id}/players`, {
    token, body: { players: [1, 2, 3, 4, 5, 6, 7].map((c) => ({ contact_id: c })) },
  });
  const rd = await call(env, "POST", `/api/admin/kotc/${s.data.session_id}/round`, { token });
  assert.equal(rd.status, 409);
  assert.match(rd.data.error, /cannot be made into nets/);
  assert.deepEqual(rd.data.would_work, [4, 8]);
  env.DB.close();
});

test("adding somebody from another organisation is refused before anything is written", async () => {
  const env = boot(4);
  const token = await staff(env);
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (2,'Other','other',1)");
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (99,2,'x@o.test','Outsider Person')");
  const s = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: {} });
  const r = await call(env, "POST", `/api/admin/kotc/${s.data.session_id}/players`, {
    token, body: { players: [{ contact_id: 1 }, { contact_id: 99 }] },
  });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /isn't in this organisation/);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM kotc_players").n, 0,
    "one bad entry must not leave the good ones written");
  env.DB.close();
});

/* ================================ the three modes ================================ */

test("the first person to open their link is asked to ENTER, and can do the whole net", async () => {
  // Owner: "ideally 1 person fill it out for everyone would be nice." So that is the path of least
  // resistance — one submission, three games, done.
  const { env, tokens } = await night(8);
  const first = await link(env, "GET", tokens[1]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.mode, "enter");
  assert.equal(first.data.net, 1, "seed 1 is on net 1");
  assert.equal(first.data.games.length, 3, "a net of four plays three games");
  assert.match(first.data.prompt, /you can do the whole net/);

  const sent = await link(env, "POST", tokens[1], {
    games: [
      { game_no: 1, score_a: 21, score_b: 15 },
      { game_no: 2, score_a: 18, score_b: 21 },
      { game_no: 3, score_a: 21, score_b: 12 },
    ],
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.wrote, 3);
  assert.deepEqual(sent.data.unresolved, []);
  assert.match(sent.data.note, /whole net done/);
  assert.equal(sent.data.mode, "done", "having entered and been recorded, nothing more is asked of them");
  env.DB.close();
});

test("the next person to open their link is asked to CONFIRM, and told who entered it", async () => {
  /* THE HEART OF THE OWNER'S ANSWER. Not "here are two versions, pick one" — "somebody entered these, do
     they look right?" There is one current answer and the second person is checking it. */
  const { env, tokens } = await night(8);
  await link(env, "POST", tokens[1], {
    games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }, { game_no: 3, score_a: 21, score_b: 12 }],
  });

  const second = await link(env, "GET", tokens[2]);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.mode, "confirm");
  assert.match(second.data.prompt, /Do they look right\?/);
  assert.match(second.data.prompt, /entered/);
  assert.equal(second.data.games[0].score_a, 21, "they must see the actual numbers, not a blank form");
  assert.ok(second.data.games[0].entered_by, "and who put them there");

  const yes = await link(env, "POST", tokens[2], { action: "confirm" });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.equal(yes.data.confirmed, true);
  assert.equal(yes.data.mode, "done");
  assert.equal(yes.data.checked_by, 2, "two of the four have now checked this net");
  env.DB.close();
});

test("saying NO and sending a correction becomes the new current answer", async () => {
  const { env, tokens } = await night(8);
  await link(env, "POST", tokens[1], {
    games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }, { game_no: 3, score_a: 21, score_b: 12 }],
  });
  const fix = await link(env, "POST", tokens[2], {
    action: "dispute",
    games: [{ game_no: 1, score_a: 21, score_b: 17 }],
  });
  assert.equal(fix.status, 200, JSON.stringify(fix.data));
  assert.equal(fix.data.games[0].score_b, 17, "the correction is what stands now");
  // The games nobody disputed are untouched — a partial correction must not wipe the rest.
  assert.equal(fix.data.games[1].score_a, 18);
  assert.equal(fix.data.games[2].score_b, 12);
  assert.match(fix.data.note, /asked to check it again/);
  env.DB.close();
});

test("AN EDIT RESETS EVERYONE ELSE TO PENDING — a confirmation cannot survive the numbers it was about", async () => {
  /* THE FAILURE THIS WHOLE FEATURE EXISTS TO PREVENT. If confirmations carried forward, the board would
     show three ticks against a scoreline only its editor has ever seen. That is worse than no ticks: it
     is false assurance, and it is the exact shape of the "recorded but not in force" defect this project
     keeps finding. */
  const { env, tokens } = await night(8);
  await link(env, "POST", tokens[1], {
    games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }, { game_no: 3, score_a: 21, score_b: 12 }],
  });
  await link(env, "POST", tokens[2], { action: "confirm" });
  await link(env, "POST", tokens[3], { action: "confirm" });
  const before = env.DB.query("SELECT contact_id, confirmed FROM kotc_slots WHERE net_no=1 ORDER BY contact_id");
  assert.equal(before.filter((s) => s.confirmed === "confirmed").length, 3, "precondition: three have checked");

  // Player 4 corrects game 2.
  const edit = await link(env, "POST", tokens[4], { action: "dispute", games: [{ game_no: 2, score_a: 21, score_b: 19 }] });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));

  const after = env.DB.query("SELECT contact_id, confirmed FROM kotc_slots WHERE net_no=1 ORDER BY contact_id");
  const byId = Object.fromEntries(after.map((s) => [s.contact_id, s.confirmed]));
  assert.equal(byId[4], "confirmed", "the editor stands behind their own numbers");
  for (const cid of [1, 2, 3]) {
    assert.equal(byId[cid], "pending", `player ${cid}'s confirmation must be cleared — they never saw this score`);
  }
  assert.equal(edit.data.checked_by, 1, "and the count must drop to one");
  env.DB.close();
});

test("confirming when nothing has been entered is refused", async () => {
  // A tick against an empty net records somebody vouching for nothing.
  const { env, tokens } = await night(8);
  const r = await link(env, "POST", tokens[1], { action: "confirm" });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /nothing entered yet/);
  env.DB.close();
});

/* ================================ the solver, through the link ================================ */

test("a player can send just their own total and the rest is worked out", async () => {
  /* The v0.79.0 solver, reachable at last. Two games typed in plus one number from each side of the third
     determines it — and the response says which scores were WORKED OUT rather than entered, because a
     person confirming needs to know which numbers came from them. */
  const { env, tokens } = await night(8);
  await link(env, "POST", tokens[1], {
    games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }],
  });
  const net = env.DB.query("SELECT seat, contact_id FROM kotc_slots WHERE net_no=1 ORDER BY seat").map((s) => s.contact_id);
  // Real round: game 3 was 21-12. Seat 0 is on side A of game 3, seat 1 on side B.
  const totals = {};
  totals[net[0]] = 21 + 18 + 21;
  totals[net[1]] = 21 + 21 + 12;
  const r = await link(env, "POST", tokens[net[1]], { totals });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.derived >= 1, `expected a derived score, got ${JSON.stringify(r.data)}`);
  assert.deepEqual(r.data.unresolved, []);
  assert.match(r.data.note, /worked out/i);
  const g3 = env.DB.one("SELECT score_a, score_b FROM kotc_games WHERE net_no=1 AND game_no=3");
  assert.deepEqual([g3.score_a, g3.score_b], [21, 12], "the missing game must be solved, exactly");
  env.DB.close();
});

test("evidence that cannot be true is refused with a sentence, and nothing is written", async () => {
  const { env, tokens } = await night(8);
  const r = await link(env, "POST", tokens[1], { games: [{ game_no: 1, score_a: 15, score_b: 14 }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Game 1|Check the sheet/);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM kotc_games WHERE score_a IS NOT NULL").n, 0,
    "an impossible scoreline must leave the net untouched");
  env.DB.close();
});

test("a partial submission leaves the games it did not mention alone", async () => {
  const { env, tokens } = await night(8);
  await link(env, "POST", tokens[1], { games: [{ game_no: 1, score_a: 21, score_b: 15 }] });
  const r = await link(env, "POST", tokens[2], { action: "dispute", games: [{ game_no: 2, score_a: 21, score_b: 9 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g1 = env.DB.one("SELECT score_a, score_b FROM kotc_games WHERE net_no=1 AND game_no=1");
  assert.deepEqual([g1.score_a, g1.score_b], [21, 15], "game 1 must survive a submission about game 2");
  env.DB.close();
});

/* ================================ links, and what they may not do ================================ */

test("a link needs no login, and a bad one is a 404 rather than a 403", async () => {
  // "Wrong link" tells somebody a real one exists. A player on a grass court with one bar of signal is
  // not going to sign in, so the token is the credential — same contract as the captain score links.
  const { env, tokens } = await night(8);
  const ok = await link(env, "GET", tokens[1]);
  assert.equal(ok.status, 200, "no Authorization header was sent, and that must be fine");
  const bad = await link(env, "GET", "deadbeefdeadbeefdeadbeef");
  assert.equal(bad.status, 404);
  assert.match(bad.data.error, /isn't valid any more/);
  env.DB.close();
});

test("a player's link only ever reaches their own net", async () => {
  // Net 2's players must not be able to score net 1. Nothing in the request names a net — it is derived
  // from the token — so this is a property of the design rather than a check that could be forgotten.
  const { env, tokens } = await night(8);
  const onNet2 = env.DB.one("SELECT contact_id FROM kotc_slots WHERE net_no=2 AND seat=0").contact_id;
  const view = await link(env, "GET", tokens[onNet2]);
  assert.equal(view.data.net, 2);
  for (const g of view.data.games) {
    const row = env.DB.one("SELECT net_no FROM kotc_games WHERE net_no=2 AND game_no=?1", g.game_no);
    assert.ok(row, "every game offered must belong to their own net");
  }
  await link(env, "POST", tokens[onNet2], { games: [{ game_no: 1, score_a: 21, score_b: 3 }] });
  assert.equal(env.DB.one("SELECT score_a FROM kotc_games WHERE net_no=1 AND game_no=1").score_a, null,
    "a net-2 player must not have been able to write net 1");
  env.DB.close();
});

test("names on the link screen are ABBREVIATED — it needs no login", async () => {
  /* Standards §8 applies here exactly as on the public board: this page is reachable by anyone holding a
     link, so full names on it are published. The admin board shows full names; this does not. */
  const { env, tokens, token, sessionId } = await night(8);
  const view = await link(env, "GET", tokens[1]);
  for (const p of view.data.players) {
    assert.match(p.name, /^Player \d\.$/, `"${p.name}" is not abbreviated`);
    assert.ok(!/surname/i.test(p.name), "the stored surname must not appear on a login-free screen");
  }
  // And the staff board is the other way round, deliberately.
  const board = await call(env, "GET", `/api/admin/kotc/${sessionId}`, { token });
  assert.equal(board.status, 200, JSON.stringify(board.data));
  assert.ok(/surname/i.test(board.data.rounds[0].nets[0].players[0].name),
    "a director chasing somebody needs the real name");
  env.DB.close();
});

test("a member with a session cannot reach the admin routes", async () => {
  const { env, sessionId } = await night(8);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  for (const [m, path] of [
    ["POST", "/api/admin/events/1/kotc"],
    ["POST", `/api/admin/kotc/${sessionId}/players`],
    ["POST", `/api/admin/kotc/${sessionId}/round`],
    ["GET", `/api/admin/kotc/${sessionId}`],
  ]) {
    const r = await call(env, m, path, { token: v.data.token, body: m === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${path} let a member through (${r.status})`);
  }
  env.DB.close();
});

/* ================================ a night, end to end ================================ */

test("round two is dealt from round one's scores, and the leaderboard is derived", async () => {
  const { env, token, sessionId, tokens } = await night(8);
  // Score both nets through the links, one person doing each net.
  for (const netNo of [1, 2]) {
    const first = env.DB.one("SELECT contact_id FROM kotc_slots WHERE net_no=?1 AND seat=0", netNo).contact_id;
    const r = await link(env, "POST", tokens[first], {
      games: [
        { game_no: 1, score_a: 21, score_b: 15 },
        { game_no: 2, score_a: 18, score_b: 21 },
        { game_no: 3, score_a: 21, score_b: 12 },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }

  const rd2 = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(rd2.status, 200, JSON.stringify(rd2.data));
  assert.equal(rd2.data.round_no, 2);
  assert.deepEqual(rd2.data.nets.map((n) => n.players), [4, 4], "net sizes must be preserved");

  // Nobody lost, nobody duplicated.
  const seated = env.DB.query("SELECT contact_id FROM kotc_slots s JOIN kotc_rounds r ON r.id=s.round_id WHERE r.round_no=2");
  assert.equal(seated.length, 8);
  assert.equal(new Set(seated.map((s) => s.contact_id)).size, 8);

  const board = await call(env, "GET", `/api/admin/kotc/${sessionId}`, { token });
  assert.equal(board.data.leaderboard.length, 8);
  assert.equal(board.data.leaderboard[0].place, 1);
  // Derived, never stored — there is no per-player counter anywhere (migration 0040).
  for (const row of board.data.leaderboard) {
    assert.equal(row.games, 3, `${row.name} should have played three games in round 1`);
  }
  assert.ok(board.data.leaderboard[0].points >= board.data.leaderboard[7].points, "ordered best first");
  env.DB.close();
});

test("the next round is refused while the current one has no scores", async () => {
  // Movement is computed from the round just played. Dealing round 2 off an unscored round 1 would seat
  // everybody by seed again and quietly make the format not the format.
  const { env, token, sessionId } = await night(8);
  const r = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /nothing to move on/);
  env.DB.close();
});

test("the board tells a director which nets have been checked and which are disputed", async () => {
  // The question a director actually has: has anyone else looked at net 3?
  const { env, token, sessionId, tokens } = await night(8);
  await link(env, "POST", tokens[1], {
    games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }, { game_no: 3, score_a: 21, score_b: 12 }],
  });
  await link(env, "POST", tokens[2], { action: "confirm" });

  const board = await call(env, "GET", `/api/admin/kotc/${sessionId}`, { token });
  const net1 = board.data.rounds[0].nets.find((n) => n.net_no === 1);
  const net2 = board.data.rounds[0].nets.find((n) => n.net_no === 2);
  assert.equal(net1.checked, 2, "the person who entered plus the one who confirmed");
  assert.equal(net1.complete, true);
  assert.equal(net2.checked, 0, "nobody has touched net 2");
  assert.equal(net2.complete, false);
  env.DB.close();
});
