/**
 * Boomtown Platform — PM-1: an event can point at someone else's registration
 * File: worker/test/external_registration.test.mjs · Version: v1.0 · Date: 2026-08-13
 * Ships in: v0.147.0 · roadmap §-1m PM-1, §-0 B6
 *
 * Owner (§-1m Q4): *"If it is outside registration, to an outside registration."* An event can
 * carry `external_url` (migration 0046) and then sends people to Volleyball Life / Volo instead
 * of registering them here.
 *
 * §-1m states three rules and calls each one a trap this repo already knows. They are the reason
 * this file exists, and each has its own section below:
 *   1. the outbound link must be VISIBLY outbound (an external affordance and rel="noopener"),
 *      "or we have made a third party look like us";
 *   2. an external event must NOT offer check-in, waitlist or payment surfaces that will never
 *      receive data — *empty and broken look identical to a user*;
 *   3. it must be IMPOSSIBLE to set both a price and an external URL, "or the product
 *      contradicts itself".
 *
 * ── RULE 3 IS EVALUATED ON THE RESULT OF A WRITE, NOT ON ITS INPUT ───────────────────────────
 * The obvious implementation rejects a request that carries both fields at once, and it is not
 * enough: a PATCH that sets ONLY `external_url`, sent to an event that is already priced, carries
 * one field and still produces the contradiction. **Live D1 2026-08-13: 6 of 7 events are priced**,
 * so that is the common path, not a corner. Every test below drives the real route rather than a
 * validator in isolation, because the merge is the part that can be wrong.
 *
 * ── RULE 2 IS ENFORCED AT THE DESTINATION, WHICH IS THE PART THAT CANNOT BE BYPASSED ─────────
 * Forking the button is the visible half; anyone can still type `register.html?event=N`. So the
 * two PUBLIC payloads — `eventForm` and `eventSheet` — refuse for an external event and hand back
 * where to go instead. That makes the safety net the one surface a stray link cannot route around.
 *
 * ── ONE FORK, AND WHY THE SIGNATURE CHANGED ──────────────────────────────────────────────────
 * `BT_SIGNUP_LINK(type, id)` was the single place that decided where a sign-up button points
 * (config.js, after D-29's third caller wrote its own link with the wrong parameter). An external
 * URL is a SECOND axis on that judgement. Adding it as a third parameter would have let a caller
 * omit it and silently get the internal link — D-29 again. It is now `BT_SIGNUP(event)` taking the
 * whole event and returning the whole decision, so omission is not expressible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const WEB = new URL("../../web/", import.meta.url);
const read = (f) => readFileSync(new URL(f, WEB), "utf8");
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  // Two events on purpose: one PRICED (the live majority) and one FREE. Rule 3 cannot be tested
  // against a fixture where every event costs money — the allowed case would never appear.
  // `starts_at` is set on every row because the public schedule filters on
  // `date(e.starts_at) BETWEEN ?1 AND ?2`, and NULL fails that silently — the first draft left it
  // out and the payload test found an empty list rather than a missing field.
  DB.exec("INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at) VALUES (1,1,'tournament','Paid Open','published',4000,'2026-09-01 09:00')");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at) VALUES (2,1,'tournament','Free Jam','published',0,'2026-09-08 09:00')");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, price_cents, starts_at) VALUES (3,1,'training','Drop-in Clinic','published',0,'2026-09-15 18:00')");
  // The public schedule resolves a VIEW before it returns anything; without this row the route
  // answers "Unknown schedule view." and the payload test would be asserting against a 404.
  DB.exec("INSERT INTO schedule_views (slug, name, kind, show_counts) VALUES ('public','Public','public',1)");
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
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 300) }; }
  return { status: res.status, data };
}

async function staff(env) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email: "s@bt.test" } });
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: String(asked.data.dev_link).split("token=")[1] } });
  const u = env.DB.one("SELECT id FROM users WHERE email='s@bt.test'");
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id},1,'admin')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='admin'`);
  return v.data.token;
}

const URL_A = "https://volleyballlife.com/tournaments/1234";

/* ══════════════ 0. the fixture can exhibit both sides of rule 3 ══════════════ */

