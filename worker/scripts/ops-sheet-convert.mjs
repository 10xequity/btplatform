#!/usr/bin/env node
/**
 * Boomtown Platform — operations-sheet converter (party-booking spec v1.1, unit 2)
 * File: worker/scripts/ops-sheet-convert.mjs · Version: v1.0 · Date: 2026-11-20
 *
 * One-time converter from the owner's Google Sheet into the CSV that
 * POST /api/admin/facility/import already accepts. IT WRITES NOTHING TO THE DATABASE: it reads
 * two JSON files (the `values` arrays the Sheets API returns for the daily tab and the weekly
 * grid) and writes a CSV plus a plain-English dry-run report for the owner.
 *
 *   node worker/scripts/ops-sheet-convert.mjs --events events.json --weekly grid.json \
 *        [--live live.txt] [--from 2026-11-22] [--until 2026-12-20] --out <dir>
 *   node worker/scripts/ops-sheet-convert.mjs --selftest
 *
 * THE ONE RULE: a row that cannot be read with certainty is FLAGGED, never guessed. The only
 * assumption made is a missing am/pm on a START time taken from its END ("5 - 10 PM"), and
 * every row read that way is listed.
 *
 * The sheet data itself is the owner's and is NOT committed — this repository is public.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

/* ---------- time ---------- */

