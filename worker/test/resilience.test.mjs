/* Boomtown Platform — degrade, do not collapse
   File: worker/test/resilience.test.mjs · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.77.0

   Owner 2026-08-03: "If modules fail, do not let it break or stop the system, simply allow it process
   as best as possible."

   TWO THINGS ARE PROVED HERE AND THEY PULL IN OPPOSITE DIRECTIONS.
     1. A broken module must not take down the other 41. Proved by breaking one for real.
     2. A broken module must not let anybody THROUGH. "Never fail" and "fail closed" are both rules in
        this codebase, and the line between them is the whole design: a failure may cost information,
        it may never cost permission.

   AND ONE STRUCTURAL GUARD ON THE WIDEST SET. Nine test files each grep index.js for their own module's
   dispatch entry. That is nine narrow guards, and a module with no test file has none at all — the
   exact shape of failure class 3. This file asserts the mapping BOTH ways for every module at once. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dispatch, readParts, degradedNote } from "../src/resilience.js";

const SRC_DIR = new URL("../src/", import.meta.url);
const INDEX = readFileSync(new URL("index.js", SRC_DIR), "utf8");

/* ================================ 1. isolation ================================ */

const ok = (name) => [name, async () => new Response(name)];
const decline = (name) => [name, async () => null];
const boom = (name) => [name, async () => { throw new Error(name + " exploded"); }];

test("a module that throws while DECLINING does not stop the modules behind it", async () => {
  /* THE ACTUAL BUG. A `||` chain asks every module "is this yours?" in order and short-circuits on the
     first non-null. A module that threw while deciding took the whole request with it — and because
     `uploadRoutes` was FIRST in the list of 42, a fault there meant no brackets, no live board, no
     check-in, and a bare `500 Server error` naming nothing. */
  const table = [boom("upload"), decline("document"), ok("bracket"), ok("live")];
  const r = await dispatch(table, [], () => {});
  assert.ok(r.response, "the request must still be answered");
  assert.equal(await r.response.text(), "bracket", "the module that owns the path must still get it");
  assert.deepEqual(r.failures.map((f) => f.module), ["upload"], "and the failure must be reported, not hidden");
});

test("every module can throw and a later one still answers", async () => {
  // Not one broken module — forty. The property must not depend on how many are down.
  const table = [...Array.from({ length: 40 }, (_, i) => boom("m" + i)), ok("survivor")];
  const r = await dispatch(table, [], () => {});
  assert.equal(await r.response.text(), "survivor");
  assert.equal(r.failures.length, 40);
});

test("the first module to RETURN wins, and nothing after it runs", async () => {
  // Order is load-bearing: two modules can match overlapping paths and the earlier one must win, as
  // the chain did. Asserted by making the later one throw — if it ran, the failure list would show it.
  let laterRan = false;
  const table = [ok("first"), ["later", async () => { laterRan = true; return new Response("later"); }]];
  const r = await dispatch(table, [], () => {});
  assert.equal(await r.response.text(), "first");
  assert.equal(laterRan, false, "a module after the handler must not be called at all");
  assert.deepEqual(r.failures, []);
});

test("nothing handled it and nothing broke: a real 404", async () => {
  const r = await dispatch([decline("a"), decline("b")], [], () => {});
  assert.equal(r.response, null, "null means 'no module owns this' — the caller renders the 404");
  assert.deepEqual(r.failures, []);
});

test("nothing handled it BUT something broke: that is not a 404", async () => {
  /* The distinction the old bare 500 could not express, and it matters operationally. A 404 tells the
     caller the route does not exist — so a director sees "not found" and files a bug about a missing
     feature, when in fact the module that owns it is down and will be back. */
  const r = await dispatch([boom("bracket"), decline("live")], [], () => {});
  assert.equal(r.response, null);
  assert.deepEqual(r.failures.map((f) => f.module), ["bracket"]);
  assert.match(r.failures[0].message, /exploded/, "the message must survive for the log");
});

test("a module returning a falsy non-null is treated as declining, not as an answer", async () => {
  // The chain used `||`, so 0 / "" / false all meant "declined". Preserved deliberately: a module that
  // returns 0 has a bug, and treating that as a response would send an empty 200 to a member.
  for (const falsy of [0, "", false, undefined, null, NaN]) {
    const r = await dispatch([["odd", async () => falsy], ok("real")], [], () => {});
    assert.equal(await r.response.text(), "real", `${String(falsy)} must not count as a response`);
  }
});

