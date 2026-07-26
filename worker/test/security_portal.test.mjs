/**
 * Boomtown Platform — M13 + M12.5 tests
 * File: worker/test/security_portal.test.mjs · Version: v1.1 · Date: 2026-07-26 · Ships in: v0.22.0
 * v1.1: waiver_versions added to the forbidden-restore list — a published waiver version is
 * an immutable legal record; it has no delete route and must never be restorable from the UI.
 * Run: node --test worker/test/security_portal.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RESTORE_WHITELIST } from "../src/security.js";
import { dedupeAgreements } from "../src/member_portal.js";

test("restore whitelist NEVER includes auth/security tables", () => {
  for (const t of ["users", "sessions", "magic_links", "webauthn_credentials", "audit_log", "waivers", "signatures", "waiver_versions"]) {
    assert.equal(t in RESTORE_WHITELIST, false, `${t} must not be restorable from the UI`);
  }
});

test("restore whitelist covers the operational tables with label columns", () => {
  for (const t of ["events", "teams", "contacts", "space_bookings", "rental_requests", "registrations"]) {
    assert.ok(RESTORE_WHITELIST[t] && RESTORE_WHITELIST[t].label, `${t} missing`);
  }
});

test("dedupeAgreements drops the waivers row when the ledger has the same-day waiver", () => {
  const sigs = [{ document_type: "waiver", document_ref: "waiver:v1", subject_name: "Kid A",
    signed_name: "Parent P", on_behalf: 1, signed_at: "2026-07-01 10:00:00" }];
  const waivers = [{ subject_name: "Kid A", waiver_text_version: "v1",
    signature_name: "Parent P", signed_at: "2026-07-01 10:00:01", expires_at: "2027-07-01" }];
  const out = dedupeAgreements(sigs, waivers);
  assert.equal(out.length, 1);
  assert.equal(out[0].on_behalf, 1);
});

test("dedupeAgreements keeps registration-only waivers (no ledger row)", () => {
  const waivers = [{ subject_name: "Adult B", waiver_text_version: "v1",
    signature_name: "Adult B", signed_at: "2026-06-15 09:00:00", expires_at: "2027-06-15" }];
  const out = dedupeAgreements([], waivers);
  assert.equal(out.length, 1);
  assert.equal(out[0].document_type, "waiver");
  assert.equal(out[0].document_ref, "waiver:v1");
});

test("dedupeAgreements sorts newest first across both sources", () => {
  const sigs = [{ document_type: "contract", document_ref: "c:1", subject_name: "A",
    signed_name: "A", on_behalf: 0, signed_at: "2026-05-01 12:00:00" }];
  const waivers = [{ subject_name: "A", waiver_text_version: "v1", signature_name: "A",
    signed_at: "2026-07-01 12:00:00", expires_at: "2027-07-01" }];
  const out = dedupeAgreements(sigs, waivers);
  assert.equal(out[0].document_type, "waiver");
  assert.equal(out[1].document_type, "contract");
});

test("dedupeAgreements handles empty inputs", () => {
  assert.deepEqual(dedupeAgreements([], []), []);
  assert.deepEqual(dedupeAgreements(null, undefined), []);
});
