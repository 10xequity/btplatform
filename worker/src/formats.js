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
import { personName, CAPTAIN_JOIN, CAPTAIN_COLS } from "./names.js";

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
/**
 * The floor on games per team. Owner 2026-08-03, unprompted and unambiguous:
 *
 *   "if we do 6 on 2, with 4 games, we would double the number of games to equal 8. So there will
 *    never be a situation we offer only 4 games for pool play."
 *
 * Six teams on two courts hits an equal count at 2, 4, 6, 8, 10 … and the old code would hand back
 * 4 whenever 4 was closest to what was asked for. Four games is half a day for somebody who paid
 * for a full one. Below this number the answer is MORE ROUNDS, not fewer games — and the rematches
 * that come with it are the intended trade, not a defect. Eight games among five opponents is three
 * rematches, and `poolReport` counts them without calling the plan invalid.
 */
export const MIN_GAMES_PER_TEAM = 8;

/**
 * The ceiling, and the recommended top of pool play. Owner, v0.110.0 verbatim:
 *
 *   "generally in a standard tournament template - we would aim to run 8 games in pool play …
 *    Usually though, we have 9-10 ROUNDS (not games) so we hit the 8 … This way the max games
 *    players are playing are approximately 12-16. More than 16 become physically unplayable."
 *
 * MAX_GAMES_PER_TEAM lived in brackets.js from v0.110.0 (the bracket preview's over_ceiling
 * check); T2-4 moved it HERE beside the floor because the options route needs both bounds and
 * brackets.js already imports this file — one home per bound, the v0.109.0 floor precedent
 * mirrored. The 16 is a TOTAL (pool + bracket): a pool-only count of 11–16 is playable by itself
 * but leaves no room for the bracket that follows, which is why the recommended pool window
 * closes at 10. The ceiling is judged before the floor everywhere both apply — short of games is
 * a disappointment; past sixteen is an injury.
 */
export const MAX_GAMES_PER_TEAM = 16;
export const RECOMMENDED_MAX_POOL_GAMES = 10;

/**
 * T2-4 (§-0 B9): the ONE judgement of which equal-game options a director would actually pick.
 * ANNOTATES, never removes — chooseRounds consumes the raw list for its most-that-can-be
 * fallback, and the {minGames} override is a league night's legitimate exit. Callers that OFFER
 * options (the route, and through it the Plan-the-day buttons) read `recommended`; everything
 * out of band carries a sentence saying why, because a greyed choice with no reason teaches an
 * operator to distrust the screen.
 */
export function curatePoolOptions(options) {
  return (options || []).map((o) => {
    const g = o.gamesPerTeam;
    if (g > MAX_GAMES_PER_TEAM) {
      return { ...o, recommended: false, why: `${g} games each is past ${MAX_GAMES_PER_TEAM} — physically unplayable in a day.` };
    }
    if (g < MIN_GAMES_PER_TEAM) {
      return { ...o, recommended: false, why: `${g} games each is under the ${MIN_GAMES_PER_TEAM}-game floor — pool play never offers less.` };
    }
    if (g > RECOMMENDED_MAX_POOL_GAMES) {
      return { ...o, recommended: false, why: `${g} pool games is playable, but leaves no room for a bracket under ${MAX_GAMES_PER_TEAM} total.` };
    }
    return { ...o, recommended: true };
  });
}