test("PM-1 — the fixture holds a PRICED event and a FREE one, or rule 3 has only one testable side", () => {
  const env = boot();
  const priced = env.DB.one("SELECT price_cents AS p FROM events WHERE id=1").p;
  const free = env.DB.one("SELECT price_cents AS p FROM events WHERE id=2").p;
  assert.ok(priced > 0, "event 1 must be priced");
  assert.equal(free, 0, "event 2 must be free — otherwise the ALLOWED case below is never exercised");
});

/* ══════════════ 1. RULE 3 — price and external URL cannot coexist ══════════════ */

test("PM-1 rule 3 — setting an external URL on a PRICED event is refused", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "PATCH", "/api/events/1", { token, body: { external_url: URL_A } });
  assert.ok(r.status >= 400, `expected a refusal, got ${r.status}: ${JSON.stringify(r.data).slice(0, 160)}`);
  assert.match(String(r.data.error || ""), /price/i,
    "the refusal must name the conflict — an error a director cannot act on is a code, not a sentence");
  assert.equal(env.DB.one("SELECT external_url AS u FROM events WHERE id=1").u, null,
    "the refusal did not prevent the write — the product now contradicts itself in the database");
});

test("PM-1 rule 3 — setting a PRICE on an event that already points outward is refused", async () => {
  // The direction a request-shaped check misses: the write carries only `price_cents`, and it is
  // the RESULTING state that contradicts itself.
  //
  // IT GOES THROUGH THE BULK ROUTE, AND FINDING OUT WHY IS THE MEASUREMENT. The first draft drove
  // `PATCH /api/events/:id`, which is what the admin event page calls — and that route's own
  // allow-list is ["name","starts_at","location","court_count","status","cash_option_enabled",
  // "config_json"]. It cannot write a price at all (that is §-1c D-34, recorded not fixed here).
  // `price_cents` is writable through `cleanEventBag`, whose consumers are bulk edit, create and
  // duplicate. So the two halves of rule 3 live on two different write paths, which is exactly why
  // the rule itself is ONE exported function that both import rather than two copies.
  const env = boot();
  const token = await staff(env);
  const ok = await call(env, "PATCH", "/api/events/2", { token, body: { external_url: URL_A } });
  assert.equal(ok.status, 200, `precondition failed: ${JSON.stringify(ok.data).slice(0, 160)}`);
  assert.equal(env.DB.one("SELECT external_url AS u FROM events WHERE id=2").u, URL_A, "precondition: the URL is set");

  const r = await call(env, "PATCH", "/api/admin/events/bulk", { token, body: { ids: [2], fields: { price_cents: 2500 } } });
  assert.equal(env.DB.one("SELECT price_cents AS p FROM events WHERE id=2").p, 0,
    `a price was written onto an event we do not register — that money can never be collected here (route said ${r.status})`);
});

