/**
 * Boomtown Platform — Sandbox / Demo tools (Module 11.5)
 * File: worker/src/sandbox.js · Version: v2.0 · Date: 2026-08-03 · Ships in: v0.67.0
 *
 * Staff-gated endpoints powering the admin rail's "Sandbox" group:
 *   GET  /api/admin/testdata           → counts of test rows per table (are we seeded?)
 *   POST /api/admin/testdata/generate  → inserts the standard TEST set (IDs 90000–90999,
 *                                        names prefixed "TEST", emails @example.com, org 1)
 *                                        — refuses if test data already exists (wipe first)
 *   POST /api/admin/testdata/wipe      → deletes ONLY the 90000–90999 range, plus rows that
 *                                        reference test events (attendance, checkins, pools,
 *                                        brackets). Real data is untouchable by construction.
 *
 * v2.0 — THE SEED SET IS NOW PARKED AT THE WORKFLOW, NOT AT THE TABLE.
 * Owner 2026-08-03: "create test tournaments to test drag feature and populate that and
 * registration with tournament registration (x3) and then allow me to build the tournament and
 * then the pools."
 *
 * The v1 set could not do that. Its one upcoming tournament had four registrations and ZERO teams,
 * so there was nothing to build a pool from — which is precisely why the drag editor could not be
 * tried. Rows existed; the workflow did not. Three tournaments now sit at three different points of
 * a real event day, so each new feature has somewhere to be exercised:
 *
 *   90002  Summer Open   12 teams, 5 courts, NO schedule    → generate pools, then DRAG them.
 *                                                             12-on-5 is the owner's own config.
 *   90004  Fall Classic   8 teams, pool play fully scored   → generate a BRACKET; it seeds itself
 *                         with standings                      from the pool finish.
 *   90005  Winter Jam     8 teams, pools scored, bracket    → type one quarter-final score and the
 *                         drawn, quarter-finals unscored      winner ADVANCES on its own.
 *
 * Plus 90001, a completed tournament kept as history, and 90003, a league.
 *
 * Winter Jam's bracket is drawn by calling the real generator (`generateBracketFor`), never by
 * hand-written SQL. A fixture built by a second implementation can pass while the real one is
 * broken, which is the only sort of test data that actively lies to you.
 */
import { generateBracketFor } from "./brackets.js"; // v0.67.0 — one definition of "draw a bracket"

let json, audit, isStaff, requireStaff;
export function wireSandbox(h) { ({ json, audit, isStaff, requireStaff } = h); }

export async function sandboxRoutes(request, env, url, ctx) {
  const p = url.pathname, m = request.method;
  if (p === "/api/admin/testdata" && m === "GET") return status(env, ctx);
  if (p === "/api/admin/testdata/generate" && m === "POST") return generate(env, ctx);
  if (p === "/api/admin/testdata/wipe" && m === "POST") return wipe(env, ctx);
  return null;
}

const LO = 90000, HI = 90999;

