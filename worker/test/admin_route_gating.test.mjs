/**
 * Boomtown Platform — admin route gating ratchet (roadmap §-1e priority 1)
 * File: worker/test/admin_route_gating.test.mjs · Version: v1.0 · Date: 2026-08-07 · Ships in: v0.102.0
 *
 * WHY THIS EXISTS, AND WHY IT IS SHAPED LIKE THIS.
 * The 2026-08-06 security baseline (roadmap §-1e) was written by a hand-rolled scan that reported
 * "no ungated admin handlers across ~25 modules". It was WRONG. It read the line
 * `async function requireAdmin(env, ctx)` — a DEFINITION — as evidence that admin.js was gated,
 * skipped the module, and never examined line 48, where `GET /api/admin/permissions` answered
 * anyone at all. Two earlier drafts of that same scan produced 25 false positives between them:
 * one stripped comments without preserving line numbers so every reported line was wrong, and one
 * matched the guard clause `if (!p.startsWith("/api/admin/pos/")) return null;` as though it were
 * a route. All three reported confidently.
 *
 * So this file is written against its own failure modes:
 *   1. IT WAS RUN BEFORE THE FIX AND WATCHED TO FAIL. On the tree at authoring time it named
 *      exactly ONE ungated route — `/api/admin/permissions` — out of 102 dispatch sites. That
 *      single observation is two proofs at once: the check CAN fail (it reproduced a known real
 *      defect, so it is not vacuous), and it produced NO false positives (101 gated routes it
 *      correctly left alone, where two earlier scans produced 25 bogus hits). A guard whose first
 *      run reproduces a known defect and nothing else has earned its assertion.
 *   2. COMMENTS ARE BLANKED, NOT REMOVED. `blankComments` replaces comment bytes with spaces and
 *      keeps newlines, so every offset and every line number survives — the exact defect that made
 *      one earlier draft's output unusable. `lineOf` is therefore trustworthy.
 *   3. CALL SITES, NEVER DEFINITIONS. `gateCallsIn` finds `requireStaff(` / `requireAdmin(` and
 *      then REJECTS any occurrence preceded by `function` — the precise mistake that produced the
 *      original false "clean". NC-G3 proves a lone definition never counts as a gate.
 *   4. `isStaff` / `isAdmin` are deliberately NOT gate names. They are predicates that return a
 *      boolean; `requireStaff` / `requireAdmin` return a 401/403 Response or null. Counting the
 *      predicates would let `requireAdmin`'s own body (which calls `isAdmin`) satisfy every route
 *      declared below it in admin.js — which is exactly how `/api/admin/permissions` hid.
 *   5. THE ROUTE CORPUS IS NOT PARSED A SECOND WAY. `routesFrom` from route_reachability.test.mjs
 *      is the established extractor and is imported here as the oracle; `agreesWithReachability`
 *      asserts this file's richer, offset-carrying extraction finds exactly the same shapes. If
 *      the routing idiom ever drifts, both files move together or this test says so.
 *
 * THE RATCHET: every `/api/admin/*` dispatch must be gated, by one of the three legitimate styles
 * the codebase actually uses (§-1e):
 *   (i)   module-level — one gate inside the routes function, above the dispatch block
 *         (`pos.js`, `marketing.js`, `sms.js`, `facility.js`, `security.js`)
 *   (ii)  per-handler — the delegated handler gates (`admin.js` listUsers, `events_admin.js`)
 *   (iii) inline block — the dispatch block's own body gates (`documents.js`, `tiers.js`,
 *         `passes.js`, `calendar.js`)
 * A check that knows only one of the three reports garbage, which is why all three are modelled.
 *
 * SCOPE, STATED PLAINLY BECAUSE A SCAN THAT REPORTS CLEAN MUST SAY WHAT IT DID NOT COVER:
 * this asserts a gate is REACHED, not that it refuses the right people (that is §-1e item 2, the
 * authorization matrix) and not that every read is org-scoped (§-1e item 3; §-1c D-8 is a known
 * live instance). Handler delegation is followed ONE level — enough for every route in the tree
 * today, and the 102-site floor below fails loudly if that stops being true.
 * ONE COST, STATED RATHER THAN LEFT AS A PUZZLE IN THE NUMBERS: importing `routesFrom` imports a
 * test FILE, so `route_reachability`'s own 5 tests register and run a second time inside this file.
 * The suite total therefore rises by 12 for this file, not 7. That was chosen over the two
 * alternatives — parsing the route corpus a second, divergent way (C14, the thing that produces
 * two disagreeing truths), or refactoring the extractor out of a working guard mid-unit (scope).
 * If a third consumer ever needs it, move `routesFrom` to `worker/testkit/` and have both import it.
 *
 * S-1b (`GET /api/orgs`, unauthenticated) is OUT OF SCOPE by design: it is not an `/api/admin/*`
 * route, it may well be deliberate (the sign-in surface needs org branding, and
 * header_shell.test.mjs:85-88 pins the admin switcher as a caller), and gating it before asking
 * who needs it would be a guess. Recorded in §-1e, not chased here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { routesFrom } from "./route_reachability.test.mjs";

const SRC_DIR = new URL("../src/", import.meta.url);
const readSrc = (f) => readFileSync(new URL(f, SRC_DIR), "utf8");
const srcFiles = () => readdirSync(SRC_DIR).filter((f) => f.endsWith(".js"));

/* ---------- pure primitives: every one takes source TEXT so the NCs can feed mutated reality ---------- */

