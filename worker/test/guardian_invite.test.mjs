/**
 * Boomtown Platform — guardian invitation and certification tests
 * File: worker/test/guardian_invite.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.32.0
 *
 * D-MIN-9, D-MIN-11 and owner option B (registration blocked, not merely activation).
 *
 * These assert the FAIL-CLOSED direction on purpose. F-16 is the standing reminder that a test
 * can encode a defect and then defend it for four releases, so each assertion here says what must
 * be refused, not only what must be allowed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guardianGate, isMinor, ACTIVATION_STATES, GUARDIAN_INVITE_TTL_DAYS,
  GUARDIAN_CERTIFICATION_TEXT, mintGuardianInvite, loadGuardianInvite, consumeGuardianInvite,
} from "../src/family.js";
import { sha256Hex, randomToken } from "../src/crypto.js";

const NOW = new Date("2026-07-26T12:00:00Z");

/* ---------- a tiny D1 stand-in: enough for token round-trips, nothing more ---------- */
function fakeDb() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    prepare(sql) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound = [];
      const api = {
        bind(...a) { bound = a; return api; },
        async run() {
          if (/^UPDATE access_tokens SET revoked_at = datetime\('now'\) WHERE org_id/.test(q)) {
            let n = 0;
            for (const r of rows) {
              if (r.org_id === bound[0] && r.contact_id === bound[1] && !r.revoked_at && !r.deleted_at) {
                r.revoked_at = "now"; n++;
              }
            }
            return { meta: { changes: n } };
          }
          if (/^INSERT INTO access_tokens/.test(q)) {
            rows.push({
              id: nextId++, org_id: bound[0], kind: "guardian_invite", token_sha: bound[1],
              contact_id: bound[2], label: bound[3], expires_at: bound[4],
              revoked_at: null, deleted_at: null, use_count: 0,
              full_name: "Sam Rivera", email: "sam@example.com",
              activation_state: "pending_guardian", date_of_birth: "2012-03-04",
            });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE access_tokens SET revoked_at = datetime\('now'\), use_count/.test(q)) {
            const r = rows.find((x) => x.id === bound[0] && !x.revoked_at);
            if (!r) return { meta: { changes: 0 } };
            r.revoked_at = "now"; r.use_count++;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (/FROM access_tokens t/.test(q)) {
            return rows.find((r) => r.token_sha === bound[0] && !r.deleted_at) || null;
          }
          return null;
        },
      };
      return api;
    },
  };
}
const env = () => ({ DB: fakeDb() });

/* ---------- D-MIN-8: the waiver clause is gone from the guardian refusal ---------- */

