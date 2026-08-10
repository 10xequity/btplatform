/**
 * Boomtown Platform — §-1j T2-13: every credentialed org-scoped fetch attaches the bearer token
 * File: worker/test/token_convention.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.120.0
 *
 * WHY. The owner's tester report said the leagues page and sub finder "ask for login again". The
 * axis (iteration 45, measured): `leagues.js`'s api() sends `credentials:'include'` + `X-Org-Id`
 * but NEVER an Authorization header — the only member surface with zero `bt_token` reads — so
 * every signed-in visit 401'd and the page rendered its sign-in card to a signed-in user. The
 * file's own comment claimed "same fetch convention as app.js/profile.js", WHICH WAS FALSE, and
 * that prose is why nobody suspected it: the comment was read instead of the code.
 *
 * THE GUARD IS THE GENERALISATION, NOT THE PATCH (the v0.119.0 lesson). The rule, derived from
 * the corpus rather than declared: a fetch wrapper that sends BOTH `credentials: "include"` AND
 * an `X-Org-Id` header is making signed-in, org-scoped calls — and it must read `bt_token` and
 * attach `Authorization`. The two public boards (live.js, kotc-live.js) send X-Org-Id WITHOUT
 * credentials and fall out of scope by the rule itself, not by an allowlist — an allowlist is
 * where the next leagues.js would hide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const ASSETS = new URL("../../web/assets/", import.meta.url);
const read = (f) => readFileSync(new URL(f, ASSETS), "utf8");

const sendsCredentials = (src) => /credentials:\s*["']include["']/.test(src);
const sendsOrgHeader = (src) => /X-Org-Id/.test(src);
const attachesBearer = (src) => /bt_token/.test(src) && /Authorization/.test(src);

/** The violators in one corpus pass: credentialed + org-scoped, yet token-less. */
function violators(files) {
  const bad = [];
  for (const [name, source] of files) {
    const src = blankComments(source);
    if (sendsCredentials(src) && sendsOrgHeader(src) && !attachesBearer(src)) bad.push(name);
  }
  return bad;
}

const allFiles = () => readdirSync(ASSETS).filter((f) => f.endsWith(".js")).map((f) => [f, read(f)]);

test("every credentialed org-scoped fetch wrapper attaches the bearer token — the whole assets corpus", () => {
  const files = allFiles();
  assert.ok(files.length > 25, `only ${files.length} asset files found — the corpus path is wrong and this guard scans nothing`);
  assert.deepEqual(violators(files), [],
    "these files make signed-in org-scoped calls WITHOUT the token — every request 401s and " +
    "the page treats a signed-in member as signed out (the T2-13 defect class)");
});

test("the rule's boundary is the rule, not an allowlist: the public boards are out of scope because they send no credentials", () => {
  for (const name of ["live.js", "kotc-live.js"]) {
    const src = blankComments(read(name));
    assert.ok(sendsOrgHeader(src), `${name} no longer sends X-Org-Id — this boundary case went stale, re-derive it`);
    assert.equal(sendsCredentials(src), false,
      `${name} now sends credentials — it has entered the rule's scope and must attach the token like everyone else`);
  }
});

test("NC — stripping the Authorization attachment from the REAL leagues.js makes the checker fire", () => {
  const real = read("leagues.js");
  assert.equal(violators([["leagues.js", real]]).length, 0, "the shipped leagues.js should be clean before mutating");

  // Mutate the real input the checker reads; both token markers must go for the mutation to mean anything.
  const mutated = real.replace(/bt_token/g, "bt_nothing").replace(/Authorization/g, "X-Nothing");
  assert.notEqual(mutated, real, "mutation did not land — nothing was stripped");
  assert.deepEqual(violators([["leagues.js", mutated]]), ["leagues.js"],
    "the token attachment was stripped and the checker stayed green — every pass above is vacuous");
});
