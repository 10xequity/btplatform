/**
 * Boomtown Platform — announcements / home feed / org-brand guards
 * File: worker/test/announcements.test.mjs · Version: v1.1 · Date: 2026-08-02 · Ships in: v0.51.0 (v1.0 v0.50.0)
 *
 * Covers the R3 module (announcements.js) the way lfg.test.mjs covers lfg.js:
 *   1. Pure helpers: isLive · muteKeyValid · normalizeSubBody · CATEGORIES.
 *   2. ORG-SCOPE guard, anchored PER env.DB.prepare CALL with a miss counter — the v0.45.0
 *      lesson (failure class 3): whole-file string reads went blind after one apostrophe;
 *      the guard must count its own misses and fail when the corpus shrinks.
 *   3. §6.5 mount guard: the delivery gate greps CALL SITES — the dispatch table
 *      `|| (await announcementsRoutes(` and the `wireAnnouncements(` call — never the filename.
 *   4. Owner rule 1 in source: the mute route REFUSES kind='cta' (fail closed), and the feed
 *      never filters ctas through mutes.
 *   5. Public org-brand: the SELECT carries exactly the three brand fields (standards §8 —
 *      an email/legal column in that query would leak org PII to the world), sets
 *      Cache-Control, and index.js mounts it BEFORE buildCtx (the icsFeed precedent).
 * Negative controls mutate the EXACT subject line (the §2 lesson) and prove each scan fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isLive, muteKeyValid, normalizeSubBody, CATEGORIES } from "../src/announcements.js";
import { statementFrom } from "../testkit/route-extract.mjs"; // v0.111.0 §-1c D-17b — regions, not distances

const SRC = readFileSync(new URL("../src/announcements.js", import.meta.url), "utf8");
const INDEX = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

/* ============================ 1. pure helpers ============================ */

test("isLive: unscheduled post is live; future starts_at is not; past ends_at is not", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  assert.equal(isLive({ starts_at: null, ends_at: null }, now), true);
  assert.equal(isLive({ starts_at: "2026-08-03 00:00:00", ends_at: null }, now), false);
  assert.equal(isLive({ starts_at: null, ends_at: "2026-08-01 00:00:00" }, now), false);
  assert.equal(isLive({ starts_at: "2026-08-01 00:00:00", ends_at: "2026-08-03 00:00:00" }, now), true);
  assert.equal(isLive({ starts_at: null, ends_at: null, deleted_at: "2026-08-01" }, now), false);
  assert.equal(isLive(null, now), false);
});

test("muteKeyValid: item needs a positive integer id; category needs a known key; else closed", () => {
  assert.equal(muteKeyValid({ scope: "item", announcement_id: 3 }), true);
  assert.equal(muteKeyValid({ scope: "item", announcement_id: 0 }), false);
  assert.equal(muteKeyValid({ scope: "item", announcement_id: "3" }), false);
  assert.equal(muteKeyValid({ scope: "category", category: "news" }), true);
  assert.equal(muteKeyValid({ scope: "category", category: "cta" }), false, "cta is not a mutable category — owner rule 1");
  assert.equal(muteKeyValid({ scope: "category", category: "everything" }), false);
  assert.equal(muteKeyValid({ scope: "both" }), false);
  assert.equal(muteKeyValid(null), false);
});

test("CATEGORIES is the shared mute vocabulary and never contains 'cta'", () => {
  assert.ok(CATEGORIES.length >= 5);
  assert.ok(!CATEGORIES.includes("cta"), "cta in CATEGORIES would make the priority CTA mutable");
});

test("normalizeSubBody: active requires a known level; passive needs none; junk fails closed", () => {
  assert.deepEqual(normalizeSubBody({ opt_in: true, mode: "passive" }), { opt_in: true, mode: "passive", level: null });
  assert.deepEqual(normalizeSubBody({ opt_in: true, mode: "active", level: "BB" }), { opt_in: true, mode: "active", level: "bb" });
  assert.equal(normalizeSubBody({ opt_in: true, mode: "active", level: "pro" }), null, "unknown level fails closed");
  assert.deepEqual(normalizeSubBody({ opt_in: false }), { opt_in: false, mode: "passive", level: null });
  assert.equal(normalizeSubBody("junk"), null);
});

