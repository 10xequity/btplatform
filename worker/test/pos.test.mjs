// Boomtown Platform — pos.js + reports.js (M15) unit tests
// File: worker/test/pos.test.mjs · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.18.0
import test from "node:test";
import assert from "node:assert/strict";
import { computeSaleTotals, validatePromo } from "../src/pos.js";
import { buildHeatmap } from "../src/reports.js";

const item = (qty, price, bp = 0) => ({ qty, unit_price_cents: price, tax_rate_bp: bp });

test("totals: single taxed item, no promo", () => {
  const t = computeSaleTotals([item(2, 1500, 820)], null); // 2 × $15 @ 8.2%
  assert.equal(t.subtotal_cents, 3000);
  assert.equal(t.discount_cents, 0);
  assert.equal(t.tax_cents, 246);
  assert.equal(t.total_cents, 3246);
});

test("totals: percent promo reduces taxable base before tax", () => {
  const t = computeSaleTotals([item(1, 10000, 1000)], { kind: "percent", amount: 10 }); // $100, 10% off, 10% tax
  assert.equal(t.discount_cents, 1000);
  assert.equal(t.tax_cents, 900); // tax on $90, not $100
  assert.equal(t.total_cents, 9900);
});

test("totals: fixed promo capped at subtotal, total never negative", () => {
  const t = computeSaleTotals([item(1, 500)], { kind: "fixed", amount: 2000 });
  assert.equal(t.discount_cents, 500);
  assert.equal(t.total_cents, 0);
});

test("totals: proportional spread sums exactly (last line absorbs remainder)", () => {
  const t = computeSaleTotals([item(1, 333, 0), item(1, 333, 0), item(1, 334, 0)], { kind: "fixed", amount: 100 });
  assert.equal(t.discount_cents, 100);
  assert.equal(t.total_cents, 900);
});

test("totals: percent over 100 clamps to 100", () => {
  const t = computeSaleTotals([item(1, 1000)], { kind: "percent", amount: 250 });
  assert.equal(t.discount_cents, 1000);
  assert.equal(t.total_cents, 0);
});

test("totals: untaxed custom line adds no tax", () => {
  const t = computeSaleTotals([item(3, 200, 0)], null);
  assert.equal(t.tax_cents, 0);
  assert.equal(t.total_cents, 600);
});

test("promo: inactive rejected", () => {
  assert.equal(validatePromo({ active: 0 }, "2026-07-25 12:00:00").ok, false);
});

test("promo: window respected on both ends", () => {
  const d = { active: 1, starts_at: "2026-08-01 00:00:00", expires_at: "2026-08-31 23:59:59" };
  assert.equal(validatePromo(d, "2026-07-25 12:00:00").ok, false); // not started
  assert.equal(validatePromo(d, "2026-08-15 12:00:00").ok, true);  // inside
  assert.equal(validatePromo(d, "2026-09-01 00:00:00").ok, false); // expired
});

test("promo: usage cap enforced, null cap unlimited", () => {
  assert.equal(validatePromo({ active: 1, usage_cap: 5, used_count: 5 }, "2026-07-25 12:00:00").ok, false);
  assert.equal(validatePromo({ active: 1, usage_cap: null, used_count: 999 }, "2026-07-25 12:00:00").ok, true);
});

test("promo: missing or deleted code rejected", () => {
  assert.equal(validatePromo(null, "2026-07-25 12:00:00").ok, false);
  assert.equal(validatePromo({ active: 1, deleted_at: "2026-07-01" }, "2026-07-25 12:00:00").ok, false);
});

test("heatmap: buckets land on the right cells and max tracks", () => {
  const { grid, max } = buildHeatmap([
    { dow: "1", hour: "18", n: 7 },
    { dow: "1", hour: "18", n: 3 },
    { dow: "6", hour: "09", n: 4 },
  ]);
  assert.equal(grid[1][18], 10);
  assert.equal(grid[6][9], 4);
  assert.equal(max, 10);
});

test("heatmap: out-of-range rows ignored, empty input yields zero grid", () => {
  const { grid, max } = buildHeatmap([{ dow: "9", hour: "99", n: 5 }]);
  assert.equal(max, 0);
  assert.equal(grid.every(row => row.every(c => c === 0)), true);
});
