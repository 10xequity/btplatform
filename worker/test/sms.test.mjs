/* Boomtown Platform — SMS tests (req #17 phase 3)
   File: worker/test/sms.test.mjs · Version: v1.0 · Date: 2026-07-31 · Ships in: v0.42.0
   Pure helpers · Twilio signature validated against an INDEPENDENT node:crypto oracle ·
   §6.5 delivery gates (dispatch table + wireSms call sites, never the import line) ·
   source-level org-scope guard confined outside the marked COMPLIANCE-CROSS-ORG block ·
   signature-before-DB order guard for the public webhook. Every guard ships a negative
   control that PROVES it can fail (standards §6, tokens.test.mjs precedent). */
import { test } from "node:test";
import { mountsAndWires } from "../testkit/route-extract.mjs";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  normalizePhone, classifyInbound, quietHoursBlocked, smsConfigured,
  validateTwilioSignature, SMS_MAX, ORG_SENDS_PER_DAY,
} from "../src/sms.js";

const here = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(here, "../src/index.js"), "utf8");
const smsSrc = readFileSync(join(here, "../src/sms.js"), "utf8");

/* ---------------- normalizePhone ---------------- */

test("normalizePhone: 10-digit US gets +1; 1+10 gets +; E.164 passes through", () => {
  assert.equal(normalizePhone("303-555-0142"), "+13035550142");
  assert.equal(normalizePhone("(303) 555 0142"), "+13035550142");
  assert.equal(normalizePhone("13035550142"), "+13035550142");
  assert.equal(normalizePhone("+13035550142"), "+13035550142");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
});

