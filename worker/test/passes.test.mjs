/* Boomtown Platform — pass ledger + staff pay tests
   File: worker/test/passes.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.58.0

   Covers both v0.58.0 modules because they ship together and share one migration.
   Three layers: pure decisions, source guards (§6.5/F-15 + org scope), and live routes through
   the real router on the v0.57.0 in-memory harness. Every guard has a negative control. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { passStatus, normalizePassInput, monthKey, guestPassName, PASS_USED_SQL } from "../src/passes.js";
import { computePay, hoursBetween, pickRate, normalizeRateInput, PAY_BASES, MAX_RATE_CENTS } from "../src/staff_pay.js";
import { templateTailsAfter, mountsAndWires } from "../testkit/route-extract.mjs"; // v0.111.0 §-1c D-17b — regions, not distances

const PASSES_SRC = readFileSync(new URL("../src/passes.js", import.meta.url), "utf8");
const PAY_SRC = readFileSync(new URL("../src/staff_pay.js", import.meta.url), "utf8");
const INDEX_SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

const NOW = "2026-08-03T12:00:00Z";
const pass = (o) => ({ total_sessions: 10, starts_at: "2026-08-01T00:00:00Z", expires_at: null, deleted_at: null, ...o });

/* ============================ 1. pass balance ============================ */

test("passStatus: a punch card counts down and stops at zero", () => {
  assert.equal(passStatus(pass(), 0, NOW).remaining, 10);
  assert.equal(passStatus(pass(), 7, NOW).remaining, 3);
  const done = passStatus(pass(), 10, NOW);
  assert.equal(done.remaining, 0);
  assert.equal(done.usable, false);
  assert.match(done.reason, /all used up/);
});

test("passStatus: unlimited-within-window reports null remaining, not zero", () => {
  const p = passStatus(pass({ total_sessions: null, expires_at: "2026-08-31T23:59:59Z" }), 40, NOW);
  assert.equal(p.remaining, null, "null means unlimited; 0 would read as exhausted");
  assert.equal(p.usable, true);
});

test("passStatus: expiry and start windows are enforced", () => {
  assert.equal(passStatus(pass({ expires_at: "2026-08-02T00:00:00Z" }), 0, NOW).usable, false);
  assert.equal(passStatus(pass({ starts_at: "2026-09-01T00:00:00Z" }), 0, NOW).usable, false);
  assert.equal(passStatus(pass({ expires_at: "2026-12-31T00:00:00Z" }), 0, NOW).usable, true);
});

test("passStatus: SQLite datetime form is read as UTC (the v0.54.0 defect class)", () => {
  // "2026-08-03 18:00:00" is UTC. Parsed as local on a UTC-6 machine it becomes midnight, and a
  // pass that expired hours ago would still look live.
  const p = passStatus(pass({ expires_at: "2026-08-03 06:00:00" }), 0, NOW);
  assert.equal(p.usable, false, "a zone-less expiry must be read as UTC, not as local time");
});

test("NC-1: passStatus FAILS CLOSED on corrupt dates and voided passes", () => {
  assert.equal(passStatus(pass({ expires_at: "not-a-date" }), 0, NOW).usable, false);
  assert.equal(passStatus(pass({ starts_at: "garbage" }), 0, NOW).usable, false);
  assert.equal(passStatus(pass({ deleted_at: "2026-08-01T00:00:00Z" }), 0, NOW).usable, false);
  // A pass is a thing of value. Unreadable data must never mean "usable forever".
});

