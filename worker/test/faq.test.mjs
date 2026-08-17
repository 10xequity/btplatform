/* Boomtown Platform — FAQ tests (req #21 phase 1)
   File: worker/test/faq.test.mjs · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.40.0
   Pure helpers + the §6.5 delivery gate (dispatch table + wireFaq call sites in index.js,
   never just the import line) + a source-level org-scope guard with a negative control
   that PROVES the guard can fail (tokens.test.mjs precedent). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokenizeQuery, scoreFaq, rankFaqs, normalizeFaq, Q_MAX, A_MAX } from "../src/faq.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, "../src/index.js"), "utf8");
const faqSrc = readFileSync(join(here, "../src/faq.js"), "utf8");

/* ---------------- tokenizeQuery ---------------- */

test("tokenizeQuery lowercases, dedupes, drops 1-char tokens, caps at 8", () => {
  assert.deepEqual(tokenizeQuery("Refund a REFUND policy"), ["refund", "policy"]);
  assert.equal(tokenizeQuery("a b c").length, 0);
  assert.equal(tokenizeQuery("one two three four five six seven eight nine ten").length, 8);
});

test("tokenizeQuery on empty/null yields no tokens", () => {
  assert.deepEqual(tokenizeQuery(""), []);
  assert.deepEqual(tokenizeQuery(null), []);
});

/* ---------------- scoreFaq / rankFaqs ---------------- */

const ROWS = [
  { id: 1, question: "How do refunds work?", answer: "Email us within 7 days.", tags: "refund,payment" },
  { id: 2, question: "Where do I park?", answer: "The refund lot— sorry, the NORTH lot.", tags: "parking" },
  { id: 3, question: "When are waivers due?", answer: "Before your first game.", tags: "waiver" },
];

test("question hits outrank answer hits (×3 vs ×1)", () => {
  const ranked = rankFaqs("refund", ROWS);
  assert.equal(ranked[0].id, 1); // question(3)+tags(2)+answer? no → 5
  assert.equal(ranked[1].id, 2); // answer only → 1
  assert.equal(ranked.length, 2); // waiver row filtered out (score 0)
});

test("empty query returns rows unchanged in original order", () => {
  const ranked = rankFaqs("", ROWS);
  assert.deepEqual(ranked.map(r => r.id), [1, 2, 3]);
});

test("internal _score never leaks into results", () => {
  for (const r of rankFaqs("refund", ROWS)) assert.equal("_score" in r, false);
});

/* ---------------- normalizeFaq ---------------- */

test("create requires question and answer; human-sentence errors", () => {
  assert.match(normalizeFaq({ answer: "x" }).error, /question/i);
  assert.match(normalizeFaq({ question: "x" }).error, /answer/i);
});

test("length ceilings enforce Q_MAX/A_MAX", () => {
  assert.ok(normalizeFaq({ question: "q".repeat(Q_MAX + 1), answer: "a" }).error);
  assert.ok(normalizeFaq({ question: "q", answer: "a".repeat(A_MAX + 1) }).error);
});

test("partial update passes through only supplied fields; tags normalized lowercase CSV", () => {
  const f = normalizeFaq({ tags: " Refund , PAYMENT ,, ", published: true }, { partial: true });
  assert.equal(f.error, undefined);
  assert.deepEqual(f, { tags: "refund,payment", published: 1 });
});

test("published coerces strictly to 0/1; sort_order to an integer", () => {
  assert.equal(normalizeFaq({ published: "yes" }, { partial: true }).published, 1);
  assert.equal(normalizeFaq({ published: 0 }, { partial: true }).published, 0);
  assert.equal(normalizeFaq({ sort_order: "3.9" }, { partial: true }).sort_order, 3);
  assert.equal(normalizeFaq({ sort_order: "junk" }, { partial: true }).sort_order, 0);
});

/* ---------------- §6.5 delivery gate: call sites, not module names ---------------- */

test("index.js DISPATCHES faqRoutes in the route chain (not just the import line)", () => {
  assert.match(indexSrc, /\["faq",\s+faqRoutes\],/);
});

test("index.js CALLS wireFaq with the shared helpers", () => {
  assert.match(indexSrc, /wireFaq\(\s*\{?\s*(?:\.\.\.)?wiredHelpers/);
});

/* ---------------- org-scope source guard + negative control ---------------- */

// Every SQL statement in faq.js must scope by org_id. The guard scans the widest set
// (every prepare( call) rather than a named few — failure class 3 in standards §6.
function preparedStatements(src) {
  return [...src.matchAll(/prepare\(\s*(`[^`]*`|"[^"]*")/g)].map(m => m[1]);
}

test("every faq.js SQL statement carries org_id", () => {
  const stmts = preparedStatements(faqSrc);
  assert.ok(stmts.length >= 5, `expected ≥5 statements, saw ${stmts.length}`);
  for (const s of stmts) assert.match(s, /org_id/, `statement missing org_id scope: ${s.slice(0, 60)}`);
});

test("NEGATIVE CONTROL: the org-scope guard fails on an unscoped statement", () => {
  const mutated = faqSrc + '\nconst leak = (db) => db.prepare("SELECT id FROM faqs WHERE published=1");\n';
  const stmts = preparedStatements(mutated);
  assert.ok(stmts.some(s => !/org_id/.test(s)), "guard could not detect the injected unscoped query — it is vacuous");
});
