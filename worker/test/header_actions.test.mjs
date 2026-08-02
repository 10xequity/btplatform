/**
 * Boomtown Platform — header-actions guard
 * File: worker/test/header_actions.test.mjs · Version: v3.1 · Date: 2026-08-02 · Ships in: v0.53.1 (v3.0 v0.53.0)
 *
 * v3.1 (v0.53.1): guards for the two v2.14 source fixes. Both were found by external review of
 * v0.53.0 and both were shipped BEFORE these assertions existed — recorded here because the
 * first prove-it-fails run on v0.53.1 came back green, which is what surfaced the omission.
 *   (a) the badge must be built with DOM APIs and be idempotent (v2.13 appended unconditionally,
 *       so a second run stacked a second badge — the deleted v2.10 injector had carried the
 *       idempotency guard and deleting the injector deleted the guard).
 *   (b) #logoutBtn must be revealed from the LOCAL token, synchronously — not from inside the
 *       /api/me branch, where a slow or 5xx response strands a signed-in member with no way out.
 *
 * v3.0 (v0.53.0): the MEMBER shell inverts too — the v2.10 mail and v2.11 Admin-switch
 * INJECTORS are deleted from site-nav.js; 13 canonical member pages ship the static header
 * (header_shell.test.mjs v2.0 holds those copies byte-identical). site-nav.js keeps only
 * a badge/aria FILL on the static ✉ (data fill — the brandLogo-swap precedent) and a
 * reveal of the static-but-hidden #btHdrAdmin (owner call 2026-08-02: static + hidden +
 * JS reveal, frame-one markup for everyone). BOTH shells now forbid element injection:
 * a surviving injector renders the control twice.
 * v2.0 (v0.52.0): admin side inverted (static header, no admin-nav injector).
 * v1.1 (v0.49.0): Admin switch injected. v1.0 (v0.48.0): mail icon injected, both shells.
 *
 * NCs prove the checks can fail on mutated sources; presence scans count their own misses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB_DIR = new URL("../../web/", import.meta.url);
const read = (p) => readFileSync(new URL(p, WEB_DIR), "utf8");
const pages = () => readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"));
const isAdmin = (html) => /<script[^>]+src="assets\/admin-nav\.js[^"]*"/.test(html);
const isMemberCanon = (f, html) =>
  f !== "index.html" && /<script[^>]+src="assets\/site-nav\.js[^"]*"/.test(html);

/* pure verdicts — real corpus and NCs share them */
/* v3.0: NEITHER nav script may inject header controls. The signature scanned is the
   injector's assignment form, which cannot appear in static markup. */
const noInjectorVerdict = (src) =>
  !src.includes('a.id = "btHdrMail"') && !src.includes('a.id = "btHdrAdmin"');
/* site-nav must FILL the static ✉ (badge + aria) instead of creating it */
const mailFillVerdict = (src) =>
  src.includes('function headerMailFill()') &&
  src.includes('document.getElementById("btHdrMail")') &&
  src.includes("inboxUnread");
/* the Admin control: role-gated REVEAL of the static hidden element, still → admin.html
   (the href lives in markup now; header_shell v2.0 asserts it there) */
const adminRevealVerdict = (src) =>
  src.includes('if (role === "admin" || role === "staff") (function headerAdminReveal()') &&
  src.includes('document.getElementById("btHdrAdmin")') &&
  src.includes("a.hidden = false");

test("site-nav.js keeps NO header injectors (v3.0 — both controls are static; a survivor doubles them)", () => {
  assert.ok(noInjectorVerdict(read("assets/site-nav.js")),
    "an element injector for btHdrMail/btHdrAdmin survived in site-nav.js");
});

test("admin-nav.js keeps NO mail injector (v2.0 rule, still in force)", () => {
  assert.ok(noInjectorVerdict(read("assets/admin-nav.js")),
    "a header-control injector appeared in admin-nav.js");
});

test("site-nav.js FILLS the static mail badge (data fill, not element injection)", () => {
  assert.ok(mailFillVerdict(read("assets/site-nav.js")), "headerMailFill missing or altered");
});

test("site-nav.js REVEALS the static role-gated Admin link (owner call: static + hidden + reveal)", () => {
  assert.ok(adminRevealVerdict(read("assets/site-nav.js")),
    "Admin reveal missing, un-gated, or reverted to injection");
});

test("static btHdrMail on admin-nav pages AND the 13 canonical member pages — nowhere else, widest set", () => {
  const all = pages();
  assert.ok(all.length >= 45, `web corpus shrank: ${all.length} html files`);
  let adminPages = 0, memberPages = 0;
  const missing = [], extras = [];
  for (const f of all) {
    const html = read(f);
    const admin = isAdmin(html), member = isMemberCanon(f, html);
    if (admin) adminPages++;
    if (member) memberPages++;
    const has = html.includes("btHdrMail");
    if ((admin || member) && !has) missing.push(f);
    if (!admin && !member && has) extras.push(f);
  }
  assert.ok(adminPages >= 27, `guard floor: expected >=27 admin-nav pages, saw ${adminPages} (failure class 4)`);
  assert.equal(memberPages, 13, `guard floor: expected exactly 13 canonical member pages, saw ${memberPages}`);
  assert.deepEqual(missing, [], `pages missing the static ✉: ${missing.join(", ")}`);
  assert.deepEqual(extras, [], `static ✉ on excluded pages (index/chromeless): ${extras.join(", ")}`);
});

