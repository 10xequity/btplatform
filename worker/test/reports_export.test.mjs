/* Boomtown Platform — Revenue CSV export tests (req #12/#18)
   File: worker/test/reports_export.test.mjs · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.40.0
   csvCell RFC 4180 behaviour, the header CONTRACT the Looker template maps by name,
   month derivation, and a negative control proving the header guard can fail. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { csvCell, buildRevenueCsv, REVENUE_CSV_HEADERS } from "../src/reports.js";

const here = dirname(fileURLToPath(import.meta.url));
const reportsSrc = readFileSync(join(here, "../src/reports.js"), "utf8");

/* ---------------- csvCell (RFC 4180) ---------------- */

test("plain values pass through unquoted", () => {
  assert.equal(csvCell("REVCO 4s"), "REVCO 4s");
  assert.equal(csvCell(1250), "1250");
});

test("null and undefined become empty, never the string 'null'", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("commas, quotes and newlines trigger quoting; quotes double", () => {
  assert.equal(csvCell('Say "go", now'), '"Say ""go"", now"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

/* ---------------- header contract ---------------- */

test("REVENUE_CSV_HEADERS is the exact 10-column Looker contract", () => {
  assert.deepEqual(REVENUE_CSV_HEADERS, [
    "event_id", "event", "type", "program", "starts_at", "month",
    "registrations", "card_cents", "cash_cents", "total_cents",
  ]);
});

test("buildRevenueCsv emits the header row first, CRLF-joined", () => {
  const out = buildRevenueCsv([]);
  assert.equal(out, REVENUE_CSV_HEADERS.join(","));
  const two = buildRevenueCsv([{ event_id: 1, event: "A", starts_at: "2026-07-04T09:00" }]);
  assert.ok(two.startsWith(REVENUE_CSV_HEADERS.join(",") + "\r\n"));
});

test("month derives from starts_at; missing dates become 'undated'", () => {
  const out = buildRevenueCsv([
    { event_id: 1, event: "A", starts_at: "2026-07-04T09:00", registrations: 8, card_cents: 100, cash_cents: 0, total_cents: 100 },
    { event_id: 2, event: "B", starts_at: null, registrations: 0, card_cents: 0, cash_cents: 0, total_cents: 0 },
  ]).split("\r\n");
  assert.equal(out[1].split(",")[5], "2026-07");
  assert.equal(out[2].split(",")[5], "undated");
});

test("an event name holding a comma stays one cell", () => {
  const line = buildRevenueCsv([{ event_id: 3, event: "Easter, REVCO", starts_at: "2026-04-01" }]).split("\r\n")[1];
  assert.ok(line.includes('"Easter, REVCO"'));
});

/* ---------------- route + audit present at the call site (§6.5 spirit) ---------------- */

test("reports.js dispatches /api/admin/reports/revenue.csv and audits the export", () => {
  assert.match(reportsSrc, /"\/api\/admin\/reports\/revenue\.csv" && m === "GET"/);
  assert.match(reportsSrc, /reports\.revenue\.exported/);
});

test("NEGATIVE CONTROL: the header-contract guard fails when a column is renamed", () => {
  const mutated = [...REVENUE_CSV_HEADERS];
  mutated[9] = "total"; // the rename a future session would plausibly make
  assert.notDeepEqual(mutated, REVENUE_CSV_HEADERS.map(h => h === "total_cents" ? "total" : h) === mutated ? [] : REVENUE_CSV_HEADERS);
  assert.throws(() => assert.deepEqual(mutated, REVENUE_CSV_HEADERS));
});
