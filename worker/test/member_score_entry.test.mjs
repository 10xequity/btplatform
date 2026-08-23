/**
 * Boomtown Platform — §-1r RF-13 (score-entry half): a member reaches their team's scores
 * File: worker/test/member_score_entry.test.mjs · Version: v1.0 · Date: 2026-08-23 · Ships in: v0.185.0
 *
 * OWNER'S WORD (2026-08-23): "Score entry ... accessible through membership account and
 * tournament/league page." The per-team self-scoring token (teams.score_token) has always been the
 * credential for score.html?t=TOKEN — no login — but it was minted and handed out only by staff on
 * the Scoring Links page. RF-13 surfaces a team's OWN link to the signed-in member of that team:
 * /api/profile/teams now carries a per-team `score_url` for a LIVE event.
 *
 * TWO THINGS THIS PINS, because both are where it could go wrong:
 *   1. THE GATE IS DATE-DERIVED, NOT STATUS-ONLY. Nothing on the owner's path reliably sets
 *      events.status='in_progress' (the D-53 / RF-4b lesson — a status-only gate goes dark on a
 *      started-but-still-'published' event). So a team whose event has STARTED by date gets the
 *      link even while 'published'; an UPCOMING event gets none, and mints no token early.
 *   2. THE TOKEN IS A CREDENTIAL AND MUST NEVER GO PUBLIC. It is surfaced only on the authenticated
 *      own-team path, and must be absent from the public live board and the public schedule feed
 *      (kotcplay.js:824's warning, generalised).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const ORIGIN = "https://boomtown.test";
const SRC = readFileSync(new URL("../src/registrations.js", import.meta.url), "utf8");
const LG = readFileSync(new URL("../../web/assets/leagues.js", import.meta.url), "utf8");

function boot() {
  const DB = createD1(readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8"));
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
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

async function signIn(env, email) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  return { token: v.data.token, id: env.DB.one("SELECT id FROM users WHERE email = ?1", email).id };
}

/** A plain signed-in member — the first-account admin bootstrap burned on a throwaway first, so the
    member under test is not accidentally admin (the fixture note that has bitten this suite). */
async function member(env, email) {
  await signIn(env, "throwaway-staff@bt.test");
  return signIn(env, email);
}

