/**
 * Boomtown Platform — K-10(a): the app survives its own address changing
 * File: worker/test/origin_portability.test.mjs · Version: v1.0 · Date: 2026-08-13
 * Ships in: v0.149.0 · roadmap §-1k K-10(a), §-0 B8
 *
 * Owner: *"Make sure nothing breaks when the GitHub address is replaced by a real one."* The app
 * is served from `10xequity.github.io` under a `/btplatform/` path prefix; the API lives on
 * `boomtown-api.vvisuth.workers.dev`. The day any of those changes, everything must either derive
 * the address at runtime or sit on the NAMED MOVE-DAY LIST this file pins:
 *
 *   · `web/assets/config.js`  — apiBase, THE frontend config point (its own header says so)
 *   · root `index.html`       — the canonical link (static SEO metadata; regenerated on move day)
 *   · root `404.html`         — root-absolute links (a 404 page renders at ANY depth, so it
 *                                cannot use relative paths; keeping it static keeps it working
 *                                without JavaScript, and it is two minutes of move-day editing)
 *   · `web/assets/signup-widget.js` — the data-api default. This file executes on EXTERNAL
 *                                customer sites: it cannot load config.js and `location` there is
 *                                the customer's origin, so an absolute API default with the
 *                                `data-api` attribute as the override is the only shape that works.
 *   · `wrangler.toml` APP_URL + ALLOWED_ORIGINS — worker config, outside this corpus.
 *
 * Everything else is FORBIDDEN from carrying the host, the prefix, or the API host. What that
 * rule caught on its first run (the measured state this file was written against):
 *   · three worker modules built member-facing links from `env.SITE_ORIGIN || "<hardcoded>"` —
 *     and SITE_ORIGIN is set NOWHERE, so the "fallback" was the live production path while tests
 *     set the variable and exercised the other branch;
 *   · `admin-marketing.html` baked the full github.io URL into the copyable widget snippet.
 *
 * ── WHY THIS FILE SHIPS ITS OWN COMMENT STRIPPER (D-37) ──────────────────────────────────────
 * `blankComments` (route-extract.mjs) blanks `//` to end-of-line UNCONDITIONALLY — including the
 * `//` inside `https://…` string literals, which erases exactly the bytes this guard exists to
 * find. A scanner built on it would pass while blind (the D-33 family: a confident wrong answer).
 * `stripJs` below tracks string state, so comments vanish and URL literals survive; both
 * directions have negative controls. Known imperfection, measured against this corpus: a regex
 * literal whose text ends in two adjacent slashes would truncate its own line — no corpus file
 * contains one, and the planted-needle NCs would surface a scanner blinded that way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { functionBodyAfter } from "../testkit/route-extract.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const HOST = "10xequity.github.io";
const PREFIX = "/btplatform";
const API_HOST = "boomtown-api.vvisuth.workers.dev";

/* ── the stripper: comments out, string AND regex literals INTACT ──
   Regex literals must be tokenized, not ignored: `schedule.js:13` holds `/[&<>"']/g`, a character
   class carrying both quote types, and a machine that does not know regexes opens a string there
   and mis-pairs every quote after it — this file's own planted-needle NC caught exactly that in
   its first run. `/` starts a regex when the last significant code character cannot end an
   expression (operators, openers, or a keyword like `return`); otherwise it is division. */
function stripJs(s) {
  let out = "", i = 0, mode = "code", lastSig = "", lastWord = "";
  const n = s.length;
  const KEYWORDS = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "instanceof", "do", "else", "yield", "await"]);
  const regexCanStart = () =>
    lastSig === "" || KEYWORDS.has(lastWord) || !(/[\w$)\]]/.test(lastSig));
  while (i < n) {
    const c = s[i], d = i + 1 < n ? s[i + 1] : "";
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "/" && regexCanStart()) { mode = "regex"; out += c; i++; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c; out += c; i++; continue; }
      if (/\S/.test(c)) {
        lastSig = c;
        lastWord = /[\w$]/.test(c) ? lastWord + c : "";
      }
      out += c; i++; continue;
    }
    if (mode === "line") { out += c === "\n" ? (mode = "code", "\n") : " "; i++; continue; }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    if (mode === "regex" || mode === "class") {
      if (c === "\\") { out += c + d; i += 2; continue; }
      if (mode === "regex" && c === "[") mode = "class";
      else if (mode === "class" && c === "]") mode = "regex";
      else if (mode === "regex" && c === "/") { mode = "code"; lastSig = "/"; lastWord = ""; }
      out += c; i++; continue;
    }
    // inside a string: keep bytes, honour escapes, close on the opening quote
    if (c === "\\") { out += c + d; i += 2; continue; }
    if (c === mode) { mode = "code"; lastSig = c === "`" ? ")" : c; lastWord = ""; }
    out += c; i++;
  }
  return out;
}
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
const stripped = (rel, src) => (rel.endsWith(".js") ? stripJs(src) : stripHtml(src));

