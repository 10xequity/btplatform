/* Boomtown Platform — staff card correction (roadmap §-1b W-E.2b)
   File: worker/test/tryouts_card.test.mjs · Version: v1.0 · Date: 2026-08-06 · Ships in: v0.98.0

   `PUT /api/admin/tryouts/:eventId/card/:contactId` has been built, tested and org-scoped since
   v0.60.0 with NO CALLER ANYWHERE — the last of the tryouts routes, and the last entry in the D-4
   cluster the owner's "try out page does not work … no form to use" pointed at. This file guards
   the screen that finally calls it.

   THE LOAD-BEARING PROPERTY IS THAT A LIST GOES OVER THE WIRE AS AN ARRAY.
   `parseList` JSON.parses a string before it falls back to splitting on commas, so the single
   value "16" parses as the NUMBER 16, fails `Array.isArray`, and comes back as []. A form that
   posts its comma-separated text box raw would therefore DELETE the age group the user just
   typed, for exactly one input in ten, and look correct in review. A2 proves that behaviour
   against the real server; A3 asserts the client does not do it; NC-1 mutates the real shipped
   client to do it and proves this file catches that.

   The second property: the client does no unit arithmetic. Height is stored in centimetres and
   rendered imperial BY THE SERVER (`cmToImperial`). A feet-and-inches box here would round-trip
   lossily — 5'11" is a range of centimetres, not one — and rewrite a stored height on every save
   of an unrelated field. A5 pins that the conversion is absent.

   Comments are stripped once, at the top, into CODE — a guard's own comment has tripped the guard
   for the rule it explains four times in this repo. NC-3 controls the stripper in both directions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { normalizeCard } from "../src/tryouts.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8") + `
CREATE UNIQUE INDEX ux_tryout_profiles_live ON tryout_profiles (org_id, event_id, contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_tryout_eval_live ON tryout_evaluations (org_id, event_id, contact_id, evaluator_contact_id) WHERE deleted_at IS NULL;
`;
const ORIGIN = "https://boomtown.test";
const JS = readFileSync(new URL("../../web/assets/admin-tryouts.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../web/admin-tryouts.html", import.meta.url), "utf8");
const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec(`INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
           INSERT INTO orgs (id, name, slug, active) VALUES (2, 'Other Club', 'other', 1);
           INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status) VALUES (1,1,'w','b','s','active');
           INSERT INTO events (id, org_id, type, name, status, starts_at)
             VALUES (1, 1, 'training', '15U Tryout', 'published', datetime('now','+3 days'));`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token, org } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": String(org || 1) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function signIn(env, email, role, name, orgId = 1) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email=?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, ${orgId}, '${role}')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='${role}'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (${orgId}, ${u.id}, '${email}', '${name}')`);
  return { token: v.data.token };
}

function registrant(env, name, email) {
  env.DB.exec(`INSERT INTO contacts (org_id, email, full_name) VALUES (1, '${email}', '${name}')`);
  const id = env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id;
  env.DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES (1, 1, ${id}, 'paid')`);
  return id;
}

const onBoard = (players, n) => players.find((p) => p.name === n);

/* ------------------------------------------------------------------ the route has a caller ---- */

