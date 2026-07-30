/**
 * Boomtown Platform — member-profile pure-helper tests
 * File: worker/test/profiles.test.mjs · Version: v1.0 · Date: 2026-07-29 · Ships in: v0.34.0
 *
 * First test coverage this module has ever had. profiles.js exported exactly two symbols
 * (wireProfiles, profileRoutes) until v1.4; everything below became testable under the
 * owner-approved Option A: export the pure helpers, test them, change no call sites.
 *
 * F-38 is guarded here structurally: profiles.js no longer owns any age arithmetic. ageOn is
 * imported from family.js and the one remaining date helper (monthsUntil18) takes an injected
 * `now` and computes in UTC — a test that passed in Denver and failed in CI's UTC runner is
 * exactly the machine-dependence Option A was chosen to avoid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventPoints, totals, displayName, publicContactFields, profileFields, monthsUntil18,
} from "../src/profiles.js";
import { ageOn } from "../src/family.js";

const NOW = new Date("2026-07-29T12:00:00Z");

/* ---------- eventPoints — the resume scoring rule ---------- */

test("eventPoints: 10 per win plus a 50/30/20 podium bonus", () => {
  assert.equal(eventPoints(0, null), 0);
  assert.equal(eventPoints(3, null), 30);
  assert.equal(eventPoints(3, 1), 80);
  assert.equal(eventPoints(3, 2), 60);
  assert.equal(eventPoints(3, 3), 50);
  assert.equal(eventPoints(3, 4), 30, "4th place earns no bonus");
});

test("eventPoints: missing wins count as zero, not NaN", () => {
  assert.equal(eventPoints(undefined, 1), 50);
  assert.equal(eventPoints(null, 2), 30);
});

/* ---------- totals — the resume rollup ---------- */

test("totals: sums wins/losses/points and takes the LOWEST rank as best finish", () => {
  const t = totals([
    { wins: 3, losses: 1, points: 80, rank: 2 },
    { wins: 2, losses: 2, points: 20, rank: 5 },
    { wins: 4, losses: 0, points: 90, rank: 1 },
  ]);
  assert.deepEqual(t, { events: 3, wins: 9, losses: 3, points: 190, best_finish: 1 });
});

test("totals: empty resume is zeros with best_finish null, not undefined", () => {
  assert.deepEqual(totals([]), { events: 0, wins: 0, losses: 0, points: 0, best_finish: null });
});

test("totals: a null rank never becomes the best finish", () => {
  const t = totals([{ wins: 1, losses: 0, points: 10, rank: null }, { wins: 0, losses: 1, points: 0, rank: 4 }]);
  assert.equal(t.best_finish, 4);
});

/* ---------- displayName — D9's public form: first name + last initial ---------- */

test("displayName: first name plus last initial, dotted and uppercased", () => {
  assert.equal(displayName("Jane Smith"), "Jane S.");
  assert.equal(displayName("Jane Anne van der Berg"), "Jane B.");
  assert.equal(displayName("  Jane   Smith  "), "Jane S.");
});

test("displayName: single names pass through; empty input gets the house fallback", () => {
  assert.equal(displayName("Cher"), "Cher");
  assert.equal(displayName(""), "Boomtown member");
  assert.equal(displayName(null), "Boomtown member");
});

/* ---------- publicContactFields — the privacy boundary in one function ---------- */

test("publicContactFields: a stranger gets id + display name and NOTHING else", () => {
  const out = publicContactFields({ id: 9, full_name: "Jane Smith", email: "jane@x.com", phone: "555" });
  assert.deepEqual(Object.keys(out).sort(), ["display_name", "id"]);
  assert.equal(out.display_name, "Jane S.");
});

test("publicContactFields: self=true adds full name and email — and still never the phone", () => {
  const out = publicContactFields({ id: 9, full_name: "Jane Smith", email: "jane@x.com", phone: "555" }, true);
  assert.equal(out.full_name, "Jane Smith");
  assert.equal(out.email, "jane@x.com");
  assert.equal("phone" in out, false, "phone is not a profile field, even to yourself");
});

/* ---------- profileFields — shape stability for the client ---------- */

test("profileFields: null profile stays null; avatar key becomes a URL, its absence becomes null", () => {
  assert.equal(profileFields(null), null);
  assert.equal(profileFields({ contact_id: 1, avatar_r2_key: "abc" }).avatar_url, "/api/avatar/abc");
  assert.equal(profileFields({ contact_id: 1, avatar_r2_key: null }).avatar_url, null);
});

