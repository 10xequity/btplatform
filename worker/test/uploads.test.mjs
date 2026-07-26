/**
 * Boomtown Platform — uploads.js tests
 * File: worker/test/uploads.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.30.0
 *
 * An upload endpoint is an untrusted-input endpoint, so the tests are weighted toward refusal
 * rather than the happy path: the filename is attacker-controlled, the Content-Type is
 * attacker-controlled, and the size is attacker-controlled. Each one gets its own assertions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeFilename, normaliseType, buildKey, normaliseKind, normaliseVisibility,
  normaliseEntity, dispositionFor, validateUploadRequest, bucketFor,
  ALLOWED_TYPES, UPLOAD_KINDS, VISIBILITIES, MAX_BYTES,
} from "../src/uploads.js";

/* ---------- safeFilename: path traversal and control characters ---------- */

test("safeFilename: strips every directory component", () => {
  assert.equal(safeFilename("../../etc/passwd"), "etc_passwd".replace("etc_passwd", "passwd"));
  assert.equal(safeFilename("/etc/passwd"), "passwd");
  assert.equal(safeFilename("C:\\Windows\\System32\\config"), "config");
  assert.equal(safeFilename("a/b/c/roster.csv"), "roster.csv");
});

test("safeFilename: refuses to produce a dotfile or a traversal token", () => {
  assert.equal(safeFilename(".."), "upload.bin");
  assert.equal(safeFilename("..."), "upload.bin");
  assert.equal(safeFilename(".htaccess"), "htaccess");
  assert.ok(!safeFilename("....//....//x.png").startsWith("."));
});

test("safeFilename: drops control characters, including the null byte", () => {
  assert.equal(safeFilename("ros\u0000ter.csv"), "roster.csv");
  assert.equal(safeFilename("a\nb\tc.png"), "a_b_c.png".replace("a_b_c.png", "abc.png"));
});

test("safeFilename: empty, null and undefined all get a usable name", () => {
  assert.equal(safeFilename(""), "upload.bin");
  assert.equal(safeFilename(null), "upload.bin");
  assert.equal(safeFilename(undefined, "pdf"), "upload.pdf");
  assert.equal(safeFilename("   "), "upload.bin");
});

test("safeFilename: truncates long names but keeps the extension", () => {
  const long = "x".repeat(400) + ".pdf";
  const out = safeFilename(long);
  assert.ok(out.length <= 120, `got ${out.length}`);
  assert.ok(out.endsWith(".pdf"), out.slice(-10));
});

test("safeFilename: an HTML payload in a filename survives as inert text, not markup", () => {
  const out = safeFilename('<img src=x onerror=alert(1)>.png');
  assert.ok(!out.includes("<"));
  assert.ok(!out.includes(">"));
});

/* ---------- normaliseType: the allow-list is the whole defence ---------- */

test("normaliseType: SVG is refused — it is a script container", () => {
  assert.equal(normaliseType("image/svg+xml"), null);
  assert.equal(ALLOWED_TYPES["image/svg+xml"], undefined);
});

test("normaliseType: HTML and JavaScript are refused for the same reason", () => {
  assert.equal(normaliseType("text/html"), null);
  assert.equal(normaliseType("application/xhtml+xml"), null);
  assert.equal(normaliseType("text/javascript"), null);
  assert.equal(normaliseType("application/javascript"), null);
});

test("normaliseType: parameters and casing do not smuggle a type past the list", () => {
  assert.equal(normaliseType("image/png; charset=utf-8"), "image/png");
  assert.equal(normaliseType("IMAGE/PNG"), "image/png");
  assert.equal(normaliseType("  image/png  "), "image/png");
  assert.equal(normaliseType("image/png,text/html"), null);
});

test("normaliseType: missing or junk header is a refusal, never a default", () => {
  assert.equal(normaliseType(null), null);
  assert.equal(normaliseType(""), null);
  assert.equal(normaliseType("application/octet-stream"), null);
});

/* ---------- buildKey: the key is generated, never caller-influenced ---------- */

test("buildKey: the filename cannot reach the key", () => {
  const k = buildKey(3, "image/png", new Date("2026-07-26T00:00:00Z"));
  assert.ok(k.startsWith("uploads/3/202607/"), k);
  assert.ok(k.endsWith(".png"), k);
  assert.ok(!k.includes(".."), k);
});

test("buildKey: two calls never collide", () => {
  const a = buildKey(1, "application/pdf");
  const b = buildKey(1, "application/pdf");
  assert.notEqual(a, b);
});

test("buildKey: the org id is part of the key, so orgs cannot overwrite each other", () => {
  assert.ok(buildKey(1, "image/png").startsWith("uploads/1/"));
  assert.ok(buildKey(2, "image/png").startsWith("uploads/2/"));
});

test("buildKey: the uploads/ prefix cannot collide with the avatar keys in the same bucket", () => {
  // The bucket is shared with member_profiles.avatar_r2_key by design (see the module header).
  assert.ok(buildKey(1, "image/jpeg").startsWith("uploads/"));
});

