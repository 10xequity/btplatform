/**
 * Boomtown Platform — overnight bookings (D-57) + the batched importer (D-58)
 * File: worker/test/facility_overnight.test.mjs · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.200.0
 *
 * D-57 (owner 2026-08-25: "Go with midnight after with your recommendation"): a booking that
 * crosses midnight books as a LINKED PAIR split at midnight — first half ends at 24:00, second
 * half starts at 00:00 on the next date, both sharing a series_id (the weekly-series linkage,
 * so scope:"series" edits and deletes already treat the pair as one thing). His own 2026
 * Operations sheet carries several such rows ("Boomtown M | W 4s, 4 PM - 12 AM"; a wedding
 * reception to 2 AM) that the old end>start validation refused outright.
 *
 * D-58: importCsv issued one INSERT per booking plus one per court link plus per-row conflict
 * SELECTs — his 272-row sheet needed ~2,800 statements and the route 500'd mid-file at D1's
 * 1,000-queries-per-invocation cap, leaving a PARTIAL import. The write path is now ONE atomic
 * batch (explicit ids computed from MAX(id), multi-row VALUES chunks) over ONE preloaded
 * conflict window. The in-memory engine has no cap, so the pin here is the STATEMENT BUDGET,
 * counted by wrapping the real DB — a returned per-row loop blows the budget by an order of
 * magnitude and reddens immediately.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { splitOvernight } from "../src/facility.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/** Counting proxy: every prepared statement and every batch ENTRY costs one. */
function countingDB(db, counter) {
  return new Proxy(db, {
    get(t, k) {
      if (k === "prepare") return (sql) => { counter.statements++; return t.prepare(sql); };
      if (k === "batch") return (stmts) => { counter.statements += stmts.length; counter.batches++; return t.batch(stmts); };
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

function boot(counter = null) {
  const DB = createD1(SCHEMA, { foreignKeys: true });
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown Athletics','boomtown',1)");
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (10,'External / Rental','external-rental',1)");
  for (let i = 1; i <= 13; i++) DB.exec(`INSERT INTO spaces (id, name, kind) VALUES (${i}, 'VB ${i}', 'court')`);
  DB.exec("INSERT INTO space_presets (id, name) VALUES (2, 'Full Hardwood (VB 1–8)')");
  for (let i = 1; i <= 8; i++) DB.exec(`INSERT INTO preset_spaces (preset_id, space_id) VALUES (2, ${i})`);
  const db = counter ? countingDB(DB, counter) : DB;
  return { DB: db, raw: DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

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

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.raw.one("SELECT id FROM users WHERE email = 's@bt.test'");
  env.raw.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/* ═══════════ the split rule itself (pure) ═══════════ */

test("splitOvernight: a same-day slot passes through; past-midnight splits at 24:00/00:00", () => {
  assert.deepEqual(splitOvernight({ date: "2026-09-01", start_min: 600, end_min: 720 }),
    [{ date: "2026-09-01", start_min: 600, end_min: 720 }]);
  assert.deepEqual(splitOvernight({ date: "2026-09-01", start_min: 960, end_min: 120 }), [
    { date: "2026-09-01", start_min: 960, end_min: 1440 },
    { date: "2026-09-02", start_min: 0, end_min: 120 },
  ]);
  // ends exactly AT midnight: one half to 1440, no zero-length second row
  assert.deepEqual(splitOvernight({ date: "2026-09-01", start_min: 960, end_min: 0 }),
    [{ date: "2026-09-01", start_min: 960, end_min: 1440 }]);
  // the month boundary is a real date, not string arithmetic
  assert.deepEqual(splitOvernight({ date: "2026-08-31", start_min: 1200, end_min: 60 })[1].date, "2026-09-01");
});

/* ═══════════ D-57 through the real route ═══════════ */

test("an overnight create books a LINKED PAIR: two rows, consecutive dates, one series_id", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/facility/bookings", { token, body: {
    title: "Boomtown M | W 4s", date: "2026-09-01", start: "4 PM", end: "2 AM", space_ids: [1, 2],
  } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = env.raw.query("SELECT date, start_min, end_min, series_id FROM space_bookings ORDER BY date");
  assert.equal(rows.length, 2, "an overnight booking must land as a pair");
  assert.deepEqual([rows[0].date, rows[0].start_min, rows[0].end_min], ["2026-09-01", 960, 1440]);
  assert.deepEqual([rows[1].date, rows[1].start_min, rows[1].end_min], ["2026-09-02", 0, 120]);
  assert.ok(rows[0].series_id && rows[0].series_id === rows[1].series_id,
    "the pair must share a series_id — that is what makes scope:'series' treat it as one booking");
});

test("a booking ending exactly at midnight is ONE row to 24:00", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/facility/bookings", { token, body: {
    title: "Fours to midnight", date: "2026-09-01", start: "4 PM", end: "12 AM", space_ids: [1],
  } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rows = env.raw.query("SELECT start_min, end_min, series_id FROM space_bookings");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].end_min, 1440);
});

test("end equal to start is still refused, with the sentence that explains the overnight path", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/facility/bookings", { token, body: {
    title: "Zero-length", date: "2026-09-01", start: "4 PM", end: "4 PM", space_ids: [1],
  } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /past midnight|linked pair/i,
    "the refusal must tell the operator that past-midnight times are allowed and split");
});

