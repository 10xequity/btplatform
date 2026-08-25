/**
 * Boomtown Platform — King / Queen of the Court, the engine
 * File: worker/src/kotc.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.76.0
 *
 * Owner 2026-08-03, verbatim (full text in `docs/2026-08-03_spec_kotc_v1_1.md` §1):
 *   "they will play with everyone then change the next round where the top players on that net move
 *    to the next completing 4 to a net. They will enter scores, which tally and then ranked and
 *    seeded. They then fill the next net based on number of nets - determine number of players going
 *    up."
 *
 * INDIVIDUALS ENTER, NOT TEAMS. One person registers. There is no team row for them to belong to, and
 * the partnership they play in lasts exactly one game. That single fact is why this needs its own
 * tables (migration 0040) rather than a column somewhere.
 *
 * EVERYTHING HERE IS PURE. No database, no request, no clock. Every function takes plain values and
 * returns plain values, so the whole format is testable without a fixture and the same code answers
 * "what would the next round look like" for a preview and "what to write" for the real thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * THE FINDING THAT SHAPED THIS FILE, and it contradicts the spec it was built from.
 *
 * Spec §4 item 5 asks for `partnerHistory` "so `nextRound` can prefer a fresh pairing when it has a
 * free choice". IT NEVER HAS A FREE CHOICE. Four players on a net make exactly three pairings and the
 * round plays all three; five players make exactly ten and the round plays all ten. There is no
 * pairing decision to make at either size — only the ORDER of the games, which does not change who
 * partners whom.
 *
 * So a partner repeat is decided entirely by who shares a net, and who shares a net is decided by the
 * scores. `partnerHistory` is therefore REPORTING, plus a tie-break of last resort when two players
 * are level and only one of them can move. That is still exactly what the owner asked for — "yes they
 * can repeat - idealy not if possible, but it can happen, not a fixed position" — but the honest
 * mechanism is much smaller than the spec assumed, and pretending otherwise would mean writing an
 * optimiser with nothing to optimise.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */

/** A net of four plays three games; a net of five plays five. Nothing else is a net. */
export const NET_SIZES = [4, 5];

/**
 * The games one net plays, as seat indices.
 *
 * FOUR PLAYERS — three games, every player partnering each of the other three exactly once:
 *   0+1 v 2+3 · 0+2 v 1+3 · 0+3 v 1+2
 *
 * FIVE PLAYERS — five games. Player k sits out game k, and the other four split as
 * (k+1, k+4) against (k+2, k+3) counting round the net. That is not an arbitrary arrangement: it
 * yields all ten distinct pairs exactly once across the five games, and every player sits out exactly
 * one game and partners each of the other four exactly once. Pairing the remaining four any other way
 * repeats some pairs and never forms others, which is the difference between a complete rotation and
 * a shrug. Asserted directly in the tests rather than trusted.
 *
 * Returns `[{ game_no, a: [seat, seat], b: [seat, seat], out: seat|null }]`.
 */
export function rotation(size) {
  if (size === 4) {
    return [
      { game_no: 1, a: [0, 1], b: [2, 3], out: null },
      { game_no: 2, a: [0, 2], b: [1, 3], out: null },
      { game_no: 3, a: [0, 3], b: [1, 2], out: null },
    ];
  }
  if (size === 5) {
    const games = [];
    for (let k = 0; k < 5; k++) {
      const at = (n) => (k + n) % 5;
      games.push({ game_no: k + 1, a: [at(1), at(4)], b: [at(2), at(3)], out: k });
    }
    return games;
  }
  throw new Error(`A net holds four players, or five when the numbers do not divide. Got ${size}.`);
}

/** How many games a round is, per net. Derived — never a stored column, because it is never a choice. */
export const gamesPerNet = (size) => rotation(size).length;

