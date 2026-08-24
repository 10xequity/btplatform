/**
 * Boomtown Platform — §-0 B18 / SG-1: the drop-in sheet (§-1o, owner "sheets first" 2026-08-11)
 * File: worker/test/signup_sheet.test.mjs · Version: v1.1 · Date: 2026-08-24 · Ships in: v0.132.0
 * v1.1 (D-45 cluster 2, v0.191.0): the five raw source reads (registrations, waitlists, sheet.js,
 * config.js, and the caller loop) now go through blankComments, so a commented-out source fails
 * these guards instead of passing them. Verified by raw-source-sweep: 5 → 0 raw pairs.
 *
 * An event of type training/event gets a PUBLIC sign-up sheet: capacity, live count, who is
 * coming, one-tap sign-up for a signed-in member, name+email form for a guest. Individual
 * sign-ups ARE registrations (team_id NULL, waiver_id NULL — both nullable since migration
 * 0001), so the count, the staff list, cancel-and-notify (SG-2's substrate) and the waitlist
 * all read the same rows with zero new plumbing.
 *
 * THE RULES, EACH PINNED:
 *  · The sheet is a NO-LOGIN surface (standards §8): names render "First L." via personName
 *    unless the member chose public visibility; NO email/phone/full_name/contact_id keys
 *    anywhere in the payload — asserted by a recursive walker that is itself POSITIVE-
 *    CONTROLLED against the staff list payload (which lawfully carries emails).
 *  · The count reads the registration flow's OWN predicate (activeRegistrationCount /
 *    computeIsFull, ACTIVE_REG_STATUSES now exported from waitlists.js — no third copy).
 *  · The guest path follows D-13: junk email is NO address (400, nothing stored, ever);
 *    dedupe is by lowercased email; a sheet sign-up never clobbers an existing contact name.
 *  · Free completes as 'comped'; priced returns the EXISTING payment flow's shape (pending +
 *    checkout/sandbox), never a silent free registration (§-1m Q5 rider).
 *  · A session identifies the caller: a body email on a signed-in tap is IGNORED — registering
 *    someone else via the sheet is not expressible, not merely refused.
 *  · No DOB / no age gate on the sheet — same exposure class as the public waitlist join
 *    (name+email, no DOB) and the 18+ community gate is LFG/subs-only; the check-in door gate
 *    remains the waiver/liability enforcement point. Stated here so it reads as a decision.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

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
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
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
  DB.exec(`INSERT INTO events (id, org_id, type, name, starts_at, status, capacity, price_cents) VALUES
    (60,1,'training','Tuesday Skills Drop-in',datetime('now','+3 days'),'published',3,NULL),
    (61,1,'event','Saturday Open Play',datetime('now','+5 days'),'published',NULL,1500),
    (62,1,'tournament','Fall Classic',datetime('now','+14 days'),'published',20,5000),
    (63,1,'training','Draft Session',datetime('now','+4 days'),'draft',10,NULL)`);
  DB.exec(`INSERT INTO contacts (id, org_id, email, full_name) VALUES
    (910,1,'ava@bt.test','Ava Stone'),
    (911,1,'pub@bt.test','Paula Barnes')`);
  DB.exec("INSERT INTO contacts (id, org_id, email) VALUES (912,1,'cam@bt.test')"); // NO name — the 'Guest' shape
  DB.exec("INSERT INTO member_profiles (org_id, contact_id, visibility) VALUES (1,911,'public')");
  DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES
    (1,60,910,'paid'),
    (1,60,911,'paid'),
    (1,60,912,'cancelled'),
    (1,61,912,'paid')`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

/* The privacy walker: every key and every string value in a public payload, recursively.
   FORBIDDEN keys are the §8 leak classes; an email-SHAPED value is forbidden regardless of key. */
const FORBIDDEN_KEYS = ["email", "phone", "full_name", "contact_id"];
function offendingPaths(node, path = "$", out = []) {
  if (Array.isArray(node)) node.forEach((v, i) => offendingPaths(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.some((f) => k.toLowerCase().includes(f))) out.push(`${path}.${k}`);
      offendingPaths(v, `${path}.${k}`, out);
    }
  } else if (typeof node === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(node)) {
    out.push(`${path} = "${node}"`);
  }
  return out;
}