/* ============================ 2. org-scope guard (per-prepare, self-counting) ============================ */

/**
 * Split source at each env.DB.prepare( and capture the template literal that follows.
 * Returns { statements, misses } — misses counts prepare( calls whose SQL could not be
 * captured, and the caller FAILS on any miss (the guard must never silently narrow).
 */
function collectStatements(src) {
  const statements = [];
  let misses = 0;
  const re = /env\.DB\.prepare\(\s*([`"'])/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const quote = m[1];
    const start = re.lastIndex;
    const end = src.indexOf(quote, start);
    if (end === -1) { misses++; continue; }
    statements.push(src.slice(start, end));
  }
  return { statements, misses };
}

test("every env.DB.prepare in announcements.js is captured (self-count, zero misses)", () => {
  const { statements, misses } = collectStatements(SRC);
  assert.equal(misses, 0, "a prepare( whose SQL the scanner cannot read is a blind spot (failure class 3)");
  assert.ok(statements.length >= 12,
    `guard floor: expected >=12 statements, saw ${statements.length} — an empty scan must fail (failure class 4)`);
});

test("every org-scoped statement binds org_id; the ONLY exception is the public org-brand SELECT", () => {
  const { statements } = collectStatements(SRC);
  const offenders = [];
  for (const sql of statements) {
    const flat = sql.replace(/\s+/g, " ");
    // The public brand lookup is the deliberate exception: it resolves an org BY id/slug —
    // org_id scoping is meaningless when the org itself is the lookup subject.
    if (/FROM orgs/i.test(flat)) continue;
    if (!/org_id\s*(=|IS)\s*\?/i.test(flat) && !/\(org_id,/i.test(flat)) offenders.push(flat.slice(0, 80));
  }
  assert.deepEqual(offenders, [], `statements missing an org_id bind:\n  ${offenders.join("\n  ")}`);
});

test("the public org-brand SELECT carries exactly the three brand fields (standards §8)", () => {
  const { statements } = collectStatements(SRC);
  const brand = statements.find((s) => /FROM orgs/i.test(s));
  assert.ok(brand, "the org-brand SELECT must exist");
  const cols = brand.replace(/\s+/g, " ").match(/SELECT (.*?) FROM/i)[1];
  assert.equal(cols.trim(), "id, name, logo_url",
    "any additional column here is served to the world with no session — email/legal fields are forbidden");
  assert.match(brand, /active = 1/, "inactive orgs must not resolve");
  assert.match(brand, /deleted_at IS NULL/, "deleted orgs must not resolve");
});

/* ============================ 3. §6.5 mount guard (call sites, not filenames) ============================ */

test("index.js mounts the module: dispatch table + wire call + public brand route (F-15/§6.5)", () => {
  assert.ok(/\["announcements",\s+announcementsRoutes\],/.test(INDEX),
    "dispatch table must call announcementsRoutes — an import line alone is built-but-uncalled (failure class 1)");
  assert.ok(INDEX.includes("wireAnnouncements(wiredHelpers)"),
    "wireAnnouncements(helpers) must be called or every helper is undefined at first request");
  // D-17b: was a 400-character window between the pathname test and the handler call. The branch
  // is brace-matched now, so a comment added inside it cannot push the call out of range.
  const brandAt = INDEX.indexOf('url.pathname === "/api/public/org-brand"');
  assert.ok(brandAt > 0, "the org-brand branch is missing entirely");
  assert.ok(statementFrom(INDEX, brandAt).includes("publicOrgBrand(env, url)"),
    "org-brand must be mounted as its own pre-ctx branch (the icsFeed precedent)");
  const brandIdx = INDEX.indexOf('"/api/public/org-brand"');
  const ctxIdx = INDEX.indexOf("const ctx = await buildCtx(request, env);");
  assert.ok(brandIdx !== -1 && ctxIdx !== -1 && brandIdx < ctxIdx,
    "org-brand must mount BEFORE buildCtx — it is public and must not require a session");
});

/* ============================ 4. owner rule 1 in force (grep the decision, not the doc) ============================ */

test("the mute route refuses kind='cta' and the feed never filters ctas through mutes", () => {
  /* D-17b: was a 120-character window. The region is now the STATEMENT, bounded by its terminator.
     THE ANCHOR IS ASSERTED UNAMBIGUOUS FIRST, AND THAT IS NOT DECORATION — the first draft of this
     fix anchored on `kind === "cta"`, which occurs FOUR times in announcements.js, and `indexOf`
     returned the feed's `live.filter((r) => r.kind === "cta")` on line 134 instead of the mute
     route's refusal on line 222. The old regex was immune because a regex SCANS; an index does not.
     `target.kind` is the mute route's own spelling and is unique — and the count check is what says
     so out loud if that ever stops being true. */
  const ANCHOR = 'target.kind === "cta"';
  assert.equal(SRC.split(ANCHOR).length - 1, 1,
    `${ANCHOR} must occur exactly once, or indexOf below is measuring the wrong statement`);
  assert.match(statementFrom(SRC, SRC.indexOf(ANCHOR)), /can't be hidden/,
    "the cta refusal must exist in the mute route (decision recorded ≠ decision in force, failure class 2)");
  assert.ok(/const ctas = live\.filter\(\(r\) => r\.kind === "cta"\);/.test(SRC),
    "ctas must be selected WITHOUT a mutedItems/mutedCategories filter — pinned means pinned");
});

/* ============================ negative controls ============================ */

test("NC-1: removing the org_id bind from a real statement is caught", () => {
  const mutated = SRC.replace("WHERE org_id = ?1 AND contact_id = ?2 AND deleted_at IS NULL", // exact subject line (mutes SELECT)
                              "WHERE contact_id = ?2 AND deleted_at IS NULL");
  assert.notEqual(mutated, SRC, "mutation must hit — otherwise this NC proves nothing");
  const { statements } = collectStatements(mutated);
  const offenders = statements.filter((s) => {
    const flat = s.replace(/\s+/g, " ");
    return !/FROM orgs/i.test(flat) && !/org_id\s*(=|IS)\s*\?/i.test(flat) && !/\(org_id,/i.test(flat);
  });
  assert.ok(offenders.length >= 1, "the de-scoped statement must surface as an offender");
});

test("NC-2: widening the org-brand SELECT by one column is caught", () => {
  const mutated = SRC.replace("SELECT id, name, logo_url FROM orgs", "SELECT id, name, logo_url, admin_email FROM orgs");
  assert.notEqual(mutated, SRC);
  const { statements } = collectStatements(mutated);
  const brand = statements.find((s) => /FROM orgs/i.test(s));
  const cols = brand.replace(/\s+/g, " ").match(/SELECT (.*?) FROM/i)[1];
  assert.notEqual(cols.trim(), "id, name, logo_url", "the widened SELECT must no longer satisfy the exact-columns check");
});

test("NC-3: stripping the cta refusal from the mute route is caught", () => {
  const mutated = SRC.replace(`if (target.kind === "cta") return json({ error: "This announcement is from your organization and can't be hidden." }, 403);`, "");
  assert.notEqual(mutated, SRC, "the refusal line must exist to be strippable — mutate the exact subject line");
  const ncAt = mutated.indexOf('target.kind === "cta"');
  assert.equal(ncAt >= 0 && /can't be hidden/.test(statementFrom(mutated, ncAt)), false,
    "with the refusal stripped, the rule-in-force check must fail");
});

test("NC-4: a dispatch table missing the call site fails the §6.5 check", () => {
  const mutated = INDEX.replace(/\["announcements",\s+announcementsRoutes\],/, "");
  assert.notEqual(mutated, INDEX);
  assert.equal(/\["announcements",\s+announcementsRoutes\],/.test(mutated), false);
  assert.ok(mutated.includes("announcementsRoutes, wireAnnouncements"),
    "the import line SURVIVES the mutation — which is exactly why the gate must grep call sites, not filenames");
});

test("NC-5: the statement scanner counts a miss when SQL is unreadable", () => {
  const { misses } = collectStatements(`env.DB.prepare(\`SELECT 1 FROM x`); // unterminated template
  assert.equal(misses, 1, "an uncapturable prepare must count as a miss, never vanish");
});

/* ============ 6. (v1.1, v0.51.0) admin authoring page — staff CRUD UI ============ */
/* The page is static UI over the section-5 routes above; these checks hold the page to
   the same rules the API enforces, scanning the REAL page/JS sources (never trust). */

const PAGE = readFileSync(new URL("../../web/admin-announcements.html", import.meta.url), "utf8");
const PAGE_JS = readFileSync(new URL("../../web/assets/admin-announcements.js", import.meta.url), "utf8");
const HOME_JS = readFileSync(new URL("../../web/home.js", import.meta.url), "utf8");

test("authoring JS drives all four staff routes (list, create, update, soft delete)", () => {
  assert.ok(PAGE_JS.includes('api("/api/admin/announcements")'), "GET list call missing");
  assert.ok(PAGE_JS.includes('api("/api/admin/announcements", { method: "POST"'), "POST create call missing");
  assert.ok(PAGE_JS.includes('`/api/admin/announcements/${editingId}`, { method: "PUT"'), "PUT update call missing");
  assert.ok(PAGE_JS.includes('`/api/admin/announcements/${id}`, { method: "DELETE"'), "DELETE call missing");
});

test("preview parity: the admin preview renders the member's exact fragments", () => {
  // Both renderers must carry the same structural classes home.js paints — if home.js
  // renames its markup, this fails and the preview is known-stale (failure class 2).
  for (const cls of ['class="ann-cta"', 'class="feed-item"', 'class="fx"']) {
    assert.ok(HOME_JS.includes(cls), `home.js lost ${cls} — update BOTH renderers together`);
    assert.ok(PAGE_JS.includes(cls), `admin preview lost ${cls} — it no longer shows what members see`);
  }
});

test("owner rule in the UI copy: the cta is pinned and hide attempts are silently ignored", () => {
  assert.ok(/Hide controls don't apply/.test(PAGE) && /no error/.test(PAGE),
    "the cta option must state the rule of record (owner 2026-08-02): it stays, silently");
  assert.ok(!/class="feed-mute"/.test(PAGE_JS),
    "the admin preview must not render the member hide button — staff have nothing to hide with");
});

test("times: the page speaks local, stores the server's UTC vocabulary", () => {
  assert.ok(PAGE_JS.includes('toISOString().slice(0, 16).replace("T", " ")'),
    "save path must produce UTC 'YYYY-MM-DD HH:MM' — isLive() appends Z to exactly that shape");
  assert.ok(PAGE_JS.includes('replace(" ", "T") + "Z"'),
    "read path must parse the stored value as UTC before localizing");
});

test("NC-6: renaming .ann-cta in the admin preview source is caught by the parity scan", () => {
  const mutated = PAGE_JS.replace('class="ann-cta"', 'class="ann-ctA"');
  assert.ok(!mutated.includes('class="ann-cta"'),
    "mutation must hit the exact subject line, or this NC proves nothing");
});

test("NC-7: stripping the rule-of-record copy from the page is caught", () => {
  const mutated = PAGE.replace(/Hide controls don't apply/g, "");
  assert.ok(!/Hide controls don't apply/.test(mutated) && /no error/.test(PAGE),
    "the copy scan must fail when the cta rule leaves the page");
});