/** Blank comment bytes to spaces, keeping newlines. Length is preserved exactly, so offsets and
    line numbers both stay true — the failure that made an earlier scan's line numbers worthless. */
export const blankComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
   .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

export const lineOf = (t, i) => t.slice(0, i).split("\n").length;

const GATE_RE = /(?:H\.)?require(?:Staff|Admin)\s*\(/g;

/** Gate CALL offsets. An occurrence preceded by `function` (with or without `async`) is a
    DEFINITION and is rejected — the exact error that produced the original false "clean". */
export function gateCallsIn(t) {
  const out = [];
  for (const m of t.matchAll(GATE_RE)) {
    if (/\bfunction\s+$/.test(t.slice(Math.max(0, m.index - 24), m.index))) continue;
    out.push(m.index);
  }
  return out;
}

/** Brace-match forward from the `{` at or after `from`; returns the index just past its `}`. */
function blockEnd(t, from) {
  let depth = 0;
  for (let i = from; i < t.length; i++) {
    if (t[i] === "{") depth++;
    else if (t[i] === "}") { depth--; if (depth === 0) return i + 1; }
  }
  return t.length;
}

/** Ranges of every function body in the file, innermost-resolvable. Signature spelling is not
    assumed — `function` plus the next `{` is enough, which survives idiom drift. */
export function functionRanges(t) {
  const out = [];
  for (const m of t.matchAll(/\bfunction\b/g)) {
    const brace = t.indexOf("{", m.index);
    if (brace < 0) continue;
    out.push({ start: m.index, end: blockEnd(t, brace) });
  }
  return out;
}

const enclosing = (ranges, i) =>
  ranges.filter((r) => r.start <= i && i < r.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] || null;

/** Walk back to the start of the statement containing `i`. The route literal sits mid-statement
    (`if (p === "…"` or `mt = p.match(/…/)`), and the assignment idiom below can only be recognised
    from the statement's first token. */
export function statementStart(t, i) {
  for (let k = i; k > 0; k--) if (t[k] === ";" || t[k] === "{" || t[k] === "}") return k + 1;
  return 0;
}

/** The dispatch STATEMENT beginning at `start` — either up to its `;`, or the whole `{…}` block
    when the dispatch opens one. This is what makes style (iii) visible. */
export function statementFrom(t, start) {
  let depth = 0, entered = false, i = start;
  for (; i < t.length; i++) {
    const c = t[i];
    if (c === "{") { depth++; entered = true; }
    else if (c === "}") { if (depth === 0) break; depth--; if (entered && depth === 0) { i++; break; } }
    else if (c === ";" && depth === 0 && !entered) { i++; break; }
  }
  return t.slice(start, i);
}

/** Admin dispatch sites WITH offsets. Same two idioms route_reachability derives — equality and
    anchored regex — and `agreesWithReachability` proves the two extractions stay identical. */
export function adminDispatchesIn(t) {
  const out = [];
  for (const m of t.matchAll(/===\s*["'`](\/api\/admin\/[^"'`\s]+)["'`]/g)) {
    out.push({ shape: m[1], index: m.index });
  }
  for (const m of t.matchAll(/\.match\(\/\^(\\\/api\\\/admin\\\/[^$]*?)\$\/\)/g)) {
    out.push({ shape: m[1].replace(/\\\//g, "/").replace(/\([^)]*\)/g, "*"), index: m.index });
  }
  return out;
}

/** The whole dispatch, which is not always one statement.
 *
 *  `consent.js:503` splits it in two — `mt = p.match(/^\/api\/admin\/media-consent\/(\d+)$/);`
 *  on one line, `if (mt) { … return historyMediaConsent(…) }` on the next. A region that stops at
 *  the `;` never sees the handlers and reports the route ungated. THIS FILE'S OWN FIRST RUN
 *  PRODUCED EXACTLY THAT FALSE POSITIVE, alongside the real S-1a hit; both media-consent handlers
 *  gate with `requireStaff` on their first line (`consent.js:400,442`), verified by reading them.
 *  So the arm below follows the assignment to the `if` that tests it — precisely, rather than by
 *  blindly extending the region, because an over-wide region would let a neighbouring gated route
 *  vouch for an ungated one. Being too permissive here is the worse failure: it reports clean. */
export function dispatchRegion(t, index) {
  const start = statementStart(t, index);
  const first = statementFrom(t, start);
  const asg = /^\s*(?:const\s+|let\s+|var\s+)?([A-Za-z_$][\w$]*)\s*=[^=]/.exec(first);
  if (!asg) return first;
  const after = start + first.length;
  const rel = new RegExp("\\bif\\s*\\(\\s*!?" + asg[1] + "\\b").exec(t.slice(after, after + 400));
  return rel ? first + statementFrom(t, after + rel.index) : first;
}

const RESERVED = new Set(["if", "for", "while", "switch", "catch", "return", "await", "typeof", "function", "match", "Number", "String", "json"]);

const calleeNames = (region) =>
  [...new Set([...region.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]))].filter((n) => !RESERVED.has(n));

/** Does a named function's own body call a gate? One level of delegation — style (ii). */
function handlerGates(t, name) {
  const decl = new RegExp("\\bfunction\\s+" + name.replace(/\$/g, "\\$") + "\\s*\\(");
  const m = decl.exec(t);
  if (!m) return false;
  const brace = t.indexOf("{", m.index);
  if (brace < 0) return false;
  return gateCallsIn(t.slice(brace, blockEnd(t, brace))).length > 0;
}

/** THE VERDICT. Ungated `/api/admin/*` dispatches in one module's source text. */
export function ungatedIn(src, file) {
  const t = blankComments(src);
  const gates = gateCallsIn(t);
  const fns = functionRanges(t);
  const out = [];
  for (const d of adminDispatchesIn(t)) {
    const fn = enclosing(fns, d.index);
    // (i) module-level: a gate call inside the SAME routes function, above this dispatch.
    // Scoped to the function on purpose — "anywhere earlier in the file" would let requireAdmin's
    // own body vouch for every route below it, which is how /api/admin/permissions stayed hidden.
    if (fn && gates.some((g) => g > fn.start && g < d.index)) continue;
    const region = dispatchRegion(t, d.index);
    if (gateCallsIn(region).length > 0) continue;                       // (iii) inline block
    if (calleeNames(region).some((n) => handlerGates(t, n))) continue;  // (ii) per-handler
    out.push({ shape: d.shape, file, line: lineOf(t, d.index) });
  }
  return out;
}

const corpus = () => srcFiles().map((f) => ({ file: f, src: readSrc(f) }));
const ungatedAll = (c = corpus()) => c.flatMap(({ file, src }) => ungatedIn(src, file));
const fmt = (r) => r.map((x) => `${x.file}:${x.line} ${x.shape}`).sort();

/* ---------- the ratchet ---------- */

test("the extraction has not collapsed — 102+ admin dispatch sites are found", () => {
  const n = corpus().reduce((a, { src }) => a + adminDispatchesIn(blankComments(src)).length, 0);
  assert.ok(n >= 102, `only ${n} admin dispatch sites found — extraction drift, not a clean scan. ` +
    "A shrinking corpus is how a scan reports clean by seeing nothing.");
});

test("this file's route extraction agrees with route_reachability's, shape for shape", () => {
  // C14: the route corpus is derived ONE way in this repo. If the idiom drifts, both move or this fails.
  const mine = new Set(corpus().flatMap(({ src }) => adminDispatchesIn(blankComments(src)).map((d) => d.shape)));
  const theirs = new Set(corpus().flatMap(({ file, src }) => routesFrom(src, file).map((r) => r.shape)));
  assert.deepEqual([...mine].sort(), [...theirs].sort(),
    "two extractions of the same corpus disagree — one of them is wrong and neither should be trusted");
});

test("EVERY /api/admin/* route is gated (§-1e S-1a ratchet)", () => {
  assert.deepEqual(fmt(ungatedAll()), [],
    "an /api/admin/* route answers without a session check. Gate it by one of the three styles.");
});

/* ---------- negative controls: each mutates the REAL source of a REAL module ---------- */

test("NC-G1: re-opening S-1a — removing the gate from /api/admin/permissions FAILS the verdict", () => {
  // The defect exactly as it shipped: the dispatch as the first line of adminRoutes, no gate.
  const src = readSrc("admin.js");
  const mutated = src.replace(
    /if \(p === "\/api\/admin\/permissions" && m === "GET"\) \{[\s\S]*?\n  \}/,
    'if (p === "/api/admin/permissions" && m === "GET") return json({ roles: ROLES, permissions: PERMISSIONS });'
  );
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(ungatedIn(mutated, "admin.js").map((r) => r.shape), ["/api/admin/permissions"],
    "the verdict must name the exact route this ratchet was built to catch");
});

test("NC-G2: deleting a module-level gate from a real module FAILS the verdict", () => {
  // pos.js gates all 11 of its routes with ONE call. Removing it must expose all 11, not one.
  const src = readSrc("pos.js");
  const mutated = src.replace(/const deny = await requireStaff\(env, ctx\);\s*\n\s*if \(deny\) return deny;/, "");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  const shapes = ungatedIn(mutated, "pos.js").map((r) => r.shape);
  assert.ok(shapes.length >= 10,
    `removing pos.js's only gate exposed ${shapes.length} routes; a module-level gate covers all of them`);
  assert.ok(shapes.includes("/api/admin/pos/products"), "the products route is one of them");
});

test("NC-G3: a gate DEFINITION is not a gate — the mistake that produced the false 'clean'", () => {
  const definitionOnly = "async function requireStaff(env, ctx) { return null; }\n";
  assert.deepEqual(gateCallsIn(definitionOnly), [],
    "a definition was counted as a call site — this is the §-1e failure, reproduced");
  const withCall = definitionOnly + "const deny = await requireStaff(env, ctx);\n";
  assert.equal(gateCallsIn(withCall).length, 1, "the call site after it must still be found");
});

test("NC-G4: comment blanking preserves offsets and line numbers", () => {
  const src = "/* a\n   multi-line comment */\nconst x = 1; // trailing\nconst y = 2;\n";
  const t = blankComments(src);
  assert.equal(t.length, src.length, "blanking changed the length — every offset after it is now a lie");
  assert.equal(lineOf(t, t.indexOf("const y")), lineOf(src, src.indexOf("const y")), "line numbers drifted");
  assert.equal(gateCallsIn(blankComments("// requireStaff(env, ctx)\n")).length, 0,
    "a gate named only inside a comment must not count — a guard's own comments will trip it");
});
