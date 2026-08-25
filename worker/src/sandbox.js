/**
 * Boomtown Platform — Sandbox / Demo tools (Module 11.5)
 * File: worker/src/sandbox.js · Version: v2.4 · Date: 2026-08-05 · Ships in: v0.92.0
 *
 * v2.4 — W-A: the Thursday league (90003) gets four teams with rosters, two of them linked to
 * the league registrations that created them (registrations 90005/90006 → teams 90701/90702),
 * so the registration → roster → league flow is walkable on test data. Wipe already covers
 * every row through the id/event ranges; registrations are deleted before teams, so team_id
 * links never block the second press.
 *
 * v2.3 — A3 (roadmap §-1): THE SEED NOW CARRIES THE MONEY AND THE COURT BOARD.
 * (1) Every square-paid registration gets a COMPLETED `payments` mirror row at the event price.
 *     Sales & Reports sums card revenue from `payments`, so 'paid' rows with no payment printed
 *     "$0 ALL-TIME REVENUE" beside "20 PAID REGISTRATIONS" — a tester reads that as a money bug.
 *     WIPE_SQL deletes payments BEFORE registrations (registration_id FK — the v0.88.0 class).
 * (2) A draft KOTC session with a 12-player entry list sits on the Thursday league (90003), so
 *     the Court Board has a session to open and round 1 is drawn by the REAL engine when the
 *     director starts it — seeded state stops at the exact point the create-session UI (Block D)
 *     will hand over. Wipe already covered kotc_* through the session's event_id.
 *
 * Staff-gated endpoints powering the admin rail's "Sandbox" group:
 *   GET  /api/admin/testdata           → counts of test rows per table (are we seeded?)
 *   POST /api/admin/testdata/generate  → CLEARS the 90000–90999 range and reseeds it, in ONE
 *                                        transaction. Safe to press from any state, including
 *                                        over a seed written by an older version of this file.
 *   POST /api/admin/testdata/wipe      → deletes ONLY the 90000–90999 range, plus rows that
 *                                        reference test events (attendance, checkins, pools,
 *                                        brackets). Real data is untouchable by construction.
 *
 * v2.1 — GENERATE COULD BE BLOCKED BY ITS OWN PREVIOUS OUTPUT. THAT WAS THE BUG.
 *
 * The owner reported "the test data module does not work". The previous session diagnosed a
 * generator that died part way through a run on live and left a partial seed nobody could clear,
 * and proposed making it resumable. That was wrong, and five facts from live D1 disprove it:
 * all eight contacts shared one `created_at` (2026-07-24 16:18:40 — ten days before v2.0 shipped,
 * and a multi-row INSERT is atomic in SQLite, so "8 of 48" is impossible as a partial write),
 * `city` was "Colorado Springs" which is not in CITIES, every `score_token` was NULL where this
 * file always writes one, and two of three event names did not match the strings below. Live held
 * a COMPLETE seed from the hand-run v1.0 seed SQL. Nothing half-ran; there was no partial state.
 *
 * The real defect was the refusal. `generate` returned 409 on finding any row in the range, and the
 * rail greys out Generate when seeded — so a seed from an older version of this file was a dead end
 * whose only exit was a Wipe you had to know to look for. A fixture generator that can be blocked by
 * its own previous output is not a tool, it is a puzzle.
 *
 * So generate now CLEARS AND RESEEDS, and both paths run the one delete list in WIPE_SQL.
 *
 * Both paths go through a single `D1.batch()`, which is a SQL transaction: if any statement fails
 * the whole sequence rolls back (Cloudflare D1 docs, `D1Database::batch`). A half-written seed is now
 * impossible rather than merely unlikely — which is the failure this was asked to eliminate. `wipe`
 * gets the same treatment; it used to be 14 sequential autocommits, so a mid-way failure there
 * really did leave a partial delete.
 *
 * NOT `ON CONFLICT DO NOTHING`, which was the other candidate. It is worse here: it would turn a
 * real failure — this delete list forgetting a table, say — into a silently incomplete fixture that
 * reports success. The transaction fails loudly and changes nothing instead. A fixture that lies
 * about being complete is the exact thing this file exists to avoid.
 *
 * On the limit theory, for the record: D1's documented cap is 1000 queries per Worker invocation on
 * Workers Paid (50 on Free), max statement length 100 KB, max query duration 30 s. This route issues
 * 44 statements, none near 100 KB. On Paid that is 4% of the cap, so the theory was arithmetically
 * dead as well as contradicted by the data. The batch also collapses the round trips into one call.
 *
 * The range is disposable by owner decision (2026-08-03): "we can delete them, no need to preserve
 * … the sandbox is temporary anyway." README standing rule #4's former exemption for contacts
 * 90001–90008 is struck on that word. This file recreates them identically anyway.
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
const NC = FIRSTS.length; // 48 test people — the comment here read "24" while the list held 48

/* §-1b W-G — shapes taken from the owner's REAL REVCO exports (2026 Spring, 21 team rows; the
   Valentines sheet is the same form). The "Emails of Teammates" cell is FREE TEXT and routinely
   does not carry one address per player: it holds three addresses for a team of four, or one
   address covering everybody, or the literal "N/A" / "No" / "Don't have.". So a real roster
   contains people with NO email on file.

   Exactly one seeded contact is therefore email-less, and that is what lets `reachable` and
   `total` DISAGREE on the marketing overview. With an address on every row the distinction cannot
   be seen at all, and W-F's segments — whose BASE_WHERE requires an address — would count every
   contact as reachable forever, in the fixture the owner uses to judge the feature.

   The index is chosen so the id is EVEN. Every contactOffset passed to teamRows() is even, so
   captains are always odd ids; this person is only ever a team MEMBER. That matches the real
   sheets, where the registering captain always supplies an address and the teammates may not. */
