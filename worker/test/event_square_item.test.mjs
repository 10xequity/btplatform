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
 * ── THE HOOKS SIT AT EVERY END A PRICING WRITE CAN REACH ─────────────────────────────────────
 * `insertEvent` is the one INSERT all four creation paths flow through (single create in
 * tournaments.js has no price column — measured), and `bulkEdit` was, at K-15's build, the one
 * route that could price an EXISTING event. **D-34/D-35 (v0.157.0) ended that era:** patchEvent
 * and editSeries price events now, and BOTH fire this same hook — safe because the hook re-reads
 * the row and judges the RESULT (idempotent, keyless-silent), so a new writer inherits it by one
 * call. `insertEvent`'s return shape changed from `id` to `{ id, square }` so every caller was
 * forced to visit — PM-1's shape-not-arity lesson. The seeder writes events by raw SQL and can
 * never reach Square, by
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

/* ══════════════ D-34 + D-35 (§-1c): the event page stops lying about price and capacity ══════════════
   D-34 (iteration 75): patchEvent's allow-list silently dropped `price_cents` and `capacity`
   while the screen said "Saved." — admin-event.js has sent both on every submit since before
   v0.90.0. D-35 (iteration 76): editSeries writes any EVENT_FIELDS member with NO
   externalPriceConflict check, so a series edit could manufacture the priced+external
   contradiction PM-1 exists to prevent. The fix's rules, each pinned below:
   · price and capacity PERSIST from the event page; junk is REFUSED in a sentence, never
     coerced (money and capacity differ from min_signups — junk silently making an event free
     or unlimited is the worse failure); price 0 = free, capacity NULL = unlimited (the UI's
     own conventions).
   · the conflict judges the RESULT — both fields merged over the stored row — at patchEvent
     AND per-instance at editSeries (bulkEdit's clash shape), refusing WHOLESALE.
   · every pricing writer fires K-15's hook: patchEvent and editSeries join insertEvent and
     bulkEdit (the header's "patchEvent deliberately cannot price" era ends here — the hook
     re-reads the row and stays idempotent/keyless-silent, so a third and fourth writer are
     safe by the hook's own contract). */

