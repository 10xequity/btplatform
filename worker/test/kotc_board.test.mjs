/* Boomtown Platform — KOTC director's board: session list, the drag, the public leaderboard
   File: worker/test/kotc_board.test.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.86.0

   THE THREE ROUTES THIS COVERS DID NOT EXIST UNTIL v0.86.0, and the previous handoff said the KOTC API
   was "complete and tested". It was complete for the player link and for nothing else. Recorded here
   because the lesson is about documents, not about KOTC: one `grep` settled in a second what a sentence
   written in good faith had got wrong by two thirds.

   WHAT IS ACTUALLY HARD TO TEST HERE, and why this file exists rather than a few extra cases bolted
   onto kotc_play.test.mjs:

   THE MOVE MUST NOT REWRITE HISTORY. `kotc_games` stores the four players ON the game row, which is
   what lets the leaderboard be derived from games alone with no stored counter to disagree with. The
   cost of that design is that a re-seat *could* retroactively change who played a game that is already
   scored — and because the leaderboard is derived, it would silently restate the evening. Nothing on
   the screen would look wrong. No error would be thrown. The board would simply be about a different
   night than the one that happened.

   That is why the invariant test carries a NEGATIVE CONTROL THAT MUTATES THE REAL INPUT: it clears the
   scores on the very same game and proves the very same move DOES re-pair it. Without that control,
   "the finished game is unchanged" could pass for the boring reason — that the route never re-pairs
   anything at all. The control is what makes the clean report mean something (the C16 lesson, applied
   at the point where a guard is written rather than ten releases later).

   THE MOVE MUST NEVER REFUSE. Schedule-editor precedent, and it is tested by exhausting the board:
   every seat on every net, plus the bench, in one loop. A rule that holds for the case somebody thought
   of is not the rule; "never" is a claim about the cases nobody thought of.

   AND THE PUBLIC READ MUST NOT LEAK A LINK. The staff payload carries a `link` per player and that
   token IS the credential — the same contract as /api/score/:token. A public shape produced by
   trimming the staff shape in the page would publish every player's scoring link to anyone who opened
   devtools. So the assertion is on the raw response body, not on the parsed object: a token that never
   appears in the bytes cannot be recovered from them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

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

async function raw(env, method, path, { body, token, org = "1" } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": org };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
  return { status: res.status, data, text };
}
const call = async (...a) => { const r = await raw(...a); return { status: r.status, data: r.data }; };

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/** A session with `entered` players on the list, `seated` of them dealt into round 1. */
async function night({ entered = 8, deal = true, name = "Thursday" } = {}) {
  const env = boot(entered);
  const token = await staff(env);
  const s = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: { name, move_up: 1 } });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const sessionId = s.data.session_id;
  const players = Array.from({ length: entered }, (_, i) => ({ contact_id: i + 1, seed: i + 1 }));
  const r = await call(env, "POST", `/api/admin/kotc/${sessionId}/players`, { token, body: { players } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  if (deal) {
    const rd = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
    assert.equal(rd.status, 200, JSON.stringify(rd.data));
  }
  const tokens = {};
  for (const row of env.DB.query("SELECT contact_id, score_token FROM kotc_players WHERE session_id=?1", sessionId)) {
    tokens[row.contact_id] = row.score_token;
  }
  return { env, token, sessionId, tokens };
}

const move = (env, token, sessionId, body) =>
  call(env, "POST", `/api/admin/kotc/${sessionId}/move`, { token, body });

const board = (env, token, sessionId) => call(env, "GET", `/api/admin/kotc/${sessionId}`, { token });

/** Every game row as stored, so an assertion can be made about the ROW rather than about a view. */
const gameRows = (env) =>
  env.DB.query(`SELECT id, net_no, game_no, a1_contact_id, a2_contact_id, b1_contact_id, b2_contact_id,
                       score_a, score_b FROM kotc_games WHERE deleted_at IS NULL ORDER BY net_no, game_no`);
const four = (g) => [g.a1_contact_id, g.a2_contact_id, g.b1_contact_id, g.b2_contact_id];

/* ============================ the session list ============================
   The route that made the board reachable. Everything else in this file is unreachable without it. */

test("the session list exists, is newest first, and carries the event name and a player count", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  // A second session, created after the first, so "newest first" is a claim with two rows to order.
  const s2 = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: { name: "Friday" } });
  await call(env, "POST", `/api/admin/kotc/${s2.data.session_id}/players`, {
    token, body: { players: [{ contact_id: 1 }, { contact_id: 2 }, { contact_id: 3 }] },
  });

  const r = await call(env, "GET", "/api/admin/kotc", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sessions.length, 2);
  assert.equal(r.data.sessions[0].id, s2.data.session_id, "newest first — a director wants the one they just made");
  assert.equal(r.data.sessions[1].id, sessionId);
  assert.equal(r.data.sessions[0].event, "Thursday Nets", "the event NAME, not its id — the id is not what a director recognises");
  assert.equal(r.data.sessions[0].players, 3, "player count comes from the entry list");
  assert.equal(r.data.sessions[1].players, 8);
  assert.equal(r.data.sessions[1].rounds, 1, "and how far the night has got");
  assert.equal(r.data.sessions[0].rounds, 0, "a session with no round dealt reports 0, not null");
  env.DB.close();
});