test("A1 — the correction route has a caller, and it is the evaluate card", () => {
  // The call SITE, in both directions. route_reachability's baseline strike is the other half:
  // on its own that ratchet cannot say the caller is a form rather than a dead control.
  assert.match(CODE, /api\(`\/api\/admin\/tryouts\/\$\{eventId\}\/card\/\$\{contactId\}`/,
    "nothing calls the card route — this is the failure class the whole unit exists to close");
  assert.match(CODE, /method:\s*"PUT"/, "the card is corrected with PUT");
  // A template literal, never concatenation: "…/card/" + id masks to /api/admin/tryouts/*/card/*
  // and would heal the baseline entry without a real caller.
  assert.ok(!/["']\/api\/admin\/tryouts\/["']\s*\+/.test(CODE), "build the URL with a template literal");
  // It belongs on the evaluate card, not on the squad board (roadmap §-1b W-E.2b).
  const squads = readFileSync(new URL("../../web/assets/admin-squads.js", import.meta.url), "utf8");
  assert.ok(!/\/card\//.test(squads), "the correction form landed on the squad board, not the evaluate card");
});

/* ------------------------------------------------------- a list crosses the wire as an array -- */

test("A2 — the SERVER turns a lone \"16\" string into an empty list, which is why the client sends arrays", () => {
  // This is the trap, demonstrated against the real validator rather than described in a comment.
  assert.deepEqual(JSON.parse(normalizeCard({ age_groups: "16" }).value.age_groups), [],
    "the premise moved: a bare numeric string no longer parses to a number");
  assert.deepEqual(JSON.parse(normalizeCard({ age_groups: ["16"] }).value.age_groups), ["16"],
    "an array of one is the shape that survives");
  // And the shape that looks safe but is not: "14U, 16U" happens to work, which is exactly why
  // the string path survives review — it fails only for the all-digits case.
  assert.deepEqual(JSON.parse(normalizeCard({ age_groups: "14U, 16U" }).value.age_groups), ["14U", "16U"]);
});

test("A3 — the client splits the comma box itself and posts an array", () => {
  assert.match(CODE, /age_groups:\s*v\.age_groups\.split\(","\)/,
    "the client posts its raw comma string — a lone \"16\" would be silently deleted (A2)");
  assert.match(CODE, /\.map\(\(s\)\s*=>\s*s\.trim\(\)\)\.filter\(Boolean\)/,
    "blank entries between commas must not become empty age groups");
  assert.match(CODE, /positions:\s*v\.positions/, "positions are already a list and stay one");
});

/* ------------------------------------------------------------------ the round trip, for real -- */

test("A4 — staff correct a card and the board shows the corrected card", async () => {
  const env = boot();
  const staff = await signIn(env, "director@bt.test", "admin", "Dana Director");
  const id = registrant(env, "Robin Typo", "robin@bt.test");

  const put = await call(env, "PUT", `/api/admin/tryouts/1/card/${id}`, {
    token: staff.token,
    body: {
      positions: ["OH", "DS", "NOTAPOSITION"], age_groups: ["16U"], height_cm: 180,
      prev_club: "Front Range VBC", jersey_size: "M", player_note: "Prefers left side.",
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));

  const board = await call(env, "GET", "/api/admin/tryouts/1/board", { token: staff.token });
  const robin = onBoard(board.data.players, "Robin Typo");
  assert.ok(robin, "the corrected player fell off the board");
  // An unrecognised position is DROPPED, not stored and not an error — the whitelist is the
  // server's, and the form offers exactly the six it accepts.
  assert.deepEqual(robin.positions, ["OH", "DS"]);
  assert.equal(robin.height_cm, 180);
  assert.equal(robin.height, "5'11\"", "the server renders the imperial the coach reads");
  assert.equal(robin.prev_club, "Front Range VBC");
  assert.equal(robin.player_note, "Prefers left side.");
  env.DB.close();
});

test("A5 — a bad height is refused in a human sentence, and the client does no unit arithmetic", async () => {
  const env = boot();
  const staff = await signIn(env, "director2@bt.test", "admin", "Dana Director");
  const id = registrant(env, "Casey Tall", "casey@bt.test");
  const bad = await call(env, "PUT", `/api/admin/tryouts/1/card/${id}`, {
    token: staff.token, body: { height_cm: 300 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /centimetres/, "the error must name the unit it wants (standards §8)");
  assert.ok(!/[A-Z]{3,}_[A-Z]/.test(bad.data.error), "errors are human sentences, not codes");

  // No feet/inches conversion anywhere in the client: 2.54 or a /12 would mean a lossy round trip
  // that rewrites a stored height on every save.
  assert.ok(!/2\.54/.test(CODE), "the client is converting inches to centimetres — the server owns that");
  assert.ok(!/totalInches|\/\s*12\b/.test(CODE), "the client is doing imperial arithmetic");
  // And the field says which unit it wants, so nobody has to guess.
  assert.match(CODE, /Height in centimetres/, "the height field must name its unit");
  env.DB.close();
});

test("A6 — the correction is org-scoped and staff-only", async () => {
  const env = boot();
  const mine = await signIn(env, "director3@bt.test", "admin", "Dana Director", 1);
  const other = await signIn(env, "intruder@bt.test", "admin", "Otto Other", 2);
  const member = await signIn(env, "player@bt.test", "member", "Pat Player", 1);
  const id = registrant(env, "Drew Scoped", "drew@bt.test");

  await call(env, "PUT", `/api/admin/tryouts/1/card/${id}`, {
    token: mine.token, body: { prev_club: "Ours" },
  });
  // An admin of org 2 writing with their own org header must not reach org 1's row.
  await call(env, "PUT", `/api/admin/tryouts/1/card/${id}`, {
    token: other.token, org: 2, body: { prev_club: "Theirs" },
  });
  const board = await call(env, "GET", "/api/admin/tryouts/1/board", { token: mine.token });
  assert.equal(onBoard(board.data.players, "Drew Scoped").prev_club, "Ours",
    "another org's admin overwrote this org's card");

  const asMember = await call(env, "PUT", `/api/admin/tryouts/1/card/${id}`, {
    token: member.token, body: { prev_club: "Mine now" },
  });
  assert.ok(asMember.status === 401 || asMember.status === 403, `a member corrected a card (${asMember.status})`);
  env.DB.close();
});

/* ------------------------------------------------- the listeners are delegated, once, at boot -- */

test("A7 — every #tList listener is attached at boot, never inside a render", () => {
  // POSITIONAL, not a spelling: it cannot be satisfied by renaming anything. #tList has its
  // innerHTML replaced on every render but the node itself survives, so a listener attached
  // during a render accumulates for the life of the page — §-1c D-6, the pool board's leak.
  const boot = CODE.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(boot > 0, "the boot block moved — this assertion is measuring nothing");
  const adds = [...CODE.matchAll(/\$\("tList"\)\.addEventListener/g)];
  assert.equal(adds.length, 2, "expected exactly the click and input delegates on the static node");
  for (const m of adds) {
    assert.ok(m.index > boot,
      "a #tList listener is attached before the boot block — a render would stack a second copy");
  }
});

test("A8 — a re-render cannot silently discard a half-typed correction", () => {
  // Typing in the filter box rebuilds every card. Without a draft the open form would be redrawn
  // from the server's values and the user's typing would vanish with no message.
  assert.match(CODE, /fixDraft = readForm\(form\)/, "keystrokes in the form must be kept");
  assert.match(CODE, /const v = fixDraft \|\|/, "the redrawn form must prefer the draft over the server values");
  // And focus must survive the same re-render — the button the user just pressed is replaced.
  assert.match(CODE, /function refocusFix/, "focus falls to <body> when render() replaces the toggle");
  assert.ok(/refocusFix\(id\)/.test(CODE) && /refocusFix\(contactId\)/.test(CODE),
    "both the toggle and the save path must put focus back");
});

test("A9 — the form is built from the page's own vocabulary, and nothing paints text gold", () => {
  // The rule from v0.95.1/v0.96.1: take the shared step, never invent a per-page one. Every
  // control here is themed by tokens.css (44px target, F-35 ring) and app.css (.btn press).
  const css = HTML.replace(/<!--[\s\S]*?-->/g, "");
  const fixRules = [...css.matchAll(/\.fix-[a-z]*[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(fixRules.length >= 5, `the correction styles vanished or were renamed (${fixRules.length})`);
  for (const body of fixRules) {
    assert.ok(!/color:\s*var\(--accent\)/.test(body) && !/color:\s*#[dD]4[aA][fF]37/.test(body),
      "gold is a background or a rule, never ink (uiux-review §1)");
    // The v0.95.1 finding: a thick single-side accent border is the cliché that spends the
    // loudest device on the quietest element.
    assert.ok(!/border-(left|right|top):\s*[3-9]px/.test(body), "no thick single-side accent border");
  }
  // A real fieldset/legend around the checkbox group, not a bare div with a label beside it.
  assert.match(CODE, /<fieldset class="fix-set fix-wide">[\s\S]*?<legend/, "group the checkboxes properly");
  assert.match(CODE, /aria-expanded="\$\{open\}"/, "a disclosure must say whether it is open");
});

/* ------------------------------------------------------------------ negative controls --------- */

test("NC-1 — posting the raw comma string from the REAL client is caught", () => {
  // The mutation a reasonable engineer would make: "it is already a string, just send it".
  const target = 'age_groups: v.age_groups.split(",").map((s) => s.trim()).filter(Boolean),';
  assert.ok(JS.includes(target), "the mutation target moved — this control is testing nothing");
  const broken = JS.replace(target, "age_groups: v.age_groups,");
  assert.notEqual(broken, JS, "the mutation did not apply");
  const mutated = broken.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/age_groups:\s*v\.age_groups\.split\(","\)/.test(mutated),
    "the guard cannot see a client that posts the raw string, so its clean report means nothing");
  // And the mutation really is a defect, proved against the real validator rather than assumed.
  assert.deepEqual(JSON.parse(normalizeCard({ age_groups: "16" }).value.age_groups), []);
});

test("NC-2 — moving a #tList listener into render() in the REAL client is caught", () => {
  const target = '    $("tList").addEventListener("input", (e) => {';
  assert.ok(JS.includes(target), "the mutation target moved — this control is testing nothing");
  // Put a REAL listener on the static node inside render(), which is where the leak comes from.
  const leaked = JS.replace(
    '  function render() {',
    '  function render() {\n    $("tList").addEventListener("input", () => {});'
  );
  assert.notEqual(leaked, JS, "the mutation did not apply");
  const mutated = leaked.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const boot = mutated.indexOf('document.addEventListener("DOMContentLoaded"');
  const adds = [...mutated.matchAll(/\$\("tList"\)\.addEventListener/g)];
  assert.ok(adds.some((m) => m.index < boot),
    "the positional check cannot see a listener attached inside render — D-6 could be inherited unnoticed");
  assert.equal(adds.length, 3, "the mutation must add a real listener, not a renamed one");
});

test("NC-3 — the comment stripper works in both directions", () => {
  // The phrase is in the file only as a comment, is gone once comments are stripped, and the code
  // survives. Without this, every assertion pointed at CODE could be silently disabled.
  assert.ok(/a range of centimetres, not one/i.test(JS), "the comment this control relies on moved");
  assert.ok(!/a range of centimetres, not one/i.test(CODE), "the stripper did not remove comments");
  assert.match(CODE, /function fixForm/, "the stripper ate the code as well");
});
