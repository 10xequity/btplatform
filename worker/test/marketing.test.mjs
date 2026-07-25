// Boomtown Platform — marketing.js unit tests
// File: worker/test/marketing.test.mjs · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.16.0
import test from "node:test";
import assert from "node:assert/strict";
import { buildSegmentWhere, mergeVars, complianceFooter, dedupeRecipients } from "../src/marketing.js";

test("buildSegmentWhere: empty filter adds nothing", () => {
  const { where, binds } = buildSegmentWhere({});
  assert.equal(where, "");
  assert.deepEqual(binds, []);
});

test("buildSegmentWhere: tags use json_each with one placeholder per tag", () => {
  const { where, binds } = buildSegmentWhere({ tags: ["newsletter", "league-fall"] });
  assert.match(where, /json_each\(c\.tags_json\)/);
  assert.equal((where.match(/\?/g) || []).length, 2);
  assert.deepEqual(binds, ["newsletter", "league-fall"]);
});

test("buildSegmentWhere: played league binds the event type", () => {
  const { where, binds } = buildSegmentWhere({ played: "league" });
  assert.match(where, /e\.type = \?/);
  assert.deepEqual(binds, ["league"]);
});

test("buildSegmentWhere: played none uses NOT EXISTS with no binds", () => {
  const { where, binds } = buildSegmentWhere({ played: "none" });
  assert.match(where, /NOT EXISTS/);
  assert.deepEqual(binds, []);
});

test("buildSegmentWhere: since validates the date shape", () => {
  assert.deepEqual(buildSegmentWhere({ since: "not-a-date" }).binds, []);
  const ok = buildSegmentWhere({ since: "2026-01-01" });
  assert.match(ok.where, /c\.created_at >= \?/);
  assert.deepEqual(ok.binds, ["2026-01-01"]);
});

test("buildSegmentWhere: combined filters join with AND in order", () => {
  const { where, binds } = buildSegmentWhere({ tags: ["a"], played: "tournament", since: "2026-06-01" });
  assert.deepEqual(binds, ["a", "tournament", "2026-06-01"]);
  assert.ok(where.indexOf("json_each") < where.indexOf("e.type"));
  assert.ok(where.indexOf("e.type") < where.indexOf("created_at"));
});

test("mergeVars: substitutes first/full/email and escapes HTML", () => {
  const out = mergeVars("Hi {{first_name}} ({{full_name}}, {{email}})",
    { full_name: "Ana <b>Reyes", email: "ana@x.com" });
  assert.equal(out, "Hi Ana (Ana &lt;b&gt;Reyes, ana@x.com)");
});

test("mergeVars: missing name falls back to 'there'", () => {
  assert.equal(mergeVars("Hi {{first_name}}", { email: "a@b.c" }), "Hi there");
});

test("complianceFooter: contains org, address, and unsubscribe link", () => {
  const f = complianceFooter("Boomtown Volleyball", "123 Court St, Colorado Springs, CO", "https://x/api/unsubscribe?c=1&t=abc");
  assert.match(f, /Boomtown Volleyball/);
  assert.match(f, /123 Court St/);
  assert.match(f, /href="https:\/\/x\/api\/unsubscribe\?c=1&t=abc"/);
  assert.match(f, /Unsubscribe/);
});

test("dedupeRecipients: case-insensitive on email, keeps first, drops blanks", () => {
  const out = dedupeRecipients([
    { id: 1, email: "A@x.com" }, { id: 2, email: "a@X.com" }, { id: 3, email: "" }, { id: 4, email: "b@x.com" },
  ]);
  assert.deepEqual(out.map((r) => r.id), [1, 4]);
});

// Changelog: v1.0 (2026-07-24) — 10 tests over the exported pure helpers.