/** Give the caller a contact and two teams: one on a STARTED event, one on an UPCOMING event. */
function seedTeams(env, userId) {
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (50, 1, ${userId}, 'cap@bt.test', 'Cap')`);
  // STARTED by date but still 'published' — the exact case a status-only gate would miss (RF-4b).
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status, starts_at) VALUES (200, 1, 'Summer 6s', 'tournament', 'published', '2020-06-01 09:00')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (300, 1, 200, 'Spikes', 50)`);
  // UPCOMING (clearly-future date so the test never rots) — no link, no token minted.
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status, starts_at) VALUES (201, 1, 'Winter 6s', 'league', 'published', '2099-01-01 09:00')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (301, 1, 201, 'Blockers', 50)`);
}

/* ═══════════ the account path ═══════════ */

test("RF-13: a started team on my account carries its own score link; an upcoming one does not", async () => {
  const env = boot();
  const me = await member(env, "cap@bt.test");
  seedTeams(env, me.id);

  const r = await call(env, "GET", "/api/profile/teams", { token: me.token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const byId = Object.fromEntries((r.data.teams || []).map((t) => [t.id, t]));

  assert.ok(byId[300], "the started team is missing from my teams");
  assert.match(String(byId[300].score_url || ""), /\/score\.html\?t=[0-9a-f]{16,}/,
    "a STARTED team must carry its own score link — a status-only gate would go dark on a still-'published' event (RF-4b)");
  assert.equal(byId[301] ? byId[301].score_url : "MISSING", null,
    "an UPCOMING event must surface no score link");

  // the mint happened for the started team, and ONLY that one — no credential is created early
  assert.ok(env.DB.one("SELECT score_token FROM teams WHERE id=300").score_token,
    "the started team's token was not minted");
  assert.equal(env.DB.one("SELECT score_token FROM teams WHERE id=301").score_token, null,
    "an upcoming team must not have a token minted before it starts");

  // the raw token field never ships as its own key — score_url carries it, own-team only
  assert.equal("score_token" in byId[300], false, "the raw score_token leaked as its own field");
});

test("RF-13: an in_progress event carries the link even with a future start date (status wins)", async () => {
  const env = boot();
  const me = await member(env, "cap@bt.test");
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (50, 1, ${me.id}, 'cap@bt.test', 'Cap')`);
  // status says live even though the date is in the future — the status path must still open scoring.
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status, starts_at) VALUES (210, 1, 'Now Cup', 'tournament', 'in_progress', '2099-01-01 09:00')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (310, 1, 210, 'Aces', 50)`);

  const r = await call(env, "GET", "/api/profile/teams", { token: me.token });
  const team = (r.data.teams || []).find((t) => t.id === 310);
  assert.ok(team, "the in_progress team is missing");
  assert.match(String(team.score_url || ""), /\/score\.html\?t=/,
    "an in_progress event must open score entry regardless of its start date");
});

/* ═══════════ the credential must never go public ═══════════ */

test("RF-13: the score token appears ONLY on the authenticated own-team path, never on a public feed", async () => {
  const env = boot();
  const me = await member(env, "cap@bt.test");
  seedTeams(env, me.id);
  const KNOWN = "deadbeefdeadbeef01";
  env.DB.exec(`UPDATE teams SET score_token='${KNOWN}' WHERE id=300`);

  const live = await call(env, "GET", "/api/live/events/200", {}); // no token — a wall display
  const sched = await call(env, "GET", "/api/schedule?view=public", {});
  assert.ok(!JSON.stringify(live.data).includes(KNOWN), "the PUBLIC live board leaked a team's score token");
  assert.ok(!JSON.stringify(live.data).includes("score_url"), "the PUBLIC live board must not carry score_url");
  assert.ok(!JSON.stringify(sched.data).includes(KNOWN), "the PUBLIC schedule feed leaked a team's score token");
  assert.ok(!JSON.stringify(sched.data).includes("score_url"), "the PUBLIC schedule feed must not carry score_url");

  const mine = await call(env, "GET", "/api/profile/teams", { token: me.token });
  assert.ok(JSON.stringify(mine.data).includes(KNOWN),
    "the member's OWN team lost its score link — the whole point of RF-13");
});

/* ═══════════ one mint, not two (consolidation) ═══════════ */

test("RF-13: one spelling mints the token — both staff links and the member path call ensureScoreToken", () => {
  const s = blankComments(SRC);
  assert.match(s, /async function ensureScoreToken\(env, team\)/, "the shared mint helper is gone");
  // both consumers call it; neither keeps its own inline getRandomValues mint of a score token
  const calls = (s.match(/ensureScoreToken\(env, /g) || []).length;
  assert.ok(calls >= 2, `ensureScoreToken has ${calls} call site(s); scoreLinks and myTeams make at least 2`);
  const myTeamsBody = s.slice(s.indexOf("async function myTeams"), s.indexOf("async function inviteTeammate"));
  assert.ok(myTeamsBody.includes("ensureScoreToken(env, t)"),
    "myTeams no longer mints through the shared helper — it grew a second spelling");
  assert.ok(!myTeamsBody.includes("getRandomValues"),
    "myTeams inlined its own token mint — that is the drift the helper exists to prevent");
});

/* ═══════════ the leagues 'tonight' banner surfaces it ═══════════ */

const tonightBody = (src) => {
  const t = blankComments(src);
  const at = t.indexOf("async function tonight");
  return at === -1 ? null : t.slice(at, t.indexOf("\n  }", at));
};

test("RF-13: the leagues 'tonight' banner offers the member their own team's score entry, conditionally", () => {
  const body = tonightBody(LG);
  assert.ok(body, "tonight() is gone or changed shape — update this extractor with it");
  assert.ok(body.includes("t.score_url"),
    "the banner no longer reads the team's score_url — the member cannot reach score entry from the league page");
  assert.ok(body.includes("lg-tn-score"), "the banner has no distinct score-entry action");
  // the action is a separate computed value, so a team with no link renders no action (not a dead
  // one); the server proves the gate discriminates (an upcoming team's score_url is null).
  assert.ok(body.includes("const scoreCta"),
    "the score action is not computed conditionally — an upcoming team (score_url null) would render a dead action");
});

test("NC: a banner that drops score_url renders no score action — the check has teeth", () => {
  const mutated = LG.replace(/t\.score_url/g, "t.__gone__");
  const body = tonightBody(mutated);
  assert.ok(body && !body.includes("t.score_url"),
    "the mutation did not land — update this NC to the current score_url reference");
});
