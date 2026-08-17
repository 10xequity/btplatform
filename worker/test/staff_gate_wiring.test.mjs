/**
 * Boomtown Platform — the module-bound staff gate is actually WIRED (roadmap §-1q, SG-3a)
 * File: worker/test/staff_gate_wiring.test.mjs · Version: v1.0 · Date: 2026-08-17 · Ships in: v0.168.0
 *
 * ── THE FAILURE THIS FILE EXISTS TO CATCH, NAMED BEFORE THE CODE WAS WRITTEN ─────────────────
 * `staffGateFor("tournaments")` returns a gate that refuses a host without a tournaments grant.
 * A gate that is DEFINED and never PASSED TO A MODULE refuses nobody, and every behavioural test
 * of it still passes — because the behavioural tests call it through the module the loop remembered
 * to wire. Wire 28 of 29 modules and the 29th silently admits any host to everything it gates,
 * while the suite reports clean. That is the exact shape of S-1a (a gate reached by 101 of 102
 * dispatches) moved one level up, from the dispatch to the MOUNT.
 *
 * So this file asserts CALL SITES, IN BOTH DIRECTIONS:
 *   FORWARD — every module the table says is bound really receives `staffGateFor(<its keys>)`.
 *   REVERSE — every `wireXxx(...)` call in index.js is accounted for by ONE of the two tables.
 *             A new module wired without a decision is a RED TEST, not a default.
 *   CORE    — the five core mounts must NOT be bound, so a host reaches none of them however many
 *             grants they hold. S-2a's rescue link (sandbox.js) is closed to hosts BY CONSTRUCTION,
 *             and this is the assertion that says so out loud.
 *
 * ── WHY "UNBOUND" IS THE SAFE DEFAULT AND NOT AN OVERSIGHT ───────────────────────────────────
 * An unbound mount keeps the original `requireStaff`, which admits admin or staff and refuses a
 * host outright (`isStaff` recognises only admin and staff — measured, index.js). So the failure
 * mode of forgetting to bind a module is A HOST BEING REFUSED, which is visible, reported, and
 * fixed in one line. The failure mode of binding the WRONG key is a host reaching a module nobody
 * granted them, which is silent. The tables below are therefore explicit about both states rather
 * than treating either as a fallback.
 *
 * ── WHAT THIS FILE DOES NOT CLAIM ────────────────────────────────────────────────────────────
 * It does not assert that each key is the RIGHT key for that module — that is a product judgement
 * taken from BT_MODULES' own `pages` lists and recorded in the table's comments. It asserts that
 * the wiring matches the decision, that no mount escaped the decision, and that core stayed core.
 * The behavioural half — who actually gets a 200 and who gets which 403 — is in
 * `authorization_matrix.test.mjs` (the host rows) and `cross_org_isolation.test.mjs` (the per-org
 * pin). Static and behavioural must agree; if they disagree, one is wrong and neither is believable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { MODULE_KEYS } from "../src/orgs.js";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC_DIR = new URL("../src/", import.meta.url);
const readSrc = (f) => readFileSync(new URL(f, SRC_DIR), "utf8");
const INDEX = readSrc("index.js");

/* ═══════════════════ THE DECISION, WRITTEN DOWN ═══════════════════
 *
 * Keys come from `window.BT_MODULES`' own `pages` lists in web/assets/admin-nav.js — the module that
 * OWNS the admin screen a routes-module serves. Two entries carry more than one key because the
 * screen genuinely belongs to two modules, and that mirrors P-1's own rule: a page with two owners
 * hides only when EVERY owner is off, so a host holding EITHER key must pass.
 *
 * `wire` is tournaments.js's exported wire function — it predates the naming convention. */
