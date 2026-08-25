/* Boomtown Platform — membership custom-field registry tests (M22)
   File: worker/test/member_fields.test.mjs · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.57.0

   Three layers, because each catches a different class:
     1. Pure functions — slug stability, option hygiene, per-type validation, fail-closed select.
     2. Source guards (§6.5/F-15) — the module is MOUNTED and WIRED, every SQL statement is
        org-scoped, and the member routes filter member_visible in SQL rather than in the mapper.
     3. Live routes through the real router, on the v0.57.0 in-memory D1 harness — the staff/member
        boundary asserted against the server, not against a comment claiming it holds.

   Every guard ships a negative control that mutates real input and proves it can fail. */
import { test } from "node:test";
import { mountsAndWires, blankComments } from "../testkit/route-extract.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import {
  slugifyKey, coerceOptions, normalizeFieldInput, validateValue,
  FIELD_TYPES, MAX_FIELDS_PER_ORG, MAX_VALUE_LEN,
} from "../src/member_fields.js";

const SRC = blankComments(readFileSync(new URL("../src/member_fields.js", import.meta.url), "utf8")); // D-45
const INDEX_SRC = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

/* ============================ 1. pure functions ============================ */

test("slugifyKey produces a stable handle a rename cannot orphan", () => {
  assert.equal(slugifyKey("Shirt size"), "shirt_size");
  assert.equal(slugifyKey("  Emergency Contact!  "), "emergency_contact");
  assert.equal(slugifyKey("Player's #1 nickname"), "players_1_nickname");
  assert.equal(slugifyKey("Größe"), "gr_e");
});

test("NC-1: a label with nothing sluggable yields an empty key, which the caller must reject", () => {
  assert.equal(slugifyKey("!!!"), "");
  assert.equal(slugifyKey(""), "");
  assert.equal(normalizeFieldInput({ label: "!!!" }).ok, false, "an unsluggable label must not create a field");
});

test("coerceOptions trims, drops blanks, dedupes and caps", () => {
  assert.deepEqual(coerceOptions([" S ", "M", "", "M", null, "L"]), ["S", "M", "L"]);
  assert.deepEqual(coerceOptions("not an array"), []);
  assert.equal(coerceOptions(Array.from({ length: 200 }, (_, i) => `o${i}`)).length, 40);
});

test("normalizeFieldInput enforces the type list and dropdown choices", () => {
  assert.equal(normalizeFieldInput({ label: "Size", field_type: "carrier_pigeon" }).ok, false);
  assert.equal(normalizeFieldInput({ label: "Size", field_type: "select", options: ["S"] }).ok, false,
    "a one-choice dropdown is a mistake, not a dropdown");
  const ok = normalizeFieldInput({ label: "Size", field_type: "select", options: ["S", "M"] });
  assert.equal(ok.ok, true);
  assert.equal(JSON.parse(ok.value.options_json).length, 2);
});

test("normalizeFieldInput defaults: member-visible on, forms off, active on", () => {
  const v = normalizeFieldInput({ label: "Allergies" }).value;
  assert.equal(v.member_visible, 1, "a field should be the member's to see unless told otherwise");
  assert.equal(v.show_on_forms, 0, "nothing joins the public signup form by accident");
  assert.equal(v.active, 1);
  assert.equal(v.required, 0);
});

test("the key is immutable across a rename — values must never orphan", () => {
  const created = normalizeFieldInput({ label: "Shirt size" }).value;
  const renamed = normalizeFieldInput({ label: "Jersey size" }, { existingKey: created.field_key }).value;
  assert.equal(renamed.field_key, "shirt_size", "renaming the label must not repoint the key");
  assert.equal(renamed.label, "Jersey size");
});

test("validateValue: per-type rules", () => {
  const f = (o) => ({ label: "F", required: 0, options_json: "[]", ...o });
  assert.equal(validateValue(f({ field_type: "email" }), "nope").ok, false);
  assert.equal(validateValue(f({ field_type: "email" }), "a@b.co").value, "a@b.co");
  assert.equal(validateValue(f({ field_type: "number" }), "12.5").value, "12.5");
  assert.equal(validateValue(f({ field_type: "number" }), "twelve").ok, false);
  assert.equal(validateValue(f({ field_type: "date" }), "2026-08-31").value, "2026-08-31");
  assert.equal(validateValue(f({ field_type: "date" }), "31/08/2026").ok, false);
  assert.equal(validateValue(f({ field_type: "text" }), "  hi  ").value, "hi");
});

test("validateValue: blank is fine when optional, refused when required", () => {
  const opt = { label: "Nickname", field_type: "text", required: 0, options_json: "[]" };
  const req = { ...opt, label: "Emergency contact", required: 1 };
  assert.equal(validateValue(opt, "").value, null, "an empty optional answer must not block the save");
  assert.equal(validateValue(opt, null).value, null);
  const r = validateValue(req, "");
  assert.equal(r.ok, false);
  assert.match(r.error, /Emergency contact is required/);
});