/* ==================== the fixture can exhibit the defect ==================== */

test("PRE-FIX CHECK — the fixture carries every shape the guards below need", () => {
  const env = boot();
  assert.equal(env.DB.query(
    "SELECT COUNT(*) AS n FROM registrations WHERE event_id=60 AND status IN ('pending','email-sent','paid','cash-pending','comped')")[0].n,
    2, "event 60 lost its two active registrations — the count tests would go vacuous");
  assert.equal(env.DB.query("SELECT 1 AS x FROM registrations WHERE event_id=60 AND status='cancelled'").length, 1,
    "event 60 lost its cancelled registration — the active-only rule would be untestable");
  assert.equal(env.DB.one("SELECT visibility FROM member_profiles WHERE contact_id=911").visibility, "public",
    "contact 911 lost public visibility — the full-name-by-choice rule would be untestable");
  assert.ok(env.DB.one("SELECT full_name FROM contacts WHERE id=910").full_name.includes(" "),
    "contact 910's name has no surname — abbreviation would be unobservable");
  assert.equal(env.DB.one("SELECT price_cents FROM events WHERE id=61").price_cents, 1500,
    "event 61 lost its price — the free/priced fork would be untestable");
  assert.equal(env.DB.one("SELECT full_name FROM contacts WHERE id=912").full_name, null,
    "contact 912 gained a name — the Guest label would be untestable");
  env.DB.close();
});

/* ==================== the public sheet payload (standards §8) ==================== */

test("the sheet is public, counts with the registration flow's predicate, and abbreviates names", async () => {
  const env = boot();
  const r = await call(env, "GET", "/api/events/60/sheet");
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.event.name, "Tuesday Skills Drop-in");
  assert.equal(r.data.event.capacity, 3);
  assert.equal(r.data.event.spots_taken, 2, "cancelled registrations must not count");
  assert.equal(r.data.event.is_full, false);
  assert.deepEqual(r.data.attendees, ["Ava S.", "Paula Barnes"],
    "expected First L. for Ava (default visibility) and the full name for Paula (chose public)");
  assert.ok(!("viewer" in r.data), "an anonymous GET must not carry a viewer key");
  env.DB.close();
});

test("NO email/phone/full_name/contact_id anywhere in the sheet payload — and the walker is positive-controlled", async () => {
  const env = boot();
  const sheet = await call(env, "GET", "/api/events/60/sheet");
  assert.equal(sheet.status, 200, "a 404 error payload would pass the walk vacuously — the sheet must exist first");
  const raw = JSON.stringify(sheet.data);
  assert.ok(!raw.includes("Stone"), "Ava's surname leaked into the public payload");
  assert.deepEqual(offendingPaths(sheet.data), [],
    "the public sheet payload carries a forbidden key or an email-shaped value");

  // POSITIVE CONTROL — the walker must be able to fail. The staff list lawfully carries emails;
  // if the walker cannot find them there, every clean report above is vacuous.
  const staff = await signIn(env, "staff@bt.test"); // first account bootstraps admin (fixture rule)
  const list = await call(env, "GET", "/api/events/60/registrations", { token: staff });
  assert.equal(list.status, 200);
  assert.ok(offendingPaths(list.data).length > 0,
    "the walker found nothing in the staff payload that carries real emails — the walker itself is broken");
  env.DB.close();
});

test("visibility is the member's choice, both directions — the mutation lands before it is read", async () => {
  const env = boot();
  env.DB.exec("UPDATE member_profiles SET visibility='members' WHERE contact_id=911");
  assert.equal(env.DB.one("SELECT visibility FROM member_profiles WHERE contact_id=911").visibility, "members",
    "the mutation did not land");
  let r = await call(env, "GET", "/api/events/60/sheet");
  assert.ok(r.data.attendees.includes("Paula B."), "withdrawing public visibility must re-abbreviate the name");

  env.DB.exec("UPDATE member_profiles SET visibility='public' WHERE contact_id=911");
  r = await call(env, "GET", "/api/events/60/sheet");
  assert.ok(r.data.attendees.includes("Paula Barnes"), "restoring public visibility must restore the full name");
  env.DB.close();
});

