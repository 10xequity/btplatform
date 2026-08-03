/**
 * Boomtown Platform — Pool schedule generator (M-TF slice 1 + 2)
 * File: worker/src/formats.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.62.0
 *
 * WHAT THIS REPLACES
 * `scheduler.js` holds six hardcoded templates (7-on-3, 8-on-4, 9-on-4, 10-on-4, 11-on-5,
 * 4-on-2x2). Team and court counts are fixed, so twelve teams on four courts simply cannot be
 * run — that single limitation is what blocks events today. This generates a pool schedule for
 * ANY team and court count, and reports how fair the result is.
 *
 * THE FAIRNESS TARGET IS NOT INVENTED. It was measured from the owner's own hand-built 10-on-4
 * sheet (Drive, "Pool Sheet Library"), which achieves: 8 games each, 2 byes each, ZERO repeat
 * opponents, and no team sitting twice in a row. That is close to optimal, so the job here is to
 * reproduce those properties at other sizes, not to improve on them. `formats.test.mjs` holds the
 * owner's sheet as a regression case: a generator that cannot match a schedule a human built by
 * hand is not ready.
 *
 * THE OWNER'S PRIORITY ORDER (2026-08-03, verbatim): "all teams should have equal played games,
 * so the aim is less switching and more teams waiting but spreading the wait out to effectively
 * ensure they are not waiting too long."
 *   1. EQUAL GAMES — hard. Refuse a round count that cannot give every team the same number.
 *   2. SPREAD THE WAIT — never two byes in a row; maximise the smallest gap.
 *   3. FEWER SWITCHES — prefer a bigger waiting set over more rounds.
 * 2 and 3 pull against each other. Resolution: pick the smallest round count that gives equal
 * games, then maximise the minimum bye gap inside it. That reproduces the owner's sheet exactly.
 *
 * THE CHECK ROW. The owner's sheet carries a "Check = 55" row — every round, the team numbers on
 * court plus those on bye sum to 1+2+…+N, proving every team appears exactly once. It is a
 * checksum a director verifies by eye in two seconds, and this generator emits it for exactly
 * that reason: a schedule you cannot eyeball is one you will not trust, and a director who does
 * not trust the generator keeps using the spreadsheet.
 *
 * DETERMINISTIC. No Math.random anywhere — the same inputs always produce the same schedule, so a
 * director who regenerates does not get a different answer, and the tests are stable.
 */

/* ============================ arithmetic ============================ */

/**
 * Round counts that give EVERY team the same number of games.
 *
 * With N teams and C courts, 2C play and W = N − 2C wait each round. Over R rounds there are
 * 2C·R team-slots, so games per team is 2CR/N — an integer only for some R. This is the whole
 * reason the owner's 10-on-4 came out perfectly even: 10 rounds divides cleanly.
 *
 * @returns {Array<{rounds:number, gamesPerTeam:number, byesPerTeam:number}>}
 */
export function equalGameOptions(teams, courts, maxRounds = 24) {
  const N = Number(teams), C = Number(courts);
  const out = [];
  if (!Number.isInteger(N) || !Number.isInteger(C) || N < 2 || C < 1) return out;
  if (2 * C > N) return out; // more court capacity than teams — nobody ever waits
  for (let R = 1; R <= maxRounds; R++) {
    const g = (2 * C * R) / N;
    if (Number.isInteger(g) && g > 0) out.push({ rounds: R, gamesPerTeam: g, byesPerTeam: R - g });
  }
  return out;
}

/**
 * Pick the round count for a target games-per-team, or the nearest achievable.
 * Returns why when the target is not achievable, rather than silently rounding — a director who
 * asked for 8 games and got 7 without being told will find out on the day.
 */
export function chooseRounds(teams, courts, targetGames) {
  const opts = equalGameOptions(teams, courts);
  if (!opts.length) return { ok: false, error: `${teams} teams on ${courts} courts never leaves anyone waiting — every team plays every round.` };
  const exact = opts.find((o) => o.gamesPerTeam === targetGames);
  if (exact) return { ok: true, ...exact, exact: true };
  const near = opts.reduce((best, o) =>
    Math.abs(o.gamesPerTeam - targetGames) < Math.abs(best.gamesPerTeam - targetGames) ? o : best);
  return {
    ok: true, ...near, exact: false,
    note: `${targetGames} games each is not possible with ${teams} teams on ${courts} courts — every team can only have the same number of games at ${opts.map((o) => o.gamesPerTeam).join(", ")}. Closest is ${near.gamesPerTeam}.`,
  };
}