/* ---------- normalisers fail toward the closed option ---------- */

test("normaliseVisibility: anything unrecognised becomes private, never public", () => {
  assert.equal(normaliseVisibility("public"), "public");
  assert.equal(normaliseVisibility("members"), "members");
  assert.equal(normaliseVisibility(""), "private");
  assert.equal(normaliseVisibility(null), "private");
  assert.equal(normaliseVisibility("PUBLIC "), "public");
  assert.equal(normaliseVisibility("everyone"), "private");
  assert.equal(normaliseVisibility("admin"), "private");
});

test("normaliseKind: an unknown label lands on 'other' rather than being stored raw", () => {
  assert.equal(normaliseKind("Roster"), "roster");
  assert.equal(normaliseKind("nonsense"), "other");
  assert.equal(normaliseKind(null), "other");
  UPLOAD_KINDS.forEach((k) => assert.equal(normaliseKind(k), k));
});

test("normaliseEntity: a half-specified link is dropped entirely", () => {
  assert.deepEqual(normaliseEntity("event", 5), { entity: "event", entity_id: 5 });
  assert.deepEqual(normaliseEntity("event", null), { entity: null, entity_id: null });
  assert.deepEqual(normaliseEntity(null, 5), { entity: null, entity_id: null });
  assert.deepEqual(normaliseEntity("orgs", 5), { entity: null, entity_id: null });
  assert.deepEqual(normaliseEntity("event", -1), { entity: null, entity_id: null });
  assert.deepEqual(normaliseEntity("event", "3.7"), { entity: "event", entity_id: 3 });
});

/* ---------- dispositionFor ---------- */

test("dispositionFor: only raster images and PDF render inline", () => {
  assert.ok(dispositionFor("image/png", "a.png").startsWith("inline"));
  assert.ok(dispositionFor("application/pdf", "a.pdf").startsWith("inline"));
  assert.ok(dispositionFor("text/csv", "a.csv").startsWith("attachment"));
  assert.ok(dispositionFor("application/zip", "a.zip").startsWith("attachment"));
  assert.ok(dispositionFor("text/plain", "a.txt").startsWith("attachment"));
});

test("dispositionFor: an unknown type downloads rather than rendering", () => {
  assert.ok(dispositionFor("image/svg+xml", "x.svg").startsWith("attachment"));
});

test("dispositionFor: a quote in the filename cannot break out of the header", () => {
  const h = dispositionFor("image/png", 'a".png');
  assert.ok(!/filename="[^"]*"[^;]/.test(h.replace(/filename\*=.*/, "")), h);
  assert.ok(h.includes("filename*=UTF-8''"), h);
});

/* ---------- validateUploadRequest ---------- */

test("validateUploadRequest: accepts a normal file and normalises alongside", () => {
  const v = validateUploadRequest({ contentType: "image/png", bytes: 1024, kind: "Photo", visibility: "members" });
  assert.equal(v.ok, true);
  assert.equal(v.type, "image/png");
  assert.equal(v.kind, "photo");
  assert.equal(v.visibility, "members");
});

test("validateUploadRequest: refuses an empty file", () => {
  assert.equal(validateUploadRequest({ contentType: "image/png", bytes: 0 }).status, 400);
  assert.equal(validateUploadRequest({ contentType: "image/png", bytes: NaN }).status, 400);
});

test("validateUploadRequest: refuses over the size cap and quotes the size back", () => {
  const v = validateUploadRequest({ contentType: "image/png", bytes: MAX_BYTES + 1 });
  assert.equal(v.ok, false);
  assert.equal(v.status, 413);
  assert.match(v.error, /MB/);
});

test("validateUploadRequest: exactly at the cap is allowed", () => {
  assert.equal(validateUploadRequest({ contentType: "image/png", bytes: MAX_BYTES }).ok, true);
});

test("validateUploadRequest: type refusal is 415 and comes before the size check", () => {
  const v = validateUploadRequest({ contentType: "image/svg+xml", bytes: MAX_BYTES * 10 });
  assert.equal(v.status, 415);
});

/* ---------- bucketFor ---------- */

test("bucketFor: prefers UPLOADS, falls back to AVATARS, null when neither exists", () => {
  const U = { name: "u" }, A = { name: "a" };
  assert.equal(bucketFor({ UPLOADS: U, AVATARS: A }), U);
  assert.equal(bucketFor({ AVATARS: A }), A);
  assert.equal(bucketFor({}), null);
});

/* ---------- constants that other code depends on ---------- */

test("policy constants hold their shape", () => {
  assert.deepEqual(VISIBILITIES, ["private", "members", "public"]);
  assert.equal(VISIBILITIES[0], "private", "the first entry is the default; do not reorder");
  assert.ok(UPLOAD_KINDS.includes("other"), "normaliseKind falls back to 'other'");
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
});
