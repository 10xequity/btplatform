/* Boomtown Platform — auth surfaces must not report security they do not have
   File: worker/test/auth_surface_honesty.test.mjs · Version: v2.0 · Date: 2026-08-09 · Ships in: v0.114.0

   v2.0 adds the PASSKEY REMOVE defect, found by an eight-agent adversarial audit of the auth
   surface. Two defects, one theme, and the theme is the point: a control that reports success it
   did not achieve is worse than one that visibly fails, because nothing prompts anyone to look.

   THE OWNER BELIEVED THIS PRODUCT HAD TWO-FACTOR AUTH. It does not, and the belief has an obvious
   source: the admin Users screen renders a column headed **2FA** that reads "On" or "Off" for every
   user. It is fed by `users.totp_enabled`, a column created in migration 0001 and — measured across
   the whole worker — **read in two places and written in none.**

   So the column can only ever say "Off", for every user, forever. That is not a cosmetic problem.
   It is a SECURITY DISPLAY THAT INVENTS A FACT: an admin reading it concludes that two-factor exists
   and is merely switched off, when there is no TOTP implementation anywhere to switch on. The
   product's own header comments say so plainly — `index.js` and `webauthn.js` both record that
   passkeys REPLACED the planned TOTP. The plan was dropped; the column outlived it.

   WHAT MAKES THIS WORTH A GUARD RATHER THAN A ONE-LINE EDIT. This repository has paid for the same
   class of defect repeatedly: a feature whose interface is complete and whose substance is absent
   ("view as member" was presentation-only for eleven weeks). A display is the cheapest place for
   that to happen, because nothing crashes and no test fails — the number is simply not connected to
   anything. The check below is therefore about the CONNECTION, not the wording.

   AND THE REPLACEMENT IS REAL, WHICH IS THE POINT. Passkeys are fully built and live: `webauthn.js`
   verifies assertions with `crypto.subtle.verify` (ES256/RS256), checks the RP ID hash, and enforces
   signature counters for clone detection; `web/assets/passkey.js` calls `navigator.credentials`
   create and get; the live worker answers `/api/passkey/login-options`. `webauthn_credentials` is a
   table that real rows can land in, so a passkey count is a fact the screen can honestly report. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { blankComments, statementStart, statementFrom } from "../testkit/route-extract.mjs";

/**
 * Every statement in `t` that both mentions `col` and is a write.
 *
 * §-1c D-17b, EIGHTH INSTANCE, AND `marker_hygiene.test.mjs` CAUGHT IT IN THIS FILE'S FIRST RUN.
 * The detector was originally `/(UPDATE|INSERT INTO)[\s\S]{0,600}?totp_enabled =/` — a
 * character-distance window, which is a spelling, and precisely what the scanner shipped in
 * v0.111.0 exists to refuse. A long SQL string would slide the column past 600 characters and the
 * measurement would silently report "nothing writes it" for a worker that does.
 *
 * So the region is the enclosing STATEMENT, brace- and semicolon-bounded, which cannot be
 * knocked out of alignment by length at all.
 */
function writeStatementsFor(t, col) {
  const out = [];
  for (const m of t.matchAll(new RegExp(`\\b${col}\\b`, "g"))) {
    const stmt = statementFrom(t, statementStart(t, m.index));
    if (/\b(UPDATE|INSERT\s+INTO)\b/i.test(stmt) && new RegExp(`\\b${col}\\b\\s*=`).test(stmt)) {
      out.push(stmt.replace(/\s+/g, " ").slice(0, 90));
    }
  }
  return out;
}

const SRC_DIR = new URL("../src/", import.meta.url);
const src = (f) => blankComments(readFileSync(new URL(f, SRC_DIR), "utf8"));

const ADMIN = src("admin.js");
const INDEX = src("index.js");
const USERS_JS = blankComments(
  readFileSync(new URL("../../web/assets/admin-users.js", import.meta.url), "utf8"));
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");

/* ===================== the premise, asserted rather than assumed ===================== */

test("the premise: totp_enabled exists in the schema", () => {
  assert.match(SCHEMA, /totp_enabled/,
    "if this column is gone the whole file is about something that no longer exists");
});

test("THE DECISIVE MEASUREMENT: nothing in the worker ever writes totp_enabled", () => {
  /* If this ever fails, TOTP has actually been built — and the correct response is NOT to delete
     this test. It is to restore a two-factor column to the Users screen, because at that point the
     column would finally be reporting something real. The failure message says so. */
  const offenders = [];
  const files = readdirSync(SRC_DIR).filter((n) => n.endsWith(".js"));
  assert.ok(files.length > 40, `expected the whole worker, scanned ${files.length} files`);
  for (const f of files) {
    for (const stmt of writeStatementsFor(src(f), "totp_enabled")) offenders.push(`${f}: ${stmt}`);
  }
  assert.deepEqual(offenders, [],
    "totp_enabled is now written somewhere — TOTP appears to be real. Put a two-factor column back " +
    "on the admin Users screen and rewrite this guard around the new truth:\n" + offenders.join("\n"));
});

/* ===================== the display must not claim what does not exist ===================== */

test("the admin Users screen no longer presents a 2FA status", () => {
  assert.doesNotMatch(USERS_JS, /totp_enabled/,
    "the screen still reads a column nothing writes — it can only ever render 'Off'");
  assert.doesNotMatch(USERS_JS, />\s*2FA\s*</,
    "a 2FA column header promises a factor this product does not implement");
});

