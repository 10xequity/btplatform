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

/* ============================ hold until Save (T2-1a, §-0 B11) ============================
   The owner's settled shape: hold changes until Save, revert back and forward, confirm to save —
   the pool board is the working precedent ("nothing saves until you say so"). v0.65.0's
   save-every-move design and its /schedule/move route are SUPERSEDED; the tests that pinned them
   are REWRITTEN here to their purposes — a reposition lands where it was sent, a swap never loses
   a match, fairness is scored by the server's one set of rules — now enforced at /schedule/apply
   (the one writer) and /schedule/preview (the no-write scorer). */

test("applying held positions relocates a match — and writes NOTHING it was not sent", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const first = env.DB.one("SELECT id FROM matches WHERE round=1 AND court=1");
  const other = env.DB.one("SELECT id, round, court FROM matches WHERE round=2 AND court=2");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/apply", {
    token, body: { positions: [{ match_id: first.id, round: 1, court: 3 }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.changed, 1, "one held change was saved");
  const after = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", first.id);
  assert.deepEqual([after.round, after.court], [1, 3]);
  const untouched = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", other.id);
  assert.deepEqual([untouched.round, untouched.court], [other.round, other.court],
    "a match outside the payload keeps its position");
  env.DB.close();
});

test("an apply that EXCHANGES two matches keeps both — a save must never lose a match", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const before = env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE deleted_at IS NULL").n;

  const a = env.DB.one("SELECT id FROM matches WHERE round=1 AND court=1");
  const b = env.DB.one("SELECT id FROM matches WHERE round=4 AND court=2");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/apply", {
    token, body: { positions: [
      { match_id: a.id, round: 4, court: 2 },
      { match_id: b.id, round: 1, court: 1 },
    ] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.changed, 2);

  assert.deepEqual([env.DB.one("SELECT round FROM matches WHERE id=?1", a.id).round,
                    env.DB.one("SELECT court FROM matches WHERE id=?1", a.id).court], [4, 2]);
  assert.deepEqual([env.DB.one("SELECT round FROM matches WHERE id=?1", b.id).round,
                    env.DB.one("SELECT court FROM matches WHERE id=?1", b.id).court], [1, 1]);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE deleted_at IS NULL").n, before,
    "THE promise of this screen: a swap must never lose a match");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM matches WHERE court < 1").n, 0,
    "the temporary parking courts must not survive the save");
  env.DB.close();
});

test("preview scores a HYPOTHETICAL arrangement by the generator's own rules — and writes nothing at all", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const mover = env.DB.one("SELECT id, round, court FROM matches WHERE round=1 AND court=1");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/preview", {
    token, body: { positions: [{ match_id: mover.id, round: 2, court: 1 }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.report, "a preview must come back with a fresh report");
  assert.ok(Array.isArray(r.data.summary) && r.data.summary.length,
    "and with the plain-English lines, so the editor never phrases fairness itself");
  // The write-nothing half — this is what makes hold-until-Save honest.
  const stored = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", mover.id);
  assert.deepEqual([stored.round, stored.court], [mover.round, mover.court],
    "preview must not move the stored match");
  env.DB.close();
});

test("NC: a match from another event is refused WHOLESALE by apply, and nothing is written", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (90,1,2,'X'),(91,1,2,'Y')");
  env.DB.exec("INSERT INTO matches (id, org_id, event_id, stage, round, court, team_a_id, team_b_id) VALUES (900,1,2,'pool',1,1,90,91)");
  const own = env.DB.one("SELECT id, round, court FROM matches WHERE event_id=1 AND round=1 AND court=1");
  const r = await call(env, "POST", "/api/admin/events/1/schedule/apply", {
    token, body: { positions: [
      { match_id: own.id, round: 6, court: 2 },
      { match_id: 900, round: 1, court: 1 },
    ] },
  });
  assert.equal(r.status, 404, "a match belonging to another event must poison the whole save");
  // A missing ROUTE also answers 404 — this line is what makes the assertion about the refusal
  // rather than about absence (this test was green pre-build until it was added).
  assert.match(String(r.data && r.data.error), /isn't part of this event/,
    "the refusal must be the route's own sentence, not a router fall-through");
  const stillHome = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", own.id);
  assert.deepEqual([stillHome.round, stillHome.court], [own.round, own.court],
    "a refused save applies NONE of its positions — half-applied is the worst outcome");
  env.DB.close();
});

