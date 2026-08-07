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
 * INJECTORS are deleted from site-nav.js; 14 canonical member pages ship the static header
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

test("static btHdrMail on admin-nav pages AND the 15 canonical member pages — nowhere else, widest set", () => {
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
  // 14 → 15 in v0.85.0 (kotc.html, the KOTC player link — a no-login token page like score.html).
  // 15 → 16 in v0.86.0 (kotc-live.html, the public KOTC standings — generated from kotc.html's bytes,
  // so it arrived carrying the static ✉ rather than needing it added).
  assert.equal(memberPages, 16, `guard floor: expected exactly 16 canonical member pages, saw ${memberPages}`);
  assert.deepEqual(missing, [], `pages missing the static ✉: ${missing.join(", ")}`);
  assert.deepEqual(extras, [], `static ✉ on excluded pages (index/chromeless): ${extras.join(", ")}`);
});

test("static btHdrAdmin ships hidden on exactly the 15 canonical member pages — and NO admin page", () => {
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

/* ---------------- v0.56.0: the admin ✉ badge FILL (parked since v2.17) ---------------- */

const adminNavSrc = read("assets/admin-nav.js");
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

test("§6.5: mailBadgeFill is CALLED, not merely defined (F-15)", () => {
  // The first draft of v2.20 defined this function and never invoked it. Every other guard in
  // the suite went green, because a defined-and-unreferenced function is indistinguishable from
  // a working one at the source level unless you assert the CALL SITE. Failure class 1, caught
  // only by asking the question out loud. An import/definition must never satisfy this gate.
  const code = stripJs(adminNavSrc);
  const defined = /function mailBadgeFill\s*\(/.test(code);
  const called = /mailBadgeFill\(\)/.test(code.replace(/(async\s+)?function mailBadgeFill\s*\([^)]*\)/, ""));
  assert.ok(defined, "mailBadgeFill went missing");
  assert.ok(called, "mailBadgeFill is defined but never invoked — the badge would never render (failure class 1)");
});

test("the admin badge fills only after the role gate resolves", () => {
  const code = stripJs(adminNavSrc);
  assert.match(code, /guard\(\)\s*\.then\([^)]*\)\s*=>\s*\{?\s*if \(me\) mailBadgeFill\(\)/,
    "the count must hang off the memoized guard — fetching it for a visitor about to be bounced leaks that reports exist");
});

test("the admin badge is built with DOM APIs and is idempotent (v3.1(a) rule, extended)", () => {
  const fn = adminNavSrc.slice(adminNavSrc.indexOf("async function mailBadgeFill"),
                               adminNavSrc.indexOf("/* v0.11.0: standard dead-end recovery"));
  assert.match(fn, /createElement\("span"\)/, "the badge must be built with DOM APIs, never innerHTML");
  assert.doesNotMatch(fn, /innerHTML/, "innerHTML in a badge path is how markup gets parsed from a count");
  assert.match(fn, /querySelector\("\.badge"\)/, "must look for an existing badge — reuse-or-remove, or a second run stacks a second badge");
  assert.match(fn, /badge\.remove\(\)/, "a count that drops to zero must remove the badge, not leave a stale number");
  assert.match(fn, /textContent/, "the count must be set as text, never parsed as markup");
});

test("NC: the call-site gate fails when the invocation is removed", () => {
  const mutated = stripJs(adminNavSrc).replace(/guard\(\)\.then\(\(me\) => \{ if \(me\) mailBadgeFill\(\); \}\)\.catch\(\(\) => \{\}\);/, "guard();");
  assert.notEqual(mutated, stripJs(adminNavSrc), "mutation did not land — NC is vacuous");
  const called = /mailBadgeFill\(\)/.test(mutated.replace(/(async\s+)?function mailBadgeFill\s*\([^)]*\)/, ""));
  assert.equal(called, false, "with the call deleted the gate must report uncalled");
});

/* ---------- v2.15 (owner 2026-08-06): the member sidebar is not a second admin rail ----------
   The owner reported the member page "switching back and forth and exposing the admin page".
   site-nav.js used to push a "Manage" group of four ADMIN destinations into the MEMBER nav for
   any staff viewer, while the admin shell's header links back to the member site — so each shell
   advertised the other. Removed. The one way back is the single header #btHdrAdmin link, which
   adminRevealVerdict above still requires, so this pair cannot be "fixed" by deleting both. */

/* NAV hrefs only. site-nav.js legitimately names admin.html once more — the "Viewing as member —
   Exit" pill — and a verdict that scanned the whole file would fail on that and be wrong. */
const navHrefs = (src) => [...stripJs(src).matchAll(/\bhref:\s*"([^"]+)"/g)].map((m) => m[1]);
const isAdminSurface = (h) => /^admin[-.]/.test(h) || h.split("#")[0] === "tournament.html";
const memberNavVerdict = (src) => navHrefs(src).filter(isAdminSurface);

test("the member sidebar offers NO admin destination (v2.15 — the reported shell ping-pong)", () => {
  const src = read("assets/site-nav.js");
  assert.ok(navHrefs(src).length >= 10, `NAV href extraction collapsed (${navHrefs(src).length}) — idiom drift, not a clean scan`);
  assert.deepEqual(memberNavVerdict(src), [],
    "an admin destination is back in the member nav; the way to the Control Center is the header link");
});

test("NC-A1: re-adding one admin link to the member NAV FAILS the verdict", () => {
  // Mutate the REAL source, in the real idiom, at a real insertion point.
  const src = read("assets/site-nav.js");
  const mutated = src.replace('{ href: "profile.html"',
    '{ href: "admin-events.html", ico: "x", text: "Events and Programs" },\n        { href: "profile.html"');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(memberNavVerdict(mutated), ["admin-events.html"],
    "the verdict must catch an admin href put back into the member nav");
});

test("NC-A2: tournament.html counts as an admin surface (it loads admin-nav.js)", () => {
  // It does not match /^admin[-.]/, so it needs its own arm — and that arm needs its own control.
  const src = read("assets/site-nav.js");
  const mutated = src.replace('{ href: "profile.html"',
    '{ href: "tournament.html", ico: "x", text: "Tournament Ops" },\n        { href: "profile.html"');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(memberNavVerdict(mutated), ["tournament.html"]);
  assert.match(read("tournament.html"), /assets\/admin-nav\.js/,
    "tournament.html must still be an admin page, or this rule is pinning the wrong file");
});

/* ---------- v2.15: a role in another org is not a role on this page ---------- */

/* The old line ended `|| (me.roles || [])[0]`, which handed the caller their FIRST role in ANY org
   when they had none in the org on screen — so a member here who is staff elsewhere saw the Admin
   link for an org they hold no role in. Server-side this was always refused (requireStaff reads
   userId + orgId), so it was presentation-only; presentation is what the owner saw. */
const orgRoleVerdict = (src) => {
  const s = stripJs(src);
  return s.includes("(me.roles || []).find(x => !orgId || Number(x.org_id) === orgId)") &&
         !/\.find\(x => !orgId[^\n]*\)\s*\|\|\s*\(me\.roles \|\| \[\]\)\[0\]/.test(s);
};

test("the member header role comes from the ACTIVE org, with no cross-org fallback", () => {
  assert.ok(orgRoleVerdict(read("assets/site-nav.js")),
    "site-nav.js must resolve role against the active org and must not fall back to roles[0]");
});

test("NC-A3: restoring the cross-org fallback FAILS the verdict", () => {
  const src = read("assets/site-nav.js");
  const mutated = src.replace(
    "(me.roles || []).find(x => !orgId || Number(x.org_id) === orgId)",
    "(me.roles || []).find(x => !orgId || x.org_id === orgId) || (me.roles || [])[0]");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(orgRoleVerdict(mutated), false,
    "the verdict must reject the roles[0] fallback that showed admin nav for the wrong org");
});

/* ---------- v2.23: guard() bounces with replace(), so Back cannot re-enter the admin shell ----
   admin.html ships its whole rail as static markup, so the admin shell is on screen before
   /api/me can answer. With location.href the bounce PUSHED history — [.., admin.html, home.html]
   — so Back re-entered admin.html, repainted the shell, and bounced forward again, forever. That
   is the owner's "switch back and forth and expose the admin page" (2026-08-06). replace()
   overwrites the entry instead. Deliberate user navigations (View as member, the history.back()
   helpers) are NOT covered: a user's own click belongs in their history. */

const guardBody = (src) => {
  const s = stripJs(src);
  const i = s.indexOf("async function guard()");
  assert.notEqual(i, -1, "guard() not found — this guard is pinning a function that moved");
  const j = s.indexOf("\n  }", i);
  assert.notEqual(j, -1, "guard() body end not found");
  return s.slice(i, j);
};
const guardBouncesVerdict = (src) => {
  const b = guardBody(src);
  return { replaces: (b.match(/location\.replace\(/g) || []).length, hrefs: (b.match(/location\.href\s*=/g) || []).length };
};

test("every guard() bounce uses location.replace, never location.href (v2.23 — the back-trap)", () => {
  const v = guardBouncesVerdict(adminNavSrc);
  assert.equal(v.hrefs, 0, "a location.href bounce in guard() pushes history and re-opens the back-trap");
  assert.equal(v.replaces, 4, `guard() must bounce in exactly its 4 rejection paths (found ${v.replaces}) — a new path needs replace() too`);
});

test("NC-A4: turning ONE guard() bounce back into location.href FAILS the verdict", () => {
  const mutated = adminNavSrc.replace(
    'if (!bearer()) { location.replace("index.html"); return null; }',
    'if (!bearer()) { location.href = "index.html"; return null; }');
  assert.notEqual(mutated, adminNavSrc, "mutation did not land — NC is vacuous");
  const v = guardBouncesVerdict(mutated);
  assert.equal(v.hrefs, 1, "the verdict must see the reintroduced href");
  assert.notEqual(v.replaces, 4, "and must no longer count 4 replaces");
});

test("NC-A5: the deliberate 'View as member' navigation is NOT caught (scope control)", () => {
  // If this ever fails, the verdict has widened past guard() and would start forbidding
  // navigations a user asked for — the opposite of the fix.
  assert.match(stripJs(adminNavSrc), /location\.href = "home\.html";/,
    "View as member should still push history — it is a user's own click");
  assert.equal(guardBouncesVerdict(adminNavSrc).hrefs, 0,
    "...and it must sit OUTSIDE guard(), or the scope of this rule is wrong");
});