test("validateValue: a checkbox is yes/no, and required means it must be yes", () => {
  const box = { label: "Agree to gym rules", field_type: "checkbox", required: 0, options_json: "[]" };
  assert.equal(validateValue(box, true).value, "1");
  assert.equal(validateValue(box, "yes").value, "1");
  assert.equal(validateValue(box, false).value, "0");
  assert.equal(validateValue(box, undefined).value, "0", "an unticked box is a real answer, not a missing one");
  assert.equal(validateValue({ ...box, required: 1 }, false).ok, false);
});

test("NC-2: a select FAILS CLOSED — off-list and corrupt option lists both reject", () => {
  const sel = { label: "Size", field_type: "select", required: 0, options_json: '["S","M"]' };
  assert.equal(validateValue(sel, "M").value, "M");
  assert.equal(validateValue(sel, "XXL").ok, false, "an off-list choice must be refused");
  assert.equal(validateValue({ ...sel, options_json: "{{corrupt" }, "M").ok, false,
    "an unparseable options list must reject the write, not accept anything");
  assert.equal(validateValue({ ...sel, options_json: "null" }, "M").ok, false);
});

test("NC-3: an over-long value is refused rather than silently truncated", () => {
  const f = { label: "Bio", field_type: "textarea", required: 0, options_json: "[]" };
  const r = validateValue(f, "x".repeat(MAX_VALUE_LEN + 1));
  assert.equal(r.ok, false, "silently truncating someone's answer loses data without telling them");
});

/* ============================ 2. source guards ============================ */

test("§6.5: index.js MOUNTS and WIRES the module (F-15 — call sites, not imports)", () => {
  assert.ok(/\["memberFields",\s+memberFieldsRoutes\],/.test(INDEX_SRC),
    "memberFieldsRoutes is imported but never dispatched — built-but-uncalled (failure class 1)");
  assert.ok(mountsAndWires(INDEX_SRC, "MemberFields"),
    "wireMemberFields is never called — every helper would be undefined at runtime");
});

test("NC-4: the mount gate can fail", () => {
  const mutated = INDEX_SRC.replace(/\["memberFields",\s+memberFieldsRoutes\],/, "");
  assert.notEqual(mutated, INDEX_SRC, "mutation did not land — NC is vacuous");
  assert.ok(!/\["memberFields",\s+memberFieldsRoutes\],/.test(mutated));
});

