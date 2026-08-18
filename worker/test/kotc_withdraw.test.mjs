/* Boomtown Platform — KOTC: finished for the night, and back in again
   File: worker/test/kotc_withdraw.test.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.87.0

   WHY THIS ROUTE EXISTED AS A HOLE FOR SEVEN RELEASES. `kotc_players.withdrawn_at` shipped in migration
   0042. Seven places READ it — the player link 409s on it, round 1 deals around it, the bench hides
   them, the session list leaves them out of its count — and nothing ever WROTE it. That is failure
   class 1 from the far end: not a route with no caller, but a state with no cause. Every read was
   correct and unreachable. Five of twenty-four players left before round 3 of the owner's real
   tournament, two of them from the top four, so the hole was in the most ordinary thing a director does.

   WHAT IS ACTUALLY HARD HERE, and it is not the UPDATE:

   1. THE SEAT. Setting the flag alone leaves somebody holding a seat on a net while being excluded from
      the bench — and `nextRound` builds the next round from the PREVIOUS round's nets, so a slot left
      behind carries a person who has gone home into round 3. The test for this asserts the NEXT DEAL,
      not the flag, because the flag is the easy half.

   2. THEIR EVENING MUST SURVIVE. The leaderboard is derived from games (`rankPlayers(tally(allGames))`,
      no stored counter anywhere — migration 0040). A withdrawn player keeps every point they won. If
      withdrawing quietly erased somebody's night, the two players who left the real tournament from the
      top four would vanish from their own results and nothing would look broken.

   3. FREEING A SEAT RE-PAIRS GAMES, AND MUST NOT REWRITE A FINISHED ONE. This is the same invariant the
      drag carries, now reachable through a second door — which is exactly why `repairUnplayed` is shared
      rather than copied. It gets its own NEGATIVE CONTROL THAT MUTATES THE REAL INPUT: the identical
      withdraw is run against the identical board with the scores CLEARED on the very same game, and it
      must re-pair that game. Without the control, "the finished game is unchanged" would also pass if
      the withdraw re-paired nothing at all, which is the boring way for this to look clean. */
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

