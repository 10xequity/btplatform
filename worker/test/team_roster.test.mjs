/**
 * Boomtown Platform — the roster a registration creates (roadmap §-1b W-A)
 * File: worker/test/team_roster.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.92.0
 *
 * WHY (owner 2026-08-05): "when teams register they need to fill out a form, then that form
 * populates after payment the roster page (which should be editable)". submitRegistration has
 * written teams + team_members since day one, but nothing could read a team back or edit it —
 * the flow existed in the database and nowhere on screen. These tests drive the REAL public
 * registration route first (e2e_journey pattern; nothing under test is mocked), so the roster
 * being edited is the one a registration actually creates, not a hand-built fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function makeEnv() {
  return {
    DB: createD1(SCHEMA),
    APP_URL: ORIGIN,
    SITE_ORIGIN: ORIGIN,
    API_ORIGIN: "https://api.boomtown.test",
    ALLOWED_ORIGINS: ORIGIN,
  };
}

async function call(env, method, path, { body, token, orgId = 1 } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(orgId) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://api.boomtown.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await worker.fetch(req, env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text.slice(0, 400) }; }
  return { status: res.status, data };
}

function expectStatus(r, want, what) {
  assert.equal(r.status, want,
    `${what}: expected ${want}, got ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);
}

function seed(env) {
  env.DB.exec(`
    INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
    INSERT INTO orgs (id, name, slug, active) VALUES (2, 'Match Point Social', 'matchpoint', 1);
    INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status)
      VALUES (1, 1, 'Sandbox waiver v1', 'I agree to the terms.', 'sha-sandbox-1', 'active');
    INSERT INTO events (id, org_id, type, name, status, capacity, price_cents, starts_at)
      VALUES (1, 1, 'league', 'Thursday Coed 4s', 'published', 10, 0, datetime('now','+7 days'));
  `);
}

async function signInAdmin(env) {
  // First-ever user bootstraps to admin of all active orgs (F-12) — which is what this needs.
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "roster-admin@boomtown.test" } });
  const token = String(asked.data.dev_link).split("token=")[1];
  const verified = await call(env, "POST", "/api/auth/verify", { body: { token } });
  expectStatus(verified, 200, "auth/verify");
  return verified.data.token;
}

/** The whole W-A loop in one journey — register, read the roster back, edit every way. */
test("a registration's team is readable and editable through the roster routes", async () => {
  const env = makeEnv();
  seed(env);
  const token = await signInAdmin(env);

  // 1. The REAL public registration — the form the owner described, teammates included.
  const reg = await call(env, "POST", "/api/events/1/register", {
    body: {
      email: "captain@boomtown.test",
      team_name: "Roster Rockets",
      captain_name: "Casey Captain",
      team_level: "BB",
      date_of_birth: "1994-05-05",
      waiver_accepted: true,
      waiver_signature: "Casey Captain",
      teammates: [{ name: "Toni Teammate", email: "toni@boomtown.test" }],
    },
  });
  expectStatus(reg, 200, "public registration");
  const regRow = env.DB.one("SELECT id, team_id FROM registrations WHERE event_id = 1");
  assert.ok(regRow && regRow.team_id, "registration wrote no team_id — the link W-A is built on");

  // 2. The roster reads back: captain + teammate, and the registration it came from.
  const roster = await call(env, "GET", `/api/admin/teams/${regRow.team_id}`, { token });
  expectStatus(roster, 200, "GET roster");
  assert.equal(roster.data.team.name, "Roster Rockets");
  assert.equal(roster.data.registration.id, regRow.id, "the roster must name the registration that created it");
  const names = roster.data.members.map((m) => m.member_name).sort();
  assert.deepEqual(names, ["Casey Captain", "Toni Teammate"], "the form's people ARE the roster");

  // 3. Editable, all three ways: rename the team, fix a name, add and remove a member.
  const renamed = await call(env, "PATCH", `/api/admin/teams/${regRow.team_id}`, {
    token, body: { name: "Roster Rockets 2.0" },
  });
  expectStatus(renamed, 200, "PATCH team");
  assert.equal(renamed.data.team.name, "Roster Rockets 2.0");

  const toni = renamed.data.members.find((m) => m.member_name === "Toni Teammate");
  const fixed = await call(env, "PATCH", `/api/admin/team-members/${toni.id}`, {
    token, body: { name: "Toni T-Fixed" },
  });
  expectStatus(fixed, 200, "PATCH member");
  assert.ok(fixed.data.members.some((m) => m.member_name === "Toni T-Fixed"));

  const added = await call(env, "POST", `/api/admin/teams/${regRow.team_id}/members`, {
    token, body: { name: "Newby Nets", email: "newby@boomtown.test" },
  });
  expectStatus(added, 200, "POST member");
  assert.equal(added.data.members.length, 3);

  const removed = await call(env, "DELETE", `/api/admin/team-members/${toni.id}`, { token });
  expectStatus(removed, 200, "DELETE member");
  assert.equal(removed.data.members.length, 2, "a removed member leaves the roster (soft-deleted underneath)");
  const gone = env.DB.one("SELECT deleted_at FROM team_members WHERE id = ?1", toni.id);
  assert.ok(gone.deleted_at, "removal must be a soft delete, never a hard one");
});

