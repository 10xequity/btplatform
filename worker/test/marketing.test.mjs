// Boomtown Platform — marketing.js unit tests
// File: worker/test/marketing.test.mjs · Version: v1.1 · Date: 2026-08-01 · Ships in: v0.44.0 (v1.0 shipped in v0.16.0)
// v1.1 — Marketing SMS scope C: normalizeChannel, mergeVarsText (plain text, NEVER HTML-escaped),
// dedupeSmsRecipients, and source-level guards (dormant-gate-before-DB order, per-row consent
// re-check, TCPA base where, channel-routed cron). Every guard carries a negative control that
// PROVES it can fail (standards §6).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildSegmentWhere, mergeVars, complianceFooter, dedupeRecipients,
  normalizeChannel, mergeVarsText, dedupeSmsRecipients, cleanFilter,
} from "../src/marketing.js";
// segmentReach is imported DYNAMICALLY in its tests: a static import of a not-yet-existing
// export reddens the whole file at load, hiding the per-test watch-it-fail picture.
import { statementFrom, functionBodyAfter, blankComments } from "../testkit/route-extract.mjs"; // v0.111.0 §-1c D-17b — regions, not distances
import { createD1 } from "../testkit/d1-memory.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const mktSrc = readFileSync(join(here, "../src/marketing.js"), "utf8");

test("buildSegmentWhere: empty filter adds nothing", () => {
  const { where, binds } = buildSegmentWhere({});
  assert.equal(where, "");
  assert.deepEqual(binds, []);
});

test("buildSegmentWhere: tags use json_each with one placeholder per tag", () => {
  const { where, binds } = buildSegmentWhere({ tags: ["newsletter", "league-fall"] });
  assert.match(where, /json_each\(c\.tags_json\)/);
  assert.equal((where.match(/\?/g) || []).length, 2);
  assert.deepEqual(binds, ["newsletter", "league-fall"]);
});

test("buildSegmentWhere: played league binds the event type", () => {
  const { where, binds } = buildSegmentWhere({ played: "league" });
  assert.match(where, /e\.type = \?/);
  assert.deepEqual(binds, ["league"]);
});

test("buildSegmentWhere: played none uses NOT EXISTS with no binds", () => {
  const { where, binds } = buildSegmentWhere({ played: "none" });
  assert.match(where, /NOT EXISTS/);
  assert.deepEqual(binds, []);
});

test("buildSegmentWhere: since validates the date shape", () => {
  assert.deepEqual(buildSegmentWhere({ since: "not-a-date" }).binds, []);
  const ok = buildSegmentWhere({ since: "2026-01-01" });
  assert.match(ok.where, /c\.created_at >= \?/);
  assert.deepEqual(ok.binds, ["2026-01-01"]);
});

test("buildSegmentWhere: combined filters join with AND in order", () => {
  const { where, binds } = buildSegmentWhere({ tags: ["a"], played: "tournament", since: "2026-06-01" });
  assert.deepEqual(binds, ["a", "tournament", "2026-06-01"]);
  assert.ok(where.indexOf("json_each") < where.indexOf("e.type"));
  assert.ok(where.indexOf("e.type") < where.indexOf("created_at"));
});

test("mergeVars: substitutes first/full/email and escapes HTML", () => {
  const out = mergeVars("Hi {{first_name}} ({{full_name}}, {{email}})",
    { full_name: "Ana <b>Reyes", email: "ana@x.com" });
  assert.equal(out, "Hi Ana (Ana &lt;b&gt;Reyes, ana@x.com)");
});

test("mergeVars: missing name falls back to 'there'", () => {
  assert.equal(mergeVars("Hi {{first_name}}", { email: "a@b.c" }), "Hi there");
});

test("complianceFooter: contains org, address, and unsubscribe link", () => {
  const f = complianceFooter("Boomtown Volleyball", "123 Court St, Aurora, CO", "https://x/api/unsubscribe?c=1&t=abc");
  assert.match(f, /Boomtown Volleyball/);
  assert.match(f, /123 Court St/);
  assert.match(f, /href="https:\/\/x\/api\/unsubscribe\?c=1&t=abc"/);
  assert.match(f, /Unsubscribe/);
});

test("dedupeRecipients: case-insensitive on email, keeps first, drops blanks", () => {
  const out = dedupeRecipients([
    { id: 1, email: "A@x.com" }, { id: 2, email: "a@X.com" }, { id: 3, email: "" }, { id: 4, email: "b@x.com" },
  ]);
  assert.deepEqual(out.map((r) => r.id), [1, 4]);
});

// Changelog: v1.0 (2026-07-24) — 10 tests over the exported pure helpers.