/* ── the corpus: what actually ships to a browser ── */
function corpus() {
  const files = ["index.html", "404.html"];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (rel.endsWith(".html") || rel.endsWith(".js")) files.push(rel);
    }
  };
  walk("web");
  return files;
}

function offenders(needle, allow) {
  const out = [];
  for (const rel of corpus()) {
    if (allow.includes(rel)) continue;
    if (stripped(rel, read(rel)).includes(needle)) out.push(rel);
  }
  return out;
}

/* ══════════════ 0. the corpus and the stripper prove themselves first ══════════════ */

test("K-10a — the corpus is the shipped app: ≥70 files, and the named carriers are all inside it", () => {
  const files = corpus();
  assert.ok(files.length >= 70, `corpus collapsed: ${files.length} files`);
  for (const must of ["index.html", "404.html", "web/assets/config.js", "web/assets/signup-widget.js", "web/sw.js", "web/widget.js"])
    assert.ok(files.includes(must), `${must} missing from the corpus`);
});

test("K-10a — stripJs: comments vanish, URL string literals SURVIVE (the exact blindness blankComments has — D-37)", () => {
  assert.ok(!stripJs("// see 10xequity.github.io for context").includes(HOST), "line comment must vanish");
  assert.ok(!stripJs("/* 10xequity.github.io */ const x = 1;").includes(HOST), "block comment must vanish");
  const code = `const a = "https://${HOST}/btplatform/web"; b();`;
  assert.ok(stripJs(code).includes(`https://${HOST}${PREFIX}/web`),
    "a URL inside a string must survive INTACT — a stripper that eats it makes every scan below vacuous");
  assert.ok(stripJs("const t = `https://" + HOST + "/x`;").includes(HOST), "template literals too");
  assert.equal(stripJs(code).length, code.length, "length preserved, offsets stay true");
  // The shape that broke draft one — a regex character class carrying both quote types
  // (schedule.js:13). A machine that opens a string inside it mis-pairs every quote after.
  const regexy = 'const esc = (x) => x.replace(/[&<>"\']/g, "?"); const url = "https://' + HOST + '/x";';
  assert.ok(stripJs(regexy).includes(HOST), "a URL AFTER a quote-carrying regex must still be visible");
  assert.ok(stripJs('const r = 6 / 2 // half\n+ "https://x";').includes('"https://x"'), "division does not start a regex");
  assert.ok(!stripHtml(`<!-- ${HOST} -->`).includes(HOST), "HTML comment must vanish");
  assert.ok(stripHtml(`<a href="https://${HOST}/x">`).includes(HOST), "HTML markup must survive");
});

/* ══════════════ 1. the rules — each needle, each allow-list, every exclusion tested ══════════════ */

test("K-10a — the app HOST appears nowhere in shipped code except the root redirect's canonical link", () => {
  assert.deepEqual(offenders(HOST, ["index.html"]), []);
});

test("K-10a — the PATH PREFIX appears nowhere in shipped code except the two root stubs", () => {
  assert.deepEqual(offenders(PREFIX, ["index.html", "404.html"]), []);
});

test("K-10a — the API HOST appears nowhere in shipped code except the two config points (green by design when written: sw.js's mention is a comment and strips away)", () => {
  assert.deepEqual(offenders(API_HOST, ["web/assets/config.js", "web/assets/signup-widget.js"]), []);
});

test("K-10a — every allow-list entry actually CARRIES its literal, so a stale exclusion reddens instead of clearing everything", () => {
  assert.ok(stripHtml(read("index.html")).includes(`https://${HOST}${PREFIX}/web/`), "index.html canonical — the move-day list's first line");
  const notFound = stripHtml(read("404.html"));
  const uses = (notFound.match(new RegExp(`${PREFIX}/web/`, "g")) || []).length;
  assert.ok(uses >= 4, `404.html should carry its root-absolute links (saw ${uses}) — it renders at any depth and stays JS-free on purpose`);
  assert.ok(stripJs(read("web/assets/config.js")).includes(`https://${API_HOST}`), "config.js apiBase — THE frontend config point");
  assert.ok(stripJs(read("web/assets/signup-widget.js")).includes(`https://${API_HOST}`), "signup-widget.js data-api default — runs on external origins, cannot read config.js");
});