test("the error callback sees every failure, so nothing is silently swallowed", async () => {
  // Degrading without a log is just hiding. The whole point is that the request survives AND somebody
  // can find out why it nearly did not.
  const seen = [];
  await dispatch([boom("a"), boom("b"), ok("c")], [], (name, err) => seen.push([name, err.message]));
  assert.deepEqual(seen.map((s) => s[0]), ["a", "b"]);
  assert.match(seen[0][1], /a exploded/);
});

test("NC: isolation can fail — a table with no survivor produces no response", async () => {
  // Without this, `dispatch` could be returning a canned success and every test above would pass.
  const r = await dispatch([boom("only")], [], () => {});
  assert.equal(r.response, null, "isolation must not invent a response out of nothing");
  assert.equal(r.failures.length, 1);
});

/* ================================ 2. permission is never degraded ================================ */

test("the F-11 org check and buildCtx are OUTSIDE the isolated table", () => {
  /* THE LINE THAT MUST NOT MOVE. Isolation is for reads. If the org check were inside the table, a
     module that threw could be skipped past and a later one could answer for an org the caller has no
     business seeing. So it is asserted structurally: the check runs, and it runs before the table is
     even built. */
  const ctxFail = INDEX.indexOf("ctxFail");
  const tableStart = INDEX.indexOf("const table = [");
  assert.ok(ctxFail > 0, "the F-11 org check must still exist");
  assert.ok(tableStart > 0, "the dispatch table must exist");
  assert.ok(ctxFail < tableStart, "the org check must come BEFORE the dispatch table, not inside it");
  assert.match(INDEX, /!ctx\.orgOk && json\(/, "F-11 must still fail closed on a bad org");
  // And the table must not contain the org check, which would make it skippable.
  const table = INDEX.slice(tableStart, INDEX.indexOf("];", tableStart));
  assert.ok(!/orgOk/.test(table), "the org check must not be an entry in the isolated table");
});

test("requireStaff is a returned value, not a throw — so an error path cannot let anyone through", () => {
  /* Authorization in this codebase is `const denied = await requireStaff(...); if (denied) return denied;`
     — a Response, on the success path. `dispatch` only ever turns a THROW into a decline, and a decline
     is never a 200. So the isolation cannot convert a 403 into access. Asserted on the widest set
     rather than trusted: every module that guards a route must use the returning form. */
  const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".js"));
  let checked = 0;
  for (const f of files) {
    const src = readFileSync(new URL(f, SRC_DIR), "utf8");
    if (!/requireStaff/.test(src)) continue;
    checked++;
    // No module may throw from an authorization decision.
    assert.ok(!/throw\s+(new\s+\w*Error)?[^;\n]*requireStaff/.test(src),
      `${f}: authorization must be returned, never thrown — a throw is degraded into a decline`);
  }
  assert.ok(checked >= 10, `expected many modules to use requireStaff, saw ${checked}`);
});

/* ================================ 3. the dispatch table, both ways ================================ */

test("every *Routes module in worker/src is in the dispatch table, and vice versa", () => {
  /* FAILURE CLASS 3, HEAD ON: nine test files each grep index.js for their own module, so a module with
     no test file has no mount guard at all — and "built, tested and uncalled" is failure class 1. This
     checks the WIDEST set, in both directions, so neither a new module nor a deleted one can drift. */
  const exported = new Set();
  for (const f of readdirSync(SRC_DIR).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(new URL(f, SRC_DIR), "utf8");
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([a-zA-Z]+Routes)\b/g)) {
      exported.add(m[1]);
    }
  }
  const tableStart = INDEX.indexOf("const table = [");
  const table = INDEX.slice(tableStart, INDEX.indexOf("];", tableStart));
  const mounted = new Set([...table.matchAll(/\["[a-zA-Z]+",\s+([a-zA-Z]+)\],/g)].map((m) => m[1]));

  assert.ok(exported.size >= 40, `expected 40+ route modules, found ${exported.size}`);

  const unmounted = [...exported].filter((x) => !mounted.has(x)).sort();
  assert.deepEqual(unmounted, [],
    `built but never dispatched (failure class 1): ${unmounted.join(", ")}`);

  const phantom = [...mounted].filter((x) => !exported.has(x)).sort();
  assert.deepEqual(phantom, [],
    `dispatched but not exported by any module — the table names something that does not exist: ${phantom.join(", ")}`);

  // Every mounted module must also be imported and wired. An entry referencing an unimported name
  // would be a build error, but the wire call is easy to forget and silently breaks the helpers.
  for (const fn of mounted) {
    assert.match(INDEX, new RegExp(`import \\{[^}]*\\b${fn}\\b`), `${fn} is in the table but not imported`);
  }
});