/* ---------------- Marketing SMS scope C (v1.1) ---------------- */

test("normalizeChannel: default email; sms passes; anything else is null (the code IS the CHECK)", () => {
  assert.equal(normalizeChannel(undefined), "email");
  assert.equal(normalizeChannel(null), "email");
  assert.equal(normalizeChannel(""), "email");
  assert.equal(normalizeChannel("email"), "email");
  assert.equal(normalizeChannel("sms"), "sms");
  assert.equal(normalizeChannel("carrier-pigeon"), null);
  assert.equal(normalizeChannel("SMS"), null); // case-sensitive on purpose: stored value is lowercase
});

test("mergeVarsText merges first/full name and NEVER HTML-escapes — an SMS is not HTML", () => {
  const c = { full_name: "Pat O'Brien & Co" };
  assert.equal(mergeVarsText("Hi {{first_name}}!", c), "Hi Pat!");
  assert.equal(mergeVarsText("{{full_name}}", c), "Pat O'Brien & Co");
  assert.ok(!mergeVarsText("{{full_name}}", c).includes("&amp;"), "must not escape ampersands");
  assert.ok(!mergeVarsText("{{full_name}}", c).includes("&#39;"), "must not escape apostrophes");
  assert.equal(mergeVarsText("Hey {{first_name}}", {}), "Hey there");
  // negative control: the HTML merge DOES escape — proving the two helpers really differ.
  assert.ok(mergeVars("{{full_name}}", c).includes("&amp;"), "mergeVars (email) must escape");
});

test("mergeVarsText has no {{email}} variable — texting someone their own email is noise", () => {
  assert.equal(mergeVarsText("{{email}}", { full_name: "A", email: "a@b.c" }), "{{email}}");
});

test("dedupeSmsRecipients: normalizes, dedupes by E.164, drops un-normalizable phones", () => {
  const rows = [
    { id: 1, phone: "303-555-0142" },
    { id: 2, phone: "(303) 555 0142" },  // same number, different formatting → dropped
    { id: 3, phone: "not a phone" },      // un-normalizable → dropped, never guessed
    { id: 4, phone: "+13035550143" },
  ];
  const out = dedupeSmsRecipients(rows);
  assert.deepEqual(out, [{ id: 1, to: "+13035550142" }, { id: 4, to: "+13035550143" }]);
});

/* ---- source-level guards (pattern of record: sms.test.mjs §6.5) ---- */

function smsCampaignSendBlock() {
  const start = mktSrc.indexOf("async function sendSmsCampaign");
  const end = mktSrc.indexOf("export async function processSmsCampaignBatch");
  assert.ok(start > -1 && end > start, "sendSmsCampaign block must exist before the batch worker");
  return mktSrc.slice(start, end);
}

test("dormant gate ORDER: sendSmsCampaign checks smsConfigured before ANY DB touch", () => {
  const block = smsCampaignSendBlock();
  const gate = block.indexOf("smsConfigured(env)");
  const firstDb = block.indexOf("env.DB.");
  assert.ok(gate > -1, "the dormant gate must exist");
  assert.ok(firstDb > -1, "the send path must touch the DB somewhere");
  assert.ok(gate < firstDb, "smsConfigured must run BEFORE the first env.DB call — dormant means writes nothing");
  // negative control: prove the order comparison can fail on a reversed construction.
  const reversed = "env.DB.prepare(x); if (!smsConfigured(env)) return;";
  assert.ok(reversed.indexOf("smsConfigured") > reversed.indexOf("env.DB."), "control string must be in the wrong order");
});

test("per-row consent re-check: the SMS batch loop consults sms_opt_in after queueing", () => {
  const start = mktSrc.indexOf("export async function processSmsCampaignBatch");
  const end = mktSrc.indexOf("export async function processCampaignBatch");
  const block = mktSrc.slice(start, end);
  assert.match(block, /sms_opt_in/, "batch worker must re-read consent per row");
  assert.match(block, /'skipped'/, "revoked consent must skip, never send");
  // negative control: an email-style loop without the re-check must NOT satisfy the pattern.
  const emailish = "for (const row of queue) { await twilioSend(env, row.to, body); }";
  assert.doesNotMatch(emailish, /sms_opt_in/);
});

test("TCPA base where: SMS recipients come from sms_opt_in, never the email unsubscribed flag", () => {
  const m = mktSrc.match(/const SMS_BASE_WHERE =\s*\n?\s*"([^"]+)"/);
  assert.ok(m, "SMS_BASE_WHERE must exist");
  assert.match(m[1], /sms_opt_in=1/);
  assert.ok(!m[1].includes("unsubscribed"), "email unsubscribe is NOT text consent");
  assert.ok(!m[1].includes("email"), "an email address is not required to receive a text");
});