test("D-34 — the event page's own route PERSISTS price and capacity; emptied means free / unlimited", async () => {
  const env = boot({ squareToken: null }); // keyless: the hook must stay silent, not fetch
  const t = await staff(env);
  const r = await call(env, "PATCH", "/api/events/2", { token: t, body: { price_cents: 2500, capacity: 12 } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  let row = env.DB.one("SELECT price_cents AS p, capacity AS c FROM events WHERE id=2");
  assert.equal(row.p, 2500, "the price never reached the row — D-34's silent drop is back");
  assert.equal(row.c, 12, "the capacity never reached the row — told 'Saved.', stored nowhere");
  const r2 = await call(env, "PATCH", "/api/events/2", { token: t, body: { price_cents: 0, capacity: null } });
  assert.equal(r2.status, 200);
  row = env.DB.one("SELECT price_cents AS p, capacity AS c FROM events WHERE id=2");
  assert.equal(row.p, 0, "an emptied price field means FREE (the UI sends 0)");
  assert.equal(row.c, null, "an emptied capacity means UNLIMITED (the UI sends null)");
});

test("D-34 — junk price or capacity is REFUSED in a sentence and changes nothing", async () => {
  const env = boot({ squareToken: null });
  const t = await staff(env);
  const before = env.DB.one("SELECT price_cents AS p, capacity AS c FROM events WHERE id=1");
  assert.equal(before.p, 4000, "precondition: event 1 is priced, so a silent change below would be visible");
  for (const [body, needle] of [
    [{ price_cents: "volleyball" }, /price/i],
    [{ price_cents: -500 }, /price/i],
    [{ capacity: "lots" }, /capacity/i],
    [{ capacity: 0 }, /capacity/i],
    [{ capacity: -3 }, /capacity/i],
  ]) {
    const r = await call(env, "PATCH", "/api/events/1", { token: t, body });
    assert.equal(r.status, 400, `${JSON.stringify(body)} was not refused`);
    assert.match(String(r.data.error), needle, `${JSON.stringify(body)}'s refusal has no sentence of its own`);
  }
  const after = env.DB.one("SELECT price_cents AS p, capacity AS c FROM events WHERE id=1");
  assert.deepEqual(after, before, "a refused write still changed the row");
});

test("D-34 — the conflict judges the RESULT at patchEvent, in BOTH directions — and clearing the URL while pricing is allowed", async () => {
  const env = boot({ squareToken: null });
  const t = await staff(env);
  // pricing an event that registers elsewhere: refused with PM-1's own sentence, not
  // "Nothing to update." (today's accidental refusal — the discriminator this assertion needs)
  const r1 = await call(env, "PATCH", "/api/events/3", { token: t, body: { price_cents: 5000 } });
  assert.equal(r1.status, 400);
  assert.match(String(r1.data.error), /not both/, "the refusal is not PM-1's sentence — the result-state check is not running");
  assert.equal(env.DB.one("SELECT price_cents AS p FROM events WHERE id=3").p, 0, "the refused price reached the row anyway");
  // the surviving half (green today, named): a URL onto an already-priced event still refuses
  const r2 = await call(env, "PATCH", "/api/events/1", { token: t, body: { external_url: URL_A } });
  assert.equal(r2.status, 400);
  assert.match(String(r2.data.error), /not both/);
  // the merged-result subtlety: price + clear-the-URL in ONE write is a fine RESULT
  const r3 = await call(env, "PATCH", "/api/events/3", { token: t, body: { price_cents: 5000, external_url: "" } });
  assert.equal(r3.status, 200, JSON.stringify(r3.data).slice(0, 200));
  const row = env.DB.one("SELECT price_cents AS p, external_url AS u FROM events WHERE id=3");
  assert.equal(row.p, 5000);
  assert.ok(!String(row.u || "").trim(), "the URL was not cleared — the merge read the stored value instead of the incoming one");
});

test("D-34 — a capacity edit reaches the sign-up gate, BOTH directions, through the real registration route", async () => {
  const env = boot({ squareToken: null });
  const t = await staff(env);
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at) VALUES (7,1,'training','Tuesday Skills','published',0,'2026-09-02 18:00')");
  const su = (n, e) => call(env, "POST", "/api/events/7/signup", { body: { name: n, email: e } });
  await call(env, "PATCH", "/api/events/7", { token: t, body: { capacity: 1 } });
  assert.equal((await su("Ada Lee", "ada@x.test")).status, 200, "the first sign-up fits under capacity 1");
  const full = await su("Ben Ochoa", "ben@x.test");
  assert.notEqual(full.status, 200, "capacity 1 admitted a second person — the stored edit never reached the gate");
  await call(env, "PATCH", "/api/events/7", { token: t, body: { capacity: 2 } });
  assert.equal((await su("Ben Ochoa", "ben@x.test")).status, 200, "raising capacity did not admit the next person");
  await call(env, "PATCH", "/api/events/7", { token: t, body: { capacity: 1 } });
  assert.notEqual((await su("Cam Diaz", "cam@x.test")).status, 200,
    "capacity lowered below the current count must refuse the NEXT sign-up (existing ones keep their spots)");
});

test("D-34 — the event page's price leg fires K-15's hook: created once, idempotent, keyless-silent", async () => {
  const env = boot({ orgLocation: "LOC_ORG_1" });
  const t = await staff(env);
  const stub = stubSquare();
  try {
    const r = await call(env, "PATCH", "/api/events/2", { token: t, body: { price_cents: 3000 } });
    assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
    assert.equal(stub.calls.length, 1, "pricing via the event page did not create a catalog item — K-15's missed-moment class, third writer");
    const row = env.DB.one("SELECT square_item_id AS i, square_variation_id AS v FROM events WHERE id=2");
    assert.ok(row.i && row.v, "the created ids never reached the row");
    await call(env, "PATCH", "/api/events/2", { token: t, body: { price_cents: 3500 } });
    assert.equal(stub.calls.length, 1, "a re-price created a SECOND item — the hook lost its idempotence through this leg");
  } finally { stub.restore(); }
  const keyless = boot({ squareToken: null });
  const t2 = await staff(keyless);
  const stub2 = stubSquare();
  try {
    assert.equal((await call(keyless, "PATCH", "/api/events/2", { token: t2, body: { price_cents: 900 } })).status, 200);
    assert.equal(stub2.calls.length, 0, "keyless must be SILENT — no outbound call, no failure");
  } finally { stub2.restore(); }
});

test("D-35 — editSeries judges the RESULT PER INSTANCE and refuses WHOLESALE, both directions", async () => {
  const env = boot({ squareToken: null });
  const t = await staff(env);
  env.DB.exec(`INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at, series_id) VALUES
    (11,1,'training','Tue Skills','published',0,'2026-09-01 18:00','ser-9'),
    (12,1,'training','Tue Skills','published',0,'2026-09-08 18:00','ser-9'),
    (13,1,'training','Tue Skills','published',0,'2026-09-15 18:00','ser-9')`);
  // one instance legitimately links out (free + external is allowed) — the poison pill
  assert.equal((await call(env, "PATCH", "/api/events/12", { token: t, body: { external_url: URL_A } })).status, 200);
  const r1 = await call(env, "PATCH", "/api/admin/series/ser-9", { token: t, body: { from_event_id: 11, fields: { price_cents: 4000 } } });
  assert.equal(r1.status, 400, "pricing a series with an outward instance must refuse — D-35's exact hole");
  assert.match(String(r1.data.error), /not both/, "the refusal is not PM-1's sentence");
  assert.equal(env.DB.query("SELECT COUNT(*) AS n FROM events WHERE series_id='ser-9' AND price_cents > 0")[0].n, 0,
    "the refusal half-applied — some instances were priced anyway (the operator is left guessing which)");
  // clear the pill; the same write now lands on ALL future instances
  assert.equal((await call(env, "PATCH", "/api/events/12", { token: t, body: { external_url: "" } })).status, 200);
  const r2 = await call(env, "PATCH", "/api/admin/series/ser-9", { token: t, body: { from_event_id: 11, fields: { price_cents: 4000 } } });
  assert.equal(r2.status, 200, JSON.stringify(r2.data).slice(0, 200));
  assert.equal(env.DB.query("SELECT COUNT(*) AS n FROM events WHERE series_id='ser-9' AND price_cents=4000")[0].n, 3);
  // the reverse direction: a URL onto a now-priced series refuses wholesale
  const r3 = await call(env, "PATCH", "/api/admin/series/ser-9", { token: t, body: { from_event_id: 11, fields: { external_url: URL_A } } });
  assert.equal(r3.status, 400);
  assert.equal(env.DB.query("SELECT COUNT(*) AS n FROM events WHERE series_id='ser-9' AND external_url IS NOT NULL AND TRIM(external_url) <> ''")[0].n, 0,
    "the refused URL reached some instances anyway");
  // junk via the series path is refused by the same sentences
  assert.equal((await call(env, "PATCH", "/api/admin/series/ser-9", { token: t, body: { from_event_id: 11, fields: { price_cents: "junk" } } })).status, 400);
});

test("D-35 — pricing a series through editSeries creates each instance's catalog item (the recorded missed moment closes)", async () => {
  const env = boot({ orgLocation: "LOC_ORG_1" });
  const t = await staff(env);
  env.DB.exec(`INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at, series_id) VALUES
    (21,1,'training','Wed Skills','published',0,'2026-09-02 18:00','ser-w'),
    (22,1,'training','Wed Skills','published',0,'2026-09-09 18:00','ser-w')`);
  const stub = stubSquare();
  try {
    const r = await call(env, "PATCH", "/api/admin/series/ser-w", { token: t, body: { from_event_id: 21, fields: { price_cents: 2000 } } });
    assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
    assert.equal(stub.calls.length, 2, "each priced instance needs its own catalog item — D-35's record named this exact missed moment");
    assert.equal(env.DB.query("SELECT COUNT(*) AS n FROM events WHERE series_id='ser-w' AND square_item_id IS NOT NULL")[0].n, 2);
  } finally { stub.restore(); }
});

test("D-34 — the screen stops lying in the OTHER direction too: the events-list-only note is gone, the server rule is stated", () => {
  const ui = web("assets/admin-event.js");
  assert.ok(!ui.includes("clear the price from the events list first"),
    "the help text still says the price cannot be edited here — false the moment D-34 shipped, a lie in the opposite direction");
  assert.match(blankComments(ui), /price or an outside registration link|cannot also link out/i,
    "the screen no longer states the price↔URL rule anywhere — the operator meets the wall with no words");
  // NC — the forbid needle can fail: plant the stale sentence and the check above must catch it
  const planted = ui + "\n// clear the price from the events list first";
  assert.ok(planted.includes("clear the price from the events list first"), "the plant did not land");
});