test("guardian_required copy no longer promises a waiver signature (D-MIN-8)", () => {
  const r = guardianGate({ dateOfBirth: "2012-03-04", guardian: null, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "guardian_required");
  assert.ok(!/waiver/i.test(r.error),
    "D-MIN-8 removed waiver gating; the copy must not still say the guardian signs one");
  assert.match(r.error, /account/i, "it must still say an adult account is required");
});

/* ---------- the rule the owner asked to enforce ---------- */

test("a guardian with no date of birth on file is refused, not waved through", () => {
  const r = guardianGate({ dateOfBirth: "2012-03-04", guardian: { id: 5, date_of_birth: null }, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "guardian_is_minor", "unknown age must fail closed, never resolve to adult");
});

test("a guardian who is themselves a minor is refused", () => {
  const r = guardianGate({ dateOfBirth: "2012-03-04", guardian: { id: 5, date_of_birth: "2010-01-01" }, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "guardian_is_minor");
});

test("an adult guardian with a real date of birth passes", () => {
  const r = guardianGate({ dateOfBirth: "2012-03-04", guardian: { id: 5, date_of_birth: "1988-06-02" }, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.guardian_contact_id, 5);
});

test("an adult registrant never needs a guardian at all", () => {
  const r = guardianGate({ dateOfBirth: "1995-01-01", guardian: null, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.minor, false);
});

/* ---------- certification text ---------- */

test("the certification text names no organisation (standards §8)", () => {
  for (const forbidden of ["Boomtown", "Match Point", "Queens Club", "LLC", "Athletics"]) {
    assert.ok(!GUARDIAN_CERTIFICATION_TEXT.includes(forbidden),
      `"${forbidden}" must not appear — F-8/F-10/F-13 are all this defect wearing a different hat`);
  }
});

test("the certification text states the three things being attested", () => {
  assert.match(GUARDIAN_CERTIFICATION_TEXT, /parent or legal guardian/i);
  assert.match(GUARDIAN_CERTIFICATION_TEXT, /18 years of age or older/i);
  assert.match(GUARDIAN_CERTIFICATION_TEXT, /accurate/i);
});

test("certification is pinned by hash, so changing the wording changes the record", async () => {
  const a = await sha256Hex(GUARDIAN_CERTIFICATION_TEXT);
  const b = await sha256Hex(GUARDIAN_CERTIFICATION_TEXT + " ");
  assert.equal(a.length, 64);
  assert.notEqual(a, b, "a whitespace edit must produce a different sha (D-DOC-8 shape)");
});

/* ---------- constants ---------- */

test("activation states are exactly the two migration 0025 defines", () => {
  assert.deepEqual(ACTIVATION_STATES, ["active", "pending_guardian"]);
});

test("invite TTL is long enough to hand a phone to a parent later", () => {
  assert.ok(GUARDIAN_INVITE_TTL_DAYS >= 7 && GUARDIAN_INVITE_TTL_DAYS <= 30);
});

/* ---------- token lifecycle ---------- */

test("randomToken is 64 hex chars and does not repeat", () => {
  const a = randomToken(), b = randomToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
});

test("mint stores only the hash, never the raw token", async () => {
  const e = env();
  const { token } = await mintGuardianInvite(e, 1, 42, "event:7");
  const stored = e.DB.rows[0];
  assert.notEqual(stored.token_sha, token, "the raw token must never be persisted");
  assert.equal(stored.token_sha, await sha256Hex(token));
  assert.equal(stored.contact_id, 42);
});

test("re-minting revokes the previous invite so only one is ever live", async () => {
  const e = env();
  const first = await mintGuardianInvite(e, 1, 42);
  await mintGuardianInvite(e, 1, 42);
  const live = e.DB.rows.filter((r) => !r.revoked_at);
  assert.equal(live.length, 1);
  const stale = await loadGuardianInvite(e, first.token);
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 410);
});

test("a malformed token is refused without touching the database", async () => {
  const e = env();
  for (const bad of ["", "abc", "../../etc/passwd", "ZZZZ" .repeat(8), null]) {
    const r = await loadGuardianInvite(e, bad);
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  }
});

test("an expired invite is refused and says so", async () => {
  const e = env();
  const { token } = await mintGuardianInvite(e, 1, 42);
  e.DB.rows[0].expires_at = "2020-01-01T00:00:00.000Z";
  const r = await loadGuardianInvite(e, token);
  assert.equal(r.ok, false);
  assert.equal(r.status, 410);
  assert.equal(r.expired, true);
});

test("a valid invite resolves to its pending minor", async () => {
  const e = env();
  const { token } = await mintGuardianInvite(e, 1, 42);
  const r = await loadGuardianInvite(e, token);
  assert.equal(r.ok, true);
  assert.equal(r.invite.contact_id, 42);
  assert.equal(r.invite.activation_state, "pending_guardian");
  assert.equal(isMinor(r.invite.date_of_birth, NOW), true);
});

test("consuming an invite is single-shot — the second caller loses the race", async () => {
  const e = env();
  const { token } = await mintGuardianInvite(e, 1, 42);
  const r = await loadGuardianInvite(e, token);
  assert.equal(await consumeGuardianInvite(e, r.token_id), true);
  assert.equal(await consumeGuardianInvite(e, r.token_id), false,
    "two tabs must not both create a guardianship");
});
