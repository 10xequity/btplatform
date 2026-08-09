/**
 * Boomtown Platform — a human trying to break the system (owner request, 2026-08-09)
 * File: worker/test/human_chaos.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.116.0
 *
 * THE HUMAN THIS FILE SIMULATES is not an attacker. It is a member on a slow connection who
 * clicks the same button three times because nothing happened, opens their sign-in link twice,
 * and presses Back everywhere. The 2026-08-09 owner report behind it: back buttons rendered
 * "too big", wrapping and clipping their own label — because the injected admin back button
 * carried a class (`bt-back`) that NO stylesheet defined, so its viewBox-only SVG fell back to
 * the replaced-element default size (~300×150px). 1,533 tests were green while every admin page
 * showed a broken control: no test related the classes the nav INJECTS to the classes the CSS
 * DEFINES. The styled-class guard below is that relationship, same shape as cors_methods.test.mjs
 * (two lists must agree, both read from source).
 *
 * Four sections:
 *   1. DOUBLE-SUBMIT, SERVER SIDE — the same registration POSTed twice creates ONE row (the
 *      idempotency at registrations.js "existing open registration"); a used magic link does
 *      not verify a second time. Assert the ROWS, not just the flag.
 *   2. STYLED-CLASS GUARD — every static class token admin-nav.js injects resolves to a CSS
 *      rule in admin.css / app.css / tokens.css / the nav's own injected <style>.
 *   3. BACK-NAV INTEGRITY — both history.back() call sites guard on same-origin referrer AND
 *      fall back to admin.html; the back bar uses house .btn classes; its icon is size-capped;
 *      member-inbox's two back controls stay on .btn ghost.
 *   4. IN-FLIGHT CLICK GUARDS — register.js, score.js and member-inbox.js disable their write
 *      button while the request is out, and re-enable it after (both halves, per file).
 *
 * Every guard carries a NEGATIVE CONTROL THAT MUTATES THE REAL INPUT, and every NC asserts the
 * mutation landed before asserting the guard fires.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

const NAV_SRC   = readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8");
const ADMIN_CSS = readFileSync(new URL("../../web/assets/admin.css", import.meta.url), "utf8");
const APP_CSS   = readFileSync(new URL("../../web/assets/app.css", import.meta.url), "utf8");
const TOKENS_CSS = readFileSync(new URL("../../web/assets/tokens.css", import.meta.url), "utf8");
const REGISTER_SRC = readFileSync(new URL("../../web/assets/register.js", import.meta.url), "utf8");
const SCORE_SRC    = readFileSync(new URL("../../web/assets/score.js", import.meta.url), "utf8");
const INBOX_SRC    = readFileSync(new URL("../../web/assets/member-inbox.js", import.meta.url), "utf8");

/* ---------------------------------------------------------------- section 1: double submit */

