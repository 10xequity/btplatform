/* Boomtown Platform — court and time allocation
   File: worker/test/courts.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.78.0

   Owner 2026-08-03: "bracket generation should honor the fixed court number. However, as brackets
   collapse courts do become avialable. so there's a need for the scheduling time component if we
   overlap. We need ability to assign different courts to players based on availability of courts
   during bracket."

   THREE REQUIREMENTS THAT ARGUE WITH EACH OTHER, so each is asserted separately AND together:
     fixed       — a division owns 5-8 and may not wander onto 1-4
     collapsing  — a bracket halves each round and the courts it stops needing are real and empty
     overlapping — so two brackets can share a court, at different times

   ALL RELATIVE DATES. A hardcoded 2026-08-03T17:00:00Z turned a green suite red on a calendar
   boundary with no code change at all (the v0.74.0 lesson), so every time here is derived. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { courtsFor, allocate, slotsFrom, conflicts } from "../src/courts.js";

/** A bracket plan of `n` teams: depth rounds, halving each round. */
function plan(bracketId, n, courts) {
  const size = 2 ** Math.ceil(Math.log2(n));
  const depth = Math.log2(size);
  const matches = [];
  for (let r = depth; r >= 1; r--) {
    for (let slot = 1; slot <= 2 ** (r - 1); slot++) matches.push({ round: r, slot });
  }
  return { bracketId, depth, matches, courts };
}