test("a conflict on the SECOND half blocks the WHOLE pair — nothing half-written", async () => {
  const env = boot();
  const token = await staff(env);
  const first = await call(env, "POST", "/api/admin/facility/bookings", { token, body: {
    title: "Early shift", date: "2026-09-02", start: "12:30 am", end: "2 AM", space_ids: [1],
  } });
  assert.equal(first.status, 200);
  const r = await call(env, "POST", "/api/admin/facility/bookings", { token, body: {
    title: "Overnight fours", date: "2026-09-01", start: "4 PM", end: "2 AM", space_ids: [1],
  } });
  assert.equal(r.status, 409, "the second half collides at 00:30–02:00 and must refuse the pair");
  const n = env.raw.one("SELECT COUNT(*) AS n FROM space_bookings WHERE title = 'Overnight fours'").n;
  assert.equal(n, 0, "a refused pair must write NEITHER half");
});

test("the importer books an overnight row as the same linked pair", async () => {
  const env = boot();
  const token = await staff(env);
  const csv = "date,start,end,title,operator,spaces\n2026-09-05,8 PM,2 AM,\"Wedding reception\",External / Rental,\"Full Hardwood\"";
  const r = await call(env, "POST", "/api/admin/facility/import", { token, body: { csv, dry_run: false } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.imported, 1, "one CSV row = one imported booking, even when it lands as a pair");
  const rows = env.raw.query("SELECT date, start_min, end_min, series_id FROM space_bookings ORDER BY date");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].end_min, 1440);
  assert.deepEqual([rows[1].date, rows[1].start_min, rows[1].end_min], ["2026-09-06", 0, 120]);
  assert.ok(rows[0].series_id && rows[0].series_id === rows[1].series_id);
});

/* ═══════════ D-58 through the real route ═══════════ */

const bigCsv = (n) => {
  const lines = ["date,start,end,title,operator,spaces"];
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    const month = String(1 + (Math.floor(i / 28) % 12)).padStart(2, "0");
    const start = 6 + (i % 3) * 4;                       // 6 AM / 10 AM / 2 PM lanes
    lines.push(`2027-${month}-${day},${start}:00,${start + 3}:00,"Stress ${i}",External / Rental,"VB ${1 + (i % 13)}"`);
  }
  return lines.join("\n");
};

test("a season-sized import lands in ONE request, atomically, inside the statement budget", async () => {
  const counter = { statements: 0, batches: 0 };
  const env = boot(counter);
  const token = await staff(env);
  const before = counter.statements;
  const r = await call(env, "POST", "/api/admin/facility/import", { token, body: { csv: bigCsv(300), dry_run: false } });
  const spent = counter.statements - before;
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.imported, 300, "every valid row must land");
  assert.equal(env.raw.one("SELECT COUNT(*) AS n FROM space_bookings").n, 300);
  assert.equal(env.raw.one("SELECT COUNT(*) AS n FROM booking_spaces").n, 300);
  // The budget IS the pin: the old per-row loop spent ~2 statements per row on conflict reads
  // plus 1 per booking plus 1 per link (~1,800 on this file, and the proxy counts each batched
  // statement TWICE — once at prepare, once as a batch entry — so the old path would read
  // ~2,700 here). The batched path: 300 bookings/5-per-statement = 60 + 300 links/50 = 6, each
  // counted twice (132), plus a handful of reads ≈ 143. Chunks are sized to LIVE D1's
  // 100-bound-params-per-statement limit (MEASURED 2026-08-25: a 306-bind statement 500'd on
  // live while node's SQLite, limit 999, passed it in-process) — so the LOWER bound guards
  // against chunks quietly growing past what live accepts.
  assert.ok(counter.batches >= 1, "the write must go through env.DB.batch — that is the atomicity");
  assert.ok(spent <= 170, `the import spent ${spent} statements for 300 rows — the per-row loop is back`);
  assert.ok(spent >= 120, `only ${spent} statements — chunks grew past D1's 100-bind limit; that passes here and 500s on live`);
});

test("an intra-file duplicate still conflict-skips (the semantics the chunked live run relied on)", async () => {
  const env = boot();
  const token = await staff(env);
  const csv = "date,start,end,title,operator,spaces\n" +
    "2026-09-05,1 PM,3 PM,\"Karate\",External / Rental,\"VB 9\"\n" +
    "2026-09-05,1 PM,3 PM,\"Karate again\",External / Rental,\"VB 9\"";
  const r = await call(env, "POST", "/api/admin/facility/import", { token, body: { csv, dry_run: false } });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported, 1, "the second identical slot must not import");
  assert.ok((r.data.skipped || []).some((s) => /conflict/i.test(s.reason)),
    "and the skip must be REPORTED, not silent");
});

test("a dry run writes NOTHING and spends no write statements on the big file", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/facility/import", { token, body: { csv: bigCsv(300), dry_run: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported, 300, "dry run must still judge every row");
  assert.equal(env.raw.one("SELECT COUNT(*) AS n FROM space_bookings").n, 0);
});

test("NC: the counting proxy actually counts (positive control on a known flow)", async () => {
  const counter = { statements: 0, batches: 0 };
  const env = boot(counter);
  const before = counter.statements;
  await env.DB.prepare("SELECT 1").bind().first();
  await env.DB.batch([env.DB.prepare("SELECT 1"), env.DB.prepare("SELECT 2")]);
  // prepare ×3 (one direct + two inside the batch build) + batch entries ×2
  assert.equal(counter.statements - before, 5, "the proxy must count prepares and batch entries");
  assert.equal(counter.batches, 1);
});

test("update still refuses an overnight EDIT, and says how to get one", async () => {
  const env = boot();
  const token = await staff(env);
  const made = await call(env, "POST", "/api/admin/facility/bookings", { token, body: {
    title: "Evening", date: "2026-09-01", start: "6 PM", end: "9 PM", space_ids: [1],
  } });
  assert.equal(made.status, 200);
  const id = made.data.created[0].id;
  const r = await call(env, "PATCH", `/api/admin/facility/bookings/${id}`, { token, body: { end: "2 AM" } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /delete it and re-create|re-create/i,
    "the edit refusal must point at the sanctioned overnight path");
});
