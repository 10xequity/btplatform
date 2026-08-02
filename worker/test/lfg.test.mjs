/**
 * Boomtown Platform — LFG tests
 * File: worker/test/lfg.test.mjs · Version: v1.0 · Date: 2026-08-01 · Ships in: v0.45.0
 *
 * Covers the four recurring failure classes (library §2):
 *   1. built-but-uncalled  → mount guard reads index.js SOURCE for the dispatch + wire lines
 *   2. decision vs force   → BAIL_WINDOW_HOURS / STRIKE_DAYS / BAN_DAYS asserted at spec values
 *   3. narrow guard        → org-scope scan reads every SQL string in lfg.js THROUGH .bind(,
 *                            with a negative control proving the scan itself can fail
 *   4. skipped gate        → these run in the full suite; nothing is projected
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isBail, cautionFor, banActiveUntil, reliabilityFrom, normalizeListing,
  BAIL_WINDOW_HOURS, STRIKE_DAYS, BAN_DAYS, OPEN_LISTINGS_MAX, KINDS,
} from "../src/lfg.js";
import { isMinor } from "../src/family.js";

const NOW = new Date("2026-08-01T18:00:00Z");

/* ---------------------- spec constants (owner 2026-08-01) ---------------------- */

test("spec constants are the owner's numbers: 12h bail, 14-day caution, 30-day ban", () => {
  assert.equal(BAIL_WINDOW_HOURS, 12); // owner: "12 hours (potentially 24)" — one edit here
  assert.equal(STRIKE_DAYS, 14);
  assert.equal(BAN_DAYS, 30);
  assert.ok(OPEN_LISTINGS_MAX >= 1);
  assert.deepEqual(KINDS, ["team_need", "player_avail", "casual"]);
});

/* ---------------------- bail window ---------------------- */

test("withdrawing 11h before game time is a bail; 13h before is not", () => {
  assert.equal(isBail("2026-08-02T05:00:00Z", NOW), true);   // 11h out
  assert.equal(isBail("2026-08-02T07:00:00Z", NOW), false);  // 13h out
});

test("bail boundary: exactly 12h counts as a bail; game time passed or unknown never does", () => {
  assert.equal(isBail("2026-08-02T06:00:00Z", NOW), true);   // exactly 12h — inclusive
  assert.equal(isBail("2026-08-01T12:00:00Z", NOW), false);  // already played → no-show territory
  assert.equal(isBail(null, NOW), false);                    // free-form casual: no window to violate
  assert.equal(isBail("next tuesday-ish", NOW), false);      // unparseable → no window
});

test("the window is a parameter: at 24h the 13h withdrawal becomes a bail", () => {
  assert.equal(isBail("2026-08-02T07:00:00Z", NOW, 24), true);
});

/* ---------------------- caution escalation ---------------------- */

const strike = (daysAgo, kind = "no_show", cleared = null) => ({
  kind, created_at: new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
  cleared_at: cleared, deleted_at: null,
});

test("one live no-show inside 14 days → yellow; two → red; none → none", () => {
  assert.equal(cautionFor([], NOW), "none");
  assert.equal(cautionFor([strike(3)], NOW), "yellow");
  assert.equal(cautionFor([strike(3), strike(1)], NOW), "red");
});

test("a strike older than 14 days no longer cautions; consumed (cleared) strikes never do", () => {
  assert.equal(cautionFor([strike(15)], NOW), "none");
  assert.equal(cautionFor([strike(2, "no_show", "2026-08-01T00:00:00Z")], NOW), "none");
});

test("bail strikes feed reliability counts, not the caution icon", () => {
  assert.equal(cautionFor([strike(1, "bail"), strike(2, "bail")], NOW), "none");
});

/* ---------------------- ban / auto-unban ---------------------- */

test("an active ban reports its end; an expired one auto-lifts by time; lifted_at lifts early", () => {
  const active = { ends_at: "2026-08-20T00:00:00Z", lifted_at: null, deleted_at: null };
  const expired = { ends_at: "2026-07-20T00:00:00Z", lifted_at: null, deleted_at: null };
  const lifted = { ends_at: "2026-08-20T00:00:00Z", lifted_at: "2026-08-01T00:00:00Z", deleted_at: null };
  assert.equal(banActiveUntil([active], NOW), "2026-08-20T00:00:00Z");
  assert.equal(banActiveUntil([expired], NOW), null);   // owner: "Unban after 30 days" — automatic
  assert.equal(banActiveUntil([lifted], NOW), null);
  assert.equal(banActiveUntil([], NOW), null);
});

/* ---------------------- reliability is counts, never a rating ---------------------- */

test("reliability exposes showed/bailed/no_shows counts and nothing rating-shaped", () => {
  const r = reliabilityFrom({ showedCount: 7, bailCount: 1, noShowCount: 0 });
  assert.deepEqual(Object.keys(r).sort(), ["bailed", "no_shows", "showed"]);
  assert.equal(r.showed, 7);
});

/* ---------------------- listing normalization ---------------------- */