test("normalizePassInput rejects the shapes that would create an un-reconcilable pass", () => {
  assert.equal(normalizePassInput({ name: "" }).ok, false);
  assert.equal(normalizePassInput({ name: "P", total_sessions: 0 }).ok, false);
  assert.equal(normalizePassInput({ name: "P", total_sessions: 2.5 }).ok, false);
  assert.equal(normalizePassInput({ name: "P", total_sessions: 9999 }).ok, false);
  assert.equal(normalizePassInput({ name: "P", kind: "wizard" }).ok, false);
  const unlimitedNoEnd = normalizePassInput({ name: "Open gym", total_sessions: null });
  assert.equal(unlimitedNoEnd.ok, false, "unlimited with no end date never runs out — refuse it");
  assert.match(unlimitedNoEnd.error, /end date/);
  assert.equal(normalizePassInput({ name: "Open gym", total_sessions: null, expires_at: "2026-09-30" }).ok, true);
});

test("guest-pass grant naming is stable, so a second grant in the same month is detectable", () => {
  assert.equal(monthKey("2026-08-03T12:00:00Z"), "2026-08");
  assert.equal(guestPassName("Gold", "2026-08"), "Gold guest passes — 2026-08");
  assert.equal(guestPassName("Gold", monthKey(NOW)), guestPassName("Gold", monthKey(NOW)));
});

/* ============================ 2. staff pay ============================ */

test("computePay: hourly, flat and per-session", () => {
  const base = { starts_at: "2026-08-03T17:00:00Z", ends_at: "2026-08-03T20:00:00Z" };
  assert.deepEqual(computePay({ ...base, pay_basis: "hourly", pay_rate_cents: 2500 }),
    { ok: true, units: 3, amount_cents: 7500 });
  assert.deepEqual(computePay({ ...base, pay_basis: "flat", pay_rate_cents: 9000 }),
    { ok: true, units: 1, amount_cents: 9000 });
  assert.deepEqual(computePay({ ...base, pay_basis: "per_session", pay_rate_cents: 3000, pay_units: 2 }),
    { ok: true, units: 2, amount_cents: 6000 });
});

test("hoursBetween handles the SQLite datetime form and rejects nonsense", () => {
  assert.equal(hoursBetween("2026-08-03 17:00:00", "2026-08-03 20:30:00"), 3.5);
  assert.ok(Number.isNaN(hoursBetween("nope", "2026-08-03T20:00:00Z")));
});

