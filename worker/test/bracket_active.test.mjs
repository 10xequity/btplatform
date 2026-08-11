/**
 * Boomtown Platform — §-1p WF-2 (§-0 B24): the bracket board shows only ACTIVE brackets
 * File: worker/test/bracket_active.test.mjs · Version: v1.0 · Date: 2026-08-11 · Ships in: v0.134.0
 *
 * The owner's 2026-08-11 item 3, measured with live evidence (iteration 60): production carried
 * ELEVEN live matchless `brackets` rows rendering as empty trees — event 90006 held ten, five
 * stranded A/BB pairs from failed generation attempts. The mechanism is the code's, not a guess:
 * generateBracketFor INSERTs bracket rows BEFORE writing matches with no transaction, and its
 * replace-cleanup fires only when live MATCHES exist — so an attempt that dies between the two
 * strands its rows, and every later attempt skips the cleanup because the match count is still 0.
 * (The sandbox wipe was exonerated: DELETE FROM brackets IS in WIPE_SQL.)
 *
 * THE RULES, EACH PINNED:
 *  · loadBrackets returns only trees that have live matches. This can never hide a real bracket:
 *    planFor validates every tree BEFORE anything is written and buildTree refuses n < 2, so a
 *    legitimate generation always writes matches for every bracket row it inserts.
 *  · Generation SELF-HEALS on its write path: live-but-matchless bracket rows for the event are
 *    soft-deleted before new rows are inserted (the replace path's own idiom). The 11 production
 *    strands heal on the owner's next generate — no production write from the loop.
 *  · A REFUSED generation (409, bracket exists, no replace) stays WRITE-FREE — strands linger in
 *    the table but the filter keeps them off the board.
 *  · THE WAY IN SURVIVES: when the filter empties the list, the page's #bEmpty state shows and
 *    #bGen stands — a filter that hides everything must not delete the last way out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";
import { createD1 } from "../testkit/d1-memory.mjs";

const SCHEMA = readFileSync(new URL("../testkit/journey-schema.sql", import.meta.url), "utf8");
const ORIGIN = "https://boomtown.test";

function boot(teamCount = 8) {
  const DB = createD1(SCHEMA);
  DB.exec("INSERT INTO orgs (id, name, slug, active) VALUES (1,'Boomtown','boomtown',1)");
  DB.exec("INSERT INTO events (id, org_id, type, name, status, court_count) VALUES (1,1,'tournament','Test Cup','published',4)");
  for (let i = 1; i <= teamCount; i++) {
    DB.exec(`INSERT INTO teams (id, org_id, event_id, name, seed) VALUES (${i},1,1,'Team ${i}',${i})`);
  }
  return { DB, APP_URL: ORIGIN, SITE_ORIGIN: ORIGIN, API_ORIGIN: ORIGIN, ALLOWED_ORIGINS: ORIGIN };
}

async function call(env, method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-Org-Id": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const t = await res.text();
  let data = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = { _raw: t.slice(0, 200) }; }
  return { status: res.status, data };
}

async function staff(env, email = "s@bt.test") {
  const asked = await call(env, "POST", "/api/auth/request-link", { body: { email } });
  const tok = String(asked.data.dev_link).split("token=")[1];
  const v = await call(env, "POST", "/api/auth/verify", { body: { token: tok } });
  return v.data.token;
}

const liveBrackets = (env) =>
  env.DB.query("SELECT id, name, deleted_at FROM brackets WHERE event_id=1 AND deleted_at IS NULL ORDER BY id");
const liveMatches = (env, bracketId) =>
  env.DB.query("SELECT id FROM matches WHERE bracket_id=?1 AND deleted_at IS NULL", bracketId).length;

/** A stranded generation attempt: a live bracket row that never got its matches. */
function plantStrand(env, name = "STRAND") {
  env.DB.exec(`INSERT INTO brackets (org_id, event_id, name, split_rule, config_json) VALUES (1,1,'${name}','all','{}')`);
  const row = env.DB.one(`SELECT id FROM brackets WHERE event_id=1 AND name='${name}' ORDER BY id DESC`);
  assert.equal(liveMatches(env, row.id), 0, "the planted strand somehow has matches — the fixture cannot exhibit the defect");
  return row.id;
}

/* ==================== the list shows only ACTIVE brackets ==================== */