test("apply refuses two matches on one slot — the collision is checked on the RESULT, not the request", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/generate-schedule", { token, body: { courts: 2, rounds: 6 } });
  const a = env.DB.one("SELECT id FROM matches WHERE round=1 AND court=1");
  // One field in the payload, colliding with a match that is NOT in the payload: the resulting
  // state, not the request, is what must be collision-free (PM-1 rule 3's lesson).
  const r = await call(env, "POST", "/api/admin/events/1/schedule/apply", {
    token, body: { positions: [{ match_id: a.id, round: 4, court: 2 }] },
  });
  assert.equal(r.status, 409, "round 4 court 2 is already occupied — two matches on one court is not a schedule");
  const still = env.DB.one("SELECT round, court FROM matches WHERE id = ?1", a.id);
  assert.deepEqual([still.round, still.court], [1, 1], "nothing was written");
  env.DB.close();
});

test("the superseded /schedule/move route is GONE from the worker — one writer, not two", () => {
  // The route regexes in formats.js spell their paths with ESCAPED slashes, so the needles here
  // must too — draft one searched for the plain form, missed the real routes, and "found" the
  // preview route in a comment instead (the D-33 family, caught by its own red).
  const moveRoute = "schedule\\/move";
  assert.ok(!SRC.includes(moveRoute) && !SRC.includes("schedule/move"),
    "the save-every-move route must not survive beside apply — two writers of one arrangement is how they disagree");
  assert.ok(SRC.includes("schedule\\/preview"), "the no-write scorer's ROUTE exists (escaped form — the regex, not a comment)");
  assert.ok(SRC.includes("schedule\\/apply"), "the one writer's ROUTE exists (escaped form — the regex, not a comment)");
  // NC: the needle is load-bearing — plant the old route shape and the check goes red.
  const mutated = SRC + "\nif (p.match(/schedule\\/move/)) {}";
  assert.ok(mutated.includes(moveRoute), "the mutation landed and would be caught");
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
    ["POST", "/api/admin/events/1/schedule/preview", { positions: [] }],
    ["POST", "/api/admin/events/1/schedule/apply", { positions: [{ match_id: 1, round: 1, court: 1 }] }],
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
  // would drift from the generator's, and the director would believe neither. Hold-until-Save
  // did not change this: held moves are scored by /schedule/preview — the same poolReport, no
  // write — never by client arithmetic.
  assert.ok(!/function poolReport|repeatedPairs\s*=/.test(EDJS),
    "the editor must not reimplement the report");
  assert.match(EDJS, /schedule\/preview/, "held arrangements are scored by the server");
  assert.ok(!EDJS.includes("schedule/move"), "the superseded per-move writer has no caller left");
  assert.match(EDJS, /data\.summary/, "and the summary lines come back from it");
});