test("PM-1 rule 3 — an external URL on a FREE event is ALLOWED, so the rule is a conflict not a ban", async () => {
  const env = boot();
  const token = await staff(env);
  const r = await call(env, "PATCH", "/api/events/2", { token, body: { external_url: URL_A, external_label: "Register on Volleyball Life" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const row = env.DB.one("SELECT external_url AS u, external_label AS l FROM events WHERE id=2");
  assert.equal(row.u, URL_A);
  assert.equal(row.l, "Register on Volleyball Life");
});

test("PM-1 rule 3 — clear the price, THEN point outward: the rule is a conflict, not a life sentence", async () => {
  // Proves the check reads the CURRENT state rather than refusing any event that was ever priced.
  //
  // REWRITTEN AT D-34's CLOSE (v0.157.0) TO ITS SURVIVING PURPOSE. As first written this test
  // pinned the WORKAROUND — two writes on two routes — because `PATCH /api/events/:id` silently
  // dropped `price_cents`, so the natural one-write conversion refused on the STORED price; its
  // own comment named that as "§-1c D-34 SHOWING THROUGH", a deliberate pin of the gap. D-34 is
  // closed: the conflict judges the MERGED RESULT now, so the one-write conversion
  // (`price_cents: 0` + the URL together) is exactly what must succeed — and a URL onto an
  // event whose price actually still stands must refuse, same as ever.
  const env = boot();
  const token = await staff(env);
  const blocked = await call(env, "PATCH", "/api/events/1", { token, body: { external_url: URL_A } });
  assert.equal(blocked.status, 400, "a priced event must refuse the URL while the price still stands");

  const ok = await call(env, "PATCH", "/api/events/1", { token, body: { price_cents: 0, external_url: URL_A } });
  assert.equal(ok.status, 200,
    `the one-write conversion (zero the price, point outward) must succeed now that the conflict reads the merged result: ${JSON.stringify(ok.data).slice(0, 160)}`);
  const row = env.DB.one("SELECT price_cents AS p, external_url AS u FROM events WHERE id=1");
  assert.equal(row.p, 0, "the zeroed price never reached the row");
  assert.equal(row.u, URL_A);
});

test("PM-1 rule 3 — the columns are in the ONE write allow-list, not settable by a side door", () => {
  const src = blankComments(readFileSync(new URL("../src/events_admin.js", import.meta.url), "utf8"));
  const m = /const EVENT_FIELDS = \[([^\]]+)\]/.exec(src);
  assert.ok(m, "EVENT_FIELDS could not be parsed — this check is measuring nothing");
  for (const f of ["external_url", "external_label"]) {
    assert.ok(m[1].includes(`"${f}"`), `${f} is not in EVENT_FIELDS, so no write path can set it`);
  }
});

/* ══════════════ 2. RULE 2 — no surface that will never receive data ══════════════ */

test("PM-1 rule 2 — the registration FORM refuses an external event and says where to go", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "PATCH", "/api/events/2", { token, body: { external_url: URL_A, external_label: "Register on Volleyball Life" } });

  const r = await call(env, "GET", "/api/events/2/form");
  assert.equal(r.data.external_url, URL_A, "the form payload does not carry where registration actually happens");
  assert.ok(!r.data.fields || !r.data.fields.length,
    "an event we do not register still returned form fields — a form that can never be submitted");
  assert.ok(!(r.data.event && r.data.event.price_cents > 0), "an external event must not advertise a price here");
});

test("PM-1 rule 2 — the public SHEET refuses an external event the same way", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "PATCH", "/api/events/3", { token, body: { external_url: URL_A } });
  const r = await call(env, "GET", "/api/events/3/sheet");
  assert.equal(r.data.external_url, URL_A, "the sheet payload does not carry where sign-up actually happens");
  assert.ok(!r.data.people || !r.data.people.length,
    "an external event still lists who is coming — nobody can ever sign up here");
});

test("PM-1 rule 2 NC — the SAME events without an external URL still return their form and sheet", async () => {
  // Without this the two tests above would pass against a route that refuses everything.
  const env = boot();
  const form = await call(env, "GET", "/api/events/2/form");
  assert.equal(form.status, 200, "a normal event lost its registration form");
  assert.ok(!form.data.external_url, "a normal event reports an external URL it does not have");
  const sheet = await call(env, "GET", "/api/events/3/sheet");
  assert.equal(sheet.status, 200, "a normal drop-in lost its sheet");
  assert.ok(!sheet.data.external_url, "a normal drop-in reports an external URL it does not have");
});

/* ══════════════ 3. RULE 1 — one fork, and it is visibly outbound ══════════════ */