test("NC-2: computePay returns a REASON, never a silent zero", () => {
  const base = { starts_at: "2026-08-03T17:00:00Z", ends_at: "2026-08-03T20:00:00Z" };
  // A 0 in a pay column is indistinguishable from "worked for free", and someone will believe it.
  for (const bad of [
    { ...base, pay_basis: "hourly" },                                   // no rate
    { ...base, pay_basis: "guesswork", pay_rate_cents: 100 },           // bad basis
    { ...base, pay_basis: "per_session", pay_rate_cents: 100 },         // no units
    { pay_basis: "hourly", pay_rate_cents: 100, starts_at: "x", ends_at: "y" },
    { pay_basis: "hourly", pay_rate_cents: 100, starts_at: "2026-08-03T20:00:00Z", ends_at: "2026-08-03T17:00:00Z" },
    { ...base, pay_basis: "hourly", pay_rate_cents: MAX_RATE_CENTS + 1 }, // dollars in a cents box
  ]) {
    const r = computePay(bad);
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(bad).slice(0, 70)}`);
    assert.ok(r.error && r.error.length > 5, "a refusal must carry a human reason");
  }
});

test("pickRate prefers the role-specific card, then the most recent general one", () => {
  const rates = [
    { id: 1, role_label: null, pay_basis: "hourly", rate_cents: 2000, effective_from: "2026-01-01T00:00:00Z", effective_to: null },
    { id: 2, role_label: "Referee", pay_basis: "flat", rate_cents: 4000, effective_from: "2026-01-01T00:00:00Z", effective_to: null },
    { id: 3, role_label: null, pay_basis: "hourly", rate_cents: 2500, effective_from: "2026-07-01T00:00:00Z", effective_to: null },
  ];
  assert.equal(pickRate(rates, "Referee", NOW).id, 2, "an exact role match wins over a general rate");
  assert.equal(pickRate(rates, "Coach", NOW).id, 3, "no role match falls back to the newest general rate");
  assert.equal(pickRate(rates, null, "2026-03-01T00:00:00Z").id, 1, "a rate that had not started yet must not apply");
});

test("NC-3: an expired or deleted rate card never applies", () => {
  const rates = [
    { id: 1, role_label: null, rate_cents: 2000, effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-06-30T00:00:00Z" },
    { id: 2, role_label: null, rate_cents: 9999, effective_from: "2026-01-01T00:00:00Z", effective_to: null, deleted_at: "2026-02-01T00:00:00Z" },
  ];
  assert.equal(pickRate(rates, null, NOW), null, "an out-of-window or deleted rate must not be picked");
});

test("normalizeRateInput guards the cents/dollars mistake", () => {
  assert.equal(normalizeRateInput({ rate_cents: 2500 }).ok, true);
  assert.equal(normalizeRateInput({ rate_cents: 25.5 }).ok, false);
  assert.equal(normalizeRateInput({ rate_cents: -1 }).ok, false);
  assert.equal(normalizeRateInput({ rate_cents: MAX_RATE_CENTS + 1 }).ok, false);
  assert.equal(normalizeRateInput({ rate_cents: 1000, pay_basis: "vibes" }).ok, false);
});

/* ============================ 3. source guards ============================ */

test("§6.5: both modules are MOUNTED and WIRED (F-15 — call sites, not imports)", () => {
  for (const call of [
    /\["passes",\s+passesRoutes\],/,
    /\["staffPay",\s+staffPayRoutes\],/,
  ]) {
    assert.ok(call.test(INDEX_SRC), `not dispatched: ${call} — built-but-uncalled (failure class 1)`);
  }
  assert.ok(mountsAndWires(INDEX_SRC, "Passes"), "wirePasses must be called with the shared helpers");
  assert.ok(mountsAndWires(INDEX_SRC, "StaffPay"), "wireStaffPay must be called with the shared helpers");
});

test("NC-4: the mount gate can fail", () => {
  const mutated = INDEX_SRC.replace(/\["passes",\s+passesRoutes\],/, "");
  assert.notEqual(mutated, INDEX_SRC, "mutation did not land — NC is vacuous");
  assert.ok(!/\["passes",\s+passesRoutes\],/.test(mutated));
});

/** Comments explain the rule and therefore contain the forbidden words. Scan code only —
    the same trap that made build_status.test.mjs's first draft fail for the opposite of its
    purpose (checkin.js documents the gate it deleted). */
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

test("the balance is DERIVED — no stored counter, one definition (F-26)", () => {
  assert.ok(!/used_sessions/.test(stripJs(PASSES_SRC)),
    "a used_sessions counter appeared in CODE — the balance must stay derived, or it will drift on reversal");
  assert.match(PASS_USED_SQL, /reversed_at IS NULL/, "a reversed redemption must stop counting");
  assert.match(PASS_USED_SQL, /r\.org_id = p\.org_id/, "the count must be org-scoped");
  const uses = (PASSES_SRC.match(/\$\{PASS_USED_SQL\}/g) || []).length;
  assert.ok(uses >= 1, "the shared count must be interpolated, not rewritten by hand");
  const handRolled = (PASSES_SRC.match(/COUNT\(\*\) FROM pass_redemptions/g) || []).length;
  assert.equal(handRolled, 1, `the redemption count is written out ${handRolled} times — a second copy is the drift PASS_USED_SQL prevents`);
});

test("every SQL statement in both modules is org-scoped (F-11)", () => {
  for (const [name, src, floor] of [["passes.js", PASSES_SRC, 5], ["staff_pay.js", PAY_SRC, 8]]) {
    // Scan BACKTICK, DOUBLE- AND SINGLE-QUOTED strings. The first draft read only template
    // literals and therefore missed every single-line statement written in double quotes —
    // staff_pay.js is mostly those, so the guard saw 4 statements where there are 9. A scanner
    // narrower than its subject reports clean; that is failure class 3, and it nearly happened
    // inside the guard written to prevent it.
    const literals = [
      ...(src.match(/`[^`]*`/gs) || []),
      ...(src.match(/"[^"\n]{20,}"/g) || []),
      ...(src.match(/'[^'\n]{20,}'/g) || []),
    ];
    const sql = literals.filter((t) =>
      /FROM (passes|pass_redemptions|staff_rates|staff_shifts|contacts|membership_grants)|INSERT INTO (passes|pass_redemptions|staff_rates)|UPDATE (passes|pass_redemptions|staff_rates|staff_shifts)/i.test(t)
      // PASS_SELECT is a FRAGMENT with no WHERE of its own — its callers add the scope, and they
      // are checked separately in the test below. Judging a fragment as if it were a statement
      // would force a misleading org_id into the fragment and prove nothing.
      && !/^`SELECT p\.id, p\.contact_id, p\.name/.test(t));
    assert.ok(sql.length >= floor, `${name}: guard floor — expected >=${floor} scoped statements, saw ${sql.length}`);
    for (const t of sql) {
      const bound = /org_id\s*=\s*\?/.test(t);
      const insertScoped = /INSERT INTO \w+ \([^)]*\borg_id\b/i.test(t);
      // A correlated subquery inherits the outer statement's scope: `r.org_id = p.org_id` is
      // scoped, and demanding a bound parameter there would push authors to re-bind org_id
      // inside the subquery — more places to get it wrong, not fewer. Accept the correlation,
      // but ONLY the org_id-to-org_id form; `r.org_id = p.id` would not count.
      const correlated = /\b\w+\.org_id\s*=\s*\w+\.org_id\b/.test(t);
      assert.ok(bound || insertScoped || correlated,
        `${name}: unscoped SQL — ${t.replace(/\s+/g, " ").slice(0, 100)}…`);
    }
  }
});

test("every PASS_SELECT call site adds the org scope the fragment omits", () => {
  // The fragment is safe only if nobody ever uses it bare. Check the users, not the tool.
  /* D-17b: was a 220-character tail plus a 120-character gap to the org_id — two distances stacked.
     The real region is THE REST OF THE QUERY, and a query ends at its closing backtick. A call site
     whose WHERE clause happens to sit 130 characters in is no longer read as unscoped. */
  const uses = templateTailsAfter(stripJs(PASSES_SRC), "${PASS_SELECT}");
  assert.ok(uses.length >= 3, `expected >=3 PASS_SELECT call sites, saw ${uses.length} — an empty scan is no guard`);
  for (const tail of uses) {
    assert.match(tail, /WHERE[\s\S]*?p\.org_id\s*=\s*\?/,
      `a PASS_SELECT call site did not scope by p.org_id: …${tail.replace(/\s+/g, " ").slice(0, 90)}`);
  }
});

test("NC-5: the call-site scope guard can fail", () => {
  const mutated = stripJs(PASSES_SRC).replace(/WHERE p\.org_id=\?1/g, "WHERE 1=1");
  assert.notEqual(mutated, stripJs(PASSES_SRC), "mutation did not land — NC is vacuous");
  const uses = templateTailsAfter(mutated, "${PASS_SELECT}");
  assert.ok(uses.some((t) => !/p\.org_id\s*=\s*\?/.test(t)),
    "with the scope stripped the guard must see at least one unscoped call site");
});

/* ============================ 4. live routes ============================ */

/* The tables this file needs now come from `journey-schema.sql`, which since v0.81.0 carries every
   table the migrations create. They used to be hand-rolled here, appended to the schema string —
   which is precisely how the harness came to be missing half the database without anything going
   red: a test that invents its own schema passes whatever the real one looks like. */
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec(`INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
           INSERT INTO membership_tiers (id, org_id, name, code, rank, guest_passes_per_month)
             VALUES (1, 1, 'Gold', 'gold', 10, 4);`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function signIn(env, email, role) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email=?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, '${role}')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='${role}'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1, ${u.id}, '${email}', 'Test ${role}')`);
  return { token: v.data.token, contactId: env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id };
}

test("live: issue a 3-session pass, spend it down, and hit the wall", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");

  const made = await call(env, "POST", "/api/admin/passes", {
    token: staff.token, body: { contact_id: member.contactId, name: "3-session card", total_sessions: 3 },
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));

  for (const expected of [2, 1, 0]) {
    const r = await call(env, "POST", `/api/admin/passes/${made.data.pass_id}/redeem`, { token: staff.token, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.remaining, expected);
  }
  const overdraft = await call(env, "POST", `/api/admin/passes/${made.data.pass_id}/redeem`, { token: staff.token, body: {} });
  assert.equal(overdraft.status, 409, "a spent pass must refuse, not silently allow a fourth entry");
  assert.match(overdraft.data.error, /all used up/);
  env.DB.close();
});

test("live: reversing a redemption puts the session back but keeps the record", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");
  const made = await call(env, "POST", "/api/admin/passes", {
    token: staff.token, body: { contact_id: member.contactId, name: "Card", total_sessions: 1 },
  });
  const used = await call(env, "POST", `/api/admin/passes/${made.data.pass_id}/redeem`, { token: staff.token, body: {} });
  assert.equal(used.data.remaining, 0);

  const rev = await call(env, "POST", `/api/admin/pass-redemptions/${used.data.redemption_id}/reverse`, {
    token: staff.token, body: { reason: "Scanned the wrong member" },
  });
  assert.equal(rev.status, 200);
  const mine = await call(env, "GET", "/api/profile/passes", { token: member.token });
  assert.equal(mine.data.passes[0].remaining, 1, "the reversal did not restore the session");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM pass_redemptions").n, 1,
    "the reversed redemption was deleted — it must stay on the record next to its correction");

  const twice = await call(env, "POST", `/api/admin/pass-redemptions/${used.data.redemption_id}/reverse`, { token: staff.token, body: {} });
  assert.equal(twice.status, 409, "reversing twice would credit a session that was never spent");
  env.DB.close();
});

