/* Boomtown Platform — Waiver versioning unit tests
   File: worker/test/waivers.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.22.0
   Pure-function tests (same pattern as waitlists.test.mjs — no DB, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePublish, resignRequired, versionLabel, sha256Hex } from "../src/waivers.js";

const LONG = "A".repeat(60); // clears BODY_MIN (50)

/* ---------- normalizePublish ---------- */
test("valid publish normalizes label, body and defaults material to 1", () => {
  const v = normalizePublish({ label: "  v2 ", body: `  ${LONG}  ` });
  assert.equal(v.ok, true);
  assert.equal(v.value.label, "v2");
  assert.equal(v.value.body, LONG);
  assert.equal(v.value.material, 1); // unspecified change is treated as substantive
  assert.equal(v.value.notes, null);
});

test("missing label and missing body are both rejected", () => {
  assert.equal(normalizePublish({ body: LONG }).ok, false);
  assert.equal(normalizePublish({ label: "v2" }).ok, false);
  assert.equal(normalizePublish({}).ok, false);
});

test("a truncated paste is rejected, not silently published", () => {
  const r = normalizePublish({ label: "v2", body: "too short" });
  assert.equal(r.ok, false);
  assert.match(r.error, /too short/i);
});

test("body over the max is rejected", () => {
  const r = normalizePublish({ label: "v2", body: "A".repeat(60001) });
  assert.equal(r.ok, false);
  assert.match(r.error, /too long/i);
});

test("label charset and length are enforced", () => {
  assert.equal(normalizePublish({ label: "v2<script>", body: LONG }).ok, false);
  assert.equal(normalizePublish({ label: "A".repeat(41), body: LONG }).ok, false);
  assert.equal(normalizePublish({ label: "v2.1 (final)", body: LONG }).ok, true);
});

test("material accepts the falsy spellings a form might send", () => {
  for (const m of [false, 0, "0", "false", "no"]) {
    assert.equal(normalizePublish({ label: "v2", body: LONG, material: m }).value.material, 0, `material=${JSON.stringify(m)}`);
  }
  for (const m of [true, 1, "1", "yes"]) {
    assert.equal(normalizePublish({ label: "v2", body: LONG, material: m }).value.material, 1, `material=${JSON.stringify(m)}`);
  }
});

test("CRLF is normalized so a Windows paste does not change the hash", () => {
  const a = normalizePublish({ label: "v2", body: LONG + "\r\nline two padding here" }).value.body;
  const b = normalizePublish({ label: "v2", body: LONG + "\nline two padding here" }).value.body;
  assert.equal(a, b);
});

test("notes are clamped to 500 characters", () => {
  const v = normalizePublish({ label: "v2", body: LONG, notes: "N".repeat(900) });
  assert.equal(v.value.notes.length, 500);
});

/* ---------- resignRequired ---------- */
test("an unpinned signature always re-signs (legacy / unknown text)", () => {
  assert.equal(resignRequired(null, 7, []), true);
  assert.equal(resignRequired(undefined, 7, [{ material: 0 }]), true);
});

test("signing the current version never re-signs", () => {
  assert.equal(resignRequired(7, 7, []), false);
  assert.equal(resignRequired("7", 7, [{ material: 1 }]), false); // string id from the DB row
});

test("a minor edit alone does NOT force a re-sign", () => {
  assert.equal(resignRequired(5, 6, [{ material: 0 }]), false);
  assert.equal(resignRequired(5, 8, [{ material: 0 }, { material: 0 }]), false);
});

test("any material version published after yours forces a re-sign", () => {
  assert.equal(resignRequired(5, 8, [{ material: 0 }, { material: 1 }]), true);
  assert.equal(resignRequired(5, 6, [{ material: 1 }]), true);
});

test("missing or malformed version list is treated as no material change", () => {
  assert.equal(resignRequired(5, 6, null), false);
  assert.equal(resignRequired(5, 6, [{}, { material: null }]), false);
});

/* ---------- versionLabel ---------- */
test("legacy label reads honestly to members; others pass through", () => {
  assert.equal(versionLabel({ label: "v1-legacy" }), "v1 (pre-versioning)");
  assert.equal(versionLabel({ label: "v2" }), "v2");
  assert.equal(versionLabel(null), "unknown version");
});

/* ---------- sha256Hex ---------- */
test("sha256Hex matches the known digest and is stable", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256Hex("same"), await sha256Hex("same"));
  assert.notEqual(await sha256Hex("a"), await sha256Hex("b"));
});