async function call(env, method, path, { body, org = "1", token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": org };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
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

/** A session with `entered` players on the list, dealt into round 1 unless told not to. */
async function night({ entered = 8, deal = true } = {}) {
  const env = boot(entered);
  const token = await staff(env);
  const s = await call(env, "POST", "/api/admin/events/1/kotc", { token, body: { name: "Thursday", move_up: 1 } });
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

const withdraw = (env, token, sessionId, body) =>
  call(env, "POST", `/api/admin/kotc/${sessionId}/withdraw`, { token, body });

const board = (env, token, sessionId) => call(env, "GET", `/api/admin/kotc/${sessionId}`, { token });

const move = (env, token, sessionId, body) =>
  call(env, "POST", `/api/admin/kotc/${sessionId}/move`, { token, body });

/* What the director's board renders the withdrawn list FROM, written here as the page's own rule so
   a response can be judged the way the screen judges it: admin-kotc.js does
   `(data.roster || []).filter((p) => p.withdrawn)` and `#kbDoneWrap.hidden` follows its length. */
const doneListOf = (payload) => ((payload && payload.roster) || []).filter((p) => p.withdrawn);

const gameRows = (env) =>
  env.DB.query(`SELECT id, net_no, game_no, a1_contact_id, a2_contact_id, b1_contact_id, b2_contact_id,
                       score_a, score_b FROM kotc_games WHERE deleted_at IS NULL ORDER BY net_no, game_no`);
const four = (g) => [g.a1_contact_id, g.a2_contact_id, g.b1_contact_id, g.b2_contact_id];

const liveSlots = (env) =>
  env.DB.query("SELECT contact_id, net_no, seat FROM kotc_slots WHERE deleted_at IS NULL ORDER BY net_no, seat");

/* ══════════ RF-6: A DRAG MUST NOT HIDE THE WITHDRAWN LIST ══════════

   THE DEFECT THIS PAIR EXISTS FOR SAT BETWEEN TWO GUARDS THAT WERE EACH CORRECT.
   `kotc_board_screen.test.mjs` asserts the page NEVER patches its own board — every response IS the
   next board — and the page feeds the withdrawn list from `data.roster` on purpose, because the
   server keeps those people off the bench so they cannot be dragged back onto a net by accident.
   Meanwhile `/move` returned `boardPayload` and NOT `roster`. So one drag replaced `data` with a
   payload that had no roster, `#kbDoneWrap` went hidden, and the "Back in" buttons — the only undo
   for a mis-tap — vanished until the page was reloaded. The owner reported it as "court board is not
   working" (§-1r RF-6), and every hop of button → handler → route → render resolved.

   BOTH 200 PATHS OF `/move` ARE COVERED — the real move and the already-there no-op — because they
   are two separate `return json` sites and only one of them being fixed is the likelier regression. */

test("RF-6: a real move keeps the withdrawn list — the response the page renders carries the roster", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  const w = await withdraw(env, token, sessionId, { contact_id: 3 });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.equal(doneListOf(w.data).length, 1, "precondition: the withdraw response itself carries the list");

  const seats = liveSlots(env);
  const mover = seats.find((s) => s.contact_id !== 3);
  assert.ok(mover, "precondition: somebody else is seated to drag");
  const target = seats.find((s) => s.net_no === mover.net_no && s.seat !== mover.seat);
  assert.ok(target, "precondition: a second seat on that net to drop onto");

  const r = await move(env, token, sessionId, {
    contact_id: mover.contact_id, net_no: target.net_no, seat: target.seat,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.roster),
    "the move response carries no roster, and the page is forbidden to patch its own board — so the withdrawn list renders empty");
  const done = doneListOf(r.data);
  assert.equal(done.length, 1, "the withdrawn player must survive a drag by somebody else");
  assert.equal(done[0].contact_id, 3, "and it must be the person who actually went home");
  env.DB.close();
});

test("RF-6: the already-there no-op keeps it too — both return sites, not just the interesting one", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  await withdraw(env, token, sessionId, { contact_id: 4 });

  const seat = liveSlots(env).find((s) => s.contact_id !== 4);
  assert.ok(seat, "precondition: somebody is seated");
  const r = await move(env, token, sessionId, {
    contact_id: seat.contact_id, net_no: seat.net_no, seat: seat.seat,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.moved, false, "precondition: this is the they-were-already-there path");
  assert.equal(doneListOf(r.data).length, 1, "the no-op path must carry the roster as well");
  env.DB.close();
});

/* ==================== the flag, the seat, and the player's own link ==================== */

test("withdrawing sets the flag, frees the seat, and the player's link says so", async () => {
  const { env, token, sessionId, tokens } = await night({ entered: 8 });
  const before = liveSlots(env);
  const seat = before.find((s) => s.contact_id === 3);
  assert.ok(seat, "player 3 should be seated after the deal");

  const w = await withdraw(env, token, sessionId, { contact_id: 3 });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.equal(w.data.changed, true);
  assert.equal(w.data.withdrawn, true);
  assert.deepEqual(w.data.freed, { net_no: seat.net_no, seat: seat.seat });

  // The column, written for the first time in seven releases.
  const row = env.DB.one("SELECT withdrawn_at FROM kotc_players WHERE session_id=?1 AND contact_id=3", sessionId);
  assert.ok(row.withdrawn_at, "withdrawn_at must actually be written");

  // The seat is genuinely free — not merely flagged.
  assert.equal(liveSlots(env).filter((s) => s.contact_id === 3).length, 0, "their slot must be gone");

  // And the sentence that has existed since 0042 with no way to reach it now has a way.
  const mine = await call(env, "GET", `/api/kotc/${tokens[3]}`);
  const posted = await call(env, "POST", `/api/kotc/${tokens[3]}`, { body: { action: "confirm" } });
  assert.equal(posted.status, 409, JSON.stringify(posted.data));
  assert.match(posted.data.error, /finished for the night/i);
  assert.ok(!/[A-Z]{3,}_[A-Z]/.test(posted.data.error), "errors are human sentences, not codes");
  assert.ok(mine.status === 200 || mine.status === 409, "the GET still resolves rather than throwing");
  env.DB.close();
});

test("a withdrawn player keeps every point they won — withdrawing is not deleting", async () => {
  const { env, token, sessionId } = await night({ entered: 4 });
  // Score the whole net so everybody has a real evening to lose.
  const rows = gameRows(env);
  for (const g of rows) {
    env.DB.exec(`UPDATE kotc_games SET score_a=21, score_b=15 WHERE id=${g.id}`);
  }
  const lbBefore = (await board(env, token, sessionId)).data.leaderboard;
  const p1Before = lbBefore.find((r) => r.contact_id === 1);
  assert.ok(p1Before && p1Before.games > 0, "player 1 should have games before withdrawing");

  const w = await withdraw(env, token, sessionId, { contact_id: 1 });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.match(w.data.note, /scores so far still count/i);

  const p1After = w.data.leaderboard.find((r) => r.contact_id === 1);
  assert.ok(p1After, "a withdrawn player must still appear in the standings");
  assert.equal(p1After.points, p1Before.points, "their points must not change");
  assert.equal(p1After.wins, p1Before.wins, "their wins must not change");
  assert.equal(p1After.games, p1Before.games, "their games must not change");
  env.DB.close();
});

test("a withdrawn player leaves the bench, so the board cannot offer them as draggable", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  // Free somebody first so they are on the bench and visible there.
  await withdraw(env, token, sessionId, { contact_id: 5 });
  const b = (await board(env, token, sessionId)).data;
  assert.ok(!(b.bench || []).some((x) => x.contact_id === 5), "a withdrawn player must not sit on the bench");
  const entry = (b.roster || []).find((x) => x.contact_id === 5);
  assert.ok(entry, "they stay on the entry list");
  assert.equal(entry.withdrawn, true, "and the roster marks them withdrawn, which is what the screen renders");
  env.DB.close();
});

/* ==================== the reason the seat must actually be freed ==================== */

test("the next round does not seat somebody who has gone home", async () => {
  /* `nextRound` builds round 2 from round 1's NETS. A slot left in place would carry a withdrawn player
     forward, which is the whole reason this route touches `kotc_slots` and not just the flag.
     Five entered, so withdrawing one leaves a net of four — a shape the next round can still be dealt
     from. The five-to-four case is the one that exercises the seat; the four-to-three case is the
     refusal below. */
  const { env, token, sessionId } = await night({ entered: 5 });
  for (const g of gameRows(env)) env.DB.exec(`UPDATE kotc_games SET score_a=21, score_b=15 WHERE id=${g.id}`);

  await withdraw(env, token, sessionId, { contact_id: 2 });
  const r2 = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));

  const latest = env.DB.one("SELECT id, round_no FROM kotc_rounds WHERE session_id=?1 ORDER BY round_no DESC LIMIT 1", sessionId);
  assert.equal(latest.round_no, 2, "a second round should have been dealt");
  const seated = env.DB.query(
    "SELECT contact_id FROM kotc_slots WHERE round_id=?1 AND deleted_at IS NULL", latest.id
  ).map((s) => s.contact_id);
  assert.ok(!seated.includes(2), "a withdrawn player must not be seated in the next round");
  env.DB.close();
});

