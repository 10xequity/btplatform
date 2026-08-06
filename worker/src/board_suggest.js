/* Boomtown Platform — seeding suggestions for the pool board (read-only)
   File: worker/src/board_suggest.js · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.95.0

   Implements docs/2026-08-05_spec_seeding-suggestions_v1_0.md. Read that spec's §1 before changing
   anything here: three of the four facts a reasonable engineer would assume about this data are
   false in this repo.

   THE OWNER'S CONSTRAINT, VERBATIM (2026-08-05):
     "We then analyze the teams as best we can and then split the good players (previous winners) as
      much as possible (using historical data) and have friends avoid playing too much with each
      other in pool or people from the same area (N Co or Colorado Springs) together. These are just
      suggestions not rules, as it may be impossible to complete based on entered teams."

   FIVE THINGS THIS MODULE IS BUILT AROUND:

   1. IT WRITES NOTHING. No INSERT, no UPDATE, no DELETE, no audit row. A suggestion that could move
      a team would be a formula the software enforces, and the owner asked for the opposite. The
      guard asserts this by snapshotting `teams` and `standings` across the request.

   2. IT NEVER READS `standings.rank`. `refreshStandings` (tournaments.js) ranks every team in an
      event across all divisions together off pool play alone, and `standings` has no `division_id`.
      Live D1 *looks* per-division because `sandbox.js` hand-writes three standings blocks — the
      fixture's shape is not the platform's behaviour. Placement is recomputed here, per division.

   3. ABSENCE PRODUCES SILENCE. A first-ever event, an unsatisfiable suggestion, a signal whose
      query failed — all yield nothing at all. Never a sentence explaining its own absence. A panel
      that says "not enough history" on every new event is noise on every new event.

   4. THE 6-11 PREFERENCE SUPPRESSES A SUGGESTION, NEVER A SAVE. If the move a suggestion implies
      would take its source pool under 6 or its target over 11, the suggestion is simply not made.
      Nothing here can make a board refuse to save.

   5. NO PERSON IS EVER NAMED. History resolves through people, but every sentence talks about teams,
      pools and counts. The signals know who plays with whom; the screen does not say so.

   WHAT "WON BEFORE" MEANS (owner, 2026-08-05, answering spec §7 Q2):
     "We should rank every team... from pool they should count all teams 1-X for each division. Then
      simply list their placement for divisions. We can award a score/number as there is minor
      overlap between bottom of A and top of BB, similar to ELO score... rank includes Open/AA - A -
      BB - B - Recreational."
   So: placement WITHIN a division, plus a tier base 100 apart with placing scored 0-100 inside it.
   Bottom-of-A and top-of-BB therefore land on the same number BY CONSTRUCTION, which is the overlap
   the owner described. A true persisted ELO rating is deliberately NOT built — the owner called that
   "potentially", it needs a ratings table, and this release carries no migration.

   SUBS ARE EXCLUDED (owner, 2026-08-05, answering spec §7 Q1): "Subs for tournaments, non issue we
   wont update as we dont have subs for that usually." The league-side sub record the owner does want
   — count a sub's wins and divisions played, never their losses, and flag a team that takes subs
   regularly — is a separate unit and is not seeding. */

/* The owner's division ladder, top to bottom: Open/AA · A · BB · B · Recreational. Mixed labels are
   in here because the real registration form uses them ("A/AA", "BB/A" on the REVCO sheets), and a
   label this module does not recognise earns NO tier — the team's history then counts as placing
   only, and it is left out of the strength comparison rather than guessed at. There is deliberately
   no alias map beyond this: inventing one would encode a taxonomy the owner has not given. */
const TIERS = [
  [/^(open|aa|open\/aa|aa\/open|oa)$/, 400],
  [/^(a\/aa|aa\/a)$/, 350],
  [/^a$/, 300],
  [/^(bb\/a|a\/bb)$/, 250],
  [/^bb$/, 200],
  [/^(b\/bb|bb\/b)$/, 150],
  [/^b$/, 100],
  [/^(rec|recreational|novice|c)$/, 0],
];

