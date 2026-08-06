/**
 * Boomtown Platform — client-direction reachability (roadmap §-1 Block D2, audit R4)
 * File: worker/test/route_reachability.test.mjs · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.90.0
 *
 * WHY: "assert call sites, never definitions" was only ever run in one direction — index.js
 * mounting worker modules — and never in the other: the CLIENT calling the routes. That is how
 * King of the Court shipped "complete as a format" across five releases while no file in web/
 * could start it (audit R4). A route with no caller passes every other gate in this repo.
 *
 * WHAT: derives every /api/admin/* route shape from worker/src (the two routing idioms the
 * module pattern uses: `=== "/api/admin/…"` equality and `.match(/^\/api\/admin\/…$/)` anchored
 * regexes — startsWith() prefix guards are dispatch plumbing, not routes), derives every
 * /api/admin/* caller shape from web/ (string literals, with `${…}` template holes masked to
 * wildcards AFTER comment-stripping — masking first turns `/…/*` into a comment opener, which
 * this file's own first draft discovered by silently eating half its caller corpus), and
 * matches them token-wise.
 *
 * THE BASELINE IS A RATCHET THAT ONLY SHRINKS. 25 admin routes measured uncalled on 2026-08-05
 * (recorded in roadmap §-1c D-4 — six of them are the tryouts squads/offers surface the owner's
 * tester round reported missing, four are the format-engine planning routes §-1b W-C consumes).
 * A NEW uncalled route fails immediately — failure class 1 at birth. A baseline route GAINING a
 * caller also fails, telling you to strike it from the list, so the list can never quietly
 * stagnate and every strike is a reviewed event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SRC_DIR = new URL("../src/", import.meta.url);
const WEB_DIR = new URL("../../web/", import.meta.url);

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

/* ── extraction, pure over source text so the NCs can feed it mutated real files ── */