async function status(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const row = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM events        WHERE id BETWEEN ?1 AND ?2) AS events,
      (SELECT COUNT(*) FROM contacts      WHERE id BETWEEN ?1 AND ?2) AS contacts,
      (SELECT COUNT(*) FROM teams         WHERE id BETWEEN ?1 AND ?2) AS teams,
      (SELECT COUNT(*) FROM matches       WHERE id BETWEEN ?1 AND ?2 OR event_id BETWEEN ?1 AND ?2) AS matches,
      (SELECT COUNT(*) FROM registrations WHERE id BETWEEN ?1 AND ?2) AS registrations,
      (SELECT COUNT(*) FROM attendance    WHERE event_id BETWEEN ?1 AND ?2) AS attendance`
  ).bind(LO, HI).first();
  const seeded = Object.values(row).some(n => n > 0);
  return json({ ok: true, seeded, counts: row });
}

/* ---------------- fixture builders ---------------- */

const TEAM_NAMES = [
  "Set to Kill", "Block Party", "Net Gains", "Ace Ventura",
  "Bump in the Night", "Sets on the Beach", "Digging Deep", "Spike Lee's",
  "Served Cold", "Kill Switch", "Free Ball", "Pancake House",
  "Six Pack", "Roof Party", "Short Set", "Deep Dish",
  "Line Shot", "Tool Time", "Joust Kidding", "Sandbaggers",
  "Hard Cut", "Off Speed", "Overpass", "Chasing Pancakes",
];
const FIRSTS = [
  "Ava", "Ben", "Cami", "Drew", "Elle", "Finn", "Gia", "Hank",
  "Iris", "Jonah", "Kira", "Luis", "Mona", "Nate", "Opal", "Pax",
  "Quinn", "Rosa", "Sam", "Tess", "Uma", "Vic", "Wren", "Zane",
  "Aria", "Bo", "Cleo", "Dane", "Esme", "Ford", "Gwen", "Hugo",
  "Ines", "Jax", "Kit", "Lena", "Milo", "Nyla", "Orin", "Piper",
  "Remy", "Sage", "Theo", "Vera", "Wes", "Xena", "Yuri", "Zoya",
];
const LASTS = [
  "Stone", "Ortiz", "Reyes", "Park", "Nguyen", "Walker", "Romano", "Ellis",
  "Bailey", "Cruz", "Doyle", "Fisher", "Gray", "Hayes", "Imani", "Jensen",
  "Keller", "Lowe", "Mercer", "Novak", "Okafor", "Patel", "Quill", "Reed",
  "Sato", "Torres", "Uddin", "Vance", "Ward", "Xu", "Yates", "Zimmer",
  "Abbott", "Blake", "Chen", "Diaz", "Ewing", "Flores", "Gibbs", "Hoang",
  "Iqbal", "Jordan", "Kaur", "Larsen", "Moss", "Nolan", "Oyelaran", "Price",
];
const CITIES = ["Aurora", "Denver", "Pueblo", "Monument", "Fountain", "Castle Rock"];
const NC = FIRSTS.length; // 24 test people

/**
 * SQL string literal, apostrophes doubled.
 *
 * These values are hard-coded constants, not user input — but "TEST Spike Lee's" was enough to
 * break every statement in this file the first time it ran, and interpolating raw text into SQL is
 * a habit worth not having even where it happens to be safe. Anything interpolated below goes
 * through here or is a number this file computed.
 */
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/** Every name is deterministic, so a bug found against the fixture is reproducible from it alone. */
function contactRows() {
  return FIRSTS.map((f, i) =>
    `(${90001 + i},1,${q(`test.${f.toLowerCase()}@example.com`)},${q(`TEST ${f} ${LASTS[i]}`)},` +
    `${q(`555-01${String(i + 1).padStart(2, "0")}`)},${q(CITIES[i % CITIES.length])},'CO')`
  ).join(",\n     ");
}

/** Teams for one event, each with a score token so the captain scoring links work on seed. */
function teamRows(eventId, startId, count, contactOffset) {
  const teams = [], members = [];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    const cap = 90001 + ((contactOffset + i * 2) % NC);
    // The scoring route accepts /api/score/[a-f0-9]{16,64} — real tokens are hex, so fixture tokens
    // must be too, or the seeded links 404 and the feature looks broken when only the seed is.
    // Team ids are decimal digits, which are already valid hex characters.
    const token = "deadbeef" + String(id).padStart(8, "0");
    teams.push(`(${id},1,${eventId},${q(`TEST ${TEAM_NAMES[i % TEAM_NAMES.length]}`)},'BB/A','Coed',${cap},${i + 1},${q(token)})`);
    for (let k = 0; k < 2; k++) {
      const idx = (contactOffset + i * 2 + k) % NC;
      members.push(`(1,${id},${90001 + idx},${q(`TEST ${FIRSTS[idx]} ${LASTS[idx]}`)},${q(`test.${FIRSTS[idx].toLowerCase()}@example.com`)})`);
    }
  }
  return { teams: teams.join(",\n     "), members: members.join(",\n     ") };
}

/**
 * A full round-robin with plausible scores. Standings are computed from those same scores, so the
 * fixture can never ship a standings table that disagrees with its own results — which would make
 * the bracket seeding demo quietly meaningless.
 */
function roundRobin(eventId, startMatchId, teamIds, courts, pointsTo, opts = {}) {
  // `adrift: k` makes the LAST k teams lose almost everything, so the balancer has something real
  // to find. Without it every seeded division is a smooth ladder and the rebalancing rules — the
  // whole point of the feature — never fire against the sample data.
  const adrift = opts.adrift || 0;
  const n = teamIds.length, rows = [];
  const rec = new Map(teamIds.map((t) => [t, { w: 0, l: 0, pf: 0, pa: 0 }]));
  let id = startMatchId, round = 1, court = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // The better seed usually wins, but not always — enough upsets that the final standings are
      // not just seed order, which is the only way a seeded bracket is worth looking at.
      const iAdrift = i >= n - adrift, jAdrift = j >= n - adrift;
      const aWins = iAdrift && !jAdrift ? false
        : jAdrift && !iAdrift ? true
        : (j - i) > 1 || (i + j) % 3 !== 0;
      const diff = 2 + ((i * 7 + j * 3) % 9);
      const [sa, sb] = aWins ? [pointsTo, pointsTo - diff] : [pointsTo - diff, pointsTo];
      rows.push(`(${id},1,${eventId},'pool',${round},${court},${teamIds[i]},${teamIds[j]},NULL,${pointsTo},${pointsTo + 2},${sa},${sb})`);
      const A = rec.get(teamIds[i]), B = rec.get(teamIds[j]);
      A.pf += sa; A.pa += sb; B.pf += sb; B.pa += sa;
      if (sa > sb) { A.w++; B.l++; } else { B.w++; A.l++; }
      id++;
      if (++court > courts) { court = 1; round++; }
    }
  }
  const standings = [...rec.entries()]
    .map(([team, r]) => ({ team, ...r, pd: r.pf - r.pa }))
    .sort((x, y) => y.w - x.w || y.pd - x.pd || y.pf - x.pf)
    .map((r, i) => `(1,${eventId},${r.team},${r.w},${r.l},${r.pd},${r.pf},${r.pa},${i + 1})`)
    .join(",\n     ");
  return { matches: rows.join(",\n     "), standings, nextId: id };
}

const ids = (start, n) => Array.from({ length: n }, (_, i) => start + i);

/* ---------------- generate ---------------- */

async function generate(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const exists = await env.DB.prepare("SELECT id FROM events WHERE id BETWEEN ?1 AND ?2 LIMIT 1").bind(LO, HI).first();
  if (exists) return json({ error: "Test data already exists — wipe it first, then generate fresh." }, 409);

  const t2 = teamRows(90002, 90101, 12, 0);   // Summer Open  — no schedule yet
  const t4 = teamRows(90004, 90201, 8, 4);    // Fall Classic — pools scored
  const t5 = teamRows(90005, 90301, 8, 8);    // Winter Jam   — pools scored + bracket drawn

  const rr4 = roundRobin(90004, 90401, ids(90201, 8), 3, 21);
  const rr5 = roundRobin(90005, 90501, ids(90301, 8), 3, 21);

  // 90006 — the full house. Owner 2026-08-03: "build full tournaments (relate to number of courts
  // 12 vb courts) and add x3 4 court divisions."
  //
  // Twelve courts, three divisions of eight, each on its own four courts: Open 1-4, A 5-8, BB 9-12.
  // Every division has played a complete round-robin, so the balancer has real win records to read
  // rather than a synthetic ladder.
  //
  // The win spreads are chosen to make each of the owner's rules visible on one screen:
  //   Open  — 10 tight teams. The TOP-DIVISION TRIM fires: 9th and 10th have played 9 games each,
  //           a full day, so both are proposed for dropping to hold the top bracket at 8.
  //   A     — 8 competitive teams plus 2 adrift. Both proposed for a move down to BB.
  //   BB    — 8 competitive plus 2 adrift, and nothing below it, so those two are offered a
  //           two-team bracket against each other instead of being sent home.
  //
  //   TEN per division, not eight, because the arithmetic of an 8-team round-robin will not produce
  //   the owner's own example. With two teams losing everything, the median falls far enough that a
  //   1-win team sits only 2.5 below it and stops being flagged. Ten teams puts the median at 4.5
  //   and both outliers back outside the threshold — which is also what a real full house looks like.
  const t6open = teamRows(90006, 90601, 10, 0);
  const t6a    = teamRows(90006, 90621, 10, 16);
  const t6bb   = teamRows(90006, 90641, 10, 32);
  const rr6open = roundRobin(90006, 90701, ids(90601, 10), 4, 21);
  const rr6a    = roundRobin(90006, 90761, ids(90621, 10), 4, 21, { adrift: 2 });
  const rr6bb   = roundRobin(90006, 90821, ids(90641, 10), 4, 21, { adrift: 2 });

  const stmts = [
    `INSERT INTO contacts (id, org_id, email, full_name, phone, city, state) VALUES
     ${contactRows()}`,
    `INSERT INTO waivers (id, org_id, contact_id, waiver_text_version, signed_at, expires_at, signature_name) VALUES
     (90001,1,90001,'v1',datetime('now','-30 days'),datetime('now','+335 days'),'TEST Ava Stone')`,

    /* --- events --- */
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, format_template, status, price_cents) VALUES
     (90001,1,'tournament','TEST Spring Slam — finished (sample data)',datetime('now','-14 days','start of day','+9 hours'),datetime('now','-14 days','start of day','+16 hours'),'Boomtown Courts',8,2,'4-on-2','completed',4500)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents, cash_option_enabled) VALUES
     (90002,1,'tournament','TEST Summer Open — 12 teams, no schedule yet (sample data)',datetime('now','+10 days','start of day','+9 hours'),datetime('now','+10 days','start of day','+16 hours'),'Boomtown Courts',12,5,'published',6000,1)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, status, price_cents) VALUES
     (90003,1,'league','TEST Thursday Coed 4s League (sample data)',datetime('now','+7 days','start of day','+18 hours'),datetime('now','+63 days','start of day','+21 hours'),'Boomtown Courts',10,'published',12000)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents) VALUES
     (90004,1,'tournament','TEST Fall Classic — pools done, ready to bracket (sample data)',datetime('now','+3 days','start of day','+9 hours'),datetime('now','+3 days','start of day','+17 hours'),'Boomtown Courts',8,3,'in_progress',5500)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents) VALUES
     (90005,1,'tournament','TEST Winter Jam — bracket drawn, try auto-advance (sample data)',datetime('now','+1 days','start of day','+9 hours'),datetime('now','+1 days','start of day','+17 hours'),'Boomtown Courts',8,3,'in_progress',5500)`,

    /* --- 90001: the original completed event, kept as history --- */
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     (90001,1,90001,'TEST Set to Kill','BB/A','Coed',90001,1,'deadbeef00090001'),
     (90002,1,90001,'TEST Block Party','BB/A','Coed',90003,2,'deadbeef00090002'),
     (90003,1,90001,'TEST Net Gains','BB/A','Coed',90005,3,'deadbeef00090003'),
     (90004,1,90001,'TEST Ace Ventura','BB/A','Coed',90007,4,'deadbeef00090004')`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     (1,90001,90001,'TEST Ava Stone','test.ava@example.com'),
     (1,90001,90002,'TEST Ben Ortiz','test.ben@example.com'),
     (1,90002,90003,'TEST Cami Reyes','test.cami@example.com'),
     (1,90002,90004,'TEST Drew Park','test.drew@example.com'),
     (1,90003,90005,'TEST Elle Nguyen','test.elle@example.com'),
     (1,90003,90006,'TEST Finn Walker','test.finn@example.com'),
     (1,90004,90007,'TEST Gia Romano','test.gia@example.com'),
     (1,90004,90008,'TEST Hank Ellis','test.hank@example.com')`,
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     (90001,1,90001,'pool',1,1,90001,90004,NULL,21,23,21,15),
     (90002,1,90001,'pool',1,2,90002,90003,NULL,21,23,21,18),
     (90003,1,90001,'pool',2,1,90001,90003,NULL,21,23,21,19),
     (90004,1,90001,'pool',2,2,90002,90004,NULL,21,23,17,21),
     (90005,1,90001,'pool',3,1,90001,90002,NULL,21,23,21,12),
     (90006,1,90001,'pool',3,2,90003,90004,NULL,21,23,21,16)`,
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     (1,90001,90001,3,0,17,63,46,1),
     (1,90001,90003,1,2,-2,58,60,3),
     (1,90001,90002,1,2,-7,50,57,2),
     (1,90001,90004,1,2,-8,52,60,4)`,

    /* --- 90002 Summer Open: 12 teams, 5 courts, NOTHING scheduled.
           This is the one to point the pool generator at, then drag the result around. --- */
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     ${t2.teams}`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     ${t2.members}`,

    /* --- 90004 Fall Classic: 8 teams, every pool game scored, standings ready to seed a bracket --- */
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     ${t4.teams}`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     ${t4.members}`,
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     ${rr4.matches}`,
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     ${rr4.standings}`,

    /* --- 90005 Winter Jam: same, and the bracket gets drawn below by the real generator --- */
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     ${t5.teams}`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     ${t5.members}`,
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     ${rr5.matches}`,
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     ${rr5.standings}`,

    /* --- registrations: every payment state, on all three live tournaments --- */
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method, waiver_id) VALUES
     (90001,1,90002,90001,'paid','square',90001),
     (90002,1,90002,90003,'pending',NULL,NULL),
     (90003,1,90002,90005,'cash-pending','cash',NULL),
     (90004,1,90002,90007,'comped','comp',NULL),
     (90011,1,90002,90009,'paid','square',NULL),
     (90012,1,90002,90011,'paid','square',NULL),
     (90013,1,90002,90013,'pending',NULL,NULL),
     (90014,1,90002,90015,'paid','square',NULL)`,
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
     (90005,1,90003,90002,'paid','square'),
     (90006,1,90003,90004,'pending',NULL)`,
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
     (90021,1,90004,90005,'paid','square'),
     (90022,1,90004,90007,'paid','square'),
     (90023,1,90004,90009,'cash-pending','cash'),
     (90024,1,90004,90011,'comped','comp')`,
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
     (90031,1,90005,90009,'paid','square'),
     (90032,1,90005,90011,'paid','square'),
     (90033,1,90005,90013,'paid','square'),
     (90034,1,90005,90015,'pending',NULL)`,

    /* --- 90006: twelve courts, three divisions of eight, every pool game played --- */
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents) VALUES
     (90006,1,'tournament','TEST 12-Court Classic — 3 divisions, ready to balance (sample data)',datetime('now','+5 days','start of day','+8 hours'),datetime('now','+5 days','start of day','+18 hours'),'Boomtown Courts',30,12,'in_progress',6500)`,
    `INSERT INTO divisions (id, org_id, event_id, name, rank, court_from, court_to) VALUES
     (90001,1,90006,'Open',1,1,4),
     (90002,1,90006,'A',2,5,8),
     (90003,1,90006,'BB',3,9,12)`,
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     ${t6open.teams}`,
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     ${t6a.teams}`,
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed, score_token) VALUES
     ${t6bb.teams}`,
    `UPDATE teams SET division_id=90001 WHERE event_id=90006 AND id BETWEEN 90601 AND 90610`,
    `UPDATE teams SET division_id=90002 WHERE event_id=90006 AND id BETWEEN 90621 AND 90630`,
    `UPDATE teams SET division_id=90003 WHERE event_id=90006 AND id BETWEEN 90641 AND 90650`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     ${t6open.members}`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     ${t6a.members}`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     ${t6bb.members}`,
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     ${rr6open.matches}`,
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     ${rr6a.matches}`,
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     ${rr6bb.matches}`,
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     ${rr6open.standings}`,
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     ${rr6a.standings}`,
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     ${rr6bb.standings}`,
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
     (90041,1,90006,90001,'paid','square'),
     (90042,1,90006,90005,'paid','square'),
     (90043,1,90006,90017,'paid','square'),
     (90044,1,90006,90025,'cash-pending','cash'),
     (90045,1,90006,90033,'paid','square'),
     (90046,1,90006,90041,'comped','comp')`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();

  // Draw Winter Jam's bracket through the REAL generator, seeded off the standings just inserted.
  // The fixture is org 1 by construction, exactly as every statement above is.
  const seedCtx = { orgId: 1, userId: ctx.userId };
  const drawn = await generateBracketFor(env, seedCtx, 90005, { a_size: 8, points_to: 25, courts: 3 });
  const bracketNote = drawn.ok
    ? `${drawn.written} bracket games drawn from the pool finish`
    : `bracket NOT drawn (${drawn.error})`;

  await audit(env, ctx, "testdata.generate", "events", null, { range: `${LO}-${HI}`, bracket: bracketNote });
  return json({
    ok: true,
    bracket_ok: !!drawn.ok,
    message:
      "Test data created. Four tournaments, each parked where you can try something: " +
      "Summer Open (12 teams, 5 courts, no schedule — generate pools, then drag them); " +
      "Fall Classic (8 teams, pools scored — generate a bracket); " +
      "Winter Jam (8 teams, " + bracketNote + " — enter a quarter-final score and watch it advance). " +
      "12-Court Classic (30 teams, 3 divisions of 10 on 4 courts each, all pools played — run the " +
      "balancer: Open trims to 8, A has 2 teams to move down, BB has 2 with nowhere to go). " +
      "Plus a finished tournament and a league. Every team has a scoring link token. " +
      "Everything is marked TEST and uses @example.com emails.",
  });
}

async function wipe(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const stmts = [
    `DELETE FROM attendance    WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM checkins      WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM pools         WHERE event_id BETWEEN ${LO} AND ${HI}`,
    // Bracket rows and their matches get real auto-increment ids, outside the 90000 range — the
    // event_id filter is what actually catches them, and it is why every delete below has one.
    `DELETE FROM brackets      WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM division_moves WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM divisions     WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM registrations WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM standings     WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM matches       WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM team_members  WHERE team_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM teams         WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM events        WHERE id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM waivers       WHERE id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM contacts      WHERE id BETWEEN ${LO} AND ${HI}`,
  ];
  let removed = 0;
  for (const s of stmts) { const r = await env.DB.prepare(s).run(); removed += r.meta.changes || 0; }
  await audit(env, ctx, "testdata.wipe", "events", null, { removed });
  return json({ ok: true, removed, message: `Wiped ${removed} test rows. Real data is untouched (only the 90000+ range is ever deleted).` });
}