test("a matchless bracket row does not appear on the board; a real one does — same predicate both ways", async () => {
  const env = boot();
  const token = await staff(env);
  const gen = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: {} });
  assert.equal(gen.status, 200, JSON.stringify(gen.data).slice(0, 200));
  plantStrand(env);
  assert.equal(liveBrackets(env).length, 2, "fixture: one real bracket and one strand must coexist in the table");

  const list = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.equal(list.status, 200);
  const names = (list.data.brackets || []).map((b) => b.name);
  assert.ok(!names.includes("STRAND"), "a matchless bracket row rendered as a tree — the exact defect the owner reported");
  assert.equal(names.length, 1, `expected exactly the real bracket, saw: ${names.join(", ") || "(none)"}`);
  assert.ok((list.data.brackets[0].rounds || []).length > 0, "the surviving tree lost its rounds — the filter broke the payload");

  // NEGATIVE CONTROL — mutate the real input: take the REAL bracket's matches away and it must
  // vanish through the same predicate the strand did.
  const realId = env.DB.one("SELECT id FROM brackets WHERE event_id=1 AND name!='STRAND' AND deleted_at IS NULL").id;
  env.DB.exec(`UPDATE matches SET deleted_at=datetime('now') WHERE bracket_id=${realId}`);
  assert.equal(liveMatches(env, realId), 0, "the mutation did not land");
  const after = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.equal((after.data.brackets || []).length, 0,
    "a bracket with no live matches survived the filter — the filter is not reading live matches");
  env.DB.close();
});

/* ==================== generation self-heals its own debris ==================== */

test("generating over strands leaves exactly ONE live bracket set — the strands are soft-deleted, not orphaned", async () => {
  const env = boot();
  const token = await staff(env);

  // Manufacture production's exact shape: bracket rows live, matches gone (the failed-attempt
  // state — rows INSERTed, matches never written). Two strands, like an A/BB pair.
  plantStrand(env, "STRAND-A");
  plantStrand(env, "STRAND-BB");
  assert.equal(liveBrackets(env).length, 2, "fixture: the strand pair must be live before generating");

  const gen = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: {} });
  assert.equal(gen.status, 200, JSON.stringify(gen.data).slice(0, 200));

  const live = liveBrackets(env);
  assert.equal(live.length, 1,
    `after generating, expected exactly the new bracket live — the strands must self-heal (saw ${live.map((b) => b.name).join(", ")})`);
  assert.ok(liveMatches(env, live[0].id) > 0, "the surviving bracket has no matches — the wrong rows were kept");

  // Soft-deleted, never hard-deleted: the strands are still IN the table with deleted_at set.
  const healed = env.DB.query(
    "SELECT name, deleted_at FROM brackets WHERE event_id=1 AND name LIKE 'STRAND%' ORDER BY id");
  assert.equal(healed.length, 2, "the strands were hard-deleted — this repo soft-deletes, always");
  assert.ok(healed.every((r) => r.deleted_at), "a strand survived as a live row");
  env.DB.close();
});

test("a REFUSED generation (bracket exists, no replace) stays write-free — the strand lingers in the table but off the board", async () => {
  const env = boot();
  const token = await staff(env);
  await call(env, "POST", "/api/admin/events/1/brackets", { token, body: {} });
  const strandId = plantStrand(env);

  const refused = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: {} });
  assert.equal(refused.status, 409, "a second generate without replace must refuse, exactly as before");
  assert.ok(env.DB.one(`SELECT deleted_at FROM brackets WHERE id=${strandId}`).deleted_at === null,
    "a 409 mutated state — refusals are write-free; the heal belongs to the write path only");

  const list = await call(env, "GET", "/api/admin/events/1/brackets", { token });
  assert.ok(!(list.data.brackets || []).some((b) => b.name === "STRAND"),
    "the lingering strand is visible — the filter must keep it off the board until a real write heals it");

  const replaced = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { replace: true } });
  assert.equal(replaced.status, 200);
  assert.equal(liveBrackets(env).length, 1, "replace must end with exactly one live bracket set, strand included in the sweep");
  env.DB.close();
});

test("REGRESSION PIN — plain generate → replace still ends with one live set and live matches (the pre-WF-2 contract)", async () => {
  const env = boot();
  const token = await staff(env);
  const g1 = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: {} });
  assert.equal(g1.status, 200);
  const g2 = await call(env, "POST", "/api/admin/events/1/brackets", { token, body: { replace: true } });
  assert.equal(g2.status, 200);
  const live = liveBrackets(env);
  assert.equal(live.length, 1);
  assert.ok(liveMatches(env, live[0].id) > 0);
  env.DB.close();
});

/* ==================== the way in survives the filter ==================== */

test("when the filter empties the board, the page's empty state + generate button are the way back in", () => {
  const html = readFileSync(new URL("../../web/admin-brackets.html", import.meta.url), "utf8");
  assert.match(html, /id="bGen"/, "the Generate button is gone — the filter would have deleted the last way out");
  assert.match(html, /id="bEmpty"/, "the empty state is gone — an empty filtered board would read as a hung page");
  const js = readFileSync(new URL("../../web/assets/admin-brackets.js", import.meta.url), "utf8");
  assert.match(js, /\$\("bEmpty"\)\.hidden = list\.length > 0/,
    "render() no longer toggles the empty state on the list length");
  // NEGATIVE CONTROL — the detectors must be able to fail: strip the ids from a COPY and re-run them.
  const strippedHtml = html.replace(/id="bGen"/, "").replace(/id="bEmpty"/, "");
  assert.notEqual(strippedHtml, html, "the strip found nothing — the controls above are not detecting anything");
  assert.doesNotMatch(strippedHtml, /id="bGen"/);
  assert.doesNotMatch(strippedHtml, /id="bEmpty"/);
});