test("a team need requires a name and forms its shell immediately", () => {
  const bad = normalizeListing({ kind: "team_need" });
  assert.equal(bad.ok, false);
  const good = normalizeListing({ kind: "team_need", team_name: "Net Gains", skill_level: "bb", game_type: "6s" });
  assert.equal(good.ok, true);
  assert.equal(good.listing.forming, 1); // "Need a team →" creates the shell at post time
  assert.equal(good.listing.skill_level, "bb");
});

test("casual play is free-form — no team name needed, unknown vocab collapses to 'any'", () => {
  const c = normalizeListing({ kind: "casual", skill_level: "sandbagger", location_note: "Wash Park, south courts" });
  assert.equal(c.ok, true);
  assert.equal(c.listing.forming, 0);
  assert.equal(c.listing.skill_level, "any");
  assert.equal(c.listing.location_note, "Wash Park, south courts");
});

test("an unrecognized kind is refused with a human sentence", () => {
  const r = normalizeListing({ kind: "ranked_ladder" });
  assert.equal(r.ok, false);
  assert.match(r.error, /posting/i);
});

/* ---------------------- 18+ gate contract (fail closed) ---------------------- */

test("the age gate fails closed: unknown birthdate is a minor and is blocked", () => {
  // The route gates on family.js isMinor — this pins the contract LFG depends on.
  assert.equal(isMinor(null), true);
  assert.equal(isMinor(""), true);
  assert.equal(isMinor("2010-01-01", NOW), true);
  assert.equal(isMinor("1990-01-01", NOW), false);
});

/* ---------------------- failure class 3: org-scope scan through .bind( ---------------------- */

/**
 * Every SQL statement in lfg.js that touches an lfg_ table (or team_members/notifications)
 * must carry a bound org_id. The v0.45 first-build scan read every string in the FILE and an
 * apostrophe inside a comment ("owner's") swallowed real queries — a guard narrower than its
 * subject reporting clean (failure class 3). This version anchors on each env.DB.prepare(
 * call and extracts exactly its first string argument, then asserts it saw EVERY prepare
 * call, so no statement can be invisible to the guard. Negative controls below prove the
 * scan can fail in both directions.
 */
function preparedStatements(source) {
  const stmts = [];
  let misses = 0;
  const anchor = /env\.DB\.prepare\(\s*/g;
  let m;
  while ((m = anchor.exec(source))) {
    const q = source[anchor.lastIndex];
    if (q !== '"' && q !== "'" && q !== "`") { misses++; continue; }
    let i = anchor.lastIndex + 1, out = "";
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") { out += source[i + 1] ?? ""; i += 2; continue; }
      if (ch === q) break;
      out += ch; i++;
    }
    if (i >= source.length) { misses++; continue; }
    stmts.push(out);
  }
  return { stmts, misses };
}

test("every lfg query is org-scoped (org_id bound in the statement)", () => {
  const src = readFileSync(new URL("../src/lfg.js", import.meta.url), "utf8");
  const { stmts, misses } = preparedStatements(src);
  assert.equal(misses, 0, "a prepare call the scan cannot read is a query it cannot enforce");
  const prepares = (src.match(/env\.DB\.prepare\(/g) || []).length;
  assert.equal(stmts.length, prepares, `scan saw ${stmts.length} of ${prepares} prepare calls`);
  const relevant = stmts.filter(s => /\b(FROM|INTO|UPDATE)\s+(lfg_|team_members|notifications)/i.test(s));
  assert.ok(relevant.length >= 15, `expected the module's lfg queries, saw ${relevant.length}`);
  const unscoped = relevant.filter(s => !/org_id\s*(=|IN|,)\s*\?|\(org_id/i.test(s));
  assert.deepEqual(unscoped, [], `unscoped statements:\n${unscoped.join("\n---\n")}`);
});

test("negative control: the scan flags an unscoped query and accepts a scoped one", () => {
  const bad = 'const x = env.DB.prepare("SELECT * FROM lfg_listings WHERE status=1")';
  const good = 'const x = env.DB.prepare("SELECT * FROM lfg_listings WHERE org_id=?1")';
  assert.equal(preparedStatements(bad).stmts.filter(s => !/org_id\s*=\s*\?/.test(s)).length, 1);
  assert.equal(preparedStatements(good).stmts.filter(s => !/org_id\s*=\s*\?/.test(s)).length, 0);
});

test("negative control: a prepare call built from a variable is counted as a miss, not skipped", () => {
  const sneaky = "env.DB.prepare(dynamicSql)";
  assert.equal(preparedStatements(sneaky).misses, 1, "unreadable prepare must be visible as a miss");
});

/* ---------------------- failure class 1: mounted, not just imported ---------------------- */

test("index.js dispatches lfgRoutes and calls wireLfg — an import line alone must not pass (§6.5)", () => {
  const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(src, /\|\|\s*\(await lfgRoutes\(request, env, url, ctx\)\)/, "dispatch chain must call lfgRoutes");
  assert.match(src, /^wireLfg\(wiredHelpers\);/m, "wireLfg must be invoked");
});
