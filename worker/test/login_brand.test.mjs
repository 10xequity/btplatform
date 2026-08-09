/**
 * Boomtown Platform — per-org login branding (§-1f F-3) + S-1b closure
 * File: worker/test/login_brand.test.mjs · Version: v1.0 · Date: 2026-08-08 · Ships in: v0.106.0
 *
 * ── PART 1: F-3, AND THE ENDPOINT QUESTION WAS ALREADY ANSWERED BY THE CODE ──────────────────
 * F-3 was queued as "narrow /api/orgs' public payload for the login screen". That is the wrong
 * endpoint, and the repo has said so since v0.50.0: `GET /api/public/org-brand?org=<id|slug>`
 * (`announcements.js:94-106`) returns ONE org — `{org_id, display_name, logo_url}` — active-only,
 * `Cache-Control: max-age=300`, deliberately outside `buildCtx`. `site-nav.js applyOrgBrand()`
 * already consumes it for the rail's brand card, with a 5-minute localStorage cache and a
 * fail-closed default. **F-3 is "do what the rail already does, on the login card."**
 *
 * ── THE INVARIANT, WHICH IS D-15'S LESSON APPLIED BEFORE THE DEFECT EXISTS ───────────────────
 * v0.105.0 closed D-15: the member rail was appended only after three awaited fetches, so every
 * page load inserted a whole column and displaced the content beside it. **The login card is one
 * `await` away from the identical defect.** So the brand lockup is asserted to be part of the
 * SYNCHRONOUS render — in `renderLogin`'s template — with the async brand SWAPPED IN PLACE
 * afterwards. Nothing may be inserted into the card after a network round trip.
 * The logo also carries explicit `width`/`height`, so the image reserves its box before it loads.
 *
 * ── WHICH ORG THE LOGIN SCREEN SHOWS ────────────────────────────────────────────────────────
 * Stated as an assumption and proceeded on, per the unit's brief: `?org=<slug|id>` first (explicit,
 * shareable, and the only source that works for a first-time visitor who has never picked an org),
 * then `bt_org` from localStorage (a returning visitor), then nothing. **Subdomains were not
 * considered available**: the app is served from `10xequity.github.io/btplatform/web`, a path, not
 * a host the org could own. When neither source yields an org, NO lockup is rendered at all —
 * which is also why that branch cannot shift: nothing is ever going to arrive.
 *
 * ── PART 2: S-1b, SETTLED — AND THIS REVERSES A CONCLUSION I RECORDED MYSELF ─────────────────
 * Iteration 23 wrote "per-org branding settles S-1b, so `/api/orgs` stays unauthenticated". The
 * OWNER's branding answer stands; the inference was mine and it was wrong. `/api/orgs` returns
 * `id, name, slug, logo_url, brand_json` for EVERY active org to anyone who asks, and its only two
 * callers are both signed-in surfaces: `admin-nav.js:627` pairs it with `guard()`, and
 * `app.js:156` runs inside `renderDashboard`, reached only after `/api/me` succeeds. **No
 * unauthenticated caller exists**, so the enumeration is gated here. Asserted behaviourally,
 * through the real router, with `/api/health` as the liveness control — because a 401 from a gate
 * and a 401 from a dead worker are indistinguishable without one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, statementFrom } from "../testkit/route-extract.mjs"; // statementFrom: v0.111.0 D-17b

/* ═══════════════════ PART 1 — the login card (web/assets/app.js) ═══════════════════ */

const APP_SRC = new URL("../../web/assets/app.js", import.meta.url);
const readApp = () => readFileSync(APP_SRC, "utf8");

const RENDER_LOGIN = "function renderLogin(";
const BRAND_SLOT = "login-brand";           // the lockup's stable hook in the template
const BRAND_ENDPOINT = "/api/public/org-brand";
const ORGS_ENDPOINT = "/api/orgs";
const APPLY_CALL = "applyLoginBrand(";

/** Call sites of `name`, never its definition — the standing §-1e rule. */
function callSitesOf(t, name) {
  const out = [];
  let i = t.indexOf(name);
  while (i >= 0) {
    if (!/\bfunction\s+$/.test(t.slice(Math.max(0, i - 24), i))) out.push(i);
    i = t.indexOf(name, i + 1);
  }
  return out;
}