export const tierOf = (name) => {
  const k = String(name || "").trim().toLowerCase();
  if (!k) return null;
  for (const [re, base] of TIERS) if (re.test(k)) return base;
  return null;
};

/* A person's identity across events. A team name is not a join key — `teams` is a fresh row per
   event with no uniqueness on `name` — so history joins on people. One key so that somebody who is
   a `contact_id` on one roster and a bare `member_email` on another is still one person.
   `contacts.email` is COLLATE NOCASE and idx_contacts_org_email covers (org_id, email), so neither
   side of that join is wrapped in lower()/trim(): a whitespace-padded address falls through to the
   'e' key by design rather than defeating the index for everyone else. */
const PKEY = `COALESCE('c' || tm.contact_id, 'c' || cx.id, 'e' || lower(trim(tm.member_email)))`;
const PKEY_JOIN = `LEFT JOIN contacts cx ON cx.org_id = tm.org_id AND cx.email = tm.member_email
                                        AND cx.deleted_at IS NULL`;

/* `status` alone does not identify a past event: live D1 holds three `in_progress` events dated in
   the FUTURE. `starts_at < datetime('now')` is load-bearing — without it this feature reads the
   event currently being seeded as its own history. */
const PAST_EVENT = `e.org_id = ?1 AND e.deleted_at IS NULL
  AND e.status IN ('in_progress','completed')
  AND e.starts_at IS NOT NULL
  AND e.starts_at < datetime('now')
  AND e.starts_at >= date('now','-18 months')`;

/* At the cap the set was truncated, and a partial history is worse than none: it would credit the
   teams that happened to sort first. Both history signals drop whole. */
const ROW_CAP = 5001;

const MIN_POOL = 6;
const MAX_POOL = 11;

/** The move a suggestion implies must leave both pools inside the owner's preferred range. */
const moveKeeps = (fromCount, toCount) => fromCount - 1 >= MIN_POOL && toCount + 1 <= MAX_POOL;

const rows = async (env, sql, ...binds) =>
  ((await env.DB.prepare(sql).bind(...binds).all()).results) || [];

/** Sentence-case a stored city for display. Grouping uses the lowercased string; this is only ink. */
const cityLabel = (s) =>
  String(s || "").split(/\s+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/**
 * Suggestions for a pool board. Never throws: every signal is independently guarded, and a signal
 * that cannot answer contributes nothing rather than taking the board down with it.
 *
 * @param {object} env      worker env — used for `env.DB` reads only
 * @param {number} orgId    from ctx; no caller may pass an org id in
 * @param {number} eventId  the event whose board is being drawn
 * @param {Array}  shaped   this event's teams, as loadBoard shaped them
 * @param {Array}  divisions raw division rows (id, name, rank, …)
 * @param {Array}  pools    raw pool rows (id, name, division_id, …)
 * @returns {Promise<Array<{id:string,kind:string,text:string,team_ids:number[]}>>}
 */
export async function boardSuggestions(env, orgId, eventId, shaped, divisions, pools) {
  const out = [];
  if (!shaped || shaped.length === 0) return out;

  // Pool membership as this board currently stands. A pool with nobody in it cannot be a target
  // worth naming, but it is still a legal destination, so empty pools are kept.
  const byPool = new Map(pools.map((p) => [p.id, []]));
  for (const t of shaped) if (t.pool_id != null && byPool.has(t.pool_id)) byPool.get(t.pool_id).push(t);
  const poolOf = new Map(pools.map((p) => [p.id, p]));

  // Divisions holding at least two pools — with one pool there is nothing to spread across.
  const spreadable = divisions
    .map((d) => ({ d, ps: pools.filter((p) => p.division_id === d.id) }))
    .filter((x) => x.ps.length >= 2);

  const history = await loadHistory(env, orgId, eventId).catch(() => null);

  if (history && spreadable.length) {
    try { out.push(...spreadWinners(spreadable, byPool, history)); } catch { /* silence */ }
    try { out.push(...spreadStrength(spreadable, byPool, history)); } catch { /* silence */ }
  }
  if (history) {
    try { out.push(...splitRepeat(byPool, poolOf, history)); } catch { /* silence */ }
  }
  if (spreadable.length) {
    try { out.push(...await spreadArea(env, orgId, eventId, spreadable, byPool)); } catch { /* silence */ }
  }

  // Biggest imbalance first — a director reading top-down should meet the worst problem first.
  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, 6).map(({ id, kind, text, team_ids }) => ({ id, kind, text, team_ids }));
}

