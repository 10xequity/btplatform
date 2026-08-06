/* Boomtown Platform — the tryout squad board (roadmap §-1b W-E.2)
   File: worker/test/tryouts_squads.test.mjs · Version: v1.0 · Date: 2026-08-06 · Ships in: v0.97.0

   FIVE routes were built, tested and org-scoped with NO CALLER ANYWHERE:
   `GET/POST /api/admin/tryouts/:id/squads`, `PATCH/DELETE /api/admin/squads/:id`,
   `POST /api/admin/squads/:id/assign`, `POST /api/admin/squads/:id/remove`.
   That is failure class 1 at scale, and it is the owner's "try out page does not work — no form to
   use" in its largest single cluster. The engine was never the gap. This file guards the screen.

   THE TWO LOAD-BEARING PROPERTIES:

   1. THE SERVER OWNS "SHORT" AND "FULL". `squadNeeds()` defines full as headcount met AND no
      position short — a squad of 10 with no setter is NOT full. If the client re-derives that from
      `filled` and `target` it will get the easy half right and silently drop the position half,
      and the screen will report a team as complete when it has no setter. NC-1 mutates the real
      shipped client to compute exactly that and proves this file catches it.

   2. NO LISTENER IS EVER ATTACHED INSIDE A RENDER. §-1c D-6 is the pool board's live defect:
      `wire()` stacks drag handlers on a node it never recreates, so they accumulate for the life
      of the page. This page delegates from two containers and attaches once at boot. The check is
      POSITIONAL and therefore an invariant rather than a spelling — every `addEventListener` must
      come at or after the boot block. NC-2 inserts one into `renderSquads` and proves it reddens.

   Comments are stripped ONCE into CODE before any assertion about what the code DOES — a comment
   explaining a rule has now set off the check for that rule five times in this repo. The stripper
   is controlled in BOTH directions at the bottom: it must not eat code, and it must not let a
   comment satisfy a check. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { squadNeeds } from "../src/tryouts.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8") + `
CREATE UNIQUE INDEX ux_tryout_profiles_live ON tryout_profiles (org_id, event_id, contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_tryout_squad_member_live ON tryout_squad_members (org_id, contact_id, squad_id) WHERE deleted_at IS NULL;
`;
const ORIGIN = "https://boomtown.test";
const JS = readFileSync(new URL("../../web/assets/admin-squads.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../web/admin-squads.html", import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const CODE = strip(JS);

/* The client must READ the server's verdict and never recompute it. Any comparison between the
   headcount and the target in client code is that recomputation, whatever it is spelled. */
const DERIVES_FULL = /\b(?:s\.)?filled\s*(?:>=|>|<=|<)|(?:>=|>|<=|<)\s*(?:s\.)?target\b/;

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec(`INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);
           INSERT INTO waiver_versions (id, org_id, label, body, body_sha, status) VALUES (1,1,'w','b','s','active');
           INSERT INTO events (id, org_id, type, name, status, starts_at)
             VALUES (1, 1, 'training', '15U Tryout', 'published', datetime('now','+3 days'));`);
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null; try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const email = "director@bt.test";
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email=?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, 'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1, ${u.id}, '${email}', 'Dana Director')`);
  return v.data.token;
}