function clock(s, inherit = null) {
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  const mer = (m[3] || inherit || "").toLowerCase();
  if (!mer || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return { min: (Number(m[1]) % 12 + (mer === "pm" ? 12 : 0)) * 60 + Number(m[2] || 0), mer, own: !!m[3] };
}

/** "8 AM - 4 PM" → { start, end } in minutes, or { error } saying why it was not read. */
export function parseRange(text) {
  const t = String(text || "").trim();
  if (!t) return { missing: true };
  const parts = t.split(/\s*[-–]\s*/);
  if (parts.length === 1) return clock(t) ? { error: `only one time ("${t}"), no end` } : { error: `unreadable time "${t}"` };
  if (parts.length !== 2) return { error: `unreadable time "${t}"` };
  const end = clock(parts[1]);
  if (!end) return { error: `unreadable time "${t}"` };
  const start = clock(parts[0], end.mer);
  if (!start) return { error: `unreadable time "${t}"` };
  if (end.min <= start.min) {
    // A real overnight ends in the small hours. Anything else is a typo ("8 PM - 1 PM").
    if (end.mer === "am" && end.min <= 180 && start.own) return { start: start.min, end: end.min, overnight: true };
    return { error: `ends before it starts ("${t}"), likely a typo` };
  }
  return { start: start.min, end: end.min, assumed: !start.own };
}

const fmt = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m % 1440 >= 720 ? "PM" : "AM"}`;

function isoDate(text) {
  const m = String(text).match(/([A-Za-z]+) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const mo = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(m[1].toLowerCase());
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

/* ---------- what a cell says ---------- */

export const ZONES = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 10], 6: [11, 12], 7: [13, 14, 15] };
const HOLIDAY = /^(thanksgiving|black ?friday|christmas|nye|nyd|easter)$/i;
const LEAGUE_NIGHT = /\b(QC|MPS|MPC|drop.?in|adult leagues)\b/i;
const COLUMNS = [
  { col: 1, name: "Hardwood", spaces: "Full Hardwood", courts: [1, 2, 3, 4, 5, 6, 7, 8] },
  { col: 3, name: "Sports Court", spaces: "Sports Court", courts: [9, 10, 11, 12, 13, 14, 15] },
  { col: 5, name: "Evening", spaces: null },
  { col: 7, name: "Event/Sports", spaces: null },
  { col: 9, name: "Turf", spaces: null },
];

/** Strip the "(BUSY)" style tags out of a title; report what they said. */
export function cleanTitle(raw) {
  let title = String(raw || "").trim();
  const canceled = /\(\s*cancel+ed\s*\)/i.test(title);
  const lvl = title.match(/\(\s*(not busy|busy|medium|med)\s*\)|\)\s*(busy)\b/i);
  title = title.replace(/\(\s*(not busy|busy|medium|med|cancel+ed)\s*\)/ig, "").replace(/\)\s*busy\b/i, ")").replace(/\s+/g, " ").trim();
  return { title, canceled, level: lvl ? (lvl[1] || lvl[2]).toLowerCase() : null };
}

/** Operator is a GUESS from the title and is listed in the report for the owner to confirm. */
export function operatorFor(title) {
  if (/\b(QC|queens)\b/i.test(title)) return "Queens Club";
  if (/\b(MPS|MPC|match point|revco)\b/i.test(title)) return "Match Point Social";
  if (/\b(cobo|club boom|colorado boom)\b/i.test(title) || /^[A-Z][a-z]+ \d\d \| /.test(title)) return "Colorado Boom";
  if (/shoot ?360|s360/i.test(title)) return "Shoot 360 Denver";
  if (/\b(boomtown|usav|drop.?in|master'?s|experiment|men'?s .*4s|mens and women)\b/i.test(title)) return "Boomtown Athletics";
  return "External / Rental";
}

function zonesInTitle(title) {
  const m = title.match(/zones?\s*\(([\d,\s]+)\)/i);
  if (!m) return null;
  const zs = m[1].split(",").map((z) => Number(z.trim())).filter((z) => ZONES[z]);
  return zs.length ? zs : null;
}
const courtText = (courts) => courts.map((c) => `VB ${c}`).join(", ");

/* ---------- the daily tab ---------- */

export function convertDaily(values) {
  const out = { ready: [], closures: [], open: [], canceled: [], covered: [], flagged: [], assumed: [] };
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const date = isoDate(row[0]);
    if (!date) { if (row.some((c) => c)) out.flagged.push({ date: row[0] || "?", column: "-", text: row.join(" "), why: "unreadable date" }); continue; }
    for (const c of COLUMNS) {
      const rawTitle = String(row[c.col] || "").trim(), rawTime = String(row[c.col + 1] || "").trim();
      if (!rawTitle && !rawTime) continue;
      const where = { date, column: c.name, text: [rawTitle, rawTime].filter(Boolean).join(" · ") };
      if (!rawTitle) { out.flagged.push({ ...where, why: "a time with no event name" }); continue; }
      const { title, canceled, level } = cleanTitle(rawTitle);
      if (canceled) { out.canceled.push(where); continue; }
      if (/^open\b/i.test(title)) { out.open.push(where); continue; }
      if (HOLIDAY.test(title) && !rawTime) {
        out.closures.push({ date, start: "12:00 AM", end: "12:00 AM", title: `Closed: ${title}`, operator: "Boomtown Athletics", spaces: "Whole Facility", closure: "yes", notes: "Holiday from the operations sheet" });
        continue;
      }
      const zones = zonesInTitle(title);
      // A league night in a column that names no courts belongs to the weekly grid, timed or not.
      if (!c.courts && !zones && LEAGUE_NIGHT.test(title)) { out.covered.push({ ...where, why: "the weekly grid has this night zone by zone" }); continue; }
      const t = parseRange(rawTime);
      if (t.missing) { out.flagged.push({ ...where, why: "no time given" }); continue; }
      if (t.error) { out.flagged.push({ ...where, why: t.error }); continue; }
      const courts = zones ? zones.flatMap((z) => ZONES[z]) : c.courts;
      if (!courts) { out.flagged.push({ ...where, why: "the sheet does not say which courts" }); continue; }
      const booking = {
        date, start: fmt(t.start), end: fmt(t.end), start_min: t.start, end_min: t.overnight ? 1440 : t.end, title,
        operator: operatorFor(title), spaces: zones ? courtText(courts) : c.spaces, courts, closure: "",
        notes: [level ? `Sheet tag: ${level}` : "", /\d+\s*courts/i.test(title) && !zones ? `Sheet names a court count; booked on the whole ${c.name} side, narrow by hand` : ""].filter(Boolean).join(". "),
      };
      out.ready.push(booking);
      if (t.assumed) out.assumed.push({ ...where, why: `start read as ${booking.start}` });
    }
  }
  return out;
}

/* ---------- the weekly grid ---------- */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function convertWeekly(values) {
  const dayRow = values.find((r) => r.some((c) => DAYS.includes(String(c).trim()))) || [];
  const head = values.findIndex((r) => String(r[0]).trim() === "Time");
  const runs = [];
  for (let col = 1; col < dayRow.length; col++) {
    const day = String(dayRow[col] || "").trim();
    if (!DAYS.includes(day)) continue;
    for (let z = 1; z <= 7; z++) {
      let open = null;
      for (let r = head + 1; r <= values.length; r++) {
        const at = r < values.length ? clock(values[r][0]) : null;
        const label = at ? String(values[r][col + z - 1] || "").trim() : "";
        if (open && label !== open.label) { runs.push(open); open = null; }
        if (!at) break;
        if (label && !open) open = { day, zone: z, label, start: at.min, end: at.min + 30 };
        else if (open) open.end = at.min + 30;
      }
    }
  }
  // Same label, same day, same hours across zones = one booking holding several zones.
  const merged = new Map();
  for (const r of runs) {
    const k = [r.day, r.label, r.start, r.end].join("|");
    if (!merged.has(k)) merged.set(k, { ...r, zones: [] });
    merged.get(k).zones.push(r.zone);
  }
  return [...merged.values()].map((m) => ({
    day: m.day, title: m.label, start_min: m.start, end_min: m.end, start: fmt(m.start), end: fmt(m.end),
    zones: m.zones, courts: m.zones.flatMap((z) => ZONES[z]), spaces: courtText(m.zones.flatMap((z) => ZONES[z])),
    operator: operatorFor(m.label),
  }));
}

function occurrences(day, from, until) {
  const out = [];
  const d = new Date(from + "T00:00:00Z"), end = new Date(until + "T00:00:00Z");
  while (d.getUTCDay() !== DAYS.indexOf(day)) d.setUTCDate(d.getUTCDate() + 1);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  return out;
}

/* ---------- conflicts against what the calendar already holds ---------- */

/** live.txt lines: date|start_min|end_min|firstCourt-count|title (courts are a contiguous run). */
function readLive(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((l) => {
    const [date, s, e, span, ...title] = l.split("|");
    const [first, n] = span.split("-").map(Number);
    return { date, start_min: Number(s), end_min: Number(e), courts: Array.from({ length: n }, (_, i) => first + i), title: title.join("|") };
  });
}
const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
function clash(b, live) {
  return live.filter((l) => l.date === b.date && !(l.end_min <= b.start_min || l.start_min >= b.end_min) && l.courts.some((c) => b.courts.includes(c)));
}

/* ---------- output ---------- */

const csvCell = (v) => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");
const toCsv = (rows) => ["Date,Start,End,Title,Operator,Spaces,Closure,Repeat,Notes",
  ...rows.map((r) => [r.date, r.start, r.end, r.title, r.operator, r.spaces, r.closure || "", r.repeat || "", r.notes || ""].map(csvCell).join(","))].join("\n") + "\n";

function report({ daily, weekly, live, from, until, totalDateRows }) {
  // A title such as "Kim 14 | Tara 15" carries a pipe, which inside a table row is a column
  // break. Report only: the CSV keeps the sheet's own text.
  const depipe = (r) => ({ ...r, title: r.title.replace(/\s*\|\s*/g, " / ") });
  daily = { ...daily, ready: daily.ready.map(depipe) }; weekly = weekly.map(depipe);
  const L = [];
  const list =(rows, f) => rows.length ? rows.map(f).join("\n") : "_None._";
  const cell = (r) => `| ${r.date} | ${r.column} | ${r.text.replace(/\|/g, "/")} | ${r.why || ""} |`;
  const table = (rows) => rows.length ? "| Date | Column | What the sheet says | Why |\n|---|---|---|---|\n" + rows.map(cell).join("\n") : "_None._";
  let dup = [], hit = [];
  if (live) for (const b of daily.ready) {
    const c = clash(b, live); if (!c.length) continue;
    (c.some((l) => norm(l.title) === norm(b.title) || norm(l.title).includes(norm(b.title)) || norm(b.title).includes(norm(l.title))) ? dup : hit).push({ b, c });
  }
  const occ = weekly.map((w) => ({ w, dates: occurrences(w.day, from, until) }));
  const weeklyTotal = occ.reduce((n, o) => n + o.dates.length, 0);
  let weeklyHit = 0; const weeklyHitRows = [];
  if (live) for (const o of occ) for (const date of o.dates) {
    const c = clash({ ...o.w, date }, live);
    if (c.length) { weeklyHit++; if (weeklyHitRows.length < 25) weeklyHitRows.push(`| ${date} | ${o.w.title} (Zone ${o.w.zones.join(", ")}) ${o.w.start}–${o.w.end} | ${c.map((l) => l.title).join("; ")} |`); }
  }
  const ops = new Map();
  for (const r of [...daily.ready, ...weekly]) { const k = `${r.operator}`; if (!ops.has(k)) ops.set(k, new Set()); ops.get(k).add(r.title); }

  L.push(`# Operations sheet import: dry run`, ``,
    `**File:** sheet-import-dryrun · **Version:** v1.0 · **Date:** ${new Date().toISOString().slice(0, 10)} · **Status:** Dry run only. Nothing was written to the calendar.`, ``,
    `## Summary`, ``,
    `| | Count |`, `|---|---|`,
    `| Days on the "Events 2027" tab | ${totalDateRows ?? "?"} |`,
    `| Dated events ready to import | ${daily.ready.length} |`,
    `| Holiday closures (whole building, all day) | ${daily.closures.length} |`,
    `| Rows that need you before they can be imported | ${daily.flagged.length} |`,
    `| League-night rows left to the weekly grid | ${daily.covered.length} |`,
    `| "OPEN" rows (not bookings) | ${daily.open.length} |`,
    `| Canceled rows (skipped) | ${daily.canceled.length} |`,
    `| Weekly bookings found on the "2026 Fall Schedule" grid | ${weekly.length} |`,
    `| ...which become this many dated bookings from ${from} to ${until} | ${weeklyTotal} |`,
    live ? `| Ready events already in the calendar (same event, would be skipped) | ${dup.length} |` : ``,
    live ? `| Ready events that clash with a DIFFERENT calendar booking | ${hit.length} |` : ``,
    live ? `| Weekly dated bookings that clash with an existing calendar booking | ${weeklyHit} |` : ``, ``,
    `## 1. Rows that need you (never guessed)`, ``, table(daily.flagged), ``,
    `## 2. Read with one assumption (start time took its AM/PM from the end time)`, ``, table(daily.assumed), ``,
    `## 3. Holiday closures proposed`, ``, list(daily.closures, (c) => `- ${c.date}: ${c.title}`), ``,
    `## 4. "OPEN" rows and canceled rows (not imported)`, ``, table([...daily.open.map((r) => ({ ...r, why: "open" })), ...daily.canceled.map((r) => ({ ...r, why: "canceled" }))]), ``,
    `## 5. Evening league rows left to the weekly grid`, ``,
    `The Evening column names leagues (QC, MPS, drop-in) without saying which courts. The weekly grid has the same nights zone by zone, so these are not imported from the daily tab.`, ``, table(daily.covered), ``,
    `## 6. Weekly grid: what each night becomes`, ``,
    `Each half-hour row is read as a 30-minute slot, so a label in the 11:00 PM row ends at 11:30 PM.`, ``,
    `| Day | Hours | Zones | Booking | Operator (guessed) | Dates |`, `|---|---|---|---|---|---|`,
    ...occ.map((o) => `| ${o.w.day} | ${o.w.start}–${o.w.end} | ${o.w.zones.join(", ")} | ${o.w.title} | ${o.w.operator} | ${o.dates.length} |`), ``);
  if (live) L.push(
    `## 7. Against the calendar as it stands today`, ``,
    `The calendar already holds ${live.length} bookings from ${live[0]?.date} on, from the August import of an earlier copy of this sheet. Those were booked on whole sides of the floor, not zones.`, ``,
    `### Ready events that clash with a different booking`, ``,
    hit.length ? "| Date | Sheet event | Clashes with |\n|---|---|---|\n" + hit.map(({ b, c }) => `| ${b.date} | ${b.title} ${b.start}–${b.end} (${b.spaces}) | ${c.map((l) => `${l.title} ${fmt(l.start_min)}–${fmt(l.end_min)}`).join("; ")} |`).join("\n") : "_None._", ``,
    `### Weekly bookings that clash (first 25 of ${weeklyHit})`, ``,
    weeklyHitRows.length ? "| Date | Weekly booking | Clashes with |\n|---|---|---|\n" + weeklyHitRows.join("\n") : "_None._", ``);
  L.push(`## 8. Operator guesses to confirm`, ``, `| Operator | Titles |`, `|---|---|`,
    ...[...ops].map(([op, titles]) => `| ${op} | ${[...titles].slice(0, 40).join("; ")} |`), ``,
    `## 9. Ready to import (dated events)`, ``, `| Date | Hours | Event | Spaces | Operator | Notes |`, `|---|---|---|---|---|---|`,
    ...daily.ready.map((b) => `| ${b.date} | ${b.start}–${b.end} | ${b.title} | ${b.spaces} | ${b.operator} | ${b.notes} |`), ``);
  return L.filter((l) => l !== undefined).join("\n");
}