export function routesFrom(src, file) {
  const out = [];
  for (const m of stripJs(src).matchAll(/===\s*["'`](\/api\/admin\/[^"'`\s]+)["'`]/g)) {
    out.push({ shape: m[1], file });
  }
  for (const m of stripJs(src).matchAll(/\.match\(\/\^(\\\/api\\\/admin\\\/[^$]*?)\$\/\)/g)) {
    out.push({ shape: m[1].replace(/\\\//g, "/").replace(/\([^)]*\)/g, "*"), file });
  }
  return out;
}

export function callersFrom(src, isHtml) {
  let s = isHtml ? stripHtml(src) : src;
  s = stripJs(s);                       // BEFORE masking — a masked * would read as a comment opener
  s = s.replace(/\$\{[^}]*\}/g, "*");
  const out = new Set();
  for (const m of s.matchAll(/["'`](\/api\/admin\/[^"'`]*)/g)) {
    let c = m[1].split("?")[0];
    if (c.endsWith("/")) c += "*";
    out.add(c);
  }
  return out;
}

/* token-wise match: * matches one token; a caller's TRAILING * (a "…/" + expr concatenation)
   matches the remainder. */
const matches = (route, caller) => {
  const rt = route.split("/"), ct = caller.split("/");
  for (let i = 0; i < Math.max(rt.length, ct.length); i++) {
    if (ct[i] === "*" && i === ct.length - 1 && rt.length > ct.length) return true;
    if (rt[i] === undefined || ct[i] === undefined) return false;
    if (ct[i] === "*" || rt[i] === "*") continue;
    if (rt[i] !== ct[i]) return false;
  }
  return true;
};

function corpus() {
  const routes = [];
  for (const f of readdirSync(SRC_DIR).filter((x) => x.endsWith(".js"))) {
    routes.push(...routesFrom(readFileSync(new URL(f, SRC_DIR), "utf8"), f));
  }
  const callers = new Set();
  const walk = (base, rel) => {
    for (const e of readdirSync(new URL(rel, base), { withFileTypes: true })) {
      const r = rel + e.name;
      if (e.isDirectory()) walk(base, r + "/");
      else if (/\.(js|html)$/.test(e.name)) {
        for (const c of callersFrom(readFileSync(new URL(r, base), "utf8"), e.name.endsWith(".html"))) callers.add(c);
      }
    }
  };
  walk(WEB_DIR, "");
  return { routes, callers };
}

const uncalledOf = (routes, callers) => {
  const shapes = [...new Set(routes.map((r) => r.shape))].sort();
  return shapes.filter((shape) => ![...callers].some((c) => matches(shape, c)));
};

/* ── THE BASELINE — measured 2026-08-05 at v0.90.0. Roadmap §-1c D-4 is the work list.
      Strike a line ONLY when its route gains a real caller (this test will demand it). ── */
const BASELINE = [
  "/api/admin/events/*/divisions/assign",
  // "/api/admin/events/*/generate-schedule" — STRUCK v0.94.0 (W-C): "Plan the day" commits here.
  "/api/admin/events/*/matches/*/court",
  // "/api/admin/events/*/schedule/teams" — STRUCK v0.93.0 (W-B): League Manager's edit-matchup
  // modal is its caller. The first strike; the list only shrinks.
  "/api/admin/facility/check",
  // "/api/admin/formats/options" and "/api/admin/formats/plan" — STRUCK v0.94.0 (W-C): the
  // "Plan the day" panel on Tournament Ops is their screen.
  "/api/admin/grants/*",
  "/api/admin/lfg/strikes",
  "/api/admin/lfg/unban",
  "/api/admin/pass-redemptions/*/reverse",
  "/api/admin/pos/sales/*",
  "/api/admin/programs",
  "/api/admin/programs/*",
  "/api/admin/shifts/*/approve",
  "/api/admin/shifts/*/assign",
  "/api/admin/sms/consent",
  // "/api/admin/squads/*", "/api/admin/squads/*/assign", "/api/admin/squads/*/remove" and
  // "/api/admin/tryouts/*/squads" — STRUCK v0.97.0 (W-E.2): admin-squads.html is their screen.
  // Four at once because they are one surface — a board you cannot create a team on is not a
  // board. `tryouts/*/card/*` — STRUCK v0.98.0 (W-E.2b): the correction form on the evaluate card
  // in admin-tryouts.html is its caller. That was the LAST uncalled tryouts route; the cluster the
  // owner's "try out page does not work — no form to use" pointed at is now empty.
  "/api/admin/subs/requests",
  "/api/admin/subs/signups",
  // "/api/admin/tryouts/*/summary" — STRUCK v0.96.0 (W-E): the Director summary control on
  // admin-tryouts.html is its caller. Until then that button pointed at admin-buildstatus.html.
];

test("every /api/admin route has a caller in web/, except the recorded shrink-only baseline", () => {
  const { routes, callers } = corpus();
  // Floors: an extraction idiom drifting to zero must fail loud, not report a clean empty scan.
  assert.ok(routes.length >= 140, `route corpus shrank: ${routes.length} (failure class 4 — did an idiom change?)`);
  assert.ok(callers.size >= 110, `caller corpus shrank: ${callers.size} (failure class 4)`);

  const uncalled = uncalledOf(routes, callers);
  const fresh = uncalled.filter((u) => !BASELINE.includes(u));
  assert.deepEqual(fresh, [],
    `NEW admin route(s) with no caller in web/ — a route with no screen is failure class 1:\n  ${fresh.join("\n  ")}`);

  const healed = BASELINE.filter((b) => !uncalled.includes(b));
  assert.deepEqual(healed, [],
    `baseline route(s) now HAVE a caller — strike them from BASELINE so the ratchet keeps shrinking:\n  ${healed.join("\n  ")}`);
});

test("the KOTC session routes are called from web/ (Block D1 — the audit R4 pair specifically)", () => {
  const { callers } = corpus();
  for (const shape of ["/api/admin/events/*/kotc", "/api/admin/kotc/*/players"]) {
    assert.ok([...callers].some((c) => matches(shape, c)),
      `${shape} lost its caller — King of the Court just became unstartable from the UI again`);
  }
});

/* ── negative controls — real input, mutated ── */

test("NC-1: an uncalled route added to a real module is caught as fresh", () => {
  const real = readFileSync(new URL("kotcplay.js", SRC_DIR), "utf8");
  const mutated = real + `\n  if (p === "/api/admin/kotc-nc-never-called" && m === "GET") { }\n`;
  const routes = routesFrom(mutated, "kotcplay.js");
  assert.ok(routes.some((r) => r.shape === "/api/admin/kotc-nc-never-called"), "mutation did not land");
  const { callers } = corpus();
  const uncalled = uncalledOf(routes, callers);
  assert.ok(uncalled.includes("/api/admin/kotc-nc-never-called"),
    "a route with no caller must be reported — if this passes silently the guard is blind");
});

test("NC-2: stripping the KOTC create call from the real event page loses the caller", () => {
  const real = readFileSync(new URL("assets/admin-event.js", WEB_DIR), "utf8");
  const mutated = real.replace(/api\(`\/api\/admin\/events\/\$\{id\}\/kotc`/, "api(`/nc-gone`");
  assert.notEqual(mutated, real, "mutation did not land — NC is vacuous");
  const callers = callersFrom(mutated, false);
  assert.equal([...callers].some((c) => matches("/api/admin/events/*/kotc", c)), false,
    "with the call stripped, the route must lose its caller");
});

test("NC-3: comments never count — not as a route definition, not as a caller", () => {
  const asComment = `/* if (p === "/api/admin/only-in-a-comment") */\nconst x = 1; // api("/api/admin/also-comment")`;
  assert.equal(routesFrom(asComment, "nc").length, 0, "a route in a comment must not count as a definition");
  assert.equal(callersFrom(asComment, false).size, 0, "a caller in a comment must not count as a caller");
  // and the stripper itself can fail: the same text OUTSIDE a comment must count.
  const asCode = `if (p === "/api/admin/only-in-a-comment") { }`;
  assert.equal(routesFrom(asCode, "nc").length, 1, "the comment-stripper must not eat real code");
});
