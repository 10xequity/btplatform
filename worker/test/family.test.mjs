/**
 * Boomtown Platform — families, minors and waiver-token tests
 * File: worker/test/family.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.27.0
 *
 * The fail-closed direction is asserted explicitly throughout. An unknown age must never resolve
 * to "adult", because the consequence is a minor signing their own waiver — a void document that
 * the front desk believes is valid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageOn, isMinor, validateBirthdate, guardianGate, signerFor, ageOutState,
  separationRequirements, displayName, normalizeDominantHand, familyNameFor,
  AGE_OF_MAJORITY, DOMINANT_HANDS,
} from "../src/family.js";
import {
  resolveWaiverTokens, tokensUsed, tokenFailureMessage, TOKEN_NAMES,
} from "../src/waivers.js";

const NOW = new Date("2026-07-26T12:00:00Z");

/* ---------- ageOn ---------- */

test("ageOn counts whole years completed", () => {
  assert.equal(ageOn("2008-07-26", NOW), 18, "birthday today = 18");
  assert.equal(ageOn("2008-07-27", NOW), 17, "birthday tomorrow = still 17");
  assert.equal(ageOn("2008-07-25", NOW), 18);
  assert.equal(ageOn("1990-01-01", NOW), 36);
});

test("ageOn handles leap-day birthdates", () => {
  assert.equal(ageOn("2008-02-29", NOW), 18);
});

test("ageOn returns null for unusable input rather than guessing", () => {
  for (const bad of [null, "", "not-a-date", "26-07-2008", "2026-02-30", "2026-13-01"]) {
    assert.equal(ageOn(bad, NOW), null, `${bad} should be null`);
  }
});

test("ageOn returns null for a future birthdate", () => {
  assert.equal(ageOn("2030-01-01", NOW), null);
});

/* ---------- isMinor — the fail-closed core ---------- */

test("isMinor uses 18 as the boundary, inclusive of the birthday", () => {
  assert.equal(AGE_OF_MAJORITY, 18);
  assert.equal(isMinor("2008-07-26", NOW), false, "turns 18 today = adult");
  assert.equal(isMinor("2008-07-27", NOW), true, "turns 18 tomorrow = still a minor");
  assert.equal(isMinor("2012-01-01", NOW), true);
});

test("isMinor FAILS CLOSED on unknown or corrupt birthdates", () => {
  // This is the assertion that stops a child self-signing. "Unknown" must mean "minor".
  for (const bad of [null, undefined, "", "garbage", "2030-01-01"]) {
    assert.equal(isMinor(bad, NOW), true, `${bad} must be treated as a minor`);
  }
});

/* ---------- validateBirthdate ---------- */

test("validateBirthdate rejects malformed, future and implausible dates", () => {
  assert.equal(validateBirthdate("nope", NOW).ok, false);
  assert.equal(validateBirthdate("2030-01-01", NOW).ok, false);
  assert.match(validateBirthdate("2030-01-01", NOW).error, /future/);
  assert.equal(validateBirthdate("1850-01-01", NOW).ok, false);
  assert.match(validateBirthdate("1850-01-01", NOW).error, /120/);
  const ok = validateBirthdate("2010-05-05", NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.minor, true);
  assert.equal(ok.age, 16);
});

/* ---------- guardianGate — the gate that must not be bypassable ---------- */

const adult = { id: 5, date_of_birth: "1985-03-03" };
const teen  = { id: 6, date_of_birth: "2010-01-01" };

