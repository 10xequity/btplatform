/**
 * Boomtown Platform — duplicating an event carries its DIVISIONS, and nothing that is people
 * File: worker/test/event_duplicate.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.127.0
 *
 * Owner 2026-08-10 approved "P-A — duplicate an event". MEASURING THE APPROVAL FOUND THE FEATURE
 * ALREADY BUILT AND ALREADY WIRED: `POST /api/events/:id/duplicate` (events_admin.js:130) and the
 * Duplicate button on the event screen (admin-event.js:107) have existed the whole time. The
 * proposal that called it "verified unbuilt" was written against a broken grep — `\|` inside
 * `grep -E` matches a literal backslash-pipe, so the alternation never searched anything (§-1c
 * D-26). This file is therefore the FIRST route-level test the feature has ever had.
 *
 * WHAT WAS GENUINELY MISSING: the copy takes the events ROW only (`cleanEventBag` iterates
 * EVENT_FIELDS), so a league duplicated for next season arrived with no divisions — and for the
 * owner's stated use case ("set up next season from this one"), the division structure IS the
 * configuration: Open/A/BB, their ranks, their court ranges. This file pins the completed
 * contract:
 *
 *   COPIED : the event's own config fields · its LIVE divisions (name, rank, courts, target
 *            bracket size, notes)
 *   NEVER  : teams, registrations, matches, standings, brackets — the boundary is the design;
 *            a duplicate that brought people along would let one press re-register a whole season
 *
 * The status is always DRAFT regardless of the source's status, because a copy that arrives
 * published is a copy that appears on member surfaces before a human has looked at it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const v = await call(env, "POST", "/api/auth/verify", {
    body: { token: String(asked.data.dev_link).split("token=")[1] },
  });
  return v.data.token;
}

/**
 * A league with everything a season accumulates: divisions (one soft-deleted), teams,
 * registrations, matches, standings. The copy must take the structure and leave the season.
 */
