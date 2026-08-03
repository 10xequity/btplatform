/* Boomtown Platform — schedule editor tests
   File: worker/test/schedule_editor.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.65.0

   The editor's promise is that it NEVER loses a match. Dragging onto an occupied slot swaps; it
   must never overwrite. That is the property worth the most assertions here, because a silently
   dropped match is discovered on the day, by the team that turns up with nowhere to play.

   Live routes through the real router on the in-memory harness. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SRC = readFileSync(new URL("../src/formats.js", import.meta.url), "utf8");
const EDJS = readFileSync(new URL("../../web/assets/admin-schedule-editor.js", import.meta.url), "utf8");
const EDHTML = readFileSync(new URL("../../web/admin-schedule-editor.html", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (1,1,'tournament','Test Cup','published')");
  for (let i = 1; i <= 6; i++) {
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, seed) VALUES (${i},1,1,'Team ${i}',${i})`);
  }
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  const u = env.DB.one("SELECT id FROM users WHERE email = ?1", "s@bt.test");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1,${u.id},'s@bt.test','Staff')`);
  return v.data.token;
}

/* ============================ generate then read back ============================ */

test("generate a schedule, then the editor reads it with a fairness report", async () => {
  const env = boot();
  const token = await staff(env);
  const gen = await call(env, "POST", "/api/admin/events/1/generate-schedule", {
    token, body: { courts: 2, rounds: 6, assign_refs: true },
  });
  assert.equal(gen.status, 200, JSON.stringify(gen.data));
  assert.equal(gen.data.matches_written, 12, "6 rounds x 2 courts");

  const sched = await call(env, "GET", "/api/admin/events/1/schedule", { token });
  assert.equal(sched.status, 200);
  assert.equal(sched.data.matches.length, 12);
  assert.equal(sched.data.rounds, 6);
  assert.equal(sched.data.courts, 2);
  assert.ok(sched.data.report, "the editor must arrive with a fairness report already computed");
  assert.equal(sched.data.report.gamesPerTeam.equal, true);
  assert.ok(sched.data.matches[0].team_a, "matches must carry team NAMES, not just ids");
  env.DB.close();
});

test("regenerating without replace is refused, and says how many exist", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const again = await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  assert.equal(again.status, 409, "a second generate must not silently stack a second schedule");
  assert.equal(again.data.existing_matches, 12);
  assert.match(again.data.hint, /replace/);

  const replaced = await call(env, "POST", "/api/admin/events/1/generate-schedule", {
    token, body: { courts: 2, rounds: 6, replace: true },
  });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.data.matches_replaced, 12);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE deleted_at IS NOT NULL").n, 12,
    "the old schedule must be soft-deleted, not destroyed");
  env.DB.close();
});

/* ============================ the move, and the swap ============================ */

test("moving to an EMPTY slot relocates the match", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const first = env.DB.one("SELECT id FROM matches WHERE round=1 AND court=1");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/move", {
    token, body: { match_id: first.id, round: 1, court: 3 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.swapped_with, null, "an empty slot is a move, not a swap");
  const after = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", first.id);
  assert.deepEqual([after.round, after.court], [1, 3]);
  env.DB.close();
});

test("moving onto an OCCUPIED slot swaps — and never loses a match", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const before = env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE deleted_at IS NULL").n;

  const mover = env.DB.one("SELECT id FROM matches WHERE round=1 AND court=1");
  const target = env.DB.one("SELECT id FROM matches WHERE round=4 AND court=2");

  const r = await call(env, "POST", "/api/admin/events/1/schedule/move", {
    token, body: { match_id: mover.id, round: 4, court: 2 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.swapped_with, target.id, "the occupant must be reported as swapped");

  const movedTo = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", mover.id);
  const pushedTo = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", target.id);
  assert.deepEqual([movedTo.round, movedTo.court], [4, 2]);
  assert.deepEqual([pushedTo.round, pushedTo.court], [1, 1], "the occupant lands where the mover came from");

  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE deleted_at IS NULL").n, before,
    "THE promise of this screen: a swap must never lose a match");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE court = -1").n, 0,
    "the temporary parking court must not survive the swap");
  env.DB.close();
});

test("the fairness report is recomputed after a move, by the SAME rules as the generator", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const mover = env.DB.one("SELECT id FROM matches WHERE round=1 AND court=1");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/move", {
    token, body: { match_id: mover.id, round: 2, court: 1 },
  });
  assert.ok(r.data.report, "a move must come back with a fresh report");
  assert.ok(Array.isArray(r.data.summary) && r.data.summary.length,
    "and with the plain-English lines, so the editor never phrases fairness itself");
  env.DB.close();
});