/* ------------------------------------------------------------------ history ------------------- */

/**
 * Everything the history signals need, in three reads. Returns null when there is no usable history
 * — which is the normal state of a first event, and produces silence rather than a sentence.
 */
async function loadHistory(env, orgId, eventId) {
  // (1) Every standings row at every PAST event, so placement can be recomputed per division.
  //     Driven from `events` so the standings primary-key autoindex is used. INNER JOIN to
  //     standings: a team with no row is ABSENT, not a team that went 0-0.
  const past = await rows(env, `
    SELECT t.event_id AS ev, t.id AS team, t.division_id AS div, d.name AS div_name,
           COALESCE(s.wins,0) AS wins, COALESCE(s.point_diff,0) AS diff, COALESCE(s.points_for,0) AS pf
      FROM events e
      JOIN teams t ON t.event_id = e.id AND t.org_id = ?1 AND t.deleted_at IS NULL
      JOIN standings s ON s.event_id = t.event_id AND s.team_id = t.id AND s.deleted_at IS NULL
      LEFT JOIN divisions d ON d.id = t.division_id AND d.deleted_at IS NULL
     WHERE ${PAST_EVENT} AND e.id <> ?2
     LIMIT ${ROW_CAP}`, orgId, eventId);
  if (!past.length || past.length >= ROW_CAP) return null;

  // (2) A scored bracket final. bracket_round = 1 IS the final (brackets.js). `score_a <> score_b`
  //     is not decoration: without it a tie would silently credit team_b through the ELSE branch.
  //     Expect zero rows on live today — exactly one final exists and it is unscored. That is
  //     correct, not a bug.
  const finals = await rows(env, `
    SELECT m.event_id AS ev,
           CASE WHEN m.score_a > m.score_b THEN m.team_a_id ELSE m.team_b_id END AS winner
      FROM matches m
      JOIN events e ON e.id = m.event_id
     WHERE m.org_id = ?1 AND m.deleted_at IS NULL AND m.bracket_round = 1
       AND m.score_a IS NOT NULL AND m.score_b IS NOT NULL AND m.score_a <> m.score_b
       AND ${PAST_EVENT} AND e.id <> ?2`, orgId, eventId);
  const champions = new Set(finals.filter((f) => f.winner != null).map((f) => `${f.ev}:${f.winner}`));

  // (3) This event's people, and the past teams the same people were on. UNION rather than UNION
  //     ALL so a captain who also holds a roster row dedupes. DISTINCT because `team_members` has no
  //     unique constraint and one person can hold two rows on one roster.
  const links = await rows(env, `
    WITH me AS (
      SELECT tm.team_id AS cur, ${PKEY} AS pkey
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL
        ${PKEY_JOIN}
       WHERE tm.org_id = ?1 AND t.event_id = ?2 AND tm.deleted_at IS NULL AND tm.is_sub = 0
      UNION
      SELECT t.id, 'c' || t.captain_contact_id
        FROM teams t
       WHERE t.org_id = ?1 AND t.event_id = ?2 AND t.deleted_at IS NULL
         AND t.captain_contact_id IS NOT NULL
    ),
    them AS (
      SELECT tm.team_id AS old, ${PKEY} AS pkey
        FROM team_members tm
        ${PKEY_JOIN}
       WHERE tm.org_id = ?1 AND tm.deleted_at IS NULL AND tm.is_sub = 0
      UNION
      SELECT t.id, 'c' || t.captain_contact_id
        FROM teams t
       WHERE t.org_id = ?1 AND t.deleted_at IS NULL AND t.captain_contact_id IS NOT NULL
    )
    SELECT DISTINCT me.cur AS cur, me.pkey AS pkey, them.old AS old, t.event_id AS ev
      FROM me
      JOIN them ON them.pkey = me.pkey
      JOIN teams t ON t.id = them.old AND t.org_id = ?1 AND t.deleted_at IS NULL
      JOIN events e ON e.id = t.event_id
     WHERE t.event_id <> ?2 AND ${PAST_EVENT}
     LIMIT ${ROW_CAP}`, orgId, eventId);
  if (!links.length || links.length >= ROW_CAP) return null;

  // Placement WITHIN a division, recomputed here. Groups under three teams are skipped: "first of
  // two" is not a finish worth spreading. A tie for first credits NOBODY — crediting one of two on
  // an arbitrary tiebreak is how a suggestion becomes a lie about a team.
  const groups = new Map();
  for (const r of past) {
    const key = `${r.ev}:${r.div == null ? "nodiv" : r.div}`;
    if (!groups.has(key)) groups.set(key, { div_name: r.div_name, teams: [] });
    groups.get(key).teams.push(r);
  }
  const result = new Map();   // "ev:team" → { place, n, won, strength|null }
  for (const g of groups.values()) {
    const n = g.teams.length;
    if (n < 3) continue;
    const ordered = [...g.teams].sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.pf - a.pf);
    const tie = ordered.length > 1 && ordered[0].wins === ordered[1].wins
      && ordered[0].diff === ordered[1].diff && ordered[0].pf === ordered[1].pf;
    const base = tierOf(g.div_name);
    ordered.forEach((r, i) => {
      const key = `${r.ev}:${r.team}`;
      const champ = champions.has(key);
      const placing = Math.round((100 * (n - 1 - i)) / (n - 1));
      result.set(key, {
        won: champ || (i === 0 && !tie),
        // Tier bases sit 100 apart and placing scores 0-100 inside one, so the bottom of A and the
        // top of BB come out equal — the "minor overlap" the owner described. A division whose
        // label this module does not recognise gets no strength at all rather than a guess.
        strength: base == null ? null : base + placing,
      });
    });
  }
  // A champion whose division group was too small to place still counts as having won before.
  for (const key of champions) if (!result.has(key)) result.set(key, { won: true, strength: null });

  // Roll history up to the CURRENT teams, through people.
  const perTeam = new Map();          // current team id → { won, strength|null }
  const rostersOf = new Map();        // current team id → Map(past team id → Set(pkey))
  for (const l of links) {
    const r = result.get(`${l.ev}:${l.old}`);
    if (r) {
      const acc = perTeam.get(l.cur) || { won: false, strength: null };
      acc.won = acc.won || r.won;
      // The best a team's people have ever done. Max, not mean: the owner asked to split the good
      // players, and one proven player is what makes a team strong.
      if (r.strength != null) acc.strength = acc.strength == null ? r.strength : Math.max(acc.strength, r.strength);
      perTeam.set(l.cur, acc);
    }
    if (!rostersOf.has(l.cur)) rostersOf.set(l.cur, new Map());
    const m = rostersOf.get(l.cur);
    if (!m.has(l.old)) m.set(l.old, new Set());
    m.get(l.old).add(l.pkey);
  }
  return { perTeam, rostersOf };
}

