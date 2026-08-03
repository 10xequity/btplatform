/**
 * Boomtown Platform — Divisions and bracket balancing
 * File: worker/src/divisions.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.69.0
 *
 * THE ENGINE PROPOSES. THE DIRECTOR DECIDES. Owner 2026-08-03, asked directly whether rebalancing
 * should be automatic: "Propose, you approve." Nothing in this file moves a team on its own. Every
 * suggestion comes back with the numbers behind it and a sentence a director can read out loud to a
 * parent, because "why was my daughter's team moved down" is a conversation, not a query.
 *
 * THE RULES, IN THE OWNER'S OWN TERMS (2026-08-03):
 *
 *   "Top division should aim to remain at 8 teams."
 *   "if they are 9th or 10th, we will drop them to get to 8 AND if they played 8-10 games. They
 *    will have received sufficient game play."
 *      → In the top division, teams past 8th are proposed for dropping ONLY when they have already
 *        had a full day of volleyball. The games-played condition is not decoration: dropping a
 *        team that has played four games sends them home early, which is the opposite of the point.
 *
 *   "In the lower divisions, we will put them into a lower division or have them play against
 *    themselves (2 opponents)."
 *      → Below the top, a misplaced team moves down if there is somewhere to move to. If there is
 *        not — they are already in the bottom division — two or more of them get a mini-bracket
 *        against each other rather than being sent home.
 *
 *   "if all teams are +5-6 wins and 2 are 1 or 2, then those 2 can be dropped or moved"
 *      → Misplacement is measured against the division's MEDIAN, not its mean. One 0-8 team drags a
 *        mean down far enough to stop flagging itself, which is precisely backwards.
 *
 *   "I prefer A [8/8/6] but if the bottom 6 - 4 and 2 if the bottom 2 are very low, then they can
 *    be in the lowest division. Otherwise, if they are competitive, then 1st one."
 *      → A trailing group stays whole when it is competitive, and splits when its own bottom two
 *        are adrift. The test is applied WITHIN the group, because a team that looks weak against
 *        the whole division may be perfectly matched against the others near it.
 *
 * BRACKET SIZES. 8, 6, 4, 3, 2 — the owner confirmed the 8/8/6 shape over a 12-team bracket, and a
 * 12 would carry four byes, which he had already rejected for pool play. 3 is "if necessary".
 */

export const ALLOWED_BRACKET_SIZES = [8, 6, 4, 3, 2];
export const TOP_DIVISION_TARGET = 8;
/** A team is misplaced when it trails the division median by this many wins. */
export const DEFAULT_WIN_GAP = 3;
/** Below this many games played, a team has not had its day yet and is never proposed for dropping. */
export const SUFFICIENT_GAMES = 8;
/**
 * How far over 8 the top division can be before trimming stops being the right answer.
 * At 9 or 10 teams, the extras are proposed for dropping. At 11 or more they are a second bracket:
 * dropping that many to protect a number would send most of a division home.
 */
export const MAX_TRIMMABLE_OVERFLOW = 2;

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Split `n` teams into bracket sizes drawn from ALLOWED_BRACKET_SIZES.
 *
 * Fewest brackets wins, then the largest opening bracket. Greedy-largest-first is wrong and it is
 * wrong in a way that bites immediately: nine teams becomes 8 + 1, and one team is not a bracket.
 * The search backtracks, so nine becomes 6 + 3.
 *
 * Returns [] for n = 0, and null for n = 1 — one team cannot play itself, and the caller has to
 * decide what happens to them rather than being handed a silently wrong answer.
 */
export function bestSplit(n) {
  if (n === 0) return [];
  if (n === 1) return null;
  const memo = new Map();
  const search = (left) => {
    if (left === 0) return [];
    if (memo.has(left)) return memo.get(left);
    let best = null;
    for (const size of ALLOWED_BRACKET_SIZES) {
      if (size > left) continue;
      const rest = search(left - size);
      if (rest === null) continue;
      const cand = [size, ...rest];
      if (!best || cand.length < best.length || (cand.length === best.length && cand[0] > best[0])) {
        best = cand;
      }
    }
    memo.set(left, best);
    return best;
  };
  return search(n);
}