/** Rebuild the shipped decision function from its own bytes. */
function loadSignup() {
  const src = blankComments(read("assets/config.js"));
  const body = functionBodyAfter(src, "window.BT_SIGNUP = function");
  assert.ok(body, "BT_SIGNUP is gone or is no longer a plain function expression");
  return { fn: new Function("event", body.slice(1, -1)), body };
}

test("PM-1 rule 1 — BT_SIGNUP forks on the URL and marks the outbound one as outbound", () => {
  const { fn } = loadSignup();
  const internal = fn({ id: 7, type: "tournament" });
  assert.equal(internal.href, "register.html?event=7", "the internal team-event link changed");
  assert.equal(internal.external, false);

  const sheet = fn({ id: 8, type: "training" });
  assert.equal(sheet.href, "sheet.html?event=8", "the drop-in fork was lost — it predates this unit");

  const ext = fn({ id: 9, type: "tournament", external_url: URL_A, external_label: "Register on Volleyball Life" });
  assert.equal(ext.href, URL_A, "an event with an external URL still points at our own page");
  assert.equal(ext.external, true);
  assert.match(ext.rel, /noopener/, "§-1m rule 1: the outbound link must carry rel=noopener");
  assert.equal(ext.target, "_blank");
  assert.equal(ext.label, "Register on Volleyball Life", "the operator's own wording was discarded");
});

test("PM-1 rule 1 — a blank or whitespace URL is NOT external, so an empty field cannot fake one", () => {
  const { fn } = loadSignup();
  for (const bad of ["", "   ", null, undefined]) {
    const r = fn({ id: 4, type: "tournament", external_url: bad });
    assert.equal(r.external, false, `an external_url of ${JSON.stringify(bad)} was treated as outbound`);
    assert.equal(r.href, "register.html?event=4");
  }
});

test("PM-1 rule 1 — an external event with no label still says something a person can read", () => {
  const { fn } = loadSignup();
  const r = fn({ id: 5, type: "tournament", external_url: URL_A });
  assert.ok(r.label && r.label.length > 3, "an unlabelled external link has no words on it");
  assert.ok(!/^https?:/i.test(r.label), "the fallback label is a raw URL — that is a link, not a sentence");
});

test("PM-1 rule 1 NC — neutralising the fork sends an external event back to our own page", () => {
  const { body } = loadSignup();
  const mutated = body.replace("if (url)", "if (false)");
  assert.notEqual(mutated, body, "the mutation did not land — the fork's condition was not found");
  const fn = new Function("event", mutated.slice(1, -1));
  const r = fn({ id: 9, type: "tournament", external_url: URL_A });
  assert.notEqual(r.href, URL_A,
    "with the fork disabled the external URL is STILL returned — the assertions above are not reading this branch");
});

/* ══════════════ 4. every sign-up CTA goes through the one fork ══════════════ */

/** Files that build a sign-up destination with their own string rather than through BT_SIGNUP.
 *  Comments are stripped first (D-33: a page name inside prose is not a link). */
