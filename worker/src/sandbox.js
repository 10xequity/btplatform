/**
 * Boomtown Platform — Sandbox / Demo tools (Module 11.5)
 * File: worker/src/sandbox.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.11.0
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
 * The seed set mirrors db/2026-07-23_seed-testdata_v1.0.sql: 8 contacts, 1 waiver,
 * a COMPLETED tournament with 4 teams + 6 scored games + standings, an UPCOMING
 * tournament with all four payment states, and a league with 2 registrations.
 * Every statement is idempotent-safe because generate() refuses on existing data.
 */

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
      (SELECT COUNT(*) FROM matches       WHERE id BETWEEN ?1 AND ?2) AS matches,
      (SELECT COUNT(*) FROM registrations WHERE id BETWEEN ?1 AND ?2) AS registrations,
      (SELECT COUNT(*) FROM attendance    WHERE event_id BETWEEN ?1 AND ?2) AS attendance`
  ).bind(LO, HI).first();
  const seeded = Object.values(row).some(n => n > 0);
  return json({ ok: true, seeded, counts: row });
}

async function generate(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const exists = await env.DB.prepare("SELECT id FROM events WHERE id BETWEEN ?1 AND ?2 LIMIT 1").bind(LO, HI).first();
  if (exists) return json({ error: "Test data already exists — wipe it first, then generate fresh." }, 409);

  const stmts = [
    // contacts (8 test players)
    `INSERT INTO contacts (id, org_id, email, full_name, phone, city, state, instagram) VALUES
     (90001,1,'test.ava@example.com','TEST Ava Stone','555-0101','Colorado Springs','CO','test_ava'),
     (90002,1,'test.ben@example.com','TEST Ben Ortiz','555-0102','Colorado Springs','CO',NULL),
     (90003,1,'test.cami@example.com','TEST Cami Reyes','555-0103','Denver','CO','test_cami'),
     (90004,1,'test.drew@example.com','TEST Drew Park','555-0104','Pueblo','CO',NULL),
     (90005,1,'test.elle@example.com','TEST Elle Nguyen','555-0105','Monument','CO',NULL),
     (90006,1,'test.finn@example.com','TEST Finn Walker','555-0106','Fountain','CO',NULL),
     (90007,1,'test.gia@example.com','TEST Gia Romano','555-0107','Colorado Springs','CO',NULL),
     (90008,1,'test.hank@example.com','TEST Hank Ellis','555-0108','Castle Rock','CO',NULL)`,
    // waiver (one full happy path)
    `INSERT INTO waivers (id, org_id, contact_id, waiver_text_version, signed_at, expires_at, signature_name) VALUES
     (90001,1,90001,'v1',datetime('now','-30 days'),datetime('now','+335 days'),'TEST Ava Stone')`,
    // events: completed tournament, upcoming tournament, league
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, format_template, status, price_cents) VALUES
     (90001,1,'tournament','TEST Spring Slam (sample data)',datetime('now','-14 days','start of day','+9 hours'),datetime('now','-14 days','start of day','+16 hours'),'Boomtown Courts',8,2,'4-on-2','completed',4500)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, court_count, format_template, status, price_cents, cash_option_enabled) VALUES
     (90002,1,'tournament','TEST Summer Open (sample data)',datetime('now','+10 days','start of day','+9 hours'),datetime('now','+10 days','start of day','+16 hours'),'Boomtown Courts',12,3,'7-on-3','published',6000,1)`,
    `INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity, status, price_cents) VALUES
     (90003,1,'league','TEST Thursday Coed 4s League (sample data)',datetime('now','+7 days','start of day','+18 hours'),datetime('now','+63 days','start of day','+21 hours'),'Boomtown Courts',10,'published',12000)`,
    // teams
    `INSERT INTO teams (id, org_id, event_id, name, level, gender_division, captain_contact_id, seed) VALUES
     (90001,1,90001,'TEST Set to Kill','BB/A','Coed',90001,1),
     (90002,1,90001,'TEST Block Party','BB/A','Coed',90003,2),
     (90003,1,90001,'TEST Net Gains','BB/A','Coed',90005,3),
     (90004,1,90001,'TEST Ace Ventura','BB/A','Coed',90007,4)`,
    `INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
     (1,90001,90001,'TEST Ava Stone','test.ava@example.com'),
     (1,90001,90002,'TEST Ben Ortiz','test.ben@example.com'),
     (1,90002,90003,'TEST Cami Reyes','test.cami@example.com'),
     (1,90002,90004,'TEST Drew Park','test.drew@example.com'),
     (1,90003,90005,'TEST Elle Nguyen','test.elle@example.com'),
     (1,90003,90006,'TEST Finn Walker','test.finn@example.com'),
     (1,90004,90007,'TEST Gia Romano','test.gia@example.com'),
     (1,90004,90008,'TEST Hank Ellis','test.hank@example.com')`,
    // scored matches (full RR of 4)
    `INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id, ref_team_id, points_to, cap, score_a, score_b) VALUES
     (90001,1,90001,'pool',1,1,90001,90004,NULL,21,23,21,15),
     (90002,1,90001,'pool',1,2,90002,90003,NULL,21,23,21,18),
     (90003,1,90001,'pool',2,1,90001,90003,NULL,21,23,21,19),
     (90004,1,90001,'pool',2,2,90002,90004,NULL,21,23,17,21),
     (90005,1,90001,'pool',3,1,90001,90002,NULL,21,23,21,12),
     (90006,1,90001,'pool',3,2,90003,90004,NULL,21,23,21,16)`,
    // standings
    `INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank) VALUES
     (1,90001,90001,3,0,17,63,46,1),
     (1,90001,90003,1,2,-2,58,60,3),
     (1,90001,90002,1,2,-7,50,57,2),
     (1,90001,90004,1,2,-8,52,60,4)`,
    // registrations: all payment states on the upcoming tournament
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method, waiver_id) VALUES
     (90001,1,90002,90001,'paid','square',90001),
     (90002,1,90002,90003,'pending',NULL,NULL),
     (90003,1,90002,90005,'cash-pending','cash',NULL),
     (90004,1,90002,90007,'comped','comp',NULL)`,
    `INSERT INTO registrations (id, org_id, event_id, contact_id, status, payment_method) VALUES
     (90005,1,90003,90002,'paid','square'),
     (90006,1,90003,90004,'pending',NULL)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  await audit(env, ctx, "testdata.generate", "events", null, { range: `${LO}-${HI}` });
  return json({ ok: true, message: "Test data created: 3 events, 4 teams, 6 scored games, 6 registrations, 8 contacts. Everything is marked TEST and uses @example.com emails." });
}

async function wipe(env, ctx) {
  const deny = await requireStaff(env, ctx); if (deny) return deny;
  const stmts = [
    `DELETE FROM attendance    WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM checkins      WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM pools         WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM brackets      WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM registrations WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM standings     WHERE event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM matches       WHERE id BETWEEN ${LO} AND ${HI} OR event_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM team_members  WHERE team_id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM teams         WHERE id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM events        WHERE id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM waivers       WHERE id BETWEEN ${LO} AND ${HI}`,
    `DELETE FROM contacts      WHERE id BETWEEN ${LO} AND ${HI}`,
  ];
  let removed = 0;
  for (const s of stmts) { const r = await env.DB.prepare(s).run(); removed += r.meta.changes || 0; }
  await audit(env, ctx, "testdata.wipe", "events", null, { removed });
  return json({ ok: true, removed, message: `Wiped ${removed} test rows. Real data is untouched (only the 90000+ range is ever deleted).` });
}
