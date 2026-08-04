/**
 * Boomtown Platform — clock shift for the test suite (C16)
 * File: worker/scripts/timetravel.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.86.0
 *
 * WHY THIS EXISTS
 * `passes.test.mjs` went red mid-session on 2026-08-04 with an empty diff. `staff_pay.js` defaults a
 * rate's `effective_from` to `datetime('now')` and prices a shift against its own start, and the test
 * hardcoded shifts to 17:00Z that day — after `now` for a few hours, before it ever after. Because
 * `preflight.mjs` gates commits on the suite, that one fixture blocked every commit in the repo.
 *
 * 165 hardcoded `2026-dd-dd` dates live across 25 test files. Static analysis cannot tell the inert
 * ones from the armed ones: whether a date is dangerous depends on what it is compared against, which
 * is in the route, not the test. So this does not analyse. It MOVES THE CLOCK AND RUNS THE SUITE.
 *
 * THE INVARIANT IT MEASURES
 * Shift JS time and SQL time by the SAME offset. Everything written relatively moves with it and keeps
 * its relationships; only a HARDCODED ABSOLUTE date stays put. So:
 *
 *   a test that still passes  →  time-independent
 *   a test that fails         →  has an absolute date coupled to the clock. That is a C16 time bomb,
 *                                and the date it goes off is already fixed.
 *
 * Shifting only one side would be worse than useless — it would redden the CORRECTLY written tests,
 * whose fixtures are relative, and say nothing about the broken ones.
 *
 * USAGE — inert unless BT_TIME_TRAVEL_DAYS is set, so the normal suite is untouched:
 *   node worker/scripts/timecheck.mjs --days 365      # the wrapper; use this
 *   BT_TIME_TRAVEL_DAYS=365 node --import ./worker/scripts/timetravel.mjs --test worker/test/*.test.mjs
 *
 * WHAT IT CANNOT SEE: a coupling that only breaks on a specific calendar date — a leap day, a DST
 * boundary, a month end. Run a few offsets, not one. `timecheck.mjs` defaults to several.
 */

const DAYS = Number(process.env.BT_TIME_TRAVEL_DAYS || 0);

if (DAYS) {
  const OFFSET_MS = DAYS * 86400000;
  const RealDate = Date;

  /**
   * `new Date()` with no arguments means "now" and must shift. Every other form is an explicit
   * instant the caller chose, and must NOT — shifting `new Date("2026-08-04")` would move the very
   * fixtures this is trying to expose.
   */
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + OFFSET_MS);
      else super(...args);
    }
    static now() {
      return RealDate.now() + OFFSET_MS;
    }
  }
  // `Date.parse` and `Date.UTC` come along through static inheritance and stay unshifted, correctly.
  globalThis.Date = ShiftedDate;
}

/** The SQL half. Exported so the D1 shim applies exactly this rule and there is only one copy. */
export function shiftSql(sql) {
  if (!DAYS || typeof sql !== "string") return sql;
  /* SQLite applies modifiers left to right, so inserting ours immediately after 'now' composes with
     any that follow: datetime('now','-7 days') becomes datetime('now','+365 days','-7 days'), which
     is still "seven days before the shifted now". */
  const mod = `'${DAYS >= 0 ? "+" : ""}${DAYS} days'`;
  return sql.replace(/'now'/g, `'now',${mod}`);
}

export const timeTravelDays = DAYS;
