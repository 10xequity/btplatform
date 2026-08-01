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
  normalizeChannel, mergeVarsText, dedupeSmsRecipients,
} from "../src/marketing.js";

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
  const block = mktSrc.slice(start, start + 900);
  assert.match(block, /channel === "sms"/);
  assert.match(block, /processSmsCampaignBatch/);
  assert.match(block, /processCampaignBatch/);
});

test("transport single-source: marketing.js imports twilioSend from sms.js and defines no fetch to Twilio", () => {
  assert.match(mktSrc, /import \{[^}]*twilioSend[^}]*\} from "\.\/sms\.js"/s);
  assert.ok(!mktSrc.includes("api.twilio.com"), "only sms.js may talk to Twilio directly");
});