/**
 * Turn a player count into net sizes.
 *
 * Owner 2026-08-03, on a field that is not a multiple of four: "we would fill each person to join an
 * existing net and do a 5 team rotation rotating pairs. However, this should not happen where people
 * drop, we would go in with even numbers."
 *
 * So: as many nets of four as the count allows, then the leftovers JOIN existing nets rather than
 * forming a short one. 14 players is 4 / 5 / 5, not 4 / 4 / 4 / 2. Nobody sits out a whole round and
 * no net plays a rotation that has to be scaled to compare.
 *
 * THE FIVES GO ON THE BOTTOM NETS. Net 1 decides the night, and a three-game net is the cleaner
 * comparison for the players contesting it; a late arrival also joins at the bottom in real life. This
 * is a judgement, not the owner's instruction — he said only "join an existing net" — so it is written
 * down here rather than buried.
 *
 * MIXED SIZES ARE STABLE ACROSS ROUNDS. Worth stating because it looks like it should not be: every
 * net sends `moveUp` players up and `moveUp` down, and receives `moveUp` from each neighbour, so every
 * net's size is unchanged by movement — including the top and bottom, which send in one direction only
 * and receive from one side only. A net of five stays a net of five all night.
 *
 * Refuses rather than fudging when the count cannot be made of fours and fives: 6, 7 and 11 are the
 * only such counts above 4, because from three nets upward there are always enough nets to absorb a
 * remainder of at most three.
 */
export function netPlan(playerCount, opts = {}) {
  const n = Number(playerCount);
  if (!Number.isInteger(n) || n < 4) {
    return { ok: false, error: "King of the Court needs at least four players (one net)." };
  }
  const per = opts.playersPerNet ?? 4;
  if (per !== 4) {
    return { ok: false, error: "A net holds four players. Five is what happens to a leftover, not a setting." };
  }

  const nets = Math.floor(n / 4);
  const spare = n - nets * 4;
  if (spare > nets) {
    // n = 6, 7 or 11. Say the two numbers that would work rather than "invalid".
    const down = n - spare, up = n + (4 - spare);
    return {
      ok: false,
      error: `${n} players cannot be made into nets of four and five. ${down} would work, and so would ${up}.`,
      would_work: [down, up],
    };
  }

  // The last `spare` nets take one extra player each.
  const sizes = [];
  for (let i = 0; i < nets; i++) sizes.push(i >= nets - spare ? 5 : 4);
  return {
    ok: true,
    nets,
    sizes,
    players: n,
    games: sizes.reduce((t, s) => t + gamesPerNet(s), 0),
  };
}

/**
 * Deal players into nets for the FIRST round, best-ranked first.
 *
 * `ranked` is in seeding order — however the director got there. Net 1 takes the first players,
 * because starting a King of the Court with the strongest people on the top net is the whole reason
 * seeding exists; scattering them would spend the first round sorting out something already known.
 */
export function seedRound(ranked, opts = {}) {
  const plan = netPlan(ranked.length, opts);
  if (!plan.ok) return plan;
  const nets = [];
  let at = 0;
  plan.sizes.forEach((size, i) => {
    nets.push({ net_no: i + 1, seats: ranked.slice(at, at + size) });
    at += size;
  });
  return { ok: true, nets, sizes: plan.sizes, games: plan.games };
}

/**
 * Every game a round plays, from its net assignment.
 *
 * `nets` is `[{ net_no, seats: [contactId, ...] }]`. Returns rows shaped for `kotc_games`: the four
 * players are named ON the game rather than resolved through the seating, because a director moves
 * people between nets on the day and a played result must not change who played it.
 */
export function gamesForRound(nets) {
  const out = [];
  for (const net of nets) {
    for (const g of rotation(net.seats.length)) {
      out.push({
        net_no: net.net_no,
        game_no: g.game_no,
        a1_contact_id: net.seats[g.a[0]],
        a2_contact_id: net.seats[g.a[1]],
        b1_contact_id: net.seats[g.b[0]],
        b2_contact_id: net.seats[g.b[1]],
        sitting_out_contact_id: g.out === null ? null : net.seats[g.out],
      });
    }
  }
  return out;
}

