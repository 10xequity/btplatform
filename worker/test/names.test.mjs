/* Boomtown Platform — how a person's name is written
   File: worker/test/names.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.74.0

   Owner 2026-08-03: "Please add captains names for all the tiles - including live scores."

   The live board needs no login, so a name on it is published to anyone who loads the page. The
   standing rule (standards §8, recorded in CLAUDE.md §4) is "First L. unless the member chose public
   visibility" — and a captain in a junior league is frequently a minor, which is why the rule exists
   rather than being a nicety.

   So the tests that matter are: the abbreviation is correct for real name shapes, the public surface
   abbreviates by default, and the member's own choice is honoured in both directions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { personName, abbreviate } from "../src/names.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/* ================================ the abbreviation ================================ */

test("First L. — the ordinary case", () => {
  assert.equal(abbreviate("Ava Stone"), "Ava S.");
  assert.equal(abbreviate("Jonah Nguyen"), "Jonah N.");
});

test("the initial comes from the SECOND word, not the last", () => {
  // "Mary Jo Van Dyke" → "Mary J." A last-word rule gives "Mary D.", which is a different person to
  // everybody who knows her, and it is the kind of wrong that nobody reports — they just stop
  // trusting the board.
  assert.equal(abbreviate("Mary Jo Van Dyke"), "Mary J.");
  assert.equal(abbreviate("Juan Carlos Ortiz"), "Juan C.");
});

test("a single-word name is left alone rather than mangled", () => {
  // Plenty of people have one name in a roster field. A last-word rule turns "Prince" into "Prince P."
  assert.equal(abbreviate("Prince"), "Prince");
  assert.equal(abbreviate("Ava"), "Ava");
});

test("abbreviating twice is harmless", () => {
  // Some rosters arrive already shortened, and this runs on whatever is stored.
  assert.equal(abbreviate("Ava S."), "Ava S.");
  assert.equal(abbreviate(abbreviate("Ava Stone")), "Ava S.");
  assert.equal(abbreviate("Ava S"), "Ava S.");
});

test("blank and missing names produce nothing, not 'undefined'", () => {
  // A team with no captain is the normal state until somebody fills it in, and "undefined U." on a
  // wall display is worse than an empty cell.
  assert.equal(personName(null), null);
  assert.equal(personName(""), null);
  assert.equal(personName("   "), null);
  assert.equal(abbreviate(""), "");
});

test("extra whitespace does not become an initial", () => {
  assert.equal(abbreviate("  Ava   Stone  "), "Ava S.");
});

/* ================================ the rule ================================ */

test("public surfaces abbreviate by DEFAULT — the safe answer needs no argument", () => {
  // If the default were the full name, every new public surface would leak until somebody remembered
  // to pass a flag. Defaults decide what happens when nobody is thinking about it.
  assert.equal(personName("Ava Stone"), "Ava S.");
  assert.equal(personName("Ava Stone", {}), "Ava S.");
  assert.equal(personName("Ava Stone", { visibility: "members" }), "Ava S.");
  assert.equal(personName("Ava Stone", { visibility: "private" }), "Ava S.");
  assert.equal(personName("Ava Stone", { visibility: undefined }), "Ava S.");
});

test("a member who chose public visibility gets their full name", () => {
  // They asked for it. Overriding their choice in the other direction is its own small disrespect.
  assert.equal(personName("Ava Stone", { visibility: "public" }), "Ava Stone");
});

test("staff surfaces get the full name", () => {
  // A director chasing a team that has not turned up needs the actual name.
  assert.equal(personName("Ava Stone", { full: true }), "Ava Stone");
  assert.equal(personName("Ava Stone", { full: true, visibility: "private" }), "Ava Stone",
    "an explicit staff surface outranks the member's public/private setting");
});

