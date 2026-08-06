/* Boomtown Platform — the fixture carries the owner's REAL registration shapes (roadmap §-1b W-G)
   File: worker/test/sandbox_real_shapes.test.mjs · Version: v1.0 · Date: 2026-08-06 · Ships in: v0.100.0

   Read from the owner's real Google Drive exports this session — "2026 Spring REVCO 4's Tournament
   (Responses)", 21 team rows, same form as the Valentines sheet already recorded in the handoff.
   W-G's whole point is that the fixture should exercise the shapes REAL registrations have, because
   the owner judges features against the fixture: when the fixture is wrong they cannot tell a broken
   feature from a broken fixture, and they reasonably assume the feature (sandbox_seed.test.mjs's
   opening note, and it happened once already).

   THESE ASSERT THE SHAPE CHANGES A DOWNSTREAM ANSWER — not that a row exists. Counting rows is what
   passed on the broken v1 seed. So:
     · the email-less contact is asserted through the EXACT expression `overview` uses, and the test
       fails if reachable === total, which is the state the old fixture was permanently in;
     · the level is asserted through the REAL `tierOf` from board_suggest.js, not a copy of its
       regex table, and the test demands TWO DISTINCT tiers rather than the presence of a string;
     · the unpaid status is asserted against the registrations screen's own three-status filter.

   Each negative control mutates the REAL seeded database — the rows the shipped seeder actually
   wrote — and proves this file goes red. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { tierOf } from "../src/board_suggest.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/* The registrations screen's own definition of unpaid — web/assets/admin-registrations.js keeps
   this list inline, and the fixture has to be able to light up every branch of it. */
const UNPAID = ["pending", "email-sent", "cash-pending"];

/* The expression `overview()` in marketing.js uses for `reachable`, character for character. */
const REACHABLE = "unsubscribed=0 AND email IS NOT NULL AND email<>''";

