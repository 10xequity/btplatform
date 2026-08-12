/**
 * Boomtown Platform — §-1p WF-4 (§-0 B26): the registrations screen sees waivers, and can chase them
 * File: worker/test/registrations_waivers.test.mjs · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.136.0
 *
 * The owner's 2026-08-11 item 8: "Registration should check against signed waivers for each team.
 * And mark or flash waivers not completed and auto send waivers to them then also send email."
 * Measured HALF-BUILT: the checking and the auto-send EXIST — waiverReminderSweep selects rosters
 * with no live waiver via WAIVER_IDENTITY_MATCH + WAIVER_LIVE_PREDICATE (the door gate's own
 * pair), dedupes on a 2-day window, and reports email keyless-honestly. This unit SURFACES them:
 *
 *  · listRegistrations gains per-team waiver counts (waiver_members / waiver_signed /
 *    waiver_no_email) read through the SAME predicate pair — F-27's whole history is hand-rolled
 *    copies of this judgement drifting, so the source pin below forbids a second spelling.
 *  · POST /api/events/:id/waiver-reminders — a SECOND CALLER of the sweep's now-shared selection
 *    (waiverGaps) and sender: staff-gated, honest about the 2-day dedupe ("N already reminded"),
 *    honest about members with no address, and keyless-honest about email.
 *
 * THE FIXTURE EXHIBITS ALL THREE MEMBER STATES (signed / unsigned-with-email / unsigned-no-email)
 * plus a team-less SG-1-style registration — without them the aggregation tests go vacuous.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

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
  const v = await call(env, "POST", "/api/auth/verify", {
    body: { token: String(asked.data.dev_link).split("token=")[1] },
  });
  return v.data.token;
}

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec(`INSERT INTO events (id, org_id, type, name, starts_at, status) VALUES
    (70,1,'tournament','Waiver Cup',datetime('now','+3 days'),'published')`);
  DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES
    (950,1,'signed@bt.test','Sig Ned'),
    (951,1,'solo@bt.test','So Lo')`);
  // One team, three member states: signed (via contact 950), unsigned WITH an address,
  // unsigned with NO address. The aggregation has something to count in every column.
  DB.exec("INSERT INTO teams (id, org_id, event_id, name) VALUES (700,1,70,'Mixed Bag')");
  DB.exec(`INSERT INTO team_members (org_id, team_id, contact_id, member_name, member_email) VALUES
    (1,700,950,'Sig Ned','signed@bt.test'),
    (1,700,NULL,'Un Signed','unsigned@bt.test'),
    (1,700,NULL,'No Address',NULL)`);
  DB.exec(`INSERT INTO waivers (org_id, contact_id, signed_at, expires_at, signature_name) VALUES
    (1,950,datetime('now'),datetime('now','+300 days'),'Sig Ned')`);
  DB.exec(`INSERT INTO registrations (id, org_id, event_id, contact_id, team_id, status) VALUES
    (7001,1,70,950,700,'paid'),
    (7002,1,70,951,NULL,'comped')`); // team-less: an SG-1 sheet sign-up, no waiver
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

const reminders = (env) =>
  env.DB.query("SELECT contact_id, target, payload_json FROM notifications WHERE kind='waiver_reminder' ORDER BY id");

/* ==================== the fixture can exhibit the defect ==================== */

test("PRE-FIX CHECK — the fixture carries all three member states and the team-less row", () => {
  const env = boot();
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM team_members WHERE team_id=700 AND deleted_at IS NULL").n, 3);
  assert.equal(env.DB.query("SELECT 1 AS x FROM waivers WHERE contact_id=950 AND expires_at > datetime('now')").length, 1,
    "the signed member lost their live waiver — the signed column would be untestable");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM team_members WHERE team_id=700 AND member_email IS NULL").n, 1,
    "the no-address member is gone — the unreachable column would be untestable");
  assert.equal(env.DB.one("SELECT team_id FROM registrations WHERE id=7002").team_id, null,
    "the team-less registration gained a team — the SG-1 aggregation branch would be untestable");
  env.DB.close();
});

/* ==================== (a) the list carries per-team waiver counts ==================== */

test("the registrations list counts waivers per team through the door gate's own predicate", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test"); // first account bootstraps admin (fixture rule)
  const r = await call(env, "GET", "/api/events/70/registrations", { token: staff });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const team = r.data.registrations.find((x) => x.id === 7001);
  const solo = r.data.registrations.find((x) => x.id === 7002);
  assert.ok(team && solo, "the fixture rows did not come back");

  assert.equal(team.waiver_members, 3, "the team has three members");
  assert.equal(team.waiver_signed, 1, "exactly one member holds a live waiver");
  assert.equal(team.waiver_no_email, 1, "exactly one unsigned member has no address to chase");

  // The team-less SG-1 row aggregates over its own registrant: one person, no waiver.
  assert.equal(solo.waiver_members, 1);
  assert.equal(solo.waiver_signed, 0);

  // NEGATIVE CONTROL — mutate the real input: the unsigned member signs. The count must move
  // through the SAME judgement (identity by email, case-insensitive — F-26's exact shape).
  env.DB.exec("INSERT INTO contacts (id, org_id, email, full_name) VALUES (952,1,'UNSIGNED@bt.test','Un Signed')");
  env.DB.exec("INSERT INTO waivers (org_id, contact_id, signed_at, expires_at, signature_name) VALUES (1,952,datetime('now'),datetime('now','+300 days'),'Un Signed')");
  assert.equal(env.DB.query("SELECT 1 AS x FROM waivers WHERE contact_id=952").length, 1, "the mutation did not land");
  const after = await call(env, "GET", "/api/events/70/registrations", { token: staff });
  assert.equal(after.data.registrations.find((x) => x.id === 7001).waiver_signed, 2,
    "a waiver signed under a case-variant email did not move the count — a second, drifted predicate");
  env.DB.close();
});

