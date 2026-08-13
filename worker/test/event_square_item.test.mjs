/**
 * Boomtown Platform — K-15: a priced event gets a Square catalog item
 * File: worker/test/event_square_item.test.mjs · Version: v1.0 · Date: 2026-08-13
 * Ships in: v0.148.0 · roadmap §-1m K-15 (owner 2026-08-11, Q5 rider 2), §-0 B22
 *
 * Owner: *"Ensure the square API has ability to write and create items in square under the
 * appropriate organization and then name the item correctly."* The write machinery existed
 * (memberships.js's `sq()` creates SUBSCRIPTION_PLAN objects); what did not exist was a catalog
 * ITEM for an event. `ensureEventSquareItem` (memberships.js, beside its plan sibling) creates
 * one ITEM with one ITEM_VARIATION carrying the price, named `<event name> — <date>`, scoped to
 * `present_at_location_ids = [orgs.square_location_id || env.SQUARE_LOCATION_ID]` — the exact
 * location fallback registrations.js's payment links have always used, under the ONE platform
 * token every Square call in this repo already uses (the credential decision, stated: per-org
 * tokens have no infrastructure anywhere in this codebase; per-org LOCATIONS do).
 *
 * ── THE HOOKS SIT AT THE TWO ENDS A PRICING WRITE CANNOT BYPASS ───────────────────────────────
 * `insertEvent` is the one INSERT all four creation paths flow through (single create in
 * tournaments.js has no price column — measured), and `bulkEdit` is the one route that can price
 * an EXISTING event (tournaments.js's patchEvent deliberately cannot). `insertEvent`'s return
 * shape changed from `id` to `{ id, square }` so every caller was forced to visit — PM-1's
 * shape-not-arity lesson. The seeder writes events by raw SQL and can never reach Square, by
 * construction. (`editSeries` can also price a series and does NOT create items — recorded in
 * §-1c beside its missing externalPriceConflict check; the retry is a bulk reprice, the plans
 * module's own "edit + save to retry" pattern.)
 *
 * ── ENSURE READS THE RESULT, REFUSES AT THE DESTINATION, AND IS SILENT WHEN NOTHING IS LOST ──
 * It re-reads the row (result state, never the request — PM-1 rule 3's lesson), refuses an
 * external event even though routes make priced+external unwriteable (this file manufactures the
 * contradiction by raw SQL precisely because routes refuse it), skips an already-itemed event
 * (idempotent), and — deliberately unlike createPlan — says NOTHING when SQUARE_ACCESS_TOKEN is
 * unset: a plan without Square cannot be subscribed to, but an event without a catalog item
 * loses no function (payment links are quick_pay). A nag on every priced save in a system where
 * Square is not switched on would train the operator to ignore warnings.
 *
 * ── THIS SUITE'S FIRST OUTBOUND-FETCH CAPTURE ─────────────────────────────────────────────────
 * No test had ever set SQUARE_ACCESS_TOKEN or stubbed fetch (measured 2026-08-13, positive-
 * controlled). The stub below captures every outbound call the worker makes and answers with a
 * canned Square catalog response — which also lets the guard pin the SANDBOX host: with
 * SQUARE_ENV unset, every captured URL must be connect.squareupsandbox.com (standing rule 1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const SRC = new URL("../src/", import.meta.url);
const WEB = new URL("../../web/", import.meta.url);
const src = (f) => readFileSync(new URL(f, SRC), "utf8");
const web = (f) => readFileSync(new URL(f, WEB), "utf8");
const ORIGIN = "https://boomtown.test";
const URL_A = "https://volleyballlife.com/tournaments/1234";

/** orgLocation: orgs.square_location_id for org 1 (null = unset, the live state on all 6 orgs). */
function boot({ orgLocation = null, squareToken = "tok_test", platformLocation = "LOC_PLATFORM" } = {}) {
  const DB = createD1(SCHEMA);
  DB.exec(`INSERT INTO orgs (id, name, slug, active, square_location_id) VALUES (1,'Boomtown','boomtown',1,${orgLocation ? `'${orgLocation}'` : "NULL"})`);
  // One PRICED event, one FREE, and one EXTERNAL — every refusal below needs its allowed twin in
  // the same fixture or it can only be tested from one side (external_registration.test.mjs's
  // rule). starts_at is TEXT and asserted verbatim, so no Date parsing can shift it by timezone.
  DB.exec("INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at) VALUES (1,1,'tournament','Paid Open','published',4000,'2026-09-01 09:00')");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at) VALUES (2,1,'tournament','Free Jam','published',0,'2026-09-08 09:00')");
  DB.exec(`INSERT INTO events (id, org_id, type, name, status, price_cents, external_url, starts_at) VALUES (3,1,'tournament','Elsewhere Cup','published',0,'${URL_A}','2026-09-15 09:00')`);
  const env = { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
  if (squareToken) env.SQUARE_ACCESS_TOKEN = squareToken;
  if (platformLocation) env.SQUARE_LOCATION_ID = platformLocation;
  return env;
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
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

/** Captures every OUTBOUND fetch the worker makes and answers as Square would. Restore in
 *  finally, always — a leaked stub would swallow the next test's traffic. */
function stubSquare() {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const n = calls.length + 1;
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
    return new Response(JSON.stringify({
      catalog_object: { id: `SQ_ITEM_${n}`, item_data: { variations: [{ id: `SQ_VAR_${n}` }] } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

/* ══════════════ 0. the fixture can exhibit every side of the rule ══════════════ */

test("K-15 — the fixture holds a priced, a free and an external event, or the refusals below have no allowed twin", () => {
  const env = boot();
  assert.ok(env.DB.one("SELECT price_cents AS p FROM events WHERE id=1").p > 0, "event 1 must be priced");
  assert.equal(env.DB.one("SELECT price_cents AS p FROM events WHERE id=2").p, 0, "event 2 must be free");
  assert.ok(env.DB.one("SELECT external_url AS u FROM events WHERE id=3").u, "event 3 must register elsewhere");
});

/* ══════════════ 1. pricing an existing event creates the item — named, scoped, sandboxed ══════════════ */

test("K-15 — bulk-pricing a free event creates ONE catalog ITEM: event-named + dated, priced, on the ORG's location, on the SANDBOX host, ids stored, note returned", async () => {
  const env = boot({ orgLocation: "LOC_ORG_1" });
  const token = await staff(env);
  const sq = stubSquare();
  try {
    const r = await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 2500 } } });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(sq.calls.length, 1, "exactly one Square call for one repriced event");
    const c = sq.calls[0];
    assert.ok(c.url.startsWith("https://connect.squareupsandbox.com/v2/catalog/object"),
      `SANDBOX host, standing rule 1 — got ${c.url}`);
    assert.equal(c.body.object.type, "ITEM");
    assert.equal(c.body.object.item_data.name, "Free Jam — 2026-09-08", "named from the event, dated");
    assert.deepEqual(c.body.object.present_at_location_ids, ["LOC_ORG_1"],
      "the ORG's location wins over the platform fallback — the 'appropriate organization' half");
    const v = c.body.object.item_data.variations[0];
    assert.equal(v.item_variation_data.price_money.amount, 2500, "the variation carries the price");
    const row = env.DB.one("SELECT square_item_id AS i, square_variation_id AS v FROM events WHERE id=2");
    assert.equal(row.i, "SQ_ITEM_1");
    assert.equal(row.v, "SQ_VAR_1");
    assert.match(String(r.data.square_note || ""), /created 1 catalog item/i, "the operator hears what happened");
  } finally { sq.restore(); }
});

test("K-15 — org location NULL (the live state on all 6 orgs) falls back to env.SQUARE_LOCATION_ID, exactly as payment links do", async () => {
  const env = boot({ orgLocation: null });
  const token = await staff(env);
  const sq = stubSquare();
  try {
    await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 2500 } } });
    assert.equal(sq.calls.length, 1);
    assert.deepEqual(sq.calls[0].body.object.present_at_location_ids, ["LOC_PLATFORM"]);
  } finally { sq.restore(); }
});

