/**
 * Boomtown Platform — shared admin-route extraction primitives
 * File: worker/testkit/route-extract.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.103.0
 *
 * WHY THIS FILE EXISTS, IN THE WORDS OF THE FILE IT CAME FROM.
 * These primitives were written inside `worker/test/admin_route_gating.test.mjs` (v0.102.0), whose
 * header records the cost of keeping them there: importing an export from a test FILE re-registers
 * that file's tests in the importer's run, which is why that guard's own suite delta was +12 and
 * not +7. It named the exit condition explicitly:
 *
 *     "If a third consumer ever needs it, move `routesFrom` to `worker/testkit/` and have both
 *      import it."
 *
 * v0.103.0's authorization matrix (§-1e priority 2) is that third consumer. Moving the primitives
 * here means the new guard imports NO test file and therefore re-registers NO foreign tests.
 *
 * THIS IS A MECHANICAL MOVE. Not one character of logic changed in transit, and that claim is
 * checked rather than asserted: `admin_route_gating.test.mjs` still runs all 7 of its own tests
 * (including its four negative controls) against these exact functions, so a behavioural drift
 * introduced by the move reddens the guard that was built to catch it. The move has its own
 * verifier and did not need a new one.
 *
 * WHAT THESE ARE FOR. Every function takes source TEXT rather than a filename, so a caller can
 * feed it MUTATED reality — the standing rule that a guard ships a negative control which mutates
 * the real input. Nothing here reads the filesystem.
 *
 * THE TWO ERRORS THESE WERE SHAPED AGAINST (roadmap §-1e, paid for twice):
 *   · A gate DEFINITION is not a gate. `async function requireAdmin(env, ctx)` was once read as
 *     evidence that admin.js was gated, which skipped the module and hid an ungated route.
 *     `gateCallsIn` rejects any occurrence preceded by `function`.
 *   · Comments are BLANKED, never removed. Deleting them shifts every offset after them and makes
 *     reported line numbers lies. `blankComments` preserves length and newlines exactly.
 */

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

/** Gate call sites WITH which gate was called. Same definition-rejection as `gateCallsIn` — this
    is that function plus the one fact the authorization matrix needs and the S-1a ratchet did not:
    `requireStaff` admits admin OR staff, `requireAdmin` admits admin only, and "is there a gate"
    cannot tell them apart. Kept beside `gateCallsIn` so the two can never drift in what counts as
    a call site; `gateCallsIn` is asserted to be exactly this function's offsets in the matrix's
    own tests. */
export function gateKindCallsIn(t) {
  const out = [];
  for (const m of t.matchAll(/(?:H\.)?require(Staff|Admin)\s*\(/g)) {
    if (/\bfunction\s+$/.test(t.slice(Math.max(0, m.index - 24), m.index))) continue;
    out.push({ index: m.index, kind: m[1].toLowerCase() }); // "staff" | "admin"
  }
  return out;
}

/** Brace-match forward from the `{` at or after `from`; returns the index just past its `}`. */
export function blockEnd(t, from) {
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

export const enclosing = (ranges, i) =>
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
    anchored regex — and the S-1a ratchet's `agreesWithReachability` proves the two extractions
    stay identical. */
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
 *  the `;` never sees the handlers and reports the route ungated. THE S-1a RATCHET'S OWN FIRST RUN
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

export const calleeNames = (region) =>
  [...new Set([...region.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]))].filter((n) => !RESERVED.has(n));

/** Does a named function's own body call a gate? One level of delegation — style (ii). */
export function handlerGates(t, name) {
  const decl = new RegExp("\\bfunction\\s+" + name.replace(/\$/g, "\\$") + "\\s*\\(");
  const m = decl.exec(t);
  if (!m) return false;
  const brace = t.indexOf("{", m.index);
  if (brace < 0) return false;
  return gateCallsIn(t.slice(brace, blockEnd(t, brace))).length > 0;
}

/** Which gate KIND a named function's own body calls — style (ii), for the matrix.
    Returns "admin" when the handler calls requireAdmin, "staff" when it calls requireStaff,
    and null when it gates with neither. `admin` wins if a handler somehow calls both, because
    the stricter gate is the one that decides who is actually refused. */
export function handlerGateKind(t, name) {
  const decl = new RegExp("\\bfunction\\s+" + name.replace(/\$/g, "\\$") + "\\s*\\(");
  const m = decl.exec(t);
  if (!m) return null;
  const brace = t.indexOf("{", m.index);
  if (brace < 0) return null;
  const kinds = gateKindCallsIn(t.slice(brace, blockEnd(t, brace))).map((g) => g.kind);
  if (kinds.includes("admin")) return "admin";
  if (kinds.includes("staff")) return "staff";
  return null;
}