test("an EXPIRED waiver counts as unsigned — liveness is the door's rule, not mere existence", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test");
  env.DB.exec("UPDATE waivers SET expires_at = datetime('now','-1 day') WHERE contact_id=950");
  assert.ok(env.DB.one("SELECT expires_at < datetime('now') AS lapsed FROM waivers WHERE contact_id=950").lapsed,
    "the mutation did not land");
  const r = await call(env, "GET", "/api/events/70/registrations", { token: staff });
  assert.equal(r.data.registrations.find((x) => x.id === 7001).waiver_signed, 0,
    "a lapsed waiver still counted as signed — the chips and the door would disagree");
  env.DB.close();
});

/* ==================== (b) send-now: a second caller, honest three ways ==================== */

test("send-now notifies the reachable unsigned, counts the unreachable, and is honest about email", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test");
  const r = await call(env, "POST", "/api/events/70/waiver-reminders", { token: staff });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.notified, 1, "exactly one member is unsigned AND reachable (Un Signed)");
  assert.equal(r.data.no_email, 1, "the no-address member must be COUNTED, not silently skipped");
  assert.equal(r.data.recently_reminded, 0);
  assert.equal(r.data.emailed, 0, "the suite runs keyless — claiming an email was sent is the lie this repo hunts");
  assert.match(r.data.note, /nothing was emailed/i, "no mail key is set and the note does not say so");
  assert.match(r.data.note, /no email address/i, "the unreachable member deserves a sentence, not silence");

  const rows = reminders(env);
  assert.equal(rows.length, 1, "one in-app reminder row for the one reachable unsigned member");
  assert.match(rows[0].payload_json, /unsigned@bt\.test/);
  env.DB.close();
});

test("the 2-day dedupe holds for the on-demand caller too — a double press does not double-nag", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test");
  await call(env, "POST", "/api/events/70/waiver-reminders", { token: staff });
  const again = await call(env, "POST", "/api/events/70/waiver-reminders", { token: staff });
  assert.equal(again.status, 200);
  assert.equal(again.data.notified, 0, "the second press re-notified — the sweep's dedupe must bind both callers");
  assert.equal(again.data.recently_reminded, 1, "the skipped member must be reported, not vanished");
  assert.equal(reminders(env).length, 1, "a second notification row was written despite the dedupe");
  env.DB.close();
});

test("send-now is staff-gated — it exposes and acts on waiver state", async () => {
  const env = boot();
  await signIn(env, "throwaway@bt.test"); // burn the auto-admin first account
  const member = await signIn(env, "member@bt.test");
  const r = await call(env, "POST", "/api/events/70/waiver-reminders", { token: member });
  assert.ok(r.status === 401 || r.status === 403, `a plain member triggered waiver reminders (got ${r.status})`);
  assert.equal(reminders(env).length, 0, "the refused call still wrote notification rows");
  env.DB.close();
});

test("the SWEEP still works through the shared selection — same rows, same dedupe, keyless-honest", async () => {
  const env = boot();
  const { waiverReminderSweep } = await import("../src/registrations.js");
  const first = await waiverReminderSweep(env);
  assert.equal(first.due, 1, "the sweep should find exactly the reachable unsigned member");
  assert.equal(first.emailed, 0, "keyless — the sweep must not claim an email it did not send");
  assert.equal(reminders(env).length, 1);
  const second = await waiverReminderSweep(env);
  assert.equal(second.due, 0, "the sweep re-nagged inside its own 2-day window");
  env.DB.close();
});

/* ==================== the ONE-judgement source pin ==================== */

test("every WAIVER read in registrations.js goes through the canonical pair — no second spelling", () => {
  // Scoped to the waiver-reading functions, NOT the whole file: registrations.js has other
  // LAWFUL c.email compares (find-or-create against caller-lowercased input) — the original
  // F-27 guard scoped itself to the sweep body for exactly this reason, and this guard's own
  // first draft reddened against correct code by scanning wide.
  const src = readFileSync(new URL("../src/registrations.js", import.meta.url), "utf8");
  for (const name of ["waiverGaps", "listRegistrations", "sendEventWaiverReminders"]) {
    const anchor = `function ${name}(`;
    assert.equal(src.split(anchor).length - 1, 1, `"${anchor}" is not unique — re-anchor (the iteration-62 rule)`);
    const start = src.indexOf(anchor);
    const end = src.indexOf("\nasync function", start + 1);
    const fn = src.slice(start, end > -1 ? end : undefined);
    if (name !== "sendEventWaiverReminders") {
      assert.ok(fn.includes("WAIVER_IDENTITY_MATCH") && fn.includes("WAIVER_LIVE_PREDICATE"),
        `${name} does not build its waiver check from the canonical pair`);
    }
    // The exact drift shape F-26/F-27 record: a bare case-sensitive contacts-email compare.
    assert.equal(/c\.email\s*=[^=]/.test(fn.replace(/lower\(c\.email\)/g, "SAFE")), false,
      `${name} carries a raw c.email compare outside lower() — the drifted-copy defect returning`);
  }
  // Positive control: the detector fires on the defect shape it exists for.
  assert.ok(/c\.email\s*=[^=]/.test("WHERE c.email = tm.member_email"),
    "the bare-compare detector cannot fail — re-point it");
});