export function chooseRounds(teams, courts, targetGames, opts = {}) {
  const minGames = Number(opts.minGames) > 0 ? Number(opts.minGames) : MIN_GAMES_PER_TEAM;
  const all = equalGameOptions(teams, courts);
  if (!all.length) return { ok: false, error: `${teams} teams on ${courts} courts never leaves anyone waiting — every team plays every round.` };

  const asked = Number(targetGames) || minGames;
  const wanted = Math.max(asked, minGames);
  const eligible = all.filter((o) => o.gamesPerTeam >= minGames);

  // The floor cannot be reached at all. Say so and hand back the most that can be, rather than
  // quietly returning something short — the fix is another court or more teams, and the director is
  // the only one who can decide which.
  if (!eligible.length) {
    const top = all[all.length - 1];
    return {
      ok: true, ...top, exact: false, belowFloor: true,
      note: `${teams} teams on ${courts} courts cannot give everyone ${minGames} games with an equal count — the most is ${top.gamesPerTeam}. Add a court, add teams, or run the pool twice.`,
    };
  }

  const raised = wanted > asked
    ? ` ${asked} games each was asked for, and pool play never goes below ${minGames}.`
    : "";

  const exact = eligible.find((o) => o.gamesPerTeam === wanted);
  if (exact) {
    return { ok: true, ...exact, exact: true, raisedToFloor: wanted > asked, note: raised.trim() || undefined };
  }

  const near = eligible.reduce((best, o) =>
    Math.abs(o.gamesPerTeam - wanted) < Math.abs(best.gamesPerTeam - wanted) ? o : best);
  return {
    ok: true, ...near, exact: false, raisedToFloor: wanted > asked,
    note: `${wanted} games each is not possible with ${teams} teams on ${courts} courts — an equal count is only available at ${eligible.map((o) => o.gamesPerTeam).join(", ")}. Closest is ${near.gamesPerTeam}.${raised}`,
  };
}

/**
 * Split `n` teams into pools. Owner 2026-08-03: "Most groupings will break down into ranges of 6-11
 * pools if possible ... generally speaking, we would aim to do larger pools. This is mostly for
 * grass. Indoor tournaments are a lot more limited due to number of courts."
 *
 * So: as FEW pools as possible while keeping every pool inside 6–11 teams. Bigger pools mean more
 * distinct opponents, which is what makes eight games worth turning up for.
 *
 * `ok` is false when n will not fit the range — honest rather than fatal. Five teams is still a
 * pool, it is just a small one, and on limited indoor courts it may be the only option.
 */