const BOUND = {
  wire:              ["tournaments"],              // tournaments.js — tournament.html
  wireBrackets:      ["tournaments"],              // admin-brackets.html
  wireDivisions:     ["tournaments"],              // admin-divisions.html
  wireFormats:       ["tournaments"],              // admin-pool-board.html (the M-TF generator)
  wireSchedule:      ["tournaments", "leagues"],   // admin-schedule-editor.html — BOTH owners
  wireSubs:          ["leagues"],                  // the league sub finder
  wireLeagues:       ["leagues"],                  // admin-league.html
  wireKotc:          ["kotc"],                     // admin-kotc.html
  wireEventsAdmin:   ["events"],                   // admin-events/admin-event/admin-manager — the grant-only key
  wireRegistrations: ["registrations"],            // admin-registrations.html
  wireWaitlists:     ["registrations"],            // admin-waitlists.html
  wireCheckin:       ["registrations"],            // admin-checkin.html
  wireTryouts:       ["tryouts"],                  // admin-tryouts.html, admin-squads.html
  wireFacility:      ["facility"],                 // admin-facility.html
  wireReports:       ["reports"],                  // admin-reports.html
  wirePos:           ["pos"],                      // admin-pos.html
  wireMemberships:   ["memberships"],              // admin-plans.html
  wireTiers:         ["memberships"],              // admin-tiers.html
  wireMemberFields:  ["memberships"],              // admin-member-fields.html
  wirePasses:        ["memberships"],              // admin-passes.html
  wireStaffPay:      ["staffpay"],                 // admin-staff-pay.html
  wireAnnouncements: ["announcements"],            // admin-announcements.html
  wireMarketing:     ["marketing"],                // admin-marketing.html
  wireSms:           ["marketing"],                // admin-sms.html
  wireMessages:      ["marketing"],                // admin-messages.html
  wireWaivers:       ["waivers"],                  // admin-waivers.html
  wireDocuments:     ["library"],                  // admin-documents.html
  wireFaq:           ["library"],                  // admin-faq.html
  wireUploads:       ["library"],                  // admin-uploads.html
};

/* THE FIVE CORE MOUNTS. §-1q: "Modules outside any key (orgs, security, sandbox, users, admin) keep
   the UNBOUND gate, which refuses hosts always". `users` and `admin` are both admin.js — the users
   screen IS the admin module — so four wire calls carry the five names. Listed separately from the
   rest of UNBOUND because these are a DESIGN GUARANTEE, not an undecided mapping: a binding
   appearing here would open the rescue link, the org settings, or user management to a host. */
const CORE_UNBOUND = ["wireAdmin", "wireOrgs", "wireSecurity", "wireSandbox"];

/* Mounts that keep the unbound gate because their staff-gated routes map onto NO menu module.
   Deny-by-default: each is a surface a host is refused until someone decides it should be granted,
   and the cost of that decision being deferred is a 403 somebody can report. Named with what the
   gated routes actually are, so the next reader does not have to re-measure. */
const OTHER_UNBOUND = {
  wireProfiles: "season-points seeding/list — a records surface with no menu module",
  wireConsent:  "/api/admin/media-consent — compliance, not the waivers screen",
  wireCalendar: "/api/admin/calendar — mints the ORG-WIDE public feed, an org-level setting",
  wirePush:     "/api/admin/push/test — sends a test push to the caller's own devices",
  wireLfg:      "/api/admin/lfg/strikes + unban — community moderation, no menu module",
};

/* Mounts with ZERO `requireStaff` call sites in their module. Binding one would be a claim this
   file cannot check: there is no gate for the binding to reach, so the assertion would be vacuous
   and the next person to add a gate there would inherit a key nobody chose. They stay unbound, and
   `no mount escapes the decision` below still requires them to be named here. */
const NO_GATE = ["wireWebauthn", "wireMemberPortal", "wireFamily", "wireKiosk", "wireLive"];

const DECLARED_UNBOUND = [...CORE_UNBOUND, ...Object.keys(OTHER_UNBOUND), ...NO_GATE];

/* ═══════════════════ reading the real wire block ═══════════════════ */

