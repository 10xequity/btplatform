/**
 * Boomtown Platform — Tournament Engine (scheduler, standings, brackets)
 * Version: v0.2 · Date: 2026-07-21
 * Pure functions, no I/O — runs in the Worker and is unit-testable in Node.
 *
 * Encodes spec §3.1:
 *  - Partial round-robin (no pair meets twice), byes balanced ±1
 *  - Feasibility pre-check that proposes fixes instead of erroring
 *  - Standings: wins → point differential → head-to-head
 *  - A/BB bracket break, best-of-3 (21-21-15) semis/finals
 */

const FORMAT_TEMPLATES = {
  "7-on-3":  { teams: 7,  courts: 3, gamesPerTeam: 6,  pointsTo: 25, cap: 30 },
  "10-on-4": { teams: 10, courts: 4, gamesPerTeam: 8,  pointsTo: 21, cap: 23 },
  "11-on-5": { teams: 11, courts: 5, gamesPerTeam: 10, pointsTo: 21, cap: 23 },
  "8-on-4":  { teams: 8,  courts: 4, gamesPerTeam: 7,  pointsTo: 25, cap: 27 },
  "9-on-4":  { teams: 9,  courts: 4, gamesPerTeam: 8,  pointsTo: 25, cap: 27 },
  "4-on-2x2":{ teams: 4,  courts: 2, gamesPerTeam: 6,  pointsTo: 21, cap: 23, doublePairings: true },
};

/** Average minutes per game incl. switchover, by points target (configurable defaults). */
function avgGameMinutes(pointsTo) {
  if (pointsTo >= 30) return 30;
  if (pointsTo >= 25) return 26;
  return 22; // 21-point game, spec default
}

/**
 * Feasibility pre-check (spec §3.1). Never hard-errors: returns ok/warnings/fixes.
 * budgetMinutes default 420 (7 hr).
 */
function feasibility({ teams, courts, gamesPerTeam, pointsTo = 21, budgetMinutes = 420, avgMin }) {
  const warnings = [];
  const fixes = [];
  const n = teams, g = gamesPerTeam;

  if (n < 2) return { ok: false, warnings: ["Need at least 2 teams."], fixes };
  if (g > n - 1) {
    fixes.push({ change: { gamesPerTeam: n - 1 }, why: `Only ${n - 1} unique opponents exist for ${n} teams.` });
    return { ok: false, warnings: [`${g} games/team impossible without rematches.`], fixes };
  }

  let totalGames = (n * g) / 2;
  if (!Number.isInteger(totalGames)) {
    warnings.push(`${n} teams × ${g} games is odd — one team will play ${g - 1} games.`);
    totalGames = Math.floor(totalGames);
  }
  const perRound = Math.min(courts, Math.floor(n / 2));
  const rounds = Math.ceil(totalGames / perRound);
  const minutes = rounds * (avgMin || avgGameMinutes(pointsTo));
  const points = g * pointsTo;

  if (points < 161 || points > 200) {
    warnings.push(`Point equivalency ${points}/team is outside the 161–200 band.`);
    const targetG = Math.round(180 / pointsTo);
    if (targetG !== g && targetG <= n - 1) fixes.push({ change: { gamesPerTeam: targetG }, why: `${targetG} games ≈ ${targetG * pointsTo} pts/team.` });
  }
  if (minutes > budgetMinutes) {
    warnings.push(`Estimated pool play ${Math.round(minutes / 6) / 10} hr exceeds the ${budgetMinutes / 60} hr budget.`);
    if (g - 1 >= 1) fixes.push({ change: { gamesPerTeam: g - 1 }, why: "Drop one game per team." });
    if (courts + 1 <= Math.floor(n / 2)) fixes.push({ change: { courts: courts + 1 }, why: "Add a court." });
    if (pointsTo > 21) fixes.push({ change: { pointsTo: 21 }, why: "Shorter games (to 21)." });
  }
  return { ok: minutes <= budgetMinutes && g <= n - 1, rounds, totalGames, estMinutes: minutes, pointsPerTeam: points, warnings, fixes };
}