/**
 * Per-player totals from played games. DERIVED, always — there is no stored counter to disagree with
 * this (migration 0040, and the F-26 lesson the passes module paid for).
 *
 * A player's points are what their PAIR scored while they were in it (spec §2, the owner's "scores
 * which tally"). Conceded is what the other pair scored, so a margin is available without a second
 * definition of it.
 *
 * An unscored game counts for nobody. Not zero — nobody. A game with one score typed in and the other
 * blank is half a result, and treating it as a 0 would enter a loss against a player who has not
 * finished playing yet. `games` therefore counts games PLAYED, which is what "has this player had
 * their night" means.
 */
export function tally(games) {
  const rows = new Map();
  const touch = (id) => {
    if (!rows.has(id)) {
      rows.set(id, { contact_id: id, points: 0, conceded: 0, point_diff: 0, wins: 0, losses: 0, games: 0 });
    }
    return rows.get(id);
  };

  for (const g of games) {
    // Everyone who appears anywhere gets a row, so a player whose games are all unscored still shows
    // on the board at zero rather than vanishing from it.
    for (const id of [g.a1_contact_id, g.a2_contact_id, g.b1_contact_id, g.b2_contact_id]) touch(id);

    const sa = g.score_a, sb = g.score_b;
    if (sa === null || sb === null || sa === undefined || sb === undefined) continue;

    for (const [ids, mine, theirs] of [
      [[g.a1_contact_id, g.a2_contact_id], sa, sb],
      [[g.b1_contact_id, g.b2_contact_id], sb, sa],
    ]) {
      for (const id of ids) {
        const r = touch(id);
        r.points += mine;
        r.conceded += theirs;
        r.point_diff = r.points - r.conceded;
        r.games += 1;
        // A tie is neither. Volleyball plays to a margin, so an equal score is unfinished or
        // mis-typed, and awarding it to both players would inflate the column the ranking reads.
        if (mine > theirs) r.wins += 1; else if (mine < theirs) r.losses += 1;
      }
    }
  }
  return [...rows.values()];
}

/**
 * Rank players best-first.
 *
 * TOTAL POINTS, THEN WINS, THEN POINT DIFFERENCE. Owner 2026-08-03, asked what breaks a tie on equal
 * totals: "Wins, then point difference." Total points is the headline the owner described from the
 * start ("scores, which tally and then ranked and seeded"), so it stays primary and the answer
 * supplies the two tie-breaks under it.
 *
 * Head-to-head is deliberately absent and cannot be added: partnerships change every game, so two
 * players have usually been on the same side as each other as often as against.
 *
 * `contact_id` is the last resort so the order is never random — two players identical on all four
 * measures must still come out in the same order on every read, or the board reshuffles while nobody
 * is doing anything.
 */
export function rankPlayers(rows) {
  return [...rows].sort((a, b) =>
    (b.points ?? 0) - (a.points ?? 0) ||
    (b.wins ?? 0) - (a.wins ?? 0) ||
    (b.point_diff ?? 0) - (a.point_diff ?? 0) ||
    a.contact_id - b.contact_id);
}

/**
 * Who has already partnered whom, counted. Keyed by the two contact ids low-high, so a pair is the
 * same entry whichever way round it is looked up.
 *
 * SOFT, AND SMALLER THAN IT LOOKS — see the note at the top of this file. Within a net every possible
 * pairing is played, so this cannot steer a pairing; it reports repeats for the board, and breaks a
 * tie when two level players are competing for one place. It never blocks a round.
 */
