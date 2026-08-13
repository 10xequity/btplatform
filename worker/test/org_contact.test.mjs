/**
 * Boomtown Platform — member-page contact address guard (§-1c D-28 / §-0 B29 / standards §8 F-40)
 * File: worker/test/org_contact.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.143.0
 *
 * THE RULE (standards §8): "No literal org email address in member-facing copy (F-40); identity
 * resolves through the org profile." Five sites broke it since v0.6.0 — settings.js's "Request
 * change" button and a `Have questions or need help?` footer on member/profile/library/
 * member-inbox — and the register (D-28) asked for "a corpus check" when they were fixed, because
 * nothing scanned member-page mailto: hrefs at all.
 *
 * WHY THE LITERAL WAS A DEFECT AND NOT JUST UNTIDY. Every organization already SETS its own
 * contact address on its own settings screen (`admin-org-settings.html` "Contact email" →
 * `orgs.admin_email`, allow-listed at `orgs.js`'s EDITABLE, published as the {{ORG_EMAIL}} token),
 * and live D1 on 2026-08-12 held three distinct ones. So Colorado Boom and Match Point members
 * were being told to email Boomtown. The fix reads the address the org already set.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * SCOPING — THE REAL DESIGN WORK, WRITTEN DOWN FOR WHOEVER WIDENS THIS.
 *
 * 1. THE CORPUS IS THE 17 CANONICAL MEMBER PAGES **AND THE SCRIPTS THEY LOAD**, because one of
 *    the five offending sites (`settings.js`) is not in any page's HTML — it is an anchor inside
 *    a JS template literal. A page-HTML-only scan would have reported four of five and called
 *    itself clean. `isMemberCanon` is spelled exactly as `header_actions.test.mjs` spells it so
 *    the two ratchets cannot drift apart silently.
 *
 * 2. `site-nav.js` IS IN THE CORPUS ON PURPOSE — IT IS NOT EXCLUDED, AND THAT IS THE HONEST CALL.
 *    The tempting move here was an exclusion: the filler lives in site-nav.js, every member page
 *    loads it, so "exclude the definer or the check clears everything" (iteration 65's vacuity
 *    trap). It does not apply, and pretending it did would have bought a negative control that
 *    tests nothing. site-nav.js holds a `querySelectorAll("[data-org-contact]")` SELECTOR, never
 *    an `<a>` element, so a tag-shaped detector cannot mistake it for markup. The control that
 *    actually earns its place is therefore a COUNT (test 4): the corpus must contain exactly the
 *    five contact anchors, so a scan that reads too few or too many fails instead of passing
 *    quietly. NC-3 proves the script half of the corpus is genuinely read by planting a real
 *    offence in site-nav.js itself.
 *
 * 3. COMMENTS ARE STRIPPED FIRST (standing rule), BUT ONLY HTML AND JS *BLOCK* COMMENTS.
 *    `//` is deliberately left alone: blanking it would eat the rest of any line containing
 *    `https://`, which would turn this into a source of false CLEANS — the worst failure a guard
 *    can have. Measured 2026-08-12: no email literal in the corpus sits in a line comment, and
 *    one appearing later is a fair flag anyway.
 *
 * 4. THE PLACEHOLDER EXEMPTION IS REAL AND IS EXERCISED. `profile.js` carries
 *    `placeholder="you@example.com"` — the SHAPE of an address in a form hint, not copy telling a
 *    member where to write. It is exempt by attribute, never by address, and NC-2 proves the
 *    exemption is scoped rather than blanket.
 *
 * FAIL-CLOSED, DECIDED AT BUILD TIME AND PINNED HERE (test 5). A page whose brand fetch fails
 * must not render a dead or empty `mailto:`. The decision: **the fallback lives in the STATIC
 * MARKUP, not in a runtime branch.** Every contact anchor ships `href="help.html"` — a live page
 * — and site-nav.js rewrites it to a `mailto:` only once a non-empty address has resolved. Two
 * consequences worth stating: a member who is offline, signed out of an org, or served a 5xx gets
 * a working route rather than a broken one; and "empty and broken look identical" cannot happen
 * here by construction, because the empty state is a real destination. The link text is
 * destination-agnostic ("Contact us" / "Request change") so nothing rewrites the words and there
 * is no post-paint copy flash.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { scriptsOf } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const SRC = new URL("../src/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");
const readSrc = (rel) => readFileSync(new URL(rel, SRC), "utf8");
const htmlFiles = () => readdirSync(WEB).filter((f) => f.endsWith(".html"));

/* Spelled exactly as header_actions.test.mjs spells it — the same 17-page set, same ratchet. */
const isMemberCanon = (f, html) =>
  f !== "index.html" && /<script[^>]+src="assets\/site-nav\.js[^"]*"/.test(html);

