/**
 * Boomtown Platform — ONE identity rule (D-18 / §-0 B20)
 * File: worker/test/contact_identity.test.mjs · Version: v1.0 · Date: 2026-08-16 · Ships in: v0.166.0
 *
 * D-18's sentence: "Pick one rule, make user_org_roles/contacts.user_id authoritative, and make
 * the other resolver call it." TWO of the register's premises measured FALSE at the tree and are
 * corrected here, because the guards have to be about the real defect:
 *
 *   1. "messages.js:613 ownContact is THE holdout" — there were FOUR surviving private copies of
 *      that query (member_portal, messages, profiles, waivers) plus a fifth private function in
 *      calendar.js sharing the shared helper's NAME. index.js's own header claimed six modules
 *      had been consolidated; consent and registrations really were, the other four never were.
 *   2. "ownContact matches email case-SENSITIVELY" — false at the database. Live D1 and the
 *      fixture both declare `contacts.email TEXT COLLATE NOCASE` and `users.email ... COLLATE
 *      NOCASE`, so `email = ?3` already matches case-insensitively; `lower()=lower()` is
 *      belt-and-braces, not a behavioural difference. **No test here asserts case divergence:
 *      it would pass against a column collation rather than against the code — a fixture that
 *      cannot exhibit the defect is not a fixture.**
 *
 * What IS real, and what these tests pin: the shared `contactForSession` joined on EMAIL ONLY and
 * consulted `contacts.user_id` in ORDER BY, so **a contact whose user_id is set but whose email
 * was edited is invisible to it** — the member is orphaned from their own record. The private
 * copies matched `(user_id = ? OR email = ?)` and were therefore MORE correct on exactly the axis
 * D-18 names. So the rule is unified in the strong direction: the linked row wins outright, and
 * the four readers adopt it. profiles.js keeps its own query because it is the LINKER (it writes
 * user_id and creates the row) — it adopts the same matching rule so linker and readers can never
 * disagree about which row is yours.
 *
 * Live D1 at build time: 49 contacts, 1 linked, 1 user, 0 divergent-email rows, 0 email-matching
 * unlinked rows — the change is behaviour-preserving TODAY, which is exactly when to make it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8"));
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  return { token: v.data.token, id: env.DB.one("SELECT id FROM users WHERE email = ?1", email).id };
}

/**
 * A signed-in MEMBER, with the first-account admin bootstrap burned on a throwaway first —
 * without that, the "member" under test arrives holding admin and the routes answer 200 for
 * the wrong reason. (The fixture note that has bitten this suite before.)
 */
async function member(env, email) {
  await signIn(env, "throwaway-staff@bt.test");
  return signIn(env, email);
}

/** The two routes that discriminate: each 404s with its own sentence when the resolver misses. */
const MESSAGES_ROUTE = "/api/messages/threads";      // messages.js requireMember → the resolver
const CALENDAR_ROUTE = "/api/profile/calendar";      // calendar.js → the resolver

/* ═══════════ the defect: a linked contact whose email was edited ═══════════ */

test("D-18: a contact linked by user_id resolves even when its email no longer matches — THE SHARED HELPER's path", async () => {
  const env = boot();
  const me = await member(env, "bob@bt.test");
  // The admin edited this member's address on their record. The link is the truth.
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name)
               VALUES (70, 1, ${me.id}, 'old-address@bt.test', 'Bob')`);

  const r = await call(env, "GET", CALENDAR_ROUTE, { token: me.token });
  assert.equal(r.status, 200,
    `the shared resolver lost a member linked by user_id (${JSON.stringify(r.data)}) — an edited address orphans them from their own record`);
});

test("D-18: the same linked contact resolves through the MESSAGES path", async () => {
  // GREEN BEFORE THE BUILD, and named as such: messages' private copy already matched on
  // user_id. It is kept because after messages adopts the shared helper this becomes the
  // regression guard proving the move did not LOSE that authority.
  const env = boot();
  const me = await member(env, "bob@bt.test");
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name)
               VALUES (70, 1, ${me.id}, 'old-address@bt.test', 'Bob')`);

  const r = await call(env, "GET", MESSAGES_ROUTE, { token: me.token });
  assert.equal(r.status, 200,
    `the messages path lost a member linked by user_id (${JSON.stringify(r.data)})`);
});