/* ══════════════ 2. the never cases — and each one's allowed twin is test 1 ══════════════ */

test("K-15 — an EXTERNAL event never gets an item, even when the priced+external contradiction is manufactured by raw SQL (routes refuse it; the destination must too)", async () => {
  const env = boot();
  // The state PM-1 makes unwriteable through every route — which is exactly why the guard has to
  // build it by hand: if ensure() only ever saw route-legal rows, this check could rot unnoticed.
  env.DB.exec("UPDATE events SET price_cents=5000 WHERE id=3");
  assert.equal(env.DB.one("SELECT price_cents AS p FROM events WHERE id=3").p, 5000, "the contradiction landed");
  const { ensureEventSquareItem } = await import("../src/memberships.js");
  assert.equal(typeof ensureEventSquareItem, "function", "memberships.js exports the writer");
  const sq = stubSquare();
  try {
    const out = await ensureEventSquareItem(env, 3);
    assert.equal(out.skipped, "external");
    assert.equal(sq.calls.length, 0, "no Square call for an event that registers elsewhere");
    const row = env.DB.one("SELECT square_item_id AS i FROM events WHERE id=3");
    assert.equal(row.i, null);
  } finally { sq.restore(); }
});

test("K-15 — an UNPRICED write makes no Square call (green by design pre-build: its positive control is test 1's captured call)", async () => {
  const env = boot();
  const token = await staff(env);
  const sq = stubSquare();
  try {
    const r = await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { location: "Court 9" } } });
    assert.equal(r.data.ok, true);
    assert.equal(sq.calls.length, 0);
  } finally { sq.restore(); }
});

