/**
 * Boomtown Platform — King / Queen of the Court, the playable surface
 * File: worker/src/kotcplay.js · Version: v1.2 · Date: 2026-08-04 · Ships in: v0.87.0
 *
 * v1.2 (2026-08-04, v0.87.0): `POST /api/admin/kotc/:id/withdraw` — finished for the night, and back
 *   in again. `withdrawn_at` shipped in migration 0042 and was READ in seven places from that day with
 *   NOTHING ever writing it: built-and-uncalled from the far end, where the state existed and could not
 *   be caused. Five of twenty-four players left before round 3 of the owner's real tournament. The
 *   withdraw frees their seat as well as setting the flag, because `nextRound` seats the next round from
 *   the previous round's nets and a slot left behind carries somebody who has gone home into round 3.
 *   Also extracted `repairUnplayed`, now shared by `/move` and `/withdraw`: two routes that re-seat
 *   people must not own two copies of "a finished game is never rewritten".
 *
 * v1.1 (2026-08-04, v0.86.0): the three routes the other two screens needed, and the two screens.
 *   Recorded because the previous handoff said this module's API was "complete and tested": it was
 *   complete for ONE screen of three. Five routes and then `return null`. Added —
 *     · GET  /api/admin/kotc            — the session list. The staff read below takes an id and
 *       nothing could discover one, so the board was unreachable: failure class 1 with the pieces
 *       the other way round, a working route no caller could name.
 *     · POST /api/admin/kotc/:id/move   — the drag. Never refuses; swaps on an occupied seat; and
 *       never rewrites a finished game, which is the invariant with its own test.
 *     · GET  /api/live/kotc/:id         — the public individual leaderboard. Abbreviated names, no
 *       roster, NO score links. Owner chose a separate page over a third shape on the live board.
 *   Also: the staff GET's payload became `boardPayload`, shared with every move response, so a drag
 *   and a refresh cannot render two different evenings.
 *
 * The engine is `kotc.js` — pure, no database, and it stays that way. This module is the plumbing: a
 * session, an entry list, a seating per round, and the scoring links people actually use.
 *
 * Owner 2026-08-03, on how a net's score reaches the system:
 *   "lets do both - but ideally 1 person fill it out for everyone would be nice. then back up each
 *    person can get a link and if submitted first, the link resolves to confirm - yes or no - then edit."
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHAPE THAT ANSWER ASKS FOR, and why it is better than what v0.79.0 built.
 *
 * v0.79.0 built a SYMMETRIC model: everyone reports, `reconcile` merges, disagreements come back as
 * disputes with two versions and no answer. That is defensible and it is not what the owner described.
 * His flow has a current answer on the table at all times:
 *
 *   1. Whoever gets there first enters the scores — ideally all of them, for the whole net.
 *   2. Anyone else opening their link is shown what was entered and asked to CONFIRM: yes or no.
 *   3. "No" leads to an edit, which becomes the new current answer.
 *
 * So the second person through the door is not competing with the first, they are CHECKING them. There
 * is never a state where the software holds two scorelines and cannot say which is real — and
 * disagreement is a person saying so, on the record, rather than a collision the code has to arbitrate.
 *
 * `reconcile` from v0.79.0 is not wasted: it is what the admin board uses to show a director where the
 * checking has and has not happened. But it is no longer the write path.
 *
 * AN EDIT RESETS EVERYONE ELSE TO 'pending'. A confirmation is about specific numbers, so it is stale the
 * moment those numbers change. Carrying confirmations forward would put three ticks against a scoreline
 * only its author has seen, which is worse than no ticks at all.
 *
 * THE LINK IS THE CREDENTIAL — no session, no login. Same contract as `/api/score/:token` for captains
 * (registrations.js), same token shape, so there is one convention rather than two. A player standing on
 * a grass court with one bar of signal is not going to sign in.
 * ══════════════════════════════════════════════════════════════════════════════════════════════════
 */
import {
  seedRound, gamesForRound, nextRound, tally, rankPlayers, solveNet, netPlan, NET_SIZES,
} from "./kotc.js";
import { personName } from "./names.js";

let json, requireStaff, audit;
export function wireKotc(h) { ({ json, requireStaff, audit } = h); }

/** Same shape as every other capability token here: 24 hex characters. */
const mintToken = () =>
  [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, "0")).join("");

/* ─────────────────────────── shared reads ─────────────────────────── */

async function loadRound(env, orgId, roundId) {
  const slots = (await env.DB.prepare(
    /* `slot_id`, not `id` (v0.86.0): the move route addresses a seat by its own row, and a bare `id`
       beside `contact_id` in the same object is the kind of ambiguity that eventually binds the wrong
       one. Nothing else reads it; the view builders name their fields explicitly. */
    `SELECT s.id AS slot_id, s.net_no, s.seat, s.contact_id, s.confirmed, s.confirmed_at, c.full_name
       FROM kotc_slots s LEFT JOIN contacts c ON c.id = s.contact_id AND c.deleted_at IS NULL
      WHERE s.org_id=?1 AND s.round_id=?2 AND s.deleted_at IS NULL
      ORDER BY s.net_no, s.seat`
  ).bind(orgId, roundId).all()).results || [];
  const games = (await env.DB.prepare(
    `SELECT id, net_no, game_no, a1_contact_id, a2_contact_id, b1_contact_id, b2_contact_id,
            score_a, score_b, points_to, entered_by_contact_id, entered_at
       FROM kotc_games WHERE org_id=?1 AND round_id=?2 AND deleted_at IS NULL
      ORDER BY net_no, game_no`
  ).bind(orgId, roundId).all()).results || [];
  return { slots, games };
}

/** Nets as the engine wants them: `[{ net_no, seats: [contactId] }]`, seat order preserved. */
const netsFrom = (slots) => {
  const by = new Map();
  for (const s of slots) {
    if (!by.has(s.net_no)) by.set(s.net_no, []);
    by.get(s.net_no)[s.seat] = s.contact_id;
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0])
    .map(([net_no, seats]) => ({ net_no, seats: seats.filter((x) => x != null) }));
};

/**
 * Re-pair the UNPLAYED games on every net whose line-up just changed, and report what it did.
 *
 * FINISHED IS FINISHED. `kotc_games` stores the four players ON the game row (a1/a2/b1/b2) rather than
 * a reference to the seating — that is what lets the leaderboard be derived from games alone with no
 * stored counter to disagree with. The cost is that re-pairing *could* retroactively change who played
 * a game that already has scores, and because the leaderboard is derived, the evening would be silently
 * restated. Nothing on any screen would look wrong. So a game with BOTH scores in is never touched.
 *
 * This is shared by the drag (`/move`) and by withdrawing somebody (`/withdraw`) deliberately. Two
 * routes that both re-seat people must not own two copies of this rule: the day they diverge is the day
 * one of them starts rewriting history and the other does not, and the invariant has no visible symptom
 * to catch it. Same reasoning the player POST gives for making submit and dispute one write path.
 *
 * A net that is not 4 or 5 is REPORTED, NOT REPAIRED. `rotation()` throws for any other size and
 * `dispatch` treats a throw as a decline, which would turn a route into a silent 404 — the worst way
 * for a director's action to fail. Its unplayed games keep the previous line-up and the caller says so
 * in a sentence (brackets.js precedent: warns, never refuses).
 */