/* ================================ end to end ================================ */

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Open','in_progress',4)");
  DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (50,1,'ava@example.com','Ava Stone'),(51,1,'jo@example.com','Mary Jo Van Dyke')");
  // 50 keeps the default ('members'); 51 has chosen public.
  DB.exec("INSERT INTO member_profiles (org_id, contact_id, visibility) VALUES (1,50,'members'),(1,51,'public')");
  DB.exec("INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (1,1,1,'Set to Kill',50),(2,1,1,'Block Party',51)");
  DB.exec("INSERT INTO standings (org_id, event_id, team_id, wins, losses, rank) VALUES (1,1,1,3,0,1),(1,1,2,0,3,2)");
  DB.exec("INSERT INTO matches (id,org_id,event_id,stage,round,court,team_a_id,team_b_id,points_to) VALUES (9,1,1,'pool',1,1,1,2,21)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, path, token) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data, raw: t };
}

async function staff(env) {
  const post = async (p, body) => {
    const res = await worker.fetch(new Request(`${ORIGIN}${p}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" },
      body: JSON.stringify(body),
    }), env);
    return res.json();
  };
  const asked = await post("/api/auth/request-link", { email: "s@bt.test" });
  const v = await post("/api/auth/verify", { token: String(asked.dev_link).split("token=")[1] });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.token;
}

test("the PUBLIC board abbreviates a default-visibility captain and never sends the full name", async () => {
  const env = boot();
  const r = await call(env, "/api/live/events/1");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(!r.raw.includes("Ava Stone"),
    "the public board sent a default-visibility captain's full name — that is published to anyone");
  assert.ok(r.raw.includes("Ava S."), "and it should still say who the captain is");
  env.DB.close();
});

test("the PUBLIC board honours a captain who chose public visibility", async () => {
  const env = boot();
  const r = await call(env, "/api/live/events/1");
  assert.ok(r.raw.includes("Mary Jo Van Dyke"), "this member asked to be named in full");
  env.DB.close();
});

test("captains reach the public court cards and the standings table", async () => {
  const env = boot();
  const r = await call(env, "/api/live/events/1");
  assert.equal(r.data.on_now[0].captain_a, "Ava S.");
  assert.equal(r.data.on_now[0].captain_b, "Mary Jo Van Dyke");
  assert.equal(r.data.overall.find((t) => t.name === "Set to Kill").captain, "Ava S.");
  env.DB.close();
});

test("the ADMIN pool board and bracket bench give the full name", async () => {
  // Different surface, different rule, and the same helper — which is the point of there being one.
  const env = boot();
  const token = await staff(env);
  const board = await call(env, "/api/admin/events/1/board", token);
  assert.equal(board.status, 200, JSON.stringify(board.data));
  const t1 = board.data.workspace.find((t) => t.id === 1);
  assert.equal(t1.captain, "Ava Stone", "a director chasing a team needs the real name");
  env.DB.close();
});

test("a team with no captain reports null on every surface, not a placeholder", async () => {
  const env = boot();
  env.DB.exec("UPDATE teams SET captain_contact_id=NULL WHERE id=1");
  const token = await staff(env);
  const live = await call(env, "/api/live/events/1");
  assert.equal(live.data.on_now[0].captain_a, null);
  const board = await call(env, "/api/admin/events/1/board", token);
  assert.equal(board.data.workspace.find((t) => t.id === 1).captain, null);
  assert.ok(!live.raw.includes("undefined"), "no 'undefined' anywhere in a public payload");
  env.DB.close();
});

test("there is only ONE name rule in the codebase", () => {
  // Two would be one too many: the day they disagree, a minor's full name is on a wall while every
  // admin screen insists the rule is being followed.
  const src = ["live.js", "brackets.js", "divisions.js"].map((f) =>
    readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(!/\.split\(" "\)\[0\]|charAt\(0\) \+ "\."/.test(src),
    "a hand-rolled abbreviation has appeared alongside names.js");
  for (const f of ["live.js", "brackets.js", "divisions.js"]) {
    const one = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.match(one, /from "\.\/names\.js"/, `${f} must use the shared name rule`);
  }
});