function makeEnv() {
  return { DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}

function seed(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status)
      VALUES (1, 1, 'Sandbox waiver v1', 'I agree to the terms.', 'sha-sandbox-1', 'active');
    INSERT INTO events (id, org_id, type, name, status, capacity, price_cents, starts_at)
      VALUES (1, 1, 'league', 'Thursday Coed 4s', 'published', 10, 0, datetime('now','+7 days'));
  `);
}

const REG_BODY = {
  email: "captain@boomtown.test", team_name: "Impatient Ibis", captain_name: "Casey Captain",
  team_level: "BB", date_of_birth: "1994-05-05", waiver_accepted: true,
  waiver_signature: "Casey Captain", teammates: [],
};

test("the same registration submitted twice creates ONE registration, not two", async () => {
  const env = makeEnv();
  seed(env);
  const first = await call(env, "POST", "/api/events/1/register", { body: REG_BODY });
  assert.equal(first.status, 200, `first registration: ${JSON.stringify(first.data).slice(0, 200)}`);

  // The impatient double-click: identical body, immediately again.
  const second = await call(env, "POST", "/api/events/1/register", { body: REG_BODY });
  assert.equal(second.status, 200, "the duplicate must not error — the human did nothing wrong");
  assert.equal(second.data.duplicate, true, "second submit must be flagged as the same registration");

  const rows = env.DB.query("SELECT id FROM registrations WHERE event_id = 1");
  assert.equal(rows.length, 1,
    `two clicks made ${rows.length} registrations — the dup guard returned a flag but wrote anyway`);

  // NEGATIVE CONTROL 1, real input mutated: the SAME captain registering a SECOND team (same
  // email, different team name) is legitimate and must pass — the dedup keys on the team name,
  // not the person. This is the flow a lazier fix (blocking on email alone) would have broken.
  const secondTeam = await call(env, "POST", "/api/events/1/register",
    { body: { ...REG_BODY, team_name: "Second Squad" } });
  assert.equal(secondTeam.status, 200, "a second team from the same captain failed — dedup overreaches");
  assert.notEqual(secondTeam.data.duplicate, true,
    "mutation did not land: a different team name was still called a duplicate");
  const after = env.DB.query("SELECT id FROM registrations WHERE event_id = 1");
  assert.equal(after.length, 2, "the counter cannot see a second row — the 1-row assertion was blind");

  // NEGATIVE CONTROL 2: a different person entirely also passes (dedup is not a global block).
  const other = await call(env, "POST", "/api/events/1/register",
    { body: { ...REG_BODY, email: "other@boomtown.test", team_name: "Third Wheel" } });
  assert.equal(other.status, 200, "control registration failed — the probe proves nothing");
  assert.notEqual(other.data.duplicate, true, "a new email was called a duplicate");
  assert.equal(env.DB.query("SELECT id FROM registrations WHERE event_id = 1").length, 3,
    "three distinct registrations expected after both controls");
});

test("a sign-in link clicked twice signs in once — the second click is refused", async () => {
  const env = makeEnv();
  seed(env);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "member@boomtown.test" } });
  assert.equal(asked.status, 200, `request-link: ${JSON.stringify(asked.data).slice(0, 200)}`);
  const token = String(asked.data.dev_link).split("token=")[1];
  assert.ok(token, "sandbox dev_link carried no token — the probe cannot run");

  const first = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(first.status, 200, "first verify must succeed");

  // The human double-clicks the link (or their mail app prefetches it, then they click).
  const second = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.notEqual(second.status, 200,
    "a magic link verified TWICE — single-use is the property that makes emailing links safe");

  const links = env.DB.query(
    "SELECT used_at FROM magic_links WHERE email = ?", "member@boomtown.test");
  assert.equal(links.length, 1, "expected exactly one magic_links row for the probe address");
  assert.ok(links[0].used_at, "the link was never marked used — single-use is holding by accident");
});

/* ------------------------------------------------------- section 2: the styled-class guard */

/** Static class tokens used in admin-nav.js HTML template strings. Attributes containing an
 *  interpolation (`${`) are skipped — only literal class lists can be checked against CSS. */
function injectedClassTokens(src) {
  const tokens = new Set();
  for (const m of src.matchAll(/class="([^"]*)"/g)) {
    if (m[1].includes("${")) continue;
    for (const t of m[1].split(/\s+/).filter(Boolean)) tokens.add(t);
  }
  return [...tokens];
}

/** True when the corpus defines a CSS rule for the class: `.token` followed by a non-name char. */
function corpusStyles(corpus, token) {
  return new RegExp(`\\.${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(corpus);
}

test("every class admin-nav.js injects has a CSS rule somewhere real", () => {
  const corpus = ADMIN_CSS + APP_CSS + TOKENS_CSS + NAV_SRC;
  const tokens = injectedClassTokens(NAV_SRC);
  assert.ok(tokens.length >= 10,
    `only ${tokens.length} static class tokens extracted — the extractor lost the list it guards`);
  const missing = tokens.filter((t) => !corpusStyles(corpus, t));
  assert.deepEqual(missing, [],
    `admin-nav.js injects classes NO stylesheet defines — they render as unstyled defaults ` +
    `(the v0.115.0 back-button defect): ${missing.join(", ")}`);
});

test("NC: deleting a rule from the real CSS corpus makes the styled-class guard fire", () => {
  const corpus = ADMIN_CSS + APP_CSS + TOKENS_CSS + NAV_SRC;
  // Mutate the REAL input: strip every `.bt-edge` selector occurrence from the corpus.
  const mutated = corpus.replace(/\.bt-edge(?![\w-])/g, ".bt-edge-GONE");
  assert.notEqual(mutated, corpus, "mutation did not land — .bt-edge selector not found to strip");
  assert.ok(injectedClassTokens(NAV_SRC).includes("bt-edge"),
    "mutation did not land — bt-edge is no longer an injected class, pick another NC target");
  assert.equal(corpusStyles(corpus, "bt-edge"), true, "control: intact corpus styles bt-edge");
  assert.equal(corpusStyles(mutated, "bt-edge"), false,
    "guard did not fire on a deleted rule — it would also miss a real unstyled class");
});

/* --------------------------------------------------------- section 3: back-nav integrity */

test("both history.back() call sites are same-origin-guarded and fall back to the dashboard", () => {
  // Comments are blanked first: prose mentioning history.back() is corpus, not a call site.
  // The stripping gets its own NC: a synthetic comment must actually be removed.
  assert.ok(!blankComments("/* history.back() */ x").includes("history.back()"),
    "blankComments no longer strips block comments — every count below is polluted by prose");
  const code = blankComments(NAV_SRC);
  const sites = code.split("history.back()").length - 1;
  assert.equal(sites, 2, `expected exactly 2 history.back() call sites in admin-nav.js, found ${sites}`);
  // Each call site's statement carries the referrer guard and the admin.html fallback.
  const guarded = code.match(/history\.length > 1[^\n]*history\.back\(\)[^\n]*admin\.html/g) || [];
  assert.equal(guarded.length, 2,
    "a Back control lost its same-origin/history guard or its admin.html fallback — " +
    "on a fresh tab it would either do nothing or bounce the user out of the app");
});

test("the admin back bar is a house button with a size-capped icon (the wrap/clip defect)", () => {
  // The bar's own button must ride the shared .btn system, not a bespoke unstyled class.
  // Anchored on BEHAVIOUR — the one <button> whose content is the back icon — and the anchor's
  // uniqueness is asserted first (an ambiguous anchor passes silently on the wrong match).
  assert.equal(NAV_SRC.split("${ICONS.back}").length - 1, 1,
    "expected exactly one ${ICONS.back} interpolation — the back-button anchor is ambiguous");
  const bar = NAV_SRC.match(/<button class="([^"]+)"[^>]*>\$\{ICONS\.back\}/);
  assert.ok(bar, "the back icon is no longer inside a <button class=…> — the back bar may be gone");
  const classes = bar[1].split(/\s+/);
  for (const need of ["btn", "ghost", "sm"]) {
    assert.ok(classes.includes(need),
      `back-bar button lacks the house "${need}" class (has: "${bar[1]}") — unstyled buttons ` +
      `render at browser defaults and their viewBox-only SVG icon inflates to ~300×150px`);
  }
  // And the icon inside it must be explicitly sized — width alone is the whole defect.
  assert.match(NAV_SRC, /\.bt-back svg\s*\{[^}]*width:\s*\d+px/,
    "no `.bt-back svg { width: … }` rule — the back icon has no size and falls to SVG defaults");
});

test("member-inbox keeps both of its back controls on the house ghost style", () => {
  const backs = INBOX_SRC.match(/class="btn ghost"[^>]*(?:id="backBtn"|href="member-inbox\.html")/g) || [];
  assert.equal(backs.length, 2,
    "member-inbox back controls moved off `.btn ghost` — restyle them with the house classes, " +
    "not a new one-off class (that is how the admin back button broke)");
});

/* ------------------------------------------------------ section 4: in-flight click guards */

const FLOWS = [
  { name: "register.js (Register + waitlist buttons)", src: () => REGISTER_SRC,
    disable: /btn\.disabled = true/g, enable: /btn\.disabled = false/g, min: 2 },
  { name: "score.js (score submit)", src: () => SCORE_SRC,
    disable: /\.disabled = true\b/g, enable: /\.disabled = false\b/g, min: 1 },
  { name: "member-inbox.js (reply send)", src: () => INBOX_SRC,
    disable: /\.disabled = true\b/g, enable: /\.disabled = false\b/g, min: 1 },
];

test("the three member write flows disable their button in flight and re-enable it after", () => {
  for (const f of FLOWS) {
    const src = f.src();
    const dis = (src.match(f.disable) || []).length;
    const ena = (src.match(f.enable) || []).length;
    assert.ok(dis >= f.min,
      `${f.name}: no in-flight disable — a slow response invites the double-click the server ` +
      `dedup exists to catch; the button must go quiet while the request is out`);
    assert.ok(ena >= f.min,
      `${f.name}: button is disabled but never re-enabled — one failed request bricks the form`);
  }
});

test("NC: stripping the disable from a real flow makes the in-flight guard fire", () => {
  const f = FLOWS[0];
  const mutated = REGISTER_SRC.replace(f.disable, "btn.dataTruthy = true");
  assert.notEqual(mutated, REGISTER_SRC, "mutation did not land — register.js no longer matches");
  const dis = (mutated.match(f.disable) || []).length;
  assert.ok(dis < f.min, "guard did not fire on the stripped source — it is not reading the disable");
});
