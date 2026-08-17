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

/* ── THE GATE VOCABULARY, DECLARED ONCE (v0.168.0, SG-3a) ──────────────────────────────────────
   `requireCoreStaff` is the FOURTH gating style. SG-3a binds a module's `requireStaff` to a grant
   key at the mount, so a bound module that still owns a CORE route hands that route the UNBOUND
   gate under a second name. It admits admin or staff and refuses hosts — it IS `requireStaff`
   before binding, not a new tier — so its kind is "staff". `tiers.js` (`/api/admin/org`) is the
   only holder today; `staff_gate_wiring.test.mjs` pins the complete list of its call sites.

   BOTH READERS ARE BUILT FROM THIS ONE ALTERNATION, and that is the repair, not a tidy-up. They
   carried a copy each, under a comment on `gateKindCallsIn` promising the two "can never drift" —
   a promise made by PROSE about two separate regex literals, which is not a mechanism. Teaching a
   fourth style to one and not the other is precisely the drift the prose did not prevent. Adding
   `requireCoreStaff` to tiers.js reddened the S-1a ratchet AND the authorization matrix at once,
   both reporting an ungated route that was gated the whole time — a guard blind to a legitimate
   style accuses the code instead of itself, which costs more than an honest gap.

   `CoreStaff` precedes `Staff` in the alternation so the longer name wins the leftmost match. */
const GATE_NAMES = "CoreStaff|Staff|Admin";
const gateRe = () => new RegExp(`(?:H\\.)?require(${GATE_NAMES})\\s*\\(`, "g");

/** A `function` (with or without `async`) immediately before an occurrence makes it a DEFINITION,
    not a call — the exact error that produced the original false "clean". */
const isDefinition = (t, i) => /\bfunction\s+$/.test(t.slice(Math.max(0, i - 24), i));

/** Gate CALL offsets. */
export function gateCallsIn(t) {
  return gateKindCallsIn(t).map((g) => g.index);
}

/** Gate call sites WITH which gate was called — the one fact the authorization matrix needs and
    the S-1a ratchet did not: `requireStaff`/`requireCoreStaff` admit admin OR staff, `requireAdmin`
    admits admin only, and "is there a gate" cannot tell them apart. `gateCallsIn` is now literally
    this function's offsets rather than a second regex asserted to agree with it, so the two cannot
    disagree about what counts as a call site even in principle. */
