/**
 * Boomtown Platform — dangling references: a class with no rule, a link with the wrong parameter
 * File: worker/test/dangling_refs.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.137.0
 *
 * THREE RECORDED DEFECTS, ONE FAILURE SHAPE: a reference that resolves nowhere, and looks fine
 * until someone uses it.
 *
 *  · D-23 — `.sr-only` was defined in four page-local <style> blocks and USED on eight pages.
 *    On the seven that never defined it, screen-reader-only captions, legends and labels rendered
 *    as ordinary visible text. (Re-measured 2026-08-12: the register named help.html and live.html;
 *    help.html carries its own inline `left:-9999px` and was never visibly broken, while SIX admin
 *    pages the register never named were. The recording was right about the class and wrong about
 *    the list — measure the page, not the sentence.)
 *  · D-24 — `.pb-div-h` / `.pb-courts` were defined only in admin-pool-board.html's <style> while
 *    admin-kotc.html used both, so the Court Board's headings rendered at default h2 size.
 *  · D-29 — web/home.js linked `register.html?event_id=`; register.js reads `?event=`. Every "View"
 *    button on the member home landed on register.html's missing-event refusal.
 *
 * WHAT THIS GUARD DOES *NOT* DO. It checks a NAMED list of promoted classes, not the whole
 * dangling-class corpus (197 uses across 54 pages, measured for D-23 in iteration 48). The corpus
 * sweep needs the admin-nav injected-style question settled first and stays its own unit — this
 * file is the ratchet for the classes that have actually been promoted, and the next author adds
 * to PROMOTED in the same release that promotes a class. Scoping it wider today would redden
 * against ~190 harmless styling hooks and get switched off.
 *
 * THE RESOLUTION MODEL IS ALSO STANDARDS §11: a page resolves a class from its OWN <style> plus
 * the stylesheets IT links, and uses come from its own markup plus the scripts IT loads. A shared
 * script leaning on one page's styles fails here by construction, which is the rule §11 states.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments, scriptsOf } from "../testkit/route-extract.mjs";

const WEB = new URL("../../web/", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, WEB), "utf8");

/** Every class promoted out of a page and into a shared stylesheet, and where it now lives. */
const PROMOTED = [
  { cls: "sr-only",   home: "assets/app.css" },    // every page links app.css
  { cls: "pb-div-h",  home: "assets/admin.css" },  // both borrowed by admin-kotc.html
  { cls: "pb-courts", home: "assets/admin.css" },
];

/* ── pure verdicts — the real corpus and the negative controls go through the same code ── */

/** Stylesheets and scripts a page actually loads, buster stripped, in document order.
 *  v0.143.0: the script half was an inline copy of what is now `scriptsOf` in the testkit — it and
 *  print_parity.test.mjs held byte-identical private copies, and B29's contact guard was the third
 *  consumer that triggered route-extract.mjs's own move rule. The link/CSS half stays here because
 *  no other guard wants it. */
export function pageAssets(html) {
  const css = [...html.matchAll(/<link\b[^>]*href="([^"?]+)(?:\?[^"]*)?"/g)]
    .map((m) => m[1]).filter((h) => h.endsWith(".css"));
  return { css, js: scriptsOf(html) };
}

/** Does this CSS DEFINE the class — a selector whose first simple selector IS the class?
 *  `.kb-done .pb-div-h` and `.pb-workspace .pb-div-h` are scoped overrides of a rule they do not
 *  own; counting them as definitions is exactly how D-24 hid for two months. */
export function definesClass(css, cls) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  const head = new RegExp("^\\." + cls + "($|[.:\\[])");
  for (const chunk of flat.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace === -1) continue;
    for (const sel of chunk.slice(0, brace).split(",").map((s) => s.trim()).filter(Boolean)) {
      if (head.test(sel)) return true;
    }
  }
  return false;
}

/** Is the class used as a class TOKEN — in markup or in a script that writes markup? */
export function usesClass(text, cls) {
  for (const m of text.matchAll(/class="([^"]*)"/g)) {
    if (m[1].split(/\s+/).includes(cls)) return true;
  }
  return false;
}

const styleBlocks = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);

/** Pages, with the bytes of everything they load. Read once; the NCs mutate copies. */
function pages() {
  const out = new Map();
  for (const f of readdirSync(WEB)) {
    if (!f.endsWith(".html")) continue;
    const html = read(f);
    const { css, js } = pageAssets(html);
    const grab = (list) => list.map((p) => { try { return read(p); } catch { return ""; } });
    out.set(f, { html, cssNames: css, css: grab(css), js: grab(js), jsNames: js });
  }
  return out;
}

