/**
 * Boomtown Platform — King / Queen of the Court, the playable surface
 * File: worker/src/kotcplay.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.80.0
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
  seedRound, gamesForRound, nextRound, tally, rankPlayers, solveNet, netPlan,
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
    `SELECT s.net_no, s.seat, s.contact_id, s.confirmed, s.confirmed_at, c.full_name
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
      if (player.withdrawn_at) return json({ error: "You've been marked as finished for the night." }, 409);
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
          note: "Thanks — you've confirmed net " + mine.net_no + ".",
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

  if ((x = p.match(/^\/api\/admin\/kotc\/(\d+)$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const sessionId = +x[1];
    const se = await env.DB.prepare(
      `SELECT id, name, move_up, points_to, status FROM kotc_sessions
        WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL`
    ).bind(sessionId, ctx.orgId).first();
    if (!se) return json({ error: "That session doesn't exist." }, 404);

    const rounds = (await env.DB.prepare(
      `SELECT id, round_no FROM kotc_rounds WHERE org_id=?1 AND session_id=?2 AND deleted_at IS NULL
        ORDER BY round_no`
    ).bind(ctx.orgId, sessionId).all()).results || [];

    const allGames = [];
    const board = [];
    for (const rd of rounds) {
      const { slots, games } = await loadRound(env, ctx.orgId, rd.id);
      allGames.push(...games);
      board.push({
        round_no: rd.round_no,
        nets: netsFrom(slots).map((n) => ({
          net_no: n.net_no,
          // Staff surface, so full names: this is who a director goes looking for.
          players: slots.filter((s) => s.net_no === n.net_no).sort((a2, b2) => a2.seat - b2.seat)
            .map((s) => ({ contact_id: s.contact_id, name: personName(s.full_name, { full: true }), confirmed: s.confirmed })),
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
    ).bind(ctx.orgId, sessionId).all()).results || []).map((q) => [q.contact_id, q.full_name]));

    return json({
      session: { id: se.id, name: se.name, move_up: se.move_up, points_to: se.points_to, status: se.status },
      rounds: board,
      // Derived from the games, every time. There is no stored per-player counter anywhere (migration 0040).
      leaderboard: rankPlayers(tally(allGames)).map((row, i) => ({
        place: i + 1, ...row, name: personName(names.get(row.contact_id), { full: true }),
      })),
      ...(await roster(env, ctx.orgId, sessionId)),
    });
  }

  return null;
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
      ? "All done here — nothing else needed from you."
      : entered.length
        ? `${entered[0].entered_by_contact_id ? personName(nameOf(slots, entered[0].entered_by_contact_id), {}) + " entered" : "Someone entered"} these. Do they look right?`
        : "Nothing entered for this net yet. Type in what you can — you can do the whole net.",
  };
}

const nameOf = (slots, contactId) => {
  const s = slots.find((y) => y.contact_id === contactId);
  return s ? s.full_name : null;
};