test("NC: a match from another event cannot be moved into this one", async () => {
  const env = boot();
  const token = await staff(env);
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (90,1,2,'X'),(91,1,2,'Y')");
  env.DB.exec("INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id) VALUES (900,1,2,'pool',1,1,90,91)");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/move", {
    token, body: { match_id: 900, round: 1, court: 1 },
  });
  assert.equal(r.status, 404, "a match belonging to another event must not be movable here");
  env.DB.close();
});

test("changing WHO plays is a separate operation from changing WHEN", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const mt = env.DB.one("SELECT id, team_a_id, team_b_id FROM matches WHERE round=1 AND court=1");

  const same = await call(env, "POST", "/api/admin/events/1/schedule/teams", {
    token, body: { match_id: mt.id, team_a_id: mt.team_a_id, team_b_id: mt.team_a_id },
  });
  assert.equal(same.status, 400, "a team cannot play itself");

  const foreign = await call(env, "POST", "/api/admin/events/1/schedule/teams", {
    token, body: { match_id: mt.id, team_a_id: 999 },
  });
  assert.equal(foreign.status, 400, "a team not entered in this event must be refused");

  const ok = await call(env, "POST", "/api/admin/events/1/schedule/teams", {
    token, body: { match_id: mt.id, team_a_id: 5, team_b_id: 6 },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const after = env.DB.one("SELECT team_a_id, team_b_id FROM matches WHERE id = ?1", mt.id);
  assert.deepEqual([after.team_a_id, after.team_b_id], [5, 6]);
  env.DB.close();
});

test("a member cannot reach any editor route", async () => {
  const env = boot();
  // The FIRST user to verify into an org with no admin is bootstrapped to admin. Burn that on a
  // real staff account, or the "member" under test arrives holding the keys and this passes 200s
  // as if they were 403s.
  await staff(env);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  for (const [m, path, body] of [
    ["GET", "/api/admin/events/1/schedule", undefined],
    ["POST", "/api/admin/events/1/schedule/move", { match_id: 1, round: 1, court: 1 }],
    ["POST", "/api/admin/events/1/schedule/teams", { match_id: 1 }],
  ]) {
    const r = await call(env, m, path, body === undefined ? { token: v.data.token } : { token: v.data.token, body });
    assert.equal(r.status, 403, `${m} ${path} let a member through (${r.status})`);
  }
  env.DB.close();
});

/* ============================ the client contract ============================ */

test("the editor scores from the SERVER, never with its own copy of the rules", () => {
  // Two definitions of "fair" is the F-26 failure. If the client computed its own numbers they
  // would drift from the generator's, and the director would believe neither.
  assert.ok(!/function poolReport|repeatedPairs\s*=/.test(EDJS),
    "the editor must not reimplement the report");
  assert.match(EDJS, /schedule\/move/, "moves go through the server");
  assert.match(EDJS, /data\.summary/, "and the summary lines come back from it");
});

test("the editor is usable without a mouse", () => {
  // HTML5 drag-and-drop is unusable by keyboard and awkward on touch. Parity is required.
  // The arrows are object keys in the delta map (`ArrowUp: [-1, 0]`); Enter and Escape are compared
  // as strings (`e.key === "Enter"`). Requiring a closing quote or a colon after the word means the
  // match has to be code — the word sitting in a comment or a hint string does not satisfy it.
  for (const key of ["Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.match(EDJS, new RegExp(`${key}["':]`), `no keyboard handling for ${key}`);
  }
  assert.match(EDJS, /aria-label=/, "matches need accessible names, not just team text");
  // The delta is written by the script but announced by the page: a screen reader hears the result
  // of a move only if the container it lands in is a live region. Assert it on the page, because
  // that is the file that can lose it.
  assert.match(EDHTML, /id="sDelta"[^>]*aria-live/,
    "the fairness delta must land in a live region or a keyboard user never hears what a move cost");
  assert.match(EDHTML, /id="sDelta"[^>]*role="status"/, "and be announced as status, not as an alert");
});

test("moving an already-played match asks first", () => {
  assert.match(EDJS, /mt\.played && !window\.confirm/,
    "dragging a played match is nearly always a mis-drag — confirm, but do not forbid");
  assert.match(SRC, /score_a !== null && x\.score_b !== null/,
    "the server must tell the client which matches have been played");
});