/* The one external script a member page loads. Named, so an UNNAMED unreadable src fails the
   corpus check instead of silently shrinking it (an audit's first output measures the search). */
const EXTERNAL = "https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js";

/* ── pure helpers — the real corpus and every negative control go through these ── */

const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const stripJsBlockComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const strip = (s) => stripJsBlockComments(stripHtmlComments(s));

const EMAIL = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";

/** Literal email addresses in member-facing copy. An address inside a `placeholder="..."`
 *  attribute is a form hint about SHAPE, not copy — exempt by attribute, never by address. */
export function emailOffences(text) {
  const cleaned = strip(text).replace(new RegExp('placeholder\\s*=\\s*"' + EMAIL + '"', "g"), "");
  return [...cleaned.matchAll(new RegExp(EMAIL, "g"))].map((m) => m[0]);
}

/** Anchor elements carrying the data-org-contact marker, with the href they SHIP in source. */
export function contactAnchors(text) {
  const out = [];
  for (const m of strip(text).matchAll(/<a\b[^>]*\bdata-org-contact\b[^>]*>/g)) {
    const tag = m[0];
    const href = /\bhref\s*=\s*"([^"]*)"/.exec(tag);
    out.push({ tag, href: href ? href[1] : null });
  }
  return out;
}

/** Build the corpus once: page HTML plus every readable script a member page loads. */
function corpus() {
  const pages = new Map(), scripts = new Map();
  const unreadable = [];
  for (const f of htmlFiles()) {
    const html = read(f);
    if (!isMemberCanon(f, html)) continue;
    pages.set(f, html);
    for (const s of scriptsOf(html)) {
      if (scripts.has(s) || unreadable.includes(s)) continue;
      try { scripts.set(s, read(s)); } catch { unreadable.push(s); }
    }
  }
  return { pages, scripts, unreadable };
}

/* ══════════════════ 1–2. the corpus is real before anything is concluded from it ═════════════ */

test("corpus: exactly the 17 canonical member pages, and the same set header_actions ratchets", () => {
  const { pages } = corpus();
  assert.equal(pages.size, 17,
    `expected exactly 17 canonical member pages, saw ${pages.size}: ${[...pages.keys()].join(", ")}`);
  for (const f of ["member.html", "profile.html", "library.html", "member-inbox.html", "settings.html"]) {
    assert.ok(pages.has(f), `${f} — a page that carried a hard-coded address — left the corpus`);
  }
});

test("corpus: the scripts are actually read, and the ONLY unreadable src is the named CDN one", () => {
  const { scripts, unreadable } = corpus();
  assert.ok(scripts.size >= 20, `read only ${scripts.size} scripts — the corpus read is broken, not clean`);
  assert.deepEqual(unreadable, [EXTERNAL],
    `an unnamed src could not be read — the scan shrank silently: ${unreadable.join(", ")}`);
  assert.ok(scripts.has("assets/settings.js"),
    "settings.js is the site that page-HTML-only scans miss — it must be in the corpus");
  assert.ok(scripts.has("assets/site-nav.js"),
    "site-nav.js is IN the corpus by design (see the header) — its absence would hide NC-3's class");
});

/* ═══════════════════════ 3. THE RULE — standards §8 / F-40 / D-28 ════════════════════════════ */

test("F-40: zero literal email addresses in member-facing copy, across pages AND their scripts", () => {
  const { pages, scripts } = corpus();
  const bad = [];
  for (const [name, text] of [...pages, ...scripts]) {
    for (const hit of emailOffences(text)) bad.push(`${name}: ${hit}`);
  }
  assert.deepEqual(bad, [], "a literal org email address is in member-facing copy — it must "
    + `resolve through the org profile (orgs.admin_email via [data-org-contact]):\n${bad.join("\n")}`);
});

/* ══════════════ 4–6. the mechanism that replaced the literals, and the fail-closed call ══════ */

