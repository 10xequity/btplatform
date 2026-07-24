/* Boomtown Platform — Facility module tests
   Version: v1.0 · Date: 2026-07-24 · Run: node --test worker/test/facility.test.mjs */
import { test } from "node:test";
import assert from "node:assert";
import { findConflicts, parseTime, parseDate, parseSpacesText, parseCsv } from "../src/facility.js";

/* Mock D1: one existing booking on 2026-08-01, 18:00–21:00, atoms [5,6] (Basketball Ct 3). */
function mockEnv(existing) {
  return { DB: { prepare: () => ({ bind: () => ({
    all: async () => ({ results: existing }),
    first: async () => existing[0] || null,
    run: async () => ({ meta: { last_row_id: 1, changes: 1 } }),
  }) }) } };
}
const base = { id: 1, title: "BBall Rental", start_min: 1080, end_min: 1260, share_ok: 0, is_closure: 0, series_id: null, operator: "External / Rental" };

test("atom overlap = hard conflict", async () => {
  const env = mockEnv([base]);
  const r = await findConflicts(env, { date: "2026-08-01", start_min: 1140, end_min: 1200, space_ids: [6], is_closure: 0, share_ok: 0 });
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.warnings.length, 0);
});

test("both sides share_ok = warning, not conflict", async () => {
  const env = mockEnv([{ ...base, share_ok: 1 }]);
  const r = await findConflicts(env, { date: "2026-08-01", start_min: 1140, end_min: 1200, space_ids: [6], is_closure: 0, share_ok: 1 });
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.warnings.length, 1);
});

test("closure is always hard, even with share flags", async () => {
  const env = mockEnv([{ ...base, share_ok: 1, is_closure: 1 }]);
  const r = await findConflicts(env, { date: "2026-08-01", start_min: 1140, end_min: 1200, space_ids: [6], is_closure: 0, share_ok: 1 });
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].kind, "closure");
});

test("ignore_ids excludes the booking being edited", async () => {
  const env = mockEnv([base]);
  const r = await findConflicts(env, { date: "2026-08-01", start_min: 1140, end_min: 1200, space_ids: [6], is_closure: 0, share_ok: 0, ignore_ids: [1] });
  assert.equal(r.conflicts.length + r.warnings.length, 0);
});

test("time parsing: 12h, 24h, invalid", () => {
  assert.equal(parseTime("6:00 PM"), 1080);
  assert.equal(parseTime("12:15 am"), 15);
  assert.equal(parseTime("18:30"), 1110);
  assert.equal(parseTime("noonish"), null);
});

test("date parsing: ISO and US", () => {
  assert.equal(parseDate("2026-08-01"), "2026-08-01");
  assert.equal(parseDate("8/1/2026"), "2026-08-01");
  assert.equal(parseDate("8/1/26"), "2026-08-01");
  assert.equal(parseDate("August 1"), null);
});

test("spaces text: preset name, VB range, list", () => {
  const presets = [{ id: 2, name: "Full Hardwood (VB 1–8)", space_ids: [1,2,3,4,5,6,7,8] }];
  const spaces = Array.from({ length: 13 }, (_, i) => ({ id: i + 1, name: `VB ${i + 1}` }))
    .concat([{ id: 16, name: "Yoga-Den" }]);
  assert.deepEqual(parseSpacesText("Full Hardwood", presets, spaces).sort((a,b)=>a-b), [1,2,3,4,5,6,7,8]);
  assert.deepEqual(parseSpacesText("VB 9-11", presets, spaces).sort((a,b)=>a-b), [9,10,11]);
  assert.deepEqual(parseSpacesText("VB 1, Yoga-Den", presets, spaces).sort((a,b)=>a-b), [1,16]);
});

test("CSV parser: quotes, commas, CRLF", () => {
  const rows = parseCsv('a,"b,1",c\r\nd,"e ""q""",f\n');
  assert.deepEqual(rows, [["a","b,1","c"],["d",'e "q"',"f"]]);
});