/** The region from renderLogin's start to the end of its synchronous render(...) call. */
function loginRenderRegion(t) {
  const start = t.indexOf(RENDER_LOGIN);
  if (start < 0) return null;
  const render = t.indexOf("render(`", start);
  if (render < 0) return null;
  const close = t.indexOf("`);", render);
  return close < 0 ? null : { start, render, end: close };
}

/** THE VERDICT: the brand lockup ships in the synchronous render, and no brand fetch precedes it.
 *
 *  THE REGION IS renderLogin's START to the END of its render(...) call, NOT the template literal
 *  alone — and the first draft got that wrong in a way worth keeping. It required the lockup markup
 *  to appear INLINE inside the template, so when the real implementation built the markup into a
 *  `brandSlot` variable one line above and interpolated it, the verdict reported the lockup
 *  "missing" against code that satisfies the invariant completely. **The invariant is "rendered
 *  synchronously", and a variable assigned with no await in between is exactly that.** Pinning the
 *  literal position of the markup was pinning a spelling, not a behaviour — §-1c D-17 for the
 *  fourth time in three sessions. The template is still required to INTERPOLATE the slot, so
 *  building the markup and forgetting to use it cannot pass. */
export function loginBrandVerdict(src) {
  const t = blankComments(src);
  const r = loginRenderRegion(t);
  if (!r) return { ok: false, why: "renderLogin's template could not be located" };
  const critical = t.slice(r.start, r.end);
  const template = t.slice(r.render, r.end);
  if (!critical.includes(BRAND_SLOT)) {
    return { ok: false, why: "the brand lockup is not built in renderLogin's synchronous path — if " +
      "it is injected after the brand fetch, the card shifts on every sign-in, which is D-15 again" };
  }
  if (!template.includes("${brandSlot}")) {
    return { ok: false, why: "the lockup is built but never interpolated into the card's template" };
  }
  if (critical.includes(BRAND_ENDPOINT)) {
    return { ok: false, why: "the brand endpoint is requested before the card renders — the card " +
      "must paint first and swap the brand in place" };
  }
  return { ok: true };
}

test("F-3: the brand lockup ships in renderLogin's synchronous template", () => {
  const v = loginBrandVerdict(readApp());
  assert.ok(v.ok, v.why);
});

test("F-3: the login card brands from /api/public/org-brand, never from /api/orgs", () => {
  const t = blankComments(readApp());
  assert.ok(t.includes(BRAND_ENDPOINT),
    "the login card does not consume the per-org brand endpoint at all");
  const start = t.indexOf("async function applyLoginBrand");
  assert.ok(start >= 0, "applyLoginBrand is missing — the swap has nowhere to live");
  const body = statementFrom(t, start); // D-17b: was slice(start, start + 1600)
  assert.ok(!body.includes(ORGS_ENDPOINT),
    "the login brand path reaches for /api/orgs, which enumerates EVERY active org to serve one " +
    "card. /api/public/org-brand answers for exactly one and is cached — and S-1b gates the other.");
});

test("F-3: the brand swap is CALLED after the render, not before", () => {
  const t = blankComments(readApp());
  const r = loginRenderRegion(t);
  assert.ok(r, "renderLogin's template could not be located");
  const calls = callSitesOf(t, APPLY_CALL);
  assert.equal(calls.length, 1, "expected exactly one applyLoginBrand call site");
  assert.ok(calls[0] > r.end, "applyLoginBrand runs before the card exists, so it has nothing to fill");
});

test("F-3: the lockup reserves its box — the logo carries explicit width and height", () => {
  const t = blankComments(readApp());
  const r = loginRenderRegion(t);
  // Scanned over the whole synchronous region, for the same reason the verdict is: the markup is
  // assembled into a variable, not written inline in the template.
  const region = t.slice(r.start, r.end);
  const img = region.slice(region.indexOf(BRAND_SLOT));
  assert.match(img, /width="\d+"/, "no explicit width on the brand logo — the image will reflow on load");
  assert.match(img, /height="\d+"/, "no explicit height on the brand logo — the image will reflow on load");
});

