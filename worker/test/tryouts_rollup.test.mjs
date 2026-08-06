/* Boomtown Platform — the director's tryout roll-up (roadmap §-1b W-E, part 1)
   File: worker/test/tryouts_rollup.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.96.0

   `GET /api/admin/tryouts/:eventId/summary` has been built and tested since v0.60.0 and had NO
   CALLER ANYWHERE. The page's "Director summary" button pointed at `admin-buildstatus.html` — a page
   about which modules exist, not about this tryout. That is the owner's "try out page does not work
   … no form to use" in miniature, and it is failure class 1: built, tested, and uncalled.

   THE LOAD-BEARING PROPERTY IS THAT THE RATING IS A RANGE, NEVER A MEAN.
   `rollUp` sends `rating_low` and `rating_high` with the comment "Range, not mean. Two coaches at 2
   and 5 is the interesting case, and a mean of 3.5 erases it." A screen that averages them throws
   away the disagreement the director opened this view to find — and it would look perfectly
   reasonable in review. NC-1 mutates the real shipped client to compute a mean and proves this file
   catches it.

   The second property: this view shows EVERY coach's verdict, where the evaluating cards show one
   coach their own only. Both halves are asserted against the same fixture, so "the roll-up
   aggregates" is not a claim about an empty set. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { rollUp } from "../src/tryouts.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8") + `
CREATE UNIQUE INDEX ux_tryout_profiles_live ON tryout_profiles (org_id, event_id, contact_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_tryout_eval_live ON tryout_evaluations (org_id, event_id, contact_id, evaluator_contact_id) WHERE deleted_at IS NULL;
`;
const ORIGIN = "https://boomtown.test";
const JS = readFileSync(new URL("../../web/assets/admin-tryouts.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../web/admin-tryouts.html", import.meta.url), "utf8");
/* Comments stripped for every assertion about what the code DOES — a comment explaining a rule has
   set off the check for that rule four times in this repo. The stripper is controlled at the bottom. */
const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

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