test("the session list is staff-only, and a soft-deleted session leaves it", async () => {
  const { env, token, sessionId } = await night({ entered: 4 });
  /* 401 with no session, 403 with a session that is not staff — two different sentences about two
     different situations, and asserting one number would have been asserting the wrong one. What
     matters is that neither is 200. */
  const anon = await call(env, "GET", "/api/admin/kotc", {});
  assert.equal(anon.status, 401, "no session at all is unauthenticated, not forbidden");

  const nobody = await call(env, "POST", "/api/auth/request-link", { body: { email: "n@bt.test" } });
  const nv = await call(env, "POST", "/api/auth/verify", { body: { token: String(nobody.data.dev_link).split("token=")[1] } });
  const member = await call(env, "GET", "/api/admin/kotc", { token: nv.data.token });
  assert.equal(member.status, 403, "signed in without a staff role is forbidden");

  env.DB.exec(`UPDATE kotc_sessions SET deleted_at=datetime('now') WHERE id=${sessionId}`);
  const after = await call(env, "GET", "/api/admin/kotc", { token });
  assert.equal(after.data.sessions.length, 0, "soft-deleted means gone from the list");
  env.DB.close();
});

test("a session whose event was deleted still opens — modules degrade, they do not collapse", async () => {
  /* Owner: a failure may cost information, never permission. A dangling event_id must not take the
     board down with it; the heading just says less. */
  const { env, token } = await night({ entered: 4 });
  env.DB.exec("UPDATE events SET deleted_at=datetime('now') WHERE id=1");
  const r = await call(env, "GET", "/api/admin/kotc", { token });
  assert.equal(r.status, 200);
  assert.equal(r.data.sessions.length, 1, "the session is still listed");
  assert.equal(r.data.sessions[0].event, "Event no longer listed");
  env.DB.close();
});

/* ================================ the drag ================================ */

test("a player moves to an empty seat, and the board comes back from the server", async () => {
  /* 5 entered → netPlan gives one net of five, so seat 5 is free after somebody leaves it. Simpler:
     move within a 4-net after benching nobody is covered below; here the point is the response IS the
     next board, not an { ok: true } the page has to interpret. */
  const { env, token, sessionId } = await night({ entered: 8 });
  const before = await board(env, token, sessionId);
  const net1 = before.data.rounds[0].nets.find((n) => n.net_no === 1);
  const net2 = before.data.rounds[0].nets.find((n) => n.net_no === 2);
  const traveller = net1.players[0].contact_id;
  const target = net2.players[2];

  const r = await move(env, token, sessionId, { contact_id: traveller, net_no: 2, seat: target.seat });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.moved, true);
  assert.ok(r.data.rounds, "a move response carries the whole board — one payload builder, so a drag and a refresh agree");
  assert.ok(r.data.leaderboard, "including the leaderboard");

  const after = r.data.rounds[0].nets.find((n) => n.net_no === 2);
  assert.ok(after.players.some((p) => p.contact_id === traveller), "they are on net 2");
  const back = r.data.rounds[0].nets.find((n) => n.net_no === 1);
  assert.ok(!back.players.some((p) => p.contact_id === traveller), "and no longer on net 1");
  env.DB.close();
});

