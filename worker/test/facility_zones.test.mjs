/**
 * Boomtown Platform — 15 courts and the Zone 1–7 presets (migration 0055)
 * File: worker/test/facility_zones.test.mjs · Version: v1.0 · Date: 2026-11-20 · Ships with: migration 0055
 *
 * Party-booking spec v1.1, unit 1. The owner's building has 15 volleyball courts, sold and
 * scheduled as Zones 1–7; migration 0008 seeded 13 and four "Basketball Ct" presets. This file
 * replays the REAL 0008 seed and then the REAL 0055 file into the harness schema and judges the
 * result, so a later edit to either migration is caught here rather than on the calendar.
 *
 * The judgement is one function, verdict(), so the negative controls can run it against a
 * MUTATED copy of the real migration and watch it fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createD1 } from "../testkit/d1-memory.mjs";
import { parseSpacesText, chooseCourts } from "../src/facility.js";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const MIG_DIR = new URL("../../db/migrations/", import.meta.url);
const migration = (n) => readFileSync(new URL(readdirSync(MIG_DIR).find((f) => f.includes(`_${n}_`)), MIG_DIR), "utf8");
const strip = (sql) => sql.replace(/--[^\n]*/g, "");

/** The seed half of 0008 only: its CREATE TABLEs already live in the harness schema. */
const SEED_0008 = strip(migration("0008")).split(";").map((s) => s.trim())
  .filter((s) => /^(INSERT|UPDATE)\b/i.test(s)).join(";\n") + ";";
const SQL_0055 = strip(migration("0055"));

/** The owner's table, spec §3. */
const ZONES = { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 10], 6: [11, 12], 7: [13, 14, 15] };

const BOOKINGS = { // id -> VB numbers held BEFORE 0055
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], // "All Courts" under the 13-court model
  2: [9, 10, 11, 12, 13],                         // "Sports Court"
  3: [1, 2, 3, 4, 5, 6, 7, 8],                    // hardwood only
  4: [13],                                        // one court, booked on purpose
};

function build(sql0055) {
  const DB = createD1(SCHEMA, { foreignKeys: true });
  DB.exec("INSERT INTO orgs (id, name, slug) VALUES (1,'Boomtown Athletics','boomtown'),(2,'Match Point Social','match-point'),(3,'Queens Club','queens-club')");
  DB.exec(SEED_0008);
  for (const [id, courts] of Object.entries(BOOKINGS)) {
    DB.exec(`INSERT INTO space_bookings (id, org_id, title, date, start_min, end_min) VALUES (${id}, 1, 'b${id}', '2027-01-09', 480, 960)`);
    for (const c of courts) DB.exec(`INSERT INTO booking_spaces (booking_id, space_id) VALUES (${id}, ${c})`);
  }
  DB.exec(sql0055);
  return DB;
}

const all = async (DB, sql) => (await DB.prepare(sql).all()).results;