/* ---------- self-check: the messy cases the spec names ---------- */

function selftest() {
  assert.match(parseRange("8 PM - 1 PM").error, /ends before it starts/);          // the sheet's typo
  assert.match(parseRange("7:00 PM").error, /only one time/);                      // no end
  assert.match(parseRange("9 AM - 1 PM/5:15-7").error, /unreadable/);
  assert.deepEqual(parseRange("5:30pm-10pm"), { start: 1050, end: 1320, assumed: false });
  assert.deepEqual(parseRange("5 - 10 PM"), { start: 1020, end: 1320, assumed: true });
  assert.equal(parseRange("4 PM - 12 AM").overnight, true);
  assert.ok(parseRange("").missing);
  assert.deepEqual(cleanTitle("USAV #1(Not Busy)"), { title: "USAV #1", canceled: false, level: "not busy" });
  assert.equal(cleanTitle("Z Ultimate Karate (SPORTS COURT)BUSY").level, "busy");
  assert.equal(cleanTitle("NIKE BB CAMP(CANCELED)").canceled, true);
  const d = convertDaily([[],
    ["Friday, December 4, 2026", "JPS: 2 zones (2,4)", "5:30 PM - 7:30 PM"],
    ["Thursday, November 26, 2026", "THANKSGIVING"],
    ["Sunday, October 25, 2026", "OPEN WEEKEND (Volley for Charity)"],
    ["Saturday, June 12, 2027", "BOYS RMR"],
    ["Sunday, November 22, 2026", "Thanksgiving RevCo", "9 AM - 5 PM"],
    ["Monday, November 16, 2026", "", "", "", "", "", "5 PM - 11 PM"],
    ["Tuesday, October 20, 2026", "", "", "", "", "QC A", "7 PM - 9 PM"]]);
  assert.equal(d.ready[0].spaces, "VB 3, VB 4, VB 7, VB 8");                       // multi-zone note
  assert.equal(d.closures.length, 1);                                              // holiday → closure
  assert.equal(d.open.length, 1);
  assert.equal(d.flagged.find((f) => f.text === "BOYS RMR").why, "no time given"); // flagged, not guessed
  assert.equal(d.ready[1].title, "Thanksgiving RevCo");                            // not mistaken for the holiday
  assert.equal(d.flagged.some((f) => f.why === "a time with no event name"), true);
  assert.equal(d.covered.length, 1);
  const w = convertWeekly([["", "Monday"], ["Time", "Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5", "Zone 6", "Zone 7"],
    ["7:00 PM", "QC", "QC", "", "", "", "", "Futsal"], ["7:30 PM", "QC", "QC", "", "", "", "", ""], ["Set Up", "TAKE DOWN"]]);
  assert.deepEqual(w.map((x) => [x.title, x.zones.join(), x.start_min, x.end_min]), [["QC", "1,2", 1140, 1200], ["Futsal", "7", 1140, 1170]]);
  assert.deepEqual(occurrences("Monday", "2026-11-22", "2026-12-07"), ["2026-11-23", "2026-11-30", "2026-12-07"]);
  console.log("ops-sheet-convert selftest: all checks pass");
}