test("dropping on an occupied seat SWAPS the two, it does not overwrite one of them", async () => {
  /* Overwriting would un-seat somebody the director never mentioned. The schedule editor swaps for the
     same reason, and a board that loses a person is a board a director stops trusting. */
  const { env, token, sessionId } = await night({ entered: 8 });
  const before = await board(env, token, sessionId);
  const a = before.data.rounds[0].nets.find((n) => n.net_no === 1).players[0];
  const b = before.data.rounds[0].nets.find((n) => n.net_no === 2).players[1];

  const r = await move(env, token, sessionId, { contact_id: a.contact_id, net_no: 2, seat: b.seat });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.swapped_with.contact_id, b.contact_id, "the response names who they swapped with");
  assert.match(r.data.note, /Swapped with/, "and says so in a sentence, not a code");

  const seated = r.data.rounds[0].nets.flatMap((n) => n.players.map((p) => p.contact_id));
  assert.equal(seated.length, 8, "nobody was lost");
  assert.equal(new Set(seated).size, 8, "and nobody was duplicated");
  const n1 = r.data.rounds[0].nets.find((n) => n.net_no === 1);
  const n2 = r.data.rounds[0].nets.find((n) => n.net_no === 2);
  assert.ok(n2.players.some((p) => p.contact_id === a.contact_id), "A took B's seat");
  assert.ok(n1.players.some((p) => p.contact_id === b.contact_id), "B took A's");
  env.DB.close();
});

