/**
 * Boomtown Platform — §-1j T2-3 + T2-4b + T2-1d: three measured scheduler-UX fixes
 * File: worker/test/scheduler_ux.test.mjs · Version: v1.0 · Date: 2026-08-10 · Ships in: v0.122.0
 *
 * T2-3 — "we need captains in addition to teams; sometimes team names make it very hard to
 * determine who the captain is." The team feeds selected `id, name` only. Captains now ride
 * along — but the two feeds are NOT equally protected, and that is the whole point of these
 * tests: `/api/admin/events/:id/schedule` is requireStaff-gated, while
 * `/api/events/:id/teams` and `/api/events/:id/schedule` carry NO gate at all. So the staff feed
 * may name a captain in full, and the ungated feed must honour the member's own visibility —
 * "First L." unless they chose public. `CAPTAIN_COLS` returns `captain_visibility` precisely so
 * this decision is made from the member's setting rather than from the caller's convenience.
 *
 * T2-4b — the score sheet capped the point differential at 15 (`Math.min(m.points_to, 15)`)
 * while the server has never had a cap. A 21-point game won 21-0 could not be recorded. The
 * league dialog already solved this: chips for the common cases plus a numeric box bounded by
 * points_to. Same shape here.
 *
 * T2-1d — "when more than 3 or 4 nets are used the names are unreadable." Horizontal scrolling
 * already worked; the real defect is a NAME COLLISION. `.ed-side` styled BOTH the team-name
 * spans inside a 62px match tile AND the fairness aside — so every team name inherited the
 * panel's `padding: 12px`, border, and `position: sticky`, and under 900px the panel's
 * `order: -1` applied to both spans inside a 3-column grid, pushing the "v" separator to the
 * end. The aside takes `ed-side-panel` (a class the stylesheet already named and nothing used).
 * The guard asserts the separation AND that the panel class still has rules — a rename that
 * leaves the panel unstyled would be v0.116.0's `bt-back` defect in reverse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";
const WEB = new URL("../../web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), "utf8");

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (5,1,'tournament','Summer Open','published',4)");
  // Two captains: one who kept the default visibility, one who chose public.
  DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (900,1,'ava@bt.test','Ava Stone'),(901,1,'ben@bt.test','Ben Marsh')");
  DB.exec("INSERT INTO member_profiles (org_id, contact_id, visibility) VALUES (1,900,'members'),(1,901,'public')");
  DB.exec("INSERT INTO teams (id, org_id, event_id, name, captain_contact_id, seed) VALUES (10,1,5,'Net Assets',900,1),(11,1,5,'Block Party',901,2)");
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staffToken(env) {
  const asked = await call(env, "POST", "/api/auth/request-link?e=1");
  void asked;
  const r = await worker.fetch(new Request(`${ORIGIN}/api/auth/request-link`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" },
    body: JSON.stringify({ email: "boss@bt.test" }),
  }), env);
  const link = (await r.json()).dev_link;
  const tok = String(link).split("token=")[1];
  const v = await worker.fetch(new Request(`${ORIGIN}/api/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" },
    body: JSON.stringify({ token: tok }),
  }), env);
  const session = (await v.json()).token;
  const u = env.DB.one("SELECT id FROM users WHERE email = 'boss@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return session;
}

/* ---------------- T2-3: captains, and who is allowed to read them in full ---------------- */

test("T2-3 — the STAFF-gated schedule feed names the captain in full", async () => {
  const env = boot();
  const token = await staffToken(env);
  const r = await call(env, "GET", "/api/admin/events/5/schedule", { token });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const team = (r.data.teams || []).find((t) => t.id === 10);
  assert.ok(team, "the staff feed no longer returns team 10");
  assert.equal(team.captain, "Ava Stone",
    "a staff surface must name the captain in full — that is the point of showing them at all");
  env.DB.close();
});

test("T2-3 PRIVACY — the UNGATED team feed honours the member's own visibility, never the caller's convenience", async () => {
  const env = boot();
  // No token: /api/events/:id/teams carries no staff gate, so this is the public shape.
  const r = await call(env, "GET", "/api/events/5/teams");
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const byId = Object.fromEntries((r.data.teams || []).map((t) => [t.id, t]));

  assert.equal(byId[10].captain, "Ava S.",
    "a captain who kept the default visibility was published in full on an UNGATED route");
  assert.equal(byId[11].captain, "Ben Marsh",
    "a captain who chose public visibility must still read in full — the setting is theirs to make");

  // NC: flip the real input and prove the abbreviation follows the SETTING, not a hardcoded rule.
  env.DB.exec("UPDATE member_profiles SET visibility='public' WHERE contact_id=900");
  assert.equal(env.DB.one("SELECT visibility FROM member_profiles WHERE contact_id=900").visibility, "public",
    "mutation did not land");
  const again = await call(env, "GET", "/api/events/5/teams");
  assert.equal(again.data.teams.find((t) => t.id === 10).captain, "Ava Stone",
    "visibility was raised to public and the name stayed abbreviated — the feed is not reading the setting");
  env.DB.close();
});