test("static btHdrAdmin ships hidden on exactly the 13 canonical member pages — and NO admin page", () => {
  const offendersAdmin = [], missing = [];
  for (const f of pages()) {
    const html = read(f);
    if (isAdmin(html) && html.includes("btHdrAdmin")) offendersAdmin.push(f);
    if (isMemberCanon(f, html) && !/id="btHdrAdmin"[^>]*hidden/.test(html)) missing.push(f);
  }
  assert.deepEqual(offendersAdmin, [], `btHdrAdmin leaked onto admin pages: ${offendersAdmin.join(", ")}`);
  assert.deepEqual(missing, [], `canonical member pages missing the hidden Admin link: ${missing.join(", ")}`);
});

test("NC-1: a re-added site-nav injector fails the no-injector check (v3.0 subject line)", () => {
  const mutated = read("assets/site-nav.js") + '\n  const a = document.createElement("a"); a.id = "btHdrMail";';
  assert.equal(noInjectorVerdict(mutated), false,
    "re-introducing the injector signature must fail — if it passes, the verdict is blind");
});

test("NC-2: a stripped badge fill fails the fill check", () => {
  assert.equal(mailFillVerdict(read("assets/site-nav.js").replace("function headerMailFill()", "function x()")), false);
});

test("NC-3: an un-gated Admin reveal fails the check", () => {
  const mutated = read("assets/site-nav.js")
    .replace('if (role === "admin" || role === "staff") (function headerAdminReveal()', "(function headerAdminReveal()");
  assert.equal(adminRevealVerdict(mutated), false, "the role-gate check must notice a stripped gate");
});

test("NC-4: a reveal that stops un-hiding fails the check", () => {
  assert.equal(adminRevealVerdict(read("assets/site-nav.js").replace("a.hidden = false", "")), false);
});

/* ═══════════════ v3.1 — the two review fixes (v0.53.1) ═══════════════ */

/* (a) badge construction: DOM APIs, never markup-parsing, and idempotent. */
const badgeSafeVerdict = (src) => {
  const fn = src.match(/function headerMailFill\(\)[\s\S]*?\n      \}\)\(\);/);
  if (!fn) return { ok: false, why: "headerMailFill not found" };
  const body = fn[0];
  if (/insertAdjacentHTML|innerHTML\s*=/.test(body)) return { ok: false, why: "badge built by parsing markup" };
  if (!body.includes("createElement")) return { ok: false, why: "badge not built with createElement" };
  if (!body.includes("textContent")) return { ok: false, why: "count not written via textContent" };
  if (!/querySelector\(["'`]\.badge/.test(body)) return { ok: false, why: "no existing-badge lookup — not idempotent" };
  return { ok: true };
};

/* (b) logout reveal must sit OUTSIDE the signed-in branch, gated on the local token. */
const logoutRevealVerdict = (src) => {
  if (/function logoutReveal\(\)/.test(src)) return { ok: false, why: "reveal still inside the /api/me branch" };
  if (!/if \(lo && token\) lo\.hidden = false;/.test(src)) return { ok: false, why: "no synchronous token-gated reveal" };
  const revealAt = src.search(/if \(lo && token\) lo\.hidden = false;/);
  const initAt = src.search(/^  init\(\);$/m);
  if (initAt !== -1 && revealAt > initAt) return { ok: false, why: "reveal runs after init() — not synchronous" };
  return { ok: true };
};

test("v3.1(a): the mail badge is built with DOM APIs and is idempotent", () => {
  const v = badgeSafeVerdict(read("assets/site-nav.js"));
  assert.ok(v.ok, `badge construction regressed: ${v.why}`);
});

test("v3.1(b): Sign out is revealed synchronously from the local token, not from /api/me", () => {
  const v = logoutRevealVerdict(read("assets/site-nav.js"));
  assert.ok(v.ok, `logout reveal regressed: ${v.why}`);
});

test("NC-5: reverting the badge to insertAdjacentHTML fails the verdict", () => {
  const mutated = read("assets/site-nav.js")
    .replace("badge.textContent = inboxUnread > 9", 'a.insertAdjacentHTML("beforeend", "x"); const _ = inboxUnread > 9');
  assert.equal(badgeSafeVerdict(mutated).ok, false);
});

test("NC-6: dropping the existing-badge lookup fails the idempotency verdict", () => {
  const mutated = read("assets/site-nav.js").replace('let badge = a.querySelector(".badge");', "let badge = null;");
  assert.equal(badgeSafeVerdict(mutated).ok, false);
});

test("NC-7: moving the logout reveal back inside the /api/me branch fails the verdict", () => {
  const mutated = read("assets/site-nav.js")
    .replace("if (lo && token) lo.hidden = false;", "")
    .replace("(function headerMailFill() {", "(function logoutReveal() {})();\n      (function headerMailFill() {");
  assert.equal(logoutRevealVerdict(mutated).ok, false);
});