/* ---------- main ---------- */

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]] : null).filter(Boolean));
if (args.selftest) selftest();
else if (args.events && args.weekly && args.out) {
  const ev = JSON.parse(readFileSync(args.events, "utf8")), wk = JSON.parse(readFileSync(args.weekly, "utf8"));
  const from = args.from || new Date().toISOString().slice(0, 10), until = args.until || "2026-12-20";
  const daily = convertDaily(ev.values), weekly = convertWeekly(wk.values);
  const live = args.live ? readLive(args.live) : null;
  mkdirSync(args.out, { recursive: true });
  writeFileSync(`${args.out}/import-dated.csv`, toCsv([...daily.ready, ...daily.closures]));
  writeFileSync(`${args.out}/import-weekly.csv`, toCsv(weekly.map((w) => ({ ...w, date: occurrences(w.day, from, until)[0], repeat: until, notes: `Weekly, ${w.day}s, Zone ${w.zones.join(", ")}` }))));
  writeFileSync(`${args.out}/dry-run-report.md`, report({ daily, weekly, live, from, until, totalDateRows: ev.totalDateRows }));
  console.log(`ready ${daily.ready.length} · closures ${daily.closures.length} · flagged ${daily.flagged.length} · covered ${daily.covered.length} · open ${daily.open.length} · canceled ${daily.canceled.length} · weekly ${weekly.length}`);
} else if (process.argv[1] && process.argv[1].endsWith("ops-sheet-convert.mjs")) {
  console.log("usage: --events <json> --weekly <json> [--live <txt>] [--from YYYY-MM-DD] [--until YYYY-MM-DD] --out <dir> | --selftest");
}
