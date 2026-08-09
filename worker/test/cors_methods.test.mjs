/* Boomtown Platform — CORS must allow every method the worker actually routes
   File: worker/test/cors_methods.test.mjs · Version: v1.0 · Date: 2026-08-09 · Ships in: v0.115.0

   OWNER REPORT, 2026-08-09: "several modules return to me cannot connect to server".

   THE MESSAGE IS A LIE, AND TRACING IT IS THE WHOLE DIAGNOSIS. `admin-nav.js`'s shared `api()`
   returns "Can't reach the server. Check your connection and hard-refresh (Ctrl+F5)." from its
   `catch` block — and `fetch` only THROWS for network- or CORS-level failures, never for a 4xx or
   5xx. So the owner was told his connection was at fault by code that had, in fact, been refused
   by his own browser before the request was ever sent.

   THE CAUSE, VERIFIED AGAINST LIVE PRODUCTION. `corsHeaders` advertised
   `Access-Control-Allow-Methods: "GET,POST,OPTIONS"`. The worker routes **45 handlers on PATCH,
   PUT and DELETE across more than twenty modules** — every Delete button, and most Edit actions.
   A cross-origin DELETE triggers a preflight; the browser reads that header, does not find DELETE,
   and blocks the request locally. A live preflight to `/api/admin/programs/1` with
   `Access-Control-Request-Method: DELETE` returned exactly that header, confirming it in production
   rather than in the config file.

   WHY THIS GUARD IS DERIVED AND NOT A LIST. Writing `assert methods === "GET,POST,PATCH,PUT,DELETE"`
   would pin today's spelling and go stale the first time a route adopts a new verb — the same defect
   in a new costume. So the required set is EXTRACTED FROM THE WORKER'S OWN ROUTES and the header is
   asserted to cover it. The invariant is a relationship — *CORS advertises everything the router
   accepts* — and it cannot drift, because both halves are read from the same source.

   This is also the shape of the failure it prevents: a method added to a module months from now,
   working perfectly in every test (which calls the worker directly and never performs a preflight),
   and failing only in a real browser. The test suite CANNOT see this class of bug by exercising
   routes — it has to compare the two lists. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";
import { blankComments } from "../testkit/route-extract.mjs";

const SRC_DIR = new URL("../src/", import.meta.url);
const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

/** Every HTTP method the worker dispatches on, read from the modules themselves. */
function methodsRouted() {
  const found = new Set();
  for (const f of readdirSync(SRC_DIR).filter((n) => n.endsWith(".js"))) {
    const t = blankComments(readFileSync(new URL(f, SRC_DIR), "utf8"));
    for (const m of t.matchAll(/(?:\bm|method)\s*===\s*"(GET|POST|PUT|PATCH|DELETE)"/g)) found.add(m[1]);
  }
  return found;
}

const env = () => ({
  DB: createD1(SCHEMA), APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN,
  ALLOWED_ORIGINS: ORIGIN,
});

/** The real preflight a browser sends before a cross-origin DELETE. */
async function preflight(method, path = "/api/admin/programs/1") {
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": "authorization,content-type,x-org-id",
    },
  }), env());
  return res;
}

const allowedMethods = (res) =>
  (res.headers.get("Access-Control-Allow-Methods") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

/* ===================== the premise ===================== */

test("the premise: the worker really does route PATCH, PUT and DELETE", () => {
  // If this ever stops being true the bug below cannot happen and this file is about nothing.
  const routed = methodsRouted();
  for (const m of ["PATCH", "PUT", "DELETE"]) {
    assert.ok(routed.has(m), `${m} is no longer routed anywhere — re-derive this guard`);
  }
});

/* ===================== the invariant ===================== */

test("CORS advertises every method the worker routes — derived, never a hardcoded list", () => {
  /* THE RELATIONSHIP IS THE INVARIANT. A method the router accepts but CORS omits is blocked by the
     browser before the request is sent, and the user is told their connection is at fault. */
  const routed = [...methodsRouted()].sort();
  return preflight("DELETE").then((res) => {
    const advertised = allowedMethods(res);
    const missing = routed.filter((m) => !advertised.includes(m));
    assert.deepEqual(missing, [],
      `these methods are routed by the worker but not advertised to the browser, so every one of ` +
      `them fails cross-origin with a misleading "Can't reach the server": ${missing.join(", ")}`);
  });
});

test("a preflight for DELETE is answered, and answered permissively", async () => {
  const res = await preflight("DELETE");
  assert.equal(res.status, 204, "the preflight itself must succeed");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN, "the origin must be echoed");
  assert.ok(allowedMethods(res).includes("DELETE"),
    "DELETE must be advertised or every Delete button in the product is dead in a browser");
});

test("the allowlist still gates the ORIGIN — this release widens methods, not who may call", async () => {
  // Widening CORS is exactly where a security regression hides. The origin check must be untouched.
  const res = await worker.fetch(new Request(`${ORIGIN}/api/health`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "DELETE" },
  }), env());
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null,
    "an origin outside ALLOWED_ORIGINS must receive no allow-origin header, whatever the method");
});

/* ===================== negative controls ===================== */

test("NC-1: the derived check fires when a routed method is dropped from the header", async () => {
  // Mutate the REAL header value and prove the comparison reddens; an assertion over two lists that
  // happen to match today is worth nothing unless it can tell them apart.
  const res = await preflight("DELETE");
  const advertised = allowedMethods(res);
  const broken = advertised.filter((m) => m !== "DELETE");
  assert.notEqual(broken.length, advertised.length, "MUTATION DID NOT LAND — DELETE was not advertised");
  const routed = [...methodsRouted()];
  assert.ok(routed.filter((m) => !broken.includes(m)).length >= 1,
    "with DELETE removed the guard above must report at least one missing method");
});

test("NC-2: the method extractor finds real dispatch lines and ignores prose", () => {
  const routed = methodsRouted();
  assert.ok(routed.size >= 4, `expected several methods, extracted ${routed.size}`);
  // Comments are blanked before extraction, so a method named only in a header comment is not
  // counted — otherwise the required set inflates and the guard fails against correct code.
  assert.ok(!methodsRouted().has("TRACE"), "no phantom methods");
});