test("a nameless contact renders as 'Guest', never as an email local part", async () => {
  const env = boot();
  const r = await call(env, "GET", "/api/events/61/sheet");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.attendees, ["Guest"], "contact 912 has no name — 'cam' (the local part) would be a soft leak");
  env.DB.close();
});

test("only training/event types get a sheet; drafts and missing events do not", async () => {
  const env = boot();
  assert.equal((await call(env, "GET", "/api/events/60/sheet")).status, 200,
    "the happy path must exist, or every refusal below passes vacuously (all routes 404 pre-fix)");
  assert.equal((await call(env, "GET", "/api/events/62/sheet")).status, 404, "a tournament has no drop-in sheet");
  assert.equal((await call(env, "GET", "/api/events/63/sheet")).status, 404, "a draft is not public");
  assert.equal((await call(env, "GET", "/api/events/999/sheet")).status, 404);
  assert.equal((await call(env, "POST", "/api/events/62/signup", { body: { name: "X Y", email: "x@y.test" } })).status, 404,
    "the sign-up write must be gated by the same type rule as the sheet read");
  assert.equal((await call(env, "POST", "/api/events/63/signup", { body: { name: "X Y", email: "x@y.test" } })).status, 404);
  env.DB.close();
});

/* ==================== the guest path (D-13 discipline) ==================== */

test("a guest signs up with name+email: free completes as 'comped', individually (no team, no waiver)", async () => {
  const env = boot();
  const r = await call(env, "POST", "/api/events/60/signup", {
    body: { name: "Gary Oldman", email: "Gary@Guest.TEST" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.ok, true);
  assert.equal(r.data.status, "comped", "a free session must complete instantly, no payment step");

  const row = env.DB.one(
    "SELECT r.team_id, r.waiver_id, r.payment_method, c.email, c.full_name FROM registrations r JOIN contacts c ON c.id=r.contact_id WHERE r.event_id=60 AND c.email='gary@guest.test'");
  assert.ok(row, "no registration row was written for the guest");
  assert.equal(row.team_id, null, "a drop-in sign-up is individual — no team row");
  assert.equal(row.waiver_id, null, "the sheet takes no signature — the check-in door gate owns waivers");
  assert.equal(row.payment_method, "comp");
  assert.equal(row.email, "gary@guest.test", "the address must be stored lowercased (writer convention)");

  const sheet = await call(env, "GET", "/api/events/60/sheet");
  assert.equal(sheet.data.event.spots_taken, 3);
  assert.equal(sheet.data.event.is_full, true, "3 of 3 — the sheet must say full from the same predicate");
  assert.ok(sheet.data.attendees.includes("Gary O."));
  env.DB.close();
});

test("junk email is NO address: refused, and NOTHING is stored", async () => {
  const env = boot();
  const before = {
    contacts: env.DB.one("SELECT COUNT(*) AS n FROM contacts").n,
    regs: env.DB.one("SELECT COUNT(*) AS n FROM registrations").n,
  };
  for (const body of [
    { name: "Junk Case", email: "not-an-email" },
    { name: "Junk Case", email: "" },
    { name: "Junk Case" },
    { email: "valid@x.test" }, // a guest needs a name — the public list cannot invent one
  ]) {
    const r = await call(env, "POST", "/api/events/60/signup", { body });
    assert.equal(r.status, 400, `expected refusal for ${JSON.stringify(body)}, got ${r.status}`);
  }
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM contacts").n, before.contacts, "a refused sign-up wrote a contact");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM registrations").n, before.regs, "a refused sign-up wrote a registration");
  env.DB.close();
});