function boot() {
  const DB = createD1(SCHEMA);
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
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = 's@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

async function seeded() {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { env, token };
}

const counts = (DB) => DB.one(
  `SELECT COUNT(*) AS total, SUM(CASE WHEN ${REACHABLE} THEN 1 ELSE 0 END) AS reachable
   FROM contacts WHERE org_id=1 AND deleted_at IS NULL`
);

/* ─────────────── a roster contains people with no email, so reachable < total ─────────────── */

test("A1 — the seed makes `reachable` and `total` DISAGREE on the marketing overview", async () => {
  const { env } = await seeded();
  const c = counts(env.DB);
  assert.ok(c.total > 0, "the seed wrote contacts at all");
  assert.ok(
    c.reachable < c.total,
    `reachable (${c.reachable}) must be less than total (${c.total}) — with an address on every ` +
    `row the overview's two numbers can never differ and the distinction is untestable`
  );
});

test("A2 — the email-less contact is a team MEMBER, never a captain", async () => {
  const { env } = await seeded();
  const noEmail = env.DB.query(
    `SELECT id FROM contacts WHERE org_id=1 AND deleted_at IS NULL AND (email IS NULL OR email='')`
  );
  assert.ok(noEmail.length >= 1, "at least one contact has no address on file");
  for (const c of noEmail) {
    const cap = env.DB.one(`SELECT COUNT(*) AS n FROM teams WHERE captain_contact_id=${c.id}`);
    assert.equal(cap.n, 0,
      `contact ${c.id} has no email but captains a team — a registering captain always supplies one`);
  }
});

/* ───────────────────────── the unpaid state the real sheets are full of ───────────────────────── */

test("A3 — every branch of the registrations screen's Unpaid filter selects a seeded row", async () => {
  const { env } = await seeded();
  for (const status of UNPAID) {
    const n = env.DB.one(
      `SELECT COUNT(*) AS n FROM registrations WHERE org_id=1 AND status='${status}'`
    ).n;
    assert.ok(n >= 1, `no seeded registration is '${status}' — that filter branch selects nothing`);
  }
});

/* ─────────────────── the real level vocabulary, proved against the real matcher ─────────────────── */

test("A4 — seeded levels span TWO tiers on the real ladder, including A/AA", async () => {
  const { env } = await seeded();
  const levels = env.DB.query(
    `SELECT DISTINCT level FROM teams WHERE org_id=1 AND level IS NOT NULL AND level<>''`
  ).map((r) => r.level);
  const tiers = [...new Set(levels.map(tierOf).filter((t) => t !== null))];
  assert.ok(tiers.length >= 2,
    `seeded levels ${JSON.stringify(levels)} resolve to tiers ${JSON.stringify(tiers)} — a single ` +
    `tier means no seeded comparison can ever span two`);
  assert.ok(levels.some((l) => tierOf(l) === 350),
    `no seeded team sits on the A/AA rung (350); levels were ${JSON.stringify(levels)}`);
  /* Both real form labels resolve — if either stopped being recognised the ladder would silently
     score the team as "no tier" and drop it from the strength comparison. */
  assert.equal(tierOf("A/AA"), 350);
  assert.equal(tierOf("BB/A"), 250);
});

/* ───────────────────── a team name with a comma survives the seeder's quoting ───────────────────── */

test("A5 — a seeded team name contains a comma, stored whole", async () => {
  const { env } = await seeded();
  const withComma = env.DB.query(
    `SELECT name FROM teams WHERE org_id=1 AND name LIKE '%,%'`
  );
  assert.ok(withComma.length >= 1,
    "no seeded team name contains a comma — the shape that breaks a naive CSV split is untested");
  /* Stored whole, not truncated at the comma. */
  for (const t of withComma) assert.ok(t.name.split(",")[1].trim().length > 0, t.name);
});

test("A6 — the seed still converges when run twice, with the new shapes in place", async () => {
  const { env, token } = await seeded();
  const before = counts(env.DB);
  const again = await call(env, "POST", "/api/admin/testdata/generate", { token });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  const after = counts(env.DB);
  assert.deepEqual(
    { total: after.total, reachable: after.reachable },
    { total: before.total, reachable: before.reachable },
    "a second generate must not stack a second copy of the reshaped contacts"
  );
});

/* ──────────────────── negative controls — each mutates the REAL seeded rows ──────────────────── */

test("NC-1 — giving the email-less contact an address reddens A1", async () => {
  const { env } = await seeded();
  assert.ok(counts(env.DB).reachable < counts(env.DB).total, "precondition: the shape is there");
  env.DB.exec(
    `UPDATE contacts SET email='backfilled@example.com'
     WHERE org_id=1 AND (email IS NULL OR email='')`
  );
  const c = counts(env.DB);
  assert.equal(c.reachable, c.total,
    "with every row addressed the overview's two numbers collapse — which is the state A1 forbids");
});

test("NC-2 — deleting the email-sent registration reddens A3", async () => {
  const { env } = await seeded();
  const before = env.DB.one(`SELECT COUNT(*) AS n FROM registrations WHERE status='email-sent'`).n;
  assert.ok(before >= 1, "precondition: the shape is there");
  env.DB.exec(`DELETE FROM registrations WHERE status='email-sent'`);
  const after = env.DB.one(`SELECT COUNT(*) AS n FROM registrations WHERE status='email-sent'`).n;
  assert.equal(after, 0, "and A3's loop would now find nothing for that branch");
});

test("NC-3 — flattening every level to one label reddens A4", async () => {
  const { env } = await seeded();
  const spanBefore = [...new Set(env.DB.query(
    `SELECT DISTINCT level FROM teams WHERE org_id=1 AND level IS NOT NULL AND level<>''`
  ).map((r) => tierOf(r.level)).filter((t) => t !== null))];
  assert.ok(spanBefore.length >= 2, "precondition: two tiers are there");
  env.DB.exec(`UPDATE teams SET level='BB/A' WHERE org_id=1`);
  const spanAfter = [...new Set(env.DB.query(
    `SELECT DISTINCT level FROM teams WHERE org_id=1 AND level IS NOT NULL AND level<>''`
  ).map((r) => tierOf(r.level)).filter((t) => t !== null))];
  assert.equal(spanAfter.length, 1, "one tier left, so A4's two-tier assertion fails");
  assert.ok(!spanAfter.includes(350), "and the A/AA rung is empty again");
});

test("NC-4 — tierOf is the real matcher, and it rejects a label the form does not offer", () => {
  /* If this ever started returning a tier, A4 could pass on an invented vocabulary. The module's
     own rule is that an unrecognised label earns NO tier rather than a guessed one. */
  assert.equal(tierOf("N Co"), null);
  assert.equal(tierOf("AAA"), null);
  assert.equal(tierOf(""), null);
  assert.equal(tierOf(null), null);
});