test("a net left at three refuses the next round with a sentence, and writes NOTHING — it used to 500 and half-write", async () => {
  /* `gamesForRound` calls `rotation()`, which throws for any size that is not four or five, and the
     round row plus every slot is inserted BEFORE that call. So this used to be a 500 that left a round
     with seating and no games behind it. Reachable by the drag before v0.87.0 and easy to reach now.
     This is the refusal, not the redistribution — redistributing over the nets that exist is §6.3. */
  const { env, token, sessionId } = await night({ entered: 8 });
  for (const g of gameRows(env)) env.DB.exec(`UPDATE kotc_games SET score_a=21, score_b=15 WHERE id=${g.id}`);
  const roundsBefore = env.DB.query("SELECT id FROM kotc_rounds WHERE session_id=?1", sessionId).length;

  await withdraw(env, token, sessionId, { contact_id: 2 });   // 8 → 7: one net of four, one of three
  const r2 = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(r2.status, 409, JSON.stringify(r2.data));
  assert.match(r2.data.error, /four or five/i);
  assert.match(r2.data.error, /board/i, "and it says what to do about it");
  assert.ok(!/[A-Z]{3,}_[A-Z]/.test(r2.data.error), "a human sentence, not a code");

  // THE HALF-WRITE IS THE POINT: a refusal must not leave a round behind.
  const roundsAfter = env.DB.query("SELECT id FROM kotc_rounds WHERE session_id=?1", sessionId).length;
  assert.equal(roundsAfter, roundsBefore, "a refused round must not have been inserted");

  /* NEGATIVE CONTROL for that guard: bring the same person back and drag them onto the short net, so the
     only thing that changed is the net size. The identical call must now succeed. Without this, the 409
     above would also pass if the route refused every second round for any reason at all. */
  await withdraw(env, token, sessionId, { contact_id: 2, withdrawn: false });
  const live = env.DB.query(
    `SELECT s.net_no, s.seat FROM kotc_slots s
      JOIN kotc_rounds r ON r.id = s.round_id
     WHERE r.session_id=?1 AND s.deleted_at IS NULL AND r.deleted_at IS NULL`, sessionId);
  const counts = new Map();
  for (const s of live) counts.set(s.net_no, (counts.get(s.net_no) || 0) + 1);
  const shortNet = [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
  // The EMPTY seat, not seat 3 — dropping onto a taken seat is a swap, which would leave the net at three.
  const taken = new Set(live.filter((s) => s.net_no === shortNet).map((s) => s.seat));
  const freeSeat = [0, 1, 2, 3].find((s) => !taken.has(s));
  assert.notEqual(freeSeat, undefined, "the short net must have a free seat to drop into");

  const back = await call(env, "POST", `/api/admin/kotc/${sessionId}/move`,
    { token, body: { contact_id: 2, net_no: shortNet, seat: freeSeat } });
  assert.equal(back.status, 200, JSON.stringify(back.data));

  const r2b = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(r2b.status, 200, `with every net back to four the same call must succeed: ${JSON.stringify(r2b.data)}`);
  env.DB.close();
});

/* ==================== the invariant, and the control that makes it mean something ==================== */

/** One net of five, game 1 scored. Withdrawing one player takes the net to four, which re-pairs. */
async function netOfFive() {
  const n = await night({ entered: 5 });
  const rows = gameRows(n.env);
  assert.ok(rows.length >= 2, "a net of five should produce several games");
  return { ...n, firstGameId: rows[0].id };
}

test("withdrawing re-pairs the unplayed games but NEVER rewrites a finished one", async () => {
  const { env, token, sessionId, firstGameId } = await netOfFive();
  env.DB.exec(`UPDATE kotc_games SET score_a=21, score_b=17 WHERE id=${firstGameId}`);
  const finishedBefore = gameRows(env).find((g) => g.id === firstGameId);

  const w = await withdraw(env, token, sessionId, { contact_id: 5 });
  assert.equal(w.status, 200, JSON.stringify(w.data));

  const finishedAfter = gameRows(env).find((g) => g.id === firstGameId);
  assert.deepEqual(four(finishedAfter), four(finishedBefore),
    "the game that was already scored must name exactly the four people who played it");
  assert.equal(finishedAfter.score_a, 21);
  assert.equal(finishedAfter.score_b, 17);
  assert.equal(w.data.games_kept, 1, "and the response must say it left one game alone");
  assert.match(w.data.note, /left exactly as played/i);

  // The other half of the claim: it DID re-pair something, so "unchanged" is not unchanged-because-idle.
  assert.ok(w.data.games_repaired > 0, "the unplayed games on that net must have been re-paired");
  env.DB.close();
});

test("NEGATIVE CONTROL: with the scores cleared on that very same game, the same withdraw DOES re-pair it", async () => {
  /* This is the test that makes the one above mean something. Identical board, identical withdraw, one
     mutation to the REAL input — the scores come off the same game row — and the guard must now let the
     row change. If this ever fails, the test above is passing because nothing re-pairs at all. */
  const { env, token, sessionId, firstGameId } = await netOfFive();
  env.DB.exec(`UPDATE kotc_games SET score_a=NULL, score_b=NULL WHERE id=${firstGameId}`);
  const before = gameRows(env).find((g) => g.id === firstGameId);

  const w = await withdraw(env, token, sessionId, { contact_id: 5 });
  assert.equal(w.status, 200, JSON.stringify(w.data));

  const after = gameRows(env).find((g) => g.id === firstGameId);
  assert.notDeepEqual(four(after), four(before),
    "an UNPLAYED game on a net whose line-up changed must be re-paired — otherwise the guard above proves nothing");
  assert.equal(w.data.games_kept, 0, "and nothing was finished, so nothing was kept");
  env.DB.close();
});

/* ==================== back in again ==================== */

test("bringing somebody back clears the flag and returns them to the bench, not to a net", async () => {
  const { env, token, sessionId, tokens } = await night({ entered: 8 });
  await withdraw(env, token, sessionId, { contact_id: 4 });

  const back = await withdraw(env, token, sessionId, { contact_id: 4, withdrawn: false });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(back.data.changed, true);
  assert.equal(back.data.withdrawn, false);

  const row = env.DB.one("SELECT withdrawn_at FROM kotc_players WHERE session_id=?1 AND contact_id=4", sessionId);
  assert.equal(row.withdrawn_at, null, "the flag must be cleared, not merely re-dated");

  // On the bench, draggable, and NOT silently re-seated: where they play is the director's call.
  assert.ok((back.data.bench || []).some((x) => x.contact_id === 4), "they come back to the bench");
  assert.equal(liveSlots(env).filter((s) => s.contact_id === 4).length, 0,
    "being brought back must not guess a seat for them");
  assert.match(back.data.note, /drag them onto a net/i);

  // And their link works again.
  const posted = await call(env, "POST", `/api/kotc/${tokens[4]}`, { body: { action: "confirm" } });
  assert.notEqual(posted.status, 409, "the finished-for-the-night 409 must be gone");
  env.DB.close();
});

test("withdrawing twice is a 200 that says so, not an error — two tablets tapping one person is a Tuesday", async () => {
  const { env, token, sessionId } = await night({ entered: 8 });
  const first = await withdraw(env, token, sessionId, { contact_id: 6 });
  assert.equal(first.data.changed, true);

  const again = await withdraw(env, token, sessionId, { contact_id: 6 });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.changed, false, "the second call changed nothing");
  assert.equal(again.data.withdrawn, true, "and reports the state it found");
  assert.match(again.data.note, /already finished/i);
  assert.ok(again.data.rounds, "and it still hands back the board, so the screen never renders a dead end");

  const back = await withdraw(env, token, sessionId, { contact_id: 6, withdrawn: false });
  assert.equal(back.data.changed, true);
  const backAgain = await withdraw(env, token, sessionId, { contact_id: 6, withdrawn: false });
  assert.equal(backAgain.data.changed, false);
  assert.match(backAgain.data.note, /already back in/i);
  env.DB.close();
});