test("the editor HOLDS: moves are local, Save is the one writer, and the history runs both ways", () => {
  assert.match(EDJS, /undoStack/, "an undo history exists");
  assert.match(EDJS, /redoStack/, "and it runs forward again after an undo");
  assert.match(EDJS, /schedule\/apply/, "Save posts the held positions to the one writer");
  const saveBody = EDJS.slice(EDJS.indexOf("async function save"), EDJS.indexOf("async function save") + 900);
  assert.ok(saveBody.includes("schedule/apply"), "…and that call lives INSIDE save(), nowhere else");
  assert.equal(EDJS.split("schedule/apply").length - 1, 1, "exactly one apply call site — a second writer is how they disagree");
  // The dirty state must be visible and guarded: a director who navigates away with held changes
  // must be asked, because hold-until-Save makes silent loss POSSIBLE where save-every-move could
  // not lose anything.
  assert.match(EDJS, /beforeunload/, "held changes guard the tab close");
  assert.match(EDHTML, /id="sSave"/, "a Save button exists");
  assert.match(EDHTML, /id="sUndo"/, "an Undo button exists");
  assert.match(EDHTML, /id="sRedo"/, "a Redo button exists");
  assert.match(EDHTML, /id="sState"[^>]*aria-live/, "the saved/unsaved state is announced, not just coloured");
  // NC: the needle is load-bearing.
  const mutated = EDJS.replace(/undoStack/g, "XXGONE");
  assert.ok(!mutated.includes("undoStack"), "the mutation landed");
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

/* ═══ RF-3 (v0.193.0): the week-first flow — a Show filter and the per-week print ═══ */

test("RF-3 — the Show filter exists and is a VIEW: it re-renders without touching held state", () => {
  assert.match(EDHTML, /id="sWeek"/, "the Show filter left the toolbar");
  assert.match(EDHTML, /id="sPrint"/, "the print button left the toolbar");
  // The filter's handler calls render() only — data, undoStack and baseline are untouched, the
  // same property the axis switch has. A handler that reloads would drop held moves.
  assert.ok(EDJS.includes('$("sWeek").addEventListener("change", () => { weekFilter = Number($("sWeek").value) || 0; render(); });'),
    "the filter stopped being a pure view — held moves are at risk");
  assert.ok(EDJS.includes('$("sPrint").addEventListener("click", () => window.print());'),
    "print stopped printing what is shown");
});

test("RF-3 — a stale filter falls back to All, and a league is filtered by WEEK vocabulary", () => {
  assert.ok(EDJS.includes("if (weekFilter && weekFilter <= data.rounds) return [weekFilter];"),
    "shownRounds no longer guards a filter past the schedule's end — an empty grid would render");
  assert.match(EDJS, /weekFilter = 0;\s*\n\s*return all;/,
    "the stale filter is not reset — the select would show a week the grid ignores");
  assert.ok(EDJS.includes('eventType === "league" ? "Week" : "Round"'),
    "the filter lost the event's own vocabulary — a league's rounds ARE its weeks");
});

test("RF-3 — the per-week print: the page print CSS drops the controls and unclips the grid", () => {
  const m = /@media print\s*\{/.exec(EDHTML);
  assert.ok(m, "the editor page lost its @media print block — the per-week print prints the chrome");
  let depth = 0, body = null;
  for (let i = m.index + m[0].length - 1; i < EDHTML.length; i++) {
    if (EDHTML[i] === "{") depth++;
    else if (EDHTML[i] === "}") { depth--; if (depth === 0) { body = EDHTML.slice(m.index + m[0].length, i); break; } }
  }
  assert.ok(body, "unbalanced print block");
  assert.match(body, /\.mf-row[^}]*display:\s*none/, "the toolbar prints");
  assert.match(body, /\.ed-side-panel/, "the fairness panel prints");
  assert.match(body, /\.ed-grid-scroll\s*\{\s*overflow:\s*visible/, "the grid still clips at the scroll edge on paper");
});

test("RF-3 NC — a filter handler that reloads instead of rendering is caught (mutation on real source)", () => {
  const good = '$("sWeek").addEventListener("change", () => { weekFilter = Number($("sWeek").value) || 0; render(); });';
  const mutated = EDJS.replace("weekFilter = Number($(\"sWeek\").value) || 0; render();",
    "weekFilter = Number($(\"sWeek\").value) || 0; loadSchedule();");
  assert.notEqual(mutated, EDJS, "the mutation did not land — the handler is not in the code");
  assert.ok(!mutated.includes(good),
    "the view-property check still passes on a reloading handler — the anchor is shape-blind");
});
