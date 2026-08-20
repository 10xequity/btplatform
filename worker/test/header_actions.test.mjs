/**
 * Boomtown Platform — header-actions guard
 * File: worker/test/header_actions.test.mjs · Version: v4.0 · Date: 2026-08-20 · Ships in: v0.171.0
 *
 * v4.0 (v0.171.0, §-1r RF-12 — owner 2026-08-18): "There should be no admin access from this
 * screen." EVERY admin-leading affordance is REMOVED from every member surface: the static
 * #btHdrAdmin anchor (17 pages), site-nav.js's role reveal, index.html's staff Control Center
 * card, the login card's Manager tab, and settings.html's System (staff) section. Said honestly:
 * none of them granted access — all admin routes are gated server-side — so this is
 * least-surface, not a hole being closed; his instruction removes the affordances anyway.
 * The v3.0 reveal verdicts INVERT (assert absence), and a new derived widest-set guard at the
 * bottom keeps a NEW member page or script from reintroducing one. The single sanctioned
 * admin.html reference left in member-loaded code is the "Viewing as member — Exit" pill:
 * admin pages bounce back to home.html while bt_demo_member is set, so the pill is the only
 * exit from the preview and deleting it is a navigation lockout, not a hardening.
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
/* v0.105.0: brace-matching for badgeSafeVerdict's body extraction. Imported from the TESTKIT, not
   from a test file — importing an export from a test file re-registers that file's tests. */
import { blockEnd } from "../testkit/route-extract.mjs";

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
/* site-nav must FILL the static ✉ (badge + aria) instead of creating it.
   v0.105.0 — THE ARITY PIN WAS DROPPED, DELIBERATELY, AND THE INVARIANT IS UNCHANGED. This read
   `function headerMailFill()` with empty parens. §-1c D-15's fix moved the badge fetches out of
   the rail's critical path, so the helper now takes the count as an argument
   (`headerMailFill(inboxUnread)`) instead of closing over it — and this verdict failed against a
   CORRECT change. The claim being guarded is "site-nav FILLS the static element rather than
   INJECTING one", and all three parts of that survive: the named function still exists, it still
   resolves the STATIC #btHdrMail by id, and it still uses the count. The empty parens pinned the
   helper's arity, which never encoded anything. §-1c D-17 for the second time in one session —
   the marker sweep it records is owed. */
const mailFillVerdict = (src) =>
  src.includes("function headerMailFill(") &&
  src.includes('document.getElementById("btHdrMail")') &&
  src.includes("inboxUnread");
/* v4.0 (RF-12): the Admin control is GONE — site-nav.js may not reveal, inject, or even resolve
   #btHdrAdmin. Any reappearance, by the old helper name or by a bare getElementById, is the
   affordance coming back. (The pill's own rules live with the widest-set guard below.) */
const noAdminRevealVerdict = (src) =>
  !src.includes("headerAdminReveal") &&
  !src.includes('getElementById("btHdrAdmin")');

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

test("site-nav.js keeps NO Admin reveal (RF-12 — no admin access from member screens)", () => {
  assert.ok(noAdminRevealVerdict(read("assets/site-nav.js")),
    "an Admin reveal is back in site-nav.js — RF-12 removed the affordance");
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
  // 16 → 17 in v0.132.0 (sheet.html, the public drop-in sheet — generated from register.html's
  // bytes, so it arrived carrying the static ✉ and the hidden Admin link).
  assert.equal(memberPages, 17, `guard floor: expected exactly 17 canonical member pages, saw ${memberPages}`);
  assert.deepEqual(missing, [], `pages missing the static ✉: ${missing.join(", ")}`);
  assert.deepEqual(extras, [], `static ✉ on excluded pages (index/chromeless): ${extras.join(", ")}`);
});