test("K-15 — no SQUARE_ACCESS_TOKEN: the price saves, no Square call, and NO note — deliberately quieter than createPlan, because nothing is lost (green by design pre-build: pins the behaviour that must survive)", async () => {
  const env = boot({ squareToken: null });
  const token = await staff(env);
  const sq = stubSquare();
  try {
    const r = await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 2500 } } });
    assert.equal(r.data.ok, true);
    assert.equal(env.DB.one("SELECT price_cents AS p FROM events WHERE id=2").p, 2500, "the local save is never hostage to Square");
    assert.equal(sq.calls.length, 0);
    assert.equal(r.data.square_note, undefined);
  } finally { sq.restore(); }
});

test("K-15 — token set but NO location anywhere: the price saves, no ids, and the note says why", async () => {
  const env = boot({ orgLocation: null, platformLocation: null });
  const token = await staff(env);
  const sq = stubSquare();
  try {
    const r = await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 2500 } } });
    assert.equal(r.data.ok, true);
    assert.equal(sq.calls.length, 0);
    assert.equal(env.DB.one("SELECT square_item_id AS i FROM events WHERE id=2").i, null);
    assert.match(String(r.data.square_note || ""), /location/i, "the operator hears what did not happen and why");
  } finally { sq.restore(); }
});

/* ══════════════ 3. idempotence — the write happens once ══════════════ */

test("K-15 — repricing the same event twice makes exactly ONE Square call: the stored item id is the memory", async () => {
  const env = boot();
  const token = await staff(env);
  const sq = stubSquare();
  try {
    await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 2500 } } });
    await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 3000 } } });
    assert.equal(sq.calls.length, 1, "the second pricing write found square_item_id and skipped");
    assert.equal(env.DB.one("SELECT price_cents AS p FROM events WHERE id=2").p, 3000, "the price itself still moved");
  } finally { sq.restore(); }
});

/* ══════════════ 4. the creation choke point — every insertEvent path is covered ══════════════ */

test("K-15 — duplicating a priced event creates an item for the COPY, named as the copy", async () => {
  const env = boot();
  const token = await staff(env);
  const sq = stubSquare();
  try {
    const r = await call(env, "POST", "/api/events/1/duplicate", { token, body: {} });
    assert.equal(r.data.ok, true);
    assert.equal(sq.calls.length, 1);
    assert.equal(sq.calls[0].body.object.item_data.name, "Paid Open (copy) — 2026-09-01");
    const row = env.DB.one(`SELECT square_item_id AS i FROM events WHERE id=${r.data.id}`);
    assert.equal(row.i, "SQ_ITEM_1");
  } finally { sq.restore(); }
});