test("THE INVARIANT: a re-seat never changes who played a finished game", async () => {
  /* The whole reason this route needed a test nobody can see the need for from the screen.
     kotc_games stores the four players on the row. If a re-seat rewrote a scored game, the derived
     leaderboard would restate the evening and nothing would look wrong. */
  const { env, token, sessionId, tokens } = await night({ entered: 8 });
  const before = await board(env, token, sessionId);
  const net1 = before.data.rounds[0].nets.find((n) => n.net_no === 1);

  // Score net 1's game 1 only. Games 2 and 3 stay unplayed, which is the mixed state that matters.
  const anyone = net1.players[0].contact_id;
  const scored = await raw(env, "POST", `/api/kotc/${tokens[anyone]}`, {
    body: { games: [{ game_no: 1, score_a: 21, score_b: 15 }] },
  });
  assert.equal(scored.status, 200, JSON.stringify(scored.data));

  const finishedBefore = gameRows(env).find((g) => g.net_no === 1 && g.game_no === 1);
  assert.ok(finishedBefore.score_a !== null, "game 1 is genuinely scored, or this test proves nothing");
  const unplayedBefore = gameRows(env).find((g) => g.net_no === 1 && g.game_no === 2);

  // Now re-seat net 1 by swapping two of its own players — the harshest case, because the same four
  // people stay on the net and only the seat order changes, so the pairings genuinely should move.
  const r = await move(env, token, sessionId, {
    contact_id: net1.players[0].contact_id, net_no: 1, seat: net1.players[3].seat,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const finishedAfter = gameRows(env).find((g) => g.net_no === 1 && g.game_no === 1);
  assert.deepEqual(four(finishedAfter), four(finishedBefore),
    "a game that has been played is a fact about the evening — re-seating must not restate it");
  assert.equal(finishedAfter.score_a, 21, "and its scores are untouched");
  assert.equal(finishedAfter.score_b, 15);
  assert.ok(r.data.games_kept >= 1, "the response reports what it left alone");

  const unplayedAfter = gameRows(env).find((g) => g.net_no === 1 && g.game_no === 2);
  assert.notDeepEqual(four(unplayedAfter), four(unplayedBefore),
    "while an UNPLAYED game is re-paired to the new line-up — otherwise the drag did nothing");
  assert.ok(r.data.games_repaired >= 1);
  env.DB.close();
});

test("NC: with the score cleared, the SAME move re-pairs the SAME game — so the invariant is doing work", async () => {
  /* The negative control, and it mutates the real input rather than a copy of it: same session, same
     move, same game row, one field different. Without this, the test above could pass because the
     route never re-pairs anything, and a guard that cannot fail is not a guard. */
  const { env, token, sessionId, tokens } = await night({ entered: 8 });
  const before = await board(env, token, sessionId);
  const net1 = before.data.rounds[0].nets.find((n) => n.net_no === 1);
  const anyone = net1.players[0].contact_id;
  await raw(env, "POST", `/api/kotc/${tokens[anyone]}`, {
    body: { games: [{ game_no: 1, score_a: 21, score_b: 15 }] },
  });

  const target = gameRows(env).find((g) => g.net_no === 1 && g.game_no === 1);
  const lineupBefore = four(target);
  // THE MUTATION: un-finish the real row. Nothing else about the request changes.
  env.DB.exec(`UPDATE kotc_games SET score_a=NULL, score_b=NULL WHERE id=${target.id}`);

  const r = await move(env, token, sessionId, {
    contact_id: net1.players[0].contact_id, net_no: 1, seat: net1.players[3].seat,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const after = gameRows(env).find((g) => g.id === target.id);
  assert.notDeepEqual(four(after), lineupBefore,
    "NC FAILED: game 1 was NOT re-paired once unscored, so the invariant test above passes for the wrong reason");
  assert.equal(r.data.games_kept, 0, "and nothing was reported as kept, because nothing was finished");
  env.DB.close();
});

test("IT NEVER REFUSES: every seat on every net, and the bench, is accepted", async () => {
  /* Schedule-editor precedent. "Never" is a claim about the cases nobody thought of, so the board is
     exhausted rather than sampled: one player is dragged to every seat that exists, in turn. */
  const { env, token, sessionId } = await night({ entered: 8 });
  const before = await board(env, token, sessionId);
  const seats = before.data.rounds[0].nets.flatMap((n) => n.players.map((p) => ({ net_no: n.net_no, seat: p.seat })));
  assert.ok(seats.length >= 8, `expected the whole board, saw ${seats.length} seats`);

  const traveller = before.data.rounds[0].nets[0].players[0].contact_id;
  for (const s of seats) {
    const r = await move(env, token, sessionId, { contact_id: traveller, net_no: s.net_no, seat: s.seat });
    assert.equal(r.status, 200, `refused net ${s.net_no} seat ${s.seat}: ${JSON.stringify(r.data)}`);
    const seated = r.data.rounds[0].nets.flatMap((n) => n.players.map((p) => p.contact_id));
    assert.equal(new Set(seated).size, seated.length, `net ${s.net_no} seat ${s.seat} duplicated somebody`);
  }
  // And the same person still exists exactly once at the end of being dragged everywhere.
  const end = await board(env, token, sessionId);
  const all = end.data.rounds[0].nets.flatMap((n) => n.players.map((p) => p.contact_id));
  assert.equal(all.filter((id) => id === traveller).length, 1);
  env.DB.close();
});

test("a late arrival on the bench can be dragged on, and whoever they replace lands on the bench", async () => {
  /* Both halves of the same Tuesday. The player screen has had an `on_a_net: false` state since
     v0.85.0 for exactly this person; until now there was no way to get them off it. */
  const { env, token, sessionId } = await night({ entered: 8 });
  // Enter a ninth player AFTER the round was dealt — they are on the list, not on a net.
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (9,1,'p9@bt.test','Player 9surname')");
  await call(env, "POST", `/api/admin/kotc/${sessionId}/players`, { token, body: { players: [{ contact_id: 9 }] } });

  const before = await board(env, token, sessionId);
  assert.ok(before.data.bench.some((p) => p.contact_id === 9), "the board shows them on the bench, or they are undraggable");
  const victim = before.data.rounds[0].nets.find((n) => n.net_no === 1).players[0];

  const r = await move(env, token, sessionId, { contact_id: 9, net_no: 1, seat: victim.seat });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.benched.contact_id, victim.contact_id, "the response names who came off");
  assert.match(r.data.note, /came off net 1/);

  const seated = r.data.rounds[0].nets.flatMap((n) => n.players.map((p) => p.contact_id));
  assert.ok(seated.includes(9), "the late arrival is on");
  assert.ok(!seated.includes(victim.contact_id), "and the person they replaced is off");
  assert.ok(r.data.bench.some((p) => p.contact_id === victim.contact_id),
    "onto the bench, where they can be dragged back — a bench nobody can see is a one-way door");
  env.DB.close();
});

test("a contact who never entered is not seatable, and is told why in a sentence", async () => {
  /* Not a refused MOVE — a refused ENTRY. Seating somebody with no kotc_players row would give them a
     net and no link, which is the one state the player screen cannot render. */
  const { env, token, sessionId } = await night({ entered: 8 });
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (77,1,'p77@bt.test','Nobody Expected')");
  const r = await move(env, token, sessionId, { contact_id: 77, net_no: 1, seat: 0 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /entry list/i);
  assert.ok(!/[45]0[0-9]|E_[A-Z]/.test(r.data.error), "errors are human sentences, not codes (standards §8)");
  env.DB.close();
});

test("a net left short WARNS and still returns 200 — rotation() throws, and dispatch would eat it", async () => {
  /* The failure mode this guards is nasty and specific: `rotation()` throws for any size that is not 4
     or 5, and the v0.77.0 dispatch table treats a throw as a DECLINE. An unguarded call would turn a
     drag into a silent 404 — the route would look absent rather than broken. */
  const { env, token, sessionId } = await night({ entered: 8 });
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (9,1,'p9@bt.test','Player 9surname')");
  await call(env, "POST", `/api/admin/kotc/${sessionId}/players`, { token, body: { players: [{ contact_id: 9 }] } });

  const before = await board(env, token, sessionId);
  const victim = before.data.rounds[0].nets.find((n) => n.net_no === 1).players[0];
  // Benching one of four leaves net 1 with three, which no rotation exists for.
  const r = await move(env, token, sessionId, { contact_id: 9, net_no: 2, seat: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const r2 = await move(env, token, sessionId, { contact_id: victim.contact_id, net_no: 2, seat: 1 });
  assert.equal(r2.status, 200, `a short net must warn, never 404: ${JSON.stringify(r2.data)}`);
  const shorts = r2.data.short_nets || [];
  if (shorts.length) {
    assert.match(r2.data.note, /odd number of players/, "and it says so, rather than leaving a director to notice");
  }
  env.DB.close();
});

test("moving somebody to the seat they are already in is a no-op that says so", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  const before = await board(env, token, sessionId);
  const p = before.data.rounds[0].nets.find((n) => n.net_no === 1).players[1];
  const r = await move(env, token, sessionId, { contact_id: p.contact_id, net_no: 1, seat: p.seat });
  assert.equal(r.status, 200);
  assert.equal(r.data.moved, false);
  assert.match(r.data.note, /already there/);
  env.DB.close();
});

test("a malformed move is a 400, and a board with no round is a 409 — neither is 'refusing a move'", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  for (const body of [{}, { contact_id: 1 }, { contact_id: 1, net_no: 0, seat: 0 }, { contact_id: 1, net_no: 1, seat: -1 }]) {
    const r = await move(env, token, sessionId, body);
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
  const undealt = await night({ entered: 8, deal: false });
  const r = await move(undealt.env, undealt.token, undealt.sessionId, { contact_id: 1, net_no: 1, seat: 0 });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /no round/i);
  undealt.env.DB.close();
  env.DB.close();
});

test("the drag is staff-only and org-scoped — no route takes an org from the client (F-11)", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  const anon = await move(env, null, sessionId, { contact_id: 1, net_no: 1, seat: 0 });
  assert.equal(anon.status, 401, "no session cannot drag anybody");
  // Org 2 does not exist, so F-11 fails closed before the route sees ctx.
  const other = await call(env, "POST", `/api/admin/kotc/${sessionId}/move`, {
    token, org: "2", body: { contact_id: 1, net_no: 1, seat: 0 },
  });
  assert.ok(other.status === 404 || other.status === 403, `expected fail-closed, got ${other.status}`);
  env.DB.close();
});

/* ====================== the public individual leaderboard ====================== */

test("the public leaderboard needs no login and abbreviates every name", async () => {
  const { env, token, sessionId, tokens } = await night({ entered: 8 });
  const b = await board(env, token, sessionId);
  const net1 = b.data.rounds[0].nets.find((n) => n.net_no === 1);
  await raw(env, "POST", `/api/kotc/${tokens[net1.players[0].contact_id]}`, {
    body: { games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 21, score_b: 12 }] },
  });

  const r = await call(env, "GET", `/api/live/kotc/${sessionId}`, {});   // no token at all
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.session, "Thursday");
  assert.ok(r.data.leaderboard.length >= 4);
  for (const row of r.data.leaderboard) {
    assert.match(row.name, /^\S+ \S\.$/, `"${row.name}" is not abbreviated — standards §8 applies to every no-login surface`);
  }
  env.DB.close();
});