test("T2-3 — a team with no captain reports null, not an empty string or the word undefined", async () => {
  const env = boot();
  env.DB.exec("INSERT INTO teams (id, org_id, event_id, name, seed) VALUES (12,1,5,'No Captain FC',3)");
  const r = await call(env, "GET", "/api/events/5/teams");
  const team = r.data.teams.find((t) => t.id === 12);
  assert.equal(team.captain, null, "a captainless team must say so with null — the screen decides how to render absence");
  env.DB.close();
});

/* ---------------- T2-4b: the differential entry ---------------- */

test("T2-4b — the score sheet offers chips AND a numeric box bounded by points_to", () => {
  const js = blankComments(read("assets/tournament.js"));
  assert.doesNotMatch(js, /Math\.min\(m\.points_to,\s*15\)/,
    "the 15-point cap survives — a 21-0 game still cannot be recorded");
  assert.match(js, /id="diffCustom"[^>]*max="\$\{m\.points_to\}"/,
    "no numeric entry bounded by points_to — the league dialog's shape is the target");
  assert.match(js, /diff-chip/, "the quick chips are gone — the two-tap path is the common case and must stay");
});

test("T2-4b NC — restoring the cap into the REAL source makes the checker fire", () => {
  const js = blankComments(read("assets/tournament.js"));
  const mutated = js.replace(/Array\.from\(\{ length: [^}]*\}/, "Array.from({ length: Math.min(m.points_to, 15) }");
  assert.notEqual(mutated, js, "mutation did not land — the diff row was not rewritten");
  assert.match(mutated, /Math\.min\(m\.points_to,\s*15\)/,
    "the mutated source does not carry the cap — this NC asserts nothing");
});

/* ---------------- T2-1d: the class collision ---------------- */

test("T2-1d — the tile-span class and the panel class are separated, and BOTH still have rules", () => {
  const page = read("admin-schedule-editor.html");
  // blankComments FIRST: the fix's own comment explains the collision and names .ed-side, so an
  // uncommented scan reads that prose as a selector and fails on the explanation of the fix.
  // (The repo's standing rule, paid for again here: the prose you add joins the corpus.)
  const styles = blankComments(
    [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));

  // The aside is the panel.
  assert.match(page, /<aside class="ed-side-panel"/,
    "the fairness aside still carries ed-side — the panel's padding, border and sticky position leak onto every team-name span");
  // Panel rules must not also target the span class.
  const panelRules = styles.match(/[^{}]*\.ed-side-panel[^{}]*\{[^}]*\}/g) || [];
  assert.ok(panelRules.length >= 1, "the panel class has no rules at all — the rename left it unstyled (bt-back in reverse)");
  for (const rule of panelRules) {
    assert.doesNotMatch(rule.split("{")[0], /\.ed-side(?![\w-])/,
      "a panel rule still names .ed-side, so tile spans keep inheriting panel styling: " + rule.split("{")[0].trim());
  }
  // The span class keeps its own (text) rules.
  assert.match(styles, /\.ed-side(?![\w-])[^{}]*\{[^}]*text-overflow/,
    "the team-name spans lost their ellipsis rule — long names will now overflow the tile");
  // The JS still uses the span class, so the two lists agree on who owns what.
  assert.match(blankComments(read("assets/admin-schedule-editor.js")), /class="ed-side"/,
    "the tile template no longer uses ed-side — the span rules are now dead");
});

test("T2-1d NC — putting .ed-side back into the panel selector makes the checker fire", () => {
  const page = read("admin-schedule-editor.html");
  const styles = blankComments(
    [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));
  const mutated = styles.replace(/\.ed-side-panel(?![\w-])/, ".ed-side-panel, .ed-side");
  assert.notEqual(mutated, styles, "mutation did not land — no panel selector was widened");

  const panelRules = mutated.match(/[^{}]*\.ed-side-panel[^{}]*\{[^}]*\}/g) || [];
  const leaked = panelRules.some((rule) => /\.ed-side(?![\w-])/.test(rule.split("{")[0]));
  assert.ok(leaked, "the widened selector was not detected — the real assertion above proves nothing");
});
