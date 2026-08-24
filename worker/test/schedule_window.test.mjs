/**
 * Boomtown Platform — §-1r RF-14: the schedule window is an OVERLAP, not a starts_at slice
 * File: worker/test/schedule_window.test.mjs · Version: v1.0 · Date: 2026-08-24 · Ships in: v0.194.0
 *
 * Owner 2026-08-24: "On event schedule, does not list anything properly." MEASURED against live
 * (2026-08-24): the list window (today-7 → +180) returned ZERO events while a league was RUNNING
 * — TEST Thursday Coed 4s, starts_at 2026-08-12, ends_at 2026-10-07. The route filtered
 * `date(e.starts_at) BETWEEN ?1 AND ?2`, so a multi-week event vanished from the rolling list
 * the day its start aged past `from`, weeks before it finished. NOT the R3 stale-SW class and
 * NOT an RF-7 regression — the page code was fine; the window semantics were.
 *
 * THE RULE: an event is in window when its SPAN overlaps it —
 *   date(COALESCE(e.ends_at, e.starts_at)) >= from  AND  date(e.starts_at) <= to.
 * A one-day event (ends_at NULL or same-day) behaves exactly as before; the client list filter
 * makes the same judgement on the END (a running league is "current", not "past").
 *
 * Both directions asserted: the spanning league INCLUDED (the fix), the finished one-dayer
 * still EXCLUDED (a window that returns everything would pass a one-sided check).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO schedule_views (slug, name, kind, show_counts) VALUES ('public','Public','public',1)");
  /* the three shapes the window rule must separate, mirroring the live 2026-08-24 data:
     1 — a one-day tournament FINISHED before the window (must stay excluded),
     2 — a league SPANNING the window's start (the live defect: running, invisible),
     3 — a one-day tournament INSIDE the window (the case that always worked). */
  DB.exec("INSERT INTO events (id, org_id, type, name, status, starts_at, ends_at) VALUES " +
    "(1,1,'tournament','Finished Open','published','2026-08-20 09:00','2026-08-20 17:00')");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, starts_at, ends_at) VALUES " +
    "(2,1,'league','Running League','published','2026-08-12 18:00','2026-10-07 21:00')");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, starts_at, ends_at) VALUES " +
    "(3,1,'tournament','September Open','published','2026-09-15 09:00','2026-09-15 17:00')");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function schedule(env, from, to) {
  const res = await worker.fetch(new Request(
    `${ORIGIN}/api/schedule?view=public&from=${from}&to=${to}`,
    { headers: { Origin: ORIGIN } }), env);
  return { status: res.status, data: await res.json() };
}

test("RF-14 fixture control: the spanning league genuinely straddles the window start", () => {
  // An assertion the fixture CAN exhibit the defect (the impossible-assertion rule): the league
  // starts before the window and ends inside it, or the inclusion test below proves nothing.
  const env = boot();
  const row = env.DB.one("SELECT starts_at, ends_at FROM events WHERE id=2");
  assert.ok(row.starts_at < "2026-09-01", "league must start BEFORE the window's from");
  assert.ok(row.ends_at >= "2026-09-01", "league must still be running AT the window's from");
});

test("RF-14: a running multi-week league is IN the window its span overlaps", async () => {
  const env = boot();
  const r = await schedule(env, "2026-09-01", "2026-09-30");
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const names = (r.data.events || []).map((e) => e.name);
  assert.ok(names.includes("Running League"),
    "the league running through the window is missing — the live defect: a season vanished from " +
    "the list the day its start aged past `from` (starts_at-only windowing)");
  assert.ok(names.includes("September Open"), "the in-window one-dayer must still appear");
});

test("RF-14: a FINISHED event stays out — the overlap window still excludes the past", async () => {
  const env = boot();
  const r = await schedule(env, "2026-09-01", "2026-09-30");
  const names = (r.data.events || []).map((e) => e.name);
  assert.ok(!names.includes("Finished Open"),
    "an event that ended before `from` is back in the payload — the window stopped filtering");
});

test("RF-14: an event with NULL ends_at keeps the old one-day behavior (COALESCE arm)", async () => {
  const env = boot();
  env.DB.exec("UPDATE events SET ends_at = NULL WHERE id = 3");
  const r = await schedule(env, "2026-09-01", "2026-09-30");
  const names = (r.data.events || []).map((e) => e.name);
  assert.ok(names.includes("September Open"),
    "a NULL ends_at must fall back to starts_at, not drop the event");
  const r2 = await schedule(env, "2026-09-16", "2026-09-30");
  assert.ok(!(r2.data.events || []).map((e) => e.name).includes("September Open"),
    "with ends_at NULL, an event whose start passed is past — COALESCE must not immortalize it");
});

/* ── the client half: the member list's "current or upcoming" filter judges the END ── */

const SCHED_SRC = readFileSync(new URL("../../web/assets/schedule.js", import.meta.url), "utf8");
/* the one line that decides what the list calls current — pinned by its judgement, with the
   comment blanked so prose naming the fields cannot satisfy it */
const clientEndJudged = (src) =>
  /const future = upcoming\.filter\(e => new Date\(\(\(e\.ends_at \|\| e\.starts_at\) \|\| ""\)\.replace\(" ", "T"\)\) >= /
    .test(blankComments(src));

test("RF-14: the member list's future filter judges the event's END, not its start", () => {
  assert.ok(clientEndJudged(SCHED_SRC),
    "schedule.js's list filter is back to judging starts_at — a running league drops off the " +
    "list while a future event exists (the fallback only fires on an EMPTY future set)");
});

test("NC: the pre-fix starts_at-only spelling FAILS the client pin", () => {
  const mutated = blankComments(SCHED_SRC).replace(
    'const future = upcoming.filter(e => new Date(((e.ends_at || e.starts_at) || "").replace(" ", "T")) >= ',
    'const future = upcoming.filter(e => new Date((e.starts_at || "").replace(" ", "T")) >= ');
  assert.notEqual(mutated, blankComments(SCHED_SRC), "mutation did not land — NC is vacuous");
  assert.equal(clientEndJudged(mutated), false,
    "the verdict must reject the starts_at-only judgement — if it passes, the pin is blind");
});