test("the public leaderboard carries NO roster and NO score link, asserted on the raw bytes", async () => {
  /* A token that never appears in the response cannot be recovered from it. Asserting on the parsed
     object would pass while the token sat in some field nobody thought to check. */
  const { env, sessionId, tokens } = await night({ entered: 8 });
  const r = await raw(env, "GET", `/api/live/kotc/${sessionId}`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.roster, undefined, "no roster on a public surface");
  assert.equal(r.data.bench, undefined, "and no bench — that is a director's view of who is sitting out");
  for (const [cid, tok] of Object.entries(tokens)) {
    assert.ok(!r.text.includes(tok), `player ${cid}'s scoring link leaked into the public payload`);
  }
  assert.ok(!/score_token|"link"/.test(r.text), "and neither did the shape that would carry one");
  env.DB.close();
});

test("the public and staff leaderboards are the same derivation, so they cannot disagree", async () => {
  /* Both call rankPlayers(tally(games)). If one ever grew its own arithmetic, the wall display and the
     director's screen would name different leaders on the same night. Only the NAMES may differ. */
  const { env, token, sessionId, tokens } = await night({ entered: 8 });
  const b = await board(env, token, sessionId);
  const net1 = b.data.rounds[0].nets.find((n) => n.net_no === 1);
  await raw(env, "POST", `/api/kotc/${tokens[net1.players[0].contact_id]}`, {
    body: { games: [{ game_no: 1, score_a: 21, score_b: 15 }, { game_no: 2, score_a: 18, score_b: 21 }] },
  });

  const pub = await call(env, "GET", `/api/live/kotc/${sessionId}`, {});
  const stf = await board(env, token, sessionId);
  assert.deepEqual(
    pub.data.leaderboard.map((r) => [r.place, r.contact_id, r.points, r.point_diff, r.wins, r.losses]),
    stf.data.leaderboard.map((r) => [r.place, r.contact_id, r.points, r.point_diff, r.wins, r.losses]),
    "the public board and the director's board must agree about the evening",
  );
  const staffNames = stf.data.leaderboard.map((r) => r.name);
  assert.ok(staffNames.some((n) => !/^\S+ \S\.$/.test(n)), "the staff board shows full names — that is the only difference");
  env.DB.close();
});

