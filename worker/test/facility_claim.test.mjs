/**
 * Boomtown Platform — M12 Phase B tests (auto-claim pure functions)
 * File: worker/test/facility_claim.test.mjs · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.13.0
 * Run: node --test worker/test/facility_claim.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { eventWindow, chooseCourts } from "../src/facility.js";

const COURTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // VB 1–13 in sort order

test("eventWindow parses ISO datetime", () => {
  const w = eventWindow("2026-08-02T08:00", 420);
  assert.deepEqual(w, { date: "2026-08-02", start_min: 480, end_min: 900 });
});

test("eventWindow parses 'date space time' and clamps to midnight", () => {
  const w = eventWindow("2026-08-02 21:30", 420);
  assert.equal(w.start_min, 1290);
  assert.equal(w.end_min, 1440); // clamped
});

test("eventWindow date-only defaults to 8:00 AM", () => {
  const w = eventWindow("2026-08-02", 360);
  assert.deepEqual(w, { date: "2026-08-02", start_min: 480, end_min: 840 });
});

test("eventWindow null/garbage → null (claim is skipped, never throws)", () => {
  assert.equal(eventWindow(null), null);
  assert.equal(eventWindow(""), null);
  assert.equal(eventWindow("next tuesday"), null);
});

test("eventWindow league week N shifts +7(N−1) days, crossing month boundaries", () => {
  assert.equal(eventWindow("2026-07-28T18:30", 180, 1).date, "2026-07-28");
  assert.equal(eventWindow("2026-07-28T18:30", 180, 2).date, "2026-08-04");
  assert.equal(eventWindow("2026-07-28T18:30", 180, 6).date, "2026-09-01");
});

test("chooseCourts: all defaults open → VB 1..N, nothing moved", () => {
  const r = chooseCourts(4, COURTS, new Set());
  assert.deepEqual(r.chosen, [1, 2, 3, 4]);
  assert.deepEqual(r.moved, []);
  assert.equal(r.shortfall, 0);
});

test("chooseCourts: busy defaults move to next open courts", () => {
  const r = chooseCourts(4, COURTS, new Set([2, 3])); // VB 2–3 taken
  assert.deepEqual(r.chosen, [1, 4, 5, 6]);
  assert.deepEqual(r.moved, [5, 6]);
  assert.equal(r.shortfall, 0);
});

test("chooseCourts: partial availability reports shortfall", () => {
  const busy = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // only VB 13 open
  const r = chooseCourts(4, COURTS, busy);
  assert.deepEqual(r.chosen, [13]);
  assert.equal(r.shortfall, 3);
});

test("chooseCourts: nothing open → empty chosen, full shortfall (caller skips claim)", () => {
  const r = chooseCourts(4, COURTS, new Set(COURTS));
  assert.deepEqual(r.chosen, []);
  assert.equal(r.shortfall, 4);
});

test("chooseCourts: wanting more courts than exist caps at facility size", () => {
  const r = chooseCourts(20, COURTS, new Set());
  assert.equal(r.chosen.length, 13);
  assert.equal(r.shortfall, 7);
});