test("btHdrAdmin appears NOWHERE in the shipped corpus (RF-12 — the anchor is removed, every page)", () => {
  const offenders = pages().filter((f) => read(f).includes("btHdrAdmin"));
  assert.deepEqual(offenders, [], `the removed Admin anchor is back: ${offenders.join(", ")}`);
});

test("NC-1: a re-added site-nav injector fails the no-injector check (v3.0 subject line)", () => {
  const mutated = read("assets/site-nav.js") + '\n  const a = document.createElement("a"); a.id = "btHdrMail";';
  assert.equal(noInjectorVerdict(mutated), false,
    "re-introducing the injector signature must fail — if it passes, the verdict is blind");
});

test("NC-2: a stripped badge fill fails the fill check", () => {
  /* v0.105.0: this mutation used to target `function headerMailFill()` with empty parens. When
     D-15's fix gave the helper an argument, the replace stopped matching, became a NO-OP, and the
     NC failed — correctly, and that is the useful part: it reported its own vacuousness instead of
     passing while testing nothing. It lacked the "mutation did not land" assertion every newer
     guard in this repo carries, so it could only announce the problem by failing. It has one now. */
  const src = read("assets/site-nav.js");
  const mutated = src.replace("function headerMailFill(", "function x(");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(mailFillVerdict(mutated), false,
    "removing the named fill helper must fail the verdict — if it passes, the verdict is blind");
});

test("NC-3: a re-added Admin reveal FAILS the no-reveal verdict (the removed idiom, verbatim)", () => {
  const src = read("assets/site-nav.js");
  const mutated = src + '\n      (function headerAdminReveal() {\n' +
    '        const a = document.getElementById("btHdrAdmin");\n' +
    '        if (!a) return;\n        a.hidden = false;\n      })();';
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(noAdminRevealVerdict(mutated), false,
    "re-introducing the reveal must fail — if it passes, the verdict is blind");
});

test("NC-4: resolving #btHdrAdmin by id alone (no named helper) FAILS too", () => {
  const mutated = read("assets/site-nav.js") + '\n      document.getElementById("btHdrAdmin");';
  assert.equal(noAdminRevealVerdict(mutated), false,
    "any #btHdrAdmin resolution in site-nav.js is the affordance back under another name");
});

/* ═══════════════ v3.1 — the two review fixes (v0.53.1) ═══════════════ */

/* (a) badge construction: DOM APIs, never markup-parsing, and idempotent.
   v0.105.0 — THE EXTRACTION WAS REWRITTEN; THE FOUR CHECKS BELOW ARE UNTOUCHED. It used to grab
   the body with /function headerMailFill\(\)[\s\S]*?\n      \}\)\(\);/ — a regex pinned to BOTH
   empty parens AND the old `(function …)();` IIFE shape at six-space indent. D-15's fix made the
   helper a plain two-space function taking the count as an argument, so the match failed and this
   reported "headerMailFill not found" against code that still satisfies every rule it guards.
   Now brace-matched with the repo's own `blockEnd`, so it survives re-indentation and re-wrapping.
   THE INVARIANT IS UNCHANGED: built with createElement, written with textContent, never by
   parsing markup, and idempotent via an existing-.badge lookup. */