test("D-18: when a linked row and an email-matching row BOTH exist, the linked row wins outright — both paths", async () => {
  const env = boot();
  const me = await member(env, "bob@bt.test");
  // id order is deliberately hostile: the email-matching row is FIRST, so a rule that falls
  // back on `c.id ASC` without preferring the link picks the wrong record.
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name)
               VALUES (80, 1, NULL, 'bob@bt.test', 'Stale duplicate')`);
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name)
               VALUES (81, 1, ${me.id}, 'old-address@bt.test', 'The real Bob')`);

  const msg = await call(env, "GET", MESSAGES_ROUTE, { token: me.token });
  assert.equal(msg.status, 200, JSON.stringify(msg.data));

  // Which row the resolver chose, observed from what the route DOES rather than inferred: the
  // POST mints a member calendar token stamped with the contact it resolved, so that row's
  // contact_id IS the answer. (The GET only READS an existing token — reading it on an empty
  // table measures nothing, which is how this assertion first failed against correct code.)
  const cal = await call(env, "POST", CALENDAR_ROUTE, { token: me.token });
  assert.equal(cal.status, 200, JSON.stringify(cal.data));
  const tok = env.DB.one("SELECT contact_id FROM access_tokens WHERE org_id=1 AND kind='calendar_member' ORDER BY id DESC LIMIT 1");
  assert.equal(tok && tok.contact_id, 81,
    "the shared resolver picked the stale email-matching duplicate over the row actually linked to this user");
});

/* ═══════════ one rule, not five ═══════════ */

/** The private-copy shape the consolidation was supposed to remove, comments blanked. */
const PRIVATE_COPY = /\(user_id\s*=\s*\?\d\s+OR\s+email\s*=\s*\?\d\)/;

test("D-18: no module keeps a private contact resolver — except profiles.js, which is the LINKER", async () => {
  const readers = ["messages.js", "member_portal.js", "waivers.js", "calendar.js"];
  for (const f of readers) {
    assert.equal(PRIVATE_COPY.test(blankComments(SRC(f))), false,
      `${f} still resolves the member itself — that is a second identity rule, which is D-18`);
  }
  // profiles.js is exempt BY ROLE, not by oversight: it writes contacts.user_id and creates the
  // row when none exists, so it cannot be replaced by a read-only helper. It must still match
  // by the SAME rule, or the linker and the readers disagree about which row is yours.
  assert.ok(PRIVATE_COPY.test(blankComments(SRC("profiles.js"))),
    "profiles.js lost the linker query this exemption exists for — re-measure the exemption");
  // calendar.js's own function shared the shared helper's NAME while having a different body.
  assert.equal(/async function contactForSession/.test(blankComments(SRC("calendar.js"))), false,
    "calendar.js still defines its own contactForSession — same name, different rule, worst case of all");
});

test("D-18 NC: the private-copy scan fires on the real thing and ignores the shared call", () => {
  assert.ok(PRIVATE_COPY.test('"... AND (user_id=?2 OR email=?3) ORDER BY user_id DESC LIMIT 1"'),
    "the scan cannot see the copy it exists to find");
  assert.equal(PRIVATE_COPY.test("const me = await H.contactForSession(env, ctx);"), false,
    "the scan fires on a call to the shared helper — it would forbid the fix");
});

test("D-18: every former holdout now CALLS the shared resolver — asserted at the call sites", () => {
  for (const f of ["messages.js", "member_portal.js", "waivers.js", "calendar.js"]) {
    assert.match(blankComments(SRC(f)), /contactForSession\(env, ctx\)/,
      `${f} does not call the shared resolver anywhere`);
  }
  // Both directions: the two messages call sites the register names must BOTH have moved, so
  // count them rather than trusting one hit.
  const msg = blankComments(SRC("messages.js"));
  assert.equal((msg.match(/H\.contactForSession\(env, ctx\)/g) || []).length, 2,
    "messages.js must resolve the member through the shared helper at BOTH of its call sites");
  assert.equal(/async function ownContact/.test(msg), false, "messages.js kept its own resolver definition");
});

test("D-18: the shared rule makes the LINK authoritative, and the linker matches the same way", () => {
  const idx = blankComments(SRC("index.js"));
  const fn = idx.slice(idx.indexOf("async function contactForSession"), idx.indexOf("const wiredHelpers"));
  assert.match(fn, /c\.user_id = u\.id OR lower\(c\.email\) = lower\(u\.email\)/,
    "the shared resolver still joins on email alone — a linked row with an edited address stays invisible");
  assert.match(fn, /ORDER BY CASE WHEN c\.user_id = u\.id THEN 0 ELSE 1 END/,
    "the shared resolver does not prefer the linked row OUTRIGHT — ORDER BY user_id DESC only sorts, it does not decide");
  // NC: both needles are load-bearing.
  assert.notEqual(fn.replace(/c\.user_id = u\.id/g, "XX"), fn, "the mutation did not land");
});