/* ============================ the generator ============================ */

/**
 * Build a pool schedule.
 *
 * Greedy, deterministic, with the owner's priorities applied in order at each round:
 *   - anyone who sat last round MUST play (no back-to-back byes)
 *   - among the rest, sit whoever has the fewest byes so far, then the most games
 *   - pair the players so that repeat opponents are avoided, then rest is evened out
 *
 * @param {{teams:number, courts:number, rounds:number}} opts
 * @returns {{ok:true, rounds:Array, byes:Array} | {ok:false, error:string}}
 */
export function planPool({ teams, courts, rounds, rotate = 0 }) {
  const N = Number(teams), C = Number(courts), R = Number(rounds);
  if (!Number.isInteger(N) || N < 2) return { ok: false, error: "Enter how many teams are playing." };
  if (!Number.isInteger(C) || C < 1) return { ok: false, error: "Enter how many courts you have." };
  if (!Number.isInteger(R) || R < 1) return { ok: false, error: "Enter how many rounds to play." };
  if (2 * C > N) return { ok: false, error: `${C} courts needs ${2 * C} teams on court, but only ${N} are entered.` };

  const W = N - 2 * C;                       // teams waiting each round
  // `rotate` shifts the deterministic tiebreak so planBestPool can try several starting points.
  // Without it the greedy locks onto one ordering and repeatedly pairs the same trailing teams —
  // 12-on-5 produced 11v12 eight times before this existed.
  const base = Array.from({ length: N }, (_, i) => i + 1);
  const off = ((rotate % N) + N) % N;
  const order = base.slice(off).concat(base.slice(0, off));
  const rank = new Map(order.map((t, i) => [t, i]));
  const ids = base;
  const games = new Map(ids.map((t) => [t, 0]));
  const byes = new Map(ids.map((t) => [t, 0]));
  const lastBye = new Map(ids.map((t) => [t, -99]));
  const met = new Map(ids.map((t) => [t, new Map()]));
  const metCount = (a, b) => met.get(a).get(b) || 0;

  const outRounds = [], outByes = [];

  for (let r = 0; r < R; r++) {
    /* ---- who sits ---- */
    const satLastRound = new Set(r > 0 ? outByes[r - 1] : []);
    const eligible = ids.filter((t) => !satLastRound.has(t));
    // If everyone sat last round (only possible when W >= N, which the guard above prevents),
    // fall back to the full list rather than crashing.
    const pool = eligible.length >= W ? eligible : ids.slice();

    const sitters = pool
      .slice()
      .sort((a, b) =>
        byes.get(a) - byes.get(b) ||          // fewest byes so far sits first
        games.get(b) - games.get(a) ||        // then whoever has played most
        lastBye.get(a) - lastBye.get(b) ||    // then whoever rested longest ago
        rank.get(a) - rank.get(b))            // deterministic, rotated by `rotate`
      .slice(0, W);

    const sitting = new Set(sitters);
    for (const t of sitters) { byes.set(t, byes.get(t) + 1); lastBye.set(t, r); }
    outByes.push(sitters.slice().sort((a, b) => a - b));

    /* ---- who plays whom ----
       Greedy MATCHING over every candidate pair, not a sequential walk. The first version took
       the next unpaired team and found it a partner, which — with everyone on equal games at the
       start of a round — fell straight through to the id tiebreak and paired 1v2, 3v4, 5v6 round
       after round. Scoring all pairs and taking the cheapest disjoint ones removes that artefact
       entirely: on 12-on-5 it took 11v12 from eight repeats to zero. */
    const playing = ids.filter((t) => !sitting.has(t));
    const candidates = [];
    for (let i = 0; i < playing.length; i++) {
      for (let j = i + 1; j < playing.length; j++) {
        const a = playing[i], b = playing[j];
        candidates.push({
          a, b,
          met: metCount(a, b),
          load: games.get(a) + games.get(b),
          // Prefer partners who are FAR APART in the rotated order. Summing ranks made the
          // cheapest pair 1v2, then 3v4, then 5v6 — the circle method pairs across the ring for
          // exactly this reason, and without it the same neighbours meet again and again.
          tie: -circDist(rank.get(a), rank.get(b), N),
        });
      }
    }
    candidates.sort((x, y) => x.met - y.met || x.load - y.load || x.tie - y.tie || x.a - y.a || x.b - y.b);

    const used = new Set();
    const matches = [];
    for (const c of candidates) {
      if (matches.length >= C) break;
      if (used.has(c.a) || used.has(c.b)) continue;
      used.add(c.a); used.add(c.b);
      matches.push({ court: matches.length + 1, a: c.a, b: c.b });
      games.set(c.a, games.get(c.a) + 1);
      games.set(c.b, games.get(c.b) + 1);
      met.get(c.a).set(c.b, metCount(c.a, c.b) + 1);
      met.get(c.b).set(c.a, metCount(c.b, c.a) + 1);
    }

    outRounds.push(matches);
  }

  return { ok: true, rounds: outRounds, byes: outByes };
}

