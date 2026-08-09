/**
 * Boomtown Platform — §-1i S-3b: the one unauthenticated write, bounded
 * File: worker/test/auth_rate_limit.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.117.0
 *
 * WHY. `POST /api/auth/request-link` is the only route an anonymous caller can make WRITE:
 * every call INSERTs a `magic_links` row, and once `BREVO_API_KEY` is set every call also
 * emails an arbitrary third-party address. Unbounded, that is a mailbomb service with our
 * name on the From line, and a table that grows at the attacker's pace. The owner settled
 * that the sandbox login STAYS until go-live (2026-08-09), so bounding how fast the route
 * can be abused is the remaining lever — S-3b.
 *
 * THE GUARD IS COPIED, NOT INVENTED (the standing rule): messages.js's flood shape —
 * COUNT rows in a window per actor, `overFlood(count, limit)`, refuse 429 with a human
 * sentence. The actor here is the TARGET EMAIL; the windows are a band (constraint-band
 * lesson): LINKS_PER_WINDOW per link-TTL window (the window is DERIVED from
 * MAGIC_LINK_TTL_MIN — two numbers from one judgement), LINKS_PER_DAY per day.
 *
 * PLACEMENT IS THE POINT, and it is tested BEHAVIOURALLY: the guard lives inside
 * `sendLoginLink`, NOT on the route — `security.js rescueLink` and `family.js` call the
 * same function, and a route-level guard would leave both doors open (the S-4b lesson).
 * The rescue-door test below fails against a route-level implementation by construction.
 *
 * WHAT MUST NOT CHANGE: `requestLink` behaves identically for a known and an unknown
 * address (no user enumeration). The 429 must hold that line too — asserted byte-identical.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function makeEnv() {
  return { DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
  return { status: res.status, data, raw: text };
}

const ask = (env, email) => call(env, "POST", "/api/auth/request-link", { body: { email } });

/** Ask up to the cap for one address; every request inside the cap must succeed. */
async function fillWindow(env, email, cap = 5) {
  for (let i = 1; i <= cap; i++) {
    const r = await ask(env, email);
    assert.equal(r.status, 200, `request ${i}/${cap} for ${email} should pass: ${JSON.stringify(r.data).slice(0, 200)}`);
  }
}

test("the 6th sign-in link inside the window is refused, and the refusal writes NOTHING", async () => {
  const env = makeEnv();
  await fillWindow(env, "flood@boomtown.test", 5);

  const sixth = await ask(env, "flood@boomtown.test");
  assert.equal(sixth.status, 429,
    "an anonymous caller minted a 6th magic link inside the window — the route is unbounded " +
    "and becomes a mailbomb service the day BREVO_API_KEY is set");
  const rows = env.DB.query("SELECT id FROM magic_links WHERE email = ?", "flood@boomtown.test");
  assert.equal(rows.length, 5, `the refusal itself INSERTed — ${rows.length} rows for a capped address`);

  // NC (keying): while that address is capped, a different address is untouched.
  const other = await ask(env, "calm@boomtown.test");
  assert.equal(other.status, 200, "the cap leaked across addresses — it must key on the target email");
  const capped = await ask(env, "flood@boomtown.test");
  assert.equal(capped.status, 429, "mutation did not land — the capped address was no longer capped");
});

test("the window CLEARS: backdating the real rows past the TTL window frees the address", async () => {
  const env = makeEnv();
  await fillWindow(env, "waiter@boomtown.test", 5);
  assert.equal((await ask(env, "waiter@boomtown.test")).status, 429, "cap must be in force first");

  // Mutate the REAL input the guard counts: age every row past the 15-minute TTL window.
  env.DB.exec("UPDATE magic_links SET created_at = datetime('now','-16 minutes') WHERE email = 'waiter@boomtown.test'");
  const aged = env.DB.query(
    "SELECT COUNT(*) AS n FROM magic_links WHERE email = ? AND created_at >= datetime('now','-15 minutes')",
    "waiter@boomtown.test");
  assert.equal(aged[0].n, 0, "mutation did not land — rows still inside the window");

  const after = await ask(env, "waiter@boomtown.test");
  assert.equal(after.status, 200,
    "the window never clears — the guard counts rows for all time, which locks a member out " +
    "of their own account forever after one impatient evening");
});

