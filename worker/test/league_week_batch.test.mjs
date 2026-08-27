/**
 * Boomtown Platform — a league week's match inserts land in ONE atomic batch (§-1c D-59)
 * File: worker/test/league_week_batch.test.mjs · Version: v1.0 · Date: 2026-08-27 · Ships in: v0.209.0
 *
 * D-59 (recorded iteration 148 measuring Gemini's v0.206.0 review, finding C1): generateWeek wrote
 * each match with a sequential `await …run()` inside a nested loop — BOTH the wins-pods branch and
 * the level-capped path. A league night is up to ~24 games, so that is ~24 D1 round-trips and, worse,
 * a mid-loop failure leaves a PARTIAL week (some games written, no rollback). PROMPT §3 names
 * `env.DB.batch()` as the only real atomicity primitive from a Worker, and the in-memory test DB
 * runs a batch atomically too (testkit/d1-memory.mjs). Both paths now accumulate their prepared
 * statements and flush once with `env.DB.batch()`, so a week is all-or-nothing.
 *
 * The ROW OUTPUT is unchanged and is proven behaviourally elsewhere — league_night.test.mjs and
 * league_wins_pods.test.mjs drive POST /week through the real router and assert the inserted
 * round/game_number/court/pairings. This guard pins the SHAPE that makes it atomic: generateWeek
 * batches and no per-match `.run()` survives in it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC = blankComments(readFileSync(new URL("../src/leagues_admin.js", import.meta.url), "utf8"));

/** generateWeek's body: from its declaration to the next top-level async function (deleteWeek). */
function generateWeekBody(src) {
  const start = src.indexOf("async function generateWeek");
  assert.ok(start >= 0, "generateWeek not found in leagues_admin.js");
  const after = src.indexOf("\nasync function ", start + 1);
  return src.slice(start, after > -1 ? after : undefined);
}

test("generateWeek writes each week's matches through env.DB.batch — both pairing paths", () => {
  const body = generateWeekBody(SRC);
  const batches = (body.match(/env\.DB\.batch\(/g) || []).length;
  assert.ok(batches >= 2, `both the wins-pods and level-capped paths must flush their inserts with env.DB.batch (found ${batches})`);
});

test("no per-match .run() survives inside generateWeek — a sequential insert loop is the D-59 defect", () => {
  const body = generateWeekBody(SRC);
  assert.doesNotMatch(body, /\)\.run\(\)/, "a per-match .run() remains in generateWeek — the week inserts are not batched");
});

test("NC: the no-.run() detector can actually fire", () => {
  // Inject a per-match run into the current (batched) body and confirm the absence check would see it.
  const injected = generateWeekBody(SRC) + "\n      await env.DB.prepare('x').bind(1).run();\n";
  assert.match(injected, /\)\.run\(\)/, "the .run() detector cannot see an injected per-match run — the guard is vacuous");
});