test("withdrawing works before any round is dealt — there is simply no seat to free", async () => {
  // Five entered so that withdrawing one leaves four, a shape round 1 can be dealt from.
  const { env, token, sessionId } = await night({ entered: 5, deal: false });
  const w = await withdraw(env, token, sessionId, { contact_id: 5 });
  assert.equal(w.status, 200, JSON.stringify(w.data));
  assert.equal(w.data.changed, true);
  assert.equal(w.data.freed, null, "nothing to free before the nets exist");

  // And the first deal then leaves them out, which is the read that already existed.
  const rd = await call(env, "POST", `/api/admin/kotc/${sessionId}/round`, { token });
  assert.equal(rd.status, 200, JSON.stringify(rd.data));
  const seated = liveSlots(env).map((s) => s.contact_id);
  assert.ok(!seated.includes(5), "round 1 deals around a withdrawn player");
  env.DB.close();
});

/* ==================== refusals, and the org boundary ==================== */

test("somebody who was never on the entry list is a 400 with a sentence that says what to do", async () => {
  const { env, token, sessionId } = await night({ entered: 4 });
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (99,1,'x@bt.test','Nobody Here')");
  const w = await withdraw(env, token, sessionId, { contact_id: 99 });
  assert.equal(w.status, 400, JSON.stringify(w.data));
  assert.match(w.data.error, /entry list/i);
  assert.ok(!/[A-Z]{3,}_[A-Z]/.test(w.data.error), "a human sentence, not a code");

  const empty = await withdraw(env, token, sessionId, {});
  assert.equal(empty.status, 400, "no contact_id is a refusal, not a silent no-op");
  assert.match(empty.data.error, /who is finishing/i);
  env.DB.close();
});