test("an adult passes with no guardian at all", () => {
  const r = guardianGate({ dateOfBirth: "1990-01-01", guardian: null, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.minor, false);
});

test("a minor with NO guardian is blocked with 409, not silently allowed", () => {
  const r = guardianGate({ dateOfBirth: "2012-06-01", guardian: null, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "guardian_required");
  assert.equal(r.status, 409);
  assert.match(r.error, /parent or guardian/i);
});

test("a minor WITH an adult guardian passes and records the link", () => {
  const r = guardianGate({ dateOfBirth: "2012-06-01", guardian: adult, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.minor, true);
  assert.equal(r.guardian_contact_id, 5);
});

test("a MINOR cannot be someone else's guardian", () => {
  // A 16-year-old must not be nominated as guardian for a 14-year-old sibling.
  const r = guardianGate({ dateOfBirth: "2014-01-01", guardian: teen, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "guardian_is_minor");
});

test("a guardian with NO birthdate on file is rejected, not assumed adult", () => {
  const r = guardianGate({ dateOfBirth: "2014-01-01", guardian: { id: 9 }, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "guardian_is_minor");
});

test("a missing birthdate blocks the whole gate", () => {
  const r = guardianGate({ dateOfBirth: null, guardian: adult, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad_dob");
  assert.equal(r.status, 400);
});

/* ---------- signerFor ---------- */

test("an adult signs for themselves", () => {
  const s = signerFor({ contact: { id: 11 }, dateOfBirth: "1990-01-01", now: NOW });
  assert.deepEqual(s, { signer_contact_id: 11, subject_contact_id: 11, on_behalf: 0 });
});

test("a minor NEVER signs for themselves — the guardian is the signer", () => {
  const s = signerFor({ contact: { id: 12 }, dateOfBirth: "2012-01-01", guardian: adult, now: NOW });
  assert.equal(s.signer_contact_id, 5);
  assert.equal(s.subject_contact_id, 12);
  assert.equal(s.on_behalf, 1);
});

test("signerFor refuses to guess when a minor has no guardian", () => {
  assert.equal(signerFor({ contact: { id: 12 }, dateOfBirth: "2012-01-01", now: NOW }), null);
});

/* ---------- ageOutState ---------- */

test("a minor is in 'minor' state and does not self-sign", () => {
  const s = ageOutState({ dateOfBirth: "2012-01-01", now: NOW });
  assert.equal(s.state, "minor");
  assert.equal(s.self_signs, false);
  assert.equal(s.prompt, false);
});

test("turning 18 with no choice recorded raises the prompt exactly once", () => {
  const s = ageOutState({ dateOfBirth: "2008-07-26", guardianship: {}, now: NOW });
  assert.equal(s.state, "prompt");
  assert.equal(s.prompt, true);
  assert.equal(s.self_signs, false, "still not self-signing until the choice is made");
});

test("'kept' keeps the guardian signing and allows separating later", () => {
  const s = ageOutState({ dateOfBirth: "2005-01-01", guardianship: { separation_choice: "kept" }, now: NOW });
  assert.equal(s.state, "kept");
  assert.equal(s.self_signs, false);
  assert.equal(s.may_separate, true);
  assert.equal(s.prompt, false);
});

test("'separated' flips to self-signing", () => {
  const s = ageOutState({
    dateOfBirth: "2005-01-01",
    guardianship: { separation_choice: "separated", separated_at: "2026-07-01 00:00:00" },
    now: NOW,
  });
  assert.equal(s.state, "separated");
  assert.equal(s.self_signs, true);
  assert.equal(s.separated_at, "2026-07-01 00:00:00");
});

test("a recorded choice does NOT apply while the member is still a minor", () => {
  // Guards against a stray choice value aging someone out early.
  const s = ageOutState({ dateOfBirth: "2012-01-01", guardianship: { separation_choice: "separated" }, now: NOW });
  assert.equal(s.state, "minor");
  assert.equal(s.self_signs, false);
});

/* ---------- separationRequirements ---------- */

test("separating requires re-signing and blocks participation until it happens", () => {
  const r = separationRequirements({ hasLiveWaiver: true });
  assert.deepEqual(r.resign, ["waiver"]);
  assert.equal(r.blocks_participation, true);
  assert.match(r.note, /don't transfer/);
});

test("separating with nothing signed requires nothing", () => {
  const r = separationRequirements({});
  assert.deepEqual(r.resign, []);
  assert.equal(r.blocks_participation, false);
});

/* ---------- displayName — the child-safety one ---------- */

test("public views abbreviate the surname and do NOT mark minors", () => {
  // Publishing "(M)" openly would hand anyone a list of which children are on which court.
  assert.equal(displayName("Ava Reyes", { minor: true, visibility: "public" }), "Ava R.");
  assert.equal(displayName("Ava Reyes", { minor: false, visibility: "public" }), "Ava R.");
});

test("internal and staff views DO mark minors", () => {
  assert.equal(displayName("Ava Reyes", { minor: true, visibility: "internal" }), "Ava R. (M)");
  assert.equal(displayName("Ava Reyes", { minor: true, visibility: "staff" }), "Ava R. (M)");
  assert.equal(displayName("Ava Reyes", { minor: false, visibility: "staff" }), "Ava R.");
});

test("displayName handles single names, extra spaces and empties", () => {
  assert.equal(displayName("Prince", { minor: false }), "Prince");
  assert.equal(displayName("  Ana   Maria  Sol  ", { minor: false }), "Ana S.");
  assert.equal(displayName("", { minor: true, visibility: "staff" }), "");
  assert.equal(displayName(null, {}), "");
});

test("an unknown visibility does not leak the minor marker", () => {
  assert.equal(displayName("Ava Reyes", { minor: true, visibility: "publik" }), "Ava R.");
});

/* ---------- dominant hand ---------- */

test("dominant hand accepts the whitelist, case-insensitively", () => {
  for (const h of DOMINANT_HANDS) {
    assert.equal(normalizeDominantHand(h.toUpperCase()).value, h);
  }
  assert.equal(normalizeDominantHand("").value, null);
  assert.equal(normalizeDominantHand(null).value, null);
});

test("dominant hand rejects free text — it reaches the public player card", () => {
  const r = normalizeDominantHand("<script>alert(1)</script>");
  assert.equal(r.ok, false);
  assert.match(r.error, /left, right, ambidextrous/);
});

test("familyNameFor uses the surname", () => {
  assert.equal(familyNameFor("Marco Reyes"), "Reyes Family");
  assert.equal(familyNameFor("Prince"), "Prince Family");
  assert.equal(familyNameFor(""), "Family");
});

/* ---------- waiver tokens ---------- */

const ORG = {
  name: "Match Point Social",
  admin_email: "admin@matchptsocial.com",
  website: "matchptsocial.com",
  phone: "303-555-0100",
  address_line1: "14200 E Alameda Ave",
  address_line2: "FieldhouseUSA",
  city: "Aurora", state: "CO", postal_code: "80012",
};

test("tokensUsed lists each token once, in order", () => {
  assert.deepEqual(
    tokensUsed("{{ORG_NAME}} and {{ORG_EMAIL}} and {{ORG_NAME}} again"),
    ["ORG_NAME", "ORG_EMAIL"]
  );
  assert.deepEqual(tokensUsed("no tokens here"), []);
  assert.deepEqual(tokensUsed(null), []);
});

test("resolveWaiverTokens substitutes org identity", () => {
  const r = resolveWaiverTokens("Write to {{MEDIA_OPTOUT_EMAIL}} about {{ORG_NAME}}.", ORG);
  assert.equal(r.ok, true);
  assert.equal(r.text, "Write to admin@matchptsocial.com about Match Point Social.");
});

test("ENTITY is separate from ORG_NAME — the legal person vs the brand", () => {
  const r = resolveWaiverTokens("{{ENTITY}} trading as {{ORG_NAME}}", ORG);
  assert.equal(r.text, "Boomtown Athletics, LLC trading as Match Point Social");
});

test("the address renders from the org's own fields", () => {
  const r = resolveWaiverTokens("{{ORG_ADDRESS}}", ORG);
  assert.equal(r.text, "14200 E Alameda Ave · FieldhouseUSA · Aurora, CO · 80012");
});

test("an UNKNOWN token refuses to publish and is left visible", () => {
  const r = resolveWaiverTokens("Contact {{ORG_MAIL}}", ORG);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ["ORG_MAIL"]);
  assert.match(r.text, /\{\{ORG_MAIL\}\}/, "the placeholder stays so the failure is obvious");
  assert.match(tokenFailureMessage(r), /Unknown token/);
});

test("an EMPTY org value refuses to publish", () => {
  // A waiver promising a written decline path to a blank address has no decline path.
  const r = resolveWaiverTokens("Write to {{MEDIA_OPTOUT_EMAIL}}", { name: "Oda Up" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.empty, ["MEDIA_OPTOUT_EMAIL"]);
  assert.match(tokenFailureMessage(r), /no value for/);
});

test("token syntax tolerates internal whitespace", () => {
  assert.equal(resolveWaiverTokens("{{  ORG_NAME  }}", ORG).text, "Match Point Social");
});

test("the token registry is stable and documented", () => {
  for (const t of ["ENTITY", "ORG_NAME", "ORG_EMAIL", "MEDIA_OPTOUT_EMAIL", "ORG_ADDRESS"]) {
    assert.ok(TOKEN_NAMES.includes(t), `${t} must be a valid token`);
  }
});