export function gateKindCallsIn(t) {
  const out = [];
  for (const m of t.matchAll(gateRe())) {
    if (isDefinition(t, m.index)) continue;
    // "CoreStaff" collapses to "staff": same tier, same admissions, different binding.
    out.push({ index: m.index, kind: m[1] === "Admin" ? "admin" : "staff" });
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

/* ==================== REGION HELPERS (v1.1, v0.111.0 — §-1c D-17b) ====================
   Added for the marker sweep. D-17b has been recorded SIX times, and every instance was an
   assertion that pinned a DISTANCE — "these two things sit within N characters" — where it meant to
   pin a REGION: this function's body, this branch, this statement, this template literal.

   A distance is a spelling. `blankComments` preserves comment LENGTH precisely so offsets stay
   true, which also means one added line of explanation can push a target past a window and redden a
   file that satisfies the invariant completely. That is instance five, exactly.

   Each of these returns TEXT or null, takes source text rather than a filename, and is bounded by a
   SYNTACTIC delimiter — a matched brace, a statement terminator, a closing backtick. None of them
   can be knocked out of alignment by a comment. */

/**
 * For EVERY occurrence of `needle`, the text from it to the end of the template literal it sits in.
 *
 * The use case is a SQL fragment interpolated into several queries: the thing that must be checked
 * is the rest of each query, and the rest of a query ends at the closing backtick, not at some
 * number of characters that happened to be long enough when the guard was written.
 */
export function templateTailsAfter(t, needle) {
  const out = [];
  let i = 0;
  while ((i = t.indexOf(needle, i)) >= 0) {
    const start = i + needle.length;
    const end = t.indexOf("`", start);
    out.push(end < 0 ? t.slice(start) : t.slice(start, end));
    i = start;
  }
  return out;
}

/**
 * A function's BODY, anchored on its signature, skipping the parameter list.
 *
 * WHY THIS IS NOT `statementFrom` AND NOT `functionRanges`. Both find a body by taking the next `{`
 * after the signature — and a default parameter puts a `{` there first. `function png(text, opts = {})`
 * hands them `{}` as the block, so they return the signature and stop. v0.111.0's marker sweep hit
 * this immediately: `statementFrom` returned `function png(text, opts = {}` and the assertion failed
 * against a body that satisfied it completely.
 *
 * So the parameter list is walked with paren depth FIRST, and only then is the opening brace taken.
 *
 * `functionRanges` still carries the original behaviour on purpose — it is consumed by the admin
 * gating and authorization guards, and changing a primitive those depend on is its own unit with its
 * own verification. The limitation is recorded as §-1c D-20 rather than patched in passing.
 */
export function functionBodyAfter(t, signature) {
  const at = t.indexOf(signature);
  if (at < 0) return null;
  let i = t.indexOf("(", at);
  if (i < 0) return null;
  let depth = 0;
  for (; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")") { depth--; if (depth === 0) { i++; break; } }
  }
  const brace = t.indexOf("{", i);
  if (brace < 0) return null;
  return t.slice(brace, blockEnd(t, brace));
}

/**
 * The src= list of a page's external scripts, cache-buster stripped.
 *
 * MOVED HERE IN v0.143.0 UNDER THIS FILE'S OWN THIRD-CONSUMER RULE (see the header). It existed
 * as two byte-identical private copies — a named `scriptsOf` in `print_parity.test.mjs` and an
 * inline one at `dangling_refs.test.mjs`'s page walker — and B29's member-page contact guard was
 * about to be the third. Both consumers now import this and keep every one of their own tests, so
 * a behavioural drift introduced by the move reddens the guards that already depend on it.
 *
 * NOT the only spelling in the suite, deliberately: `header_shell.test.mjs` matches a NARROWER
 * shape (`assets/<name>.js` only, capturing the bare filename) because it is asserting which
 * shared assets a shell loads, not resolving hrefs. That is a different question and it keeps its
 * own regex — unifying them would widen its corpus silently.
 */
export const scriptsOf = (html) =>
  [...html.matchAll(/<script\b[^>]*src="([^"?]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);

/**
 * Is `wire<Name>` actually CALLED in index.js with the shared helper bag? (v0.169.0)
 *
 * WHY THIS EXISTS, AND WHY IN ONE PLACE. Ten module guards each hand-rolled their own literal
 * anchor for this one fact — `/wireTryouts\(wiredHelpers\)/` and nine like it. v0.168.0's SG-3a
 * changed the call shape to `wireTryouts({ ...wiredHelpers, requireStaff: staffGateFor("tryouts") })`
 * and every one of them broke at once, each needing the same edit in a different file. That is the
 * rule-in-one-room problem: a fact asserted in ten places is a fact that has to be corrected in ten
 * places, and the next change to the mount shape would have cost the same again.
 *
 * IT READS COMMENT-BLANKED SOURCE, WHICH THE TEN ANCHORS DID NOT. Measured 2026-08-17: all eleven
 * accepted a mount that had been COMMENTED OUT, because they matched raw source — so a mount
 * disabled with `//` would have satisfied every "the module is actually mounted" guard in the
 * suite while the module served nothing. The gate scanners in this same file have blanked comments
 * since v0.102.0 for exactly this reason (`a gate DEFINITION is not a gate`); the mount guards
 * never got the same treatment. `blankComments` preserves offsets, so nothing else shifts.
 *
 * WHAT IT DOES NOT DO: it does not check WHICH helpers are passed, or whether the mount is bound
 * to the right grant key. `staff_gate_wiring.test.mjs` owns that question with a paren-balanced
 * parser and pins every mount in both directions. This answers only "is it wired at all" —
 * failure class 1, the module built and never mounted.
 *
 * @param {string} indexSrc raw text of worker/src/index.js
 * @param {string} name     the wire function's suffix, e.g. "Tryouts" for `wireTryouts`
 * @returns {boolean}
 */
export function mountsAndWires(indexSrc, name) {
  const t = blankComments(indexSrc);
  // `wireX(` followed by the shared bag in either shape: `wiredHelpers` or `{ ...wiredHelpers`.
  // Anything else — `wireX()`, or a bag built from something other than the shared helpers — is
  // not a mount this function will vouch for.
  return new RegExp(String.raw`\bwire${name}\(\s*\{?\s*(?:\.\.\.)?wiredHelpers\b`).test(t);
}
