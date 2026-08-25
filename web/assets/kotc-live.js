/* Boomtown Platform — King / Queen of the Court, public standings (page script)
   File: web/assets/kotc-live.js · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.86.0

   Screen (c) of three. Reads GET /api/live/kotc/:id — no login, no session, nothing to sign into. A
   parent standing by court 3 with one bar of signal is not going to sign in, and a wall display cannot.

   ── THE POLL IS THE HARD PART, NOT THE LIST ──
   A board that polls and re-renders unconditionally animates every row every time, which is how a
   scoreboard ends up shimmering at somebody for an hour. The v0.84.0 live board paid for that lesson
   and answered it with a payload diff; this page does the same thing in the small: it compares the
   standings it just received against the ones on screen and only marks the rows whose PLACE actually
   changed. A poll that changes nothing touches no DOM at all.

   ── NAMES ARE NOT THIS PAGE'S DECISION ──
   The server sends "Ava S." and that is all it sends. This page does not abbreviate, does not hold a
   full name it chose not to show, and never receives a scoring link. If it looks like a name is being
   trimmed here, something has gone wrong server-side — standards §8 is enforced in kotcplay.js and
   asserted against the raw bytes in kotc_board.test.mjs.

   ── NO ADMIN AFFORDANCES ──
   No move, no edit, no roster. The only interaction is choosing to look. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const POLL_MS = 25000;   // same cadence as the live board — a KOTC net takes minutes, not seconds
  const sessionId = new URLSearchParams(location.search).get("s");
  let shown = [];          // the standings currently on screen, for the diff
  let timer = null;

  const api = () => {
    const base = (window.BT_CONFIG && window.BT_CONFIG.API_ORIGIN) || "";
    return `${base}/api/live/kotc/${encodeURIComponent(sessionId)}`;
  };

  function shell(inner) { $("klWrap").innerHTML = inner; }

  function rowHtml(r, moved) {
    return `<li class="kl-row${r.place === 1 ? " top" : ""}${moved ? " kl-moved" : ""}">
      <span class="kl-place">${r.place}</span>
      <span class="kl-name">${esc(r.name)}</span>
      <span class="kl-nums">
        <span class="kl-pts">${r.points}</span>
        <span class="kl-sec">${r.point_diff > 0 ? "+" : ""}${r.point_diff} · ${r.wins}–${r.losses}</span>
      </span>
    </li>`;
  }

  function render(d) {
    const rows = d.leaderboard || [];

    /* THE DIFF. `was` is where each player stood a moment ago; a player who has not moved is not
       marked, and if nobody moved the list is not rewritten at all. */
    const was = new Map(shown.map((r) => [r.contact_id, r.place]));
    const changed = rows.filter((r) => was.get(r.contact_id) !== r.place);
    const first = shown.length === 0;

    if (!first && !changed.length && rows.length === shown.length) return;   // nothing to say

    const meta = [
      d.status === "in_progress" ? '<span class="kl-chip live">Playing now</span>' : "",
      d.rounds ? `<span class="kl-chip">${d.rounds} round${d.rounds === 1 ? "" : "s"}</span>` : "",
      d.points_to ? `<span class="kl-chip">first to ${d.points_to}</span>` : "",
    ].filter(Boolean).join("");

    shell(`
      <div class="kl-head">
        <h1 class="kl-title">${esc(d.session || "King of the Court")}</h1>
        <p class="kl-sub">Every player for themselves. Wins first, then point difference.</p>
        <div class="kl-meta">${meta}</div>
      </div>
      ${rows.length
        ? `<ul class="kl-list">${rows.map((r) =>
            // Nothing animates on the first paint. A page that arrives mid-animation looks broken.
            rowHtml(r, !first && was.get(r.contact_id) !== r.place)).join("")}</ul>`
        : `<p class="kl-empty">No scores yet. This fills in as the nets finish their games.</p>`}
      <p class="kl-foot">Updates on its own. No need to refresh.</p>
    `);

    shown = rows.map((r) => ({ contact_id: r.contact_id, place: r.place }));
  }

  async function tick() {
    try {
      const res = await fetch(api(), { headers: { "X-Org-Id": String((window.BT_CONFIG && window.BT_CONFIG.ORG_ID) || 1) } });
      if (res.status === 404) {
        shell(`<p class="kl-empty">That session isn't running. Check the link with whoever is organising the night.</p>`);
        return stop();
      }
      if (!res.ok) return;                    // a blip is not news; the next poll will say the same or better
      render(await res.json());
    } catch (e) {
      /* Offline by the court is normal and is not an error worth a red box. The board keeps whatever it
         last showed and tries again — a display that blanks itself on one dropped packet is worse than
         a display that is thirty seconds stale. */
    }
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  document.addEventListener("DOMContentLoaded", () => {
    if (!sessionId) {
      shell(`<p class="kl-empty">This page needs the session link that ends in <b>?s=</b> and a number. Ask whoever is running the night.</p>`);
      return;
    }
    tick();
    timer = setInterval(tick, POLL_MS);
    // A hidden tab polling a scoreboard nobody is looking at is somebody's battery.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (!timer) { tick(); timer = setInterval(tick, POLL_MS); }
    });
  });
})();