test("live: the tier's guest-pass allowance becomes a real, spendable pass — once per month", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");
  env.DB.exec(`INSERT INTO membership_grants (org_id, contact_id, tier_id, source) VALUES (1, ${member.contactId}, 1, 'manual')`);

  const g = await call(env, "POST", `/api/admin/members/${member.contactId}/guest-passes`, { token: staff.token, body: {} });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal(g.data.sessions, 4, "the tier says 4 guest passes a month");

  const again = await call(env, "POST", `/api/admin/members/${member.contactId}/guest-passes`, { token: staff.token, body: {} });
  assert.equal(again.data.already_granted, true, "granting twice in a month must not double the allowance");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM passes WHERE kind='guest'").n, 1);

  // A guest pass is spent on somebody else, so it must record who walked in.
  const noName = await call(env, "POST", `/api/admin/passes/${g.data.pass_id}/redeem`, { token: staff.token, body: {} });
  assert.equal(noName.status, 400, "a guest pass without a guest name is an unaccounted entry");
  const ok = await call(env, "POST", `/api/admin/passes/${g.data.pass_id}/redeem`, {
    token: staff.token, body: { guest_name: "Sam Visitor" },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.remaining, 3);
  env.DB.close();
});

test("live: a member sees their own passes and cannot touch the admin ledger", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");
  await call(env, "POST", "/api/admin/passes", {
    token: staff.token, body: { contact_id: member.contactId, name: "Card", total_sessions: 5 },
  });
  const mine = await call(env, "GET", "/api/profile/passes", { token: member.token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.passes[0].remaining, 5);

  for (const [m, p] of [["GET", "/api/admin/passes"], ["POST", "/api/admin/passes"]]) {
    const r = await call(env, m, p, m === "GET" ? { token: member.token } : { token: member.token, body: { contact_id: 1, name: "x" } });
    assert.equal(r.status, 403, `${m} ${p} let a member into the admin ledger`);
  }
  env.DB.close();
});

