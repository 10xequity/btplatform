/**
 * Boomtown Platform — prizes.js (prize inventory, receipts, awards) — v0.213.0
 * File: worker/test/prizes.test.mjs · Version: v1.0 · Date: 2026-10-12 · Ships in: v0.213.0
 *
 * Route-level through the real router against the real schema (journey harness), plus the two
 * pure functions. What is pinned, in order: the module is MOUNTED (failure class 1); stock is a
 * SUM and moves on void; an award that exceeds stock is refused with the on-hand number in the
 * sentence; an email-sourced receipt cannot be logged twice; finishers come off the bracket
 * (1st = final's winner, 2nd = its loser, 3rd = the semi losers) and fall back to standings; a
 * cash-only award needs no stock; and a member (non-staff) reaches nothing. Each guard has a
 * negative control where the guard could be vacuous.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { finishersFrom, stockRefusal } from "../src/prizes.js";
import { winnerOf } from "../src/brackets.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function makeEnv() {
  const DB = createD1(SCHEMA);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN };
}
async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}
const expectStatus = (r, want, what) => assert.equal(r.status, want, `${what}: expected ${want}, got ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);

async function signIn(env, email, role) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const token = String(asked.data.dev_link).split("token=")[1];
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  if (role) {
    const u = env.DB.one("SELECT id FROM users WHERE email = ?1", email);
    env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, '${role}')
      ON CONFLICT(user_id, org_id) DO UPDATE SET role='${role}', deleted_at=NULL`);
  }
  return verified.data.token;
}

/** An org, a tournament with 4 teams, and a played A bracket: semis 1v4, 2v3; final 1v2 → team 1 wins. */
async function seed(env, { playFinal = true } = {}) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (2, 'Other Org', 'other', 1);
    INSERT INTO events (id, org_id, type, name, status, court_count, starts_at)
      VALUES (7, 1, 'tournament', 'Showdown', 'in_progress', 4, datetime('now','-1 day'));
    INSERT INTO teams (id, org_id, event_id, name) VALUES (1,1,7,'Aces'),(2,1,7,'Blockers'),(3,1,7,'Diggers'),(4,1,7,'Setters');
    INSERT INTO brackets (id, org_id, event_id, name) VALUES (10, 1, 7, 'A');
    INSERT INTO matches (id, org_id, event_id, bracket_id, bracket_round, bracket_slot, team_a_id, team_b_id, score_a, score_b, round, court)
      VALUES (101,1,7,10,2,1,1,4,25,18,1,1),(102,1,7,10,2,2,2,3,25,20,1,2),
             (103,1,7,10,1,1,1,2,${playFinal ? "25,22" : "NULL,NULL"},2,1);
  `);
  return signIn(env, "ops@boomtown.test", "admin");
}

/* ───────────── failure class 1: built, tested, and uncalled ───────────── */

test("prizes.js is imported, wired with BOTH module keys, and sits in the dispatch table — from source", () => {
  assert.match(INDEX, /import \{ prizesRoutes, wirePrizes \} from "\.\/prizes\.js"/, "not imported");
  assert.match(INDEX, /wirePrizes\(\{ \.\.\.wiredHelpers, requireStaff: staffGateFor\("tournaments", "pos"\) \}\)/, "not wired to the two owners");
  assert.match(INDEX, /\["prizes",\s+prizesRoutes\]/, "not in the dispatch table");
});

test("NC — the dispatch-table detector can fail", () => {
  assert.doesNotMatch(INDEX.replace(/\["prizes",\s+prizesRoutes\]/, ""), /\["prizes",\s+prizesRoutes\]/);
});

/* ───────────── pure: finishers ───────────── */

test("finishersFrom: 1st is the final's winner, 2nd its loser, 3rd both semi losers; unplayed final → nobody finished", () => {
  const rows = [
    { bracket_name: "A", bracket_round: 2, team_a_id: 1, team_b_id: 4, team_a: "Aces", team_b: "Setters", score_a: 25, score_b: 18 },
    { bracket_name: "A", bracket_round: 2, team_a_id: 2, team_b_id: 3, team_a: "Blockers", team_b: "Diggers", score_a: 20, score_b: 25 },
    { bracket_name: "A", bracket_round: 1, team_a_id: 1, team_b_id: 3, team_a: "Aces", team_b: "Diggers", score_a: 23, score_b: 25 },
  ];
  const f = finishersFrom(rows, winnerOf);
  assert.deepEqual(f.map((x) => [x.place, x.team]), [[1, "Diggers"], [2, "Aces"], [3, "Setters"], [3, "Blockers"]]);
  const unplayed = finishersFrom(rows.map((r) => (r.bracket_round === 1 ? { ...r, score_a: null, score_b: null } : r)), winnerOf);
  assert.deepEqual(unplayed.map((x) => x.place), [3, 3], "an unplayed final has no 1st or 2nd yet — only the semi losers are settled");
});

test("finishersFrom: a tie is not a result (the two-point rule is brackets.js's, reused not re-typed)", () => {
  const f = finishersFrom([{ bracket_name: "A", bracket_round: 1, team_a_id: 1, team_b_id: 2, team_a: "x", team_b: "y", score_a: 24, score_b: 24 }], winnerOf);
  assert.equal(f.length, 0);
});

test("stockRefusal: fits → null; short → names the number; none → says so", () => {
  assert.equal(stockRefusal("Medal", 5, 5), null);
  assert.match(stockRefusal("Medal", 2, 3), /Only 2 of "Medal" on hand; this award asks for 3/);
  assert.match(stockRefusal("Medal", 0, 1), /none of "Medal" on hand/);
});

/* ───────────── routes: inventory arithmetic ───────────── */

test("stock is a sum: a receipt adds, an award subtracts, a voided award restores, a voided receipt removes", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const rc = await call(env, "POST", "/api/admin/prizes/receipts", { token, body: {
    vendor: "Trophy Depot", invoice_no: "INV-1", invoice_date: "2026-10-01", total_cents: 12000,
    lines: [{ name: "Gold medal", qty: 10, unit_cost_cents: 800 }, { name: "T-shirt", qty: 20 }],
  } });
  expectStatus(rc, 200, "receipt");
  assert.equal(rc.data.lines, 2);
  let items = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items;
  const medal = items.find((i) => i.name === "Gold medal");
  assert.equal(medal.on_hand, 10);
  assert.equal(medal.unit_cost_cents, 800, "a priced line sets the item's last known cost");

  const aw = await call(env, "POST", "/api/admin/prizes/awards", { token, body: { event_id: 7, team_id: 1, place: 1, bracket_name: "A", item_id: medal.id, qty: 4 } });
  expectStatus(aw, 200, "award");
  items = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items;
  assert.equal(items.find((i) => i.id === medal.id).on_hand, 6);

  expectStatus(await call(env, "POST", `/api/admin/prizes/awards/${aw.data.id}/void`, { token }), 200, "void award");
  items = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items;
  assert.equal(items.find((i) => i.id === medal.id).on_hand, 10, "voiding the award gave the medals back");

  expectStatus(await call(env, "POST", `/api/admin/prizes/receipts/${rc.data.id}/void`, { token }), 200, "void receipt");
  items = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items;
  assert.equal(items.find((i) => i.id === medal.id).on_hand, 0, "voiding the receipt took them away again");
  expectStatus(await call(env, "POST", `/api/admin/prizes/receipts/${rc.data.id}/void`, { token }), 404, "a second void is a 404, not a silent no-op");
});

test("a receipt line naming an existing item (any case) reuses it rather than creating a twin", async () => {
  const env = makeEnv();
  const token = await seed(env);
  await call(env, "POST", "/api/admin/prizes/receipts", { token, body: { vendor: "A", lines: [{ name: "Medal", qty: 1 }] } });
  await call(env, "POST", "/api/admin/prizes/receipts", { token, body: { vendor: "B", lines: [{ name: "medal", qty: 2 }] } });
  const items = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items;
  assert.equal(items.length, 1);
  assert.equal(items[0].on_hand, 3);
});

test("an award beyond stock is refused with the on-hand count, and writes nothing", async () => {
  const env = makeEnv();
  const token = await seed(env);
  await call(env, "POST", "/api/admin/prizes/receipts", { token, body: { vendor: "A", lines: [{ name: "Medal", qty: 2 }] } });
  const medal = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items[0];
  const r = await call(env, "POST", "/api/admin/prizes/awards", { token, body: { event_id: 7, team_id: 1, item_id: medal.id, qty: 3 } });
  expectStatus(r, 409, "over-award");
  assert.match(r.data.error, /Only 2 of "Medal" on hand; this award asks for 3/);
  assert.equal(env.DB.query("SELECT COUNT(*) AS n FROM prize_awards")[0].n, 0);
  // NC — the same body with qty 2 goes through, so the refusal is the stock check and not something upstream.
  expectStatus(await call(env, "POST", "/api/admin/prizes/awards", { token, body: { event_id: 7, team_id: 1, item_id: medal.id, qty: 2 } }), 200, "exact fit");
});

test("a cash-only award needs no item and no stock; an empty award is refused", async () => {
  const env = makeEnv();
  const token = await seed(env);
  expectStatus(await call(env, "POST", "/api/admin/prizes/awards", { token, body: { event_id: 7, team_id: 2, place: 2, cash_cents: 150000 } }), 200, "cash award");
  expectStatus(await call(env, "POST", "/api/admin/prizes/awards", { token, body: { event_id: 7, team_id: 2 } }), 400, "nothing awarded");
  expectStatus(await call(env, "POST", "/api/admin/prizes/awards", { token, body: { event_id: 7, cash_cents: 100 } }), 400, "nobody to award");
  const sheet = (await call(env, "GET", "/api/admin/events/7/prizes", { token })).data;
  assert.equal(sheet.cash_total_cents, 150000);
  assert.equal(sheet.awards[0].recipient, "Blockers", "the team name is snapshotted as the recipient");
});

test("an email-sourced receipt is logged once: the second POST with the same message id is a 409 naming the first", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const body = { vendor: "Crown Awards", invoice_no: "88", source: "email", email_message_id: "1a0fe691cb0e8653", lines: [{ name: "Plaque", qty: 3 }] };
  const first = await call(env, "POST", "/api/admin/prizes/receipts", { token, body });
  expectStatus(first, 200, "first");
  const again = await call(env, "POST", "/api/admin/prizes/receipts", { token, body });
  expectStatus(again, 409, "duplicate");
  assert.match(again.data.error, new RegExp(`receipt #${first.data.id} \\(Crown Awards 88\\)`));
  assert.equal(env.DB.query("SELECT COUNT(*) AS n FROM prize_receipts")[0].n, 1);
  // NC — a manual receipt (no message id) can be logged twice; the dedupe is scoped to email.
  const manual = { vendor: "Crown Awards", lines: [{ name: "Plaque", qty: 1 }] };
  expectStatus(await call(env, "POST", "/api/admin/prizes/receipts", { token, body: manual }), 200, "manual 1");
  expectStatus(await call(env, "POST", "/api/admin/prizes/receipts", { token, body: manual }), 200, "manual 2");
});