test("every SQL statement in the module is org-scoped (F-11)", () => {
  const templates = SRC.match(/`[^`]*`/gs) || [];
  const sql = templates.filter((t) => /member_fields|member_field_values|FROM contacts/i.test(t));
  assert.ok(sql.length >= 8, `guard floor: expected >=8 scoped statements, saw ${sql.length} — an empty scan is no guard`);
  for (const t of sql) {
    const bound = /org_id\s*=\s*\?/.test(t);
    const insertScoped = /INSERT INTO \w+ \([^)]*\borg_id\b/i.test(t);
    assert.ok(bound || insertScoped, `unscoped SQL: ${t.replace(/\s+/g, " ").slice(0, 110)}…`);
  }
});

test("member routes filter member_visible in SQL, not in the response mapper", () => {
  // Filtering after loading means a staff-only field has already been read into memory and is one
  // careless spread away from the wire. The SQL must never select it.
  const memberBlocks = SRC.split('p === "/api/profile/fields"').slice(1);
  assert.equal(memberBlocks.length, 2, "expected exactly the GET and PUT member routes");
  for (const b of memberBlocks) {
    const stmt = b.slice(0, b.indexOf("bind(ctx.orgId"));
    assert.match(stmt, /member_visible=1/,
      "a member route loaded fields without filtering member_visible in SQL");
  }
});

test("NC-5: the member_visible guard can fail", () => {
  const mutated = SRC.replace(/AND active=1 AND member_visible=1/g, "AND active=1");
  assert.notEqual(mutated, SRC, "mutation did not land — NC is vacuous");
  assert.ok(!/member_visible=1/.test(mutated.split('p === "/api/profile/fields"')[1] || ""),
    "with the filter stripped the guard must see it missing");
});

/* ============================ 3. live routes ============================ */

/* The tables this file needs now come from `journey-schema.sql`, which since v0.81.0 carries every
   table the migrations create. They used to be hand-rolled here, appended to the schema string —
   which is precisely how the harness came to be missing half the database without anything going
   red: a test that invents its own schema passes whatever the real one looks like. */
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8") + `
CREATE UNIQUE INDEX ux_member_fields_live_key ON member_fields (org_id, field_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_member_field_values_live ON member_field_values (org_id, contact_id, field_id) WHERE deleted_at IS NULL;
`;
const ORIGIN = "https://boomtown.test";

function boot() {
  const DB = createD1(SCHEMA);
  DB.exec(`INSERT INTO orgs (id, name, slug, active) VALUES (1, 'Boomtown Athletics', 'boomtown', 1);`);
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

async function signIn(env, email, role) {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const token = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token } });
  const u = env.DB.one("SELECT id FROM users WHERE email=?1", email);
  env.DB.exec(`INSERT INTO user_org_roles (user_id, org_id, role) VALUES (${u.id}, 1, '${role}')
               ON CONFLICT(user_id, org_id) DO UPDATE SET role='${role}'`);
  env.DB.exec(`INSERT INTO contacts (org_id, user_id, email, full_name) VALUES (1, ${u.id}, '${email}', 'Test Person')`);
  return v.data.token;
}

test("live: staff creates a field, a member fills it in", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");

  const made = await call(env, "POST", "/api/admin/member-fields", {
    token: staff, body: { label: "Shirt size", field_type: "select", options: ["S", "M", "L"], member_visible: true },
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(made.data.field.key, "shirt_size");

  const mine = await call(env, "GET", "/api/profile/fields", { token: member });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.fields.length, 1);

  const saved = await call(env, "PUT", "/api/profile/fields", {
    token: member, body: { values: { shirt_size: "M" } },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const row = env.DB.one("SELECT value FROM member_field_values WHERE field_id=?1", made.data.field.id);
  assert.equal(row.value, "M", "the answer was accepted but never stored");
  env.DB.close();
});

test("live: a staff-only field is invisible to the member, and unwritable by them", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");

  const made = await call(env, "POST", "/api/admin/member-fields", {
    token: staff, body: { label: "Coach notes", field_type: "textarea", member_visible: false },
  });
  assert.equal(made.status, 200);
  await call(env, "PUT", `/api/admin/members/${env.DB.one("SELECT id FROM contacts WHERE email='member@bt.test'").id}/fields`, {
    token: staff, body: { values: { coach_notes: "Struggles with serve receive." } },
  });

  const mine = await call(env, "GET", "/api/profile/fields", { token: member });
  assert.equal(mine.data.fields.length, 0, "a staff-only field was returned to the member it is about");
  assert.equal(JSON.stringify(mine.data.values), "{}", "the staff-only VALUE leaked to the member");

  const attempt = await call(env, "PUT", "/api/profile/fields", {
    token: member, body: { values: { coach_notes: "Actually I'm great" } },
  });
  assert.equal(attempt.status, 400, "a member wrote to a staff-only field");
  env.DB.close();
});

test("live: hide ≠ delete — deactivating keeps every answer", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const member = await signIn(env, "member@bt.test", "member");
  const made = await call(env, "POST", "/api/admin/member-fields", {
    token: staff, body: { label: "Allergies", field_type: "text" },
  });
  await call(env, "PUT", "/api/profile/fields", { token: member, body: { values: { allergies: "Peanuts" } } });

  await call(env, "PATCH", `/api/admin/member-fields/${made.data.field.id}`, { token: staff, body: { active: false } });
  const hidden = await call(env, "GET", "/api/profile/fields", { token: member });
  assert.equal(hidden.data.fields.length, 0, "a hidden field still showed on the member profile");
  assert.equal(
    env.DB.one("SELECT value FROM member_field_values WHERE field_id=?1", made.data.field.id).value, "Peanuts",
    "hiding a field destroyed the answers — hide must never mean delete");

  await call(env, "PATCH", `/api/admin/member-fields/${made.data.field.id}`, { token: staff, body: { active: true } });
  const back = await call(env, "GET", "/api/profile/fields", { token: member });
  assert.equal(back.data.values[made.data.field.id], "Peanuts", "turning the field back on did not restore the answer");
  env.DB.close();
});

test("live: a member cannot reach the admin registry at all", async () => {
  const env = boot();
  const member = await signIn(env, "member@bt.test", "member");
  for (const [m, p] of [["GET", "/api/admin/member-fields"], ["POST", "/api/admin/member-fields"]]) {
    const r = await call(env, m, p, m === "GET" ? { token: member } : { token: member, body: { label: "Sneaky" } });
    assert.equal(r.status, 403, `${m} ${p} let a member through (${r.status})`);
  }
  env.DB.close();
});

test("live: re-creating a hidden field points you at the existing one instead of losing data", async () => {
  const env = boot();
  const staff = await signIn(env, "staff@bt.test", "admin");
  const made = await call(env, "POST", "/api/admin/member-fields", { token: staff, body: { label: "Allergies" } });
  await call(env, "PATCH", `/api/admin/member-fields/${made.data.field.id}`, { token: staff, body: { active: false } });

  const again = await call(env, "POST", "/api/admin/member-fields", { token: staff, body: { label: "Allergies" } });
  assert.equal(again.status, 409);
  assert.equal(again.data.existing_id, made.data.field.id);
  assert.match(again.data.error, /hidden/, "the error must say the field exists but is hidden, not just 'duplicate'");
  env.DB.close();
});