/* ------------------------------------------------------------------ signals ------------------- */

/** Teams whose people have won a division before, bunched into one pool. */
function spreadWinners(spreadable, byPool, history) {
  const out = [];
  for (const { d, ps } of spreadable) {
    const counts = ps.map((p) => ({
      p,
      teams: (byPool.get(p.id) || []).filter((t) => history.perTeam.get(t.id)?.won),
      total: (byPool.get(p.id) || []).length,
    }));
    const total = counts.reduce((a, c) => a + c.teams.length, 0);
    if (total < 2) continue;
    const most = counts.reduce((a, b) => (b.teams.length > a.teams.length ? b : a));
    const least = counts.reduce((a, b) => (b.teams.length < a.teams.length ? b : a));
    const gap = most.teams.length - least.teams.length;
    if (gap < 2) continue;
    if (!moveKeeps(most.total, least.total)) continue;      // the 6-11 suppressor
    const mover = most.teams[most.teams.length - 1];
    out.push({
      id: `w:p${most.p.id}`,
      kind: "spread_winners",
      weight: 1000 + gap,
      text: `${d.name} — ${most.p.name} has ${most.teams.length === total ? `all ${total}` : `${most.teams.length} of the ${total}`} `
        + `team${total === 1 ? "" : "s"} who have won a division before, and ${least.p.name} has none. `
        + `Moving ${mover.name} to ${least.p.name} would spread them out.`,
      team_ids: [...most.teams.map((t) => t.id)],
    });
  }
  return out;
}