function registrant(env, name, email) {
  env.DB.exec(`INSERT INTO contacts (org_id, email, full_name) VALUES (1, '${email}', '${name}')`);
  const id = env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id;
  env.DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES (1, 1, ${id}, 'paid')`);
  return id;
}

const squadByName = (list, n) => list.find((s) => s.name === n);

/* ------------------------------------------------------- the five routes have callers ---------- */

test("all five squad routes have a caller in the shipped client", () => {
  // Assert the CALL SITES, in both directions. route_reachability's baseline strike is the other
  // half; on its own that ratchet cannot say a caller points anywhere sensible.
  assert.match(CODE, /api\(`\/api\/admin\/tryouts\/\$\{eventId\}\/squads`\)/,
    "nothing reads the squad board");
  assert.match(CODE, /api\(`\/api\/admin\/tryouts\/\$\{eventId\}\/squads`, \{\s*method: "POST"/,
    "nothing creates a squad");
  assert.match(CODE, /api\(`\/api\/admin\/squads\/\$\{squadId\}`, \{\s*\n?\s*method: "PATCH"/,
    "nothing edits a squad");
  assert.match(CODE, /api\(`\/api\/admin\/squads\/\$\{squadId\}`, \{ method: "DELETE" \}\)/,
    "nothing deletes a squad");
  assert.match(CODE, /api\(`\/api\/admin\/squads\/\$\{squadId\}\/assign`/, "nothing places a player");
  assert.match(CODE, /api\(`\/api\/admin\/squads\/\$\{squadId\}\/remove`/, "nothing takes a player off");
});

test("the page is registered where a page has to be registered", () => {
  const nav = readFileSync(new URL("../../web/assets/admin-nav.js", import.meta.url), "utf8");
  const rail = readFileSync(new URL("../../web/assets/rail.partial.html", import.meta.url), "utf8");
  const status = readFileSync(new URL("../../web/assets/build-status.js", import.meta.url), "utf8");
  assert.match(nav, /href: "admin-squads\.html"/, "a page missing from NAV is a page with no way in");
  assert.match(rail, /href="admin-squads\.html"/, "the rail partial is the source of truth sync-rail writes from");
  assert.match(status, /"admin-squads\.html":/, "every page is registered in build-status");
  // Both directions of the round trip: each page links to the other carrying the chosen tryout,
  // so the director never re-picks an event they were already looking at (req #19).
  const tryoutsJs = strip(readFileSync(new URL("../../web/assets/admin-tryouts.js", import.meta.url), "utf8"));
  assert.match(tryoutsJs, /admin-squads\.html\?event=/, "the evaluations page must carry the tryout across");
  assert.match(CODE, /admin-tryouts\.html\?event=/, "the squad board must carry the tryout back");
});

/* ------------------------------------------------------- the board actually works --------------- */

test("a squad is created, a player is placed, and the board reports both", async () => {
  const env = boot();
  const token = await staff(env);
  const robin = registrant(env, "Robin Reed", "robin@bt.test");

  const made = await call(env, "POST", "/api/admin/tryouts/1/squads", { token, body: { name: "15U Blue", target_size: 2 } });
  assert.equal(made.status, 200);

  const placed = await call(env, "POST", `/api/admin/squads/${made.data.squad_id}/assign`, {
    token, body: { contact_id: robin, position: "S" },
  });
  assert.equal(placed.status, 200);

  const board = await call(env, "GET", "/api/admin/tryouts/1/squads", { token });
  const blue = squadByName(board.data.squads, "15U Blue");
  assert.equal(blue.filled, 1, "the placed player must count toward the headcount");
  assert.equal(blue.members[0].name, "Robin Reed");
  assert.equal(board.data.totals.placed, 1, "the event-wide total is summed from the same members");
});

test("placing a player who is already on a team MOVES them — the board is a placement, not a wishlist", async () => {
  const env = boot();
  const token = await staff(env);
  const robin = registrant(env, "Robin Reed", "robin@bt.test");
  const blue = (await call(env, "POST", "/api/admin/tryouts/1/squads", { token, body: { name: "Blue" } })).data.squad_id;
  const gold = (await call(env, "POST", "/api/admin/tryouts/1/squads", { token, body: { name: "Gold" } })).data.squad_id;

  await call(env, "POST", `/api/admin/squads/${blue}/assign`, { token, body: { contact_id: robin } });
  await call(env, "POST", `/api/admin/squads/${gold}/assign`, { token, body: { contact_id: robin } });

  const board = await call(env, "GET", "/api/admin/tryouts/1/squads", { token });
  assert.equal(squadByName(board.data.squads, "Blue").filled, 0, "the first team must have let them go");
  assert.equal(squadByName(board.data.squads, "Gold").filled, 1, "the second team must have them");
  assert.equal(board.data.totals.placed, 1, "one player, placed once — not counted twice");
});

test("a team with the headcount but a position short is NOT full, and the board says what is short", async () => {
  const env = boot();
  const token = await staff(env);
  const a = registrant(env, "Alex One", "a@bt.test");
  const id = (await call(env, "POST", "/api/admin/tryouts/1/squads", {
    token, body: { name: "Blue", target_size: 1, needs: { S: 1 } },
  })).data.squad_id;
  // Placed with no position recorded, so the setter slot is still open while the headcount is met.
  await call(env, "POST", `/api/admin/squads/${id}/assign`, { token, body: { contact_id: a } });

  const blue = squadByName((await call(env, "GET", "/api/admin/tryouts/1/squads", { token })).data.squads, "Blue");
  assert.equal(blue.filled, 1);
  assert.equal(blue.target, 1);
  assert.equal(blue.full, false, "headcount met is not the same as complete — this is the whole rule");
  assert.deepEqual(blue.shortfall, { S: 1 }, "the board must say WHICH position is short");

  // The same rule, straight from the function the route uses, so the screen's claim and the
  // engine's rule are the same claim rather than two that happen to agree today.
  assert.equal(squadNeeds({ S: 1 }, [{ position: null }], 1).full, false);
  assert.equal(squadNeeds({ S: 1 }, [{ position: "S" }], 1).full, true);
});

test("removing a player, and deleting a team, both put people back in the unplaced pool", async () => {
  const env = boot();
  const token = await staff(env);
  const a = registrant(env, "Alex One", "a@bt.test");
  const b = registrant(env, "Bailey Two", "b@bt.test");
  const id = (await call(env, "POST", "/api/admin/tryouts/1/squads", { token, body: { name: "Blue", target_size: 4 } })).data.squad_id;
  await call(env, "POST", `/api/admin/squads/${id}/assign`, { token, body: { contact_id: a } });
  await call(env, "POST", `/api/admin/squads/${id}/assign`, { token, body: { contact_id: b } });

  await call(env, "POST", `/api/admin/squads/${id}/remove`, { token, body: { contact_id: a } });
  let board = await call(env, "GET", "/api/admin/tryouts/1/squads", { token });
  assert.equal(squadByName(board.data.squads, "Blue").filled, 1, "the removed player is off the team");

  const gone = await call(env, "DELETE", `/api/admin/squads/${id}`, { token });
  assert.equal(gone.status, 200);
  board = await call(env, "GET", "/api/admin/tryouts/1/squads", { token });
  assert.equal(board.data.squads.length, 0, "the team is gone");
  assert.equal(board.data.totals.placed, 0, "and nobody is stranded on a deleted team");

  // The unplaced list the screen renders is `/board` filtered on squad_id, so prove /board agrees.
  const players = (await call(env, "GET", "/api/admin/tryouts/1/board", { token })).data.players;
  assert.equal(players.filter((p) => !p.squad_id).length, 2, "both players are placeable again");
});

test("an edit saves the name, the target and the position needs together", async () => {
  const env = boot();
  const token = await staff(env);
  const id = (await call(env, "POST", "/api/admin/tryouts/1/squads", { token, body: { name: "Blue" } })).data.squad_id;
  const r = await call(env, "PATCH", `/api/admin/squads/${id}`, {
    token, body: { name: "15U Blue", target_size: 9, needs: { S: 2, MB: 1 } },
  });
  assert.equal(r.status, 200);
  const s = squadByName((await call(env, "GET", "/api/admin/tryouts/1/squads", { token })).data.squads, "15U Blue");
  assert.equal(s.target, 9);
  assert.deepEqual(s.shortfall, { S: 2, MB: 1 }, "an empty team is short everything it asked for");
});

/* ------------------------------------------------------- the client's two invariants ------------ */

test("the client reads the server's verdict on 'full' and never recomputes it", () => {
  assert.match(CODE, /s\.full/, "the screen must read the server's answer");
  assert.match(CODE, /s\.shortfall/, "and render the server's shortfall rather than guessing one");
  assert.ok(!DERIVES_FULL.test(CODE),
    "the client is comparing headcount to target — that re-derives 'full' and drops the position half of the rule");
});

test("every listener is attached at or after boot — §-1c D-6 must not be inherited", () => {
  const bootAt = CODE.indexOf('document.addEventListener("DOMContentLoaded"');
  assert.ok(bootAt > -1, "the boot block moved — this control is testing nothing");
  const spots = [...CODE.matchAll(/addEventListener/g)].map((m) => m.index);
  assert.ok(spots.length >= 5, `expected the delegated listener set, found ${spots.length}`);
  const early = spots.filter((i) => i < bootAt);
  assert.deepEqual(early, [],
    "a listener is attached before the boot block — if that is inside a render it stacks one handler per render, which is exactly D-6");
  assert.ok(!/function wire\s*\(/.test(CODE), "there is no wire() on this page and there must never be one");
});

test("the two-tap placement is reachable by keyboard and states which player is picked", () => {
  // Attribute ORDER is a spelling, not the invariant — assert the form and its submit separately.
  assert.match(HTML, /<form class="sq-form" id="sqNewForm">/, "the new team is a form");
  assert.match(HTML, /type="submit"/, "…that submits, so Enter works without reaching for the mouse");
  assert.match(CODE, /aria-pressed="\$\{picked === p\.contact_id\}"/, "the picked player must be announced, not just outlined");
  assert.match(CODE, /e\.key === "Escape"/, "a modeful interface needs a way out");
  assert.match(HTML, /id="sqStatus" aria-live="polite"/, "the first of two taps must say something happened");
  assert.match(HTML, /\.sq-pick:focus-visible[^}]*outline: 2px solid var\(--focus-ring\)/,
    "F-35: the focus ring is a bare :focus-visible on the thing you tap");
  assert.match(HTML, /min-height: 44px/, "44px targets");
  assert.match(HTML, /@media \(prefers-reduced-motion: reduce\)/, "reduced motion is honoured");
});

test("the shortfall chip puts the figure in --emphasis and never paints text gold", () => {
  // The gold rule (uiux-review §1): gold is a background with dark ink or a decorative mark, never
  // text on a light surface. --emphasis is the sanctioned token for a figure in both themes.
  assert.match(HTML, /\.sq-need b \{ color: var\(--emphasis\)/, "the figure takes --emphasis");
  const rules = [...HTML.matchAll(/\.sq-[a-z-]*[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(rules.length >= 8, `expected the page's own rule set, matched ${rules.length} — a rename must not make this pass vacuously`);
  const goldText = rules.filter((r) => /(^|[^-])color:\s*var\(--(gold|accent)\)/.test(r));
  assert.deepEqual(goldText, [], "a .sq- rule paints text gold");
});

