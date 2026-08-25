/* Boomtown Platform — Calendar / iCal unit tests
   File: worker/test/calendar.test.mjs · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.23.0
   Pure-function tests (same pattern as checkin.test.mjs — no DB, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeIcsText, foldIcsLine, toIcsUtc, toIcsLocal, addWallHours, icsUid, buildIcs, feedEtag, sha256Hex,
  icsVtimezone, DEFAULT_TZID, SUPPORTED_TZIDS,
} from "../src/calendar.js";

/* ---------- escapeIcsText (RFC 5545 §3.3.11) ---------- */
test("escapes the four TEXT metacharacters", () => {
  assert.equal(escapeIcsText("a,b;c\\d"), "a\\,b\\;c\\\\d");
  assert.equal(escapeIcsText("line1\nline2"), "line1\\nline2");
  assert.equal(escapeIcsText("crlf\r\nhere"), "crlf\\nhere");
});

test("backslash is escaped FIRST, not double-applied", () => {
  // "\\," must become "\\\\\\," — if the comma rule ran first we'd get a mangled sequence.
  assert.equal(escapeIcsText("\\,"), "\\\\\\,");
});

test("null and undefined become empty, never the string 'null'", () => {
  assert.equal(escapeIcsText(null), "");
  assert.equal(escapeIcsText(undefined), "");
});

/* ---------- foldIcsLine (RFC 5545 §3.1) ---------- */
test("short lines are untouched", () => {
  assert.equal(foldIcsLine("SUMMARY:Short"), "SUMMARY:Short");
});

test("a 75-octet line is exactly at the limit and does not fold", () => {
  const line = "X".repeat(75);
  assert.equal(foldIcsLine(line), line);
});

test("long lines fold with CRLF + single leading space", () => {
  const out = foldIcsLine("SUMMARY:" + "A".repeat(200));
  const parts = out.split("\r\n");
  assert.ok(parts.length > 1, "should have folded");
  for (const p of parts.slice(1)) assert.equal(p[0], " ", "continuation must start with a space");
  // Unfolding restores the original.
  assert.equal(parts.map((p, i) => (i ? p.slice(1) : p)).join(""), "SUMMARY:" + "A".repeat(200));
});

test("folds on OCTETS, never splitting a multi-byte character", () => {
  const out = foldIcsLine("SUMMARY:" + "é".repeat(60)); // 2 bytes each = 128 bytes
  for (const seg of out.split("\r\n")) {
    assert.ok(Buffer.byteLength(seg, "utf8") <= 75, "segment exceeds 75 octets");
    assert.ok(!seg.includes("\uFFFD"), "produced a replacement char — split a code point");
  }
});

test("emoji (surrogate pair) survives folding intact", () => {
  const out = foldIcsLine("SUMMARY:" + "🏐".repeat(30));
  const unfolded = out.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join("");
  assert.equal(unfolded, "SUMMARY:" + "🏐".repeat(30));
});

/* ---------- toIcsUtc ---------- */
test("SQLite datetime form converts to iCal UTC", () => {
  assert.equal(toIcsUtc("2026-07-26 14:30:00"), "20260726T143000Z");
});

test("ISO form with Z converts identically", () => {
  assert.equal(toIcsUtc("2026-07-26T14:30:00Z"), "20260726T143000Z");
});

test("offset timestamps are normalised to UTC, not truncated", () => {
  assert.equal(toIcsUtc("2026-07-26T08:30:00-06:00"), "20260726T143000Z");
});

test("garbage and empty input return null rather than Invalid Date", () => {
  assert.equal(toIcsUtc("not a date"), null);
  assert.equal(toIcsUtc(""), null);
  assert.equal(toIcsUtc(null), null);
});

/* ---------- icsUid ---------- */
test("UID is stable for the same event id", () => {
  assert.equal(icsUid(42, "x.dev"), icsUid(42, "x.dev"));
  assert.notEqual(icsUid(42, "x.dev"), icsUid(43, "x.dev"));
});

/* ---------- buildIcs ---------- */
const EV = {
  id: 7, name: "Summer Slam", starts_at: "2026-08-01 16:00:00", ends_at: "2026-08-01 22:00:00",
  location: "Boomtown Courts", type: "tournament", status: "published", price_cents: 4500,
  updated_at: "2026-07-26 00:00:00", deleted_at: null,
};

