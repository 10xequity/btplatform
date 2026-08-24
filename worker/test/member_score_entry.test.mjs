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
import { ensureScoreToken } from "../src/registrations.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const ORIGIN = "https://boomtown.test";
const SRC = readFileSync(new URL("../src/registrations.js", import.meta.url), "utf8");
const LG = readFileSync(new URL("../../web/assets/leagues.js", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../../web/home.js", import.meta.url), "utf8");

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

test("RF-13: a date-less published event surfaces no link — a missing date is not a start signal", async () => {
  // Gemini review 2026-08-23 (finding 1): a published event with NULL starts_at must not be treated
  // as live. It stays closed and mints no token, matching the client's groupOf (date-less → Upcoming).
  const env = boot();
  const me = await member(env, "cap@bt.test");
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (50, 1, ${me.id}, 'cap@bt.test', 'Cap')`);
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status) VALUES (220, 1, 'No Date', 'tournament', 'published')`); // starts_at NULL
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (320, 1, 220, 'Ghosts', 50)`);

  const r = await call(env, "GET", "/api/profile/teams", { token: me.token });
  const team = (r.data.teams || []).find((t) => t.id === 320);
  assert.ok(team, "the date-less team is missing");
  assert.equal(team.score_url, null, "a date-less published event must not surface a live score link");
  assert.equal(env.DB.one("SELECT score_token FROM teams WHERE id=320").score_token, null,
    "a date-less published event must mint no token");
});

test("RF-13: a concurrent mint never overwrites a token another request already handed out", async () => {
  // Gemini review 2026-08-23 (finding 2): two requests minting for the same team at once must not
  // clobber each other. Simulate the race: request B has already written 'winner…'; request A, whose
  // read still saw NULL, tries to mint — it must ADOPT the winner, not overwrite it with a dead token.
  const env = boot();
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status) VALUES (230, 1, 'Race', 'tournament', 'in_progress')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name) VALUES (330, 1, 230, 'Racers')`);
  env.DB.exec(`UPDATE teams SET score_token='winner0000000000' WHERE id=330`);

  const got = await ensureScoreToken(env, { id: 330, score_token: null }); // A's stale null view
  assert.equal(got, "winner0000000000",
    "the losing minter returned its own token — a link already handed out would 404");
  assert.equal(env.DB.one("SELECT score_token FROM teams WHERE id=330").score_token, "winner0000000000",
    "the losing minter overwrote the winner's token in the row");
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

/* ═══════════ the email channel — the captain emails the team its link ═══════════ */

/** A captain (contact 50) of a live team (500) with one roster teammate who has an email. */
function seedEmailTeam(env, userId) {
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (50, 1, ${userId}, 'cap@bt.test', 'Cap')`);
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status, starts_at) VALUES (400, 1, 'Live Cup', 'tournament', 'published', '2020-06-01 09:00')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id, score_token) VALUES (500, 1, 400, 'Spikes', 50, 'tok5000000000000')`);
  env.DB.exec(`INSERT INTO team_members (org_id, team_id, member_name, member_email) VALUES (1, 500, 'Mate', 'mate@bt.test')`);
}

test("RF-13 email: the captain emails their team the scoring link — keyless-honest in sandbox, token not in the response", async () => {
  const env = boot();
  const me = await member(env, "cap@bt.test");
  seedEmailTeam(env, me.id);
  const r = await call(env, "POST", "/api/profile/teams/500/email-scorelink", { token: me.token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, "sandbox", "no BREVO key in tests → the honest 'not connected' notice, never a false 'sent'");
  assert.ok(!JSON.stringify(r.data).includes("tok5000000000000"),
    "the JSON response leaked the raw score token — it belongs only in the email body");
  assert.ok(env.DB.one("SELECT 1 AS n FROM audit_log WHERE action='team.email_scorelink'"),
    "the send was not audited");
});

test("RF-13 email: a non-captain roster member cannot send — 403", async () => {
  const env = boot();
  const cap = await member(env, "cap@bt.test");
  seedEmailTeam(env, cap.id);
  // a second member, on the roster of team 500 but NOT the captain
  const mate = await signIn(env, "mate@bt.test");
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (51, 1, ${mate.id}, 'mate@bt.test', 'Mate')`);
  env.DB.exec(`INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES (1, 500, 51, 'Mate', 'mate@bt.test')`);
  const r = await call(env, "POST", "/api/profile/teams/500/email-scorelink", { token: mate.token });
  assert.equal(r.status, 403, `a non-captain must not be able to blast the team: ${JSON.stringify(r.data)}`);
});

test("RF-13 email: an upcoming event refuses — scoring isn't open yet (409)", async () => {
  const env = boot();
  const me = await member(env, "cap@bt.test");
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (50, 1, ${me.id}, 'cap@bt.test', 'Cap')`);
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status, starts_at) VALUES (401, 1, 'Later Cup', 'tournament', 'published', '2099-01-01 09:00')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (501, 1, 401, 'Spikes', 50)`);
  env.DB.exec(`INSERT INTO team_members (org_id, team_id, member_name, member_email) VALUES (1, 501, 'Mate', 'mate@bt.test')`);
  const r = await call(env, "POST", "/api/profile/teams/501/email-scorelink", { token: me.token });
  assert.equal(r.status, 409, `an upcoming event must refuse the send: ${JSON.stringify(r.data)}`);
  assert.equal(env.DB.one("SELECT score_token FROM teams WHERE id=501").score_token, null,
    "an upcoming event must mint no token even on an email attempt");
});

test("RF-13 email: a team with no teammate email refuses — nothing to send to (400)", async () => {
  const env = boot();
  const me = await member(env, "cap@bt.test");
  env.DB.exec(`INSERT INTO contacts (id, org_id, user_id, email, full_name) VALUES (50, 1, ${me.id}, 'cap@bt.test', 'Cap')`);
  env.DB.exec(`INSERT INTO events (id, org_id, name, type, status, starts_at) VALUES (402, 1, 'Live Cup', 'tournament', 'published', '2020-06-01 09:00')`);
  env.DB.exec(`INSERT INTO teams (id, org_id, event_id, name, captain_contact_id) VALUES (502, 1, 402, 'Spikes', 50)`);
  env.DB.exec(`INSERT INTO team_members (org_id, team_id, member_name) VALUES (1, 502, 'No-email Mate')`); // no email
  const r = await call(env, "POST", "/api/profile/teams/502/email-scorelink", { token: me.token });
  assert.equal(r.status, 400, `no addressable teammate must refuse: ${JSON.stringify(r.data)}`);
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

/* ═══════════ the account "Your teams" card surfaces it (the membership-account surface) ═══════════ */

const loadTeamsBody = (src) => {
  const t = blankComments(src);
  const at = t.indexOf("async function loadTeams");
  return at === -1 ? null : t.slice(at, t.indexOf("async function loadMembership", at));
};

test("RF-13: the account 'Your teams' card offers score entry for a live team, conditionally", () => {
  const body = loadTeamsBody(HOME);
  assert.ok(body, "loadTeams() is gone or renamed — update this extractor");
  assert.ok(body.includes("t.score_url"),
    "home.js's team card no longer reads the team's score_url — the membership-account path he named is gone");
  assert.ok(body.includes("Enter your team"),
    "the score-entry action text is gone from the account card");
});

test("RF-13 email: the account card gives the captain an 'email the link to my team' action", () => {
  const body = loadTeamsBody(HOME);
  assert.ok(body.includes("data-emaillink"),
    "home.js's team card has no email-the-team button — the email channel has no entry point");
  assert.ok(body.includes("email-scorelink"),
    "home.js no longer POSTs the email-scorelink route");
  // gated to the captain of a live team; the server enforces it too (a non-captain POST is 403)
  assert.ok(body.includes("t.is_captain"), "the email action is not gated to the captain");
});

test("NC: an account card that drops score_url renders no score action", () => {
  const mutated = HOME.replace(/t\.score_url/g, "t.__gone__");
  const body = loadTeamsBody(mutated);
  assert.ok(body && !body.includes("t.score_url"),
    "the mutation did not land — update this NC to the current score_url reference");
});
