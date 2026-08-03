/**
 * Boomtown Platform — court and time allocation
 * File: worker/src/courts.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.78.0
 *
 * Owner 2026-08-03: "bracket generation should honor the fixed court number. However, as brackets
 * collapse courts do become avialable. so there's a need for the scheduling time component if we
 * overlap. We need ability to assign different courts to players based on availability of courts
 * during bracket."
 *
 * THOSE ARE THREE REQUIREMENTS THAT ARGUE WITH EACH OTHER, and the argument is the interesting part:
 *
 *   FIXED     — a division owns courts 5–8 and may not wander onto 1–4. A parent told court 6 walks
 *               to court 6.
 *   COLLAPSING — a bracket halves every round. Sixteen teams need eight courts, then four, then two,
 *               then one. The courts it stops needing are real, empty, and next to a division that
 *               still has sixteen teams queueing.
 *   OVERLAPPING — so two brackets can share a court, as long as they are not on it at the same
 *               moment. Which means time has to exist as something other than "round number".
 *
 * WHY `round` ALONE COULD NOT EXPRESS THIS. Until v0.77.0 a game's only notion of when it happened was
 * its round, and every court turned over together. That is true of pool play and false of a bracket: a
 * four-team division plays two rounds while a sixteen-team division plays four, so "round 3" is a
 * different time of day on court 2 than on court 7. Two games on one court in one round is the defect
 * v0.75.0 found and fixed by brute force — it put every same-stage game in one pool and started a new
 * round when the courts ran out. That worked and it threw away the collapsing courts, because it
 * treated all courts as one undifferentiated pile.
 *
 * EVERYTHING HERE IS PURE. No database, no clock. `slotsFrom` takes a base time as an argument
 * precisely so tests can pass a relative one — a hardcoded `2026-08-03T17:00:00Z` turned a green suite
 * red on a calendar boundary with no code change at all (the v0.74.0 lesson).
 */

/**
 * The courts a bracket is allowed to use, most specific source first.
 *
 * bracket's own range → its division's range → every court at the event. The general case therefore
 * needs no configuration at all, and the exception the owner described — hand a finished division's
 * courts to one that is still going — is expressible without touching the division, whose range is a
 * standing fact about the day rather than a scheduling detail.
 */
export function courtsFor(bracket, division, eventCourtCount) {
  const range = (from, to) => {
    const f = Number(from), t = Number(to);
    if (!f || !t || t < f) return null;
    const out = [];
    for (let c = f; c <= t; c++) out.push(c);
    return out.length ? out : null;
  };
  return range(bracket && bracket.court_from, bracket && bracket.court_to)
    || range(division && division.court_from, division && division.court_to)
    || range(1, Math.max(1, Number(eventCourtCount) || 1));
}

/**
 * Lay every bracket's games onto courts and time slots.
 *
 * `plans` is `[{ bracketId, depth, courts: [n], matches: [{ round, slot, ... }] }]`.
 *
 * THE TWO HARD CONSTRAINTS, both of which are somebody's afternoon if they break:
 *
 *   1. NO COURT HOLDS TWO GAMES IN ONE SLOT. Invisible in the database, drawn happily by the court
 *      grid, discovered by two teams walking to the same net.
 *   2. WITHIN A BRACKET, A ROUND FINISHES BEFORE THE NEXT ONE STARTS. A semi-final cannot be played
 *      before the quarter-final that feeds it. Nothing in the schema prevents scheduling it earlier,
 *      and a generator that did would produce a bracket that cannot physically be played — which is
 *      worse than a double booking, because a double booking is at least obvious on the day.
 *
 * Brackets with DISJOINT court ranges are naturally simultaneous: they never compete for a slot, so
 * both play in slot 0. Brackets that SHARE courts queue, earliest-listed first. And a bracket that has
 * collapsed to one game leaves its other courts free for whoever else is allowed on them — which is
 * the owner's "as brackets collapse courts do become available", falling out of the allocation rather
 * than being special-cased.
 *
 * Returns `{ assignments: [{ bracketId, round, slot, court, wave }], slots }`.
 */
export function allocate(plans) {
  const busy = new Map();                 // "wave:court" -> true
  const floor = new Map();                // bracketId -> earliest wave this bracket may still use
  const assignments = [];
  const stages = Math.max(0, ...plans.map((p) => p.depth));

  // Stage 0 is the FIRST game played, not the final: measured as `depth - round` so a 4-team bracket
  // starts alongside a 16-team bracket's opening round instead of alongside its final.
  for (let stage = 0; stage < stages; stage++) {
    const usedThisStage = new Map();      // bracketId -> highest wave it used, for the floor below

    for (const p of plans) {
      const games = p.matches.filter((m) => p.depth - m.round === stage).sort((a, b) => a.slot - b.slot);
      if (!games.length) continue;
      const start = floor.get(p.bracketId) || 0;

      for (const g of games) {
        // The earliest wave at or after this bracket's floor with a free court IT is allowed on.
        let wave = start, court = null;
        for (; ; wave++) {
          court = p.courts.find((c) => !busy.has(`${wave}:${c}`)) ?? null;
          if (court !== null) break;
          // Guard against an empty court list rather than looping forever on a misconfigured range.
          if (!p.courts.length) break;
        }
        if (court === null) break;        // nothing this bracket may use — reported by the caller
        busy.set(`${wave}:${court}`, true);
        assignments.push({ bracketId: p.bracketId, round: g.round, slot: g.slot, court, wave });
        usedThisStage.set(p.bracketId, Math.max(usedThisStage.get(p.bracketId) ?? 0, wave));
      }
    }

    // Constraint 2: this bracket's next round may not begin until this one has finished.
    for (const [bid, maxWave] of usedThisStage) floor.set(bid, maxWave + 1);
  }

  const slots = assignments.reduce((n, a) => Math.max(n, a.wave + 1), 0);
  return { assignments, slots };
}

/**
 * Turn wave numbers into wall-clock times.
 *
 * `base` is an ISO string and is a PARAMETER, never `new Date()`, so a test can anchor it to something
 * relative. `minutes` is how long a slot is. A wave is one slot: every game in wave 2 starts at
 * base + 2 × minutes, which is what makes "no court twice in one slot" mean "no court twice at one
 * time" rather than merely "no court twice in one abstract round".
 *
 * Returns null for an unusable base, and the caller leaves `starts_at` NULL — a fabricated time on a
 * results sheet is worse than no time (migration 0041).
 */
export function slotsFrom(base, minutes, waves) {
  const t0 = base ? Date.parse(base) : NaN;
  const step = Number(minutes);
  if (!Number.isFinite(t0) || !(step > 0)) return null;
  return Array.from({ length: Math.max(0, waves) }, (_, w) =>
    new Date(t0 + w * step * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"));
}

/**
 * Every court holding more than one game at the same time.
 *
 * The same question the guard in the tests asks, asked at runtime so a hand reassignment can be told
 * what it is about to cause. Games with no `starts_at` fall back to their `round`, so a schedule that
 * never adopted clock times is still checked — a conflict detector that silently ignored the rows it
 * did not understand would report clean on the schedules most likely to be wrong.
 */
export function conflicts(matches) {
  const seen = new Map();
  for (const m of matches) {
    if (!m.court) continue;
    const when = m.starts_at || `r${m.round}`;
    const key = `${when}|${m.court}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(m);
  }
  return [...seen.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      when: key.split("|")[0],
      court: Number(key.split("|")[1]),
      match_ids: list.map((m) => m.id),
    }));
}