const NO_EMAIL_IDX = FIRSTS.length - 1;

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
    `(${90001 + i},1,${i === NO_EMAIL_IDX ? "NULL" : q(`test.${f.toLowerCase()}@example.com`)},${q(`TEST ${f} ${LASTS[i]}`)},` +
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

/* ---------------- clearing the test range ---------------- */

/**
 * Deleting the test range. ONE definition, used by BOTH `wipe` and `generate`.
 *
 * Two implementations of "remove the test data" would drift, and this file already carries a comment
 * warning about exactly that for bracket drawing ("a fixture built by a second implementation can
 * pass while the real one is broken"). The same argument applies to the delete.
 *
 * Order matters only for readability — D1 runs with foreign keys OFF, as SQLite does by default, so
 * children do not have to precede parents. They are ordered child-first anyway, because the day FKs
 * are switched on this list should not need rewriting.
 *
 * Every statement is scoped to the id range or to rows whose `event_id` is in it. That scoping is the
 * safety property, not a convention: `sandbox_seed.test.mjs` carries a negative control that puts a
 * real event and a real team beside the fixture and asserts both survive.
 */
/* v2.2 — THE ORDER IS THE WHOLE POINT, AND IT WAS WRONG.
 *
 * `D1 ENFORCES FOREIGN KEYS.` The previous list deleted `brackets` at index 3 and the `matches`
 * that carry `bracket_id` at index 8, so once anything referenced a bracket the delete raised
 * `FOREIGN KEY constraint failed`. `D1.batch()` is one transaction, so the whole 57-statement
 * wipe-and-reseed rolled back and the route answered 500.
 *
 * The rows that triggered it were written by `generate` ITSELF: its last step draws Winter Jam's
 * bracket through the real generator, which creates the `brackets` row and the `matches.bracket_id`
 * values that block the next run. So press #1 on an empty range succeeded and EVERY PRESS AFTER IT
 * FAILED — including `wipe`, which shares this list, so the button whose job is to clear a stuck
 * seed was stuck on the same statement. There was no recovery path from the UI.
 *
 * Two more of the same defect were latent behind it, and both are fixed here rather than left to
 * surface one at a time: `pools` also preceded the `matches` that carry `pool_id`, and `divisions`
 * preceded the `teams`, `pools` and `brackets` that carry `division_id`.
 *
 * THE RULE THIS LIST NOW OBEYS: a row may only be deleted after everything that references it.
 * `wipe_order.test.mjs` asserts that mechanically against the real schema graph read from
 * `sqlite_master`, so a new foreign key cannot quietly invalidate the order — a hand-checked list
 * is correct only until the next migration.
 *
 * Bracket, pool and division rows get real auto-increment ids OUTSIDE the 90000 range, so the
 * `event_id` filter is what actually catches them. Every delete is scoped to the test range; a
 * statement that cannot be scoped does not belong here.
 */