test("normalizePhone: garbage, short, empty and null are null — never guessed", () => {
  assert.equal(normalizePhone("555-0142"), null);
  assert.equal(normalizePhone("not a phone"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
  assert.equal(normalizePhone("+12"), null); // 2 digits after + — too short
});

/* ---------------- classifyInbound ---------------- */

test("classifyInbound covers Twilio Advanced Opt-Out keyword classes", () => {
  for (const w of ["STOP", "stop", " Stop ", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])
    assert.equal(classifyInbound(w), "stop");
  for (const w of ["START", "yes", "UNSTOP"]) assert.equal(classifyInbound(w), "start");
  for (const w of ["HELP", "info"]) assert.equal(classifyInbound(w), "help");
  assert.equal(classifyInbound("What court am I on?"), "other");
  assert.equal(classifyInbound(""), "other");
  assert.equal(classifyInbound("please stop"), "other"); // sentence ≠ keyword (Twilio rule)
});

/* ---------------- quietHoursBlocked (America/Denver window 8am–9pm) ---------------- */

test("quietHoursBlocked: 3am MDT blocked, noon MDT allowed (July, UTC-6)", () => {
  assert.equal(quietHoursBlocked(new Date("2026-07-31T09:00:00Z")), true);  // 03:00 MDT
  assert.equal(quietHoursBlocked(new Date("2026-07-31T18:00:00Z")), false); // 12:00 MDT
});

test("quietHoursBlocked: boundaries — 8am allowed, 9pm blocked; winter uses MST (UTC-7)", () => {
  assert.equal(quietHoursBlocked(new Date("2026-07-31T14:00:00Z")), false); // 08:00 MDT exact
  assert.equal(quietHoursBlocked(new Date("2026-08-01T03:00:00Z")), true);  // 21:00 MDT exact
  assert.equal(quietHoursBlocked(new Date("2026-01-15T16:00:00Z")), false); // 09:00 MST
  assert.equal(quietHoursBlocked(new Date("2026-01-16T04:30:00Z")), true);  // 21:30 MST
});

/* ---------------- smsConfigured / limits ---------------- */

test("smsConfigured is true only with all three Twilio secrets — anything less fails closed", () => {
  assert.equal(smsConfigured({}), false);
  assert.equal(smsConfigured(null), false);
  assert.equal(smsConfigured({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" }), false);
  assert.equal(smsConfigured({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_MESSAGING_SERVICE_SID: "MG1" }), true);
});

test("limits are sane: body cap is 3 segments, daily cap is a tournament not a cannon", () => {
  assert.equal(SMS_MAX, 480);
  assert.equal(ORG_SENDS_PER_DAY, 500);
});

/* ---------------- validateTwilioSignature vs an independent oracle ---------------- */

const SIG_URL = "https://boomtown-api.example/api/sms/inbound";
const SIG_PARAMS = { From: "+13035550100", Body: "STOP", MessageSid: "SM123" };
const SIG_TOKEN = "testtoken-not-a-secret";
function oracle(token, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", token).update(data).digest("base64");
}

test("validateTwilioSignature agrees with an independent node:crypto HMAC-SHA1 oracle", async () => {
  const sig = oracle(SIG_TOKEN, SIG_URL, SIG_PARAMS);
  assert.equal(await validateTwilioSignature(SIG_TOKEN, SIG_URL, SIG_PARAMS, sig), true);
});

test("validateTwilioSignature rejects tampered body, wrong token, and missing signature", async () => {
  const sig = oracle(SIG_TOKEN, SIG_URL, SIG_PARAMS);
  assert.equal(await validateTwilioSignature(SIG_TOKEN, SIG_URL, { ...SIG_PARAMS, Body: "START" }, sig), false);
  assert.equal(await validateTwilioSignature("wrong-token", SIG_URL, SIG_PARAMS, sig), false);
  assert.equal(await validateTwilioSignature(SIG_TOKEN, SIG_URL, SIG_PARAMS, ""), false);
  assert.equal(await validateTwilioSignature(SIG_TOKEN, SIG_URL + "?x=1", SIG_PARAMS, sig), false);
});

/* ---------------- §6.5 delivery gates — call sites, never the import line ---------------- */

test("index.js mounts smsRoutes in the dispatch table (§6.5)", () => {
  assert.ok(/\["sms",\s+smsRoutes\],/.test(indexSrc),
    "smsRoutes is imported but never dispatched — built-but-uncalled (failure class 1)");
});

test("index.js calls wireSms with the injected helpers (§6.5)", () => {
  assert.ok(mountsAndWires(indexSrc, "Sms"),
    "wireSms is never called — module helpers would be undefined at runtime");
});

/* ---------------- source guard A: org scope outside the compliance block ---------------- */

/** Strip the ONE permitted cross-org block, then demand org_id on every SQL template
    that touches sms_log, contacts, registrations or events. */
function orgScopeGuard(src) {
  const start = src.indexOf("/* COMPLIANCE-CROSS-ORG");
  const end = src.indexOf("END COMPLIANCE-CROSS-ORG");
  assert.ok(start > 0 && end > start, "compliance block markers missing — guard would scan the wrong set");
  const stripped = src.slice(0, start) + src.slice(end);
  const templates = stripped.match(/`[^`]*`/gs) || [];
  const sql = templates.filter((t) => /sms_log|contacts|registrations|FROM events/i.test(t));
  assert.ok(sql.length >= 5, `guard expected ≥5 scoped SQL statements, saw ${sql.length} — an empty scan is no guard`);
  for (const t of sql) {
    // A JOIN condition like `c.org_id = s.org_id` must NOT satisfy the guard — only a
    // parameter-BOUND filter (org_id=?N) or an INSERT that lists org_id as a column does.
    const bound = /org_id\s*=\s*\?/.test(t);
    const insertScoped = /^\s*`?\s*INSERT INTO \w+ \([^)]*\borg_id\b/i.test(t);
    assert.ok(bound || insertScoped, `unscoped SQL outside the compliance block: ${t.slice(0, 90)}…`);
  }
}

test("every SQL statement outside the compliance block is org-scoped", () => {
  orgScopeGuard(smsSrc);
});

test("NC-1: removing one org_id from the real source fails the org-scope guard", () => {
  const mutated = smsSrc.replace("WHERE s.org_id=?1 AND s.deleted_at IS NULL", "WHERE s.deleted_at IS NULL");
  assert.notEqual(mutated, smsSrc, "mutation did not land — NC is vacuous");
  assert.throws(() => orgScopeGuard(mutated), "guard passed unscoped SQL — worse than no guard (failure class 3)");
});

/* ---------------- source guard B: webhook validates BEFORE any DB touch ---------------- */

function signatureOrderGuard(src) {
  const hStart = src.indexOf('"/api/sms/inbound"');
  const hEnd = src.indexOf('"/api/admin/sms"');
  assert.ok(hStart > 0 && hEnd > hStart, "inbound handler not found where expected");
  const handler = src.slice(hStart, hEnd);
  const v = handler.indexOf("validateTwilioSignature");
  const db = handler.indexOf("env.DB");
  assert.ok(v > -1, "webhook never validates the Twilio signature");
  assert.ok(handler.includes("if (!ok) return"), "webhook validates but never rejects on failure");
  assert.ok(db === -1 || v < db, "webhook touches the database before validating the signature");
}

test("inbound webhook checks X-Twilio-Signature before touching the database", () => {
  signatureOrderGuard(smsSrc);
});

test("NC-2: stripping the signature check from the real source fails the order guard", () => {
  // \s* not \n\s* — core.autocrlf checks this file out CRLF on Windows, and a literal \n
  // never matched, so the mutation silently no-opped and the NC proved nothing locally.
  const mutated = smsSrc.replace(/const ok = await validateTwilioSignature\([\s\S]*?\);\s*if \(!ok\) return[^;]*;/, "const ok = true;");
  assert.notEqual(mutated, smsSrc, "mutation did not land — NC is vacuous");
  assert.throws(() => signatureOrderGuard(mutated), "guard passed an unvalidated webhook");
});

/* ---------------- source guard C: send path fails closed when unconfigured ---------------- */

test("the send route and the webhook both gate on smsConfigured (fails closed)", () => {
  const gates = smsSrc.match(/if \(!smsConfigured\(env\)\)/g) || [];
  assert.ok(gates.length >= 2, `expected the OFF gate on ≥2 routes, saw ${gates.length}`);
});