/** Every way the migration could be wrong, as a list of sentences. Empty = correct. */
async function verdict(sql0055) {
  const problems = [];
  let DB;
  try { DB = build(sql0055); } catch (e) { return [`migration did not apply: ${e.message}`]; }
  const spaces = await all(DB, "SELECT id, name, kind, sort FROM spaces WHERE deleted_at IS NULL ORDER BY sort");
  const vb = (id) => { const m = (spaces.find((s) => s.id === id) || {}).name?.match(/^VB (\d+)$/); return m ? Number(m[1]) : null; };

  const courts = spaces.filter((s) => s.kind === "court").map((s) => s.name);
  const want = Array.from({ length: 15 }, (_, i) => `VB ${i + 1}`);
  if (courts.join() !== want.join()) problems.push(`courts in sort order are ${courts.join(", ")}`);
  if (spaces.slice(0, 15).some((s) => s.kind !== "court")) problems.push("a room sorts in front of a court");
  for (const room of ["Party Room 1", "Party Room 2", "Corral 1", "Corral 2"]) {
    if (!spaces.some((s) => s.name === room && s.kind === "room")) problems.push(`missing room ${room}`);
  }

  const presets = await all(DB, "SELECT id, name FROM space_presets WHERE deleted_at IS NULL ORDER BY sort");
  const links = await all(DB, "SELECT preset_id, space_id FROM preset_spaces");
  for (const p of presets) p.space_ids = links.filter((l) => l.preset_id === p.id).map((l) => l.space_id);
  const courtsOf = (p) => p.space_ids.map(vb).sort((a, b) => a - b);

  for (const [z, expected] of Object.entries(ZONES)) {
    const hits = presets.filter((p) => p.name.startsWith(`Zone ${z} `));
    if (hits.length !== 1) { problems.push(`Zone ${z} has ${hits.length} presets`); continue; }
    if (courtsOf(hits[0]).join() !== expected.join()) problems.push(`Zone ${z} holds VB ${courtsOf(hits[0]).join(",")}`);
    // What the CSV importer will resolve when the sheet says "Zone N".
    const viaText = parseSpacesText(`Zone ${z}`, presets, spaces).map(vb).sort((a, b) => a - b);
    if (viaText.join() !== expected.join()) problems.push(`importer text "Zone ${z}" resolves to VB ${viaText.join(",")}`);
  }
  if (presets.some((p) => /Basketball Ct/.test(p.name))) problems.push("an old 'Basketball Ct' preset name survives");
  const allCourts = presets.find((p) => p.name.startsWith("All Courts"));
  if (!allCourts || courtsOf(allCourts).join() !== want.map((_, i) => i + 1).join()) problems.push("All Courts is not VB 1–15");
  const whole = presets.find((p) => p.name.startsWith("Whole Facility"));
  if (!whole || whole.space_ids.length !== spaces.length) problems.push("Whole Facility (closure) does not hold every space");
  const studio = presets.find((p) => p.name.startsWith("Studio"));
  if (!studio || studio.space_ids.length !== 2) problems.push("Studio preset is not the two party rooms");

  const held = async (id) => (await all(DB, `SELECT space_id FROM booking_spaces WHERE booking_id=${id}`)).map((r) => vb(r.space_id)).sort((a, b) => a - b).join();
  if (await held(1) !== want.map((_, i) => i + 1).join()) problems.push("an all-13 booking did not grow to all 15");
  if (await held(2) !== "9,10,11,12,13,14,15") problems.push("a Sports Court booking did not gain VB 14–15");
  if (await held(3) !== BOOKINGS[3].join()) problems.push("a hardwood-only booking changed");
  if (await held(4) !== "13") problems.push("a single-court booking on VB 13 changed");

  const s360 = (await all(DB, "SELECT brand_json, active, is_owned FROM orgs WHERE slug='shoot-360-denver'"))[0];
  if (!s360) problems.push("Shoot 360 Denver operator org missing");
  else if (JSON.parse(s360.brand_json).facility_only !== 1 || s360.active !== 0 || s360.is_owned !== 0) problems.push("Shoot 360 Denver is not shaped as a facility-only operator");

  if (!(await all(DB, "SELECT 1 FROM schema_migrations WHERE version='0055'")).length) problems.push("no 0055 ledger row");
  return problems;
}

test("migration 0055 leaves 15 courts, Zones 1–7 as the owner listed them, and the new rooms", async () => {
  assert.deepEqual(await verdict(SQL_0055), []);
});

test("auto-claim sees 15 courts: with VB 1–13 busy, a 2-court event lands on VB 14–15", async () => {
  const DB = build(SQL_0055);
  const ids = (await all(DB, "SELECT id FROM spaces WHERE kind='court' AND deleted_at IS NULL ORDER BY sort")).map((r) => r.id);
  assert.equal(ids.length, 15);
  const { chosen, shortfall } = chooseCourts(2, ids, new Set(ids.slice(0, 13)));
  assert.deepEqual(chosen, [20, 21]);
  assert.equal(shortfall, 0);
});

test("NC-1: dropping VB 15 from Zone 7 in the real migration is caught", async () => {
  const mutated = SQL_0055.replace("(11,20),(11,21)", "(11,20)");
  assert.notEqual(mutated, SQL_0055, "the anchor must exist in the real file");
  assert.ok((await verdict(mutated)).some((p) => p.includes("Zone 7")));
});

test("NC-2: removing the booking extension is caught", async () => {
  const mutated = SQL_0055.replace("HAVING COUNT(*) = 5", "HAVING COUNT(*) = 99");
  assert.notEqual(mutated, SQL_0055, "the anchor must exist in the real file");
  const p = await verdict(mutated);
  assert.ok(p.some((x) => x.includes("all-13")) && p.some((x) => x.includes("Sports Court")));
});

test("NC-3: a room sorted in front of the courts is caught", async () => {
  const mutated = SQL_0055.replace("(22,'Party Room 1','room',30)", "(22,'Party Room 1','room',0)");
  assert.notEqual(mutated, SQL_0055, "the anchor must exist in the real file");
  assert.ok((await verdict(mutated)).some((p) => p.includes("room sorts in front")));
});