test("negative lines are allowed on an adjustment only", async () => {
  const env = makeEnv();
  const token = await seed(env);
  await call(env, "POST", "/api/admin/prizes/receipts", { token, body: { vendor: "Opening count", source: "adjustment", lines: [{ name: "Shirt", qty: 10 }] } });
  expectStatus(await call(env, "POST", "/api/admin/prizes/receipts", { token, body: { vendor: "Vendor", lines: [{ name: "Shirt", qty: -2 }] } }), 400, "negative manual");
  expectStatus(await call(env, "POST", "/api/admin/prizes/receipts", { token, body: { vendor: "Shrinkage", source: "adjustment", lines: [{ name: "Shirt", qty: -2 }] } }), 200, "negative adjustment");
  const items = (await call(env, "GET", "/api/admin/prizes/items", { token })).data.items;
  assert.equal(items[0].on_hand, 8);
});

/* ───────────── routes: the event's prize sheet ───────────── */

test("GET /api/admin/events/:id/prizes reads finishers off the bracket, with the Award-ready team ids", async () => {
  const env = makeEnv();
  const token = await seed(env);
  const r = await call(env, "GET", "/api/admin/events/7/prizes", { token });
  expectStatus(r, 200, "sheet");
  assert.equal(r.data.basis, "bracket");
  assert.deepEqual(r.data.finishers.map((f) => [f.bracket, f.place, f.team]),
    [["A", 1, "Aces"], ["A", 2, "Blockers"], ["A", 3, "Setters"], ["A", 3, "Diggers"]]);
  assert.ok(r.data.finishers.every((f) => Number.isInteger(f.team_id)), "every finisher carries the team id the Award button posts");
  assert.equal(r.data.teams.length, 4, "the full team list is there for a non-placing award");
});