/**
 * The owner's placement score, applied to whole pools. Division tiers sit 100 apart, so a gap of one
 * tier between two pools in the same division means one pool's teams finished roughly a division
 * higher last time. Stated in divisions, not in the raw number — the number is an internal unit and
 * a director should not have to learn it to read the sentence.
 */
function spreadStrength(spreadable, byPool, history) {
  const out = [];
  for (const { d, ps } of spreadable) {
    const rated = ps.map((p) => {
      const all = byPool.get(p.id) || [];
      const known = all.map((t) => history.perTeam.get(t.id)?.strength).filter((s) => s != null);
      return { p, total: all.length, all, n: known.length, mean: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null };
    }).filter((r) => r.n > 0);
    if (rated.length < 2) continue;
    // At least three teams in the division must carry a rated finish, or this is one team's result
    // deciding the shape of a whole division.
    if (rated.reduce((a, r) => a + r.n, 0) < 3) continue;
    const hi = rated.reduce((a, b) => (b.mean > a.mean ? b : a));
    const lo = rated.reduce((a, b) => (b.mean < a.mean ? b : a));
    const gap = hi.mean - lo.mean;
    if (gap < 100) continue;                                 // under one division's worth: not news
    if (!moveKeeps(hi.total, lo.total)) continue;            // the 6-11 suppressor
    const best = hi.all
      .filter((t) => history.perTeam.get(t.id)?.strength != null)
      .sort((a, b) => history.perTeam.get(b.id).strength - history.perTeam.get(a.id).strength)[0];
    const worth = gap >= 200 ? "about two divisions' worth" : "about a division's worth";
    out.push({
      id: `s:p${hi.p.id}`,
      kind: "spread_strength",
      weight: 900 + Math.round(gap / 10),
      text: `${d.name} — ${hi.p.name}'s teams finished higher at past events than ${lo.p.name}'s, by ${worth}. `
        + `Moving ${best.name} to ${lo.p.name} would even the two out.`,
      team_ids: hi.all.filter((t) => history.perTeam.get(t.id)?.strength != null).map((t) => t.id),
    });
  }
  return out;
}

/**
 * Two teams in one pool whose people keep turning up on the same rosters. The owner's "friends avoid
 * playing too much with each other in pool". Counted as DISTINCT past rosters, so a six-person
 * overlap on one old team counts once rather than fifteen times.
 */