test("NC: the table guard can fail — removing an entry is caught in both directions", () => {
  // The assertions above are all `deepEqual([], [])`, which is also what a guard reading the wrong
  // region returns. So a real entry is removed and the guard must notice.
  const tableStart = INDEX.indexOf("const table = [");
  const table = INDEX.slice(tableStart, INDEX.indexOf("];", tableStart));
  assert.match(table, /\["bracket",\s+bracketRoutes\],/, "precondition: the entry exists");

  const mutated = table.replace(/\["bracket",\s+bracketRoutes\],/, "");
  assert.notEqual(mutated, table, "the mutation must land, or this control proves nothing");
  const mounted = new Set([...mutated.matchAll(/\["[a-zA-Z]+",\s+([a-zA-Z]+)\],/g)].map((m) => m[1]));
  assert.ok(!mounted.has("bracketRoutes"), "a removed entry must be detectable as unmounted");
  assert.ok(mounted.has("divisionRoutes"), "and its neighbours must be unaffected");
});

test("the dispatch table preserves the order the || chain had", () => {
  // Order decides which module wins an overlapping path. The restructure had to be order-preserving,
  // and the first and last entries are the ones a careless edit moves.
  const tableStart = INDEX.indexOf("const table = [");
  const table = INDEX.slice(tableStart, INDEX.indexOf("];", tableStart));
  const order = [...table.matchAll(/\["[a-zA-Z]+",\s+([a-zA-Z]+)\],/g)].map((m) => m[1]);
  assert.equal(order[0], "uploadRoutes", "uploadRoutes was first in the chain and must stay first");
  assert.equal(order[order.length - 1], "registrationRoutes",
    "registrationRoutes was the chain's last resort before the 404 and must stay last");
  assert.equal(new Set(order).size, order.length, "no module may be listed twice");
});

/* ================================ 4. partial reads ================================ */

test("a payload built from many reads keeps the parts that worked", async () => {
  /* The live board reads events, divisions, pools, teams, matches and brackets to answer ONE request.
     One failing query used to lose all six. A wall display showing standings plus "the bracket is
     unavailable" is worth immeasurably more than a blank screen. */
  const { values, missing, errors } = await readParts({
    event: async () => ({ id: 1, name: "Test Cup" }),
    teams: async () => [{ name: "A" }, { name: "B" }],
    brackets: async () => { throw new Error("no such table: brackets"); },
  }, { brackets: [] });

  assert.deepEqual(values.event, { id: 1, name: "Test Cup" });
  assert.equal(values.teams.length, 2);
  assert.deepEqual(values.brackets, [], "a failed part falls back to the shape the caller asked for");
  assert.deepEqual(missing, ["brackets"]);
  assert.match(errors.brackets, /no such table/);
});

test("a missing part is distinguishable from an empty one", () => {
  /* THE REASON `missing` EXISTS AT ALL. A caller handed `[]` cannot tell "there is no bracket" from
     "the bracket could not be loaded", and would render the second as the first — a wrong answer
     presented as a fact, which is worse than an error. */
  assert.equal(degradedNote([]), null, "nothing missing means no note at all");
  assert.equal(degradedNote(null), null);
  assert.match(degradedNote(["brackets"]), /bracket could not be loaded/);
  assert.match(degradedNote(["brackets"]), /Showing what we can/);
  // Human sentences, not codes (standards §8), and a real list when there are several.
  const two = degradedNote(["brackets", "teams"]);
  assert.match(two, /the bracket and teams and standings/);
  assert.ok(!/undefined|null|\[object/.test(two));
});

test("all parts failing is still a shaped answer, not a crash", async () => {
  const { values, missing } = await readParts({
    a: async () => { throw new Error("x"); },
    b: async () => { throw new Error("y"); },
  }, { a: [], b: null });
  assert.deepEqual(values, { a: [], b: null });
  assert.deepEqual(missing.sort(), ["a", "b"]);
});

test("a part that throws SYNCHRONOUSLY is caught too", async () => {
  // `parts[n]()` is called, not awaited-into — a thunk that throws before returning a promise would
  // escape a naive implementation and take down the very request this exists to protect.
  const { values, missing } = await readParts({
    sync: () => { throw new Error("thrown before any promise existed"); },
    fine: async () => "ok",
  }, { sync: "fallback" });
  assert.equal(values.sync, "fallback");
  assert.equal(values.fine, "ok");
  assert.deepEqual(missing, ["sync"]);
});

test("NC: readParts can report a failure — a working part is not listed as missing", async () => {
  const { missing } = await readParts({ good: async () => 1 });
  assert.deepEqual(missing, [], "a part that worked must never appear in `missing`");
});