async function repairUnplayed(env, orgId, roundId, netNos) {
  const after = await loadRound(env, orgId, roundId);
  const short = [];
  let repaired = 0, kept = 0;

  for (const net of netsFrom(after.slots).filter((n) => netNos.includes(n.net_no))) {
    if (!NET_SIZES.includes(net.seats.length)) {
      short.push({ net_no: net.net_no, players: net.seats.length });
      continue;
    }
    for (const g of gamesForRound([net])) {
      const row = after.games.find((y) => y.net_no === g.net_no && y.game_no === g.game_no);
      if (!row) continue;
      if (row.score_a !== null && row.score_b !== null) { kept++; continue; }
      if (row.a1_contact_id === g.a1_contact_id && row.a2_contact_id === g.a2_contact_id &&
          row.b1_contact_id === g.b1_contact_id && row.b2_contact_id === g.b2_contact_id) continue;
      await env.DB.prepare(
        `UPDATE kotc_games SET a1_contact_id=?1, a2_contact_id=?2, b1_contact_id=?3, b2_contact_id=?4,
                               updated_at=datetime('now')
          WHERE id=?5 AND org_id=?6`
      ).bind(g.a1_contact_id, g.a2_contact_id, g.b1_contact_id, g.b2_contact_id, row.id, orgId).run();
      repaired++;
    }
  }

  /* A re-pair changes who is being asked what, so a confirmation given against the old line-up is stale
     for the same reason an edit makes one stale. Only nets whose unplayed games actually moved are
     reset — nudging seats on a net that is already finished should not un-tick four people for nothing. */
  if (repaired) {
    await env.DB.prepare(
      `UPDATE kotc_slots SET confirmed='pending', confirmed_at=NULL, updated_at=datetime('now')
        WHERE org_id=?1 AND round_id=?2 AND net_no IN (${netNos.map(() => "?").join(",")})
          AND deleted_at IS NULL`
    ).bind(orgId, roundId, ...netNos).run();
  }

  /** The sentence a short net needs, so both callers say the same thing about the same state. */
  const shortNote = short.length
    ? `Net ${short.map((s) => s.net_no).join(", ")} now has an odd number of players; its games still show the old pairings until it is back to four or five.`
    : "";

  return { short, repaired, kept, shortNote };
}

/* ─────────────────────────── routes ─────────────────────────── */