function splitRepeat(byPool, poolOf, history) {
  const out = [];
  for (const [poolId, teams] of byPool) {
    if (teams.length < 2) continue;
    const pool = poolOf.get(poolId);
    // The suppressor applies here too: splitting the pair means moving one of them into another pool
    // in the same division, so at least one such pool must be able to take a team without the pair's
    // own pool dropping under six.
    const canReceive = [...byPool.entries()].some(([id, ts]) =>
      id !== poolId && poolOf.get(id)?.division_id === pool?.division_id && moveKeeps(teams.length, ts.length));
    if (!canReceive) continue;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const a = teams[i], b = teams[j];
        const ra = history.rostersOf.get(a.id), rb = history.rostersOf.get(b.id);
        if (!ra || !rb) continue;
        let shared = 0;
        for (const [old, pa] of ra) {
          const pb = rb.get(old);
          if (!pb) continue;
          // Two different people, not one person counted on both sides of the pair.
          if (new Set([...pa, ...pb]).size >= 2) shared++;
        }
        if (shared < 2) continue;
        out.push({
          id: `f:${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`,   // unordered: no mirrored twin
          kind: "split_repeat",
          weight: 500 + shared,
          text: `${pool.name} — ${a.name} and ${b.name} have players who have been on the same team `
            + `${shared === 2 ? "twice" : `${shared} times`} before. Splitting them across two pools `
            + `would give everyone new opponents.`,
          team_ids: [a.id, b.id],
        });
      }
    }
  }
  return out;
}

/**
 * Teams from one city bunched into one pool. Captain city only, grouped on the literal stored string
 * — there is no region taxonomy here. "Fort Collins" and "Ft Collins" stay two groups and this
 * signal understates rather than guessing; the owner's "N Co" shorthand needs a mapping from them
 * before any code can honour it. Silent most of the time, by design.
 */
async function spreadArea(env, orgId, eventId, spreadable, byPool) {
  const cities = await rows(env, `
    SELECT t.id AS team, lower(trim(cap.city)) AS city
      FROM teams t
      JOIN contacts cap ON cap.id = t.captain_contact_id AND cap.deleted_at IS NULL
     WHERE t.org_id = ?1 AND t.event_id = ?2 AND t.deleted_at IS NULL
       AND cap.city IS NOT NULL AND trim(cap.city) <> ''`, orgId, eventId);
  if (!cities.length) return [];
  const cityOf = new Map(cities.map((c) => [c.team, c.city]));

  const out = [];
  for (const { d, ps } of spreadable) {
    const inDiv = ps.flatMap((p) => byPool.get(p.id) || []);
    if (!inDiv.length) continue;
    const covered = inDiv.filter((t) => cityOf.has(t.id)).length;
    // Below 60% coverage the largest group is an artifact of who filled the field in, not a fact
    // about where the field is from.
    if (covered / inDiv.length < 0.6) continue;
    const tally = new Map();
    for (const t of inDiv) { const c = cityOf.get(t.id); if (c) tally.set(c, (tally.get(c) || 0) + 1); }
    // The name breaks a tie, not insertion order: two cities on equal counts would otherwise make the
    // panel name a different one between two identical loads, which reads as the board changing its
    // mind.
    const [city, n] = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (n < 3) continue;
    const per = ps.map((p) => ({
      p,
      teams: (byPool.get(p.id) || []).filter((t) => cityOf.get(t.id) === city),
      total: (byPool.get(p.id) || []).length,
    }));
    const most = per.reduce((a, b) => (b.teams.length > a.teams.length ? b : a));
    const empty = per.find((x) => x.p.id !== most.p.id && x.teams.length === 0);
    if (!empty) continue;
    if (most.teams.length / n < 2 / 3) continue;
    if (!moveKeeps(most.total, empty.total)) continue;        // the 6-11 suppressor
    const mover = most.teams[most.teams.length - 1];
    out.push({
      id: `a:p${most.p.id}:${city.replace(/[^a-z0-9]+/g, "-")}`,
      kind: "spread_area",
      weight: 700 + most.teams.length,
      text: `${d.name} — ${most.teams.length} of the ${n} teams from ${cityLabel(city)} are in `
        + `${most.p.name}, and ${empty.p.name} has none. Moving ${mover.name} to ${empty.p.name} `
        + `would mix up who plays whom.`,
      team_ids: most.teams.map((t) => t.id),
    });
  }
  return out;
}
