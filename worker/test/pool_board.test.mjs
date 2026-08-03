/* Boomtown Platform — pool board tests
   File: worker/test/pool_board.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.70.0

   Owner 2026-08-03: "if i drag to a square or block with + it will add a pool. and if it is empty,
   itll auto delete. i will also need a workspace area to arrange teams to move."

   THE PROPERTY THAT MATTERS MOST: a team is in exactly one place, always. A drag board that can put
   a team in two pools produces a schedule where somebody is double-booked, and that is found on the
   morning of the event by the team standing on two courts. It is asserted from both directions —
   the request is refused, and the resulting rows are counted. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const PBJS = readFileSync(new URL("../../web/assets/admin-pool-board.js", import.meta.url), "utf8");
const PBHTML = readFileSync(new URL("../../web/admin-pool-board.html", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot(teamCount = 12) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Board Test','published',12)");
  DB.exec("INSERT INTO divisions (id, org_id, event_id, name, rank, court_from, court_to) VALUES (10,1,1,'Open',1,1,4),(11,1,1,'A',2,5,8)");
  for (let i = 1; i <= teamCount; i++) {
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
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

const save = (env, token, pools) => call(env, "POST", "/api/admin/events/1/board", { token, body: { pools } });

/* ================================ the workspace ================================ */

test("every team starts in the workspace, which is simply having no pool", async () => {
  // No magic row, nothing to create. An unplaced team is a team with pool_id IS NULL, which is also
  // the state it is born in.
  const env = boot(12);
  const token = await staff(env);
  const r = await call(env, "GET", "/api/admin/events/1/board", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.workspace.length, 12);
  assert.equal(r.data.divisions.length, 2);
  assert.deepEqual(r.data.divisions.map((d) => d.pools), [[], []]);
  env.DB.close();
});

test("dragging a team out of a pool puts them back in the workspace, with no second request", async () => {
  const env = boot(6);
  const token = await staff(env);
  await save(env, token, [{ division_id: 10, name: "Pool A", team_ids: [1, 2, 3, 4, 5, 6] }]);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE pool_id IS NULL").n, 0);

  // The next save simply omits team 6 — that is what dragging it to the workspace looks like.
  const r = await save(env, token, [{ division_id: 10, name: "Pool A", team_ids: [1, 2, 3, 4, 5] }]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.workspace.map((t) => t.id), [6]);
  assert.match(r.data.note, /1 in the workspace/);
  env.DB.close();
});

/* ================================ one place, always ================================ */

test("a team cannot be put in two pools, and nothing is written when it is attempted", async () => {
  const env = boot(6);
  const token = await staff(env);
  const r = await save(env, token, [
    { division_id: 10, name: "Pool A", team_ids: [1, 2, 3] },
    { division_id: 10, name: "Pool B", team_ids: [3, 4, 5] },   // 3 twice
  ]);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /can't be in two pools/);
  // Refused BEFORE any write — a partially applied board is worse than a rejected one.
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM pools").n, 0);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE pool_id IS NOT NULL").n, 0);
  env.DB.close();
});

test("after any save, no team is in more than one pool", async () => {
  // The invariant, checked against the rows rather than the response.
  const env = boot(12);
  const token = await staff(env);
  await save(env, token, [
    { division_id: 10, name: "Open A", team_ids: [1, 2, 3, 4, 5, 6] },
    { division_id: 11, name: "A A", team_ids: [7, 8, 9] },
  ]);
  const counts = env.DB.query("SELECT id, pool_id FROM teams WHERE pool_id IS NOT NULL");
  assert.equal(counts.length, 9);
  assert.equal(new Set(counts.map((t) => t.id)).size, 9, "a team id appeared twice");
  env.DB.close();
});

test("a team from another event cannot be dropped onto this board", async () => {
  const env = boot(4);
  const token = await staff(env);
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (99,1,2,'Outsider')");
  const r = await save(env, token, [{ division_id: 10, name: "Pool A", team_ids: [1, 99] }]);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /isn't in this event/);
  env.DB.close();
});

/* ================================ pools appear and disappear ================================ */