test("K-15 — a priced recurring series creates one item per session, and the DATE suffix is what tells them apart", async () => {
  const env = boot();
  const token = await staff(env);
  const sq = stubSquare();
  try {
    const r = await call(env, "POST", "/api/admin/events/recurring", { token, body: {
      base: { name: "Tuesday League", type: "league", starts_at: "2026-09-01 18:00", price_cents: 1500 },
      rule: { freq: "weekly", count: 3 },
    } });
    assert.equal(r.data.ok, true);
    assert.equal(r.data.count, 3);
    assert.equal(sq.calls.length, 3, "one item per session");
    const names = sq.calls.map((c) => c.body.object.item_data.name);
    for (const n of names) assert.match(n, /^Tuesday League — 2026-09-\d\d$/, `dated name, got ${n}`);
    assert.equal(new Set(names).size, 3, "three sessions, three distinct names — same-named items would be indistinguishable in the catalog");
    assert.match(String(r.data.square_note || ""), /created 3 catalog items/i);
  } finally { sq.restore(); }
});

/* ══════════════ 5. the way in is pinned — real bytes, comments stripped, NC mutates the input ══════════════ */

test("K-15 — the wiring exists at every layer: index.js injects it, events_admin destructures it, and BOTH hooks contain the call (containment, not adjacency)", () => {
  const indexSrc = blankComments(src("index.js"));
  const adminSrc = blankComments(src("events_admin.js"));
  const memberSrc = blankComments(src("memberships.js"));

  assert.match(memberSrc, /export async function ensureEventSquareItem/, "memberships.js exports the writer");
  assert.match(indexSrc, /wireEventsAdmin\(\{[^)]*ensureEventSquareItem/, "index.js passes it in the wiring bag");

  const wireBody = functionBodyAfter(adminSrc, "export function wireEventsAdmin");
  assert.ok(wireBody && wireBody.includes("ensureEventSquareItem"), "wireEventsAdmin destructures it");

  const insertBody = functionBodyAfter(adminSrc, "async function insertEvent");
  assert.ok(insertBody && insertBody.includes("ensureEventSquareItem("), "insertEvent calls it — the creation choke point");

  const bulkBody = functionBodyAfter(adminSrc, "async function bulkEdit");
  assert.ok(bulkBody && bulkBody.includes("ensureEventSquareItem("), "bulkEdit calls it — the one existing-event pricing route");

  // NC: mutate the real input — strip the needle from insertEvent's body and the containment
  // check must go dark. Asserting the mutation landed first, so a needle that was never there
  // cannot pass this by absence.
  assert.ok(insertBody.includes("ensureEventSquareItem("), "pre-mutation: needle present");
  const mutated = adminSrc.replace(/ensureEventSquareItem/g, "XXX_GONE_XXX");
  assert.ok(!mutated.includes("ensureEventSquareItem"), "the mutation landed");
  const mutatedBody = functionBodyAfter(mutated, "async function insertEvent");
  assert.ok(!(mutatedBody || "").includes("ensureEventSquareItem("), "and the containment check goes dark without it");
});

test("K-15 — the note reaches a human: both admin screens render square_note (a payload field nobody renders is a success nobody can check)", () => {
  const eventsUi = blankComments(web("assets/admin-events.js"));
  const eventUi = blankComments(web("assets/admin-event.js"));
  const bulkHits = (eventsUi.match(/square_note/g) || []).length;
  assert.ok(bulkHits >= 3, `admin-events.js renders it for bulk edit, import AND recurring — expected ≥3 mentions, saw ${bulkHits}`);
  assert.ok(eventUi.includes("square_note"), "admin-event.js surfaces a duplicate's warning");
  // NC for the stripper: a square_note that lives only in a comment must not count.
  const commented = "/* square_note */ const x = 1;";
  assert.ok(!blankComments(commented).includes("square_note"), "blankComments removes commented mentions — the counter counts code");
});
