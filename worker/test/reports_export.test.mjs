/* Boomtown Platform — Revenue CSV export tests (req #12/#18)
   File: worker/test/reports_export.test.mjs · Version: v1.1 · Date: 2026-07-31 · Ships in: v0.43.0
   csvCell RFC 4180 behaviour, the header CONTRACT the Looker template maps by name,
   month derivation, and a negative control proving the header guard can fail.
   v1.1 (v0.43.0): the cross-org feed — 12-column contract, builder behaviour, and the
   CROSS-ORG READ confinement guard (role-filtered, bound user_id, soft-delete + active
   honoured, no client org input) with negative controls proving the guard can fail. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { csvCell, buildRevenueCsv, REVENUE_CSV_HEADERS, buildCrossOrgRevenueCsv, CROSS_ORG_REVENUE_CSV_HEADERS } from "../src/reports.js";
import { blankComments, functionBodyAfter } from "../testkit/route-extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const reportsSrc = readFileSync(join(here, "../src/reports.js"), "utf8");

/* ---------------- csvCell (RFC 4180) ---------------- */

test("plain values pass through unquoted", () => {
  assert.equal(csvCell("REVCO 4s"), "REVCO 4s");
  assert.equal(csvCell(1250), "1250");
});

test("null and undefined become empty, never the string 'null'", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("commas, quotes and newlines trigger quoting; quotes double", () => {
  assert.equal(csvCell('Say "go", now'), '"Say ""go"", now"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
});

/* ---------------- header contract ---------------- */

test("REVENUE_CSV_HEADERS is the exact 10-column Looker contract", () => {
  assert.deepEqual(REVENUE_CSV_HEADERS, [
    "event_id", "event", "type", "program", "starts_at", "month",
    "registrations", "card_cents", "cash_cents", "total_cents",
  ]);
});

test("buildRevenueCsv emits the header row first, CRLF-joined", () => {
  const out = buildRevenueCsv([]);
  assert.equal(out, REVENUE_CSV_HEADERS.join(","));
  const two = buildRevenueCsv([{ event_id: 1, event: "A", starts_at: "2026-07-04T09:00" }]);
  assert.ok(two.startsWith(REVENUE_CSV_HEADERS.join(",") + "\r\n"));
});

test("month derives from starts_at; missing dates become 'undated'", () => {
  const out = buildRevenueCsv([
    { event_id: 1, event: "A", starts_at: "2026-07-04T09:00", registrations: 8, card_cents: 100, cash_cents: 0, total_cents: 100 },
    { event_id: 2, event: "B", starts_at: null, registrations: 0, card_cents: 0, cash_cents: 0, total_cents: 0 },
  ]).split("\r\n");
  assert.equal(out[1].split(",")[5], "2026-07");
  assert.equal(out[2].split(",")[5], "undated");
});

test("an event name holding a comma stays one cell", () => {
  const line = buildRevenueCsv([{ event_id: 3, event: "Easter, REVCO", starts_at: "2026-04-01" }]).split("\r\n")[1];
  assert.ok(line.includes('"Easter, REVCO"'));
});

/* ---------------- route + audit present at the call site (§6.5 spirit) ---------------- */

test("reports.js dispatches /api/admin/reports/revenue.csv and audits the export", () => {
  assert.match(reportsSrc, /"\/api\/admin\/reports\/revenue\.csv" && m === "GET"/);
  assert.match(reportsSrc, /reports\.revenue\.exported/);
});

test("NEGATIVE CONTROL: the header-contract guard fails when a column is renamed", () => {
  const mutated = [...REVENUE_CSV_HEADERS];
  mutated[9] = "total"; // the rename a future session would plausibly make
  assert.notDeepEqual(mutated, REVENUE_CSV_HEADERS.map(h => h === "total_cents" ? "total" : h) === mutated ? [] : REVENUE_CSV_HEADERS);
  assert.throws(() => assert.deepEqual(mutated, REVENUE_CSV_HEADERS));
});

/* ---------------- cross-org feed (v1.5) — contract + builder ---------------- */

test("CROSS_ORG_REVENUE_CSV_HEADERS is the exact 12-column contract: org_id + org, then the single-org 10", () => {
  assert.deepEqual(CROSS_ORG_REVENUE_CSV_HEADERS, ["org_id", "org", ...REVENUE_CSV_HEADERS]);
});

test("the single-org 10-column contract is untouched by v1.5", () => {
  assert.equal(REVENUE_CSV_HEADERS.length, 10);
  assert.equal(REVENUE_CSV_HEADERS[0], "event_id");
});

test("buildCrossOrgRevenueCsv emits the 12-column header row first, CRLF-joined", () => {
  assert.equal(buildCrossOrgRevenueCsv([]), CROSS_ORG_REVENUE_CSV_HEADERS.join(","));
  const out = buildCrossOrgRevenueCsv([{ org_id: 2, org: "REVCO", event_id: 9, event: "A", starts_at: "2026-07-04T09:00" }]);
  assert.ok(out.startsWith(CROSS_ORG_REVENUE_CSV_HEADERS.join(",") + "\r\n"));
  assert.ok(out.split("\r\n")[1].startsWith("2,REVCO,9,"));
});

test("an org name holding a comma stays one cell and month still derives", () => {
  const line = buildCrossOrgRevenueCsv([
    { org_id: 3, org: "Boom, Town LLC", event_id: 4, event: "B", starts_at: "2026-04-01T10:00" },
  ]).split("\r\n")[1];
  assert.ok(line.includes('"Boom, Town LLC"'));
  assert.ok(line.includes("2026-04-01T10:00,2026-04"), "derived month must follow starts_at");
});

/* ---------------- cross-org confinement guard (failure-class 3 discipline) ----------------
   The cross-org read is a deliberate exception to per-org scoping. This guard pins its
   shape: exactly one marked block, org set derived from the caller's own roles with a
   BOUND user id, role-filtered to admin/staff, soft-deletes and org.active honoured, and
   no client-supplied org anywhere in the block. checkCrossOrgConfinement() is pure so the
   negative controls below can feed it mutated source and prove it says NO. */

export function checkCrossOrgConfinement(src) {
  const opens = src.split("CROSS-ORG READ").length - 1 - (src.split("END CROSS-ORG READ").length - 1);
  const blocks = src.match(/CROSS-ORG READ[\s\S]*?END CROSS-ORG READ/g) || [];
  if (opens !== 1 || blocks.length !== 1) return { ok: false, why: "expected exactly one marked CROSS-ORG READ block" };
  const b = blocks[0];
  if (!/JOIN user_org_roles/.test(b)) return { ok: false, why: "org set must derive from user_org_roles" };
  if (!/uor\.user_id = \?1/.test(b)) return { ok: false, why: "user_id must be a BOUND parameter" };
  if (!/\.bind\(ctx\.userId\)/.test(b)) return { ok: false, why: "the bound value must be ctx.userId" };
  if (!/role IN \('admin','staff'\)/.test(b)) return { ok: false, why: "role filter admin/staff missing — member role must not widen the set" };
  if (!/uor\.deleted_at IS NULL/.test(b)) return { ok: false, why: "soft-deleted roles must be excluded" };
  if (!/og\.active = 1 AND og\.deleted_at IS NULL/.test(b)) return { ok: false, why: "deactivated/deleted orgs must be excluded (switcher rule)" };
  if (/url\.|searchParams|X-Org-Id/i.test(b)) return { ok: false, why: "no client-supplied org input may be read in the block (F-11)" };
  return { ok: true };
}

test("reports.js cross-org block passes the confinement check", () => {
  const r = checkCrossOrgConfinement(reportsSrc);
  assert.equal(r.ok, true, r.why);
});

test("NEGATIVE CONTROL: stripping the role filter is caught", () => {
  const mutated = reportsSrc.replace("AND uor.role IN ('admin','staff') ", "");
  assert.equal(checkCrossOrgConfinement(mutated).ok, false);
});

test("NEGATIVE CONTROL: unbinding user_id is caught", () => {
  const mutated = reportsSrc.replace("uor.user_id = ?1", "uor.user_id = uor.user_id");
  assert.equal(checkCrossOrgConfinement(mutated).ok, false);
});

test("NEGATIVE CONTROL: letting deactivated orgs through is caught", () => {
  const mutated = reportsSrc.replace("og.active = 1 AND og.deleted_at IS NULL", "1 = 1");
  assert.equal(checkCrossOrgConfinement(mutated).ok, false);
});

test("NEGATIVE CONTROL: reading a client org inside the block is caught", () => {
  const mutated = reportsSrc.replace("const rows = (await env.DB.prepare(",
    "const clientOrg = url.searchParams.get('org');\n  const rows = (await env.DB.prepare(");
  assert.equal(checkCrossOrgConfinement(mutated).ok, false);
});

test("delivery gate greps the call site, not the name (§6.5): revenue-all route dispatches", () => {
  assert.ok(/if \(p === "\/api\/admin\/reports\/revenue-all\.csv" && m === "GET"\) return revenueAllCsv\(env, ctx\);/.test(reportsSrc));
});

/* ──────────── WF-5 H-3: the all-events financial overview (v0.141.0) ────────────
   The owner's item 6: "Registrations should have all the events and registrations listed for easy
   access and financial review." The unit was queued as "add a JSON sibling of the revenue SELECT —
   one query, two renderers." RE-MEASURING FOUND THAT ALREADY BUILT AND NEVER PINNED: the SELECT
   lives in sales() behind GET /api/admin/reports/sales, and revenueCsv calls that function and
   renders its JSON as CSV (its own comment says "Same source of truth as sales()"). So H-3 added
   no route and no query. It pins the property instead — an unpinned true thing is one refactor
   away from being a false one — and spends the unit on the screen the owner asked for. */

test("H-3: the revenue CSV renders the SALES payload — one query, two renderers", () => {
  const csvFn = functionBodyAfter(reportsSrc, "async function revenueCsv(");
  assert.ok(csvFn, "revenueCsv is gone or is no longer a plain function declaration");
  assert.match(csvFn, /await sales\(env, ctx\)/,
    "revenueCsv stopped calling sales() — the CSV and the screen would answer 'what did this event take' from two different queries");
  assert.equal(/FROM events/.test(csvFn), false,
    "revenueCsv grew its own SELECT — the second spelling this pin exists to prevent");
});

test("H-3 NEGATIVE CONTROL: a re-inlined SELECT inside revenueCsv is caught", () => {
  const csvFn = functionBodyAfter(reportsSrc, "async function revenueCsv(");
  const mutated = csvFn.replace(/await sales\(env, ctx\)/, "await env.DB.prepare('SELECT 1 FROM events').all()");
  assert.notEqual(mutated, csvFn, "the mutation found no sales() call to replace");
  assert.equal(/await sales\(env, ctx\)/.test(mutated), false, "the call detector cannot fail");
  assert.ok(/FROM events/.test(mutated), "the second-SELECT detector cannot fail");
});

test("H-3: sales() still produces every column the overview renders", () => {
  const salesFn = functionBodyAfter(reportsSrc, "async function sales(");
  assert.ok(salesFn, "sales() is gone or is no longer a plain function declaration");
  // Read the aliases the shipped SELECT actually produces, rather than listing them from a design.
  for (const col of ["event_id", "AS event", "e.type", "e.starts_at", "AS program", "card_cents", "cash_cents", "AS registrations"]) {
    assert.ok(salesFn.includes(col), `sales() no longer produces ${col}, which the overview depends on`);
  }
  assert.match(salesFn, /total_cents: \(r\.card_cents \|\| 0\) \+ \(r\.cash_cents \|\| 0\)/,
    "the total is no longer card + cash — the overview's Total would disagree with the CSV's");
});

test("H-3: the overview lives on the REGISTRATIONS surface, reads the existing route, and opens the hub", () => {
  const REG_JS = blankComments(readFileSync(join(here, "../../web/assets/admin-registrations.js"), "utf8"));
  assert.match(REG_JS, /\/api\/admin\/reports\/sales/,
    "the overview does not read the existing sales route — that would be a second source for one set of numbers");
  assert.match(REG_JS, /admin-manager\.html\?event=/,
    "the overview has no way into the event it lists — item 6 asks for easy ACCESS, not another report");
  assert.match(REG_JS, /BT_ADMIN\.money/,
    "money is formatted by a second implementation — BT_ADMIN.money is the one");
  // The per-event mode is what the hub embeds as its Registrations tab; it must survive untouched.
  assert.match(REG_JS, /fromUrl/, "the ?event= preselect the hub depends on is gone");
});