test("the corpus holds exactly the five contact anchors — a scan finding a different number is broken", () => {
  const { pages, scripts } = corpus();
  const found = [];
  for (const [name, text] of [...pages, ...scripts]) {
    for (const a of contactAnchors(text)) found.push(`${name}`);
  }
  found.sort();
  assert.deepEqual(found, [
    "assets/settings.js", "library.html", "member-inbox.html", "member.html", "profile.html",
  ], `the five sites D-28 measured are the five that must carry [data-org-contact]; saw: ${found.join(", ")}`);
});

test("FAIL CLOSED: every contact anchor ships a live non-mailto href, so an unresolved brand is never dead", () => {
  const { pages, scripts } = corpus();
  const bad = [];
  for (const [name, text] of [...pages, ...scripts]) {
    for (const a of contactAnchors(text)) {
      if (!a.href) bad.push(`${name}: no href at all — an unresolved brand renders a dead link`);
      else if (a.href.startsWith("mailto:")) bad.push(`${name}: ships a literal mailto: (${a.href})`);
      else if (!a.href.trim()) bad.push(`${name}: empty href — empty and broken look identical`);
    }
  }
  assert.deepEqual(bad, [], `contact anchors must ship a live fallback destination:\n${bad.join("\n")}`);
});

test("site-nav.js writes the mailto ONLY from a non-empty resolved address, and exposes the filler", () => {
  const nav = strip(read("assets/site-nav.js"));
  assert.match(nav, /\[data-org-contact\]/, "site-nav.js does not select the shared contact marker");
  /* The PROPERTY read, not the variable holding it — pinning the reference's spelling is how a
     correct rename reddens a guard that was never about the name. */
  assert.match(nav, /\.admin_email\b/, "site-nav.js does not read admin_email off the brand payload");
  assert.match(nav, /"mailto:"/, "site-nav.js never builds a mailto: — the anchors would stay on the fallback");
  /* The truthiness guard IS the fail-closed half that lives in code rather than markup: without
     it a brand payload with a NULL admin_email writes `mailto:null`. */
  assert.match(nav, /if\s*\(\s*!\s*email\s*\)\s*return/,
    "no early return on a missing address — a null admin_email would render mailto:null");
  /* settings.js renders its row AFTER the rail has painted, so the filler cannot be private to
     the rail's own render pass or that anchor is never filled. Measured: both scripts are
     `defer`, but applyOrgBrand is async and settings.js's markup does not exist when it runs. */
  assert.match(nav, /window\.btOrgContact\s*=/,
    "the filler is not exposed — a page that renders after the rail cannot fill its own anchor");
});

test("settings.js fills its own late-rendered anchor instead of trusting the rail's single pass", () => {
  const s = strip(read("assets/settings.js"));
  assert.match(s, /window\.btOrgContact/,
    "settings.js renders after applyOrgBrand has run; without calling the filler its anchor stays on the fallback");
});

/* ════════════ 7–8. the server end: the address comes from the ORG row, never the user ════════ */