/**
 * Pairings via circle method (partial round-robin): take enough full RR rounds
 * that each team reaches gamesPerTeam. No pair repeats by construction.
 */
function generatePairings(n, gamesPerTeam) {
  const odd = n % 2 === 1;
  const m = odd ? n + 1 : n; // dummy team = bye marker
  const arr = Array.from({ length: m }, (_, i) => i);
  const rrRounds = [];
  for (let r = 0; r < m - 1; r++) {
    const round = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i], b = arr[m - 1 - i];
      if (a < n && b < n) round.push([a, b]);
    }
    rrRounds.push(round);
    arr.splice(1, 0, arr.pop()); // rotate all but the first
  }
  const played = Array(n).fill(0);
  const pairings = [];
  for (const round of rrRounds) {
    if (Math.min(...played) >= gamesPerTeam) break;
    for (const [a, b] of round) {
      if (played[a] < gamesPerTeam && played[b] < gamesPerTeam) {
        pairings.push([a, b]);
        played[a]++; played[b]++;
      }
    }
  }
  return { pairings, played };
}

/**
 * Pack pairings into rounds × courts.
 * Greedy with bye-balancing priority + random-restart if the greedy strands games.
 * Constraints: no team twice per round; ≤ courts matches per round; byes balanced.
 * Refs (work teams) assigned from that round's bye teams, rotating.
 */
function scheduleMatches(pairings, courts, n, maxRestarts = 400) {
  const targetRounds = Math.ceil(pairings.length / Math.min(courts, Math.floor(n / 2)));
  let best = null;
  for (let attempt = 0; attempt < maxRestarts; attempt++) {
    const remaining = shuffle(pairings.slice(), attempt);
    const rounds = [];
    const byeCount = Array(n).fill(0);
    let stranded = false;
    while (remaining.length) {
      const inRound = new Set();
      const round = [];
      // priority: teams with more byes so far should play; stable greedy over remaining
      remaining.sort((p, q) => (byeCount[q[0]] + byeCount[q[1]]) - (byeCount[p[0]] + byeCount[p[1]]));
      for (let i = 0; i < remaining.length && round.length < courts; i++) {
        const [a, b] = remaining[i];
        if (!inRound.has(a) && !inRound.has(b)) {
          round.push([a, b]);
          inRound.add(a); inRound.add(b);
          remaining.splice(i, 1); i--;
        }
      }
      if (round.length === 0) { stranded = true; break; }
      const byes = [];
      for (let t = 0; t < n; t++) if (!inRound.has(t)) { byes.push(t); byeCount[t]++; }
      rounds.push({ matches: round, byes });
    }
    if (stranded) continue;
    const spread = Math.max(...byeCount) - Math.min(...byeCount);
    const score = rounds.length * 100 + spread;
    if (!best || score < best.score) best = { rounds, byeCount, spread, score };
    if (best.rounds.length <= targetRounds && best.spread <= 1) break;
  }
  if (!best) return null;
  // ref assignment: rotate through each round's bye teams; if no byes, team on next court refs later games — flag null for admin.
  best.rounds.forEach((r, ri) => {
    r.matches = r.matches.map(([a, b], ci) => ({
      round: ri + 1,
      court: ci + 1,
      teamA: a,
      teamB: b,
      ref: r.byes.length ? r.byes[ci % r.byes.length] : null,
    }));
  });
  return best;
}

/** Validate a (possibly hand-edited) schedule. Returns warnings, never blocks (spec: operator override wins). */
function validateSchedule(matches, n) {
  const warnings = [];
  const meet = new Map();
  const perRound = new Map();
  for (const m of matches) {
    const key = [Math.min(m.teamA, m.teamB), Math.max(m.teamA, m.teamB)].join("-");
    meet.set(key, (meet.get(key) || 0) + 1);
    const rk = m.round;
    if (!perRound.has(rk)) perRound.set(rk, new Set());
    for (const t of [m.teamA, m.teamB]) {
      if (perRound.get(rk).has(t)) warnings.push({ type: "double-booked", round: rk, team: t });
      perRound.get(rk).add(t);
    }
  }
  for (const [key, count] of meet) if (count > 1 && !FORMAT_TEMPLATES_ALLOWS_REMATCH) warnings.push({ type: "rematch", pair: key, count });
  return warnings;
}
const FORMAT_TEMPLATES_ALLOWS_REMATCH = false;