export function poolSizes(n, opts = {}) {
  const min = opts.min ?? 6, max = opts.max ?? 11;
  const N = Number(n);
  if (!Number.isInteger(N) || N < 2) return { ok: false, sizes: [], note: "A pool needs at least two teams." };

  if (N < min) {
    return { ok: false, sizes: [N], note: `${N} teams is one pool, under the preferred ${min}. Fine on grass with a small field; indoors it is often the only option.` };
  }

  // Fewest pools that keeps every pool at or under `max` …
  let k = Math.ceil(N / max);
  // … then back off if that would push any pool under `min`.
  while (k > 1 && Math.floor(N / k) < min) k--;

  const base = Math.floor(N / k), extra = N % k;
  const sizes = Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
  const bad = sizes.filter((s) => s < min || s > max);
  return {
    ok: bad.length === 0,
    sizes,
    note: bad.length
      ? `${N} teams will not divide into pools of ${min}–${max}; the closest is ${sizes.join(" + ")}.`
      : `${N} teams into ${k} pool${k === 1 ? "" : "s"} of ${sizes.join(" + ")}.`,
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

/**
 * Assign waiting teams to referee.
 *
 * Owner 2026-08-03: four byes at 12-on-4 is not acceptable as pure idling, but "there is a world
 * where 12 on 4 does work with each team working" — and 6-on-2 exists precisely because it leaves
 * two teams free to ref. A bye a team spends reffing is not the same as a bye they spend standing
 * around, so this turns waiting into working.
 *
 * HARD: refs come only from the waiting set, so a team can never referee a match it is playing in.
 * SOFT: spread the duty — whoever has reffed least goes first.
 *
 * Returns refs[round] = array parallel to that round’s matches; null where nobody was spare.
 */
export function assignRefs(plan, teams) {
  const N = Number(teams);
  const refCount = new Map(Array.from({ length: N }, (_, i) => [i + 1, 0]));
  const refs = [];
  plan.rounds.forEach((round, ri) => {
    const waiting = (plan.byes[ri] || []).slice()
      .sort((a, b) => refCount.get(a) - refCount.get(b) || a - b);
    const perRound = [];
    for (let i = 0; i < round.length; i++) {
      const t = waiting[i];
      if (t === undefined) { perRound.push(null); continue; }
      perRound.push(t);
      refCount.set(t, refCount.get(t) + 1);
    }
    refs.push(perRound);
  });
  plan.refs = refs;
  plan.refLoad = Object.fromEntries(refCount);
  return plan;
}

/**
 * How many of the waiting teams can actually be given a job, and what is left over.
 * Reported rather than hidden: at 12-on-4 four teams wait and only four courts need a ref, so
 * every bye can be a working bye. At 12-on-5 two wait and five courts need refs — three courts
 * go unrefereed, which the director needs to know before promising officials.
 */
export function refCoverage(teams, courts) {
  const waiting = Number(teams) - 2 * Number(courts);
  return {
    waitingPerRound: waiting,
    courtsNeedingRef: Number(courts),
    refereedCourts: Math.min(waiting, Number(courts)),
    unrefereedCourts: Math.max(0, Number(courts) - waiting),
    everyByeWorks: waiting > 0 && waiting <= Number(courts),
  };
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

/**
 * Read an event's live schedule and score it with the SAME report the generator uses.
 *
 * One definition (F-26). The editor could compute its own numbers client-side and feel snappier,
 * but then a hand-edited schedule and a generated one would be judged by two different rules — and
 * the moment those disagree the director stops believing either. Converting the DB rows back into
 * the planner's shape and calling poolReport keeps exactly one answer to "is this fair".
 */
async function loadSchedule(env, ctx, eventId) {
  const ev = await env.DB.prepare(
    "SELECT id, name FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
  ).bind(eventId, ctx.orgId).first();
  if (!ev) return { error: "That event doesn't exist.", status: 404 };

  // T2-3 (v0.122.0): the captain rides along — "sometimes team names make it very hard to
  // determine who the captain is". CAPTAIN_JOIN expects `teams` aliased as `t`, which this query
  // did not have. This route is requireStaff-gated, so the captain is named in FULL; the ungated
  // feeds in tournaments.js must honour the member's own visibility instead.
  const teamRows = (await env.DB.prepare(
    `SELECT t.id, t.name, ${CAPTAIN_COLS} FROM teams t ${CAPTAIN_JOIN}
      WHERE t.org_id=?1 AND t.event_id=?2 AND t.deleted_at IS NULL
      ORDER BY COALESCE(t.seed, 9999), t.id`
  ).bind(ctx.orgId, eventId).all()).results || [];
  const teams = teamRows.map((t) => ({
    id: t.id, name: t.name, captain: personName(t.captain_name, { full: true }),
  }));

  const rows = (await env.DB.prepare(
    `SELECT id, round, court, team_a_id, team_b_id, ref_team_id, score_a, score_b, points_to, cap
       FROM matches WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL
      ORDER BY round, court`
  ).bind(ctx.orgId, eventId).all()).results || [];

  const nameOf = new Map(teams.map((t) => [t.id, t.name]));
  const idxOf = new Map(teams.map((t, i) => [t.id, i + 1]));   // real id → planner 1..N

  const maxRound = rows.reduce((n, r) => Math.max(n, r.round), 0);
  const courts = rows.reduce((n, r) => Math.max(n, r.court), 0);

  // Rebuild the planner shape so poolReport can score it unchanged.
  const planRounds = [], planByes = [];
  for (let r = 1; r <= maxRound; r++) {
    const inRound = rows.filter((x) => x.round === r);
    planRounds.push(inRound
      .filter((x) => x.team_a_id && x.team_b_id)
      .map((x) => ({ court: x.court, a: idxOf.get(x.team_a_id), b: idxOf.get(x.team_b_id) }))
      .filter((x) => x.a && x.b));
    const playing = new Set(inRound.flatMap((x) => [x.team_a_id, x.team_b_id]).filter(Boolean));
    planByes.push(teams.filter((t) => !playing.has(t.id)).map((t) => idxOf.get(t.id)));
  }

  const report = teams.length
    ? poolReport({ rounds: planRounds, byes: planByes }, {
        teams: teams.length,
        pointsTo: rows[0] ? rows[0].points_to || 21 : 21,
      })
    : null;

  return {
    event: { id: ev.id, name: ev.name },
    teams,
    courts,
    rounds: maxRound,
    matches: rows.map((x) => ({
      id: x.id, round: x.round, court: x.court,
      team_a_id: x.team_a_id, team_b_id: x.team_b_id,
      team_a: nameOf.get(x.team_a_id) || null,
      team_b: nameOf.get(x.team_b_id) || null,
      ref_team: nameOf.get(x.ref_team_id) || null,
      // A match with a score is one that has been PLAYED. The editor must warn before moving it —
      // shuffling a finished match is almost always a mis-drag.
      played: x.score_a !== null && x.score_b !== null,
      score_a: x.score_a, score_b: x.score_b,
    })),
    byes: planByes.map((round) => round.map((i) => teams[i - 1] && teams[i - 1].name).filter(Boolean)),
    report,
    summary: report ? reportLines(report, { teams: teams.length }) : [],
  };
}

/* ============================ routes ============================ */

let json, requireStaff, audit;
export function wireFormats(h) { ({ json, requireStaff, audit } = h); }

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
  let x;

  if (p === "/api/admin/formats/options" && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const teams = Number(url.searchParams.get("teams"));
    const courts = Number(url.searchParams.get("courts"));
    // T2-4: the raw list is computed as ever; the route hands back the CURATED view of it. The
    // recommended window is the owner's own standard (8–10 pool games, bracket fits under 16
    // total); everything else stays in the payload with its reason, because the operator
    // overrides defaults — the screen just stops presenting twelve equal buttons as if a
    // 1-game day and an 18-game day were choices anyone makes.
    const options = curatePoolOptions(equalGameOptions(teams, courts));
    const recommendedCount = options.filter((o) => o.recommended).length;
    return json({
      teams, courts,
      waiting_per_round: Number.isInteger(teams) && Number.isInteger(courts) ? teams - 2 * courts : null,
      options,
      recommended_count: recommendedCount,
      band: { floor: MIN_GAMES_PER_TEAM, aim_max: RECOMMENDED_MAX_POOL_GAMES, ceiling: MAX_GAMES_PER_TEAM },
      note: !options.length
        ? `${teams} teams on ${courts} courts doesn't leave anyone waiting — every team plays every round.`
        : recommendedCount
          ? "Only these round counts give every team the same number of games."
          : `${teams} teams on ${courts} courts cannot reach the ${MIN_GAMES_PER_TEAM}-game floor with an equal count — the most is ${options[options.length - 1].gamesPerTeam} games each. Add a court, split the field, or pick a count below and run the pool twice.`,
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
      // W-C (v0.94.0): the owner's pool-split defaults ride along with every plan — poolSizes IS
      // the split table (fewest pools inside 6–11: 15→8+7, 16→8+8, 17→9+8, 19→10+9), and small
      // fields get the honest note instead of a refusal.
      pool_split: poolSizes(Number(b.teams)),
    });
  }

  /* ---- commit a plan to a real event ----
     Until this existed the generator was a calculator: it produced a schedule nobody could play.
     This writes the plan into `matches` for a real event, mapping the planner's 1..N onto the
     event's actual team ids in seed order.

     REFUSES to overwrite silently. If the event already has matches the caller must pass
     replace:true — and even then the old rows are SOFT-deleted, never destroyed, because a
     director who regenerates after scores are in must be able to see what they replaced. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/generate-schedule$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));

    const ev = await env.DB.prepare(
      "SELECT id, name FROM events WHERE id=?1 AND org_id=?2 AND deleted_at IS NULL"
    ).bind(eventId, ctx.orgId).first();
    if (!ev) return json({ error: "That event doesn't exist." }, 404);

    const teamRows = (await env.DB.prepare(
      `SELECT id, name FROM teams WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL
        ORDER BY COALESCE(seed, 9999), id`
    ).bind(ctx.orgId, eventId).all()).results || [];
    if (teamRows.length < 2) return json({ error: "Add the teams first — there is nothing to schedule yet." }, 409);

    const courts = Number(b.courts);
    const rounds = Number(b.rounds);
    const pointsTo = Number(b.points_to) > 0 ? Number(b.points_to) : 21;
    const cap = Number(b.cap) > 0 ? Number(b.cap) : pointsTo + 2;
    const minutesPerGame = Number(b.minutes_per_game) > 0 ? Number(b.minutes_per_game) : 22;

    const plan = planBestPool({ teams: teamRows.length, courts, rounds, pointsTo, minutesPerGame });
    if (!plan.ok) return json({ error: plan.error }, 400);
    if (!plan.report.valid) {
      return json({ error: "That schedule is not usable: " + plan.report.problems[0] }, 400);
    }
    if (b.assign_refs) assignRefs(plan, teamRows.length);

    const existing = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM matches WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
    ).bind(ctx.orgId, eventId).first();
    if (existing.n > 0 && !b.replace) {
      return json({
        error: ev.name + " already has " + existing.n + " matches. Generating again would put a second schedule on top of the first.",
        existing_matches: existing.n,
        hint: "Send replace: true to set the current schedule aside and use this one instead.",
      }, 409);
    }

    let replaced = 0;
    if (existing.n > 0 && b.replace) {
      const del = await env.DB.prepare(
        "UPDATE matches SET deleted_at=datetime('now') WHERE org_id=?1 AND event_id=?2 AND deleted_at IS NULL"
      ).bind(ctx.orgId, eventId).run();
      replaced = del.meta.changes;
    }

    // Planner index (1..N) → real team id, in seed order.
    const idOf = (n) => teamRows[n - 1].id;

    let written = 0;
    for (let ri = 0; ri < plan.rounds.length; ri++) {
      const round = plan.rounds[ri];
      for (let mi = 0; mi < round.length; mi++) {
        const mt = round[mi];
        const refIdx = plan.refs && plan.refs[ri] ? plan.refs[ri][mi] : null;
        await env.DB.prepare(
          `INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id,
                                ref_team_id, points_to, cap, game_number)
           VALUES (?1,?2,'pool',?3,?4,?5,?6,?7,?8,?9,1)`
        ).bind(ctx.orgId, eventId, ri + 1, mt.court, idOf(mt.a), idOf(mt.b),
               refIdx ? idOf(refIdx) : null, pointsTo, cap).run();
        written++;
      }
    }

    await audit(env, ctx, "schedule.generate", "events", eventId,
      { matches: written, replaced, teams: teamRows.length, courts, rounds });

    return json({
      ok: true,
      event: ev.name,
      teams: teamRows.length,
      matches_written: written,
      matches_replaced: replaced,
      report: plan.report,
      summary: reportLines(plan.report, { teams: teamRows.length }),
      // Byes by NAME, not by number — a director reads names, and the planner's 1..N is an
      // internal detail that should never reach a screen.
      byes: plan.byes.map((round) => round.map((n) => teamRows[n - 1].name)),
    });
  }

  /* ---- the schedule editor ----
     A generated schedule is a starting point, not an answer. A director always knows something the
     solver does not: this team asked to finish early, that court has a broken net, these two should
     not meet in round one. Until they can move a match without regenerating, they keep the real
     schedule in a spreadsheet — which is the whole reason this exists.

     The editor's rule: it NEVER refuses a move. It re-scores and tells you what the move cost. A
     tool that blocks the director is a tool the director routes around. */

  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/schedule$/)) && m === "GET") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const loaded = await loadSchedule(env, ctx, eventId);
    if (loaded.error) return json({ error: loaded.error }, loaded.status || 404);
    return json(loaded);
  }

  /* Move a match to another round/court. If something is already there the two SWAP — dragging
     onto an occupied slot means "these two should trade places", which is what a director means
     every time. Silently overwriting the other match would lose it. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/schedule\/move$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const matchId = Number(b.match_id);
    const toRound = Number(b.round);
    const toCourt = Number(b.court);
    if (!matchId || !Number.isInteger(toRound) || !Number.isInteger(toCourt) || toRound < 1 || toCourt < 1) {
      return json({ error: "Say which match, and which round and court to move it to." }, 400);
    }

    const mv = await env.DB.prepare(
      "SELECT id, round, court FROM matches WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL"
    ).bind(matchId, ctx.orgId, eventId).first();
    if (!mv) return json({ error: "That match isn't part of this event." }, 404);

    const occupant = await env.DB.prepare(
      `SELECT id FROM matches WHERE org_id=?1 AND event_id=?2 AND round=?3 AND court=?4
         AND deleted_at IS NULL AND id != ?5`
    ).bind(ctx.orgId, eventId, toRound, toCourt, matchId).first();

    if (occupant) {
      // Two writes, no transaction available on D1 here — so park the mover on a court number that
      // cannot collide first. Without this the unique-ish (round, court) pairing briefly doubles up
      // and a concurrent read sees two matches on one court.
      await env.DB.prepare("UPDATE matches SET court=-1, updated_at=datetime('now') WHERE id=?1 AND org_id=?2")
        .bind(matchId, ctx.orgId).run();
      await env.DB.prepare("UPDATE matches SET round=?1, court=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4")
        .bind(mv.round, mv.court, occupant.id, ctx.orgId).run();
      await env.DB.prepare("UPDATE matches SET round=?1, court=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4")
        .bind(toRound, toCourt, matchId, ctx.orgId).run();
    } else {
      await env.DB.prepare("UPDATE matches SET round=?1, court=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4")
        .bind(toRound, toCourt, matchId, ctx.orgId).run();
    }

    await audit(env, ctx, "schedule.move", "matches", matchId,
      { from: `${mv.round}/${mv.court}`, to: `${toRound}/${toCourt}`, swapped: occupant ? occupant.id : null });

    const loaded = await loadSchedule(env, ctx, eventId);
    return json({ ok: true, swapped_with: occupant ? occupant.id : null, ...loaded });
  }

  /* Swap the two TEAMS in a match, or replace one side. Changing who plays whom is a different
     operation from moving when they play, and conflating them in one endpoint makes both confusing. */
  if ((x = p.match(/^\/api\/admin\/events\/(\d+)\/schedule\/teams$/)) && m === "POST") {
    const denied = await requireStaff(env, ctx);
    if (denied) return denied;
    const eventId = +x[1];
    const b = await request.json().catch(() => ({}));
    const matchId = Number(b.match_id);
    if (!matchId) return json({ error: "Say which match." }, 400);

    const mt = await env.DB.prepare(
      "SELECT id, team_a_id, team_b_id FROM matches WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL"
    ).bind(matchId, ctx.orgId, eventId).first();
    if (!mt) return json({ error: "That match isn't part of this event." }, 404);

    const a = b.team_a_id === undefined ? mt.team_a_id : (b.team_a_id === null ? null : Number(b.team_a_id));
    const bb = b.team_b_id === undefined ? mt.team_b_id : (b.team_b_id === null ? null : Number(b.team_b_id));
    if (a && bb && a === bb) return json({ error: "A team can't play itself." }, 400);

    for (const t of [a, bb].filter(Boolean)) {
      const ok = await env.DB.prepare(
        "SELECT id FROM teams WHERE id=?1 AND org_id=?2 AND event_id=?3 AND deleted_at IS NULL"
      ).bind(t, ctx.orgId, eventId).first();
      if (!ok) return json({ error: "One of those teams isn't in this event." }, 400);
    }

    await env.DB.prepare(
      "UPDATE matches SET team_a_id=?1, team_b_id=?2, updated_at=datetime('now') WHERE id=?3 AND org_id=?4"
    ).bind(a, bb, matchId, ctx.orgId).run();
    await audit(env, ctx, "schedule.teams", "matches", matchId, { team_a_id: a, team_b_id: bb });

    const loaded = await loadSchedule(env, ctx, eventId);
    return json({ ok: true, ...loaded });
  }

  return null;
}