async function signIn(env, email, role, name) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email=?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, '${role}')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='${role}'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1, ${u.id}, '${email}', '${name}')`);
  return { token: v.data.token, contactId: env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id };
}

function registrant(env, name, email) {
  env.DB.exec(`INSERT INTO contacts (org_id, email, full_name) VALUES (1, '${email}', '${name}')`);
  const id = env.DB.one("SELECT id FROM contacts WHERE email=?1", email).id;
  env.DB.exec(`INSERT INTO registrations (org_id, event_id, contact_id, status) VALUES (1, 1, ${id}, 'paid')`);
  return id;
}

/** Two coaches who disagree about one player — the case the whole view exists for. */
async function disagreement(env) {
  const a = await signIn(env, "coach.a@bt.test", "admin", "Coach A");
  const b = await signIn(env, "coach.b@bt.test", "admin", "Coach B");
  const split = registrant(env, "Robin Split", "robin@bt.test");
  const agreed = registrant(env, "Casey Agreed", "casey@bt.test");
  const unseen = registrant(env, "Drew Unseen", "drew@bt.test");
  // Robin: 2 from one coach, 5 from the other, one offer and one no. A mean would say 3.5/undecided.
  await call(env, "PUT", `/api/admin/tryouts/1/eval/${split}`, { token: a.token, body: { rating: 2, verdict: "no_offer" } });
  await call(env, "PUT", `/api/admin/tryouts/1/eval/${split}`, { token: b.token, body: { rating: 5, verdict: "offer" } });
  // Casey: both coaches agree.
  await call(env, "PUT", `/api/admin/tryouts/1/eval/${agreed}`, { token: a.token, body: { rating: 4, verdict: "offer" } });
  await call(env, "PUT", `/api/admin/tryouts/1/eval/${agreed}`, { token: b.token, body: { rating: 4, verdict: "offer" } });
  return { a, b, split, agreed, unseen };
}

const byName = (players, n) => players.find((p) => p.name === n);

/* ------------------------------------------------------------------ the route has a caller ---- */

test("the summary route has a caller, and it is not the build-status page", () => {
  // Assert the CALL SITE, in both directions. route_reachability's baseline strike is the other
  // half of this; on its own that ratchet cannot say the caller points somewhere sensible.
  assert.match(CODE, /api\(`\/api\/admin\/tryouts\/\$\{eventId\}\/summary`\)/,
    "nothing calls the summary route — this is the failure class the whole unit exists to close");
  assert.ok(!/admin-buildstatus\.html#tryout-/.test(JS),
    "the Director summary control still points at the build-status page");
  // A template literal, never concatenation: `"…/tryouts/" + id + "/summary"` masks to
  // /api/admin/tryouts/* and would heal unrelated baseline entries at once.
  assert.ok(!/["']\/api\/admin\/tryouts\/["']\s*\+/.test(CODE), "build the URL with a template literal");
  assert.match(HTML, /<button class="btn ghost" id="tSummary" type="button"/,
    "a control that changes the view on this page is a button, not a link to nowhere");
});

/* ------------------------------------------------------------------ the range, never a mean --- */

test("a 2 and a 5 stay a 2 and a 5 — the rating is a range and nothing averages it", async () => {
  const env = boot();
  const { a, split } = await disagreement(env);
  const r = await call(env, "GET", "/api/admin/tryouts/1/summary", { token: a.token });
  assert.equal(r.status, 200, JSON.stringify(r.data));

  const robin = byName(r.data.players, "Robin Split");
  assert.ok(robin, "the disagreed-about player is missing from the roll-up");
  assert.equal(robin.rating_low, 2);
  assert.equal(robin.rating_high, 5);
  assert.equal(robin.evaluations, 2);
  assert.equal(robin.offer, 1);
  assert.equal(robin.no_offer, 1);
  // The payload must not carry an average at all — a field nobody asked for is a field a screen
  // will eventually render.
  assert.ok(!("rating_avg" in robin) && !("rating" in robin), `the roll-up invented an average: ${JSON.stringify(robin)}`);

  // And the client does no arithmetic on the two ends. This is the assertion NC-1 proves can fail.
  assert.ok(!/rating_low\s*\+\s*.*rating_high|rating_high\s*\+\s*.*rating_low/.test(CODE),
    "the client is averaging the rating range — the disagreement is exactly what a director opens this view to see");
  assert.match(CODE, /rating_low\}–\$\{p\.rating_high/, "the range must render as a range");
  env.DB.close();
});

test("the roll-up shows every coach's verdict, where the evaluating cards show only your own", async () => {
  const env = boot();
  const { a, split } = await disagreement(env);

  // Coach A's own board: their evaluation only. This is enforced in SQL, and asserting it here is
  // what makes the roll-up's "everybody" meaningful rather than a claim about one row.
  const board = await call(env, "GET", "/api/admin/tryouts/1/board", { token: a.token });
  const mine = (board.data.players || []).find((p) => p.contact_id === split);
  assert.equal(mine.my_evaluation.rating, 2, "coach A should see their own 2");
  assert.ok(!JSON.stringify(board.data).includes("\"rating\":5"), "coach A must not see coach B's 5 on the evaluating board");

  const roll = await call(env, "GET", "/api/admin/tryouts/1/summary", { token: a.token });
  assert.equal(byName(roll.data.players, "Robin Split").evaluations, 2, "the roll-up must aggregate BOTH coaches");
  env.DB.close();
});

test("a player nobody evaluated is absent from the roll-up rather than a row of zeroes", async () => {
  const env = boot();
  const { a } = await disagreement(env);
  const r = await call(env, "GET", "/api/admin/tryouts/1/summary", { token: a.token });
  assert.equal(byName(r.data.players, "Drew Unseen"), undefined,
    "an unevaluated player must not appear as 0/0 — that reads as a verdict nobody gave");
  // …and the screen says so honestly rather than showing an empty table with headers.
  assert.match(HTML, /id="tRollEmpty"[^>]*hidden>No coach has written an evaluation/,
    "an empty roll-up needs a sentence, not a bare table");
  env.DB.close();
});

test("rollUp reports the split as a fraction of evaluations, and says so when there are none", () => {
  // Pure function, driven directly — the shapes the table's last column renders.
  const out = rollUp([
    { contact_id: 1, full_name: "Two of three", rating: 3, verdict: "offer" },
    { contact_id: 1, full_name: "Two of three", rating: 5, verdict: "offer" },
    { contact_id: 1, full_name: "Two of three", rating: 1, verdict: "no_offer" },
    { contact_id: 2, full_name: "Rated, unjudged", rating: 4, verdict: null },
  ]);
  assert.equal(out[0].split, "2/3 offer");
  assert.equal(out[0].rating_low, 1);
  assert.equal(out[0].rating_high, 5);
  // A rating with no verdict counts as a rating but not as an evaluation — so the honest words are
  // "not evaluated", and the rating still shows.
  assert.equal(out[1].split, "not evaluated");
  assert.equal(out[1].rating_high, 4);
});

/* ------------------------------------------------------------------ the table contract -------- */

test("the table sorts from the head, announces the sort, and never signals it with colour alone", () => {
  for (const key of ["name", "offer", "no_offer", "evaluations", "rating"]) {
    assert.ok(new RegExp(`data-sort="${key}"`).test(HTML), `no sort control for ${key}`);
  }
  assert.match(CODE, /th\[aria-sort\]/, "the sort state must be written to aria-sort, which is what a screen reader reads");
  // The arrow is a character on the sorted column, so the state survives greyscale and colour blindness.
  assert.match(HTML, /\[aria-sort="ascending"\] \.roll-sort::after \{ content: " ↑"/);
  assert.match(HTML, /\[aria-sort="descending"\] \.roll-sort::after \{ content: " ↓"/);
  assert.match(HTML, /\.roll-sort:focus-visible \{ outline: 2px solid var\(--focus-ring\)/,
    "a sort control is reached by keyboard and must show it");
  // The shared table vocabulary, not a private one.
  assert.match(HTML, /<table class="tbl" id="tRollTable">/, "use admin.css's .tbl rather than a second table language");
  // Wide content scrolls inside its own container; the page never scrolls sideways.
  assert.match(HTML, /\.roll-scroll \{ overflow-x: auto/);
});

test("the roll-up heading outranks the rows it introduces", () => {
  /* The INVARIANT, deliberately not a pinned size. The first draft of this section set `.roll h2`
     to 16px, which is this product's h3 step and is byte-identical to `.eval-top b` — a player's
     name on an evaluation card. A heading that introduces an entire view then ranked no higher than
     one row's label. Asserting "18px" would pin one spelling of the fix and redden on the next
     legitimate change to the scale, which is a mistake this repo has now made twice; asserting the
     ORDER cannot. */
  const size = (re) => {
    const m = HTML.match(re);
    assert.ok(m, `could not read a font-size for ${re} — this check is reading the wrong rule`);
    return parseFloat(m[1]);
  };
  const heading = size(/\.roll h2 \{ font-size: ([\d.]+)px/);
  const cardName = size(/\.eval-top b \{ font-size: ([\d.]+)px/);
  assert.ok(heading > cardName,
    `the roll-up heading (${heading}px) must outrank a player's name on a card (${cardName}px)`);
  // And it must come from the shared scale rather than a number invented for this page: admin.css
  // declares h1 at 22 and h2 at 18, so anything between the card name and the page title is a step
  // that already exists.
  assert.ok(heading >= 18 && heading <= 22, `${heading}px is not a step on the shared heading scale`);
});