/* ------------------------------------------------------- negative controls ---------------------- */

test("NC-1 the real client, mutated to recompute 'full', is caught", () => {
  const target = "s.full ? ";
  assert.ok(JS.includes(target), "the mutation target moved — this control is testing nothing");
  const broken = strip(JS.replace(target, "(s.filled >= s.target) ? "));
  assert.ok(DERIVES_FULL.test(broken),
    "the guard failed to notice the client computing fullness itself — it would report a setter-less team as complete");
  assert.ok(!DERIVES_FULL.test(CODE), "and the shipped file must be clean, or the control proves nothing");
});

test("NC-2 the real client, mutated to attach a listener inside a render, is caught", () => {
  const target = "function renderSquads() {";
  assert.ok(JS.includes(target), "the mutation target moved — this control is testing nothing");
  const broken = strip(JS.replace(target,
    'function renderSquads() {\n    $("sqGrid").addEventListener("click", () => {});'));
  const bootAt = broken.indexOf('document.addEventListener("DOMContentLoaded"');
  const early = [...broken.matchAll(/addEventListener/g)].map((m) => m.index).filter((i) => i < bootAt);
  assert.ok(early.length > 0, "the positional check failed to see a listener added inside a render — D-6 would ship again");
});

test("NC-3 the comment stripper is controlled in BOTH directions", () => {
  // Forward: it must not eat code.
  assert.match(CODE, /function renderSquads/, "the stripper ate the code as well");
  assert.match(CODE, /function squadCard/, "the stripper ate the code as well");
  // Reverse — the silent half nobody catches: a comment must not be able to SATISFY a check. This
  // file's own header prose contains the words `filled` and `target`; unstripped, DERIVES_FULL
  // would fire on the comment and the guard would redden for the wrong reason.
  const commentOnly = "/* a squad is full when filled >= target and nothing is short */ const x = 1;";
  assert.ok(DERIVES_FULL.test(commentOnly), "the fixture must contain the pattern before stripping, or it proves nothing");
  assert.ok(!DERIVES_FULL.test(strip(commentOnly)), "a comment survived the stripper and can satisfy a content check");
});
