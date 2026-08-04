/* Boomtown Platform — KOTC screens (a) and (c): the director's board and the public standings
   File: worker/test/kotc_board_screen.test.mjs · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.86.0

   Two pages shipped with the three routes in kotc_board.test.mjs. Routes and screens together, because
   a route with no screen is failure class 1 and the KOTC engine already paid for that once in v0.76.0.

   WHAT THIS FILE ASSERTS THAT NO ROUTE TEST CAN:

   1. KEYBOARD PARITY IS ONE MOVER, NOT TWO. HTML5 drag-and-drop cannot be driven from a keyboard, so
      the board ships a second path — Enter to pick up, arrows, Enter to drop. The failure mode is not
      "no keyboard support", which is visible; it is TWO IMPLEMENTATIONS that drift, so the keyboard
      quietly does something slightly different from the mouse. The guard is that both paths reach the
      same function, with a negative control that gives the keyboard its own copy and proves it fires.

   2. THE PAGE DOES NOT PATCH ITS OWN BOARD. Every move response IS the next board (`boardPayload`).
      A page that spliced its local array after a move would drift from the server the first time a
      move did something the page did not model — a swap, a bench, a short net — and the drift is
      invisible until a refresh disagrees with the screen. Same class of defect as kotc.html
      re-deriving `mode`, and asserted the same way: by refusing the shape.

   3. THE PUBLIC PAGE HAS NO ADMIN REACH AND NO NAME OF ITS OWN. It must not POST anywhere, and it must
      not abbreviate — the server sends "Ava S." and that is all it has. A page that trimmed names
      itself would be a page that had been sent full ones.

   4. EVERY ANIMATION NAME RESOLVES, and reduced-motion covers `animation` and not only `transition`.
      `animation: kb-land 180ms` is valid CSS that throws nothing, logs nothing and animates nothing;
      and a reduced-motion block naming only `transition` is a guarantee that is already false. Both
      lessons are v0.84.0/v0.85.0, applied on release one of these pages rather than ten later.

   WHAT IT CANNOT SEE, stated plainly: whether the board is usable one-handed at the side of a court,
   whether the drag feels right on a tablet, or whether the standings read from across a gym. Those need
   eyes. The guards prove the wiring, the tokens and the honesty — never the feel. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const BOARD_HTML = read("web/admin-kotc.html");
const BOARD_JS = read("web/assets/admin-kotc.js");
const LIVE_HTML = read("web/kotc-live.html");
const LIVE_JS = read("web/assets/kotc-live.js");

/* ─────────── pure verdicts, so every NC drives the same function the real check does ─────────── */

/**
 * The file with its PROSE removed, for any check that asks "does this page do X".
 *
 * Both of this guard's first two failures were its own comments: the line documenting "no enter
 * animation from scale(0)" tripped the scale(0) check, and "no roster, no score links" tripped the
 * roster check. v0.85.0 hit the identical thing on kotc.html — a comment explaining a rule setting off
 * the check for that rule — which makes it a shape rather than an accident.
 *
 * CHECK THE SET THAT SHIPS BEHAVIOUR. A comment ships bytes, not behaviour, and a guard that cannot
 * tell the difference punishes the explanation and rewards silence.
 */