test("produces a well-formed VCALENDAR with CRLF endings", () => {
  const ics = buildIcs([EV], { now: "2026-07-26T00:00:00Z" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(ics.includes("\r\n"), "must use CRLF");
  assert.ok(!/[^\r]\n/.test(ics), "found a bare LF — RFC 5545 requires CRLF");
});

test("carries the required VEVENT properties", () => {
  const ics = buildIcs([EV], { now: "2026-07-26T00:00:00Z" });
  for (const k of ["BEGIN:VEVENT", "UID:", "DTSTAMP:",
                   "DTSTART;TZID=America/Denver:20260801T160000",
                   "DTEND;TZID=America/Denver:20260801T220000",
                   "SUMMARY:Summer Slam", "STATUS:CONFIRMED",
                   "END:VEVENT"]) {
    assert.ok(ics.includes(k), `missing ${k}`);
  }
});

test("a soft-deleted event is emitted CANCELLED, not dropped", () => {
  const ics = buildIcs([{ ...EV, deleted_at: "2026-07-20 00:00:00" }], { now: "2026-07-26T00:00:00Z" });
  assert.ok(ics.includes("STATUS:CANCELLED"), "cancelled events must still appear");
  assert.ok(ics.includes("SEQUENCE:1"), "SEQUENCE must bump or clients keep the cached copy");
  assert.ok(ics.includes("CANCELLED: Summer Slam")); // RF-20 spelling
});

test("status='cancelled' is treated the same as a soft delete", () => {
  const ics = buildIcs([{ ...EV, status: "cancelled" }], {});
  assert.ok(ics.includes("STATUS:CANCELLED"));
});

test("a missing end time falls back to a 2h block rather than zero width", () => {
  const ics = buildIcs([{ ...EV, ends_at: null }], {});
  assert.ok(ics.includes("DTSTART;TZID=America/Denver:20260801T160000"));
  assert.ok(ics.includes("DTEND;TZID=America/Denver:20260801T180000"));
});

test("event times are floating wall-clock bound to a VTIMEZONE, never stamped Z", () => {
  // events.starts_at is naive Denver wall-clock. Emitting it as UTC shifted every
  // subscribed event 6-7 hours early. Regression guard for that defect.
  const ics = buildIcs([EV], { now: "2026-07-26T00:00:00Z" });
  assert.ok(ics.includes("BEGIN:VTIMEZONE"), "TZID references need a VTIMEZONE to resolve");
  assert.ok(ics.includes("TZID:America/Denver"));
  assert.ok(!/DTSTART:\d{8}T\d{6}Z/.test(ics), "DTSTART must not claim UTC");
  assert.ok(!/DTEND:\d{8}T\d{6}Z/.test(ics), "DTEND must not claim UTC");
  assert.ok(/DTSTAMP:\d{8}T\d{6}Z/.test(ics), "DTSTAMP is a real instant and stays UTC");
});

test("toIcsLocal keeps wall-clock; addWallHours does not cross into UTC", () => {
  assert.equal(toIcsLocal("2026-08-01 16:00:00"), "20260801T160000");
  assert.equal(toIcsLocal("2026-08-01T16:00"), "20260801T160000");
  assert.equal(toIcsLocal("nonsense"), null);
  assert.equal(addWallHours("2026-08-01 16:00:00", 2), "20260801T180000");
  assert.equal(addWallHours("2026-08-01 23:30:00", 2), "20260802T013000");
});

test("the calendar timezone is selectable and threads into DTSTART", () => {
  const ics = buildIcs([EV], { now: "2026-07-26T00:00:00Z", tzid: "America/New_York" });
  assert.ok(ics.includes("TZID:America/New_York"));
  assert.ok(ics.includes("X-WR-TIMEZONE:America/New_York"));
  assert.ok(ics.includes("DTSTART;TZID=America/New_York:20260801T160000"));
  assert.ok(!ics.includes("America/Denver"), "a selected zone must not leave the default behind");
});

test("the default zone is Denver — the operating facility", () => {
  assert.equal(DEFAULT_TZID, "America/Denver");
  const ics = buildIcs([EV], { now: "2026-07-26T00:00:00Z" });
  assert.ok(ics.includes("TZID:America/Denver"));
});

test("a zone with no DST emits a single STANDARD component", () => {
  const b = icsVtimezone("America/Phoenix").join("|");
  assert.ok(b.includes("TZID:America/Phoenix"));
  assert.ok(!b.includes("BEGIN:DAYLIGHT"), "Phoenix does not observe DST");
  assert.equal((b.match(/BEGIN:STANDARD/g) || []).length, 1);
});

test("an unsupported zone falls back to the default block rather than emitting nothing", () => {
  const b = icsVtimezone("Mars/Olympus").join("|");
  assert.ok(b.includes("TZID:America/Denver"), "fall back, never emit a dangling TZID reference");
  assert.ok(SUPPORTED_TZIDS.includes("America/Denver"));
});

test("an event with an unparseable start is skipped, not emitted broken", () => {
  const ics = buildIcs([{ ...EV, starts_at: "nonsense" }], {});
  assert.ok(!ics.includes("BEGIN:VEVENT"));
  assert.ok(ics.includes("END:VCALENDAR"), "calendar must still be valid");
});

test("commas in an event name are escaped, not left to split the property", () => {
  const ics = buildIcs([{ ...EV, name: "Slam, Round 2" }], {});
  assert.ok(ics.includes("SUMMARY:Slam\\, Round 2"));
});

test("empty event list still yields a valid empty calendar", () => {
  const ics = buildIcs([], {});
  assert.ok(ics.includes("BEGIN:VCALENDAR") && ics.includes("END:VCALENDAR"));
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

/* ---------- feedEtag ---------- */
test("etag is stable for identical input and changes when a row changes", () => {
  const a = feedEtag([{ id: 1, updated_at: "x", deleted_at: null }]);
  const b = feedEtag([{ id: 1, updated_at: "x", deleted_at: null }]);
  const c = feedEtag([{ id: 1, updated_at: "y", deleted_at: null }]);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("etag changes when an event is cancelled", () => {
  const live = feedEtag([{ id: 1, updated_at: "x", deleted_at: null }]);
  const gone = feedEtag([{ id: 1, updated_at: "x", deleted_at: "2026-07-26" }]);
  assert.notEqual(live, gone);
});

test("etag is a weak validator in quoted form", () => {
  assert.match(feedEtag([]), /^W\/"[0-9a-f]+"$/);
});

/* ---------- sha256Hex ---------- */
test("sha256Hex matches the known digest for 'abc'", async () => {
  assert.equal(await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex output is 64 lowercase hex chars", async () => {
  assert.match(await sha256Hex("boomtown"), /^[0-9a-f]{64}$/);
});