const badgeSafeVerdict = (src) => {
  const sig = src.indexOf("function headerMailFill(");
  if (sig < 0) return { ok: false, why: "headerMailFill not found" };
  const brace = src.indexOf("{", sig);
  if (brace < 0) return { ok: false, why: "headerMailFill has no body" };
  const body = src.slice(sig, blockEnd(src, brace));
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
   advertised the other. Removed. (Until v4.0 the one way back was the header #btHdrAdmin link;
   RF-12 removed that too — staff reach the Control Center by URL or bookmark now, his call.) */

/* NAV hrefs only. site-nav.js legitimately names admin.html once more — the "Viewing as member —
   Exit" pill — and a verdict that scanned the whole file would fail on that and be wrong. */
const navHrefs = (src) => [...stripJs(src).matchAll(/\bhref:\s*"([^"]+)"/g)].map((m) => m[1]);
const isAdminSurface = (h) => /^admin[-.]/.test(h) || h.split("#")[0] === "tournament.html";
const memberNavVerdict = (src) => navHrefs(src).filter(isAdminSurface);

test("the member sidebar offers NO admin destination (v2.15 — the reported shell ping-pong)", () => {
  const src = read("assets/site-nav.js");
  assert.ok(navHrefs(src).length >= 10, `NAV href extraction collapsed (${navHrefs(src).length}) — idiom drift, not a clean scan`);
  assert.deepEqual(memberNavVerdict(src), [],
    "an admin destination is back in the member nav — RF-12: no admin affordance on member surfaces");
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

/* ---------- D-22 (v0.123.0): the v2.15 rule reached only the file that already obeyed it ----------
   memberNavVerdict above scans site-nav.js, which was cleaned in v2.15/v0.101.0. But `app.js`
   paints the OTHER member surface — the signed-in card grid on index.html — and it predates that
   cleanup (v0.6.0, 2026-07-23), so it was never in scope. It offered staff FOUR admin
   destinations: tournament.html, admin-users.html, admin-registrations.html and a Foundation
   card. The suite was green over the owner's tester-round complaint that "the menu buttons lead
   into admin pages, not membership views", because the rule was enforced on the obedient file.

   THE RULE'S EXEMPTION ENDED WITH RF-12 (v4.0). D-22's owner-settled rule was "exactly ONE way
   to the Control Center", and this verdict exempted the single admin.html card as that way. The
   owner's 2026-08-18 word removes even that: the card grid offers NO admin surface at all, and
   staff reach the Control Center by URL or bookmark. He was told the removal has that cost; the
   ONE sanctioned admin.html reference left anywhere in member-loaded code is the
   "Viewing as member — Exit" pill, whose presence test is below. */
const cardHrefs = (src) => [...stripJs(src).matchAll(/card\("([^"]+)"/g)].map((m) => m[1]);
const memberCardVerdict = (src) =>
  cardHrefs(src).filter((h) => isAdminSurface(h) || h === "admin.html");

test("D-22+RF-12: the member CARD GRID offers NO admin destination — admin.html included now", () => {
  const src = read("assets/app.js");
  assert.ok(cardHrefs(src).length >= 5, `card href extraction collapsed (${cardHrefs(src).length}) — idiom drift, not a clean scan`);
  assert.deepEqual(memberCardVerdict(src), [],
    "an admin destination is on the member front door — RF-12 ended the one-card exemption");
});

test("RF-12: the sanctioned exit from view-as-member EXISTS — the pill is not a member affordance", () => {
  /* Admin pages bounce back to home.html while bt_demo_member is set, so this pill is the ONLY
     exit from the preview mode. It renders only for a staff/admin session that is already in
     that mode — a member can never see it. Deleting it is a lockout, not a hardening. */
  const code = stripJs(read("assets/site-nav.js"));
  assert.match(code, /exitMemberView\("admin\.html"\)/,
    "the Viewing-as-member Exit pill is gone — staff who enter the preview cannot leave it");
  assert.equal((code.match(/admin\.html/g) || []).length, 1,
    "site-nav.js code must name admin.html EXACTLY once (the pill) — a second naming is a new affordance");
});

test("NC-D22a: putting one admin destination back into the card grid FAILS the verdict", () => {
  const src = read("assets/app.js");
  const mutated = src.replace('card("leagues.html"', 'card("admin-users.html", "Member Management", "x", "Live")}\n          ${card("leagues.html"');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(memberCardVerdict(mutated), ["admin-users.html"],
    "the verdict must catch an admin href put back into the member card grid");
});

test("NC-D22b: tournament.html in the card grid is caught too (it loads admin-nav.js)", () => {
  const src = read("assets/app.js");
  const mutated = src.replace('card("leagues.html"', 'card("tournament.html", "Tournaments", "x", "Live")}\n          ${card("leagues.html"');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(memberCardVerdict(mutated), ["tournament.html"],
    "tournament.html must count as an admin surface in the card grid, exactly as it does in the nav");
});

test("NC-D22c: the old Control Center card put back FAILS now (RF-12 ended the exemption)", () => {
  const src = read("assets/app.js");
  const mutated = src.replace('card("settings.html"',
    'card("admin.html", "Control Center", "x", "Live")}\n          ${card("settings.html"');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(memberCardVerdict(mutated), ["admin.html"],
    "admin.html in the member card grid must be an offender — RF-12 ended the one-card exemption");
});

/* ═══════════ v4.0 — §-1r RF-12 (owner 2026-08-18): NO ADMIN AFFORDANCE ON ANY MEMBER SURFACE ═══════════
   His words: "there are options for the admin panel on that page or lead to the admin page. This
   is not allowable for security reason… There should be no admin access from this screen."
   The guard is over the WIDEST set and everything is DERIVED, never listed:
     · an ADMIN SURFACE is any web page that loads admin-nav.js — the property, not the filename,
       which is what catches tournament.html (no admin- prefix);
     · a MEMBER SURFACE is every other shipped page, plus the repo-root index.html and 404.html;
     · the scripts checked are exactly the LOCAL scripts those member pages load, so a new page or
       a new script joins the corpus by existing, and admin-side scripts (which legitimately name
       admin pages) never enter it — an exclusion the derivation is itself tested for.
   Comments are stripped at both grains first (a filename in prose is not an affordance), and the
   stripping has its own positive control. */

const ROOT_DIR = new URL("../../", import.meta.url);
const readRoot = (p) => readFileSync(new URL(p, ROOT_DIR), "utf8");
/* HTML comments first, then JS comments inside what remains (inline <script> bodies) */
const stripHtml = (html) => stripJs(html.replace(/<!--[\s\S]*?-->/g, ""));
const adminSurfaceSet = () => new Set(pages().filter((f) => isAdmin(read(f))));
const memberSurfaceList = () => pages().filter((f) => !isAdmin(read(f)));
const memberScriptList = () => {
  const seen = new Set();
  const htmls = memberSurfaceList().map((f) => read(f)).concat([readRoot("index.html"), readRoot("404.html")]);
  for (const html of htmls)
    /* the optional (?:\?…) arm eats the cache-buster: every shipped tag reads src="x.js?v=N.N.N",
       and without that arm the closing quote can never match — probed before shipping, and the
       ≥20 floor below is what catches this extractor going blind again */
    for (const m of html.matchAll(/<script[^>]+src="(?!https?:)([^"?]+)(?:\?[^"]*)?"/g)) seen.add(m[1]);
  return [...seen];
};
/* the shared verdict: which admin surfaces does this comment-stripped content still name? */
const adminNamesIn = (content, admins) => [...admins].filter((a) => content.includes(a));

test("RF-12: no member surface names an admin surface (derived both ways, comments stripped)", () => {
  const admins = adminSurfaceSet();
  assert.ok(admins.size >= 38, `admin-surface derivation collapsed: ${admins.size} (failure class 4)`);
  assert.ok(admins.has("tournament.html") && admins.has("admin.html"),
    "the derivation lost a known admin surface — the property scan broke, the corpus is not clean");
  const members = memberSurfaceList();
  assert.ok(members.length >= 22, `member-surface derivation collapsed: ${members.length}`);
  assert.ok(members.includes("home.html") && members.includes("sheet.html"),
    "the derivation lost a known member surface");
  const offenders = [];
  for (const f of members) {
    const named = adminNamesIn(stripHtml(read(f)), admins);
    if (named.length) offenders.push(`${f} → ${named.join(", ")}`);
  }
  for (const f of ["index.html", "404.html"]) {
    const named = adminNamesIn(stripHtml(readRoot(f)), admins);
    if (named.length) offenders.push(`root ${f} → ${named.join(", ")}`);
  }
  assert.deepEqual(offenders, [],
    `member surfaces lead to admin screens (RF-12):\n  ${offenders.join("\n  ")}`);
});

test("RF-12: no script a member page loads names an admin surface — the pill excepted, exactly once", () => {
  const admins = adminSurfaceSet();
  const scripts = memberScriptList();
  assert.ok(scripts.length >= 20, `member-script derivation collapsed: ${scripts.length}`);
  assert.ok(scripts.includes("assets/site-nav.js") && scripts.includes("home.js"),
    "the derivation lost a known member script");
  assert.ok(!scripts.includes("assets/admin-nav.js") && !scripts.includes("assets/team-roster.js"),
    "an admin-side script entered the member corpus — the exclusion broke, so the scan would " +
    "either false-positive on legitimate admin links or be proving the wrong set clean");
  const offenders = [];
  for (const s of scripts) {
    let code = stripJs(read(s));
    /* the one sanctioned reference: String.replace removes only the FIRST occurrence, so the
       allowance is exactly one — a second naming stays in `code` and is reported */
    if (s === "assets/site-nav.js") code = code.replace('exitMemberView("admin.html")', "");
    const named = adminNamesIn(code, admins);
    if (named.length) offenders.push(`${s} → ${named.join(", ")}`);
  }
  assert.deepEqual(offenders, [],
    `member-loaded scripts lead to admin screens (RF-12):\n  ${offenders.join("\n  ")}`);
});

test("NC-R1: an admin link added to a member page is caught", () => {
  const admins = adminSurfaceSet();
  const src = read("home.html");
  const mutated = src + '\n<a href="admin-users.html">Manage</a>';
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(adminNamesIn(stripHtml(mutated), admins), ["admin-users.html"],
    "an admin href on a member page must be reported — if this passes, the scan is blind");
});

test("NC-R2: an admin filename in an HTML comment does NOT trip the scan (stripper control)", () => {
  const admins = adminSurfaceSet();
  const src = read("home.html");
  const mutated = src + "\n<!-- see admin-users.html -->";
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(adminNamesIn(stripHtml(mutated), admins), [],
    "a filename in prose is not an affordance — a broken stripper turns every documented mention " +
    "into a false offender");
});

test("NC-R3: an admin navigation added to a member-loaded script is caught", () => {
  const admins = adminSurfaceSet();
  const src = read("assets/schedule.js");
  const mutated = src + '\nlocation.href = "admin-events.html";';
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(adminNamesIn(stripJs(mutated), admins), ["admin-events.html"],
    "an admin destination in a member-loaded script must be reported");
});

test("NC-R4: a JS comment naming an admin page does NOT trip the scan — and the stripper is not blind", () => {
  const admins = adminSurfaceSet();
  const src = read("assets/schedule.js");
  const commented = src + "\n// see admin-events.html for the admin grid";
  assert.notEqual(commented, src, "mutation did not land — NC is vacuous");
  assert.deepEqual(adminNamesIn(stripJs(commented), admins), [],
    "a comment mention must not be an offender");
  /* positive control on the stripper itself: the SAME needle outside a comment IS kept */
  assert.deepEqual(adminNamesIn(stripJs(commented + '\nlocation.href = "admin-events.html";'), admins),
    ["admin-events.html"], "the stripper ate live code — it is deleting more than comments");
});

test("NC-R5: a SECOND code-level admin.html in site-nav.js is caught — the pill allowance is one", () => {
  const admins = adminSurfaceSet();
  const src = read("assets/site-nav.js");
  const mutated = src + '\nlocation.href = "admin.html";';
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  const code = stripJs(mutated).replace('exitMemberView("admin.html")', "");
  assert.deepEqual(adminNamesIn(code, admins), ["admin.html"],
    "with the pill's single allowance spent, a second admin.html reference must be reported");
});