test("the route is scoped to the caller's org — another org's session is a 404, and says nothing more", async () => {
  const { env, token, sessionId } = await night({ entered: 4 });
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (2,'Other','other',1)");
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},2,'admin')`);

  const w = await call(env, "POST", `/api/admin/kotc/${sessionId}/withdraw`,
    { token, org: "2", body: { contact_id: 1 } });
  assert.equal(w.status, 404, JSON.stringify(w.data));
  // Unchanged in org 1, which is the assertion that proves the 404 was a refusal and not a coincidence.
  const row = env.DB.one("SELECT withdrawn_at FROM kotc_players WHERE session_id=?1 AND contact_id=1", sessionId);
  assert.equal(row.withdrawn_at, null, "a cross-org call must not have written anything");
  env.DB.close();
});

test("staff-only: an unauthenticated withdraw does not write", async () => {
  const { env, token, sessionId } = await night({ entered: 4 });
  const w = await call(env, "POST", `/api/admin/kotc/${sessionId}/withdraw`, { body: { contact_id: 1 } });
  assert.ok(w.status === 401 || w.status === 403, `expected a refusal, got ${w.status}`);
  const row = env.DB.one("SELECT withdrawn_at FROM kotc_players WHERE session_id=?1 AND contact_id=1", sessionId);
  assert.equal(row.withdrawn_at, null, "and nothing was written");
  env.DB.close();
});

/* ==================== wiring ==================== */

test("the withdraw route is reachable as a CALL SITE, and shares one re-pair rule with the drag", () => {
  /* Assert the dispatch entry, never the definition — and assert that `repairUnplayed` is defined ONCE
     and used by BOTH routes. Two copies of "a finished game is never rewritten" is the defect this
     extraction exists to prevent, and it has no visible symptom. */
  const src = readFileSync(new URL("../src/kotcplay.js", import.meta.url), "utf8");
  assert.match(src, /p\.match\(\/\^\\\/api\\\/admin\\\/kotc\\\/\(\\d\+\)\\\/withdraw\$\/\)\) && m === "POST"/,
    "the withdraw route has no dispatch entry — built, tested and uncalled (failure class 1)");

  assert.equal((src.match(/async function repairUnplayed\(/g) || []).length, 1,
    "one re-pair rule, defined once");
  /* Strip comments before counting call sites: this file's own prose names `repairUnplayed` several
     times, and a guard tripped by its own comments has happened four times in two sessions. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const calls = (code.match(/await repairUnplayed\(/g) || []).length;
  assert.equal(calls, 2, `both /move and /withdraw must call it — found ${calls} call site(s) in code`);

  // The control for the stripping itself: it must really remove prose, or the count above is measuring comments.
  assert.ok(/repairUnplayed/.test(src.match(/\/\*[\s\S]*?\*\//g).join("\n")),
    "this file's comments do mention repairUnplayed, so the strip is load-bearing");
  assert.ok(!/two routes that re-seat people/i.test(code), "the comment stripper must actually strip");

  // The response is the board, the same discipline the move route set.
  assert.ok(src.includes("...(await boardPayload(env, ctx.orgId, sessionId)),\n      ...(await roster(env, ctx.orgId, sessionId)),"),
    "the withdraw response must hand back the same board and roster the GET returns");
});