test("live: a shift picks up the rate card, and approval freezes it", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const coach = await signIn(env, "coach@bt.test", "member");

  await call(env, "POST", "/api/admin/staff-rates", {
    token: staff.token, body: { contact_id: coach.contactId, pay_basis: "hourly", rate_cents: 2500 },
  });
  // RELATIVE, not a hardcoded date. This read '2026-08-03T17:00:00Z', which was a day in the future
  // when the test was written and worked because the rate card is effective from "now". The moment
  // real time reached 2026-08-03T17:00Z the shift began starting BEFORE the card that pays it, the
  // rate lookup found nothing, and a passing test turned red on a calendar boundary with no code
  // change at all. Anchor the shift to now and the test means the same thing on every day.
  env.DB.exec(`INSERT INTO staff_shifts (org_id, starts_at, ends_at, role_label)
               VALUES (1, datetime('now','+1 day'), datetime('now','+1 day','+3 hours'), 'Coach')`);
  const shiftId = env.DB.one("SELECT id FROM staff_shifts").id;

  const assigned = await call(env, "POST", `/api/admin/shifts/${shiftId}/assign`, {
    token: staff.token, body: { contact_id: coach.contactId },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  assert.equal(assigned.data.amount_cents, 7500, "3 hours at $25 is $75");
  assert.equal(assigned.data.rate_source, "rate_card");

  const approved = await call(env, "POST", `/api/admin/shifts/${shiftId}/approve`, { token: staff.token, body: {} });
  assert.equal(approved.status, 200);

  // Raise the rate; the approved shift must not restate.
  await call(env, "POST", "/api/admin/staff-rates", {
    token: staff.token, body: { contact_id: coach.contactId, pay_basis: "hourly", rate_cents: 4000 },
  });
  assert.equal(env.DB.one("SELECT pay_amount_cents FROM staff_shifts WHERE id=?1", shiftId).pay_amount_cents, 7500,
    "a later rise rewrote an already-approved shift — history must not move");

  const reassign = await call(env, "POST", `/api/admin/shifts/${shiftId}/assign`, {
    token: staff.token, body: { contact_id: coach.contactId },
  });
  assert.equal(reassign.status, 409, "an approved shift must be reopened before its pay can change");
  env.DB.close();
});

test("live: assigning someone with no rate refuses, and says whose rate is missing", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const coach = await signIn(env, "coach@bt.test", "member");
  env.DB.exec(`INSERT INTO staff_shifts (org_id, starts_at, ends_at) VALUES (1, '2026-08-03T17:00:00Z', '2026-08-03T20:00:00Z')`);
  const shiftId = env.DB.one("SELECT id FROM staff_shifts").id;
  const r = await call(env, "POST", `/api/admin/shifts/${shiftId}/assign`, {
    token: staff.token, body: { contact_id: coach.contactId },
  });
  assert.equal(r.status, 409, "assigning with no rate must refuse rather than book a zero");
  assert.match(r.data.error, /Test member|rate/i);
  env.DB.close();
});