/** Which pages use a promoted class but cannot resolve it from anything they load. */
export function unresolved(page, cls) {
  const used = usesClass(page.html, cls) || page.js.some((src) => usesClass(src, cls));
  if (!used) return false;
  const defined = styleBlocks(page.html).some((s) => definesClass(s, cls)) ||
                  page.css.some((s) => definesClass(s, cls));
  return !defined;
}

/* ── D-23 + D-24: every use resolves ── */

test("every page that USES a promoted class can resolve it from something that page loads", () => {
  const corpus = pages();
  assert.ok(corpus.size >= 50, `page corpus shrank to ${corpus.size} — this guard would pass by scanning nothing`);
  const offenders = [];
  let usedAnywhere = 0;
  for (const { cls } of PROMOTED) {
    for (const [name, page] of corpus) {
      if (usesClass(page.html, cls) || page.js.some((s) => usesClass(s, cls))) usedAnywhere++;
      if (unresolved(page, cls)) offenders.push(`${name} uses .${cls} and nothing it loads defines it`);
    }
  }
  assert.ok(usedAnywhere >= 9, `positive control: only ${usedAnywhere} uses found across the promoted classes — the detector is looking in the wrong place`);
  assert.deepEqual(offenders, [],
    "screen-reader-only text and borrowed headings render unstyled here:\n" + offenders.join("\n"));
});

test("each promoted class is DEFINED in the shared stylesheet named for it — the way out stays open", () => {
  // Runs BEFORE the page-local copies are deleted, on purpose: a guard that only forbids the
  // copies can delete the last definition and leave every page unstyled (the D-24 lesson).
  for (const { cls, home } of PROMOTED) {
    assert.ok(definesClass(read(home), cls), `${home} does not define .${cls} — promoting it is the whole fix`);
  }
});

