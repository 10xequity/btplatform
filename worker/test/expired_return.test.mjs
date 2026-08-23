/**
 * Boomtown Platform — §-1r RF-8(b) / §-1c D-48: the expired/from reader
 * File: worker/test/expired_return.test.mjs · Version: v1.0 · Date: 2026-08-22 · Ships in: v0.177.0
 *
 * THE DEFECT (D-48): admin-nav.js's api() has bounced a dead session to
 * index.html?expired=1&from=<page> since v0.26.0 — and NOTHING ever read either param. A
 * timed-out director landed on a bare sign-in card with no reason and no way back. The writer
 * was built and the reader never was: the two halves of one seam, each individually "correct".
 *
 * THE READER, PINNED IN ALL THREE PLACES IT MUST EXIST:
 *  · renderLogin SAYS the session expired (the ?expired=1 reader);
 *  · the magic-link REQUEST carries `from`, and the emailed link carries it back — the link may
 *    be opened on a different device, so the LINK is the only carry that survives (storage does
 *    not cross devices); tested BEHAVIOURALLY through the worker in sandbox mode;
 *  · after sign-in — token verify OR an already-live session (the passkey path reloads with the
 *    query intact) — app.js returns to `from`, through ONE validator.
 *
 * THE VALIDATOR IS THE SECURITY LINE: `from` becomes a redirect target and a URL embedded in an
 * email. Both sides accept ONLY a bare same-directory page name (letters/digits/dash + .html).
 * Anything else is DROPPED, never refused — sign-in must not fail because a return hint was
 * malformed; the person just lands on the dashboard as before. The server's drop is tested with
 * real hostile shapes; the client's validator is pinned with an NC that strips it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const APP_JS = readFileSync(new URL("../../web/assets/app.js", import.meta.url), "utf8");

function makeEnv() {
  return { DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test", ALLOWED_ORIGINS: ORIGIN };
}

async function requestLink(env, body) {
  const res = await worker.fetch(new Request("https://api.boomtown.test/api/auth/request-link", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify(body),
  }), env);
  return { status: res.status, data: await res.json() };
}

test("the emailed link carries a VALID from back — the only carry that survives another device", async () => {
  const r = await requestLink(makeEnv(), { email: "director@example.com", from: "admin-brackets.html" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.mode, "sandbox", "no BREVO key in tests — sandbox must expose the link");
  assert.match(r.data.dev_link, /[?&]token=/, "the link lost its token");
  assert.match(r.data.dev_link, /&from=admin-brackets\.html$/,
    "the link no longer carries the return page — a timed-out director signs in and lands on the dashboard instead of the screen they were on (D-48)");
});

test("a hostile or malformed from is DROPPED from the link — never embedded, never a refusal", async () => {
  for (const bad of ["https://evil.example/x", "//evil.example", "../admin.html", "a/b.html",
    "javascript:alert(1)", "admin.html?x=1", "x.html#f", "%2F%2Fevil.example"]) {
    const r = await requestLink(makeEnv(), { email: "director@example.com", from: bad });
    assert.equal(r.status, 200, `sign-in must not FAIL over a bad return hint (${bad}): ${JSON.stringify(r.data).slice(0, 120)}`);
    assert.ok(!r.data.dev_link.includes("from="),
      `a hostile from (${bad}) reached the emailed link — this URL lands in an inbox and then in location.href`);
  }
});

test("no from means the link of last week, byte-shape unchanged", async () => {
  const r = await requestLink(makeEnv(), { email: "director@example.com" });
  assert.equal(r.status, 200);
  assert.match(r.data.dev_link, /\/\?token=[A-Za-z0-9_-]+$/, "the plain link grew extra baggage");
});

/* ── the client reader, pinned on shipped bytes ── */

test("renderLogin READS expired=1 and says so — the sentence D-48 was about", () => {
  const t = blankComments(APP_JS);
  assert.ok(t.includes('"expired"') || t.includes("'expired'"),
    "app.js never reads the expired param — the bounce reason is still written and never read");
  assert.match(t, /session (has )?expired/i,
    "the login card never says the session expired — a timed-out director still sees a bare card with no reason");
});

test("ONE from-validator guards both the request carry and the return redirect", () => {
  const t = blankComments(APP_JS);
  const validators = t.match(/const safeFrom = /g) || [];
  assert.equal(validators.length, 1, "safeFrom must exist exactly once — two spellings of a redirect validator drift");
  assert.match(t, /\^\[a-z0-9-\]\+\\\.html\$/,
    "safeFrom no longer pins the bare same-directory page shape — from becomes location.href, this is the open-redirect line");
  assert.match(t, /const returnTo = safeFrom\(/,
    "the return target is assigned outside the validator — an unvalidated from would reach location.replace");
  assert.match(t, /location\.replace\(returnTo\)/,
    "nothing redirects to the validated target — sign-in succeeds and the director still loses their place");
  assert.ok((t.match(/safeFrom\(/g) || []).length >= 2,
    "the boot capture and the request-body carry make at least 2 validator call sites");
});

test("NC-E1: stripping the validator is caught by the assignment pin", () => {
  const t = blankComments(APP_JS);
  const mutated = t.replace(/safeFrom\(/g, "String(");
  assert.notEqual(mutated, t, "mutation did not land — safeFrom changed shape; update this NC with it");
  assert.equal((mutated.match(/safeFrom\(/g) || []).length, 0, "the strip missed a call site");
  assert.doesNotMatch(mutated, /const returnTo = safeFrom\(/,
    "the stripped copy still matches the assignment pin — it is matching something else and every pass above is vacuous");
});

test("the writer still writes — the seam has two live halves, not one", () => {
  const nav = blankComments(readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8"));
  assert.ok(nav.includes("index.html?expired=1&from="),
    "admin-nav.js no longer writes expired/from — the reader this file pins would read nothing");
});