test("live: the pay report separates approved from pending", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const coach = await signIn(env, "coach@bt.test", "member");
  await call(env, "POST", "/api/admin/staff-rates", {
    token: staff.token, body: { contact_id: coach.contactId, pay_basis: "flat", rate_cents: 5000 },
  });
  /* DATES HERE ARE RELATIVE TO NOW, AND THEY HAVE TO BE.
     A rate's `effective_from` defaults to `datetime('now')` (staff_pay.js), and `assign` resolves a
     shift against ITS OWN start via `pickRate(rates, roleLabel, shift.starts_at)`. These shifts were
     hardcoded to 17:00Z on the day the test was written, which put them AFTER `now` for the few hours
     that morning and BEFORE it forever after — so the rate stopped covering them, `pay_amount_cents`
     came out empty, and this assertion read 0 instead of 5000. It went red mid-session at 17:00Z on
     2026-08-04 with no code change, and from the following day it would have failed permanently,
     blocking every commit because preflight gates on the suite.
     Both shifts must start AFTER the rate exists; the report window is derived the same way. */
  const at = (days, hours = 0) =>
    new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const d of [1, 2]) {
    env.DB.exec(`INSERT INTO staff_shifts (org_id, starts_at, ends_at) VALUES (1, '${at(d)}', '${at(d, 2)}')`);
  }
  const ids = env.DB.query("SELECT id FROM staff_shifts ORDER BY id").map((r) => r.id);
  for (const id of ids) await call(env, "POST", `/api/admin/shifts/${id}/assign`, { token: staff.token, body: { contact_id: coach.contactId } });
  await call(env, "POST", `/api/admin/shifts/${ids[0]}/approve`, { token: staff.token, body: {} });

  const rep = await call(env, "GET", `/api/admin/shifts/pay?from=${at(-1).slice(0, 10)}&to=${at(30).slice(0, 10)}`, { token: staff.token });
  assert.equal(rep.status, 200);
  const row = rep.data.people[0];
  assert.equal(row.approved_cents, 5000, "one approved flat shift");
  assert.equal(row.pending_cents, 5000, "one still pending");
  // "Owed" and "might be owed" are different questions; merging them is how someone gets overpaid.
  assert.ok(!("total_cents" in row), "approved and pending must not be pre-summed into one figure");
  env.DB.close();
});