function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec(`INSERT INTO events (id, org_id, type, name, starts_at, ends_at, location, capacity,
             court_count, price_cents, status) VALUES
             (30,1,'league','Thursday Coed 4s','2026-05-01 18:00','2026-07-10 21:00','Boomtown Courts',
              24,8,12000,'in_progress')`);
  DB.exec(`INSERT INTO divisions (id, org_id, event_id, name, rank, court_from, court_to, target_bracket_size, notes) VALUES
             (301,1,30,'Open',1,1,3,8,'Top division holds at 8'),
             (302,1,30,'A',2,4,6,NULL,NULL),
             (303,1,30,'BB',3,7,8,NULL,'New this season')`);
  DB.exec(`INSERT INTO divisions (id, org_id, event_id, name, rank, deleted_at) VALUES
             (304,1,30,'Retired div',4,datetime('now'))`);
  DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (900,1,'cap@bt.test','Ava Stone')");
  DB.exec("INSERT INTO teams (id, org_id, event_id, name, division_id, captain_contact_id) VALUES (91,1,30,'Net Assets',301,900)");
  DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, team_id, status) VALUES (1,30,900,91,'paid')`);
  DB.exec(`INSERT INTO matches (org_id, event_id, stage, round, court, team_a_id, team_b_id, score_a, score_b)
           VALUES (1,30,'pool',1,1,91,91,21,15)`);
  DB.exec("INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES (1,30,91,3,1,1)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

// The first-ever user in the harness is bootstrapped as an admin so setup can run; sign the staff
// account in first (it gets the role this test wants), then the plain member second.
async function tokens(env) {
  const staff = await signIn(env, "staff@bt.test");
  const member = await signIn(env, "member@bt.test");
  return { staff, member };
}

const dup = (env, token, id, body = {}) =>
  call(env, "POST", `/api/events/${id}/duplicate`, { token, body });

/* ============ the fixture can exhibit the defect ============ */

test("PRE-FIX CHECK — the source event has live divisions, so the copy assertions cannot be vacuous", () => {
  const env = boot();
  assert.equal(env.DB.one(
    "SELECT COUNT(*) AS n FROM divisions WHERE event_id=30 AND deleted_at IS NULL").n, 3,
    "a source with no divisions would pass every 'divisions copied' test on an implementation that copies nothing");
  env.DB.close();
});

/* ============ what the copy takes ============ */

test("duplicate copies the event's own config and lands as a DRAFT named '(copy)'", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await dup(env, staff, 30);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const ev = env.DB.one("SELECT * FROM events WHERE id=?1", r.data.id);
  assert.equal(ev.name, "Thursday Coed 4s (copy)");
  assert.equal(ev.status, "draft",
    "a copy that arrives published shows on member surfaces before a human has looked at it");
  assert.equal(ev.price_cents, 12000);
  assert.equal(ev.court_count, 8);
  env.DB.close();
});

test("duplicate carries the LIVE division structure — names, order, courts, size, notes", async () => {
  // The genuinely missing half of the built feature: for "set up next season", the divisions ARE
  // the configuration. Compared as a SHAPE derived from the source rows, not a hand-written list.
  const env = boot();
  const { staff } = await tokens(env);
  const r = await dup(env, staff, 30);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));

  const shape = (eventId) => env.DB.query(
    `SELECT name, rank, court_from, court_to, target_bracket_size, notes
       FROM divisions WHERE org_id=1 AND event_id=?1 AND deleted_at IS NULL ORDER BY rank, id`, eventId);
  const source = shape(30), copy = shape(r.data.id);
  assert.equal(source.length, 3, "the source lost its divisions — the fixture no longer exhibits anything");
  assert.deepEqual(copy, source,
    "the duplicated event's divisions do not match the source's live divisions");

  // New rows, not shared ones: editing next season's Open must never touch last season's.
  const ids = env.DB.query("SELECT id FROM divisions WHERE event_id=?1", r.data.id).map((d) => d.id);
  assert.ok(ids.every((i) => ![301, 302, 303, 304].includes(i)), "the copy points at the SOURCE division rows");
  env.DB.close();
});

test("NC — soft-deleting a live division removes it from the NEXT copy, so the filter is real", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  env.DB.exec("UPDATE divisions SET deleted_at=datetime('now') WHERE id=303");
  assert.ok(env.DB.one("SELECT deleted_at FROM divisions WHERE id=303").deleted_at, "mutation did not land");
  const r = await dup(env, staff, 30);
  const copied = env.DB.query(
    "SELECT name FROM divisions WHERE event_id=?1 AND deleted_at IS NULL", r.data.id);
  assert.equal(copied.length, 2, "a soft-deleted division was resurrected into the copy");
  assert.ok(!copied.some((d) => d.name === "BB"), "the deleted division travelled by name");
  env.DB.close();
});

/* ============ what the copy must NEVER take ============ */

test("duplicate takes NO people and NO results — teams, registrations, matches, standings all stay behind", async () => {
  // The boundary is the design: a duplicate that brought registrations along would re-register a
  // whole season with one press, and money hangs off registrations.
  const env = boot();
  const { staff } = await tokens(env);
  const r = await dup(env, staff, 30);
  for (const [table, col] of [["teams", "event_id"], ["registrations", "event_id"],
                              ["matches", "event_id"], ["standings", "event_id"]]) {
    assert.equal(env.DB.one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col}=?1`, r.data.id).n, 0,
      `${table} rows were copied onto the new event`);
  }
  // And the source keeps everything — a copy is not a move.
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE event_id=30").n, 1);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM registrations WHERE event_id=30").n, 1);
  env.DB.close();
});

/* ============ access and audit ============ */

test("a plain member cannot duplicate an event", async () => {
  const env = boot();
  const { member } = await tokens(env);
  const r = await dup(env, member, 30);
  assert.equal(r.status, 403, `expected a refusal, got ${r.status}`);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM events").n, 1, "the refused call still created an event");
  env.DB.close();
});

test("the duplicate is audited with where it came from and how much structure it carried", async () => {
  const env = boot();
  const { staff } = await tokens(env);
  const r = await dup(env, staff, 30);
  // audit_log stores its bag as detail_json (read from the schema, not guessed — the first draft
  // of this test invented `payload_json` and accused working code).
  const row = env.DB.one(
    "SELECT detail_json FROM audit_log WHERE action='event.duplicated' ORDER BY id DESC LIMIT 1");
  assert.ok(row, "no audit row for the duplication");
  const payload = JSON.parse(row.detail_json || "{}");
  assert.equal(payload.from, 30);
  assert.equal(payload.divisions, 3,
    "the audit row does not say how many divisions travelled — the number a director would check");
  void r;
  env.DB.close();
});