export function partnerHistory(games) {
  const seen = new Map();
  const key = (x, y) => (x < y ? `${x}:${y}` : `${y}:${x}`);
  for (const g of games) {
    for (const [x, y] of [[g.a1_contact_id, g.a2_contact_id], [g.b1_contact_id, g.b2_contact_id]]) {
      const k = key(x, y);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  return {
    /** How many times these two have partnered. */
    count: (x, y) => seen.get(key(x, y)) || 0,
    /** Every pair that has happened more than once, worst first — what the board shows. */
    repeats: () => [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([k, n]) => ({ pair: k.split(":").map(Number), times: n }))
      .sort((a, b) => b.times - a.times || a.pair[0] - b.pair[0]),
    size: seen.size,
  };
}

/**
 * The next round's net assignment.
 *
 * `previous` is `[{ net_no, seats: [contactId, ...] }]`, `standings` is the output of `tally` for THAT
 * ROUND'S games (not the night's — movement is about the round just played), and `moveUp` is how many
 * rise from each net.
 *
 * MOVEMENT. On every net the top `moveUp` go up one net and the bottom `moveUp` go down one. Net 1 has
 * nowhere higher, so its top players simply hold their place; the bottom net has nowhere lower, the
 * same way. Every net's size is preserved (see `netPlan`).
 *
 * `moveUp` IS THE DIRECTOR'S NUMBER. Owner chose "director sets it each session" over four candidate
 * formulas, so this function takes it and never computes it. It is clamped to at most half a net,
 * because promoting three of four players is not movement, it is a reshuffle — and a `moveUp` large
 * enough to send a whole net up would swap two nets wholesale and undo the ranking that earned it.
 *
 * SEATING WITHIN A NEW NET is by the round just played, best first. Deterministic, and it means seat 0
 * is the player who arrived on merit — which matters because `rotation` indexes seats, so an arbitrary
 * order would make the fixture list jump around between two previews of the same round.
 */
export function nextRound(previous, standings, opts = {}) {
  const nets = [...previous].sort((a, b) => a.net_no - b.net_no);
  if (!nets.length) return { ok: false, error: "There is no round to move on from." };

  const smallest = Math.min(...nets.map((n) => n.seats.length));
  const asked = Math.max(1, Math.floor(Number(opts.moveUp) || 1));
  const moveUp = Math.min(asked, Math.floor(smallest / 2));
  const clamped = moveUp !== asked;

  const score = new Map(standings.map((r) => [r.contact_id, r]));
  const blank = (id) => ({ contact_id: id, points: 0, wins: 0, point_diff: 0 });
  const order = (ids) => rankPlayers(ids.map((id) => score.get(id) || blank(id))).map((r) => r.contact_id);

  // Where each player is headed, before anybody is placed. Two passes, because a net's arrivals come
  // from both of its neighbours and computing them in one pass would read a net that had already been
  // rewritten — the same bug shape as advancing a bracket in place.
  const going = new Map();          // contact_id -> destination net_no
  const rankOf = new Map();         // contact_id -> its place on the net it just left, 0 = top
  for (const net of nets) {
    const ranked = order(net.seats);
    ranked.forEach((id, i) => rankOf.set(id, i));
    const last = nets[nets.length - 1].net_no;
    for (let i = 0; i < ranked.length; i++) {
      const id = ranked[i];
      const up = i < moveUp && net.net_no > 1;
      const down = i >= ranked.length - moveUp && net.net_no < last;
      going.set(id, up ? net.net_no - 1 : down ? net.net_no + 1 : net.net_no);
    }
  }

  const out = nets.map((net) => {
    const arriving = [...going.entries()].filter(([, to]) => to === net.net_no).map(([id]) => id);
    return { net_no: net.net_no, seats: order(arriving) };
  });

  // The sizes must come out exactly as they went in. Asserted rather than assumed: an off-by-one in
  // the movement above would silently drop a player out of the night, and the board would just show
  // one fewer person with nothing to indicate anything had gone wrong.
  const before = nets.map((n) => n.seats.length).join(",");
  const after = out.map((n) => n.seats.length).join(",");
  if (before !== after) {
    return { ok: false, error: `Movement changed the nets from ${before} to ${after}; refusing to write a round that loses a player.` };
  }

  const moved = [...going.entries()].filter(([id, to]) => {
    const from = nets.find((n) => n.seats.includes(id));
    return from && from.net_no !== to;
  }).length;

  return {
    ok: true,
    nets: out,
    move_up: moveUp,
    moved,
    // Said out loud when the director's number could not be honoured, rather than quietly using a
    // different one than the session says.
    clamped_from: clamped ? asked : null,
    note: clamped
      ? `Moving ${asked} would send more than half a net at once, so ${moveUp} moved each way instead.`
      : `${moved} player${moved === 1 ? "" : "s"} changed net.`,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════════
   SCORING: EVERYONE IS A CAPTAIN, AND THE MISSING NUMBERS ARE SOLVED FOR

   Owner 2026-08-03: "each individual is a captain, 1 person can input scores for everyone or each
   person can put in scores. If most of the data is entered, build the math logic to calculate the
   final missing person(s) based on constraints or given data for the algebra."

   WHY THERE IS ANYTHING TO SOLVE AT ALL. In every other format a team has one captain and one score
   link. Here the pairing lasts one game, so there is no team to own the result and nobody whose job it
   is to write it down. Whoever is nearest the pole types what they know — sometimes all three games,
   sometimes only their own points, sometimes only a total. What arrives is partial evidence about the
   same six numbers, from up to four people who each saw the round from a different side.

   THE CONSTRAINT THAT MAKES IT SOLVABLE is the shape of a volleyball score, not the arithmetic. A game
   played first-to-21 with no cap (the owner's choice, §6 Q3 of the spec) can only end two ways:
       21 to something 19 or less        — the normal case
       n to n-2, for n above 21          — they went past on a two-point margin
   So a game is not two free numbers between 0 and 40. It is ONE unknown — its total — plus which side
   won. That is what turns "four people gave me fragments" into a system with an answer.

   AND FOR A NET OF FOUR THERE IS A CLOSED FORM. Verified empirically over 4000 randomised shape-valid
   rounds before a line of it was written here, then asserted in the tests:

       d1 = (A + B − C − D) / 2        where d_i is game i's margin, side A minus side B,
       d2 = (A + C − B − D) / 2        and A, B, C, D are the four players' point totals
       d3 = (A + D − B − C) / 2
       T1 + T2 + T3 = (A + B + C + D) / 2

   Every margin falls out of the four totals alone. Then the shape rule finishes the job: a margin
   GREATER than two can only have come from a game that ended at exactly 21, so that game's total is
   `2 × pointsTo − |d|` and its scores are pinned. A margin of exactly two is the one ambiguous case
   (21–19 and 22–20 and 23–21 all have margin two), and it is resolved by subtraction whenever it is
   the only one, because the three totals must add up to half the sum of the player totals.

   SO: FOUR PLAYER TOTALS USUALLY DETERMINE ALL SIX SCORES. That is the answer to "calculate the final
   missing person" — the missing person's numbers were never independent.

   WHAT THIS DELIBERATELY WILL NOT DO IS GUESS. Where the evidence genuinely does not pin a game, the
   candidates are returned and the game is reported as unresolved. A plausible invented scoreline is
   the worst possible output: it looks like a result, it ranks people, and nobody ever finds out.
   ═════════════════════════════════════════════════════════════════════════════════════════════════ */

/** How far past `pointsTo` a game may run. 21 → 31–29 is already absurd for a King of the Court net. */
const OVERTIME_ROOM = 10;

/**
 * Every scoreline a single game could legally have finished with, narrowed by whatever is already known.
 *
 * `known` is `{ score_a, score_b }` with either, both, or neither filled in. A value that is present is
 * taken as fact — the people who were there outrank any inference.
 *
 * The shape rule (see the block comment above): winner ≥ pointsTo, margin ≥ winBy, and the winner either
 * finished exactly on pointsTo or won by exactly winBy. `winBy` is an option rather than a constant
 * because a session played straight to 21 with no two-point rule is a thing a director may do, and
 * hardcoding volleyball's would silently reject every one of those games as impossible.
 */
export function shapeCandidates(known = {}, opts = {}) {
  const pointsTo = Number(opts.pointsTo) || 21;
  const winBy = opts.winBy === undefined ? 2 : Math.max(1, Number(opts.winBy));
  const room = Number(opts.overtimeRoom) || OVERTIME_ROOM;
  const ka = known.score_a === null || known.score_a === undefined ? null : Number(known.score_a);
  const kb = known.score_b === null || known.score_b === undefined ? null : Number(known.score_b);

  const out = [];
  const add = (a, b) => {
    if (ka !== null && a !== ka) return;
    if (kb !== null && b !== kb) return;
    out.push({ score_a: a, score_b: b });
  };
  // Finished on the number: winner = pointsTo, loser anywhere from 0 to pointsTo - winBy.
  for (let loser = 0; loser <= pointsTo - winBy; loser++) {
    add(pointsTo, loser);
    add(loser, pointsTo);
  }
  // Went past it: winner above pointsTo, and then the margin is exactly winBy.
  for (let w = pointsTo + 1; w <= pointsTo + room; w++) {
    add(w, w - winBy);
    add(w - winBy, w);
  }
  return out;
}

/**
 * The three margins and the total, from four player totals. Net of four only — see the block comment.
 *
 * `totals` is `{ [contactId]: points }` and `seats` is the four contact ids in seat order, because the
 * formula is about WHICH pairings happened and seat order is what decides that.
 *
 * Returns `{ ok: false, error }` when the four totals cannot have come from a real round at all. That is
 * a genuinely useful answer: every margin here is `(sum ± sum) / 2`, so an odd numerator means somebody
 * mistyped, and saying so beats solving a system that has no solution.
 */
export function marginsFromTotals(seats, totals, opts = {}) {
  if (!Array.isArray(seats) || seats.length !== 4) {
    return { ok: false, error: "The closed form is for a net of four." };
  }
  const [A, B, C, D] = seats.map((id) => Number(totals[id]));
  if ([A, B, C, D].some((n) => !Number.isFinite(n))) {
    return { ok: false, error: "All four players' totals are needed to solve the round this way." };
  }
  const num = [A + B - C - D, A + C - B - D, A + D - B - C];
  if (num.some((n) => n % 2 !== 0)) {
    return { ok: false, error: "Those four totals cannot all be right; one of them is out by an odd number. Check the sheet." };
  }
  const sum = A + B + C + D;
  if (sum % 2 !== 0) {
    return { ok: false, error: "Those four totals add up to an odd number, which no round can produce." };
  }
  const pointsTo = Number(opts.pointsTo) || 21;
  const winBy = opts.winBy === undefined ? 2 : Math.max(1, Number(opts.winBy));
  const margins = num.map((n) => n / 2);

  // A margin below the winning margin means a game nobody won — a tie, or a scoreline that could not
  // have ended. Reported rather than solved around.
  const impossible = margins.filter((d) => Math.abs(d) < winBy);
  if (impossible.length) {
    return { ok: false, error: `Those totals imply a game won by ${Math.abs(impossible[0])} point${Math.abs(impossible[0]) === 1 ? "" : "s"}, which cannot happen. Check the sheet.` };
  }
  return {
    ok: true,
    margins,
    total: sum / 2,
    // A margin wider than the winning margin can only have come from a game that ended ON the number,
    // so its total is pinned. The rest are the ambiguous ones.
    pinned: margins.map((d) => (Math.abs(d) > winBy ? 2 * pointsTo - Math.abs(d) : null)),
  };
}

/**
 * Work out every game on a net from whatever evidence exists.
 *
 * `games`  — `[{ game_no, a1, a2, b1, b2, score_a, score_b }]`, scores possibly null. The four ids per
 *            game are what tie the games to the totals, so they are required.
 * `totals` — `{ [contactId]: points }`, for however many players reported one. Partial is fine.
 *
 * Returns `{ ok, games, unresolved, contradiction, solved, from }`.
 *
 * SEARCH, NOT ALGEBRA, IS THE GENERAL PATH. The closed form only covers a net of four with all four
 * totals; the evidence that actually arrives is a mixture — two games typed in fully, one player's total,
 * nothing else. So the general solver enumerates each game's legal scorelines and walks the combinations
 * depth-first, abandoning a branch the moment a player's running total passes what they reported. That
 * pruning is what keeps a net of five tractable: without it the space is tens of millions, and with it
 * a reported total collapses it almost immediately.
 *
 * A game is reported as SOLVED only when every surviving combination agrees on it. Two combinations that
 * differ on game 2 mean game 2 is genuinely unknown, and it is returned with its candidates rather than
 * with whichever answer happened to be found first.
 */
export function solveNet(games, totals = {}, opts = {}) {
  const pointsTo = Number(opts.pointsTo) || 21;
  const budget = Number(opts.budget) || 400_000;
  const reported = Object.keys(totals).filter((k) => Number.isFinite(Number(totals[k])));

  const cands = games.map((g) => shapeCandidates(g, { ...opts, pointsTo }));
  const dead = cands.findIndex((c) => c.length === 0);
  if (dead >= 0) {
    return {
      ok: false,
      contradiction: `Game ${games[dead].game_no} has a score that no volleyball game can end on. Check the sheet.`,
      games, unresolved: games.map((g) => g.game_no), solved: 0, from: "shape",
    };
  }

  /* CHEAPEST FIRST: a net of four with all four totals in hand has a closed-form answer, and the margins
     it yields must COLLAPSE the search rather than merely accompany it. The first version of this derived
     the margins and then searched the whole space anyway — ~70ms a round, for information it already had.
     That is the same defect as a guard that is computed and never asserted on. Filtering each game's
     candidates by its known margin usually leaves exactly one. */
  let fast = null;
  const seats = opts.seats;
  if (Array.isArray(seats) && seats.length === 4 && seats.every((id) => reported.includes(String(id)))) {
    const m = marginsFromTotals(seats, totals, { ...opts, pointsTo });
    if (!m.ok) {
      return { ok: false, contradiction: m.error, games, unresolved: games.map((g) => g.game_no), solved: 0, from: "algebra" };
    }
    fast = m;
    for (let i = 0; i < games.length && i < m.margins.length; i++) {
      const want = m.margins[i];
      const narrowed = cands[i].filter((c) => c.score_a - c.score_b === want);
      // Only adopt it if something survives. An empty result means the totals and a typed-in score
      // disagree, and the search below reports that contradiction far better than an empty list would.
      if (narrowed.length) cands[i] = narrowed;
    }
  }

  // Order the search so the most-constrained games go first — it prunes far sooner.
  const order = games.map((_, i) => i).sort((i, j) => cands[i].length - cands[j].length);
  const chosen = new Array(games.length).fill(null);
  const solutions = [];
  let visits = 0, exhausted = false, truncated = false;

  const runningOk = (final) => {
    // Sum what each player has scored so far and compare with what they said. Before the last game a
    // total may only be BELOW what was reported; at the end it must match exactly.
    const acc = new Map();
    for (let i = 0; i < games.length; i++) {
      const pick = chosen[i];
      if (!pick) continue;
      const g = games[i];
      for (const id of [g.a1, g.a2]) acc.set(String(id), (acc.get(String(id)) || 0) + pick.score_a);
      for (const id of [g.b1, g.b2]) acc.set(String(id), (acc.get(String(id)) || 0) + pick.score_b);
    }
    for (const id of reported) {
      const want = Number(totals[id]);
      const got = acc.get(id) || 0;
      if (got > want) return false;
      if (final && got !== want) return false;
    }
    return true;
  };

  const walk = (depth) => {
    if (visits++ > budget) { exhausted = true; return; }
    /* THE SOLUTION CAP MUST POISON THE AGREEMENT CHECK, and getting this wrong would have invented
       scores. A game is normally reported solved when every surviving solution agrees on it. But the
       search is depth-first, so the first 65 solutions all share the same choice for the games decided
       EARLY and differ only in the last one — which makes those early games look unanimous when the
       search simply never got round to contradicting them. Truncating without recording it therefore
       produces confident, wrong scorelines. Caught by the negative control that runs the solver on an
       empty net; found nothing else. */
    if (solutions.length > 64) { truncated = true; return; }
    if (depth === order.length) {
      if (runningOk(true)) solutions.push(chosen.slice());
      return;
    }
    const gi = order[depth];
    for (const pick of cands[gi]) {
      chosen[gi] = pick;
      if (runningOk(false)) walk(depth + 1);
      chosen[gi] = null;
      if (exhausted) return;
    }
  };
  walk(0);

  if (exhausted && !solutions.length) {
    return {
      ok: false,
      contradiction: null,
      note: "Not enough was entered to work the rest out. Type in one more game, or one player's total.",
      games, unresolved: games.map((g) => g.game_no), solved: 0, from: "search",
    };
  }
  if (!solutions.length) {
    return {
      ok: false,
      contradiction: "What has been entered cannot all be right; no set of real scores fits it. Check the sheet.",
      games, unresolved: games.map((g) => g.game_no), solved: 0, from: "search",
    };
  }

  // A game is only settled when every surviving solution agrees on it.
  const out = games.map((g, i) => {
    const first = solutions[0][i];
    // When the search was truncated, only a game whose candidates were narrowed to ONE by the input
    // itself — a typed-in score, the shape rule, or a known margin — may be called resolved. Agreement
    // across a truncated solution set is not evidence of anything.
    const agreed = (truncated && cands[i].length !== 1)
      ? false
      : solutions.every((s) => s[i].score_a === first.score_a && s[i].score_b === first.score_b);
    return {
      game_no: g.game_no,
      score_a: agreed ? first.score_a : (g.score_a ?? null),
      score_b: agreed ? first.score_b : (g.score_b ?? null),
      // `derived` is the difference between "this is what you told me" and "this is what follows from
      // what you told me", and a screen must be able to show which is which.
      derived: agreed && (g.score_a === null || g.score_a === undefined || g.score_b === null || g.score_b === undefined),
      resolved: agreed,
      candidates: agreed ? null : [...new Set(solutions.map((s) => `${s[i].score_a}-${s[i].score_b}`))].sort(),
    };
  });

  const unresolved = out.filter((g) => !g.resolved).map((g) => g.game_no);
  return {
    ok: unresolved.length === 0,
    games: out,
    unresolved,
    solved: out.filter((g) => g.derived).length,
    contradiction: null,
    from: fast ? "algebra+search" : "search",
    truncated,
    note: unresolved.length
      ? `${unresolved.length} game${unresolved.length === 1 ? "" : "s"} still could have finished more than one way. Type in one more score and the rest follow.`
      : out.some((g) => g.derived)
        ? `Worked out ${out.filter((g) => g.derived).length} missing score${out.filter((g) => g.derived).length === 1 ? "" : "s"} from what was entered.`
        : "Everything was already entered; nothing to work out.",
  };
}

/**
 * Merge what several people reported about the same net, and say where they disagree.
 *
 * Owner: "1 person can input scores for everyone or each person can put in scores." So the same game can
 * arrive twice, and the two versions can differ. Reconciling by "last write wins" would silently pick a
 * side in a dispute the software never told anybody about — and on a net of four, all four players saw
 * every game, so a disagreement is common and worth surfacing rather than resolving.
 *
 * `reports` is `[{ by, games: [{ game_no, score_a, score_b }], totals: {} }]`.
 * Returns the agreed values plus a `disputes` list. A disputed game is left UNSET, deliberately: an
 * unset game is visibly unfinished, whereas a wrong one that has picked a side looks finished.
 */
export function reconcile(reports) {
  const byGame = new Map();
  const totals = {};
  for (const r of reports || []) {
    for (const g of r.games || []) {
      if (g.score_a === null || g.score_a === undefined || g.score_b === null || g.score_b === undefined) continue;
      const k = g.game_no;
      if (!byGame.has(k)) byGame.set(k, []);
      byGame.get(k).push({ by: r.by, score_a: Number(g.score_a), score_b: Number(g.score_b) });
    }
    for (const [id, v] of Object.entries(r.totals || {})) {
      if (Number.isFinite(Number(v))) totals[id] = Number(v);
    }
  }

  const agreed = [], disputes = [];
  for (const [game_no, list] of [...byGame.entries()].sort((a, b) => a[0] - b[0])) {
    const distinct = [...new Set(list.map((x) => `${x.score_a}-${x.score_b}`))];
    if (distinct.length === 1) {
      agreed.push({ game_no, score_a: list[0].score_a, score_b: list[0].score_b, reported_by: list.map((x) => x.by) });
    } else {
      disputes.push({
        game_no,
        versions: list.map((x) => ({ by: x.by, score: `${x.score_a}-${x.score_b}` })),
      });
    }
  }
  return {
    agreed, disputes, totals,
    note: disputes.length
      ? `Game ${disputes.map((d) => d.game_no).join(", ")} came back differently from different people; somebody needs to say which is right.`
      : null,
  };
}
