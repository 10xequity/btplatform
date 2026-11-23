/* Boomtown Platform — "Where's my court?" and the pool-day screens
   File: worker/test/where_is_my_court.test.mjs · Version: v1.0 · Date: 2026-11-23 · Ships in: v0.217.0

   1. The court→zone rule in facility-map.js is migration 0055's seeding, as arithmetic. The guard
      executes the shipped bytes and checks every court 1–15 against the migration's own comment
      (Zone 1 = VB 1–2 … Zone 7 = VB 13–15). Negative control: a mutated rule fails.
   2. The map script is loaded by every page that shows a court to a player (score, live).
   3. Tournament Ops ships the pool-sheet print and the by-pool build; the bracket board ships the
      pool picker and the 3rd-place control — the v0.217.0 surfaces, grepped from the real files. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const MAP = read("web/assets/facility-map.js");

function runMap(src) {
  const win = { BT_CONFIG: {} };
  const ctx = { window: win, document: { addEventListener() {}, createElement() { return { style: {} }; }, head: { appendChild() {} }, body: { appendChild() {} } } };
  vm.runInNewContext(src, ctx);
  return win.BT_FACILITY_MAP;
}

test("court→zone is migration 0055's numbering: 2 per zone, Zone 7 has three, 15 courts", () => {
  const map = runMap(MAP);
  const expect = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5, 10: 5, 11: 6, 12: 6, 13: 7, 14: 7, 15: 7 };
  for (const [c, z] of Object.entries(expect)) assert.equal(map.zoneOf(+c), z, `court ${c}`);
  assert.equal(map.zoneOf(16), null, "no 16th court");
  assert.equal(map.zoneOf(0), null);
  assert.equal(map.TOTAL_COURTS, 15);
  // The migration's own words, so the two can never drift silently.
  const mig = read("db/migrations/2026-11-20_0055_facility-zones_v1_0.sql");
  assert.match(mig, /Zone 7 = VB 13–15/);
  assert.match(mig, /Zone 5 = VB 9–10/);
});

test("NEGATIVE CONTROL: a rule that gives Zone 7 only two courts is caught", () => {
  const broken = MAP.replace("if (c <= 12) return 6;", "if (c <= 13) return 6;");
  assert.notEqual(broken, MAP, "the mutation must land");
  const map = runMap(broken);
  assert.notEqual(map.zoneOf(13), 7, "the mutated rule is wrong, as intended");
});

test("every page that shows a player a court loads the map script, and the button carries the zone", () => {
  for (const page of ["web/score.html", "web/live.html"]) {
    assert.match(read(page), /assets\/facility-map\.js\?v=/, `${page} loads facility-map.js`);
  }
  assert.match(read("web/assets/score.js"), /BT_FACILITY_MAP\.button\(m\.court/);
  assert.match(read("web/assets/live.js"), /data-fm-court="\$\{mt\.court\}"/);
  const map = runMap(MAP);
  assert.match(map.button(13), /Court 13 · Zone 7/);
  assert.match(map.button(13), /data-fm-court="13"/);
});

test("Tournament Ops: the by-pool build, the paper pool sheet, and per-pool standings are wired", () => {
  const html = read("web/tournament.html"), js = read("web/assets/tournament.js");
  assert.match(html, /id="plByPool"/);
  assert.match(html, /id="poolSheetsBtn"/);
  assert.match(html, /id="plNoCap"/);
  assert.match(js, /\$\("plByPool"\)\.onclick/);
  assert.match(js, /games_each: \+\$\("plGames"\)\.value/);
  assert.match(js, /function composePoolSheets\(\)/);
  assert.match(js, /ps-card/, "the scorecard table is rendered");
  assert.match(js, /r\.data\.pools/, "standings render from the server's per-pool groups");
  // The plan-the-day commit stays single-pool by construction (by_pool:false) so the two paths never cross.
  assert.match(js, /rounds: plannedRounds, assign_refs: true, by_pool: false/);
  assert.match(read("web/assets/tournament.css"), /\.ps-grid/);
});

test("Bracket board: the pool picker, no-cap and 3rd-place controls reach the request body", () => {
  const html = read("web/admin-brackets.html"), js = read("web/assets/admin-brackets.js");
  for (const id of ["bPool", "bNoCap", "bThird"]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(js, /pool_id: Number\(\$\("bPool"\)\.value\)/);
  assert.match(js, /third_place: \$\("bThird"\)\.checked/);
  assert.match(js, /cap: \$\("bNoCap"\)\.checked \? 0/);
  assert.match(js, /async function loadPools\(\)/);
  assert.match(js, /col\("3rd place", third\)/, "the 3rd-place match gets its own column");
});

test("the captain's page draws the standings strip above the games", () => {
  const js = read("web/assets/score.js");
  assert.match(js, /function standingsStrip\(data\)/);
  const first = js.indexOf("standingsStrip(r.data)");
  const games = js.indexOf("pending.map(matchCard)");
  assert.ok(first > 0 && first < games, "standings come before the games to score");
});