/** Sorted best-first: wins, then point differential, then points scored. Ties broken, never random. */
export function rankTeams(teams) {
  return [...teams].sort((a, b) =>
    (b.wins ?? 0) - (a.wins ?? 0) ||
    (b.pointDiff ?? 0) - (a.pointDiff ?? 0) ||
    (b.pointsFor ?? 0) - (a.pointsFor ?? 0) ||
    a.id - b.id);
}

/** Teams trailing the median of the group they are being judged against by `gapWins` or more. */
export function findOutliers(teams, gapWins = DEFAULT_WIN_GAP) {
  if (teams.length < 3) return [];          // with two teams there is no median worth the name
  const med = median(teams.map((t) => t.wins ?? 0));
  return teams.filter((t) => med - (t.wins ?? 0) >= gapWins);
}

/**
 * Plan every division on an event at once.
 *
 * Whole-event, not one division at a time, because the interesting decisions are all cross-division:
 * whether a team can move down depends on there being a division below, and how full it already is.
 *
 * `divisions` — ranked, 1 = top: [{ id, name, rank, teams: [{ id, name, wins, losses, gamesPlayed,
 * pointDiff, pointsFor }] }]
 *
 * Returns { divisions: [{ id, name, rank, brackets: [{ label, size, teamIds }], count }],
 *           proposals: [...] } — proposals are advisory until someone accepts them.
 */
export function planDivisions(divisions, opts = {}) {
  const gapWins = opts.gapWins ?? DEFAULT_WIN_GAP;
  const sufficientGames = opts.sufficientGames ?? SUFFICIENT_GAMES;
  const ordered = [...divisions].sort((a, b) => a.rank - b.rank);
  const proposals = [];
  const out = [];

  for (let i = 0; i < ordered.length; i++) {
    const div = ordered[i];
    const below = ordered[i + 1] || null;
    const isTop = div.rank === Math.min(...ordered.map((d) => d.rank));
    const ranked = rankTeams(div.teams || []);
    const med = median(ranked.map((t) => t.wins ?? 0));
    let playing = ranked;

    const propose = (team, kind, toDivision, reason) => proposals.push({
      team_id: team.id, team: team.name, kind,
      from_division_id: div.id, from_division: div.name,
      to_division_id: toDivision ? toDivision.id : null,
      to_division: toDivision ? toDivision.name : null,
      reason,
      wins: team.wins ?? 0, losses: team.losses ?? 0,
      games_played: team.gamesPlayed ?? 0, division_median_wins: med,
    });

    const overflow = ranked.length - TOP_DIVISION_TARGET;
    if (isTop && overflow > 0 && overflow <= MAX_TRIMMABLE_OVERFLOW) {
      // "Top division should aim to remain at 8 teams" — but only TRIM to get there.
      //
      // The owner said two things that look contradictory until you notice the scale each one is
      // about: "if they are 9th or 10th, we will drop them to get to 8", and separately that a
      // 22-team field should become 8 / 8 / 6. Both are right. One or two teams over is a trim, and
      // those teams have had their day. Fourteen over is not an overflow, it is a second and third
      // bracket — dropping fourteen teams to protect a number would send most of the division home.
      const extra = ranked.slice(TOP_DIVISION_TARGET);
      playing = ranked.slice(0, TOP_DIVISION_TARGET);
      for (const t of extra) {
        const place = ranked.indexOf(t) + 1;
        if ((t.gamesPlayed ?? 0) >= sufficientGames) {
          propose(t, "drop_from_bracket", null,
            `Finished ${place}${ordinal(place)} in ${div.name} and has played ${t.gamesPlayed} games — a full day. Dropping them keeps the top bracket at ${TOP_DIVISION_TARGET}.`);
        } else if (below) {
          propose(t, "move_down", below,
            `Finished ${place}${ordinal(place)} in ${div.name} but has only played ${t.gamesPlayed ?? 0} games. Moving them to ${below.name} keeps the top bracket at ${TOP_DIVISION_TARGET} and still gives them bracket play.`);
        } else {
          propose(t, "drop_from_bracket", null,
            `Finished ${place}${ordinal(place)} in ${div.name} with nowhere below to move to.`);
        }
      }
    } else if (!isTop) {
      // Below the top, misplacement is judged on the win gap rather than on finishing position.
      const odd = findOutliers(ranked, gapWins);
      if (odd.length) {
        const remaining = ranked.length - odd.length;
        // Never gut a division to fix it: if removing the outliers leaves too few to bracket, the
        // division is not misbalanced, it is just small.
        if (remaining >= 2) {
          playing = ranked.filter((t) => !odd.includes(t));
          for (const t of odd) {
            if (below) {
              propose(t, "move_down", below,
                `${t.wins ?? 0} win${(t.wins ?? 0) === 1 ? "" : "s"} against a ${div.name} median of ${med}. ${below.name} is a closer match.`);
            } else if (odd.length >= 2) {
              propose(t, "mini_bracket", null,
                `${t.wins ?? 0} win${(t.wins ?? 0) === 1 ? "" : "s"} against a ${div.name} median of ${med}, and there is no division below. Play the other ${odd.length - 1} team${odd.length === 2 ? "" : "s"} in the same position instead.`);
            } else {
              propose(t, "drop_from_bracket", null,
                `${t.wins ?? 0} win${(t.wins ?? 0) === 1 ? "" : "s"} against a ${div.name} median of ${med}, with no division below and nobody else at their level.`);
            }
          }
        }
      }
    }

    out.push(buildBrackets(div, playing, isTop, proposals, ordered, gapWins));
  }

  return { divisions: out, proposals };
}