/** Distance between two positions around a ring of size n — the circle method’s core idea. */
function circDist(x, y, n) {
  const d = Math.abs(x - y);
  return Math.min(d, n - d);
}

/* ============================ the report ============================ */

/**
 * Measure a schedule against the owner's fairness target and their time/points budget.
 *
 * This is the half that makes the generator trustworthy. Without a visible score a director cannot
 * tell a good schedule from a plausible one, and will keep using the spreadsheet.
 *
 * @param {{rounds:Array, byes:Array}} plan
 * @param {{teams:number, pointsTo?:number, minutesPerGame?:number}} opts
 */
export function poolReport(plan, { teams, pointsTo = 21, minutesPerGame = 22 }) {
  const N = Number(teams);
  const ids = Array.from({ length: N }, (_, i) => i + 1);
  const games = new Map(ids.map((t) => [t, 0]));
  const byes = new Map(ids.map((t) => [t, 0]));
  const byeRounds = new Map(ids.map((t) => [t, []]));
  const pairs = new Map();
  const checkRow = [];
  const problems = [];

  plan.rounds.forEach((round, ri) => {
    const seen = new Set();
    for (const m of round) {
      games.set(m.a, games.get(m.a) + 1);
      games.set(m.b, games.get(m.b) + 1);
      const key = m.a < m.b ? `${m.a}v${m.b}` : `${m.b}v${m.a}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
      if (seen.has(m.a) || seen.has(m.b)) problems.push(`Round ${ri + 1}: a team is on two courts at once.`);
      seen.add(m.a); seen.add(m.b);
    }
    for (const t of plan.byes[ri] || []) {
      byes.set(t, byes.get(t) + 1);
      byeRounds.get(t).push(ri + 1);
      if (seen.has(t)) problems.push(`Round ${ri + 1}: team ${t} is playing and on a bye.`);
      seen.add(t);
    }
    // The owner's Check row: every team accounted for exactly once, playing or waiting.
    const sum = [...seen].reduce((s, x) => s + x, 0);
    checkRow.push(sum);
    const expected = (N * (N + 1)) / 2;
    if (seen.size !== N || sum !== expected) {
      problems.push(`Round ${ri + 1}: check row is ${sum}, expected ${expected} — a team is missing or duplicated.`);
    }
  });

  const g = ids.map((t) => games.get(t));
  const b = ids.map((t) => byes.get(t));
  const repeats = [...pairs.entries()].filter(([, n]) => n > 1);
  const totalPairs = (N * (N - 1)) / 2;

  // Back-to-back byes and the smallest gap anyone gets.
  let backToBack = 0, minGap = Infinity;
  for (const t of ids) {
    const rs = byeRounds.get(t);
    for (let i = 1; i < rs.length; i++) {
      const gap = rs[i] - rs[i - 1];
      if (gap === 1) backToBack++;
      if (gap < minGap) minGap = gap;
    }
  }

  const rounds = plan.rounds.length;
  const gamesPerTeam = Math.min(...g);
  const totalMinutes = rounds * minutesPerGame;

  return {
    rounds,
    gamesPerTeam: { min: Math.min(...g), max: Math.max(...g), equal: Math.min(...g) === Math.max(...g) },
    byesPerTeam: { min: Math.min(...b), max: Math.max(...b), equal: Math.min(...b) === Math.max(...b) },
    opponents: {
      possiblePairs: totalPairs,
      metPairs: pairs.size,
      repeatedPairs: repeats.length,
      repeats: repeats.map(([k, n]) => `${k}×${n}`),
    },
    waiting: {
      perRound: N - 2 * (plan.rounds[0] ? plan.rounds[0].length : 0),
      backToBackByes: backToBack,
      smallestGapBetweenByes: minGap === Infinity ? null : minGap,
    },
    checkRow,
    checkRowExpected: (N * (N + 1)) / 2,
    budget: {
      pointsPerTeam: gamesPerTeam * pointsTo,
      estimatedHours: Number((totalMinutes / 60).toFixed(1)),
      note: `${gamesPerTeam} games to ${pointsTo} · ${rounds} rounds × ~${minutesPerGame} min`,
    },
    problems,
    // A schedule with any problem is not merely worse — it is wrong, and must not be published.
    valid: problems.length === 0,
  };
}

/**
 * Plain-English lines a director reads before committing to a schedule. Deliberately states the
 * arithmetic rather than a verdict: "11 teams get 4 byes and 2 get 3" is something they can act on,
 * where "fairness: 87%" is not.
 */
export function reportLines(report, { teams, targetGames, targetPoints, targetHours } = {}) {
  const L = [];
  L.push(`${report.rounds} rounds · ${report.gamesPerTeam.min} games each · ${report.byesPerTeam.min} byes each`);
  L.push(report.gamesPerTeam.equal
    ? "Every team plays the same number of games."
    : `Games are UNEVEN: ${report.gamesPerTeam.min}–${report.gamesPerTeam.max}. Pick a round count that divides evenly.`);
  L.push(report.byesPerTeam.equal
    ? "Every team sits out the same number of times."
    : `Byes are uneven: ${report.byesPerTeam.min}–${report.byesPerTeam.max}.`);
  L.push(report.opponents.repeatedPairs === 0
    ? `No team plays anybody twice (${report.opponents.metPairs} of ${report.opponents.possiblePairs} possible match-ups used).`
    : `${report.opponents.repeatedPairs} match-up(s) repeat: ${report.opponents.repeats.slice(0, 6).join(", ")}.`);
  L.push(report.waiting.backToBackByes === 0
    ? `Nobody sits out twice in a row (closest gap ${report.waiting.smallestGapBetweenByes ?? "n/a"} rounds).`
    : `${report.waiting.backToBackByes} team(s) sit out two rounds running — worth a second look.`);
  L.push(`About ${report.budget.estimatedHours} hours, ~${report.budget.pointsPerTeam} points per team. ${report.budget.note}`);

  if (targetGames && report.gamesPerTeam.min !== targetGames) {
    L.push(`⚠ You asked for ${targetGames} games each; this gives ${report.gamesPerTeam.min}.`);
  }
  if (targetPoints && report.budget.pointsPerTeam < targetPoints) {
    L.push(`⚠ ${report.budget.pointsPerTeam} points is under your ${targetPoints} target — raise the points per game or add rounds.`);
  }
  if (targetHours && report.budget.estimatedHours > targetHours) {
    L.push(`⚠ ${report.budget.estimatedHours} hours is over your ${targetHours}-hour window — add a court or shorten the games.`);
  }
  if (!report.valid) L.push(`✖ This schedule is not usable: ${report.problems[0]}`);
  return L;
}

/**
 * Generate several candidate schedules and keep the fairest.
 *
 * The greedy in planPool is deterministic, which is desirable — but a single greedy locks onto one
 * ordering and can strand the trailing teams together. On 12 teams / 5 courts the first version
 * paired 11v12 EIGHT times. Rotating the tiebreak produces genuinely different schedules at no
 * cost, so generate N of them and keep the best by the owner's own priorities.
 *
 * Scoring order mirrors those priorities exactly: a schedule with unequal games loses to any
 * schedule with equal games, no matter how good it looks otherwise.
 */
export function planBestPool({ teams, courts, rounds, pointsTo = 21, minutesPerGame = 22 }) {
  let best = null, bestScore = null, bestReport = null;
  for (let rot = 0; rot < Number(teams); rot++) {
    const plan = planPool({ teams, courts, rounds, rotate: rot });
    if (!plan.ok) return plan;
    repairRepeats(plan, teams);
    const rep = poolReport(plan, { teams, pointsTo, minutesPerGame });
    // Lexicographic, lower is better, in the owner’s own priority order. A schedule with
    // unequal games loses to any schedule with equal games however good it looks otherwise.
    const score = [
      rep.valid ? 0 : 1,                                  // broken always loses
      rep.gamesPerTeam.equal ? 0 : 1,                     // 1. equal games — the hard rule
      rep.opponents.repeatedPairs,                        //    nobody plays anybody twice
      rep.waiting.backToBackByes,                         // 2. spread the wait
      -(rep.waiting.smallestGapBetweenByes ?? 0),         //    bigger smallest gap is better
      rep.byesPerTeam.equal ? 0 : 1,
    ];
    if (bestScore === null || lexLess(score, bestScore)) { best = plan; bestScore = score; bestReport = rep; }
  }
  return { ...best, report: bestReport };
}

/** True when a is strictly better than b, comparing element by element. */
function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * Repair pass: swap partners within a round to remove repeat match-ups.
 *
 * The greedy builds a round at a time and cannot see that a pairing it takes now forces a repeat
 * six rounds later. This looks at the finished schedule and, for every pair of matches in the same
 * round, tries the two alternative pairings — (a,b)(c,d) → (a,c)(b,d) or (a,d)(b,c). A swap is
 * kept only when it strictly reduces the number of repeated match-ups.
 *
 * Swapping WITHIN a round is what makes this safe: games per team, byes per team and who is on
 * court are all untouched, so the owner's hard constraint (equal games) cannot be broken by the
 * repair. Only who faces whom changes.
 *
 * This is 2-opt local search. It is not guaranteed optimal, and it says so rather than pretending.
 */
export function repairRepeats(plan, teams, maxPasses = 6) {
  const N = Number(teams);
  const key = (a, b) => (a < b ? `${a}v${b}` : `${b}v${a}`);

  const counts = new Map();
  const bump = (a, b, d) => {
    const k = key(a, b);
    const n = (counts.get(k) || 0) + d;
    if (n <= 0) counts.delete(k); else counts.set(k, n);
  };
  for (const round of plan.rounds) for (const m of round) bump(m.a, m.b, 1);

  const repeats = () => [...counts.values()].filter((n) => n > 1).length;

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const round of plan.rounds) {
      for (let i = 0; i < round.length; i++) {
        for (let j = i + 1; j < round.length; j++) {
          const m1 = round[i], m2 = round[j];
          const before = repeats();
          for (const [na, nb, nc, nd] of [
            [m1.a, m2.a, m1.b, m2.b],   // (a,c)(b,d)
            [m1.a, m2.b, m1.b, m2.a],   // (a,d)(b,c)
          ]) {
            bump(m1.a, m1.b, -1); bump(m2.a, m2.b, -1);
            bump(na, nb, 1); bump(nc, nd, 1);
            if (repeats() < before) {
              m1.a = na; m1.b = nb; m2.a = nc; m2.b = nd;
              improved = true;
              break;
            }
            // revert
            bump(na, nb, -1); bump(nc, nd, -1);
            bump(m1.a, m1.b, 1); bump(m2.a, m2.b, 1);
          }
        }
      }
    }
    if (!improved) break;
  }
  return plan;
}

/* ============================ routes ============================ */

let json, requireStaff;
export function wireFormats(h) { ({ json, requireStaff } = h); }

/**
 * Staff-only planning endpoints. Read-only and stateless — they compute and return a schedule,
 * they do not write matches. Committing a plan to real `matches` rows is a separate, deliberate
 * step, because a director must be able to try twelve shapes without creating twelve tournaments.
 *
 *   GET  /api/admin/formats/options?teams=&courts=   → round counts that give equal games
 *   POST /api/admin/formats/plan  {teams,courts,rounds,points_to,minutes_per_game}
 *                                                    → the schedule plus the constraint report
 */
export async function formatsRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;

  if (p === "/api/admin/formats/options" && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const teams = Number(url.searchParams.get("teams"));
    const courts = Number(url.searchParams.get("courts"));
    const options = equalGameOptions(teams, courts);
    return json({
      teams, courts,
      waiting_per_round: Number.isInteger(teams) && Number.isInteger(courts) ? teams - 2 * courts : null,
      options,
      note: options.length
        ? "Only these round counts give every team the same number of games."
        : `${teams} teams on ${courts} courts doesn't leave anyone waiting — every team plays every round.`,
    });
  }

  if (p === "/api/admin/formats/plan" && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const b = await request.json().catch(() => ({}));
    const pointsTo = Number(b.points_to) > 0 ? Number(b.points_to) : 21;
    const minutesPerGame = Number(b.minutes_per_game) > 0 ? Number(b.minutes_per_game) : 22;

    const plan = planBestPool({
      teams: Number(b.teams), courts: Number(b.courts), rounds: Number(b.rounds),
      pointsTo, minutesPerGame,
    });
    if (!plan.ok) return json({ error: plan.error }, 400);

    return json({
      rounds: plan.rounds,
      byes: plan.byes,
      report: plan.report,
      // Plain sentences a director reads before committing. The numbers above are for the UI.
      summary: reportLines(plan.report, {
        teams: Number(b.teams),
        targetGames: b.target_games ? Number(b.target_games) : undefined,
        targetPoints: b.target_points ? Number(b.target_points) : undefined,
        targetHours: b.target_hours ? Number(b.target_hours) : undefined,
      }),
    });
  }

  return null;
}
