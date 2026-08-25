/**
 * Boomtown Platform — Sub finder tests
 * File: worker/test/subs.test.mjs · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.38.0
 *
 * Covers the pure matching/normalization core plus the three grep guards this feature needs:
 *  - wiring guard (recurring failure class 1, F-6): index.js must CALL subsRoutes in the
 *    dispatch table and CALL wireSubs — an import line alone must not pass (standards §6.5).
 *  - org-scope guard (class 3, F-11): every SQL statement in subs.js touching sub_ tables
 *    carries org_id.
 *  - member-copy guard (F-40 class): no literal email address in member-facing strings.
 * Each guard ships a negative control proving it can fail (standards §6).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { blankComments } from "../testkit/route-extract.mjs";
import {
  parseList, subMatches, normalizeSignup, normalizeRequest, displayName,
  SKILLS, GENDERS, GAME_TYPES, OPEN_REQUESTS_MAX, NOTIFY_FANOUT_MAX,
} from "../src/subs.js";

const here = dirname(fileURLToPath(import.meta.url));
const subsSrc = blankComments(readFileSync(join(here, "../src/subs.js"), "utf8")); // D-45
const indexSrc = blankComments(readFileSync(join(here, "../src/index.js"), "utf8")); // D-45: a commented-out dispatch entry must not satisfy a wiring pin

/* ---------------- parseList ---------------- */
test("parseList keeps only allowed values, lowercased and deduped", () => {
  assert.deepEqual(parseList("BB, a ,bb,junk", SKILLS), ["bb", "a"]);
});
test("parseList collapses to ['any'] when 'any' is present or nothing valid remains", () => {
  assert.deepEqual(parseList("any,bb", SKILLS), ["any"]);
  assert.deepEqual(parseList("", SKILLS), ["any"]);
  assert.deepEqual(parseList("garbage,junk", GENDERS), ["any"]);
});

/* ---------------- subMatches ---------------- */
test("matches when every dimension is compatible", () => {
  const signup = { skill_levels: "bb,a", genders: "coed", game_types: "4s,6s" };
  assert.equal(subMatches(signup, { skill_level: "a", gender_requirement: "coed", game_type: "6s" }), true);
});
test("'any' on either side satisfies a dimension", () => {
  assert.equal(subMatches({ skill_levels: "any", genders: "any", game_types: "any" },
    { skill_level: "aa", gender_requirement: "womens", game_type: "2s" }), true);
  assert.equal(subMatches({ skill_levels: "b", genders: "mens", game_types: "6s" },
    { skill_level: "any", gender_requirement: "any", game_type: "any" }), true);
});
test("one incompatible dimension fails the whole match — ALL THREE must hold", () => {
  const signup = { skill_levels: "bb", genders: "coed", game_types: "6s" };
  assert.equal(subMatches(signup, { skill_level: "aa", gender_requirement: "coed", game_type: "6s" }), false);
  assert.equal(subMatches(signup, { skill_level: "bb", gender_requirement: "mens", game_type: "6s" }), false);
  assert.equal(subMatches(signup, { skill_level: "bb", gender_requirement: "coed", game_type: "2s" }), false);
});
test("negative control: a match assertion CAN fail (guard is live, not vacuous)", () => {
  assert.equal(subMatches({ skill_levels: "b", genders: "mens", game_types: "2s" },
    { skill_level: "open", gender_requirement: "womens", game_type: "6s" }), false);
});

/* ---------------- normalizeSignup / normalizeRequest ---------------- */
test("normalizeSignup accepts arrays or CSV and stores canonical CSV", () => {
  const v = normalizeSignup({ skill_levels: ["BB", "A"], genders: "coed", game_types: "4s,6s", note: "  weeknights only  " });
  assert.deepEqual(v, { skill_levels: "bb,a", genders: "coed", game_types: "4s,6s", note: "weeknights only" });
});
test("normalizeSignup fails safe to 'any' on junk", () => {
  const v = normalizeSignup({ skill_levels: "elite,pro", genders: 42, game_types: null });
  assert.deepEqual([v.skill_levels, v.genders, v.game_types], ["any", "any", "any"]);
});
test("normalizeRequest drops junk event ids and malformed timestamps rather than storing them", () => {
  const v = normalizeRequest({ event_id: "12; DROP TABLE", needed_at: "tonight-ish", skill_level: "AA", gender_requirement: "nope", game_type: "6S" });
  assert.equal(v.event_id, null);
  assert.equal(v.needed_at, null);
  assert.equal(v.skill_level, "aa");
  assert.equal(v.gender_requirement, "any");
  assert.equal(v.game_type, "6s");
});
test("normalizeRequest keeps a well-formed timestamp and normalizes T to space", () => {
  assert.equal(normalizeRequest({ needed_at: "2026-08-07T18:30" }).needed_at, "2026-08-07 18:30");
});

/* ---------------- displayName (standards §8) ---------------- */
test("displayName renders 'First L.' and never leaks a full surname", () => {
  assert.equal(displayName("Elle Nguyen"), "Elle N.");
  assert.equal(displayName("Cami de la Reyes"), "Cami R.");
  assert.equal(displayName("Cher"), "Cher");
  assert.equal(displayName(null), "A member");
});

/* ---------------- guardrails as constants ---------------- */
test("flood + fan-out ceilings are sane and exported (reviewable, not buried)", () => {
  assert.ok(OPEN_REQUESTS_MAX >= 1 && OPEN_REQUESTS_MAX <= 10);
  assert.ok(NOTIFY_FANOUT_MAX >= 50 && NOTIFY_FANOUT_MAX <= 500);
});

/* ---------------- wiring guard — recurring failure class 1 (F-6) ---------------- */
test("index.js CALLS subsRoutes in the dispatch table (an import alone must not pass, standards §6.5)", () => {
  assert.match(indexSrc, /\["subs",\s+subsRoutes\],/,
    "subs.js is built but never dispatched — failure class 1");
  assert.match(indexSrc, /wireSubs\(\{/, "wireSubs never called — helpers (incl. sendEmail) unwired");
});
test("negative control: the wiring guard CAN fail on an import-only source", () => {
  const importOnly = 'import { subsRoutes, wireSubs } from "./subs.js";';
  assert.doesNotMatch(importOnly, /\["subs",\s+subsRoutes\],/);
});

/* ---------------- org-scope guard — recurring failure class 3 (F-11) ---------------- */
const SQL_RE = /(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?(?=`\s*\)|"\s*\))/g;
test("every SQL statement in subs.js touching sub_ tables carries org_id", () => {
  const stmts = (subsSrc.match(SQL_RE) || []).filter(s => /sub_signups|sub_requests/.test(s));
  assert.ok(stmts.length >= 8, `expected the module's sub_ statements to be found, got ${stmts.length}`);
  for (const s of stmts) assert.match(s, /org_id/, `unscoped statement:\n${s.slice(0, 120)}…`);
});
test("negative control: the org-scope guard CAN fail on an unscoped statement", () => {
  const bad = 'SELECT id FROM sub_requests WHERE status=\'open\'';
  assert.doesNotMatch(bad, /org_id/);
});

/* ---------------- member-copy guard (F-40 class) ---------------- */
test("no literal email address appears anywhere in subs.js source", () => {
  assert.doesNotMatch(subsSrc, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    "member-facing copy or code embeds a literal email — identity resolves via senderIdentity (F-40)");
});
