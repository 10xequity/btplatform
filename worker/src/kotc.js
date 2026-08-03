/**
 * Boomtown Platform — King / Queen of the Court, the engine
 * File: worker/src/kotc.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.76.0
 *
 * Owner 2026-08-03, verbatim (full text in `docs/2026-08-03_spec_kotc_v1_0.md` §1):
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
    return { ok: false, error: "King of the Court needs at least four players — one net." };
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
    return { ok: false, error: `Movement changed the nets from ${before} to ${after} — refusing to write a round that loses a player.` };
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