test("sorting a column twice reverses it, and counts open on the biggest number", () => {
  // The behaviour a director expects when they open "Offers": most-wanted first.
  assert.match(CODE, /else \{ sortKey = key; sortDir = key === "name" \? 1 : -1; \}/,
    "a count column must open descending — least-wanted-first is the wrong default");
  assert.match(CODE, /if \(key === sortKey\) sortDir = -sortDir;/, "the same column again reverses");
  // One delegated listener on the static table, because the body is rewritten on every sort.
  const adds = CODE.match(/tRollTable"\)\.addEventListener/g) || [];
  assert.equal(adds.length, 1, "exactly one listener, on the node that survives a re-render");
});

test("the two views are exclusive, and the card filters go with the cards", () => {
  // Showing the director's table under the evaluating filters would let "I said offer" silently
  // filter a table that is not about one coach at all.
  assert.match(CODE, /\$\("tList"\)\.hidden = on;/, "the cards hide when the table is shown");
  assert.match(CODE, /querySelector\("\.mf-filter"\)\.hidden = on;/, "the card filters hide with the cards");
  assert.match(CODE, /aria-pressed", String\(on\)/, "the toggle must state which view is showing");
  assert.match(CODE, /textContent = on \? "Back to my evaluations" : "Director summary"/,
    "the button says where it goes, in the same words both ways");
});

/* ------------------------------------------------------------------ negative controls --------- */

test("NC-1 — averaging the rating range in the REAL client is caught", () => {
  // The mutation a reasonable engineer would make, on the real shipped file.
  const target = "const range = p.rating_high == null";
  assert.ok(JS.includes(target), "the mutation target moved — this control is testing nothing");
  const averaged = JS.replace(target, "const avg = (p.rating_low + p.rating_high) / 2;\n      const range = p.rating_high == null");
  assert.notEqual(averaged, JS, "the mutation did not apply");
  const mutatedCode = averaged.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(/rating_low\s*\+\s*.*rating_high|rating_high\s*\+\s*.*rating_low/.test(mutatedCode),
    "the guard cannot see a client that averages the range, so its clean report means nothing");
  // And the real file is clean by the same test.
  assert.ok(!/rating_low\s*\+\s*.*rating_high|rating_high\s*\+\s*.*rating_low/.test(CODE));
});

test("NC-2 — restoring the build-status link in the REAL page is caught", () => {
  const target = '$("tSummary").addEventListener("click", () => showRollup(!rollOpen));';
  assert.ok(JS.includes(target), "the mutation target moved — this control is testing nothing");
  const broken = JS.replace(target, '$("tSummary").href = `admin-buildstatus.html#tryout-${eventId}`;');
  assert.notEqual(broken, JS, "the mutation did not apply");
  assert.ok(/admin-buildstatus\.html#tryout-/.test(broken), "the guard cannot see the regression it exists to prevent");
  // The toggle is gone with it, so the view could never be opened — both halves of the regression.
  assert.ok(!/showRollup\(!rollOpen\)/.test(broken), "the mutation must remove the control it replaces");
  assert.ok(!/admin-buildstatus\.html#tryout-/.test(JS), "and the real file is clean by the same check");
});

test("NC-3 — the comment stripper works in both directions", () => {
  // The phrase really is in the file as a comment, really is gone once comments are stripped, and
  // the code itself survives. Without this, pointing assertions at CODE could silently disable them.
  assert.ok(/never a mean/i.test(JS), "the comment this control relies on moved");
  assert.ok(!/never a mean/i.test(CODE), "the stripper did not remove comments");
  assert.match(CODE, /function renderRollup/, "the stripper ate the code as well");
});