test("publicOrgBrand publishes admin_email — selected FROM orgs, so it can never be a login email", () => {
  const src = strip(readSrc("announcements.js"));
  const fn = src.slice(src.indexOf("export async function publicOrgBrand"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.ok(body.length > 100, "publicOrgBrand not found — this guard is measuring nothing");
  assert.match(body, /admin_email/, "admin_email is not in publicOrgBrand — member pages have nothing to read");
  assert.match(body, /FROM orgs/, "the address must be selected from the orgs row");
  /* The owner's constraint, pinned structurally rather than by comment: admin@boomtownvb.com is
     the RIGHT address for org 1 and must never resolve to his login email. publicOrgBrand takes
     no session and no ctx, so there is no user row in scope for it to read one from. */
  assert.match(src, /export async function publicOrgBrand\(env, url\)/,
    "publicOrgBrand grew a session/ctx parameter — the address must come from the org, not the viewer");
  assert.doesNotMatch(body, /\busers\b/,
    "publicOrgBrand touched the users table — the contact address must be the org's, never a person's");
});

test("the public brand payload stays a named field list — widening it is a deliberate edit", () => {
  const src = strip(readSrc("announcements.js"));
  const fn = src.slice(src.indexOf("export async function publicOrgBrand"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  const select = /SELECT ([^`]+?) FROM orgs/.exec(body);
  assert.ok(select, "publicOrgBrand's SELECT could not be parsed — this check is measuring nothing");
  const cols = select[1].split(",").map((c) => c.trim());
  assert.deepEqual(cols, ["id", "name", "logo_url", "admin_email"],
    "this endpoint is PUBLIC and unauthenticated. Its columns are org PUBLICATION fields (the "
    + "{{ORG_*}} token family) and nothing else; adding one is a deliberate exposure decision.");
});

/* ══════════════════════════════ NEGATIVE CONTROLS ════════════════════════════════════════════
   Each mutates the REAL input and asserts the mutation landed — an NC whose mutation finds
   nothing passes while testing nothing, which this project has paid for twice in three sessions. */

test("NC-1: reintroducing the literal on a real member page IS caught", () => {
  const original = read("member.html");
  const anchor = '<a href="help.html" data-org-contact>';
  assert.ok(original.includes(anchor), "member.html no longer carries the contact anchor — NC-1 has no victim");
  const mutated = original.replace(anchor, '<a href="mailto:admin@boomtownvb.com" data-org-contact>');
  assert.notEqual(mutated, original, "the mutation did not land — this NC would pass while testing nothing");
  assert.equal(emailOffences(original).length, 0, "member.html is not clean to begin with");
  assert.equal(emailOffences(mutated).length, 1, "a reintroduced literal was not caught");
});

test("NC-2: the placeholder exemption is scoped to the ATTRIBUTE, not to the address", () => {
  const original = read("profile.js");
  assert.match(original, /placeholder="you@example\.com"/, "profile.js's placeholder moved — NC-2 has no victim");
  assert.equal(emailOffences(original).length, 0, "a form-hint placeholder was wrongly scored as copy");
  /* The SAME address, outside the attribute, must be caught — otherwise the exemption is blanket. */
  const mutated = original.replace('placeholder="you@example.com"', 'title="write to you@example.com"');
  assert.notEqual(mutated, original, "the mutation did not land — this NC would pass while testing nothing");
  assert.equal(emailOffences(mutated).length, 1, "the exemption is exempting the address, not the attribute");
});

test("NC-3: the SCRIPT half of the corpus is really scanned — an offence planted in site-nav.js is caught", () => {
  const original = read("assets/site-nav.js");
  const needle = 'const KEY = "bt_org_brand:" + org;';
  assert.ok(original.includes(needle), "site-nav.js's brand cache line moved — NC-3 has no victim");
  const mutated = original.replace(needle, needle + '\n    /*live*/ var x = "help@boomtownvb.com";');
  assert.notEqual(mutated, original, "the mutation did not land — this NC would pass while testing nothing");
  assert.equal(emailOffences(original).length, 0, "site-nav.js is not clean to begin with");
  assert.equal(emailOffences(mutated).length, 1, "an offence in a shared script escaped the scan");
});

test("NC-4: a contact anchor that ships a mailto: IS caught by the fail-closed check", () => {
  const original = read("assets/settings.js");
  const anchors = contactAnchors(original);
  assert.equal(anchors.length, 1, "settings.js's contact anchor moved — NC-4 has no victim");
  assert.ok(!anchors[0].href.startsWith("mailto:"), "settings.js already ships a mailto:");
  const mutated = original.replace('href="help.html"', 'href="mailto:admin@boomtownvb.com"');
  assert.notEqual(mutated, original, "the mutation did not land — this NC would pass while testing nothing");
  assert.ok(contactAnchors(mutated)[0].href.startsWith("mailto:"), "a shipped mailto: was not seen");
});

test("NC-5: an anchor with NO href is caught — a marker alone is not a fallback", () => {
  const withHref = contactAnchors('<a href="help.html" data-org-contact>Contact us</a>');
  const without = contactAnchors("<a data-org-contact>Contact us</a>");
  assert.equal(withHref[0].href, "help.html");
  assert.equal(without.length, 1, "the anchor was not seen at all");
  assert.equal(without[0].href, null, "a missing href must be reported, not treated as a pass");
});

test("NC-6: comment stripping works both ways — a commented literal is invisible, a live one is not", () => {
  assert.equal(emailOffences('<!-- write to admin@boomtownvb.com -->').length, 0, "HTML comment not stripped");
  assert.equal(emailOffences('/* write to admin@boomtownvb.com */').length, 0, "JS block comment not stripped");
  assert.equal(emailOffences('<a href="mailto:admin@boomtownvb.com">x</a>').length, 1, "a live literal was missed");
});

test("NC-7: an empty corpus cannot pass the self-counts", () => {
  assert.ok(!(new Map().size >= 20), "an empty script corpus must fail the floor");
  assert.notEqual(new Map().size, 17, "an empty page corpus must fail the ratchet");
});