test("a pool with no id is created — this is what dropping on the + does", async () => {
  const env = boot(6);
  const token = await staff(env);
  const r = await save(env, token, [{ division_id: 10, name: "Pool A", team_ids: [1, 2, 3] }]);
  assert.equal(r.data.created, 1);
  const pool = env.DB.one("SELECT id, name, division_id, sort_order FROM pools");
  assert.equal(pool.name, "Pool A");
  assert.equal(pool.division_id, 10);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM teams WHERE pool_id=?1", pool.id).n, 3);
  env.DB.close();
});

test("an empty pool auto-deletes, and one that never held a game leaves nothing behind", async () => {
  // Owner: "if it is empty, itll auto delete." A soft-deleted empty pool would accumulate invisible
  // rows on the board forever, and it has no history worth keeping — it never had a team.
  const env = boot(6);
  const token = await staff(env);
  await save(env, token, [
    { division_id: 10, name: "Pool A", team_ids: [1, 2, 3] },
    { division_id: 10, name: "Pool B", team_ids: [4, 5, 6] },
  ]);
  const bId = env.DB.one("SELECT id FROM pools WHERE name='Pool B'").id;

  // Everyone dragged out of B into A.
  const r = await save(env, token, [{ id: env.DB.one("SELECT id FROM pools WHERE name='Pool A'").id, division_id: 10, name: "Pool A", team_ids: [1, 2, 3, 4, 5, 6] }]);
  assert.equal(r.data.removed, 1);
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM pools WHERE id=?1", bId).n, 0,
    "an empty pool that never held a game should be gone entirely, not soft-deleted");
  assert.match(r.data.note, /1 empty pool removed/);
  env.DB.close();
});

test("an emptied pool that HAS matches is soft-deleted, because those matches point at it", async () => {
  const env = boot(6);
  const token = await staff(env);
  await save(env, token, [{ division_id: 10, name: "Pool A", team_ids: [1, 2, 3] }]);
  const pid = env.DB.one("SELECT id FROM pools").id;
  env.DB.exec(`INSERT INTO matches (org_id, event_id, pool_id, stage, round, court, team_a_id, team_b_id)
               VALUES (1,1,${pid},'pool',1,1,1,2)`);

  await save(env, token, []);   // everything back to the workspace
  const row = env.DB.one("SELECT deleted_at FROM pools WHERE id=?1", pid);
  assert.ok(row, "the pool row must survive — a match still references it");
  assert.ok(row.deleted_at, "and it must be soft-deleted so the board stops showing it");
  env.DB.close();
});

test("an empty pool is never created in the first place", async () => {
  const env = boot(4);
  const token = await staff(env);
  const r = await save(env, token, [
    { division_id: 10, name: "Pool A", team_ids: [1, 2] },
    { division_id: 10, name: "Pool B", team_ids: [] },
  ]);
  assert.equal(r.data.created, 1, "the empty one should not be created and then deleted");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM pools").n, 1);
  env.DB.close();
});

test("pool order on screen is the order that is stored", async () => {
  // Two pools created in the same second are otherwise ordered by id, and dragging one before the
  // other would silently do nothing.
  const env = boot(6);
  const token = await staff(env);
  await save(env, token, [
    { division_id: 10, name: "Second", team_ids: [1, 2] },
    { division_id: 10, name: "First", team_ids: [3, 4] },
  ]);
  const order = env.DB.query("SELECT name, sort_order FROM pools ORDER BY sort_order");
  assert.deepEqual(order.map((p) => p.name), ["Second", "First"]);
  assert.deepEqual(order.map((p) => p.sort_order), [0, 1]);
  env.DB.close();
});

test("placing a team into a division's pool also puts the team in that division", async () => {
  const env = boot(4);
  const token = await staff(env);
  await save(env, token, [{ division_id: 11, name: "A A", team_ids: [1, 2] }]);
  assert.equal(env.DB.one("SELECT division_id FROM teams WHERE id=1").division_id, 11);
  env.DB.close();
});

/* ================================ notes ================================ */