test("the DAY band holds even when the short window is clear", async () => {
  const env = makeEnv();
  // Seed the real table: 20 links spread earlier today, none inside the short window.
  for (let i = 0; i < 20; i++) {
    env.DB.exec("INSERT INTO magic_links (email, token_hash, expires_at, created_at) " +
      `VALUES ('heavy@boomtown.test', 'seed-hash-${i}', datetime('now','+15 minutes'), datetime('now','-${i + 60} minutes'))`);
  }
  const r = await ask(env, "heavy@boomtown.test");
  assert.equal(r.status, 429,
    "20 links today did not trip the day band — an attacker pacing one request per TTL window " +
    "mails a victim ~96 times a day and the short window never notices");

  // NC: the same volume spread over MORE than a day does not trip it.
  const env2 = makeEnv();
  for (let i = 0; i < 20; i++) {
    env2.DB.exec("INSERT INTO magic_links (email, token_hash, expires_at, created_at) " +
      `VALUES ('slow@boomtown.test', 'old-hash-${i}', datetime('now','+15 minutes'), datetime('now','-${i + 1} days'))`);
  }
  assert.equal((await ask(env2, "slow@boomtown.test")).status, 200,
    "links older than a day counted against the day band — the guard never forgets");
});

test("the 429 does not become a user-enumeration oracle: identical for known and unknown addresses", async () => {
  const env = makeEnv();
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");

  // known@ becomes a REAL user (request + verify), then burns the rest of its window.
  const first = await ask(env, "known@boomtown.test");
  const token = String(first.data.dev_link).split("token=")[1];
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(verified.status, 200, "setup: verify must succeed to create the known user");
  for (let i = 0; i < 4; i++) assert.equal((await ask(env, "known@boomtown.test")).status, 200);

  await fillWindow(env, "stranger@boomtown.test", 5); // no such user, same treatment

  const knownCapped = await ask(env, "known@boomtown.test");
  const unknownCapped = await ask(env, "stranger@boomtown.test");
  assert.equal(knownCapped.status, 429, "known address should be capped by now");
  assert.equal(unknownCapped.status, 429, "unknown address should be capped by now");
  assert.equal(knownCapped.raw, unknownCapped.raw,
    "the 429 body differs between an existing and a non-existing account — the rate limit " +
    "just became the user-enumeration oracle the login flow was built to avoid");
});

test("the staff rescue door is bounded by the SAME guard (placement: sendLoginLink, not the route)", async () => {
  const env = makeEnv();
  env.DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");

  // Bootstrap the first-ever user as admin (F-12), on a throwaway address.
  const boot = await ask(env, "boot-admin@boomtown.test");
  const token = String(boot.data.dev_link).split("token=")[1];
  const admin = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(admin.status, 200, "setup: bootstrap admin sign-in failed");
  const staffToken = admin.data.token;

  // The member needs rescuing — but their address was just flooded by an attacker.
  env.DB.exec("INSERT INTO users (email) VALUES ('victim@boomtown.test')");
  await fillWindow(env, "victim@boomtown.test", 5);

  const rescue = await call(env, "POST", "/api/admin/security/rescue-link",
    { token: staffToken, body: { email: "victim@boomtown.test" } });
  assert.equal(rescue.status, 429,
    "rescue-link minted a link for a flooded address — the guard sits on the ROUTE, not in " +
    "sendLoginLink, and every other caller of sendLoginLink is still an open door");

  // NC: rescue itself still works for a quiet address — the 429 above is the guard, not a
  // broken rescue route.
  env.DB.exec("INSERT INTO users (email) VALUES ('quiet@boomtown.test')");
  const ok = await call(env, "POST", "/api/admin/security/rescue-link",
    { token: staffToken, body: { email: "quiet@boomtown.test" } });
  assert.equal(ok.status, 200, `rescue for a quiet address failed — the probe proves nothing: ${JSON.stringify(ok.data).slice(0, 200)}`);
});