export async function kotcRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;

  /* ══════════ the player's link — no login, the token IS the credential ══════════ */

  if ((x = p.match(/^\/api\/kotc\/([a-f0-9]{16,64})$/))) {
    const player = await env.DB.prepare(
      `SELECT pl.id, pl.org_id, pl.session_id, pl.contact_id, pl.withdrawn_at,
              se.name AS session_name, se.points_to, se.status,
              c.full_name
         FROM kotc_players pl
         JOIN kotc_sessions se ON se.id = pl.session_id AND se.deleted_at IS NULL
         LEFT JOIN contacts c ON c.id = pl.contact_id AND c.deleted_at IS NULL
        WHERE pl.score_token=?1 AND pl.deleted_at IS NULL`
    ).bind(x[1]).first();
    // A bad token is a 404, not a 403: "wrong link" tells somebody a real one exists.
    if (!player) return json({ error: "That link isn't valid any more. Ask whoever is running the night." }, 404);

    const round = await env.DB.prepare(
      `SELECT r.id, r.round_no FROM kotc_rounds r
        WHERE r.org_id=?1 AND r.session_id=?2 AND r.deleted_at IS NULL
        ORDER BY r.round_no DESC LIMIT 1`
    ).bind(player.org_id, player.session_id).first();
    if (!round) return json({ error: "The first round hasn't been set yet. Hang on." }, 409);

    /* FINISHED FOR THE NIGHT IS CHECKED BEFORE "are you on a net", and the order is the whole point.
       v0.87.0: withdrawing frees the player's seat, so a withdrawn player has no slot — and this route
       used to answer that state with "You're not on a net for this round. Find whoever is running the
       night," which sends somebody who has gone home to go and find the director. The 409 that migration
       0042 shipped for exactly this person was unreachable in exactly the state it was written for,
       because it sat below the seat check and inside the POST branch.

       It is a 200 rather than the POST's 409 because for a GET nothing has gone wrong: they asked what
       is happening and the answer is "you're done". The POST keeps its 409 — writing scores after being
       marked finished IS a conflict. */
    if (player.withdrawn_at) {
      if (m === "GET") {
        return json({
          session: player.session_name, round: round.round_no,
          you: personName(player.full_name, { full: true }),
          on_a_net: false,
          withdrawn: true,
          prompt: "You've been marked as finished for the night. Thanks for playing; your scores still count.",
        }, 200, { "Cache-Control": "no-store" });
      }
      return json({ error: "You've been marked as finished for the night." }, 409);
    }

    const { slots, games } = await loadRound(env, player.org_id, round.id);
    const mine = slots.find((s) => s.contact_id === player.contact_id);
    if (!mine) {
      // On the entry list but not on a net this round — a real state when somebody arrives late.
      return json({
        session: player.session_name, round: round.round_no,
        you: personName(player.full_name, { full: true }),
        on_a_net: false,
        prompt: "You're not on a net for this round. Find whoever is running the night.",
      }, 200, { "Cache-Control": "no-store" });
    }

    if (m === "GET") return json(playerView(player, round, slots, games, mine), 200, { "Cache-Control": "no-store" });

    if (m === "POST") {
      const b = await request.json().catch(() => ({}));
      const netGames = games.filter((g) => g.net_no === mine.net_no);
      const netSlots = slots.filter((s) => s.net_no === mine.net_no);

      /* ── CONFIRM: "yes, that's right" ──
         Only meaningful once somebody has entered something. Confirming an empty net would record a
         person vouching for nothing, and the board would show a tick against a net with no scores. */
      if (b.action === "confirm") {
        const entered = netGames.filter((g) => g.score_a !== null && g.score_b !== null).length;
        if (!entered) return json({ error: "There's nothing entered yet to confirm." }, 409);
        await env.DB.prepare(
          `UPDATE kotc_slots SET confirmed='confirmed', confirmed_at=datetime('now'), updated_at=datetime('now')
            WHERE org_id=?1 AND round_id=?2 AND contact_id=?3 AND deleted_at IS NULL`
        ).bind(player.org_id, round.id, player.contact_id).run();
        const after = await loadRound(env, player.org_id, round.id);
        return json({
          ok: true, confirmed: true,
          note: "Thanks. You've confirmed net " + mine.net_no + ".",
          ...playerView(player, round, after.slots, after.games, after.slots.find((s) => s.contact_id === player.contact_id)),
        }, 200, { "Cache-Control": "no-store" });
      }

      /* ── SUBMIT or DISPUTE-AND-EDIT: both write scores, and they are the same operation ──
         The owner's flow makes "no, and here it is" the correction path, so an edit IS a submission with
         a different provenance. Splitting them into two routes would give two write paths to the same
         six numbers, and the day they diverge is the day the leaderboard and the games disagree. */
      const editing = b.action === "dispute" || netGames.some((g) => g.score_a !== null && g.score_b !== null);
      const sent = Array.isArray(b.games) ? b.games : [];
      const sentTotals = Object.keys(b.totals || {}).length > 0 || Number.isFinite(Number(b.my_total));
      if (!sent.length && !sentTotals) {
        // Totals with no game scores at all IS a legitimate submission — the solver exists precisely so
        // that somebody who only remembers their own points is still useful.
        return json({ error: "Send the scores you know, or a points total." }, 400);
      }

      // Merge what was sent over what is already there. A field nobody sent is left alone rather than
      // nulled — a partial submission must not wipe somebody else's work.
      const merged = netGames.map((g) => {
        const s = sent.find((y) => Number(y.game_no) === g.game_no) || {};
        const pick = (v, fallback) => (v === undefined ? fallback : (v === null || v === "" ? null : Number(v)));
        return {
          ...g,
          a1: g.a1_contact_id, a2: g.a2_contact_id, b1: g.b1_contact_id, b2: g.b2_contact_id,
          score_a: pick(s.score_a, g.score_a),
          score_b: pick(s.score_b, g.score_b),
        };
      });

      // The v0.79.0 solver fills in what follows from what was given. It never guesses — a game it
      // cannot pin comes back unresolved, and unresolved games are simply left unwritten.
      const totals = {};
      if (Number.isFinite(Number(b.my_total))) totals[player.contact_id] = Number(b.my_total);
      for (const [id, v] of Object.entries(b.totals || {})) {
        if (Number.isFinite(Number(v))) totals[id] = Number(v);
      }
      const solved = solveNet(merged, totals, {
        seats: netSlots.sort((a2, b2) => a2.seat - b2.seat).map((s) => s.contact_id),
        pointsTo: player.points_to || 21,
      });
      if (solved.contradiction) return json({ error: solved.contradiction }, 400);

      let written = 0;
      for (const g of solved.games) {
        if (g.score_a === null || g.score_b === null) continue;
        const row = netGames.find((y) => y.game_no === g.game_no);
        if (!row) continue;
        if (row.score_a === g.score_a && row.score_b === g.score_b) continue;   // unchanged
        await env.DB.prepare(
          `UPDATE kotc_games SET score_a=?1, score_b=?2, entered_by_contact_id=?3,
                                 entered_at=datetime('now'), updated_at=datetime('now')
            WHERE id=?4 AND org_id=?5`
        ).bind(g.score_a, g.score_b, player.contact_id, row.id, player.org_id).run();
        written++;
      }

      /* EVERYONE ELSE GOES BACK TO 'pending', and the submitter counts as having confirmed their own
         numbers. A confirmation is about specific numbers; once they change it is stale, and three ticks
         against a scoreline only its author has seen is worse than no ticks at all. */
      if (written) {
        await env.DB.prepare(
          `UPDATE kotc_slots SET confirmed='pending', confirmed_at=NULL, updated_at=datetime('now')
            WHERE org_id=?1 AND round_id=?2 AND net_no=?3 AND contact_id<>?4 AND deleted_at IS NULL`
        ).bind(player.org_id, round.id, mine.net_no, player.contact_id).run();
      }
      await env.DB.prepare(
        `UPDATE kotc_slots SET confirmed=?1, confirmed_at=datetime('now'), updated_at=datetime('now')
          WHERE org_id=?2 AND round_id=?3 AND contact_id=?4 AND deleted_at IS NULL`
      ).bind(written ? "confirmed" : "disputed", player.org_id, round.id, player.contact_id).run();

      const after = await loadRound(env, player.org_id, round.id);
      return json({
        ok: true,
        wrote: written,
        derived: solved.games.filter((g) => g.derived).length,
        unresolved: solved.unresolved,
        note: (editing && written ? "Updated. " : written ? "Saved. " : "") +
          (solved.games.filter((g) => g.derived).length
            ? `We worked out ${solved.games.filter((g) => g.derived).length} score${solved.games.filter((g) => g.derived).length === 1 ? "" : "s"} from what you gave us. ` : "") +
          (solved.unresolved.length
            ? `Game ${solved.unresolved.join(", ")} still needs a score.`
            : "That's the whole net done.") +
          (written && editing ? " Everyone else has been asked to check it again." : ""),
        ...playerView(player, round, after.slots, after.games, after.slots.find((s) => s.contact_id === player.contact_id)),
      }, 200, { "Cache-Control": "no-store" });
    }
  }

  /* ══════════ admin ══════════ */

  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/kotc$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const ev = await env.DB.prepare(
      "SELECT id FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(eventId, ctx.orgId).first();
    if (!ev) return json({ error: "That event doesn't exist." }, 404);

    const moveUp = Math.max(1, Number(b.move_up) || 1);
    const ins = await env.DB.prepare(
      `INSERT INTO kotc_sessions (org_id, event_id, name, move_up, points_to, rounds_planned)
       VALUES (?1,?2,?3,?4,?5,?6)`
    ).bind(ctx.orgId, eventId, String(b.name || "King of the Court").slice(0, 80),
           moveUp, Number(b.points_to) > 0 ? Number(b.points_to) : 21,
           Number(b.rounds_planned) || null).run();
    await audit(env, ctx, "kotc.session.create", "kotc_sessions", ins.meta.last_row_id, { move_up: moveUp });
    return json({ ok: true, session_id: ins.meta.last_row_id, move_up: moveUp });
  }

  if ((x = p.match(/^\/api\/admin\/kotc\/(\d+)\/players$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const sessionId = +x[1];
    const b = await request.json().catch(() => ({}));
    const se = await env.DB.prepare(
      "SELECT id FROM kotc_sessions WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(sessionId, ctx.orgId).first();
    if (!se) return json({ error: "That session doesn't exist." }, 404);

    const list = Array.isArray(b.players) ? b.players : [];
    // Every contact checked BEFORE anything is written — a refusal halfway through leaves half a roster.
    const ids = list.map((q) => Number(q.contact_id || q)).filter(Boolean);
    if (!ids.length) return json({ error: "Send at least one player." }, 400);
    const known = new Set(((await env.DB.prepare(
      `SELECT id FROM contacts WHERE org_id=?1 AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`
    ).bind(ctx.orgId, ...ids).all()).results || []).map((c) => c.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length) return json({ error: "One of those people isn't in this organisation." }, 400);

    let added = 0;
    for (const q of list) {
      const cid = Number(q.contact_id || q);
      // Every player gets a link at entry. Minting on demand later would mean the backup path only works
      // for people somebody remembered to prepare, which is the opposite of a backup.
      /* THE CONFLICT TARGET MUST REPEAT THE INDEX'S PREDICATE. `idx_kotc_players_once` is a PARTIAL
         unique index (`WHERE deleted_at IS NULL`), as every uniqueness rule here is, so that a withdrawn
         row never blocks a re-entry. SQLite will not match a partial index from a bare conflict target —
         it answers "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" — so the
         WHERE is restated. Re-adding somebody must update their seed and NOT mint a second token: their
         link is already written on a card or in a text message. */
      await env.DB.prepare(
        `INSERT INTO kotc_players (org_id, session_id, contact_id, score_token, seed)
         VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(org_id, session_id, contact_id) WHERE deleted_at IS NULL
           DO UPDATE SET seed=excluded.seed, updated_at=datetime('now')`
      ).bind(ctx.orgId, sessionId, cid, mintToken(), Number(q.seed) || null).run();
      added++;
    }
    await audit(env, ctx, "kotc.players", "kotc_sessions", sessionId, { count: added });
    return json({ ok: true, players: added, ...(await roster(env, ctx.orgId, sessionId)) });
  }

  if ((x = p.match(/^\/api\/admin\/kotc\/(\d+)\/round$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const sessionId = +x[1];
    const se = await env.DB.prepare(
      "SELECT id, move_up, points_to FROM kotc_sessions WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(sessionId, ctx.orgId).first();
    if (!se) return json({ error: "That session doesn't exist." }, 404);

    const last = await env.DB.prepare(
      `SELECT id, round_no FROM kotc_rounds WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL
        ORDER BY round_no DESC LIMIT 1`
    ).bind(ctx.orgId, sessionId).first();

    let nets;
    if (!last) {
      // Round 1 is dealt from the entry list, best seed on net 1.
      const players = (await env.DB.prepare(
        `SELECT contact_id, seed FROM kotc_players
          WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL AND withdrawn_at IS NULL
          ORDER BY COALESCE(seed, 9999), contact_id`
      ).bind(ctx.orgId, sessionId).all()).results || [];
      const plan = netPlan(players.length);
      if (!plan.ok) return json({ error: plan.error, would_work: plan.would_work }, 409);
      const seeded = seedRound(players.map((q) => q.contact_id));
      nets = seeded.nets;
    } else {
      // Every later round is movement, from THAT round's scores.
      const prev = await loadRound(env, ctx.orgId, last.id);
      const played = prev.games.filter((g) => g.score_a !== null && g.score_b !== null);
      if (!played.length) {
        return json({ error: "No scores are in for the current round yet, so there is nothing to move on." }, 409);
      }
      const moved = nextRound(netsFrom(prev.slots), tally(prev.games.map((g) => ({ ...g }))), { moveUp: se.move_up });
      if (!moved.ok) return json({ error: moved.error }, 409);
      nets = moved.nets;
    }

    /* ── EVERY NET MUST BE A SIZE THE ENGINE CAN PAIR, CHECKED BEFORE ANYTHING IS WRITTEN ──
       `gamesForRound` below calls `rotation()`, which THROWS for any size that is not 4 or 5, and
       `dispatch` turns a throw into a 500. The round row and all of its slots are inserted ABOVE this
       point, so the throw used to leave a half-written round behind: a round with seating and no games,
       which no screen can show and nothing cleans up.

       v0.87.0 made the state easy to reach — withdrawing somebody for the night takes their net from
       four to three — but the drag could already produce it by benching a player, so this was always
       reachable and always a 500. It fails closed with a human sentence instead, naming the nets and
       what to do about them.

       This is NOT the redistribution fix. Ranking and redistributing over the nets that EXIST is
       handoff §6.3, and it is what will make this refusal rare rather than routine. Until then the
       director's move is the drag board, which is the mechanism the owner actually uses. */
    const unpairable = nets.filter((n) => !NET_SIZES.includes(n.seats.length));
    if (unpairable.length) {
      return json({
        error: `Net ${unpairable.map((n) => n.net_no).join(", ")} would have ${unpairable.map((n) => n.seats.length).join(", ")} players, and a net has to have four or five. Move people about on the board first, then start the round.`,
        nets: nets.map((n) => ({ net_no: n.net_no, players: n.seats.length })),
      }, 409);
    }

    const roundNo = last ? last.round_no + 1 : 1;
    const r = await env.DB.prepare(
      "INSERT INTO kotc_rounds (org_id, session_id, round_no) VALUES (?1,?2,?3)"
    ).bind(ctx.orgId, sessionId, roundNo).run();
    const roundId = r.meta.last_row_id;

    for (const net of nets) {
      for (let seat = 0; seat < net.seats.length; seat++) {
        await env.DB.prepare(
          "INSERT INTO kotc_slots (org_id, round_id, net_no, seat, contact_id) VALUES (?1,?2,?3,?4,?5)"
        ).bind(ctx.orgId, roundId, net.net_no, seat, net.seats[seat]).run();
      }
    }
    for (const g of gamesForRound(nets)) {
      await env.DB.prepare(
        `INSERT INTO kotc_games (org_id, round_id, net_no, game_no,
                                 a1_contact_id, a2_contact_id, b1_contact_id, b2_contact_id, points_to)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
      ).bind(ctx.orgId, roundId, g.net_no, g.game_no,
             g.a1_contact_id, g.a2_contact_id, g.b1_contact_id, g.b2_contact_id, se.points_to).run();
    }
    await audit(env, ctx, "kotc.round", "kotc_rounds", roundId, { round_no: roundNo, nets: nets.length });
    return json({ ok: true, round_no: roundNo, nets: nets.map((n) => ({ net_no: n.net_no, players: n.seats.length })) });
  }

  /* THE SESSION LIST — without it the board cannot be reached at all (v0.86.0).
     The staff read below takes an id, and until this route existed there was no way to discover one:
     a director had to already know the number. That is failure class 1 wearing a different hat — the
     route worked perfectly and nothing could call it. Newest first, because the session a director
     wants is almost always the one they just made. */
  if (p === "/api/admin/kotc" && m === "GET") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const rows = (await env.DB.prepare(
      `SELECT se.id, se.name, se.status, se.move_up, se.points_to, se.created_at,
              se.event_id, ev.name AS event_name,
              (SELECT COUNT(*) FROM kotc_players pl
                WHERE pl.org_id = se.org_id AND pl.session_id = se.id
                  AND pl.deleted_at IS NULL AND pl.withdrawn_at IS NULL) AS players,
              (SELECT MAX(r.round_no) FROM kotc_rounds r
                WHERE r.org_id = se.org_id AND r.session_id = se.id AND r.deleted_at IS NULL) AS rounds
         FROM kotc_sessions se
         LEFT JOIN events ev ON ev.id = se.event_id AND ev.deleted_at IS NULL
        WHERE se.org_id = ?1 AND se.deleted_at IS NULL
        ORDER BY se.id DESC
        LIMIT 50`
    ).bind(ctx.orgId).all()).results || [];
    return json({
      sessions: rows.map((r) => ({
        id: r.id, name: r.name, status: r.status, move_up: r.move_up, points_to: r.points_to,
        event_id: r.event_id,
        // A deleted event leaves the session readable rather than nameless — modules degrade, they
        // do not collapse (owner). The board still opens; the heading just says less.
        event: r.event_name || "Event no longer listed",
        players: r.players || 0,
        rounds: r.rounds || 0,
      })),
    });
  }

  /* ══════════ THE DRAG: move a person to a net and a seat ══════════
     Schedule-editor precedent (formats.js, admin-schedule-editor.js): IT NEVER REFUSES A MOVE. A
     director always knows something the seeding does not — she came with her sister, he is leaving at
     eight, those two have played each other all night. A tool that blocks them is a tool they route
     around, and then the real board is a whiteboard again.

     Dropping on an occupied seat SWAPS the two, exactly as dragging a match onto a taken court does.
     Overwriting would silently un-seat somebody the director never mentioned.

     ══ AND IT MUST NOT REWRITE HISTORY. ══
     `kotc_games` stores the four players ON the game row (a1/a2/b1/b2), not a reference to the seating.
     That is deliberate — it is what lets the leaderboard be derived from games alone. It also means a
     re-seat could retroactively change who played a game that is already scored, and the leaderboard,
     being derived, would silently restate the evening. So: a game with BOTH scores in is FINISHED and
     is never touched. Only unplayed rows are re-paired to the new line-up. That invariant has its own
     test, because nothing about it is visible from the screen. */
  if ((x = p.match(/^\/api\/admin\/kotc\/(\d+)\/move$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const sessionId = +x[1];
    const se = await env.DB.prepare(
      "SELECT id, points_to FROM kotc_sessions WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(sessionId, ctx.orgId).first();
    if (!se) return json({ error: "That session doesn't exist." }, 404);

    const b = await request.json().catch(() => ({}));
    const contactId = Number(b.contact_id);
    const netNo = Number(b.net_no);
    const seat = Number(b.seat);
    /* A malformed request is not a refused move. The rule is that the board never tells a director
       "no, you may not put her there" — it says nothing about a body with no net in it. */
    if (!contactId || !Number.isInteger(netNo) || netNo < 1 || !Number.isInteger(seat) || seat < 0) {
      return json({ error: "Say who is moving, and which net and seat they are moving to." }, 400);
    }

    const round = await env.DB.prepare(
      `SELECT id, round_no FROM kotc_rounds
        WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL ORDER BY round_no DESC LIMIT 1`
    ).bind(ctx.orgId, sessionId).first();
    // Not a refusal either: there is no seating yet to move anybody within.
    if (!round) return json({ error: "There's no round on the board yet. Start one first." }, 409);

    const { slots } = await loadRound(env, ctx.orgId, round.id);
    const mover = slots.find((s) => s.contact_id === contactId);
    const occupant = slots.find((s) => s.net_no === netNo && s.seat === seat);

    if (mover && mover.net_no === netNo && mover.seat === seat) {
      return json({
        ok: true, moved: false, note: "They were already there.",
        ...(await boardPayload(env, ctx.orgId, sessionId)),
        ...(await roster(env, ctx.orgId, sessionId)),
      });
    }

    /* Somebody not seated this round can still be dragged on — a late arrival is a real Tuesday, and
       the player screen already has an `on_a_net: false` state for exactly this person. They do have
       to be on the entry list: seating a contact who never entered is not a move, it is an entry, and
       it belongs to the players route which mints their link. */
    if (!mover) {
      const entered = await env.DB.prepare(
        `SELECT contact_id FROM kotc_players
          WHERE org_id=?1 AND session_id=?2 AND contact_id=?3 AND deleted_at IS NULL`
      ).bind(ctx.orgId, sessionId, contactId).first();
      if (!entered) {
        return json({ error: "They're not on the entry list for this session. Add them to it first; that's what mints their link." }, 400);
      }
    }

    /* ── the writes ──
       `idx_kotc_slots_seat` is UNIQUE on (org_id, round_id, net_no, seat) WHERE deleted_at IS NULL, so
       a swap written as two plain UPDATEs collides at the halfway point — SQLite has no deferred
       constraint to hide behind. The mover is parked on an impossible seat first. The park uses the
       mover's own row id, so two directors dragging at the same moment cannot pick the same parking
       space (net -1, seat -1 would have been a race with one slot in it). */
    const stmts = [];
    let swappedWith = null, benched = null;

    if (mover && occupant) {
      swappedWith = occupant;
      stmts.push(
        env.DB.prepare("UPDATE kotc_slots SET net_no=-1, seat=?1, updated_at=datetime('now') WHERE id=?2 AND org_id=?3")
          .bind(-mover.slot_id - 1, mover.slot_id, ctx.orgId),
        env.DB.prepare("UPDATE kotc_slots SET net_no=?1, seat=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4")
          .bind(mover.net_no, mover.seat, occupant.slot_id, ctx.orgId),
        env.DB.prepare("UPDATE kotc_slots SET net_no=?1, seat=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4")
          .bind(netNo, seat, mover.slot_id, ctx.orgId),
      );
    } else if (mover) {
      stmts.push(
        env.DB.prepare("UPDATE kotc_slots SET net_no=?1, seat=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4")
          .bind(netNo, seat, mover.slot_id, ctx.orgId),
      );
    } else {
      /* An unseated player dropped onto a taken seat means the occupant comes off — subbing somebody
         out is the other half of a late arrival, and refusing it would be refusing a move. Their slot
         is SOFT-deleted, so every partial unique index here (all `WHERE deleted_at IS NULL`) lets the
         seat be re-filled, and the row survives for the audit. */
      if (occupant) {
        benched = occupant;
        stmts.push(
          env.DB.prepare("UPDATE kotc_slots SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?1 AND org_id=?2")
            .bind(occupant.slot_id, ctx.orgId),
        );
      }
      stmts.push(
        env.DB.prepare("INSERT INTO kotc_slots (org_id, round_id, net_no, seat, contact_id) VALUES (?1,?2,?3,?4,?5)")
          .bind(ctx.orgId, round.id, netNo, seat, contactId),
      );
    }
    await env.DB.batch(stmts);

    /* ── re-pair the UNPLAYED games on every net this touched ──
       The rule itself lives in `repairUnplayed`, shared with `/withdraw`, because both routes re-seat
       people and neither may own a private copy of "finished is finished". */
    const touched = [...new Set([netNo, ...(mover ? [mover.net_no] : []), ...(benched ? [benched.net_no] : [])])];
    const { short, repaired, kept, shortNote } = await repairUnplayed(env, ctx.orgId, round.id, touched);

    await audit(env, ctx, "kotc.move", "kotc_rounds", round.id, {
      contact_id: contactId, to_net: netNo, to_seat: seat,
      swapped_with: swappedWith ? swappedWith.contact_id : null,
      benched: benched ? benched.contact_id : null,
      games_repaired: repaired, games_kept: kept,
    });

    const who = (s) => personName(s.full_name, { full: true });
    return json({
      ok: true,
      moved: true,
      swapped_with: swappedWith ? { contact_id: swappedWith.contact_id, name: who(swappedWith) } : null,
      benched: benched ? { contact_id: benched.contact_id, name: who(benched) } : null,
      games_repaired: repaired,
      games_kept: kept,
      short_nets: short,
      note: [
        swappedWith ? `Swapped with ${who(swappedWith)}.`
          : benched ? `${who(benched)} came off net ${netNo}.`
          : `Moved to net ${netNo}.`,
        kept ? `${kept} game${kept === 1 ? "" : "s"} already scored, left exactly as played.` : "",
        repaired ? "The remaining games were re-paired, so everyone on those nets has been asked to check again." : "",
        shortNote,
      ].filter(Boolean).join(" "),
      /* BOTH HALVES OF THE BOARD, and the roster is not optional garnish (§-1r RF-6, 2026-08-18).
         `admin-kotc.js` does `data = r.data` — the response IS the next board, by design, so that the
         page can never patch its own seating — and it renders the withdrawn list from `data.roster`
         because the server deliberately keeps those people off the bench. Returning the board without
         the roster therefore blanked the withdrawn panel on every drag and took the only undo for a
         mis-tap with it. Measured: this is why the owner reported the court board as "not working". */
      ...(await boardPayload(env, ctx.orgId, sessionId)),
      ...(await roster(env, ctx.orgId, sessionId)),
    });
  }

  /* ══════════ finished for the night, and back in again ══════════

     `kotc_players.withdrawn_at` shipped in migration 0042 and has been READ in seven places ever since
     — the player link 409s on it, round 1 deals around it, the bench hides them, the session list skips
     them in its count — and until now NOTHING WROTE IT. Built and uncalled from the other end: the
     column, the reads and the player's sentence all existed, and there was no way to cause the state.
     Five of twenty-four players left before round 3 of the owner's real tournament, two of them from
     the top four (reference run §4). This is the one thing the board could not express about a normal
     night.

     THE SEAT IS THE WHOLE PROBLEM, AND IT IS WHY THIS IS NOT A ONE-LINE UPDATE. Setting the flag alone
     would leave somebody holding a seat on a net while being excluded from the bench — a person with a
     net and no way off it, which is the exact failure `admin-kotc.js` refused to ship a client-side half
     of. Worse, `nextRound` builds the next round from the PREVIOUS round's nets, so a slot left in place
     carries somebody who has gone home into round 3. So the withdraw soft-deletes their slot, and the
     seat is then a real empty seat the director can drop somebody into.

     THEIR EVENING SURVIVES. The leaderboard is `rankPlayers(tally(allGames))` — derived from the games,
     with no stored per-player counter anywhere (migration 0040). Every point a withdrawn player won
     still counts, which is why the two who left from the top four still read as the top four. The
     `withdrawn_at IS NULL` filters are all about who is still PLAYABLE, never about who played.

     AND IT IS REVERSIBLE IN THE SAME ROUTE. A mis-tap at the side of a court must cost one tap to undo,
     so `withdrawn: false` clears the flag. They come back to the BENCH, not to a net: where somebody
     plays is the director's drag, and having this route guess a seat would be a second, hidden seating
     mechanism competing with the board. */
  if ((x = p.match(/^\/api\/admin\/kotc\/(\d+)\/withdraw$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const sessionId = +x[1];
    const se = await env.DB.prepare(
      "SELECT id FROM kotc_sessions WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(sessionId, ctx.orgId).first();
    if (!se) return json({ error: "That session doesn't exist." }, 404);

    const b = await request.json().catch(() => ({}));
    const contactId = Number(b.contact_id);
    if (!contactId) return json({ error: "Say who is finishing for the night." }, 400);
    /* Only an explicit `false` brings somebody back. A body that omitted the flag means what the route
       is named, which keeps the common case a one-field request from a tablet. */
    const leaving = b.withdrawn !== false;

    const entry = await env.DB.prepare(
      `SELECT pl.id, pl.withdrawn_at, c.full_name FROM kotc_players pl
         LEFT JOIN contacts c ON c.id = pl.contact_id AND c.deleted_at IS NULL
        WHERE pl.org_id=?1 AND pl.session_id=?2 AND pl.contact_id=?3 AND pl.deleted_at IS NULL`
    ).bind(ctx.orgId, sessionId, contactId).first();
    // Not on the list at all: the same sentence the drag gives, for the same reason — the entry list is
    // what mints their link, so this is an entry problem, not a withdrawal problem.
    if (!entry) {
      return json({ error: "They're not on the entry list for this session. Add them to it first; that's what mints their link." }, 400);
    }

    const who = personName(entry.full_name, { full: true });
    const board = async (extra) => json({
      ...extra,
      ...(await boardPayload(env, ctx.orgId, sessionId)),
      ...(await roster(env, ctx.orgId, sessionId)),
    });

    /* Already in the asked-for state. Two directors on two tablets tapping the same person is a Tuesday,
       not a conflict, so this is a 200 with the board — not a 409. The alternative would be a route that
       fails for a reason the director cannot see and cannot fix. */
    if (!!entry.withdrawn_at === leaving) {
      return board({
        ok: true, changed: false, withdrawn: leaving,
        note: leaving ? `${who} was already finished for the night.` : `${who} is already back in.`,
      });
    }

    const round = await env.DB.prepare(
      `SELECT id, round_no FROM kotc_rounds
        WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL ORDER BY round_no DESC LIMIT 1`
    ).bind(ctx.orgId, sessionId).first();

    await env.DB.prepare(
      `UPDATE kotc_players SET withdrawn_at=${leaving ? "datetime('now')" : "NULL"}, updated_at=datetime('now')
        WHERE id=?1 AND org_id=?2`
    ).bind(entry.id, ctx.orgId).run();

    let freed = null, repaired = 0, kept = 0, shortNote = "";
    if (leaving && round) {
      const { slots } = await loadRound(env, ctx.orgId, round.id);
      const seated = slots.find((s) => s.contact_id === contactId);
      if (seated) {
        freed = { net_no: seated.net_no, seat: seated.seat };
        /* SOFT delete: every partial unique index on `kotc_slots` is `WHERE deleted_at IS NULL`, so the
           seat becomes fillable again while the row survives for the audit. */
        await env.DB.prepare(
          "UPDATE kotc_slots SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?1 AND org_id=?2"
        ).bind(seated.slot_id, ctx.orgId).run();
        ({ repaired, kept, shortNote } = await repairUnplayed(env, ctx.orgId, round.id, [seated.net_no]));
      }
    }

    await audit(env, ctx, leaving ? "kotc.withdraw" : "kotc.reinstate", "kotc_sessions", sessionId, {
      contact_id: contactId,
      round_id: round ? round.id : null,
      freed_net: freed ? freed.net_no : null,
      freed_seat: freed ? freed.seat : null,
      games_repaired: repaired, games_kept: kept,
    });

    return board({
      ok: true,
      changed: true,
      withdrawn: leaving,
      freed,
      games_repaired: repaired,
      games_kept: kept,
      note: leaving
        ? [
            `${who} is finished for the night.`,
            freed ? `Seat ${freed.seat + 1} on net ${freed.net_no} is free.` : "",
            "Their scores so far still count.",
            kept ? `${kept} game${kept === 1 ? "" : "s"} already scored, left exactly as played.` : "",
            repaired ? "The remaining games were re-paired, so everyone on that net has been asked to check again." : "",
            shortNote,
          ].filter(Boolean).join(" ")
        : `${who} is back in. Drag them onto a net when you're ready.`,
    });
  }

  if ((x = p.match(/^\/api\/admin\/kotc\/(\d+)$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const sessionId = +x[1];
    const exists = await env.DB.prepare(
      "SELECT id FROM kotc_sessions WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(sessionId, ctx.orgId).first();
    if (!exists) return json({ error: "That session doesn't exist." }, 404);
    return json({
      ...(await boardPayload(env, ctx.orgId, sessionId)),
      ...(await roster(env, ctx.orgId, sessionId)),
    });
  }

  /* ══════════ the public individual leaderboard ══════════
     Owner 2026-08-04, asked whether this belonged on the existing live board as a third shape or on
     its own page: A SEPARATE PAGE. `live.js` carries the v0.84.0 diff-animation engine and its own
     guard states it cannot see whether the motion looks good; nobody has eyeballed it yet, and a new
     section in there is a change to code that is one human review short of trusted. So this route is
     the only public surface KOTC adds, it lives in this module with the rest of KOTC, and `live.js`
     is not touched.

     It sits under `/api/live/` because that is already the public read namespace — one convention,
     not two. No `requireStaff`: same contract as the live board, org from the same X-Org-Id header
     every route uses, so a white-labelled site shows only its own sessions.

     WHAT IS DELIBERATELY NOT HERE, and it is the whole difference from the staff read: no roster, no
     score links, and names ABBREVIATED to "Ava S." (standards §8, `names.js` owns the rule). The
     staff payload's `roster` carries a `link` per player — a token that is the credential. Reusing
     the staff shape and trimming it in the page would publish every player's scoring link to anyone
     who opened devtools. The trim happens HERE, server-side, or it does not happen. */
  if ((x = p.match(/^\/api\/live\/kotc\/(\d+)$/)) && m === "GET") {
    const sessionId = +x[1];
    const se = await env.DB.prepare(
      `SELECT id, name, status, points_to FROM kotc_sessions
        WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
    ).bind(sessionId, ctx.orgId).first();
    if (!se) return json({ error: "That session isn't running." }, 404);

    const rounds = (await env.DB.prepare(
      `SELECT id, round_no FROM kotc_rounds WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL
        ORDER BY round_no`
    ).bind(ctx.orgId, sessionId).all()).results || [];

    const allGames = [];
    for (const rd of rounds) {
      const { games } = await loadRound(env, ctx.orgId, rd.id);
      allGames.push(...games);
    }

    const names = new Map(((await env.DB.prepare(
      `SELECT pl.contact_id, c.full_name FROM kotc_players pl
         LEFT JOIN contacts c ON c.id = pl.contact_id AND c.deleted_at IS NULL
        WHERE pl.org_id=?1 AND pl.session_id=?2 AND pl.deleted_at IS NULL`
    ).bind(ctx.orgId, sessionId).all()).results || []).map((q) => [q.contact_id, q.full_name]));

    return json({
      session: se.name,
      status: se.status,
      points_to: se.points_to,
      rounds: rounds.length,
      // The same derivation the staff board uses — rankPlayers(tally(games)) — so the public board and
      // the director's board can never disagree about who is winning. Only the NAMES differ.
      leaderboard: rankPlayers(tally(allGames)).map((row, i) => ({
        place: i + 1, ...row, name: personName(names.get(row.contact_id), {}),
      })),
    }, 200, { "Cache-Control": "no-store" });
  }

  return null;
}

/**
 * The board, exactly once.
 *
 * The staff GET and every `move` response return this same object. They were going to be two builders
 * — the GET's inline one and a smaller "just the nets" shape for a drag — and that is the mistake this
 * module already documents about write paths: two producers of the same six numbers diverge, and the
 * day they do, the screen after a drag and the screen after a refresh disagree about the evening. One
 * builder means a move response IS the next board, so the page re-renders from the server rather than
 * patching its own copy. Same discipline as `playerView` deciding `mode`.
 */
async function boardPayload(env, orgId, sessionId) {
  const se = await env.DB.prepare(
    `SELECT id, name, move_up, points_to, status FROM kotc_sessions
      WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
  ).bind(sessionId, orgId).first();

  const rounds = (await env.DB.prepare(
    `SELECT id, round_no FROM kotc_rounds WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL
      ORDER BY round_no`
  ).bind(orgId, sessionId).all()).results || [];

  const allGames = [];
  const board = [];
  for (const rd of rounds) {
    const { slots, games } = await loadRound(env, orgId, rd.id);
    allGames.push(...games);
    board.push({
      round_no: rd.round_no,
      nets: netsFrom(slots).map((n) => ({
        net_no: n.net_no,
        // Staff surface, so full names: this is who a director goes looking for.
        players: slots.filter((s) => s.net_no === n.net_no).sort((a2, b2) => a2.seat - b2.seat)
          .map((s) => ({
            contact_id: s.contact_id, seat: s.seat,
            name: personName(s.full_name, { full: true }), confirmed: s.confirmed,
          })),
        games: games.filter((g) => g.net_no === n.net_no)
          .map((g) => ({ game_no: g.game_no, score_a: g.score_a, score_b: g.score_b, entered_by: g.entered_by_contact_id })),
        // The question a director actually has: has anybody else looked at this net?
        checked: slots.filter((s) => s.net_no === n.net_no && s.confirmed === "confirmed").length,
        disputed: slots.filter((s) => s.net_no === n.net_no && s.confirmed === "disputed").length,
        complete: games.filter((g) => g.net_no === n.net_no).every((g) => g.score_a !== null && g.score_b !== null),
      })),
    });
  }

  const names = new Map(((await env.DB.prepare(
    `SELECT pl.contact_id, c.full_name FROM kotc_players pl
       LEFT JOIN contacts c ON c.id = pl.contact_id AND c.deleted_at IS NULL
      WHERE pl.org_id=?1 AND pl.session_id=?2 AND pl.deleted_at IS NULL`
  ).bind(orgId, sessionId).all()).results || []).map((q) => [q.contact_id, q.full_name]));

  /* Who is entered but not seated in the latest round — the bench. A late arrival and anybody a
     director has just subbed out both land here, and without it they would be invisible on the board
     and undraggable, which is the only state the drag cannot recover from. */
  const latest = rounds.length ? rounds[rounds.length - 1] : null;
  let benched = [];
  if (latest) {
    benched = ((await env.DB.prepare(
      `SELECT pl.contact_id, c.full_name FROM kotc_players pl
         LEFT JOIN contacts c ON c.id = pl.contact_id AND c.deleted_at IS NULL
        WHERE pl.org_id=?1 AND pl.session_id=?2 AND pl.deleted_at IS NULL AND pl.withdrawn_at IS NULL
          AND pl.contact_id NOT IN (
            SELECT s.contact_id FROM kotc_slots s
             WHERE s.org_id=?1 AND s.round_id=?3 AND s.deleted_at IS NULL)
        ORDER BY COALESCE(pl.seed, 9999), pl.contact_id`
    ).bind(orgId, sessionId, latest.id).all()).results || [])
      .map((r) => ({ contact_id: r.contact_id, name: personName(r.full_name, { full: true }) }));
  }

  return {
    session: se
      ? { id: se.id, name: se.name, move_up: se.move_up, points_to: se.points_to, status: se.status }
      : null,
    rounds: board,
    current_round: latest ? latest.round_no : null,
    bench: benched,
    // Derived from the games, every time. There is no stored per-player counter anywhere (migration 0040).
    leaderboard: rankPlayers(tally(allGames)).map((row, i) => ({
      place: i + 1, ...row, name: personName(names.get(row.contact_id), { full: true }),
    })),
  };
}

/** The entry list with each person's link, for a director handing them out. */
async function roster(env, orgId, sessionId) {
  const rows = (await env.DB.prepare(
    `SELECT pl.contact_id, pl.score_token, pl.seed, pl.withdrawn_at, c.full_name
       FROM kotc_players pl
       LEFT JOIN contacts c ON c.id = pl.contact_id AND c.deleted_at IS NULL
      WHERE pl.org_id=?1 AND pl.session_id=?2 AND pl.deleted_at IS NULL
      ORDER BY COALESCE(pl.seed, 9999), pl.contact_id`
  ).bind(orgId, sessionId).all()).results || [];
  return {
    roster: rows.map((r) => ({
      contact_id: r.contact_id,
      name: personName(r.full_name, { full: true }),
      seed: r.seed,
      withdrawn: !!r.withdrawn_at,
      link: r.score_token ? `/kotc.html?t=${r.score_token}` : null,
    })),
  };
}

/**
 * What one player sees on their link.
 *
 * The whole screen is decided by one question: has anybody entered anything yet? If not, they are the
 * first and get a blank net to fill in. If so, they are the checker and get "here is what was entered —
 * yes or no". Owner 2026-08-03, and it is why `mode` is computed here rather than left to the page: two
 * screens deciding this independently is two chances to show the wrong one.
 */
function playerView(player, round, slots, games, mine) {
  const netGames = games.filter((g) => g.net_no === mine.net_no);
  const netSlots = slots.filter((s) => s.net_no === mine.net_no).sort((a, b) => a.seat - b.seat);
  const entered = netGames.filter((g) => g.score_a !== null && g.score_b !== null);
  const complete = netGames.length > 0 && entered.length === netGames.length;

  return {
    session: player.session_name,
    round: round.round_no,
    net: mine.net_no,
    you: personName(player.full_name, { full: true }),
    on_a_net: true,
    points_to: player.points_to || 21,
    // Names on this screen are ABBREVIATED. It is reachable with no login by anyone holding a link, so
    // standards §8 applies exactly as it does to the public board.
    players: netSlots.map((s) => ({
      contact_id: s.contact_id,
      name: personName(s.full_name, {}),
      is_you: s.contact_id === player.contact_id,
      confirmed: s.confirmed,
    })),
    games: netGames.map((g) => ({
      game_no: g.game_no,
      a: [personName(nameOf(slots, g.a1_contact_id), {}), personName(nameOf(slots, g.a2_contact_id), {})],
      b: [personName(nameOf(slots, g.b1_contact_id), {}), personName(nameOf(slots, g.b2_contact_id), {})],
      score_a: g.score_a, score_b: g.score_b,
      entered_by: g.entered_by_contact_id ? personName(nameOf(slots, g.entered_by_contact_id), {}) : null,
    })),
    /* THE MODE IS THE FEATURE.
         enter   — nobody has put anything in; you are the one filling it in for the net
         confirm — somebody has; you are being asked yes or no, and "no" becomes an edit
         done    — you have already confirmed, and there is nothing being asked of you */
    mode: mine.confirmed === "confirmed" && complete ? "done" : entered.length ? "confirm" : "enter",
    your_status: mine.confirmed,
    checked_by: netSlots.filter((s) => s.confirmed === "confirmed").length,
    of_players: netSlots.length,
    /* THE SCREEN QUESTION IS `prompt`; A POST RESPONSE'S `note` IS WHAT JUST HAPPENED.
       They were one field, both called `note`, for about ten minutes. Because every response spreads
       this view AFTER setting its own note, the view silently overwrote it — so every action reported
       the prompt instead of the outcome. Two tests caught it at once. Distinct names make that
       collision impossible rather than merely unlikely. */
    prompt: mine.confirmed === "confirmed" && complete
      ? "All done here; nothing else needed from you."
      : entered.length
        ? `${entered[0].entered_by_contact_id ? personName(nameOf(slots, entered[0].entered_by_contact_id), {}) + " entered" : "Someone entered"} these. Do they look right?`
        : "Nothing entered for this net yet. Type in what you can; you can do the whole net.",
  };
}

const nameOf = (slots, contactId) => {
  const s = slots.find((y) => y.contact_id === contactId);
  return s ? s.full_name : null;
};