/** Standings: wins → point differential → head-to-head (2-way ties) → points for. */
function computeStandings(matches, teamIds) {
  const s = new Map(teamIds.map((t) => [t, { team: t, wins: 0, losses: 0, diff: 0, pf: 0, pa: 0 }]));
  const h2h = new Map(); // "a-b" -> winner
  for (const m of matches) {
    if (m.scoreA == null || m.scoreB == null) continue;
    const A = s.get(m.teamA), B = s.get(m.teamB);
    if (!A || !B) continue;
    A.pf += m.scoreA; A.pa += m.scoreB; A.diff += m.scoreA - m.scoreB;
    B.pf += m.scoreB; B.pa += m.scoreA; B.diff += m.scoreB - m.scoreA;
    const winner = m.scoreA > m.scoreB ? m.teamA : m.teamB;
    const loser = winner === m.teamA ? m.teamB : m.teamA;
    s.get(winner).wins++; s.get(loser).losses++;
    h2h.set(`${winner}-${loser}`, winner);
  }
  const rows = [...s.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.diff !== x.diff) return y.diff - x.diff;
    const head = h2h.get(`${x.team}-${y.team}`) != null ? -1 : h2h.get(`${y.team}-${x.team}`) != null ? 1 : 0;
    if (head) return head;
    return y.pf - x.pf;
  });
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/**
 * Bracket break (spec: "Top X A / rest BB", "everyone breaks", …).
 * Single elimination, standard seeding (1vN, 2vN-1…), semis/finals best-of-3 21-21-15.
 */
function buildBracket(standings, { aSize = 8, includeRest = true } = {}) {
  const seeds = standings.map((r) => r.team);
  const brackets = [];
  const a = seeds.slice(0, Math.min(aSize, seeds.length));
  brackets.push({ name: "A", teams: a, matches: seedSingleElim(a) });
  if (includeRest && seeds.length > aSize) {
    const bb = seeds.slice(aSize);
    brackets.push({ name: "BB", teams: bb, matches: seedSingleElim(bb) });
  }
  return brackets;
}

function seedSingleElim(teams) {
  const n = teams.length;
  if (n < 2) return [];
  const size = 2 ** Math.ceil(Math.log2(n));
  const order = bracketOrder(size);
  const matches = [];
  const stageFor = (roundsLeft) => (roundsLeft === 1 ? "final" : roundsLeft === 2 ? "semi" : "quarter");
  const totalRounds = Math.log2(size);
  for (let i = 0; i < size / 2; i++) {
    const sa = order[2 * i], sb = order[2 * i + 1];
    matches.push({
      stage: stageFor(totalRounds),
      slot: i + 1,
      teamA: sa <= n ? teams[sa - 1] : null, // null = bye
      teamB: sb <= n ? teams[sb - 1] : null,
      bestOf: totalRounds <= 2 ? 3 : 1, // semis & finals best-of-3 (21-21-15); earlier rounds 1 game
      games: totalRounds <= 2 ? [21, 21, 15] : [21],
    });
  }
  return matches;
}

function bracketOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const next = [];
    const m = order.length * 2 + 1;
    for (const s of order) next.push(s, m - s);
    order = next;
  }
  return order;
}

function shuffle(arr, seed) {
  let s = seed * 2654435761 + 1;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export {
  FORMAT_TEMPLATES,
  feasibility,
  generatePairings,
  scheduleMatches,
  validateSchedule,
  computeStandings,
  buildBracket,
  avgGameMinutes,
};