/** Cut the surviving field into brackets, applying the trailing-group rule. */
function buildBrackets(div, playing, isTop, proposals, ordered, gapWins) {
  const base = { id: div.id, name: div.name, rank: div.rank, count: playing.length };
  if (!playing.length) return { ...base, brackets: [], note: "No teams left to bracket." };
  if (playing.length === 1) {
    return { ...base, brackets: [], note: `${playing[0].name} is on their own — no bracket possible.` };
  }

  let sizes;
  if (isTop && playing.length >= TOP_DIVISION_TARGET) {
    const rest = playing.length - TOP_DIVISION_TARGET;
    sizes = [TOP_DIVISION_TARGET, ...(rest ? bestSplit(rest) || [] : [])];
  } else {
    sizes = bestSplit(playing.length) || [];
  }

  // "if the bottom 6 - 4 and 2 if the bottom 2 are very low ... Otherwise, if they are competitive"
  // — judged WITHIN the trailing group, because a team that is adrift of the whole division can be
  // an even match for the ones immediately around it.
  const lastSize = sizes[sizes.length - 1];
  if (lastSize >= 5) {
    const tail = playing.slice(playing.length - lastSize);
    const tailOdd = findOutliers(tail, gapWins);
    if (tailOdd.length === 2 && tailOdd.every((t) => tail.slice(-2).includes(t))) {
      sizes = [...sizes.slice(0, -1), lastSize - 2, 2];
      const bottom = ordered[ordered.length - 1];
      for (const t of tailOdd) {
        proposals.push({
          team_id: t.id, team: t.name, kind: bottom && bottom.id !== div.id ? "move_down" : "mini_bracket",
          from_division_id: div.id, from_division: div.name,
          to_division_id: bottom && bottom.id !== div.id ? bottom.id : null,
          to_division: bottom && bottom.id !== div.id ? bottom.name : null,
          reason: `Adrift even of the bottom bracket in ${div.name} — ${t.wins ?? 0} win${(t.wins ?? 0) === 1 ? "" : "s"} where the rest of that group sits at ${median(tail.map((x) => x.wins ?? 0))}.`,
          wins: t.wins ?? 0, losses: t.losses ?? 0, games_played: t.gamesPlayed ?? 0,
          division_median_wins: median(tail.map((x) => x.wins ?? 0)),
        });
      }
    }
  }

  const labels = ["A", "B", "C", "D", "E", "F"];
  const brackets = [];
  let at = 0;
  sizes.forEach((size, i) => {
    brackets.push({
      label: sizes.length === 1 ? div.name : `${div.name} ${labels[i] || i + 1}`,
      size,
      teamIds: playing.slice(at, at + size).map((t) => t.id),
      teams: playing.slice(at, at + size).map((t) => t.name),
    });
    at += size;
  });
  return { ...base, brackets };
}

