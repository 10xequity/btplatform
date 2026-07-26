/**
 * Boomtown Platform — schedule view ownership + visibility tests
 * File: worker/test/schedule_views.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.26.0
 *
 * These exist because an external review proposed scoping view mutations by schedule_views.org_id.
 * That column is a CONTENT FILTER ("NULL = all orgs", migration 0003), not an owner. Applying
 * that fix would have made both seeded built-ins uneditable by everyone. The first test below
 * is the regression guard for that mistake.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canMutateView, canReadView, VIEW_VISIBILITIES } from "../src/schedule.js";

const staffA = { session: {}, orgId: 1, userId: 5, role: "staff" };
const adminA = { session: {}, orgId: 1, userId: 6, role: "admin" };
const staffB = { session: {}, orgId: 2, userId: 7, role: "staff" };
const memberA = { session: {}, orgId: 1, userId: 8, role: "member" };
const anon = { session: null, orgId: 1, userId: null, role: null };

const custom = (o = {}) => ({ id: 9, kind: "custom", owner_org_id: 1, visibility: "public", min_tier_id: null, require_membership: 0, ...o });

/* ---------- canMutateView ---------- */

test("REGRESSION: a global view is not mutable via the org_id content filter", () => {
  // org_id here is the filter, deliberately unrelated to ownership. Even with org_id matching,
  // a NULL owner means platform-global and staff may not touch it.
  const global = custom({ owner_org_id: null, org_id: 1 });
  assert.equal(canMutateView(global, staffA).ok, false);
  assert.equal(canMutateView(global, staffA).reason, "global_admin_only");
  assert.equal(canMutateView(global, adminA).ok, true, "an admin can still maintain shared views");
});

test("built-in views are never mutable, not even by an admin", () => {
  for (const kind of ["public", "internal"]) {
    const v = custom({ kind, owner_org_id: null });
    assert.equal(canMutateView(v, adminA).reason, "builtin");
    assert.equal(canMutateView(v, staffA).reason, "builtin");
  }
});

test("a view owned by another org reports not_found, never a distinct error", () => {
  // Leaking "forbidden" here would confirm the id exists in some other tenant.
  const res = canMutateView(custom({ owner_org_id: 2 }), staffA);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "not_found");
});

test("staff may mutate their own org's custom view", () => {
  assert.equal(canMutateView(custom({ owner_org_id: 1 }), staffA).ok, true);
});

test("a missing view is not_found", () => {
  assert.equal(canMutateView(null, adminA).reason, "not_found");
});

/* ---------- canReadView: visibility ---------- */

test("public views need no session", () => {
  assert.equal(canReadView(custom({ visibility: "public" }), anon).ok, true);
});

test("internal views require a signed-in member of the owning org", () => {
  const v = custom({ visibility: "internal" });
  assert.equal(canReadView(v, anon).status, 401);
  assert.equal(canReadView(v, memberA).ok, true);
  assert.equal(canReadView(v, staffB).status, 404, "another org's member gets 404, not 403");
});

test("staff views are unreadable by members even with the slug", () => {
  const v = custom({ visibility: "staff" });
  assert.equal(canReadView(v, anon).status, 401);
  assert.equal(canReadView(v, memberA).status, 404);
  assert.equal(canReadView(v, staffA).ok, true);
  assert.equal(canReadView(v, adminA).ok, true);
});

test("an unknown visibility value FAILS CLOSED", () => {
  // A typo in the column must not publish a staff schedule to the world.
  const v = custom({ visibility: "publik" });
  assert.equal(canReadView(v, anon).ok, false);
  assert.equal(canReadView(v, memberA).ok, false);
  assert.equal(canReadView(v, adminA).ok, false);
});

test("the visibility vocabulary is exactly public/internal/staff", () => {
  assert.deepEqual(VIEW_VISIBILITIES, ["public", "internal", "staff"]);
});

/* ---------- canReadView: membership gate ---------- */

test("require_membership blocks a signed-in member holding no tier", () => {
  const v = custom({ visibility: "public", require_membership: 1 });
  const res = canReadView(v, memberA, null, null);
  assert.equal(res.status, 403);
  assert.equal(res.reason, "membership_required");
});

test("require_membership still demands a session on an otherwise public view", () => {
  assert.equal(canReadView(custom({ require_membership: 1 }), anon).status, 401);
});

test("a tier gate compares rank and reports why it failed", () => {
  const v = custom({ visibility: "internal", min_tier_id: 4, require_membership: 1 });
  assert.equal(canReadView(v, memberA, 10, 20).reason, "tier_too_low");
  assert.equal(canReadView(v, memberA, 20, 20).ok, true, "equal rank passes");
  assert.equal(canReadView(v, memberA, 30, 20).ok, true);
});

test("staff bypass the membership gate on their own org's views", () => {
  // Staff must not have to buy a membership to preview what members see.
  const v = custom({ visibility: "internal", min_tier_id: 4, require_membership: 1 });
  assert.equal(canReadView(v, staffA, null, 20).ok, true);
  assert.equal(canReadView(v, adminA, null, 20).ok, true);
});

test("a membership gate does not rescue a failed visibility check", () => {
  // Both gates must pass. Holding All-Access does not open a staff-only view.
  const v = custom({ visibility: "staff", min_tier_id: 4, require_membership: 1 });
  assert.equal(canReadView(v, memberA, 999, 20).status, 404);
});

test("a missing view is 404 regardless of the caller", () => {
  assert.equal(canReadView(null, adminA).status, 404);
});
