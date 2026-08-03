/* Boomtown Platform — Brackets (admin page script)
   File: web/assets/admin-brackets.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.66.0

   The bracket is drawn as one column per round, earliest on the left, so it reads the way a bracket
   on a gym wall reads. Every slot that has no team yet says which game it is waiting on — "Winner of
   Quarter-final 2" — because an empty box tells a director nothing at the moment they most need to
   answer "who is on court 3 next?".

   The server does the seeding, the byes and the advancing. This file draws what comes back and asks
   for the next thing. Nothing here decides who won. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let data = null;

  function side(name, waiting, isWinner, score) {
    const cls = "br-side" + (isWinner ? " won" : "") + (name ? "" : " tbd");
    return `<span class="${cls}">
      <span class="br-name">${name ? esc(name) : esc(waiting || "To be decided")}</span>
      <span class="br-score">${score === null || score === undefined ? "" : score}</span>
    </span>`;
  }

  function matchCard(mt) {
    const aWon = mt.winner && mt.winner === mt.team_a;
    const bWon = mt.winner && mt.winner === mt.team_b;
    return `<li class="br-match"${mt.winner ? ' data-done="1"' : ""}>
      <span class="br-court">Ct ${mt.court}</span>
      ${side(mt.team_a, mt.waiting_a, aWon, mt.score_a)}
      ${side(mt.team_b, mt.waiting_b, bWon, mt.score_b)}
    </li>`;
  }

  function treeHtml(br) {
    const rounds = br.rounds.map((r) => `
      <div class="br-round" role="group" aria-label="${esc(r.label)}">
        <h3 class="br-round-h">${esc(r.label)}</h3>
        <ul class="br-list">${r.matches.map(matchCard).join("")}</ul>
      </div>`).join("");
    const champ = br.champion
      ? `<p class="br-champ">🏆 <b>${esc(br.champion)}</b> wins the ${esc(br.name)} bracket.</p>`
      : `<p class="mf-note">${br.played} of ${br.total} games played${br.seeded_by ? ` · seeded by ${esc(br.seeded_by)}` : ""}.</p>`;
    return `<section class="br-tree" aria-labelledby="brH${br.id}">
      <h2 class="mf-sub" id="brH${br.id}">${esc(br.name)} bracket</h2>
      ${champ}
      <div class="br-scroll">${rounds}</div>
    </section>`;
  }

  function render() {
    const list = (data && data.brackets) || [];
    $("bEmpty").hidden = list.length > 0;
    $("bTrees").innerHTML = list.map(treeHtml).join("");
  }

  async function load() {
    if (!eventId) return;
    const r = await api(`/api/admin/events/${eventId}/brackets`);
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't load that bracket.");
    data = r.data;
    render();
  }

  async function generate() {
    const body = {
      a_size: Number($("bASize").value) || undefined,
      include_rest: $("bRest").checked,
      points_to: Number($("bPoints").value) || undefined,
      courts: Number($("bCourts").value) || undefined,
    };
    let r = await api(`/api/admin/events/${eventId}/brackets`, { method: "POST", body: JSON.stringify(body) });

    // A bracket already exists. Say how big it is and what regenerating costs before doing it —
    // the old one is only ever set aside, never destroyed, but the director should still choose.
    if (r.status === 409 && r.data.existing_matches) {
      if (!window.confirm(`${r.data.error}\n\nReplace it? The current bracket is kept and can be restored.`)) return;
      r = await api(`/api/admin/events/${eventId}/brackets`, {
        method: "POST", body: JSON.stringify({ ...body, replace: true }),
      });
    }
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't generate that bracket.");
    $("bNote").textContent = r.data.summary.join(" · ");
    load();
  }

  async function advance() {
    const r = await api(`/api/admin/events/${eventId}/brackets/advance`, { method: "POST" });
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't move the winners forward.");
    $("bNote").textContent = r.data.note;
    data = r.data;
    render();
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return fail("bTrees", "Couldn't load your events.");
    const list = (r.data.events || []).slice(0, 40);
    $("bEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("bEvent").addEventListener("change", () => { eventId = Number($("bEvent").value); load(); });
    $("bReload").addEventListener("click", load);
    $("bGen").addEventListener("click", generate);
    $("bAdvance").addEventListener("click", advance);
    loadEvents();
  });
})();