test("no page-level <style> redefines a promoted class — one definition, or they drift", () => {
  const offenders = [];
  for (const [name, page] of pages()) {
    for (const { cls, home } of PROMOTED) {
      if (styleBlocks(page.html).some((s) => definesClass(s, cls))) {
        offenders.push(`${name} redefines .${cls} — it lives in ${home} now`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("NC-1: a shared stylesheet that LOST the rule is caught", () => {
  const app = read("assets/app.css");
  const stripped = app.replace(/\.sr-only\s*\{[^}]*\}/g, "");
  assert.notEqual(stripped, app, "the strip control found no .sr-only rule to remove");
  assert.equal(definesClass(stripped, "sr-only"), false, "the definition detector cannot fail");
});

test("NC-2: injecting a page-local copy into a real page is caught, a scoped override is not", () => {
  const [, page] = [...pages()].find(([, p]) => p.html.includes("<style>"));
  const mutated = page.html.replace("<style>", "<style>\n    .sr-only { position: static; }");
  assert.ok(styleBlocks(mutated).some((s) => definesClass(s, "sr-only")), "the injected copy was not detected");
  assert.equal(definesClass(".kb-done .pb-div-h { color: red; }", "pb-div-h"), false,
    "a scoped override must never count as a definition");
  assert.equal(definesClass(".pb-div-h span { color: red; }", "pb-div-h"), false,
    "a descendant rule must never count as a definition");
});

/* ── D-29: the link parameter, and the ONE fork that decides the page ── */

/** Every register.html / sheet.html link in a file, with the parameter it passes. */
export function signupLinks(text) {
  return [...text.matchAll(/(register|sheet)\.html\?([A-Za-z_][A-Za-z0-9_]*)=/g)]
    .map((m) => ({ page: m[1] + ".html", param: m[2] }));
}

/** The parameter a target page actually reads — derived, never assumed. */
function paramRead(assetPath) {
  const m = read(assetPath).match(/const eventId = params\.get\("([^"]+)"\)/);
  assert.ok(m, `${assetPath} no longer reads its event parameter in the shape this guard derives from`);
  return m[1];
}

/** Every script in web/, COMMENTS BLANKED — check the set that ships behaviour.
    This is not decoration: the first run of this guard reported home.js and config.js as
    offenders because each explains D-29 in a comment that quotes the broken link verbatim.
    A guard that reads comments makes the fix impossible to document. */
function webScripts() {
  const out = new Map();
  const walk = (dir, prefix) => {
    for (const f of readdirSync(new URL(dir, WEB))) {
      if (f.endsWith(".js")) out.set(prefix + f, blankComments(read(prefix + f)));
    }
  };
  walk("./", "");
  walk("./assets/", "assets/");
  return out;
}

test("NC-0: the comment stripping itself works, and does not eat code", () => {
  const src = '// register.html?event_id=1\nconst a = "register.html?event=" + id;';
  const blanked = blankComments(src);
  assert.deepEqual(signupLinks(blanked).map((l) => l.param), ["event"],
    "the stripper either kept the commented link or ate the real one");
  assert.ok(webScripts().get("home.js").includes("BT_SIGNUP_LINK("),
    "stripping removed real code from home.js");
});

test("every sign-up link in web/ carries the parameter the target page actually reads (D-29)", () => {
  const expected = { "register.html": paramRead("assets/register.js"), "sheet.html": paramRead("assets/sheet.js") };
  const files = webScripts();
  assert.ok(files.size >= 50, `script corpus shrank to ${files.size} files`);
  const found = [], wrong = [];
  for (const [name, src] of files) {
    for (const link of signupLinks(src)) {
      found.push(`${name}:${link.page}?${link.param}`);
      if (link.param !== expected[link.page]) {
        wrong.push(`${name} links ${link.page}?${link.param}= but ${link.page} reads ?${expected[link.page]}=`);
      }
    }
  }
  // Positive control: the scan must actually be finding the links it claims to police. It is
  // anchored on config.js, where BOTH literals now live by design — the first draft anchored on
  // admin-event.js and reddened the moment that page started calling the shared rule instead of
  // spelling the link itself. Anchor a control on what the design GUARANTEES is there, not on
  // whichever site happened to carry it when the guard was written.
  assert.ok(found.length >= 6, `only ${found.length} sign-up links found — the scan is not reading the corpus`);
  assert.ok(found.some((f) => f.startsWith("assets/config.js")),
    "the shared rule's own two links are not in the scan — the regex missed the one site that must always be there");
  assert.ok(new Set(found.map((f) => f.split(":")[0])).size >= 4,
    "the scan sees links in fewer than four files — it is not reading the corpus it claims to");
  assert.deepEqual(wrong, [], "these links land on a missing-event refusal:\n" + wrong.join("\n"));
});

test("NC-3: mutating a real link's parameter is caught", () => {
  // The file is CHOSEN by the same scan the guard uses, not named: the first draft hardcoded
  // schedule.js, whose links are built from an interpolated page name — so the mutation landed
  // on bytes the detector was never going to read, and the NC failed for the right reason.
  const victim = [...webScripts()].find(([, src]) => signupLinks(src).length > 0);
  assert.ok(victim, "no file in web/ carries a literal sign-up link — the corpus moved");
  const [name, real] = victim;
  const mutated = real.replace(/\.html\?event=/g, ".html?event_id=");
  assert.notEqual(mutated, real, `the mutation control found nothing to break in ${name}`);
  const links = signupLinks(mutated);
  assert.ok(links.length > 0, `the scan found no links in the mutated ${name}`);
  assert.ok(links.every((l) => l.param === "event_id"), "the wrong-parameter detector cannot fail");
});

test("the drop-in fork is ONE judgement in ONE place, with every caller importing it", () => {
  const fork = /=== "training" \|\| [A-Za-z.]*type === "event"/;
  const owners = [...webScripts()].filter(([, src]) => fork.test(src)).map(([n]) => n);
  assert.deepEqual(owners, ["assets/config.js"],
    "the drop-in type list is stated in more than one file (or has moved) — one judgement, imported, never restated: " + owners.join(", "));
  assert.match(read("assets/config.js"), /window\.BT_SIGNUP_LINK\s*=/, "config.js no longer defines the shared rule");
  const callers = [...webScripts()].filter(([n, src]) => n !== "assets/config.js" && src.includes("BT_SIGNUP_LINK("))
    .map(([n]) => n).sort();
  assert.deepEqual(callers, ["assets/admin-event.js", "assets/schedule.js", "home.js"].sort(),
    "a sign-up link is being built without the shared rule (or a caller vanished): " + callers.join(", "));
});

test("every page whose script builds a sign-up link loads config.js FIRST", () => {
  // WF-1(b)'s lesson, generalised: admin-events.js referenced a global `orgs` that no script on
  // the page defined, and the page looked alive while every loadAll() ended in a ReferenceError.
  const consumers = [...webScripts()].filter(([n, src]) => n !== "assets/config.js" && src.includes("BT_SIGNUP_LINK("))
    .map(([n]) => n);
  assert.ok(consumers.length >= 3, `only ${consumers.length} consumers found — this check would pass by scanning nothing`);
  const offenders = [];
  for (const [name, page] of pages()) {
    const { js } = pageAssets(page.html);
    const uses = js.filter((s) => consumers.includes(s));
    if (!uses.length) continue;
    const cfg = js.indexOf("assets/config.js");
    if (cfg === -1) offenders.push(`${name} loads ${uses.join(", ")} but never loads config.js`);
    else if (uses.some((u) => js.indexOf(u) < cfg)) offenders.push(`${name} loads ${uses.join(", ")} before config.js`);
  }
  assert.deepEqual(offenders, [], "BT_SIGNUP_LINK is undefined when these scripts run:\n" + offenders.join("\n"));
});