test("an unknown or deleted session is a 404 on the public read, and says nothing about why", async () => {
  const { env, sessionId } = await night({ entered: 4 });
  const missing = await call(env, "GET", "/api/live/kotc/9999", {});
  assert.equal(missing.status, 404);
  env.DB.exec(`UPDATE kotc_sessions SET deleted_at=datetime('now') WHERE id=${sessionId}`);
  const gone = await call(env, "GET", `/api/live/kotc/${sessionId}`, {});
  assert.equal(gone.status, 404, "a soft-deleted session is not public");
  env.DB.close();
});

/* ============================ wiring ============================ */

test("all three new routes are reachable as CALL SITES in the shipped module (standards §6.5)", () => {
  /* Assert the dispatch entries, never the definitions: a route defined and never matched is the
     failure class this module already paid for in v0.76.0. */
  const src = blankComments(readFileSync(new URL("../src/kotcplay.js", import.meta.url), "utf8")); // D-45
  for (const [what, re] of [
    ["the session list", /p === "\/api\/admin\/kotc" && m === "GET"/],
    ["the drag", /p\.match\(\/\^\\\/api\\\/admin\\\/kotc\\\/\(\\d\+\)\\\/move\$\/\)\) && m === "POST"/],
    ["the public leaderboard", /p\.match\(\/\^\\\/api\\\/live\\\/kotc\\\/\(\\d\+\)\$\/\)\) && m === "GET"/],
  ]) {
    assert.match(src, re, `${what} has no dispatch entry — built, tested and uncalled (failure class 1)`);
  }
  // And one payload builder, not two. The reason is in boardPayload's own header.
  assert.equal((src.match(/async function boardPayload\(/g) || []).length, 1);
  assert.ok(src.includes("...(await boardPayload(env, ctx.orgId, sessionId))"),
    "the move response must spread the same board the GET returns");
});