export const WIPE_SQL = [
  /* ---- v2.3 (2026-08-25): TABLES THE SEEDER NEVER WRITES, BUT OTHER MODULES DO. The live
     wipe 500'd on `booking_spaces` — 33 rows written by the FACILITY module against seeded
     events. The double-press guard could not see it (the fixture never writes these tables);
     wipe_order v1.1's COMPLETENESS check now walks the whole FK graph, so a module that grows
     a new reference to a wiped table reddens the suite instead of the live button. Children
     first within this block too (pass_redemptions → passes → sales; grants → subscriptions). ---- */
  `DELETE FROM pass_redemptions WHERE contact_id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI} OR pass_id IN (SELECT id FROM passes WHERE contact_id BETWEEN ${LO} AND ${HI}) OR attendance_id IN (SELECT id FROM attendance WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM membership_grants WHERE contact_id BETWEEN ${LO} AND ${HI} OR subscription_id IN (SELECT id FROM subscriptions WHERE contact_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM passes         WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM sale_items     WHERE sale_id IN (SELECT id FROM sales WHERE contact_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM sales          WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM subscriptions  WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM booking_spaces  WHERE booking_id IN (SELECT id FROM space_bookings WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM rental_requests WHERE booking_id IN (SELECT id FROM space_bookings WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM form_responses WHERE registration_id BETWEEN ${LO} AND ${HI} OR field_id IN (SELECT id FROM form_fields WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM media_consents WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM announcement_mutes WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM campaign_sends WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM lfg_bans       WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM member_field_values WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM staff_rates    WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM sms_log        WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM uploads        WHERE uploaded_by_contact_id BETWEEN ${LO} AND ${HI}`,

  /* ---- deepest children: rows that reference team_members / rounds / squads ---- */
  `DELETE FROM attendance     WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM checkins       WHERE event_id BETWEEN ${LO} AND ${HI}`,

  /* ---- tryouts: a tester who evaluates one player used to break the next reseed ---- */
  `DELETE FROM tryout_evaluations   WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM tryout_profiles      WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM tryout_squad_members WHERE squad_id IN (SELECT id FROM tryout_squads WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM tryout_squads        WHERE event_id BETWEEN ${LO} AND ${HI}`,

  /* ---- KOTC: scoped through the session, since only it carries an event_id ---- */
  `DELETE FROM kotc_games    WHERE round_id IN (SELECT id FROM kotc_rounds WHERE session_id IN (SELECT id FROM kotc_sessions WHERE event_id BETWEEN ${LO} AND ${HI}))`,
  `DELETE FROM kotc_slots    WHERE round_id IN (SELECT id FROM kotc_rounds WHERE session_id IN (SELECT id FROM kotc_sessions WHERE event_id BETWEEN ${LO} AND ${HI}))`,
  `DELETE FROM kotc_rounds   WHERE session_id IN (SELECT id FROM kotc_sessions WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM kotc_players  WHERE session_id IN (SELECT id FROM kotc_sessions WHERE event_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM kotc_sessions WHERE event_id BETWEEN ${LO} AND ${HI}`,

  /* ---- everything that references teams / brackets / pools / divisions ---- */
  `DELETE FROM division_moves WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM standings      WHERE event_id BETWEEN ${LO} AND ${HI}`,
  // BEFORE brackets, pools and teams — matches carries bracket_id, pool_id and team_a/b/ref_id.
  `DELETE FROM matches        WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM team_members   WHERE team_id BETWEEN ${LO} AND ${HI}`,
  // BEFORE registrations — waitlists carries claimed_registration_id.
  `DELETE FROM waitlists      WHERE event_id BETWEEN ${LO} AND ${HI}`,
  // BEFORE registrations — payments carries registration_id (added v0.89.0 with the A3 payment
  // rows; without this line the SECOND press dies on the same FK class v0.88.0 fixed).
  `DELETE FROM payments       WHERE registration_id BETWEEN ${LO} AND ${HI}`,
  // BEFORE teams, waivers and contacts — registrations carries team_id, waiver_id, contact_id.
  `DELETE FROM registrations  WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
  // BEFORE pools AND brackets — teams carries pool_id, and the board sets it.
  `DELETE FROM teams          WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM brackets       WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM pools          WHERE event_id BETWEEN ${LO} AND ${HI}`,
  // AFTER teams, pools, brackets and division_moves — all four carry division_id.
  `DELETE FROM divisions      WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,

  /* ---- remaining event- and contact-scoped rows, then the parents ---- */
  `DELETE FROM form_fields    WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM space_bookings WHERE event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM staff_shifts   WHERE event_id BETWEEN ${LO} AND ${HI} OR contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM notifications  WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM profiles       WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  // T2-14 (v0.120.0) — the community boards. member_profiles BEFORE lfg_listings (it carries
  // sub_lfg_listing_id); members and strikes BEFORE listings too. Listings and requests are
  // AUTOINCREMENT, so they are scoped through their test-range creator — the pools/brackets
  // precedent — and strikes/members also by listing, so a REAL member's row on a test listing
  // cannot block the reseed (the tryout_evaluations lesson).
  `DELETE FROM member_profiles WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM lfg_members  WHERE contact_id BETWEEN ${LO} AND ${HI} OR listing_id IN (SELECT id FROM lfg_listings WHERE created_by_contact_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM lfg_strikes  WHERE contact_id BETWEEN ${LO} AND ${HI} OR listing_id IN (SELECT id FROM lfg_listings WHERE created_by_contact_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM lfg_listings WHERE created_by_contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM sub_requests WHERE requested_by_contact_id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM sub_signups  WHERE contact_id BETWEEN ${LO} AND ${HI}`,
  // events carries staff_contact_id, so it goes before contacts.
  `DELETE FROM events         WHERE id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM waivers        WHERE id BETWEEN ${LO} AND ${HI}`,
  // families <-> contacts is a genuine FK CYCLE (families.primary_contact_id -> contacts,
  // contacts.family_id -> families) — no delete order alone can satisfy it. The ONE update in
  // this list breaks the cycle: any contact pointing at a family being wiped loses only that
  // pointer (the family is deleted next), then families go before contacts as child-first asks.
  `UPDATE contacts SET family_id = NULL WHERE family_id IN (SELECT id FROM families WHERE primary_contact_id BETWEEN ${LO} AND ${HI})`,
  `DELETE FROM families       WHERE primary_contact_id BETWEEN ${LO} AND ${HI}`,
  `DELETE FROM contacts       WHERE id BETWEEN ${LO} AND ${HI}`,
];

/** Counts at test ids, so both routes can report what they actually changed. */
async function testCounts(env) {
  return env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM events        WHERE id BETWEEN ?1 AND ?2) AS events,
      (SELECT COUNT(*) FROM contacts      WHERE id BETWEEN ?1 AND ?2) AS contacts,
      (SELECT COUNT(*) FROM teams         WHERE id BETWEEN ?1 AND ?2) AS teams,
      (SELECT COUNT(*) FROM matches       WHERE id BETWEEN ?1 AND ?2 OR event_id BETWEEN ?1 AND ?2) AS matches,
      (SELECT COUNT(*) FROM registrations WHERE id BETWEEN ?1 AND ?2) AS registrations,
      (SELECT COUNT(*) FROM attendance    WHERE event_id BETWEEN ?1 AND ?2) AS attendance`
  ).bind(LO, HI).first();
}

/* ---------------- generate ---------------- */

async function generate(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  // No 409 here any more. A seed already in the range — from this version or an older one — is
  // something to REPLACE, not a reason to refuse. The old refusal is what made a stale seed a dead
  // end. `before` is read only so the response can say honestly whether it replaced anything.
  const before = await testCounts(env);
  const replaced = Object.values(before).some((n) => n > 0);

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
     (90001,1,'tournament','TEST Spring Slam · finished (sample data)',datetime('now','-14 days','start of day','+9 hours'),datetime('now','-14 days','start of day','+16 hours'),'Boomtown Courts',8,2,'4-on-2','completed',4500)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents, cash_option_enabled) VALUES
     (90002,1,'tournament','TEST Summer Open · 12 teams, no schedule yet (sample data)',datetime('now','+10 days','start of day','+9 hours'),datetime('now','+10 days','start of day','+16 hours'),'Boomtown Courts',12,5,'published',6000,1)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, status, price_cents) VALUES
     (90003,1,'league','TEST Thursday Coed 4s League (sample data)',datetime('now','+7 days','start of day','+18 hours'),datetime('now','+63 days','start of day','+21 hours'),'Boomtown Courts',10,'published',12000)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents) VALUES
     (90004,1,'tournament','TEST Fall Classic · pools done, ready to bracket (sample data)',datetime('now','+3 days','start of day','+9 hours'),datetime('now','+3 days','start of day','+17 hours'),'Boomtown Courts',8,3,'in_progress',5500)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, status, price_cents) VALUES
     (90005,1,'tournament','TEST Winter Jam · bracket drawn, try auto-advance (sample data)',datetime('now','+1 days','start of day','+9 hours'),datetime('now','+1 days','start of day','+17 hours'),'Boomtown Courts',8,3,'in_progress',5500)`,

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
     (90014,1,90002,90015,'paid','square',NULL),
     /* W-G: 'email-sent' is the commonest UNPAID state on the real sheets — the payment link went
        out and the team never finished checkout (3 of 21 Spring rows, 4 of 29 Valentines rows).
        The registrations screen's "Unpaid" filter is the three statuses pending / email-sent /
        cash-pending, and the fixture produced only two of them, so a third of that filter had
        never selected a seeded row. */
     (90015,1,90002,90017,'email-sent',NULL,NULL)`,
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
     (90005,1,90003,90002,'paid','square'),
     (90006,1,90003,90004,'pending',NULL)`,

    /* --- W-A (v0.92.0): the Thursday league's teams, two of them LINKED to the registrations
       that created them — the registration → roster → league flow the owner asked to see. The
       other two carry no registration on purpose: hand-added teams exist, and the roster modal
       says where a team came from either way. --- */
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, score_token) VALUES
     (90701,1,90003,'TEST Net Gains','BB','Coed',90002,'ba11ba1100090701'),
     (90702,1,90003,'TEST Sets on the Beach','BB','Coed',90004,'ba11ba1100090702'),
     /* W-G: both real level labels now appear. The REVCO form offers "BB/A" and "A/AA" and nothing
        else, and board_suggest's tier ladder scores them 250 and 350 — but every seeded team was
        BB/A, BB or A, so the 350 rung was never occupied and no seeded comparison could span two
        tiers. "Block Party" at A/AA is lifted verbatim from the Spring sheet. The comma in the
        other name is also real ("Jarvis, Jork It A Lil") and is the shape that breaks a naive CSV
        split — the same class as the apostrophe in "Spike Lee's" that q() exists for. */
     (90703,1,90003,'TEST Block Party','A/AA','Coed',90006,'ba11ba1100090703'),
     (90704,1,90003,'TEST Jarvis, Jork It A Lil','BB/A','Coed',90008,'ba11ba1100090704')`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     (1,90701,90002,'TEST Ben Cruz','test-ben@example.com'),
     (1,90701,NULL,'TEST Mia Torres','test-mia@example.com'),
     (1,90702,90004,'TEST Dana Reyes','test-dana@example.com'),
     (1,90702,NULL,'TEST Leo Park',NULL),
     (1,90703,90006,'TEST Sam Ortiz','test-sam@example.com'),
     (1,90704,90008,'TEST Nia Wells','test-nia@example.com')`,
    `UPDATE registrations SET team_id=90701 WHERE id=90005`,
    `UPDATE registrations SET team_id=90702 WHERE id=90006`,
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
     (90006,1,'tournament','TEST 12-Court Classic · 3 divisions, ready to balance (sample data)',datetime('now','+5 days','start of day','+8 hours'),datetime('now','+5 days','start of day','+18 hours'),'Boomtown Courts',30,12,'in_progress',6500)`,
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

    /* --- A3: the payments mirror for every square-paid registration above, at its event's
       price. Card revenue is summed from `payments` (COMPLETED only); cash and comped rows are
       counted at event price by the report itself and need no mirror. Ids are auto-increment —
       the wipe finds these through registration_id, exactly like the FK does. --- */
    `INSERT INTO payments (org_id, registration_id, square_payment_id, amount_cents, status) VALUES
     (1,90001,'TEST-PM-90001',6000,'COMPLETED'),
     (1,90011,'TEST-PM-90011',6000,'COMPLETED'),
     (1,90012,'TEST-PM-90012',6000,'COMPLETED'),
     (1,90014,'TEST-PM-90014',6000,'COMPLETED'),
     (1,90005,'TEST-PM-90005',12000,'COMPLETED'),
     (1,90021,'TEST-PM-90021',5500,'COMPLETED'),
     (1,90022,'TEST-PM-90022',5500,'COMPLETED'),
     (1,90031,'TEST-PM-90031',5500,'COMPLETED'),
     (1,90032,'TEST-PM-90032',5500,'COMPLETED'),
     (1,90033,'TEST-PM-90033',5500,'COMPLETED'),
     (1,90041,'TEST-PM-90041',6500,'COMPLETED'),
     (1,90042,'TEST-PM-90042',6500,'COMPLETED'),
     (1,90043,'TEST-PM-90043',6500,'COMPLETED'),
     (1,90045,'TEST-PM-90045',6500,'COMPLETED')`,

    /* --- A3: a KOTC session parked at the exact state the Court Board can pick up — a draft
       with its entry list in, round 1 NOT drawn (the real engine draws it when the director
       starts the night; hand-written engine output is the only kind of fixture that lies). --- */
    `INSERT INTO kotc_sessions (id, org_id, event_id, name, players_per_net, move_up, points_to, status) VALUES
     (90001,1,90003,'TEST Kings Court · Thursday league night',4,1,21,'draft')`,
    `INSERT INTO kotc_players (org_id, session_id, contact_id, score_token, seed) VALUES
     (1,90001,90001,'c0ffee0000090001',1),
     (1,90001,90002,'c0ffee0000090002',2),
     (1,90001,90003,'c0ffee0000090003',3),
     (1,90001,90004,'c0ffee0000090004',4),
     (1,90001,90005,'c0ffee0000090005',5),
     (1,90001,90006,'c0ffee0000090006',6),
     (1,90001,90007,'c0ffee0000090007',7),
     (1,90001,90008,'c0ffee0000090008',8),
     (1,90001,90009,'c0ffee0000090009',9),
     (1,90001,90010,'c0ffee000009000a',10),
     (1,90001,90011,'c0ffee000009000b',11),
     (1,90001,90012,'c0ffee000009000c',12)`,

    /* --- T2-14 (v0.120.0): the community boards, which the tester round called "not working"
       and which were merely EMPTY — this seed writes zero rows to none of them any more.
       Vocabulary comes from subs.js (SKILLS/GENDERS/GAME_TYPES); dates are relative so the
       fixture never rots (the timecheck class). Every listing has a DISTINCT creator, so
       lfg_members can join through an unambiguous subselect (anchor ambiguity is how a wrong
       row passes silently). Contact 90048 is the deliberate no-email person and sits on no
       board that would try to email them. --- */
    `INSERT INTO member_profiles (org_id, contact_id, visibility, positions, skill_level, gender_division, bio, sub_opt_in, date_of_birth) VALUES
     (1,90001,'public','setter','a','mens','TEST: runs a tight 5-1, plays Tuesday and Thursday.',1,date('now','-29 years')),
     (1,90002,'public','outside','bb','womens','TEST: outside who covers deep. Looking for coed 6s.',1,date('now','-24 years')),
     (1,90003,'members','middle','a','mens','TEST: middle, big block, can ref.',0,date('now','-31 years')),
     (1,90004,'members','libero','aa','womens','TEST: libero, fast first touch.',1,date('now','-26 years')),
     (1,90005,'members','opposite','b','coed','TEST: lefty opposite, new to the area.',0,date('now','-22 years')),
     (1,90006,'members','setter,outside','bb','coed','TEST: plays both ways, prefers 4s.',1,date('now','-35 years')),
     (1,90007,'members','outside','a','mens','TEST: weekend tournaments only.',0,date('now','-28 years')),
     (1,90008,'members','middle','bb','womens','TEST: middle learning to slide.',0,date('now','-21 years')),
     (1,90009,'members','libero','b','coed','TEST: steady passer, happy to sub.',1,date('now','-40 years')),
     (1,90010,'members','opposite','aa','mens','TEST: six years of club.',0,date('now','-27 years')),
     (1,90011,'members','setter','bb','womens','TEST: setter who calls a loud game.',0,date('now','-33 years')),
     (1,90012,'members','outside,libero','a','coed','TEST: plays anywhere back row.',1,date('now','-25 years')),
     (1,90015,'public','outside','bb','mens','TEST MINOR: must never appear below staff tier.',0,date('now','-16 years'))`,
    `INSERT INTO sub_signups (org_id, contact_id, skill_levels, genders, game_types, note) VALUES
     (1,90002,'bb,a','coed,womens','6s','TEST: weeknights after 6.'),
     (1,90005,'b,bb','coed','4s,6s','TEST: short notice is fine.'),
     (1,90007,'a,aa','mens','6s','TEST: tournaments preferred.'),
     (1,90009,'any','any','any','TEST: call whenever a spot opens.'),
     (1,90012,'a','coed','2s,4s','TEST: beach or grass in summer.')`,
    `INSERT INTO sub_requests (org_id, event_id, requested_by_contact_id, needed_at, skill_level, gender_requirement, game_type, note) VALUES
     (1,90003,90001,datetime('now','+2 days'),'bb','coed','6s','TEST: our middle is travelling, need one for Thursday.'),
     (1,90003,90013,datetime('now','+9 days'),'a','coed','6s','TEST: playoffs week, want a strong outside.'),
     (1,NULL,90006,datetime('now','+4 days'),'any','womens','4s','TEST: casual fours at the park, one more needed.'),
     (1,NULL,90010,datetime('now','+1 day'),'b','any','2s','TEST: doubles partner for tomorrow evening.')`,
    `INSERT INTO lfg_listings (org_id, kind, created_by_contact_id, team_name, skill_level, gender_requirement, game_type, spots, play_at, location_note, note) VALUES
     (1,'team_need',90003,'TEST Net Assets','bb','coed','6s',2,NULL,NULL,'TEST: two spots for the fall season, back row preferred.'),
     (1,'team_need',90011,'TEST Block Party','a','womens','6s',1,NULL,NULL,'TEST: need one middle to complete the roster.'),
     (1,'player_avail',90005,NULL,'b','coed','any',NULL,NULL,NULL,'TEST: new in town, can play any night.'),
     (1,'player_avail',90008,NULL,'bb','womens','6s',NULL,NULL,NULL,'TEST: middle looking for a Tuesday team.'),
     (1,'casual',90006,NULL,'any','coed','4s',NULL,datetime('now','+3 days'),'TEST Riverside Park, north courts','TEST: bring a light and a dark shirt.'),
     (1,'casual',90014,NULL,'any','any','2s',NULL,datetime('now','+6 days'),'TEST Fieldhouse court 2','TEST: winner stays on, all levels.')`,
    `INSERT INTO lfg_members (org_id, listing_id, contact_id)
     SELECT 1, id, 90004 FROM lfg_listings WHERE created_by_contact_id=90003 AND deleted_at IS NULL`,
    `INSERT INTO lfg_members (org_id, listing_id, contact_id)
     SELECT 1, id, 90009 FROM lfg_listings WHERE created_by_contact_id=90003 AND deleted_at IS NULL`,
    `INSERT INTO lfg_members (org_id, listing_id, contact_id)
     SELECT 1, id, 90012 FROM lfg_listings WHERE created_by_contact_id=90011 AND deleted_at IS NULL`,
  ];
  // Clear then seed, as ONE transaction. D1 runs a batch as a SQL transaction, so if any statement
  // fails the whole sequence rolls back and the database is left exactly as it was — no half-written
  // fixture, which is the state nobody could clear from the UI. Deliberately not per-row
  // ON CONFLICT DO NOTHING: that would let a forgotten table produce a quietly incomplete fixture
  // that still reported success.
  await env.DB.batch([...WIPE_SQL, ...stmts].map((s) => env.DB.prepare(s)));

  // Draw Winter Jam's bracket through the REAL generator, seeded off the standings just inserted.
  // The fixture is org 1 by construction, exactly as every statement above is.
  const seedCtx = { orgId: 1, userId: ctx.userId };
  const drawn = await generateBracketFor(env, seedCtx, 90005, { a_size: 8, points_to: 25, courts: 3 });
  const bracketNote = drawn.ok
    ? `${drawn.written} bracket games drawn from the pool finish`
    : `bracket NOT drawn (${drawn.error})`;

  await audit(env, ctx, "testdata.generate", "events", null, {
    range: `${LO}-${HI}`, bracket: bracketNote, replaced: replaced ? before : null,
  });
  return json({
    ok: true,
    bracket_ok: !!drawn.ok,
    replaced,
    message:
      (replaced ? "Test data replaced. " : "Test data created. ") +
      "Four tournaments, each parked where you can try something: " +
      "Summer Open (12 teams, 5 courts, no schedule; generate pools, then drag them); " +
      "Fall Classic (8 teams, pools scored; generate a bracket); " +
      "Winter Jam (8 teams, " + bracketNote + "; enter a quarter-final score and watch it advance). " +
      "12-Court Classic (30 teams, 3 divisions of 10 on 4 courts each, all pools played; run the " +
      "balancer: Open trims to 8, A has 2 teams to move down, BB has 2 with nowhere to go). " +
      "Plus a finished tournament and a league. Every team has a scoring link token. " +
      "Everything is marked TEST and uses @example.com emails.",
  });
}

async function wipe(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  // One transaction, same list generate uses. Previously fourteen sequential autocommits, so a
  // failure part way through genuinely left a partial delete — the same class of unclearable state
  // this release exists to remove, sitting in the button whose job is to clear it.
  const results = await env.DB.batch(WIPE_SQL.map((s) => env.DB.prepare(s)));
  const removed = results.reduce((n, r) => n + (r?.meta?.changes || 0), 0);
  await audit(env, ctx, "testdata.wipe", "events", null, { removed });
  return json({ ok: true, removed, message: `Wiped ${removed} test rows. Real data is untouched (only the 90000+ range is ever deleted).` });
}