test("no bracket result yet → pool standings' top three, labelled as such; nothing at all → basis 'none'", async () => {
  const env = makeEnv();
  const token = await seed(env, { playFinal: false });
  env.DB.exec("DELETE FROM matches");
  let r = await call(env, "GET", "/api/admin/events/7/prizes", { token });
  assert.equal(r.data.basis, "none");
  assert.equal(r.data.finishers.length, 0);
  env.DB.exec(`INSERT INTO standings (org_id, event_id, team_id, wins, losses, point_diff, points_for, points_against, rank)
    VALUES (1,7,3,3,0,20,75,55,1),(1,7,1,2,1,5,70,65,2),(1,7,2,1,2,-5,65,70,3),(1,7,4,0,3,-20,55,75,4)`);
  r = await call(env, "GET", "/api/admin/events/7/prizes", { token });
  assert.equal(r.data.basis, "standings");
  assert.deepEqual(r.data.finishers.map((f) => [f.place, f.team]), [[1, "Diggers"], [2, "Aces"], [3, "Blockers"]]);
});

/* ───────────── access ───────────── */

test("a member reaches none of it; another org sees none of it", async () => {
  const env = makeEnv();
  const staff = await seed(env);
  await call(env, "POST", "/api/admin/prizes/receipts", { token: staff, body: { vendor: "A", lines: [{ name: "Medal", qty: 2 }] } });
  const member = await signIn(env, "player@boomtown.test", "member");
  for (const [m, p] of [["GET", "/api/admin/prizes/items"], ["POST", "/api/admin/prizes/receipts"], ["POST", "/api/admin/prizes/awards"], ["GET", "/api/admin/events/7/prizes"]]) {
    const r = await call(env, m, p, { token: member, body: m === "POST" ? {} : undefined });
    assert.equal(r.status, 403, `${m} ${p} admitted a member (${r.status})`);
  }
  const other = await signIn(env, "boss@other.test", null);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES ((SELECT id FROM users WHERE email='boss@other.test'), 2, 'admin')`);
  const r = await call(env, "GET", "/api/admin/prizes/items", { token: other, orgId: 2 });
  expectStatus(r, 200, "other org");
  assert.equal(r.data.items.length, 0, "org 2 sees org 1's medals");
});