test("live: the family overview totals what the household owes in one read", async () => {
  const env = boot();
  const parent = await signIn(env, "parent@bt.test", "member");
  env.DB.exec(`
    INSERT INTO contacts (id, org_id, email, full_name) VALUES (900, 1, 'kid@bt.test', 'Kid One');
    INSERT INTO guardianships (org_id, guardian_contact_id, minor_contact_id, status)
      VALUES (1, ${parent.contactId}, 900, 'active');
    INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status) VALUES (1,1,'w','b','s','active');
    INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at)
      VALUES (1, 1, 'training', 'Skills clinic', 'published', 3500, datetime('now','+5 days'));
    INSERT INTO registrations (org_id, event_id, contact_id, status, price_cents)
      VALUES (1, 1, 900, 'pending', 3500);
  `);
  const ov = await call(env, "GET", "/api/family/overview", { token: parent.token });
  assert.equal(ov.status, 200, JSON.stringify(ov.data));
  assert.equal(ov.data.accounts.length, 2, "the parent and the child should both appear");
  assert.equal(ov.data.total_owed_cents, 3500, "the household total must include the child's unpaid registration");
  const kid = ov.data.accounts.find((a) => !a.is_self);
  assert.equal(kid.unpaid.length, 1);
  assert.equal(kid.upcoming.length, 1);
  env.DB.close();
});

test("live: the overview shows only YOUR household", async () => {
  const env = boot();
  const parent = await signIn(env, "parent@bt.test", "member");
  const other = await signIn(env, "other@bt.test", "member");
  env.DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES (901, 1, 'kid2@bt.test', 'Someone Elses Kid');
               INSERT INTO guardianships (org_id, guardian_contact_id, minor_contact_id, status)
                 VALUES (1, ${other.contactId}, 901, 'active');`);
  const ov = await call(env, "GET", "/api/family/overview", { token: parent.token });
  assert.equal(ov.data.accounts.length, 1, "another family's child appeared in this parent's overview");
  assert.equal(ov.data.accounts[0].is_self, true);
  env.DB.close();
});