test("the Users API sends a passkey count, which is a fact it can actually know", () => {
  // webauthn_credentials is a real table with real rows, so this number is connected to something.
  assert.match(ADMIN, /webauthn_credentials/,
    "the users query must derive its security column from the credentials table");
  assert.match(ADMIN, /AS\s+passkeys/i, "and expose it under a name the screen can render");
});

test("the screen renders that count, so the API field is not sent into a void", () => {
  // Assert the CALL SITE as well as the definition, in both directions — a field added to a
  // response and never rendered is the same defect in the opposite direction.
  assert.match(USERS_JS, /\.passkeys\b/, "the screen must read the passkey count the API sends");
  assert.match(USERS_JS, />\s*Passkey/i, "and label the column for what it is");
});

test("/api/me stops sending a totp flag no client reads", () => {
  // Measured before removal: no file under web/ or worker/test/ referenced user.totp_enabled.
  // Dead data in a response is where the next reader's wrong belief comes from.
  const me = INDEX.slice(INDEX.indexOf("async function me("), INDEX.indexOf("async function listOrgs("));
  assert.ok(me.length > 0, "the me() handler must exist for this check to mean anything");
  assert.doesNotMatch(me, /totp_enabled/, "/api/me must not carry the phantom flag");
  assert.match(me, /webauthn_credentials/, "it already reports a real passkey count — that stays");
});

/* ===================== negative controls ===================== */

test("NC-1: the write-detector fires on a planted UPDATE", () => {
  // An assertion whose expected value is an empty list can be incapable of firing. Prove it is not.
  const planted = 'await env.DB.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?1").run();';
  assert.equal(writeStatementsFor(planted, "totp_enabled").length, 1,
    "the detector must catch a real write, or the measurement above is vacuous");
  // And it must stay silent on a mere READ, or it would accuse admin.js of writing what it selects.
  assert.deepEqual(writeStatementsFor('const u = await q("SELECT totp_enabled FROM users");', "totp_enabled"), [],
    "selecting a column is not writing it");
});

test("NC-2: the display guard fires if the 2FA column comes back", () => {
  const broken = USERS_JS.replace(/<th>Passkey<\/th>/i, "<th>2FA</th>");
  assert.notEqual(broken, USERS_JS, "MUTATION DID NOT LAND — the Passkey header was not found");
  assert.match(broken, />\s*2FA\s*</, "with the header restored the guard above must redden");
});

/* ===================== the passkey Remove button (v2.0) =====================

   FOUND BY ADVERSARIAL AUDIT, 2026-08-09. `list()` returns `credential_id` and `device_label`;
   `settings.js` read `k.id` and `k.nickname || k.device`. None of those three field names exist in
   the response, so:

     · every enrolled passkey rendered as the generic fallback "Passkey", making two devices
       indistinguishable — you cannot tell which one you are removing;
     · `data-remove` was the empty string, so Remove posted `credential_id: ""`, which matches no
       row (the column is NOT NULL UNIQUE);
     · and `remove()` returned `{ ok: true }` and wrote a `passkey.remove` AUDIT ROW anyway.

   THE SERVER HALF IS THE DEEPER BUG. Fixing only the client would leave a handler that reports
   success and records a security event for an UPDATE that changed nothing — the audit log, which
   exists to be believed, would keep logging removals that never happened for any future caller. */

test("the Remove control reads the field names the API actually sends", () => {
  const SETTINGS = blankComments(
    readFileSync(new URL("../../web/assets/settings.js", import.meta.url), "utf8"));
  const WEBAUTHN = src("webauthn.js");

  // Both directions: what list() selects, and what the screen reads.
  assert.match(WEBAUTHN, /SELECT credential_id, device_label/, "list() must still send these fields");
  assert.match(SETTINGS, /\.credential_id\b/, "the screen must key Remove on credential_id");
  assert.match(SETTINGS, /\.device_label\b/, "and label each device by the stored device_label");
  assert.doesNotMatch(SETTINGS, /k\.id\b/, "k.id is a field the passkey list has never returned");
  assert.doesNotMatch(SETTINGS, /k\.nickname\b/, "nor k.nickname");
});

test("remove() refuses to report success, or audit, when nothing was removed", () => {
  const WEBAUTHN = src("webauthn.js");
  const fn = WEBAUTHN.slice(WEBAUTHN.indexOf("async function remove("));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.ok(body.includes("meta.changes"),
    "the handler must inspect how many rows actually changed");
  const changesAt = body.indexOf("meta.changes");
  const auditAt = body.indexOf("H.audit");
  assert.ok(changesAt < auditAt,
    "the rows-changed check must come BEFORE the audit write, or the log records a removal that did not happen");
});

test("NC-3: the field-name guard fires if the screen reverts to k.id", () => {
  const SETTINGS = blankComments(
    readFileSync(new URL("../../web/assets/settings.js", import.meta.url), "utf8"));
  const broken = SETTINGS.replace(/\.credential_id\b/, ".id");
  assert.notEqual(broken, SETTINGS, "MUTATION DID NOT LAND — credential_id was not found");
  assert.doesNotMatch(broken, /\.credential_id\b/,
    "with the correct field gone the guard above must redden");
});