test("a team outside the caller's org answers 404 — and a nameless rename is refused", async () => {
  const env = makeEnv();
  seed(env);
  const token = await signInAdmin(env);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name) VALUES (777, 2, 1, 'Other Org Team');`);

  const crossOrg = await call(env, "GET", "/api/admin/teams/777", { token, orgId: 1 });
  expectStatus(crossOrg, 404, "cross-org roster read must not resolve (F-11 class)");

  const reg = await call(env, "POST", "/api/events/1/register", {
    body: {
      email: "cap2@boomtown.test", team_name: "Refusal FC", captain_name: "Ref User",
      date_of_birth: "1990-01-01", waiver_accepted: true, waiver_signature: "Ref User",
    },
  });
  expectStatus(reg, 200, "second registration");
  const teamId = env.DB.one("SELECT team_id FROM registrations WHERE contact_id = (SELECT id FROM contacts WHERE email='cap2@boomtown.test')").team_id;
  const blank = await call(env, "PATCH", `/api/admin/teams/${teamId}`, { token, body: { name: "   " } });
  expectStatus(blank, 400, "a blank team name must be refused with a human sentence");
  assert.ok(blank.data.error, "the refusal carries a sentence");
});

/* ── the modal's callers (v0.161.0, §-0 B14 / T2-9a): pages and emitters correspond, BOTH
      directions — team-roster.js's own header says "from wherever a team appears", and until
      B14 exactly two pages qualified while the registrations LIST rendered team names as dead
      text (the server had returned r.team_id for this button since W-A, per registrations.js's
      own header: "so the registrations table can link to the roster"). A script tag with no
      emitter is dead weight; an emitter with no script tag is a dead button. ── */
import { readdirSync } from "node:fs";

const WEB_URL = new URL("../../web/", import.meta.url);
const readWeb = (rel) => readFileSync(new URL(rel, WEB_URL), "utf8");

test("BT_ROSTER mounts: loader pages and button emitters are the same set, and it now includes the registrations list", () => {
  const pages = readdirSync(WEB_URL).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length >= 40, `page corpus shrank: ${pages.length}`);
  const loaders = pages.filter((p) => readWeb(p).includes("assets/team-roster.js")).sort();
  assert.deepEqual(loaders, ["admin-event.html", "admin-league.html", "admin-registrations.html"],
    "the pages loading team-roster.js changed — if a page joined, its JS must emit the button below; if one left, its teams just became unreachable");
  for (const p of loaders) {
    const js = "assets/" + p.replace(".html", ".js");
    assert.ok(readWeb(js).includes('data-roster="'), `${p} loads the modal but ${js} never emits a roster button — a script tag with no caller`);
  }
  // The other direction, DERIVED from the assets themselves — an emitter whose page forgot the
  // script tag renders buttons that do nothing when tapped.
  const assets = readdirSync(new URL("assets/", WEB_URL)).filter((f) => f.endsWith(".js") && f !== "team-roster.js");
  const emitters = assets.filter((f) => readWeb("assets/" + f).includes('data-roster="')).sort();
  assert.deepEqual(emitters.map((f) => f.replace(".js", ".html")), loaders,
    "a script emits data-roster buttons but its page does not load team-roster.js (or vice versa) — the two lists must be one set");
});

test("NC — a loader whose script stops emitting the button is caught, and the mutation lands", () => {
  const src = readWeb("assets/admin-registrations.js");
  const mutated = src.split('data-roster="').join('data-rosterZZ="');
  assert.notEqual(mutated, src, "the mutation did not land — admin-registrations.js never emits the button at all");
  assert.equal(mutated.includes('data-roster="'), false, "the needle survived the mutation — this control tests nothing");
});