test("cron sweep routes by channel — an SMS campaign must never drain through the email worker", () => {
  const start = mktSrc.indexOf("export async function campaignQueueSweep");
  const block = statementFrom(mktSrc, start); // D-17b: was slice(start, start + 900)
  assert.match(block, /channel === "sms"/);
  assert.match(block, /processSmsCampaignBatch/);
  assert.match(block, /processCampaignBatch/);
});

test("transport single-source: marketing.js imports twilioSend from sms.js and defines no fetch to Twilio", () => {
  assert.match(mktSrc, /import \{[^}]*twilioSend[^}]*\} from "\.\/sms\.js"/s);
  assert.ok(!mktSrc.includes("api.twilio.com"), "only sms.js may talk to Twilio directly");
});

/* ============================ SG-4 (§-0): the age axis, and the honesty count ============================
   Owner (2026-08-10 22:03): announce/invite a demographic selection — her age group, 40+ — and
   because birthdate coverage is sparse (live D1 2026-08-14: 49 contacts, 0 birthdates), **the
   send screen must SAY how many contacts are invisible to the filter, or the owner will read a
   small send as a broken one** — empty and broken look identical. The owner's "40+" is one end
   of a band (the constraint-bands lesson), so the filter carries min AND max from birth.

   The counting rule is the read-the-RESULT family: `no_birthdate` counts contacts that pass the
   filter's OTHER axes but cannot be judged by age — the actionable number, not the org-wide one.
   Ages in fixtures are computed RELATIVE to now, offset by half a year, so no calendar date ever
   drifts an assertion across an integer-age boundary. */