const code = (src) => src
  .replace(/<!--[\s\S]*?-->/g, " ")     // HTML comments
  .replace(/\/\*[\s\S]*?\*\//g, " ")    // CSS and JS block comments
  .replace(/^\s*\/\/.*$/gm, " ");       // JS line comments

/** Animation names used, and the @keyframes that exist to satisfy them. */
const animsUsed = (src) => new Set([...src.matchAll(/animation:\s*([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const keyframes = (src) => new Set([...src.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const orphans = (src) => [...animsUsed(src)].filter((n) => !keyframes(src).has(n));

const reducedBlock = (src) => {
  const m = src.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s{4}\}/);
  return m ? m[1] : null;
};

/** How many distinct functions in the page script issue a move POST. More than one is the defect. */
const moveWriters = (src) =>
  [...src.matchAll(/api\(\s*`?\/api\/admin\/kotc\/\$\{[^}]*\}\/move/g)].length;

/** Does the script splice/patch its own seating instead of taking the server's board? */
const patchesLocally = (src) => {
  const bad = [];
  // A local model would have to move a player between arrays, or write a seat by hand.
  if (/\.players\.(push|splice)\(/.test(src)) bad.push("players.push/splice — a local seating model");
  if (/\.bench\.(push|splice)\(/.test(src)) bad.push("bench.push/splice — a local bench model");
  if (/\.seat\s*=\s*[^=]/.test(src)) bad.push("assigns .seat — the server owns seats");
  if (/\.net_no\s*=\s*[^=]/.test(src)) bad.push("assigns .net_no — the server owns nets");
  return bad;
};

/* ════════════════════════ the director's board ════════════════════════ */

test("the board is registered, reachable from the rail, and loads its own script", () => {
  /* Reachability was half the point of the session-list route: the staff GET took an id nobody could
     discover. A page nobody can navigate to is the same defect one layer up. */
  assert.match(read("web/assets/rail.partial.html"), /href="admin-kotc\.html"/,
    "the Court Board is not in the rail partial — sync-rail cannot put it on 37 pages if it is not the source");
  assert.match(BOARD_HTML, /href="admin-kotc\.html"/, "the synced rail did not reach the page itself");
  assert.match(BOARD_HTML, /src="assets\/admin-kotc\.js/, "the board does not load its own script");
  assert.match(read("web/assets/build-status.js"), /"admin-kotc\.html":/, "not in the tester registry");
});

test("build-status no longer tells testers the director's board is unbuilt", () => {
  /* Failure class 2, and the exact shape C9 named: the copy that says a thing is missing outlives the
     thing arriving. kotc.html's entry said "Not built yet: the director's board that seats the nets". */
  const status = read("web/assets/build-status.js");
  const kotcEntry = status.match(/"kotc\.html":\s*\{[^}]*\}/);
  assert.ok(kotcEntry, "kotc.html has no registry entry");
  assert.ok(!/Not built yet: the director's board/.test(kotcEntry[0]),
    "kotc.html still tells testers the board that just shipped does not exist");
});

test("KEYBOARD PARITY IS ONE MOVER: the drag path and the key path reach the same function", () => {
  // Both paths must call moveTo, and exactly one function may issue the move POST.
  assert.match(BOARD_JS, /addEventListener\("drop"/, "no drop handler — there is no drag path");
  assert.match(BOARD_JS, /function onKey/, "no key handler — there is no keyboard path");
  assert.match(BOARD_JS, /e\.key === "Enter"/, "Enter does not pick up or drop");
  assert.match(BOARD_JS, /e\.key === "Escape"/, "Escape does not cancel a carry");
  assert.match(BOARD_JS, /Arrow(Right|Down|Left|Up)/, "the arrow keys do not choose a destination");

  assert.equal(moveWriters(BOARD_JS), 1,
    `exactly one function may POST a move; saw ${moveWriters(BOARD_JS)} — two movers drift, and the keyboard is the one that drifts unnoticed`);
  // And both paths must be seen to call it.
  const dropCalls = /getData\("text\/plain"\)\);?\s*\n?\s*if \(id\) moveTo\(/.test(BOARD_JS);
  assert.ok(dropCalls, "the drop handler does not call moveTo");
  assert.match(BOARD_JS, /if \(t\) moveTo\(held,/, "the keyboard path does not call moveTo");
});

test("NC: giving the keyboard its own mover is caught", () => {
  /* Mutates the real file: the keyboard branch gets its own fetch to the same route, which is exactly
     how two paths start agreeing today and disagreeing in three releases. */
  const mutated = BOARD_JS.replace(
    "if (t) moveTo(held, Number(t.dataset.net), Number(t.dataset.seat));",
    "if (t) await api(`/api/admin/kotc/${sessionId}/move`, { method: \"POST\", body: \"{}\" });",
  );
  assert.notEqual(mutated, BOARD_JS, "NC did not mutate anything — the guard is testing nothing");
  assert.ok(moveWriters(mutated) > 1,
    "NC FAILED: a second move writer went undetected, so the parity check above proves nothing");
});

test("the board never patches its own seating — the move response IS the next board", () => {
  const bad = patchesLocally(BOARD_JS);
  assert.deepEqual(bad, [], `the page keeps a local seating model: ${bad.join("; ")}`);
  assert.match(BOARD_JS, /data = r\.data;\s*\/\/ the response IS the next board|data = r\.data;/,
    "the move response is not adopted as the board");
  assert.ok(!/dirty/.test(BOARD_JS),
    "no unsaved-changes state here: the pool board is a draft, this is a live Tuesday and every move is written");
});

test("NC: a local seat assignment after a move is caught", () => {
  const mutated = BOARD_JS.replace("landed = contactId;", "landed = contactId; p.seat = seat;");
  assert.notEqual(mutated, BOARD_JS, "NC did not mutate anything");
  assert.ok(patchesLocally(mutated).length >= 1,
    "NC FAILED: a hand-written seat slipped past the check that exists to catch exactly that");
});

test("the board's pressables give :active feedback and clear thumb-sized targets", () => {
  /* A tile that does not respond to a press feels broken before it feels slow, and this screen is
     driven with a thumb at the side of a court — standards §5 puts thumb-critical at 52px. */
  assert.match(BOARD_HTML, /\.kb-seat:active\s*\{[^}]*transform:\s*scale\(0?\.9\d\)/,
    "seats have no :active scale");
  assert.match(BOARD_HTML, /\.kb-seat\s*\{[\s\S]*?min-height:\s*52px/,
    "seats are under the 52px thumb-critical floor");
  assert.match(BOARD_HTML, /\.kb-seat:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring\)/,
    "no bare :focus-visible ring via --focus-ring (F-35)");
});

test("the board declares no ease-in, and nothing animates from scale(0)", () => {
  // ease-in delays the moment the user is watching most closely; scale(0) is an appearance from nothing.
  // Both checks run on `code()`, not the raw file — see its header for why that is the honest corpus.
  const css = code(BOARD_HTML);
  assert.ok(!/var\(--ease-in\)|:\s*ease-in[;\s,)]/.test(css),
    "ease-in on a UI element makes it feel sluggish at the same duration");
  assert.ok(!/scale\(0\)/.test(css), "nothing in the real world appears from nothing");
});

test("NC: the comment-stripping corpus still catches a REAL scale(0) and a REAL ease-in", () => {
  /* code() exists because comments were producing false positives — so it has to be shown that it did
     not simply switch the check off. Mutate the real declarations, not the prose. */
  const withZero = BOARD_HTML.replace("transform:scale(0.96)", "transform:scale(0)");
  assert.notEqual(withZero, BOARD_HTML, "NC did not mutate anything");
  assert.ok(/scale\(0\)/.test(code(withZero)),
    "NC FAILED: stripping comments also stripped the guard's ability to see a real scale(0)");

  const withEaseIn = BOARD_HTML.replace("var(--ease-out)", "var(--ease-in)");
  assert.ok(/var\(--ease-in\)/.test(code(withEaseIn)),
    "NC FAILED: a real ease-in would not be caught either");
});

/* ════════════════════════ the public standings ════════════════════════ */

test("the public page is public: no POST, no admin route, no roster, no link", () => {
  const js = code(LIVE_JS), html = code(LIVE_HTML);
  assert.ok(!/method:\s*"POST"/.test(js), "a public standings page must not write anything");
  assert.ok(!/\/api\/admin\//.test(js), "it must not reach an admin route");
  assert.match(js, /\/api\/live\/kotc\//, "it does not read the public route");
  assert.ok(!/score_token/.test(js + html), "a scoring token has no business on this page");
  // Property ACCESS, not the word: the page may say "no roster" in prose and must not read one.
  assert.ok(!/\.roster\b|\broster\s*[:=]/.test(js), "the page reads or holds a roster (standards §8)");
  assert.ok(!/\.link\b|\blink\s*[:=]/.test(js), "the page touches a link field — that token is a credential");
});

test("NC: a public page that actually read a roster or POSTed is caught", () => {
  const withRoster = LIVE_JS.replace("const rows = d.leaderboard || [];", "const rows = d.roster || [];");
  assert.notEqual(withRoster, LIVE_JS, "NC did not mutate anything");
  assert.ok(/\.roster\b/.test(code(withRoster)), "NC FAILED: a real roster read went undetected");

  const withPost = LIVE_JS.replace("await fetch(api(), {", 'await fetch(api(), { method: "POST",');
  assert.ok(/method:\s*"POST"/.test(code(withPost)), "NC FAILED: a real write went undetected");
});

test("the public page does not abbreviate — it is SENT abbreviated names", () => {
  /* If this page trimmed names, it would be a page that had been sent full ones. The trim is server
     side in kotcplay.js and is asserted against the raw bytes in kotc_board.test.mjs. */
  assert.ok(!/charAt\(0\)|\.slice\(0,\s*1\)|split\("? "?\)\[0\]/.test(LIVE_JS),
    "the page is building initials itself, which means it is receiving full names");
  assert.match(LIVE_JS, /esc\(r\.name\)/, "it should render the name it was given, escaped");
});

test("the public board diffs before it redraws, so a quiet poll touches no DOM", () => {
  /* 25-second polling with an unconditional re-render is how a scoreboard ends up shimmering at
     somebody for an hour. The v0.84.0 live board answered this with a payload diff; same idea here. */
  assert.match(LIVE_JS, /if \(!first && !changed\.length[^)]*\) return;/,
    "no early return on an unchanged poll — every poll would redraw and re-animate");
  assert.match(LIVE_JS, /was\.get\(r\.contact_id\) !== r\.place/,
    "the diff is not on position, so it cannot know which rows moved");
  assert.match(LIVE_JS, /!first &&/, "the first paint must not animate — a page arriving mid-animation looks broken");
});

test("the public board stops polling when the tab is hidden", () => {
  // A hidden tab polling a scoreboard nobody is looking at is somebody's battery.
  assert.match(LIVE_JS, /visibilitychange/, "no visibilitychange handler");
  assert.match(LIVE_JS, /document\.hidden\)\s*stop\(\)/, "hidden tabs keep polling");
});

test("the public board survives a dropped connection without blanking itself", () => {
  /* Offline by a court is normal. A display that clears on one failed fetch is worse than one that is
     thirty seconds stale, and the owner's rule is that a failure may cost information, never permission. */
  assert.match(LIVE_JS, /catch \(e\)/, "no catch around the poll — one dropped packet would throw");
  assert.match(LIVE_JS, /if \(!res\.ok\) return;/, "a non-OK response should be ignored, not rendered");
});

test("a session link with no id explains itself instead of showing an empty board", () => {
  assert.match(LIVE_JS, /if \(!sessionId\)/, "no guard for a missing ?s=");
  assert.match(LIVE_JS, /\?s=/, "the message does not tell somebody what the link should look like");
});

/* ════════════════════════ motion, on both pages ════════════════════════ */

for (const [name, src] of [["admin-kotc.html", BOARD_HTML], ["kotc-live.html", LIVE_HTML]]) {
  test(`${name}: every animation name resolves to a real @keyframes`, () => {
    assert.ok(animsUsed(src).size > 0, `${name} declares no animation — this check would pass vacuously`);
    assert.deepEqual(orphans(src), [],
      "an animation name with no @keyframes animates nothing, silently, and throws nothing");
  });

  test(`${name}: NC — a misspelled animation name is caught`, () => {
    const first = [...animsUsed(src)][0];
    const mutated = src.replace(`animation: ${first}`, `animation: ${first}-typo`);
    assert.notEqual(mutated, src, "NC did not mutate anything");
    assert.ok(orphans(mutated).length >= 1, "the orphaned animation name must be caught");
  });

  test(`${name}: the reduced-motion block covers \`animation\`, not just \`transition\``, () => {
    const block = reducedBlock(src);
    assert.ok(block, `${name} has no prefers-reduced-motion block`);
    assert.match(block, /animation\s*:/,
      "a reduced-motion block that never mentions `animation` leaves every @keyframes running");
  });

  test(`${name}: NC — a reduced-motion block that only handles transition is caught`, () => {
    const block = reducedBlock(src);
    const mutated = src.replace(block, block.replace(/animation\s*:/g, "transition:"));
    assert.notEqual(mutated, src, "NC did not mutate anything");
    const after = reducedBlock(mutated);
    assert.ok(after && !/animation\s*:/.test(after),
      "NC FAILED: the check would have passed a block that silences nothing that moves");
  });
}