/** Every (wave, court) pair used more than once. Empty is the only acceptable answer. */
const doubleBooked = (assignments) => {
  const seen = new Map();
  for (const a of assignments) {
    const k = `${a.wave}:${a.court}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
};

/* ================================ which courts a bracket may use ================================ */

test("a bracket's own range wins, then its division's, then the whole event", () => {
  // Resolution order is the whole design: the general case needs no configuration, and the exception
  // the owner described — hand a finished division's courts to one still going — is expressible without
  // editing the division, whose range is a standing fact about the day.
  assert.deepEqual(courtsFor({ court_from: 3, court_to: 5 }, { court_from: 1, court_to: 8 }, 12), [3, 4, 5],
    "the bracket's own range must beat its division's");
  assert.deepEqual(courtsFor({}, { court_from: 5, court_to: 8 }, 12), [5, 6, 7, 8],
    "with no bracket range, the division's applies");
  assert.deepEqual(courtsFor({}, null, 4), [1, 2, 3, 4],
    "with neither, every court at the event");
  assert.deepEqual(courtsFor(null, null, 1), [1]);
});

test("a nonsense range is ignored rather than obeyed", () => {
  // A backwards or half-filled range is a configuration mistake. Obeying it would silently give a
  // bracket zero courts, and every game would come out unplaced with nothing saying why.
  for (const bad of [{ court_from: 8, court_to: 4 }, { court_from: 3 }, { court_to: 3 }, { court_from: 0, court_to: 0 }]) {
    assert.deepEqual(courtsFor(bad, null, 4), [1, 2, 3, 4], `${JSON.stringify(bad)} must fall through`);
  }
});

/* ================================ no court twice at one time ================================ */

test("one bracket with more games than courts spreads over waves, never doubling up", () => {
  // 16 teams on 4 courts: the first round is EIGHT games. Two waves, not eight games on four courts.
  const a = allocate([plan(1, 16, [1, 2, 3, 4])]);
  assert.deepEqual(doubleBooked(a.assignments), [], "a court was given two games at one time");
  assert.equal(a.assignments.length, 15, "16 teams is 15 games");
  const firstRound = a.assignments.filter((x) => x.round === 4);
  assert.equal(firstRound.length, 8);
  assert.deepEqual([...new Set(firstRound.map((x) => x.wave))].sort(), [0, 1], "8 games on 4 courts is two waves");
});

test("a round finishes before the next one starts", () => {
  /* THE CONSTRAINT THAT MATTERS MORE THAN DOUBLE BOOKING, because a double booking is at least obvious
     on the day. A semi-final cannot be played before the quarter-final that feeds it; nothing in the
     schema prevents scheduling it earlier, and a generator that did would emit a bracket that cannot
     physically be played. */
  const a = allocate([plan(1, 16, [1, 2, 3, 4])]);
  const waveRange = (round) => {
    const w = a.assignments.filter((x) => x.round === round).map((x) => x.wave);
    return [Math.min(...w), Math.max(...w)];
  };
  for (let r = 4; r > 1; r--) {
    const [, lastOfEarlier] = waveRange(r);
    const [firstOfNext] = waveRange(r - 1);
    assert.ok(firstOfNext > lastOfEarlier,
      `round ${r - 1} starts in wave ${firstOfNext} but round ${r} is still running at wave ${lastOfEarlier}`);
  }
});

/* ================================ fixed, and collapsing ================================ */

test("brackets on DISJOINT courts run at the same time", () => {
  // Two divisions, courts 1-4 and 5-8. They never compete for a slot, so both start in wave 0 — a
  // scheduler that queued them would leave half the facility empty all morning.
  const a = allocate([plan(1, 8, [1, 2, 3, 4]), plan(2, 8, [5, 6, 7, 8])]);
  assert.deepEqual(doubleBooked(a.assignments), []);
  const firstOf = (bid) => Math.min(...a.assignments.filter((x) => x.bracketId === bid).map((x) => x.wave));
  assert.equal(firstOf(1), 0);
  assert.equal(firstOf(2), 0, "a bracket on its own courts must not wait for an unrelated one");
  // And neither strays off its own range — "honor the fixed court number".
  for (const x of a.assignments.filter((y) => y.bracketId === 1)) assert.ok(x.court <= 4, `A wandered onto ${x.court}`);
  for (const x of a.assignments.filter((y) => y.bracketId === 2)) assert.ok(x.court >= 5, `BB wandered onto ${x.court}`);
});

test("brackets SHARING courts queue instead of colliding", () => {
  // The v0.75.0 defect, from the other direction: an A and a BB both drawn on courts 1-4 must not both
  // claim court 1 in the same slot.
  const a = allocate([plan(1, 8, [1, 2, 3, 4]), plan(2, 8, [1, 2, 3, 4])]);
  assert.deepEqual(doubleBooked(a.assignments), [], "two brackets shared a court at one time");
  assert.equal(a.assignments.length, 7 + 7);
});

test("courts freed by a collapsing bracket are used by one that is still going", () => {
  /* The owner's "as brackets collapse courts do become avialable", which the v0.75.0 fix threw away by
     treating all courts as one undifferentiated pile. A 4-team bracket is finished after two rounds; a
     16-team bracket sharing the same courts must then spread out over what it left behind. */
  const wide = plan(1, 16, [1, 2, 3, 4]);
  const small = plan(2, 4, [1, 2, 3, 4]);
  const a = allocate([small, wide]);          // small listed FIRST, so it takes courts early
  assert.deepEqual(doubleBooked(a.assignments), []);

  const smallLast = Math.max(...a.assignments.filter((x) => x.bracketId === 2).map((x) => x.wave));
  const wideAfter = a.assignments.filter((x) => x.bracketId === 1 && x.wave > smallLast);
  assert.ok(wideAfter.length > 0, "the big bracket must still be running after the small one finishes");
  // In any wave after the small bracket is done, the big one may use all four courts.
  const byWave = new Map();
  for (const x of wideAfter) byWave.set(x.wave, (byWave.get(x.wave) || 0) + 1);
  assert.ok(Math.max(...byWave.values()) >= 2,
    "once the courts are free the remaining bracket should be using more than one of them");
});

test("a bracket confined to ONE court simply queues, and stays on it", () => {
  // The degenerate case of "fixed": a division with a single court. Every game is sequential, nothing
  // collides, and nothing wanders. Worth asserting because a one-element range is where an off-by-one
  // in the court search would surface.
  const a = allocate([plan(1, 8, [7])]);
  assert.deepEqual(doubleBooked(a.assignments), []);
  assert.deepEqual([...new Set(a.assignments.map((x) => x.court))], [7]);
  assert.equal(new Set(a.assignments.map((x) => x.wave)).size, a.assignments.length,
    "on one court every game needs its own slot");
});

test("a bracket with NO usable court is reported, not looped on forever", () => {
  // An empty range is a misconfiguration. Returning nothing is right; hanging is not, and an infinite
  // loop in a Worker is a request that never answers rather than an error somebody can read.
  const a = allocate([{ bracketId: 1, depth: 2, matches: [{ round: 2, slot: 1 }], courts: [] }]);
  assert.deepEqual(a.assignments, [], "no courts means no assignments");
  assert.equal(a.slots, 0);
});

test("many brackets, many sizes, one facility: still never double-booked", () => {
  // The widest set. A rule that is right for two brackets and wrong for five is a rule nobody can trust
  // on a day with five divisions.
  const a = allocate([
    plan(1, 16, [1, 2, 3, 4]), plan(2, 8, [1, 2, 3, 4]), plan(3, 4, [5, 6]),
    plan(4, 8, [5, 6]), plan(5, 2, [7]),
  ]);
  assert.deepEqual(doubleBooked(a.assignments), []);
  assert.equal(a.assignments.length, 15 + 7 + 3 + 7 + 1);
  for (const [bid, allowed] of [[1, [1, 2, 3, 4]], [3, [5, 6]], [5, [7]]]) {
    for (const x of a.assignments.filter((y) => y.bracketId === bid)) {
      assert.ok(allowed.includes(x.court), `bracket ${bid} used court ${x.court}, not in ${allowed}`);
    }
  }
});

test("NC: the double-booking detector can fail — a real collision is caught", () => {
  // Every assertion above reads `deepEqual(doubleBooked(...), [])`, which is also what a detector
  // looking at the wrong field returns. So it is fed a genuine collision.
  const collision = [
    { bracketId: 1, round: 3, slot: 1, court: 2, wave: 0 },
    { bracketId: 2, round: 3, slot: 1, court: 2, wave: 0 },
  ];
  assert.deepEqual(doubleBooked(collision), ["0:2"], "the detector missed two games on one court in one wave");
  // And the same two games in different waves are fine — otherwise it would flag everything.
  assert.deepEqual(doubleBooked([collision[0], { ...collision[1], wave: 1 }]), []);
});

/* ================================ wall-clock times ================================ */

test("waves become real times, spaced by the slot length", () => {
  // `base` is a PARAMETER, never new Date(), so this can be anchored relative to now and never break on
  // a calendar boundary.
  const base = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const t = slotsFrom(base, 45, 4);
  assert.equal(t.length, 4);
  assert.equal(t[0], base, "wave 0 is the base time itself");
  for (let i = 1; i < t.length; i++) {
    assert.equal(Date.parse(t[i]) - Date.parse(t[i - 1]), 45 * 60_000, "each wave is one slot later");
  }
});

test("no base time and no slot length means NO time, not a made-up one", () => {
  // Migration 0041: `starts_at` is nullable on purpose. A fabricated time on a results sheet is worse
  // than no time, and NOT NULL would have forced one onto every historical row.
  assert.equal(slotsFrom(null, 45, 3), null);
  assert.equal(slotsFrom("not a date", 45, 3), null);
  assert.equal(slotsFrom(new Date().toISOString(), 0, 3), null);
  assert.equal(slotsFrom(new Date().toISOString(), -10, 3), null);
  assert.deepEqual(slotsFrom(new Date().toISOString(), 30, 0), []);
});

/* ================================ conflicts at runtime ================================ */

test("the runtime conflict check finds two games on one court at one time", () => {
  const when = new Date(Date.now() + 3_600_000).toISOString();
  const c = conflicts([
    { id: 1, court: 3, starts_at: when, round: 5 },
    { id: 2, court: 3, starts_at: when, round: 5 },
    { id: 3, court: 4, starts_at: when, round: 5 },
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].court, 3);
  assert.deepEqual(c[0].match_ids.sort(), [1, 2]);
});

test("games with no clock time fall back to their round, so old schedules are still checked", () => {
  /* A conflict detector that silently ignored the rows it did not understand would report clean on
     exactly the schedules most likely to be wrong — every one written before `starts_at` existed. */
  const c = conflicts([
    { id: 1, court: 2, starts_at: null, round: 7 },
    { id: 2, court: 2, starts_at: null, round: 7 },
    { id: 3, court: 2, starts_at: null, round: 8 },
  ]);
  assert.equal(c.length, 1, "two games on court 2 in round 7 is a conflict even with no times");
  assert.deepEqual(c[0].match_ids.sort(), [1, 2]);
  assert.equal(c[0].when, "r7");
});

test("a game on no court at all is not a conflict", () => {
  // court 0 means "not placed" — the state a game is left in when its bracket had no usable range.
  // Treating several of those as colliding would report a conflict nobody can act on.
  assert.deepEqual(conflicts([
    { id: 1, court: 0, starts_at: null, round: 1 },
    { id: 2, court: 0, starts_at: null, round: 1 },
  ]), []);
});

test("NC: the runtime check can report clean — a well-spaced schedule has no conflicts", () => {
  const t0 = Date.now() + 3_600_000;
  assert.deepEqual(conflicts([
    { id: 1, court: 1, starts_at: new Date(t0).toISOString(), round: 1 },
    { id: 2, court: 1, starts_at: new Date(t0 + 2_700_000).toISOString(), round: 2 },
    { id: 3, court: 2, starts_at: new Date(t0).toISOString(), round: 1 },
  ]), [], "a schedule with no collisions must not be flagged, or the check is useless");
});