/** The source text of one call's argument list, from `(` to its matching `)`.
 *  Paren-balanced rather than line-based: `wireEventsAdmin({ ...h, sendEmail, escapeHtml })` and a
 *  binding that wraps onto a second line must both read correctly. */
function argsOf(t, callIndex) {
  const open = t.indexOf("(", callIndex);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")" && --depth === 0) return t.slice(open + 1, i);
  }
  return null;
}

/** Every TOP-LEVEL `wireXxx(...)` / `wire(...)` statement in index.js, with what it was passed.
 *  A call is only counted where it begins a statement (start of a line, no leading `.` or `=`),
 *  which is what keeps the `import { ..., wireOrgs } from` lines and the doc comments out. */
function wireCalls(src = INDEX) {
  const t = blankComments(src);
  const out = [];
  for (const m of t.matchAll(/^(wire[A-Za-z]*)\(/gm)) {
    out.push({ fn: m[1], args: argsOf(t, m.index) ?? "", index: m.index });
  }
  return out;
}

/** The keys a wire call binds, or null if it binds nothing. Reads the literal ARGUMENT of
 *  `staffGateFor(...)` at the mount — not a definition, not a comment (comments are blanked). */
function boundKeysIn(args) {
  const at = args.indexOf("staffGateFor(");
  if (at < 0) return null;
  const inner = argsOf(args, at + "staffGateFor".length - 1);
  if (inner === null) return null;
  return Array.from(inner.matchAll(/["'`]([^"'`]+)["'`]/g), (m) => m[1]);
}

const callsByFn = (src = INDEX) => {
  const map = new Map();
  for (const c of wireCalls(src)) map.set(c.fn, c);
  return map;
};

/* ═══════════════════ FORWARD — the table is really wired ═══════════════════ */

test("the wire block is readable at all — the corpus assertion this file's verdicts rest on", () => {
  const calls = wireCalls();
  assert.ok(calls.length >= 40,
    `only ${calls.length} wire calls found in index.js. Every verdict below is a claim about this ` +
    "list, so a short list means the extractor is wrong, not that the wiring is.");
  assert.equal(new Set(calls.map((c) => c.fn)).size, calls.length,
    "a wire function is called twice at the top level — one mount would silently overwrite the other");
});

test("every module the table binds RECEIVES its bound gate at the mount — the call site, not the definition", () => {
  const calls = callsByFn();
  const wrong = [];
  for (const [fn, keys] of Object.entries(BOUND)) {
    const call = calls.get(fn);
    if (!call) { wrong.push(`${fn}: not wired in index.js at all`); continue; }
    const got = boundKeysIn(call.args);
    if (got === null) { wrong.push(`${fn}: mounted with the UNBOUND gate — expected staffGateFor(${keys.join(", ")})`); continue; }
    if (got.join(",") !== keys.join(",")) wrong.push(`${fn}: bound to [${got.join(", ")}], table says [${keys.join(", ")}]`);
  }
  assert.deepEqual(wrong, [],
    "a module-bound gate is defined but not wired, or wired to the wrong keys. THIS IS THE FAILURE " +
    "SG-3a ships silently: an unbound mount keeps the unscoped gate and every behavioural test of " +
    "the OTHER modules still passes.");
});

test("no bound gate names a key outside MODULE_KEYS — a typo grants nothing, forever", () => {
  const unknown = [];
  for (const [fn, keys] of Object.entries(BOUND)) {
    for (const k of keys) if (!MODULE_KEYS.includes(k)) unknown.push(`${fn} → ${k}`);
  }
  assert.deepEqual(unknown, [],
    "a mount binds a key the grant vocabulary does not contain, so no grant row can ever match it " +
    "and that module is unreachable for every host");
});

test("every grantable key is actually USED by some mount — a key nothing binds is a dead toggle", () => {
  const used = new Set(Object.values(BOUND).flat());
  const orphans = MODULE_KEYS.filter((k) => !used.has(k));
  assert.deepEqual(orphans, [],
    "these keys can be granted but gate nothing, so the toggle would save and change nothing — " +
    `the SG-3b screen would show a lie: ${orphans.join(", ")}`);
});

/* ═══════════════════ REVERSE — no mount escaped the decision ═══════════════════ */

test("REVERSE: every wire call in index.js is either bound or DECLARED unbound", () => {
  const known = new Set([...Object.keys(BOUND), ...DECLARED_UNBOUND]);
  const strays = wireCalls().map((c) => c.fn).filter((fn) => !known.has(fn));
  assert.deepEqual(strays, [],
    "a routes-module is mounted with no decision recorded about its module grant. Add it to BOUND " +
    "with its key, or to the matching unbound list with the reason. Silence must not be the default.");
});

test("REVERSE: nothing is in two states at once", () => {
  const both = Object.keys(BOUND).filter((fn) => DECLARED_UNBOUND.includes(fn));
  assert.deepEqual(both, [], "a mount is listed as both bound and unbound — the tables disagree");
  assert.equal(new Set(DECLARED_UNBOUND).size, DECLARED_UNBOUND.length,
    "an unbound mount is listed twice across the three unbound lists");
});

test("REVERSE: every module that CALLS requireStaff is covered by a decision", () => {
  /* The other direction of the same question, taken from the SOURCE rather than from index.js:
     a module with staff-gated routes whose mount is in NO_GATE would be mis-declared, and a module
     with gates and no mount at all could not be bound even if someone wanted to. */
  const gated = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".js") && f !== "index.js")
    .filter((f) => /requireStaff\s*\(/.test(blankComments(readSrc(f))));
  assert.ok(gated.length >= 30, `only ${gated.length} gated modules found — the scan, not the wiring, is wrong`);

  // wire function → source file, read from index.js's own import statements. No hand-written map:
  // a third copy is a third thing that can drift.
  const t = blankComments(INDEX);
  const fileOf = new Map();
  for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.]+)"/g)) {
    for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop())) {
      if (/^wire/.test(name)) fileOf.set(name, m[2]);
    }
  }
  const mistakes = [];
  for (const fn of NO_GATE) {
    const file = fileOf.get(fn);
    if (file && gated.includes(file)) mistakes.push(`${fn} (${file}) is declared to have NO gates but calls requireStaff`);
  }
  const boundFiles = new Set(Object.keys(BOUND).map((fn) => fileOf.get(fn)));
  for (const f of gated) {
    if (boundFiles.has(f)) continue;
    const mounts = [...fileOf.entries()].filter(([, file]) => file === f).map(([fn]) => fn);
    if (!mounts.some((fn) => DECLARED_UNBOUND.includes(fn))) {
      mistakes.push(`${f} has staff-gated routes and no mount in either table (mounts seen: ${mounts.join(", ") || "none"})`);
    }
  }
  assert.deepEqual(mistakes, [], "the tables and the source disagree about which modules have gates");
});

/* ═══════════════════ CORE — the design guarantee, asserted ═══════════════════ */

test("CORE: the four core mounts are UNBOUND, so a host reaches none of them with any grant", () => {
  const calls = callsByFn();
  const opened = [];
  for (const fn of CORE_UNBOUND) {
    const call = calls.get(fn);
    assert.ok(call, `${fn} is no longer wired in index.js — this check is blind until that is fixed`);
    if (boundKeysIn(call.args) !== null) opened.push(fn);
  }
  assert.deepEqual(opened, [],
    "a CORE module was given a module-bound gate. That is not a widening of one screen: wireAdmin " +
    "is user and role management, wireOrgs is the switch that turns modules back on, wireSecurity " +
    "is the audit surface, and wireSandbox carries S-2a's rescue link, which in keyless sandbox " +
    "mode returns a working sign-in link for ANY account to the caller. Hosts are refused these by " +
    "construction (§-1q), and a grant must never be able to reach them.");
});

/* ═══════════════════ negative controls — each mutates the REAL index.js ═══════════════════ */

test("NC-W1: UNWIRING one bound module fails the forward check — the silent failure, reproduced", () => {
  const src = INDEX;
  const anchor = 'wireReports({ ...wiredHelpers, requireStaff: staffGateFor("reports") });';
  assert.equal(src.split(anchor).length - 1, 1, "anchor must occur exactly once or this NC proves nothing");
  const mutated = src.replace(anchor, "wireReports(wiredHelpers);");

  const call = callsByFn(mutated).get("wireReports");
  assert.ok(call, "the mutated mount must still parse as a wire call");
  assert.equal(boundKeysIn(call.args), null,
    "a mount reverted to the unbound gate still reported a binding — the extractor is reading " +
    "something other than the call site, and the forward check above proves nothing");
});

test("NC-W2: binding a CORE module fails the core check — a grant must never reach the rescue link", () => {
  const src = INDEX;
  const anchor = "wireSandbox(wiredHelpers);";
  assert.equal(src.split(anchor).length - 1, 1, "anchor must be unique");
  const mutated = src.replace(anchor, 'wireSandbox({ ...wiredHelpers, requireStaff: staffGateFor("events") });');
  const call = callsByFn(mutated).get("wireSandbox");
  assert.deepEqual(boundKeysIn(call.args), ["events"],
    "a core mount was bound and the check did not see it — S-2a's rescue link would be open to any " +
    "host holding any grant and this file would report clean");
});

test("NC-W3: a mount bound to the WRONG key is caught — not just a missing binding", () => {
  const src = INDEX;
  const anchor = 'wirePos({ ...wiredHelpers, requireStaff: staffGateFor("pos") });';
  assert.equal(src.split(anchor).length - 1, 1, "anchor must be unique");
  const mutated = src.replace(anchor, 'wirePos({ ...wiredHelpers, requireStaff: staffGateFor("reports") });');
  assert.deepEqual(boundKeysIn(callsByFn(mutated).get("wirePos").args), ["reports"],
    "a mount rebound to another module's key read as correct — a host granted Sales & Reports " +
    "would silently reach Point of Sale");
});

test("NC-W4: a NEW mount with no decision is caught by the reverse check", () => {
  const src = INDEX;
  const anchor = "wireOrgs(wiredHelpers);";
  assert.equal(src.split(anchor).length - 1, 1, "anchor must be unique");
  const mutated = src.replace(anchor, "wireOrgs(wiredHelpers);\nwireInvented(wiredHelpers);");
  const known = new Set([...Object.keys(BOUND), ...DECLARED_UNBOUND]);
  const strays = wireCalls(mutated).map((c) => c.fn).filter((fn) => !known.has(fn));
  assert.deepEqual(strays, ["wireInvented"],
    "a mount added with no recorded decision was not reported — new modules would default to " +
    "whatever the author forgot, which is the whole failure class");
});

test("NC-W5: `staffGateFor` named only in a COMMENT never counts as a binding", () => {
  const commented = INDEX.replace(
    "wireOrgs(wiredHelpers);",
    '// wireOrgs({ ...wiredHelpers, requireStaff: staffGateFor("events") });\nwireOrgs(wiredHelpers);'
  );
  assert.notEqual(commented, INDEX, "the mutation must land, or this NC proves nothing");
  assert.equal(boundKeysIn(callsByFn(commented).get("wireOrgs").args), null,
    "a binding written in a comment was counted as shipped — comments are blanked for exactly this");
});

test("NC-W6: the paren balancer survives a nested call in the argument list", () => {
  /* wireEventsAdmin and wireWaitlists already pass extra helpers, and a bound gate adds a nested
     call inside an object literal inside the argument list. A line-based reader would truncate. */
  const args = argsOf('wireX({ ...h, requireStaff: staffGateFor("a", "b"), sendEmail });', 0);
  assert.deepEqual(boundKeysIn(args), ["a", "b"], "a multi-key binding inside a nested call must parse");
  assert.match(args, /sendEmail/, "the balancer stopped early — it must reach the end of the argument list");
});
