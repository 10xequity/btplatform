/**
 * Boomtown Platform — documents.js tests
 * File: worker/test/documents.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.30.0
 *
 * documents.js shipped in v0.28.0 with zero tests. This closes that.
 *
 * The weighting is deliberate. A published document version is HASHED and PINNED — a signature
 * points at the exact body_sha the signer saw and is never re-pointed (D-DOC-8). That makes a
 * publish irreversible in the only way that matters, so every test here is about a refusal that
 * has to happen BEFORE the hash exists. F-1 (a bracketed placeholder the {{…}} validator could
 * not see) and F-8 (a hardcoded company name) were both one publish away from being permanent.
 *
 * The literal-name test runs against a DEACTIVATED org on purpose. v0.28.0 scanned
 * `WHERE active = 1`, so a document naming a deactivated org published clean — F-11. The guard
 * now scans every non-deleted org, and this test is what stops that being narrowed again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDocTokens, tokenRefusal, literalOrgNames, slugify,
  NO_FALLBACK, DOC_TOKENS, DOC_TOKEN_NAMES,
  DOC_KINDS, APPLIES_TO, SIGNER_RULES, MAX_DOCUMENTS_PER_ORG,
} from "../src/documents.js";

/** Org 1 as it actually exists in production on 2026-07-26. */
const ORG1 = {
  id: 1, name: "Boomtown Volleyball", legal_entity: "Boomtown Athletics, LLC",
  legal_entity_short: "Boomtown", admin_email: "admin@boomtownvb.com",
  address_line1: "14200 E Alameda Ave", address_line2: "FieldhouseUSA",
  city: "Aurora", state: "CO", postal_code: "80012", rules_url: null,
};
/** Org 3, which holds zero published versions — the case that has never been exercised live. */
const ORG3 = { id: 3, name: "Queens Club", legal_entity: "Queens Club LLC", legal_entity_short: "Queens Club" };

/* ================= token resolution: the two-phase rule ================= */

test("resolveDocTokens: org tokens resolve, and the output carries no braces", () => {
  const r = resolveDocTokens("I release {{ENTITY}} ({{ENTITY_SHORT}}) at {{ORG_ADDRESS}}.", ORG1);
  assert.equal(r.ok, true);
  assert.match(r.text, /Boomtown Athletics, LLC/);
  assert.match(r.text, /14200 E Alameda Ave/);
  assert.ok(!r.text.includes("{{"), r.text);
});

test("resolveDocTokens: the same body resolves to a DIFFERENT party per org", () => {
  const body = "I release {{ENTITY}} from all claims.";
  const a = resolveDocTokens(body, ORG1).text;
  const b = resolveDocTokens(body, ORG3).text;
  assert.notEqual(a, b);
  assert.ok(!b.includes("Boomtown"), "F-8: Queens Club must not release Boomtown");
});

/* ================= no-fallback refusals ================= */

test("resolveDocTokens: an empty no-fallback token refuses and names itself", () => {
  const r = resolveDocTokens("Released by {{ENTITY}}.", { name: "X", legal_entity: "" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.empty, ["ENTITY"]);
  assert.ok(r.text.includes("{{ENTITY}}"), "the unresolved token stays visible rather than vanishing");
});

test("resolveDocTokens: every NO_FALLBACK token refuses when blank — none has an exception", () => {
  for (const name of NO_FALLBACK) {
    const r = resolveDocTokens(`x {{${name}}} y`, {});
    assert.equal(r.ok, false, `${name} did not refuse`);
    assert.deepEqual(r.empty, [name], `${name} refused for the wrong reason`);
  }
});

test("resolveDocTokens: a blank COSMETIC token drops silently instead of blocking", () => {
  const r = resolveDocTokens("Call us on {{ORG_PHONE}}.", { ...ORG1, phone: "" });
  assert.equal(r.ok, true);
  assert.ok(!r.text.includes("{{"), r.text);
});

test("resolveDocTokens: RULES_REFERENCE falls back rather than emitting a dead URL (D-WV-12)", () => {
  const withUrl = resolveDocTokens("Rules {{RULES_REFERENCE}}.", { ...ORG1, rules_url: "https://x.test/rules" });
  const without = resolveDocTokens("Rules {{RULES_REFERENCE}}.", { ...ORG1, rules_url: null });
  assert.match(withUrl.text, /https:\/\/x\.test\/rules/);
  assert.match(without.text, /posted at the facility/);
  assert.equal(without.ok, true);
});

/* ================= F-1: the placeholder the validator could not see ================= */

test("resolveDocTokens: a SQUARE-BRACKET placeholder refuses — this is F-1", () => {
  const r = resolveDocTokens("Opt out by emailing [MEDIA-OPTOUT-EMAIL].", ORG1);
  assert.equal(r.ok, false);
  assert.equal(r.badPlaceholder, "[MEDIA-OPTOUT-EMAIL]");
});

test("resolveDocTokens: angle brackets, TBD, XXX and rule-lines refuse too", () => {
  for (const body of ["Send to <ORG EMAIL>.", "Fee: TBD.", "Ref XXXX.", "Sign: ____________"]) {
    assert.equal(resolveDocTokens(body, ORG1).ok, false, `did not refuse: ${body}`);
  }
});

test("resolveDocTokens: ordinary bracketed prose is NOT a false positive", () => {
  // A refusal that fires on normal writing gets switched off, which is worse than no refusal.
  const r = resolveDocTokens("Play is at the facility (see §4) [see note].", ORG1);
  assert.equal(r.badPlaceholder, null);
  assert.equal(r.ok, true);
});

test("resolveDocTokens: a mistyped token is reported as unknown, not silently kept", () => {
  const r = resolveDocTokens("Mail {{ORG_MAIL}}.", ORG1);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ["ORG_MAIL"]);
});

