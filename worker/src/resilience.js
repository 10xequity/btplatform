/**
 * Boomtown Platform — degrade, do not collapse
 * File: worker/src/resilience.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.77.0
 *
 * Owner 2026-08-03: "If modules fail, do not let it break or stop the system, simply allow it process
 * as best as possible."
 *
 * WHAT WAS ACTUALLY WRONG, AND IT WAS WORSE THAN IT LOOKED. Route dispatch was one `||` chain inside
 * one try/catch. A chain short-circuits on the first non-null, so every module got asked "is this
 * yours?" in order — and a module that THREW while declining a path it does not own took down not just
 * itself but every module after it in the list. A bug in `uploadRoutes` (first in the chain) meant no
 * bracket, no live board, no check-in. Nothing in the code said so, and the response was a bare
 * `500 Server error` with no hint which of forty-odd modules had gone wrong.
 *
 * THE LINE THIS DRAWS, because "never fail" and "fail closed" are both rules here and they conflict:
 *
 *   DEGRADE — a read that could not be answered. A section of a board, a count, one module declining
 *             to answer. The request continues and says what is missing.
 *   FAIL     — anything that decides whether someone is ALLOWED. `buildCtx` and the F-11 org check run
 *             BEFORE any route sees `ctx` and are deliberately outside all of this; `requireStaff`
 *             returns a 403 Response rather than throwing, so it is a value and cannot be swallowed
 *             by an error path. If an authorization check itself explodes, the route it guards throws,
 *             and a throwing route NEVER produces a success — it produces an error naming the module.
 *
 * The rule in one line: **a failure may cost you information, never permission.**
 */

/**
 * Run every route module in order, isolating each one.
 *
 * A module that returns a Response has handled the request — stop. A module that returns null has
 * declined — continue. A module that THROWS is recorded and treated as having declined, because a
 * module which cannot even decide whether a path is its own must not get a veto over the forty modules
 * behind it.
 *
 * If a later module handles the request, the throw cost nothing but a log line — that is the common
 * case, and the whole point. If nothing handles it, the throws are reported: the caller then knows the
 * difference between "no such route" (a real 404) and "the module that owns this route is broken"
 * (a 500 that names it), which the old bare `500 Server error` could not express.
 *
 * @param {Array<[string, Function]>} table  ordered [name, routeFn] pairs
 * @param {Function} onError  called as (name, err) for each throw — logging is the caller's business
 * @returns {{ response: Response|null, failures: Array<{module: string, message: string}> }}
 */
export async function dispatch(table, args, onError) {
  const failures = [];
  for (const [name, route] of table) {
    let out;
    try {
      out = await route(...args);
    } catch (err) {
      failures.push({ module: name, message: err && err.message ? String(err.message) : String(err) });
      if (onError) onError(name, err);
      continue;                     // declined-by-explosion. The next module still gets its turn.
    }
    if (out) return { response: out, failures };
  }
  return { response: null, failures };
}

/**
 * Read several independent things, keeping whatever came back.
 *
 * For a payload assembled from many queries — the live board reads events, divisions, pools, teams,
 * matches and brackets to answer one request. One failing query used to lose all six. A wall display
 * showing the standings and a note that the bracket is temporarily unavailable is worth immeasurably
 * more than a blank screen, and the alternative on a Saturday is somebody refreshing a dead page.
 *
 * `parts` is `{ name: () => Promise<any> }`. Returns `{ values, missing }` where a failed part's value
 * is its `fallback` (default `null`) and its name is listed in `missing`.
 *
 * DELIBERATELY NOT `Promise.allSettled` ALONE: the fallback and the missing list are the point. A
 * caller that got `undefined` back cannot tell an empty result from a broken one, and would render an
 * empty bracket as "no bracket" — which is a wrong answer presented as a fact.
 */
export async function readParts(parts, fallbacks = {}) {
  const names = Object.keys(parts);
  const settled = await Promise.allSettled(names.map((n) => Promise.resolve().then(parts[n])));
  const values = {};
  const missing = [];
  const errors = {};
  settled.forEach((r, i) => {
    const n = names[i];
    if (r.status === "fulfilled") {
      values[n] = r.value;
    } else {
      values[n] = Object.prototype.hasOwnProperty.call(fallbacks, n) ? fallbacks[n] : null;
      missing.push(n);
      errors[n] = r.reason && r.reason.message ? String(r.reason.message) : String(r.reason);
    }
  });
  return { values, missing, errors };
}

/**
 * The sentence a member or spectator reads when something is missing.
 *
 * Standards §8: errors are human sentences, not codes. This is the degraded case, which is a different
 * message from a failure — nothing the reader did is wrong, and there is usually something still worth
 * looking at on the page.
 */
export function degradedNote(missing) {
  if (!missing || !missing.length) return null;
  const nice = {
    divisions: "divisions", pools: "pools", teams: "teams and standings",
    matches: "the schedule", brackets: "the bracket", event: "the event",
  };
  const named = missing.map((m) => nice[m] || m);
  const list = named.length === 1 ? named[0]
    : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `Showing what we can; ${list} could not be loaded just now. This page refreshes on its own.`;
}