test("K-10a — NC: a needle planted into a real non-allowed file is caught, for all three needles", () => {
  const victim = "web/assets/schedule.js";
  const clean = stripped(victim, read(victim));
  for (const needle of [HOST, PREFIX, API_HOST]) {
    assert.ok(!clean.includes(needle), `pre-mutation: ${victim} must be clean of ${needle}`);
    const mutated = clean + `\nconst planted = "https://${HOST}${PREFIX}/x?api=${API_HOST}";`;
    assert.ok(stripJs(mutated).includes(needle), `the mutation landed and survives the stripper: ${needle}`);
  }
});

/* ══════════════ 2. the worker builds member links from the ONE configured variable ══════════════ */

test("K-10a — no worker module carries the app host, and env.SITE_ORIGIN has ZERO readers (it was set nowhere — its 'fallbacks' were the live production path while tests exercised the other branch)", () => {
  const dir = "worker/src";
  const carriers = [], siteOriginReaders = [];
  let appUrlReaders = 0;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (!name.endsWith(".js")) continue;
    const t = stripJs(read(`${dir}/${name}`));
    if (t.includes(HOST)) carriers.push(name);
    if (t.includes("env.SITE_ORIGIN")) siteOriginReaders.push(name);
    if (t.includes("env.APP_URL")) appUrlReaders++;
  }
  assert.deepEqual(carriers, [], "hardcoded app host in worker code");
  assert.deepEqual(siteOriginReaders, [], "a SITE_ORIGIN reader returned — that variable is configured nowhere, so its reader ships a hardcoded fallback as live behaviour");
  // Floor 8 under a measured 9 reader modules (2026-08-13): a blind scan reads 0, so any collapse
  // is unmistakable, while one refactor consolidating two readers does not redden this line.
  assert.ok(appUrlReaders >= 8, `positive control: env.APP_URL must be widely read (saw ${appUrlReaders} modules) — proves this scan's needles can match at all`);
});

test("K-10a — the three former SITE_ORIGIN sites now build from env.APP_URL, and the waitlist link dropped its own /web append (APP_URL already ends in /web — the old fallback pair only agreed by accident)", () => {
  const consent = stripJs(read("worker/src/consent.js"));
  const signUrl = functionBodyAfter(consent, "function signUrl");
  assert.ok(signUrl && signUrl.includes("env.APP_URL"), "consent signUrl reads APP_URL");
  const messages = stripJs(read("worker/src/messages.js"));
  assert.ok(messages.includes('env.APP_URL + "/member-inbox.html"'), "messages inbox link reads APP_URL");
  const waitlists = stripJs(read("worker/src/waitlists.js"));
  assert.ok(waitlists.includes("${env.APP_URL}/register.html"), "waitlist offer link reads APP_URL directly");
  assert.ok(!waitlists.includes("/web/register.html"), "the /web append is gone — against APP_URL it would double the segment");
  // NC: reintroduce the old shape and the reader-scan above must catch it.
  const regressed = consent.replace("env.APP_URL", "env.SITE_ORIGIN");
  assert.ok(regressed.includes("env.SITE_ORIGIN"), "the mutation landed");
  assert.ok(regressed !== consent, "and it changed the bytes");
});

/* ══════════════ 3. the copyable widget snippet derives the address from where the page runs ══════════════ */

test("K-10a — admin-marketing's snippet is BUILT from location at runtime, so the copyable line survives the domain change without anyone remembering to edit it", () => {
  const js = stripJs(read("web/assets/admin-marketing.js"));
  const fill = functionBodyAfter(js, "function fillWidgetSnippet");
  assert.ok(fill, "fillWidgetSnippet exists in admin-marketing.js");
  assert.ok(fill.includes('new URL("assets/signup-widget.js'), "the src resolves relative to the page");
  assert.ok(fill.includes("location.href"), "…against location — the one address that is true wherever the page is served");
  const html = stripHtml(read("web/admin-marketing.html"));
  assert.ok(!html.includes(HOST), "the static snippet text no longer bakes the host");
  // NC: remove the runtime derivation and the containment goes dark.
  const mutated = js.replace(/location\.href/g, "XXXX_GONE_XXXX");
  assert.ok(!mutated.includes("location.href"), "the mutation landed");
  const mutatedFill = functionBodyAfter(mutated, "function fillWidgetSnippet");
  assert.ok(!(mutatedFill || "").includes("location.href"), "and the pin would catch it");
});