test("the honeypot pretends success and stores nothing (signup-widget idiom)", async () => {
  const env = boot();
  const before = env.DB.one("SELECT COUNT(*) AS n FROM registrations").n;
  const r = await call(env, "POST", "/api/events/60/signup", {
    body: { name: "Bot Bot", email: "bot@spam.test", hp: "filled-by-a-bot" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true, "a bot must see success, not a signal it was detected");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM registrations").n, before, "the honeypot stored a registration");
  assert.equal(env.DB.query("SELECT 1 AS x FROM contacts WHERE email='bot@spam.test'").length, 0, "the honeypot stored a contact");
  env.DB.close();
});

test("dedupe is by lowercased email, and a sheet sign-up never clobbers an existing contact name", async () => {
  const env = boot();
  await call(env, "POST", "/api/events/60/signup", { body: { name: "Gary Oldman", email: "gary@guest.test" } });
  const again = await call(env, "POST", "/api/events/60/signup", { body: { name: "Gary Impostor", email: "GARY@GUEST.test" } });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true, "the same address (any case) is the same person mid-flow");

  assert.equal(env.DB.one(
    "SELECT COUNT(*) AS n FROM registrations r JOIN contacts c ON c.id=r.contact_id WHERE r.event_id=60 AND lower(c.email)='gary@guest.test'").n,
    1, "the duplicate tap wrote a second registration");
  assert.equal(env.DB.one("SELECT COUNT(*) AS n FROM contacts WHERE lower(email)='gary@guest.test'").n, 1,
    "the case variant minted a second contact");
  assert.equal(env.DB.one("SELECT full_name FROM contacts WHERE lower(email)='gary@guest.test'").full_name, "Gary Oldman",
    "the sheet clobbered a stored contact name — fill-if-empty only");
  env.DB.close();
});

test("FULL refuses with the waitlist pointer — and un-cancelling frees the spot through the same predicate", async () => {
  const env = boot();
  await call(env, "POST", "/api/events/60/signup", { body: { name: "Gary Oldman", email: "gary@guest.test" } }); // 3/3
  const refused = await call(env, "POST", "/api/events/60/signup", { body: { name: "Nora Late", email: "nora@late.test" } });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.event_full, true);
  assert.equal(refused.data.waitlist_available, true, "the refusal must point at the waitlist, not a dead end");

  // NEGATIVE CONTROL — mutate the real input: cancel one active registration, assert it landed.
  env.DB.exec("UPDATE registrations SET status='cancelled' WHERE event_id=60 AND contact_id=910");
  assert.equal(env.DB.one("SELECT status FROM registrations WHERE event_id=60 AND contact_id=910").status, "cancelled",
    "the mutation did not land");
  const sheet = await call(env, "GET", "/api/events/60/sheet");
  assert.equal(sheet.data.event.spots_taken, 2, "the freed spot is invisible — two counts from two judgements");
  const retry = await call(env, "POST", "/api/events/60/signup", { body: { name: "Nora Late", email: "nora@late.test" } });
  assert.equal(retry.status, 200, "the freed spot must be claimable through the same gate that refused");
  env.DB.close();
});

/* ==================== the free/priced fork (§-1m Q5 rider) ==================== */