test("resolveDocTokens: whitespace inside the braces still resolves", () => {
  assert.equal(resolveDocTokens("{{  ENTITY  }}", ORG1).ok, true);
});

test("resolveDocTokens: a token repeated ten times is reported once", () => {
  const r = resolveDocTokens("{{ENTITY}} ".repeat(10), { name: "X" });
  assert.deepEqual(r.empty, ["ENTITY"]);
});

/* ================= tokenRefusal names the blocker ================= */

test("tokenRefusal: the message names the offending token, never a generic error", () => {
  const msg = tokenRefusal(resolveDocTokens("{{ENTITY}} [FOO BAR] {{NOPE}}", {}));
  assert.match(msg, /\{\{ENTITY\}\}/);
  assert.match(msg, /\[FOO BAR\]/);
  assert.match(msg, /\{\{NOPE\}\}/);
});

test("tokenRefusal: a clean resolve produces no message at all", () => {
  assert.equal(tokenRefusal(resolveDocTokens("{{ENTITY}}", ORG1)), "");
});

/* ================= F-8 / F-11: the literal-name guard ================= */

test("literalOrgNames: catches a hardcoded company name — F-8", () => {
  const hits = literalOrgNames("I release Boomtown Athletics, LLC from all claims.",
    [{ name: "Boomtown Volleyball", legal_entity: "Boomtown Athletics, LLC" }]);
  assert.deepEqual(hits, ["Boomtown Athletics, LLC"]);
});

test("literalOrgNames: catches a DEACTIVATED org's name — F-11, the regression this exists for", () => {
  // Colorado Boom is active = 0. v0.28.0 scanned WHERE active = 1, so this published clean.
  // The guard now scans every non-deleted org. If this test starts failing, someone re-narrowed
  // the scan in documents.js — a guard must scan the widest set, not the narrowest.
  const allOrgs = [
    { name: "Boomtown Volleyball", legal_entity: "Boomtown Athletics, LLC", active: 1 },
    { name: "Colorado Boom", legal_entity: "Colorado Boom LLC", active: 0 },
  ];
  const hits = literalOrgNames("Play is operated by Colorado Boom at the fieldhouse.", allOrgs);
  assert.deepEqual(hits, ["Colorado Boom"]);
});

test("literalOrgNames: a token-only body is clean", () => {
  assert.deepEqual(literalOrgNames("I release {{ENTITY}}.",
    [{ name: "Boomtown Volleyball", legal_entity: "Boomtown Athletics, LLC" }]), []);
});

test("literalOrgNames: short and empty names cannot match everything", () => {
  assert.deepEqual(literalOrgNames("A cat sat on the mat.", [{ name: "A", legal_entity: "" }]), []);
  assert.deepEqual(literalOrgNames("anything", [{ name: null, legal_entity: null }]), []);
});

test("literalOrgNames: the same name found twice is reported once", () => {
  const hits = literalOrgNames("Queens Club and Queens Club again.",
    [{ name: "Queens Club", legal_entity: "Queens Club LLC" }]);
  assert.deepEqual(hits, ["Queens Club"]);
});

test("literalOrgNames: it WARNS rather than refusing — the caller decides", () => {
  // "Boomtown Fieldhouse" may legitimately appear in facility rules, so this returns hits and
  // leaves the refuse-or-override choice to the publish route (typed reason, standards §8.2).
  assert.equal(Array.isArray(literalOrgNames("x", [])), true);
});

/* ================= slugify ================= */

test("slugify: produces a usable slug and never an empty string", () => {
  assert.equal(slugify("Liability Waiver"), "liability-waiver");
  assert.equal(slugify("  Code of Conduct!  "), "code-of-conduct");
  assert.equal(slugify("!!!"), "document");
  assert.equal(slugify(""), "document");
  assert.equal(slugify(null), "document");
  assert.ok(slugify("x".repeat(200)).length <= 60);
});

/* ================= constants other modules depend on ================= */

test("the token registry and the no-fallback set stay in step", () => {
  for (const n of NO_FALLBACK) {
    assert.ok(DOC_TOKEN_NAMES.includes(n), `${n} is no-fallback but not in the registry`);
    assert.equal(typeof DOC_TOKENS[n], "function");
  }
});

test("no-fallback covers exactly the party-identity and address tokens (standards §11.2)", () => {
  assert.deepEqual([...NO_FALLBACK].sort(),
    ["ENTITY", "ENTITY_SHORT", "ORG_ADDRESS", "ORG_EMAIL", "ORG_NAME"]);
});

test("enumerations hold their shape", () => {
  assert.ok(DOC_KINDS.includes("waiver"));
  assert.deepEqual(APPLIES_TO, ["all", "adults", "minors", "staff"]);
  assert.deepEqual(SIGNER_RULES, ["self", "guardian", "either"]);
  assert.equal(MAX_DOCUMENTS_PER_ORG, 25);
});

/* ================= signer tokens are NOT resolved at publish (D-DOC-5) ================= */

test("signer tokens are absent from the publish-phase registry", () => {
  // Hashing a signer token would give every signature a different body_sha, making the version
  // unstable and comparison meaningless. They resolve at RENDER, in consent.js.
  for (const t of ["SIGNER_NAME", "MEMBER_NAME", "GUARDIAN_NAME", "CHILD_FIRST_NAME", "TODAY", "EXPIRES"]) {
    assert.equal(DOC_TOKENS[t], undefined, `${t} must not resolve at publish time`);
  }
});

test("an unresolved signer token is reported as unknown at publish, not substituted", () => {
  const r = resolveDocTokens("Signed by {{SIGNER_NAME}} on {{TODAY}}.", ORG1);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown.sort(), ["SIGNER_NAME", "TODAY"]);
});