const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

/* ================================ routes ================================ */

let json, requireStaff, audit;
export function wireDivisions(h) { ({ json, requireStaff, audit } = h); }

/** Read every division on an event with its teams and their pool record. */
async function loadDivisions(env, ctx, eventId) {
  const divs = (await env.DB.prepare(
    `SELECT id, name, rank, court_from, court_to, target_bracket_size
       FROM divisions WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY rank`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const teams = (await env.DB.prepare(
    `SELECT t.id, t.name, t.division_id,
            COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses,
            COALESCE(s.point_diff,0) AS pointDiff, COALESCE(s.points_for,0) AS pointsFor
       FROM teams t
       LEFT JOIN standings s ON s.team_id = t.id AND s.event_id = t.event_id AND s.deleted_at IS NULL
      WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL`
  ).bind(ctx.orgId, eventId).all()).results || [];

  // Games played comes from the match table, not from wins+losses: an unscored game is neither, and
  // counting it as neither is what makes "has this team had their day yet" answerable.
  const played = (await env.DB.prepare(
    `SELECT team_id, COUNT(*) AS n FROM (
        SELECT team_a_id AS team_id FROM matches
         WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL AND score_a IS NOT NULL AND score_b IS NOT NULL
        UNION ALL
        SELECT team_b_id AS team_id FROM matches
         WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL AND score_a IS NOT NULL AND score_b IS NOT NULL
     ) GROUP BY team_id`
  ).bind(ctx.orgId, eventId).all()).results || [];
  const gp = new Map(played.map((r) => [r.team_id, r.n]));

  return divs.map((d) => ({
    ...d,
    teams: teams.filter((t) => t.division_id === d.id)
      .map((t) => ({ ...t, gamesPlayed: gp.get(t.id) || 0 })),
  }));
}

export async function divisionRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  let x;

  /* ---- list ---- */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/divisions$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const divisions = await loadDivisions(env, ctx, +x[1]);
    const unassigned = (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM teams
        WHERE org_id=?1 AND event_id=?2 AND division_id IS NULL AND deleted_at IS NULL`
    ).bind(ctx.orgId, +x[1]).first()).n;
    return json({ divisions, unassigned });
  }

  /* ---- create / replace the division layout ---- */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/divisions$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const list = Array.isArray(b.divisions) ? b.divisions : [];
    if (!list.length) return json({ error: "Send at least one division." }, 400);

    // Courts are a range, and two divisions cannot own the same court. Nobody notices an overlap
    // until two teams are told to play on court 5 at the same time.
    const seen = new Map();
    for (const d of list) {
      const from = Number(d.court_from), to = Number(d.court_to);
      if (!d.name) return json({ error: "Every division needs a name." }, 400);
      if (from && to) {
        if (to < from) return json({ error: `${d.name}: the last court can't be before the first.` }, 400);
        for (let c = from; c <= to; c++) {
          if (seen.has(c)) return json({ error: `Court ${c} is given to both ${seen.get(c)} and ${d.name}.` }, 400);
          seen.set(c, d.name);
        }
      }
    }

    if (b.replace) {
      await env.DB.prepare(
        "UPDATE teams SET division_id=NULL WHERE org_id=?1 AND event_id=?2"
      ).bind(ctx.orgId, eventId).run();
      await env.DB.prepare(
        "UPDATE divisions SET deleted_at=datetime('now') WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
      ).bind(ctx.orgId, eventId).run();
    }

    const made = [];
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const r = await env.DB.prepare(
        `INSERT INTO divisions (org_id, event_id, name, rank, court_from, court_to, target_bracket_size)
         VALUES (?1,?2,?3,?4,?5,?6,?7)`
      ).bind(ctx.orgId, eventId, String(d.name), Number(d.rank) || i + 1,
             Number(d.court_from) || null, Number(d.court_to) || null,
             Number(d.target_bracket_size) || null).run();
      made.push({ id: r.meta.last_row_id, name: d.name, rank: Number(d.rank) || i + 1 });
    }
    await audit(env, ctx, "divisions.create", "events", eventId, { count: made.length, replace: !!b.replace });
    return json({ ok: true, divisions: made });
  }

  /* ---- assign teams ---- */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/divisions\/assign$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const pairs = Array.isArray(b.assign) ? b.assign : [];
    let moved = 0;
    for (const a of pairs) {
      const r = await env.DB.prepare(
        `UPDATE teams SET division_id=?1, updated_at=datetime('now')
          WHERE id=?2 AND org_id=?3 AND event_id=?4 AND deleted_at IS NULL`
      ).bind(a.division_id ? Number(a.division_id) : null, Number(a.team_id), ctx.orgId, eventId).run();
      moved += r.meta.changes || 0;
    }
    await audit(env, ctx, "divisions.assign", "events", eventId, { moved });
    return json({ ok: true, moved });
  }

  /* ---- the plan: what the engine WOULD do ----
     A read, deliberately. Owner 2026-08-03 chose "propose, you approve", so nothing here writes a
     team's division. The director sees the shape of the day and the reasoning, then decides. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/divisions\/plan$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const divisions = await loadDivisions(env, ctx, eventId);
    if (!divisions.length) return json({ error: "Set the divisions up first." }, 409);

    const gapWins = Number(url.searchParams.get("gap")) || DEFAULT_WIN_GAP;
    const plan = planDivisions(divisions, { gapWins });
    return json({
      ...plan,
      summary: plan.divisions.map((d) =>
        d.brackets.length
          ? `${d.name}: ${d.brackets.map((br) => `${br.label} (${br.size})`).join(", ")}`
          : `${d.name}: ${d.note || "nothing to bracket"}`),
      note: plan.proposals.length
        ? `${plan.proposals.length} team${plan.proposals.length === 1 ? "" : "s"} look misplaced. Nothing has moved — accept the ones you agree with.`
        : "Every team looks well placed. Nothing to move.",
    });
  }

  /* ---- accept or reject proposals ---- */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/divisions\/moves$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const decisions = Array.isArray(b.decisions) ? b.decisions : [];
    let accepted = 0, rejected = 0;

    for (const d of decisions) {
      const ok = d.status === "accepted";
      // Recorded whether accepted or not. The rejected ones are the audit trail for the question
      // that gets asked later: was this looked at, and what was decided?
      await env.DB.prepare(
        `INSERT INTO division_moves (org_id, event_id, team_id, from_division_id, to_division_id,
                                     kind, reason, wins, losses, games_played, division_median_wins,
                                     status, decided_by_user_id, decided_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,datetime('now'))`
      ).bind(ctx.orgId, eventId, Number(d.team_id), d.from_division_id || null, d.to_division_id || null,
             String(d.kind), String(d.reason || ""), d.wins ?? null, d.losses ?? null,
             d.games_played ?? null, d.division_median_wins ?? null,
             ok ? "accepted" : "rejected", ctx.userId || null).run();

      if (!ok) { rejected++; continue; }
      accepted++;
      // Only a move changes where a team sits. A drop or a mini-bracket is handled when the bracket
      // is drawn — the team keeps its division, which is what it should say on a results sheet.
      if (d.kind === "move_down" || d.kind === "move_up") {
        await env.DB.prepare(
          `UPDATE teams SET division_id=?1, updated_at=datetime('now')
            WHERE id=?2 AND org_id=?3 AND event_id=?4 AND deleted_at IS NULL`
        ).bind(Number(d.to_division_id), Number(d.team_id), ctx.orgId, eventId).run();
      }
    }
    await audit(env, ctx, "divisions.moves", "events", eventId, { accepted, rejected });
    return json({
      ok: true, accepted, rejected,
      note: `${accepted} move${accepted === 1 ? "" : "s"} applied, ${rejected} declined. Every one is recorded either way.`,
    });
  }

  /* ================= the pool board =================
     Owner 2026-08-03: "Add drag and drop for me to sort which teams go where and allow me to write
     a note that is displayed on the tile ... if i drag to a square or block with + it will add a
     pool. and if it is empty, itll auto delete. i will also need a workspace area to arrange teams
     to move."

     The whole layout is read and written in ONE call each. A board is a single arrangement, and
     per-drag endpoints would leave a half-saved board every time a phone drops signal mid-drag —
     a team in two pools, or in none. One payload either lands or it does not. */

  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/board$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const board = await loadBoard(env, ctx, +x[1]);
    if (board.error) return json({ error: board.error }, board.status || 404);
    return json(board);
  }

  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/board$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const wanted = Array.isArray(b.pools) ? b.pools : [];

    const ev = await env.DB.prepare(
      "SELECT id FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(eventId, ctx.orgId).first();
    if (!ev) return json({ error: "That event doesn't exist." }, 404);

    // Only this event's teams may be placed. Without the check, a team id from another event lands
    // in a pool here and appears on two boards at once.
    const mine = new Set(((await env.DB.prepare(
      "SELECT id FROM teams WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, eventId).all()).results || []).map((t) => t.id));

    // A team in two pools is the one thing a drag board must never produce. Refused before anything
    // is written, rather than resolved by whichever pool happened to be saved last.
    const placed = new Set();
    for (const pool of wanted) {
      for (const tid of pool.team_ids || []) {
        const id = Number(tid);
        if (!mine.has(id)) return json({ error: "One of those teams isn't in this event." }, 400);
        if (placed.has(id)) return json({ error: `A team can't be in two pools at once (team ${id}).` }, 400);
        placed.add(id);
      }
    }

    const existing = ((await env.DB.prepare(
      "SELECT id FROM pools WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, eventId).all()).results || []).map((r) => r.id);
    const kept = new Set();
    let created = 0, updated = 0;

    for (let i = 0; i < wanted.length; i++) {
      const pool = wanted[i];
      const teamIds = (pool.team_ids || []).map(Number);
      // "if it is empty, itll auto delete" — so an empty pool is never created in the first place.
      // Creating then deleting it in one request is the same outcome plus a wasted id.
      if (!teamIds.length) continue;

      const name = String(pool.name || `Pool ${i + 1}`).slice(0, 60);
      const divisionId = pool.division_id ? Number(pool.division_id) : null;
      let poolId = Number(pool.id) || null;

      if (poolId && existing.includes(poolId)) {
        await env.DB.prepare(
          `UPDATE pools SET name=?1, division_id=?2, sort_order=?3, court_from=?4, court_to=?5,
                            updated_at=datetime('now')
            WHERE id=?6 AND org_id=?7 AND event_id=?8`
        ).bind(name, divisionId, i, pool.court_from ?? null, pool.court_to ?? null,
               poolId, ctx.orgId, eventId).run();
        updated++;
      } else {
        const ins = await env.DB.prepare(
          `INSERT INTO pools (org_id, event_id, name, division_id, sort_order, court_from, court_to)
           VALUES (?1,?2,?3,?4,?5,?6,?7)`
        ).bind(ctx.orgId, eventId, name, divisionId, i, pool.court_from ?? null, pool.court_to ?? null).run();
        poolId = ins.meta.last_row_id;
        created++;
      }
      kept.add(poolId);

      for (let k = 0; k < teamIds.length; k++) {
        await env.DB.prepare(
          `UPDATE teams SET pool_id=?1, board_order=?2, division_id=COALESCE(?3, division_id),
                            updated_at=datetime('now')
            WHERE id=?4 AND org_id=?5 AND event_id=?6 AND deleted_at IS NULL`
        ).bind(poolId, k, divisionId, teamIds[k], ctx.orgId, eventId).run();
      }
    }

    // Everything not placed returns to the workspace, which IS `pool_id IS NULL`. Doing it after the
    // placements means a team dragged out of a pool lands there without a second request.
    const loose = [...mine].filter((id) => !placed.has(id));
    for (const id of loose) {
      await env.DB.prepare(
        "UPDATE teams SET pool_id=NULL, updated_at=datetime('now') WHERE id=?1 AND org_id=?2"
      ).bind(id, ctx.orgId).run();
    }

    // Pools that lost their last team. Hard-delete the ones that never held a game — an empty pool
    // has no history worth keeping, and leaving soft-deleted rows makes the board accumulate
    // invisible clutter. Soft-delete the ones matches still reference.
    let removed = 0;
    for (const id of existing) {
      if (kept.has(id)) continue;
      const used = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM matches WHERE pool_id=?1 AND org_id=?2"
      ).bind(id, ctx.orgId).first();
      if (used.n > 0) {
        await env.DB.prepare("UPDATE pools SET deleted_at=datetime('now') WHERE id=?1 AND org_id=?2")
          .bind(id, ctx.orgId).run();
      } else {
        await env.DB.prepare("DELETE FROM pools WHERE id=?1 AND org_id=?2").bind(id, ctx.orgId).run();
      }
      removed++;
    }

    await audit(env, ctx, "board.save", "events", eventId, { created, updated, removed, placed: placed.size });
    const board = await loadBoard(env, ctx, eventId);
    return json({
      ok: true, created, updated, removed,
      note: `${placed.size} team${placed.size === 1 ? "" : "s"} placed` +
        (loose.length ? `, ${loose.length} in the workspace` : "") +
        (removed ? `, ${removed} empty pool${removed === 1 ? "" : "s"} removed` : "") + ".",
      ...board,
    });
  }

  /* ---- the note on a tile ----
     Separate from the layout deliberately. Typing a note is not a rearrangement, and folding it in
     would mean a stray keystroke resaved the whole board. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/board\/note$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx); if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const teamId = Number(b.team_id);
    if (!teamId) return json({ error: "Say which team the note is for." }, 400);
    const note = b.note == null || String(b.note).trim() === "" ? null : String(b.note).slice(0, 500);
    const r = await env.DB.prepare(
      `UPDATE teams SET note=?1, updated_at=datetime('now')
        WHERE id=?2 AND org_id=?3 AND event_id=?4 AND deleted_at IS NULL`
    ).bind(note, teamId, ctx.orgId, eventId).run();
    if (!r.meta.changes) return json({ error: "That team isn't in this event." }, 404);
    return json({ ok: true, team_id: teamId, note });
  }

  return null;
}

/**
 * The board as it should be drawn: divisions, their pools in order, and the workspace.
 *
 * The workspace is every team with no pool. It needs no row of its own — an unplaced team is exactly
 * a team with `pool_id IS NULL`, which is also the state every team starts in.
 */
async function loadBoard(env, ctx, eventId) {
  const ev = await env.DB.prepare(
    "SELECT id, name, court_count FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, ctx.orgId).first();
  if (!ev) return { error: "That event doesn't exist.", status: 404 };

  const divisions = (await env.DB.prepare(
    `SELECT id, name, rank, court_from, court_to FROM divisions
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY rank`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const pools = (await env.DB.prepare(
    `SELECT id, name, division_id, sort_order, court_from, court_to FROM pools
      WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL ORDER BY sort_order, id`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const teams = (await env.DB.prepare(
    `SELECT t.id, t.name, t.pool_id, t.division_id, t.note, t.board_order, t.seed,
            COALESCE(s.wins,0) AS wins, COALESCE(s.losses,0) AS losses
       FROM teams t
       LEFT JOIN standings s ON s.team_id=t.id AND s.event_id=t.event_id AND s.deleted_at IS NULL
      WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL
      ORDER BY t.board_order, COALESCE(t.seed, 9999), t.id`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const inPool = (pid) => teams.filter((t) => t.pool_id === pid);
  return {
    event: { id: ev.id, name: ev.name, court_count: ev.court_count },
    divisions: divisions.map((d) => ({
      ...d,
      pools: pools.filter((pl) => pl.division_id === d.id).map((pl) => ({ ...pl, teams: inPool(pl.id) })),
    })),
    // Pools nobody has put in a division yet still have to be drawn, or the teams in them vanish
    // from the screen while remaining in the database.
    loose_pools: pools.filter((pl) => !pl.division_id).map((pl) => ({ ...pl, teams: inPool(pl.id) })),
    workspace: teams.filter((t) => t.pool_id == null),
  };
}