test("F-3: the brand path fails closed at every step", () => {
  const t = blankComments(readApp());
  const start = t.indexOf("async function applyLoginBrand");
  const body = statementFrom(t, start); // D-17b: was slice(start, start + 1600)
  assert.match(body, /if \(!r\.ok\) return/, "a non-200 must leave the default brand in place");
  assert.match(body, /catch \(e\) \{ return/, "an offline fetch must leave the default brand in place");
  assert.match(body, /display_name/, "the swap must not run on a payload with no name");
});

/* ---------- negative controls: each MUTATES THE REAL SOURCE and asserts the mutation landed ---------- */

test("NC-B1: removing the lockup from the template FAILS the verdict", () => {
  const src = readApp();
  const mutated = src.replace(BRAND_SLOT, "not-the-brand");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(loginBrandVerdict(mutated).ok, false,
    "the lockup was removed from the synchronous template and the verdict still passed");
});

test("NC-B2: moving the brand fetch into the pre-render path FAILS the verdict", () => {
  const src = readApp();
  const mutated = src.replace("function renderLogin(errorMsg) {",
    'function renderLogin(errorMsg) { fetch(API + "/api/public/org-brand?org=1");');
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(loginBrandVerdict(mutated).ok, false,
    "a brand fetch before the render still passed — the card would shift on every sign-in");
});

test("NC-B3: a COMMENT naming the brand endpoint must not be read as a request", () => {
  const src = readApp();
  const mutated = src.replace("function renderLogin(errorMsg) {",
    "function renderLogin(errorMsg) { /* the brand comes from /api/public/org-brand, after this */");
  assert.notEqual(mutated, src, "mutation did not land — NC is vacuous");
  assert.equal(loginBrandVerdict(mutated).ok, true,
    "a commented endpoint name was counted as a live request");
});

/* ═══════════════════ PART 2 — S-1b: /api/orgs requires a session ═══════════════════ */

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

const makeEnv = () => ({
  DB: createD1(SCHEMA),
  APP_URL: ORIGIN,
  SITE_ORIGIN: ORIGIN,
  API_ORIGIN: "https://api.boomtown.test",
  ALLOWED_ORIGINS: ORIGIN,
});

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}

function seed(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (2, 'Match Point Social', 'matchpoint', 1);
  `);
}

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  assert.equal(asked.status, 200, `request-link for ${email}`);
  const token = String(asked.data.dev_link).split("token=")[1];
  const ok = await call(env, "POST", "/api/auth/verify", { body: { token } });
  assert.equal(ok.status, 200, `verify for ${email}`);
  return ok.data.token;
}

test("S-1b: anonymous GET /api/orgs is refused, with /api/health as the liveness control", async () => {
  const env = makeEnv();
  seed(env);
  const health = await call(env, "GET", "/api/health");
  assert.equal(health.status, 200,
    "health must answer 200 — without it a 401 below could mean the worker is down, not gated");
  const anon = await call(env, "GET", "/api/orgs");
  assert.equal(anon.status, 401,
    `anonymous /api/orgs answered ${anon.status}. It returns id/name/slug/logo_url/brand_json for ` +
    "EVERY active org; both real callers are signed-in surfaces, and the login screen uses " +
    "/api/public/org-brand instead.");
});

test("S-1b: a signed-in caller still gets the org list — the gate is about the session, not the route", async () => {
  const env = makeEnv();
  seed(env);
  const token = await signIn(env, "someone@boomtown.test");
  const r = await call(env, "GET", "/api/orgs", { token });
  assert.equal(r.status, 200, `signed-in /api/orgs answered ${r.status} — the gate broke a real caller`);
  assert.ok(Array.isArray(r.data.orgs) && r.data.orgs.length >= 2,
    `expected the org list, got ${JSON.stringify(r.data).slice(0, 160)}`);
});

test("S-1b NC: the per-org BRAND endpoint stays public — gating it would break the login screen", async () => {
  /* The failure this pair is designed against: gating the enumeration and the branding together.
     org-brand is deliberately outside buildCtx because the sign-in surface needs it BEFORE anyone
     has a session. If this ever starts answering 401, F-3's card silently loses its brand. */
  const env = makeEnv();
  seed(env);
  const r = await call(env, "GET", "/api/public/org-brand?org=matchpoint");
  assert.equal(r.status, 200,
    `anonymous org-brand answered ${r.status} — the login screen cannot brand itself without it`);
  assert.equal(r.data.display_name, "Match Point Social", "the public brand payload changed shape");
});