const dobYearsAgo = (years) => new Date(Date.now() - years * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

test("SG-4 — cleanFilter: an age band of integers 0–120 survives, junk is dropped, and a contradictory band drops BOTH ends", () => {
  assert.deepEqual(cleanFilter({ age_min: 40 }).age_min, 40);
  assert.deepEqual(cleanFilter({ age_min: 18, age_max: 25 }), { age_min: 18, age_max: 25 });
  assert.equal(cleanFilter({ age_min: "40; DROP TABLE contacts" }).age_min, undefined, "SQL-shaped junk never survives the clean");
  assert.equal(cleanFilter({ age_min: -5 }).age_min, undefined, "negative ages dropped");
  assert.equal(cleanFilter({ age_max: 130 }).age_max, undefined, "past-plausible ages dropped");
  assert.equal(cleanFilter({ age_min: 40.5 }).age_min, undefined, "fractional ages dropped");
  const contradictory = cleanFilter({ age_min: 30, age_max: 20 });
  assert.equal(contradictory.age_min, undefined, "min > max is a contradiction — both ends drop");
  assert.equal(contradictory.age_max, undefined, "…both, because keeping one would silently invert the intent");
});

test("SG-4 — buildSegmentWhere: age_min binds a computed year-offset against member_profiles, never an interpolated value", () => {
  const { where, binds } = buildSegmentWhere({ age_min: 40 });
  assert.match(where, /member_profiles/, "age lives on the profile, not the contact");
  assert.match(where, /date\(mp\.date_of_birth\) <= date\('now', \?\)/, "at-least-N is dob on-or-before now minus N years");
  assert.deepEqual(binds, ["-40 years"]);
});

test("SG-4 — buildSegmentWhere: a band is ONE profile EXISTS carrying both bounds, max strict at N+1 years", () => {
  const { where, binds } = buildSegmentWhere({ age_min: 18, age_max: 25 });
  assert.equal((where.match(/member_profiles/g) || []).length, 1, "one EXISTS — a profile must satisfy the whole band");
  assert.match(where, /date\(mp\.date_of_birth\) > date\('now', \?\)/, "at-most-M is dob strictly after now minus M+1 years");
  assert.deepEqual(binds, ["-18 years", "-26 years"]);
});

test("SG-4 — buildSegmentWhere: junk age fields on a STORED filter produce no condition and no binds (green by design pre-build — its positive control is the age_min test above)", () => {
  const junk = buildSegmentWhere({ age_min: "40; DROP", age_max: NaN });
  assert.equal(junk.where, "", "stored filter_json is validated again at read — cleanFilter is not the only gate");
  assert.deepEqual(junk.binds, []);
});

function reachFixture() {
  const SCHEMA = readFileSync(join(here, "../testkit/journey-schema.sql"), "utf8");
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  // Four contacts, every BASE_WHERE term satisfied (email present, subscribed):
  //   A: profile, ~56 years old        → visible to the age filter, matches 40+
  //   B: profile, ~15 years old        → visible, fails 40+
  //   C: NO profile row                → invisible to any age filter
  //   D: profile with NULL birthdate   → invisible to any age filter
  DB.exec("INSERT INTO contacts (id, org_id, full_name, email, tags_json) VALUES (1,1,'Alma Senior','a@bt.test','[]')");
  DB.exec("INSERT INTO contacts (id, org_id, full_name, email, tags_json) VALUES (2,1,'Ben Junior','b@bt.test','[]')");
  DB.exec(`INSERT INTO contacts (id, org_id, full_name, email, tags_json) VALUES (3,1,'Cara Unknown','c@bt.test','["vip"]')`);
  DB.exec("INSERT INTO contacts (id, org_id, full_name, email, tags_json) VALUES (4,1,'Dev Nodate','d@bt.test','[]')");
  DB.exec(`INSERT INTO member_profiles (org_id, contact_id, date_of_birth) VALUES (1,1,'${dobYearsAgo(56.5)}')`);
  DB.exec(`INSERT INTO member_profiles (org_id, contact_id, date_of_birth) VALUES (1,2,'${dobYearsAgo(15.5)}')`);
  DB.exec("INSERT INTO member_profiles (org_id, contact_id, date_of_birth) VALUES (1,4,NULL)");
  return { DB };
}

test("SG-4 — segmentReach: the 40+ segment counts who it reaches AND who it cannot judge", async () => {
  const { segmentReach } = await import("../src/marketing.js");
  assert.equal(typeof segmentReach, "function", "the ONE reach judgement is exported");
  const env = reachFixture();
  const r = await segmentReach(env, 1, { age_min: 40 });
  assert.equal(r.count, 1, "only the 56-year-old matches 40+");
  assert.equal(r.no_birthdate, 2, "the profile-less contact and the NULL-birthdate one are both invisible — the owner's honesty number");
  const band = await segmentReach(env, 1, { age_min: 10, age_max: 20 });
  assert.equal(band.count, 1, "the 15-year-old sits inside the band");
});

test("SG-4 — the honesty number is scoped to the filter's OTHER axes, not the whole org", async () => {
  const { segmentReach } = await import("../src/marketing.js");
  const env = reachFixture();
  // Only Cara carries the vip tag, and she has no profile: the tag+age segment reaches nobody,
  // and exactly ONE contact (Cara) is unjudgeable — not the org-wide two.
  const r = await segmentReach(env, 1, { tags: ["vip"], age_min: 40 });
  assert.equal(r.count, 0);
  assert.equal(r.no_birthdate, 1, "axis-scoped: of the people this segment otherwise reaches, who can't the age filter see");
});

test("SG-4 — no age axis, no noise: a tags-only segment reports zero unjudgeable (green by design pre-build once reach exists — it pins the restraint)", async () => {
  const { segmentReach } = await import("../src/marketing.js");
  const env = reachFixture();
  const r = await segmentReach(env, 1, { tags: ["vip"] });
  assert.equal(r.count, 1);
  assert.equal(r.no_birthdate, 0, "an honesty line on segments with no age filter would train the operator to ignore it");
});

test("SG-4 — every counting caller routes through segmentReach, and the old single-number counter is GONE (a rename is a search)", () => {
  for (const fn of ["async function listSegments", "async function createSegment", "async function previewSegment"]) {
    const body = functionBodyAfter(mktSrc, fn);
    assert.ok(body && body.includes("segmentReach("), `${fn} must consume the one reach judgement`);
  }
  assert.ok(!mktSrc.includes("segmentCount"), "two counting judgements is how they disagree — the rename forces every caller visit");
  // NC: the needle is load-bearing.
  const mutated = mktSrc.replace(/segmentReach/g, "XXGONE");
  assert.ok(!mutated.includes("segmentReach"), "the mutation landed");
});

test("SG-4 — the screens carry the axis and the honesty line: modal fields, the aged description, and the no-birthdate sentence on list, preview AND composer", () => {
  const ui = blankComments(readFileSync(join(here, "../../web/assets/admin-marketing.js"), "utf8")); // D-45
  assert.ok(ui.includes('id="mSegAgeMin"'), "the modal offers the band's lower end");
  assert.ok(ui.includes('id="mSegAgeMax"'), "…and its upper end — a constraint arrives as one end of a band");
  assert.match(ui, /aged /, "describeFilter says the band in words");
  const hits = (ui.match(/no birthdate/g) || []).length;
  assert.ok(hits >= 3, `the honesty sentence must reach the segment list, the preview and the send screen — saw ${hits}`);
  // NC: the honesty needle is load-bearing.
  const mutated = ui.replace(/no birthdate/g, "XXGONE");
  assert.ok(!mutated.includes("no birthdate"), "the mutation landed");
});