function directSignupHrefs() {
  const out = [];
  const files = readdirSync(new URL("assets/", WEB)).filter((f) => f.endsWith(".js")).map((f) => "assets/" + f);
  files.push(...readdirSync(WEB).filter((f) => f.endsWith(".js")));
  for (const f of files) {
    const src = blankComments(read(f));
    const n = [...src.matchAll(/href="(?:register|sheet)\.html\?event=/g)].length;
    if (n) out.push(`${f}:${n}`);
  }
  return out.sort();
}

test("PM-1 — the ONLY files that build a sign-up href by hand are the known internal ones", () => {
  // D-29's class: "add a caller, never a copy". `leagues.js` was found doing exactly that during
  // this unit — a member-facing Register button with its own href, which produced the SAME string
  // as the helper today and would have silently ignored an external URL tomorrow.
  //
  // The survivors are deliberate and are NOT sign-up CTAs:
  //   · register.js and sheet.js link to register.html for the WAITLIST, which is our machinery
  //     and stays ours — an external event never reaches those pages (rule 2 refuses first);
  //   · admin-registrations.js copies a staff share-link — and it does NOT appear below, because
  //     it builds its string inside a `.replace()` rather than an href attribute. The first draft
  //     of this expectation listed it anyway, copied from a broader grep than the detector below
  //     actually runs. The set is now what the detector measures, not what a different search saw.
  assert.deepEqual(directSignupHrefs(),
    ["assets/register.js:1", "assets/sheet.js:2"],
    "a surface builds a sign-up link by hand. If it is a member-facing CTA it must call BT_SIGNUP; "
    + "if it is genuinely internal, add it here and say why");
});

test("PM-1 — every BT_SIGNUP caller passes the whole event, so the URL cannot be omitted", () => {
  const callers = [];
  const files = readdirSync(new URL("assets/", WEB)).filter((f) => f.endsWith(".js")).map((f) => "assets/" + f)
    .concat(readdirSync(WEB).filter((f) => f.endsWith(".js")));
  for (const f of files) {
    const src = blankComments(read(f));
    if (f === "assets/config.js") continue; // the definition, not a call
    for (const m of src.matchAll(/BT_SIGNUP\s*\(([^)]*)\)/g)) callers.push(`${f}: ${m[1].trim()}`);
  }
  assert.ok(callers.length >= 4, `only ${callers.length} callers found: ${callers.join(" | ")}`);
  // TOP-LEVEL commas only. The first version rejected any comma at all and flagged
  // `BT_SIGNUP(Object.assign({ id }, ev))`, which is ONE argument containing a comma — a crude
  // detector returning a confident wrong answer, the D-33 family. Depth tracking is six lines and
  // it is exact.
  const topLevelArgs = (s) => {
    let depth = 0, n = 1;
    for (const ch of s) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      else if (ch === "," && depth === 0) n++;
    }
    return s.trim() ? n : 0;
  };
  for (const c of callers) {
    const args = c.slice(c.indexOf(":") + 1);
    assert.equal(topLevelArgs(args), 1,
      `${c} — a call with more than one argument means the old (type, id) shape survived somewhere`);
  }
  // And the old name must be gone entirely: the rename is what forced every caller to be visited.
  const stale = [];
  for (const f of files) if (blankComments(read(f)).includes("BT_SIGNUP_LINK")) stale.push(f);
  assert.deepEqual(stale, [], "the old BT_SIGNUP_LINK(type, id) shape survives — a caller can still omit the URL");
});

test("PM-1 NC — the direct-href detector sees a real one and ignores a commented one", () => {
  const live = 'x.innerHTML = `<a href="register.html?event=${e.id}">Register</a>`;';
  assert.equal([...blankComments(live).matchAll(/href="(?:register|sheet)\.html\?event=/g)].length, 1,
    "the detector cannot see a hand-built sign-up href");
  const commented = '/* was: href="register.html?event=" before BT_SIGNUP */';
  assert.equal([...blankComments(commented).matchAll(/href="(?:register|sheet)\.html\?event=/g)].length, 0,
    "a page name inside a comment is scored as a link — D-33 all over again");
});

/* ══════════════ 5. the member-facing payload carries it ══════════════ */

test("PM-1 — the public schedule payload carries external_url, or the events list cannot fork", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "PATCH", "/api/events/2", { token, body: { external_url: URL_A, external_label: "Register on Volleyball Life" } });
  const r = await call(env, "GET", "/api/schedule?view=public&from=2000-01-01&to=2099-01-01");
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const ev = (r.data.events || []).find((e) => e.id === 2);
  assert.ok(ev, "the seeded event is not in the schedule — this assertion would pass over nothing");
  assert.equal(ev.external_url, URL_A, "the schedule does not tell the page where registration happens");
  assert.equal(ev.external_label, "Register on Volleyball Life");
  const plain = (r.data.events || []).find((e) => e.id === 1);
  assert.ok(plain && !plain.external_url, "a normal event reports an external URL it does not have");
});