test("a PRICED sheet returns the existing payment flow's shape — never a silent free registration", async () => {
  const env = boot();
  const r = await call(env, "POST", "/api/events/61/signup", { body: { name: "Pay Er", email: "payer@x.test" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.ok, true);
  assert.notEqual(r.data.status, "comped", "a priced event completed as free — the exact failure the Q5 rider names");
  assert.equal(r.data.status, "pending");
  assert.equal(r.data.mode, "sandbox", "keyless Square must say so (the suite runs keyless by design)");
  assert.ok(!/free/i.test(r.data.message || ""), "the message claims free on a priced event");

  const row = env.DB.one(
    "SELECT r.status, r.payment_method, r.price_cents FROM registrations r JOIN contacts c ON c.id=r.contact_id WHERE r.event_id=61 AND c.email='payer@x.test'");
  assert.equal(row.status, "pending");
  assert.equal(row.payment_method, "square");
  assert.equal(row.price_cents, 1500, "the quoted price must be written to the row (F-6 discipline)");
  env.DB.close();
});

test("unlimited capacity means unlimited — and the flood band still bounds a burst (publicSignup idiom)", async () => {
  const env = boot();
  for (let i = 0; i < 2; i++) {
    const r = await call(env, "POST", "/api/events/61/signup", { body: { name: `Open P${i}`, email: `open${i}@x.test` } });
    assert.equal(r.status, 200, "NULL capacity refused a sign-up");
  }
  // 30 recent registrations on the event → the band closes.
  for (let i = 0; i < 30; i++) {
    env.DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES (1,61,912,'comped')`);
  }
  const r = await call(env, "POST", "/api/events/61/signup", { body: { name: "Flood Er", email: "flood@x.test" } });
  assert.equal(r.status, 429, "30 sign-ups in the window did not close the band");
  env.DB.close();
});

/* ==================== the signed-in one-tap ==================== */

test("one tap: the session identifies the member; the name resolves contact → display name; a body email is IGNORED", async () => {
  const env = boot();
  await signIn(env, "throwaway@bt.test"); // first account bootstraps admin everywhere — burn it
  const dee = await signIn(env, "dee@bt.test");
  await call(env, "PATCH", "/api/me", { token: dee, body: { display_name: "Dee Cruz" } });

  const before = await call(env, "GET", "/api/events/60/sheet", { token: dee });
  assert.equal(before.data.viewer.signed_up, false, "a signed-in viewer who has not signed up must read false");

  const r = await call(env, "POST", "/api/events/60/signup", {
    token: dee, body: { email: "other@x.test", name: "Zed Alpha" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.status, "comped");

  // The registration landed on the SESSION identity — registering someone else is not expressible.
  assert.equal(env.DB.query("SELECT 1 AS x FROM contacts WHERE email='other@x.test'").length, 0,
    "a body email on a signed-in tap minted a contact — the session must own the identity");
  const mine = env.DB.one(
    "SELECT c.full_name FROM registrations r JOIN contacts c ON c.id=r.contact_id WHERE r.event_id=60 AND lower(c.email)='dee@bt.test'");
  assert.ok(mine, "the sign-up did not land on the session's own contact");
  assert.equal(mine.full_name, "Dee Cruz", "with no contact name, the account display name is the name");

  const after = await call(env, "GET", "/api/events/60/sheet", { token: dee });
  assert.equal(after.data.viewer.signed_up, true);
  assert.ok(after.data.attendees.includes("Dee C."));
  env.DB.close();
});

test("one tap with NO name anywhere asks for one (400 need_name) — never the email local part", async () => {
  const env = boot();
  await signIn(env, "throwaway@bt.test");
  const anon = await signIn(env, "anonperson@bt.test");
  const bare = await call(env, "POST", "/api/events/60/signup", { token: anon, body: {} });
  assert.equal(bare.status, 400);
  assert.equal(bare.data.need_name, true, "the refusal must tell the page to reveal the name field");

  const named = await call(env, "POST", "/api/events/60/signup", { token: anon, body: { name: "Ana Torres" } });
  assert.equal(named.status, 200, JSON.stringify(named.data).slice(0, 200));
  const sheet = await call(env, "GET", "/api/events/60/sheet");
  assert.ok(sheet.data.attendees.includes("Ana T."));
  assert.ok(!JSON.stringify(sheet.data.attendees).includes("anonperson"),
    "an email local part surfaced as a public name — the leak need_name exists to prevent");
  env.DB.close();
});

test("a member who already holds an active registration gets duplicate, not a second spot", async () => {
  const env = boot();
  await signIn(env, "throwaway@bt.test");
  const ava = await signIn(env, "ava@bt.test"); // contact 910 already 'paid' on event 60
  const r = await call(env, "POST", "/api/events/60/signup", { token: ava, body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.duplicate, true);
  assert.equal(env.DB.one(
    "SELECT COUNT(*) AS n FROM registrations WHERE event_id=60 AND contact_id=910 AND status IN ('pending','email-sent','paid','cash-pending','comped')").n,
    1, "the tap wrote a second active registration for the same person");
  env.DB.close();
});

/* ==================== source guards: one predicate, one page, forked CTAs ==================== */

test("the sign-up INSERT interpolates ACTIVE_REG_STATUSES — no third hand-rolled status list", () => {
  // D-45 (v0.191.0): stripped reads — a needle in a comment must not satisfy a behaviour claim,
  // and a commented-out source must fail this test, not pass it.
  const src = blankComments(readFileSync(new URL("../src/registrations.js", import.meta.url), "utf8"));
  const wl = blankComments(readFileSync(new URL("../src/waitlists.js", import.meta.url), "utf8"));
  assert.match(wl, /export const ACTIVE_REG_STATUSES/,
    "waitlists.js no longer exports the one status list the sheet SQL interpolates");
  const start = src.indexOf("async function sheetSignup");
  assert.ok(start > -1, "sheetSignup is gone from registrations.js — did the sheet move?");
  const body = src.slice(start, src.indexOf("\nasync function", start + 10));
  assert.match(body, /ACTIVE_REG_STATUSES/, "the sheet's capacity SQL does not use the shared status list");
  // Positive control: the pattern this guard forbids IS findable where it lawfully lives —
  // submitRegistration's v1.3-era inline list predates the export and is pinned by its own comment.
  assert.match(src, /'pending','email-sent','paid','cash-pending','comped'/,
    "the inline list the guard uses as its positive control has vanished — re-point the control");
});

test("sheet.html is a real page: own script (§11), config, site-nav, live status region, no raw emails", () => {
  const html = readFileSync(new URL("../../web/sheet.html", import.meta.url), "utf8");
  assert.match(html, /assets\/sheet\.js\?v=/, "the page must load its own versioned script");
  assert.match(html, /assets\/config\.js\?v=/);
  assert.match(html, /assets\/site-nav\.js\?v=/);
  assert.match(html, /aria-live/, "sign-up feedback needs a live region");
  const js = blankComments(readFileSync(new URL("../../web/assets/sheet.js", import.meta.url), "utf8")); // D-45: stripped read
  assert.match(js, /\/api\/events\/.*\/sheet|\/sheet`/, "sheet.js never fetches the sheet route");
  assert.match(js, /\/signup/, "sheet.js never posts the sign-up");
  assert.match(js, /bt_token/, "sheet.js must attach the session so the one-tap works for members");
  assert.match(js, /hp/, "the guest form lost its honeypot field");
});

test("the advertised links fork by type: drop-in types → sheet.html, team types keep register.html", () => {
  // REWRITTEN in v0.137.0, not deleted. This pin was written against the fork as SG-1 shipped it:
  // spelled out inside schedule.js and again inside admin-event.js. D-29 was the third site that
  // needed the same rule and wrote its own — with the wrong parameter — so the rule moved to
  // config.js and both original sites became callers. The pin follows it: the behaviour it
  // protects (a drop-in advertises its sheet, a team event its registration form) is unchanged.
  const cfg = blankComments(readFileSync(new URL("../../web/assets/config.js", import.meta.url), "utf8")); // D-45: stripped read
  assert.match(cfg, /sheet\.html\?event=/, "the shared rule never points at the sheet");
  assert.match(cfg, /register\.html\?event=/, "team events must keep the registration form");
  // REWRITTEN AGAIN in v0.147.0, still not deleted, and only the SPELLING moved. PM-1 gave this
  // fork a second axis — an event can register on someone else's site — and adding that as a
  // third parameter would have let a caller omit it and silently get the internal link, which is
  // D-29 for a third time in the same function. So `BT_SIGNUP_LINK(type, id)` became
  // `BT_SIGNUP(event)`: the whole event in, the whole decision out. The behaviour THIS test
  // protects is untouched — a drop-in advertises its sheet, a team event its registration form.
  assert.match(cfg, /e\.type === "training" \|\| e\.type === "event"/,
    "the fork must read the event type, not guess");
  for (const caller of ["assets/schedule.js", "assets/admin-event.js"]) {
    const src = blankComments(readFileSync(new URL("../../web/" + caller, import.meta.url), "utf8")); // D-45: stripped read
    assert.match(src, /BT_SIGNUP\(/, `${caller} stopped using the shared rule — a second copy is how D-29 happened`);
  }
  // The staff screen's link is the one that gets advertised (§-1o), so it must still be absolute
  // — for OUR page. An event registering elsewhere has no link of ours worth pasting, and
  // BT_SIGNUP returns that one already absolute, so the origin is prefixed on the internal branch
  // only. Anchored on regLink's brace-matched body, never on how far apart two tokens sit (D-17b).
  const adminEvent = readFileSync(new URL("../../web/assets/admin-event.js", import.meta.url), "utf8");
  const regLink = functionBodyAfter(blankComments(adminEvent), "function regLink(");
  assert.ok(regLink, "regLink is gone or is no longer a plain function declaration");
  assert.match(regLink, /location\.origin/,
    "the advertised link lost its origin — a relative link is not something staff can paste anywhere");
  assert.match(regLink, /BT_SIGNUP\(/, "regLink stopped asking the shared rule where to point");
  assert.match(regLink, /external/,
    "regLink prefixes our origin unconditionally — an outside registration URL is already absolute");
});