test("a note is saved on the team, so dragging the tile never loses it", async () => {
  // Owner: "allow me to write a note that is displayed on the tile." Attaching it to the placement
  // instead would silently discard it the first time somebody rearranged the board.
  const env = boot(4);
  const token = await staff(env);
  const r = await call(env, "POST", "/api/admin/events/1/board/note", {
    token, body: { team_id: 1, note: "Asked to finish by 4pm — two players have a flight." },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  await save(env, token, [{ division_id: 10, name: "Pool A", team_ids: [1, 2] }]);
  await save(env, token, [{ division_id: 11, name: "A A", team_ids: [1, 2] }]);
  const board = await call(env, "GET", "/api/admin/events/1/board", { token });
  const t1 = board.data.divisions.flatMap((d) => d.pools).flatMap((p) => p.teams).find((t) => t.id === 1);
  assert.match(t1.note, /finish by 4pm/, "the note did not survive being dragged between divisions");
  env.DB.close();
});

test("clearing a note stores nothing rather than an empty string", async () => {
  const env = boot(4);
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/board/note", { token, body: { team_id: 1, note: "x" } });
  const r = await call(env, "POST", "/api/admin/events/1/board/note", { token, body: { team_id: 1, note: "   " } });
  assert.equal(r.data.note, null);
  assert.equal(env.DB.one("SELECT note FROM teams WHERE id=1").note, null);
  env.DB.close();
});

test("a note for a team in another event is refused", async () => {
  const env = boot(4);
  const token = await staff(env);
  env.DB.exec("INSERT INTO events (id, org_id, type, name, status) VALUES (2,1,'tournament','Other','published')");
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (99,1,2,'Outsider')");
  const r = await call(env, "POST", "/api/admin/events/1/board/note", { token, body: { team_id: 99, note: "x" } });
  assert.equal(r.status, 404);
  env.DB.close();
});

/* ================================ access ================================ */

test("a member cannot read or write the board", async () => {
  const env = boot(4);
  await staff(env);
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "m@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  for (const [m, path] of [
    ["GET", "/api/admin/events/1/board"],
    ["POST", "/api/admin/events/1/board"],
    ["POST", "/api/admin/events/1/board/note"],
  ]) {
    const r = await call(env, m, path, { token: v.data.token, body: m === "GET" ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${path} let a member through (${r.status})`);
  }
  env.DB.close();
});

/* ================================ the page contract ================================ */

test("the board is usable without a mouse", () => {
  for (const key of ["Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.match(PBJS, new RegExp(`${key}["':]`), `no keyboard handling for ${key}`);
  }
  assert.match(PBJS, /tabindex="0"/, "tiles must be focusable, or the keyboard path is unreachable");
  assert.match(PBJS, /aria-label="\$\{esc\(t\.name\)\}/, "a tile needs an accessible name including its note");
});

test("unsaved work is announced and guarded", () => {
  // Twenty minutes of dragging thrown away by an event switch is the failure this prevents.
  assert.match(PBJS, /dirty = true/, "local edits must mark the board dirty");
  assert.match(PBJS, /beforeunload/, "closing the tab with unsaved work must warn");
  assert.match(PBJS, /unsaved changes on this board/i, "switching event with unsaved work must confirm");
  assert.match(PBHTML, /id="pbState"[^>]*aria-live/, "the saved/unsaved state must be announced");
});

test("the unsaved indicator is not colour-only", () => {
  // A director who cannot distinguish the colours must still see that the board is unsaved.
  assert.match(PBHTML, /\.pb-state\.dirty::before \{ content: "● "/, "needs a non-colour cue");
  assert.match(PBJS, /textContent = dirty \? "Unsaved changes" : "Saved"/, "and the state stated in words");
});

test("the save button is disabled until something actually changes", () => {
  assert.match(PBJS, /\$\("pbSave"\)\.disabled = !dirty/);
});

test("the pool-size hint is advisory, never blocking", () => {
  // Owner: 6-11 is the preference on grass, and "Indoor tournaments are a lot more limited due to
  // number of courts". A board that refused a pool of 4 would be wrong indoors.
  assert.match(PBJS, /under 6/);
  assert.match(PBJS, /over 11/);
  assert.ok(!/disabled.*pool.*size|cannot save/i.test(PBJS), "a size warning must not block saving");
});