test("profileFields: optional columns fall back to null via ??, never to undefined", () => {
  const p = profileFields({ contact_id: 1 });
  for (const k of ["positions", "skill_level", "gender_division", "height_reach"]) {
    assert.equal(p[k], null, `${k} must be null when absent — undefined vanishes in JSON`);
  }
});

/* ---------- monthsUntil18 — the turns_18_soon chip, F-38 basis check ---------- */

test("monthsUntil18: ~2 months out is inside the chip window, a year out is not", () => {
  const soon = monthsUntil18("2008-09-15", NOW); // 18 on 2026-09-15 — ~1.6 months from NOW
  assert.ok(soon > 0 && soon <= 2, `expected 0<m<=2, got ${soon}`);
  const far = monthsUntil18("2009-07-29", NOW);
  assert.ok(far > 11, `expected ~12, got ${far}`);
});

test("monthsUntil18: already 18 goes negative; garbage input is null, not NaN", () => {
  assert.ok(monthsUntil18("2008-01-01", NOW) < 0);
  assert.equal(monthsUntil18("not-a-date", NOW), null);
});

test("monthsUntil18 agrees with ageOn about the 18th-birthday boundary (F-38)", () => {
  // The day they turn 18, both sides of the arithmetic must flip together. Two date bases
  // (one local, one UTC) is how the door roster and the profile page said different things.
  const dob = "2008-07-29";
  assert.equal(ageOn(dob, NOW), 18, "ageOn says adult on the birthday");
  assert.ok(monthsUntil18(dob, NOW) <= 0, "monthsUntil18 agrees the birthday has arrived");
});

/* ---------- decision B (v0.37.0): the write-side age gate on visibility ----------
   The gate lives inside update(), which needs a DB — so this is a source-slice guard
   (same discipline as the F-27/F-39 read-gate guards) plus a direct test of the age
   decision it encodes. Together they fail if the gate is removed, narrowed to only
   'public', or flipped to fail-open on a NULL DOB. */
import { readFileSync } from "node:fs";
const PROFILES_SRC = readFileSync(new URL("../src/profiles.js", import.meta.url), "utf8");
const UPDATE_FN = PROFILES_SRC.slice(
  PROFILES_SRC.indexOf("async function update("),
  PROFILES_SRC.indexOf("async function avatarUpload(")
);

test("decision B: update() gates BOTH listable tiers, not just 'public'", () => {
  // The old defect guarded only 'public'; 'members' is equally listable under decision A.
  assert.match(UPDATE_FN, /visibility === "public" \|\| .*visibility === "members"/,
    "the listable check must cover 'members' as well as 'public'");
});

test("decision B: update() fails CLOSED on a missing DOB (dob_required)", () => {
  assert.match(UPDATE_FN, /effectiveDob === null \|\| effectiveAge === null/,
    "a NULL DOB must be refused, not allowed through");
  assert.match(UPDATE_FN, /reason: "dob_required"/);
});

test("decision B: update() refuses under-18 with a named reason, no silent downgrade", () => {
  assert.match(UPDATE_FN, /effectiveAge < 18/);
  assert.match(UPDATE_FN, /reason: "minor_not_listable"/);
  // The old line-199 silent rewrite must be gone — no assignment of visibility to "members".
  assert.doesNotMatch(UPDATE_FN, /fields\.visibility = "members"/,
    "found a silent downgrade; decision B rejects instead of rewriting the user's choice");
});

test("decision B negative control: the source-slice guard can actually fail", () => {
  const mutated = UPDATE_FN
    .replace(/effectiveDob === null \|\| effectiveAge === null/g, "false")
    .replace(/reason: "dob_required"/g, "");
  assert.doesNotMatch(mutated, /effectiveDob === null \|\| effectiveAge === null/);
  assert.doesNotMatch(mutated, /reason: "dob_required"/);
});

test("decision B: the age boundary the gate relies on (ageOn) treats 17 as a minor, 18 as adult", () => {
  assert.equal(ageOn("2009-07-29", NOW), 17); // blocked from listing
  assert.equal(ageOn("2008-07-29", NOW), 18); // allowed
  assert.equal(ageOn(null, NOW), null);        // fails closed at the gate
});
