/* Boomtown Platform — Schedule editor (admin page script)
   File: web/assets/admin-schedule-editor.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.65.0

   Drag a match to another round or court. Drop on an occupied slot and the two swap.

   THE RULE THIS SCREEN IS BUILT ON: it never refuses a move. A director always knows something the
   solver does not — this team asked to finish early, that court has a broken net, these two should
   not meet in round one. A tool that blocks them is a tool they route around, and then the real
   schedule lives in a spreadsheet again. So every move is allowed, and the fairness panel reports
   what it cost.

   KEYBOARD IS NOT AN AFTERTHOUGHT. HTML5 drag-and-drop is unusable with a keyboard and awkward on
   touch, so the same operation is available as: focus a match → Enter to pick up → arrows to move
   → Enter to drop, Escape to cancel. Both paths call the same mover.

   The fairness numbers come from the SERVER, recomputed after every move, using the same report the
   generator uses. Scoring here in the client would feel faster and would eventually disagree with
   the generator — and the moment those two disagree, the director believes neither. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let data = null;          // last server payload
  let prevReport = null;    // to describe what a move changed
  let carrying = null;      // match id being moved by keyboard

  /* ---------- render ---------- */

  function matchCell(mt) {
    if (!mt) return "";
    const played = mt.played ? ' data-played="1"' : "";
    const score = mt.played ? `<span class="ed-score">${mt.score_a}–${mt.score_b}</span>` : "";
    return `<button class="ed-match" draggable="true" data-id="${mt.id}"${played}
        aria-label="${esc(mt.team_a || "TBD")} versus ${esc(mt.team_b || "TBD")}, round ${mt.round}, court ${mt.court}${mt.played ? ", already played" : ""}">
      <span class="ed-side">${esc(mt.team_a || "—")}</span>
      <span class="ed-vs">v</span>
      <span class="ed-side">${esc(mt.team_b || "—")}</span>
      ${mt.ref_team ? `<span class="ed-ref">ref ${esc(mt.ref_team)}</span>` : ""}
      ${score}
    </button>`;
  }

  function render() {
    if (!data) return;
    const { rounds, courts, matches } = data;
    $("sEmpty").hidden = matches.length > 0;
    if (!matches.length) { $("sGrid").innerHTML = ""; renderSide(); return; }

    const at = (r, c) => matches.find((m) => m.round === r && m.court === c);
    let html = `<table class="ed-grid"><caption class="sr-only">Matches by round and court</caption><thead><tr><th scope="col">Round</th>`;
    for (let c = 1; c <= courts; c++) html += `<th scope="col">Court ${c}</th>`;
    html += `</tr></thead><tbody>`;
    for (let r = 1; r <= rounds; r++) {
      html += `<tr><th scope="row">${r}</th>`;
      for (let c = 1; c <= courts; c++) {
        html += `<td class="ed-slot" data-round="${r}" data-court="${c}">${matchCell(at(r, c))}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    $("sGrid").innerHTML = html;
    wireGrid();
    renderSide();
  }

  function renderSide() {
    $("sReport").innerHTML = (data.summary || []).map((l) => `<li>${esc(l)}</li>`).join("");
    $("sByes").innerHTML = (data.byes || [])
      .map((names, i) => `<li><b>Round ${i + 1}:</b> ${names.length ? esc(names.join(", ")) : "everyone plays"}</li>`)
      .join("");
  }

  /** Say what the last move actually cost, in the terms the director cares about. */
  function describeDelta(before, after) {
    if (!before || !after) return "";
    const bits = [];
    const dRep = after.opponents.repeatedPairs - before.opponents.repeatedPairs;
    if (dRep > 0) bits.push(`${dRep} more repeat match-up${dRep > 1 ? "s" : ""}`);
    if (dRep < 0) bits.push(`${-dRep} fewer repeat match-up${dRep < -1 ? "s" : ""}`);
    const dB2B = after.waiting.backToBackByes - before.waiting.backToBackByes;
    if (dB2B > 0) bits.push(`${dB2B} team(s) now sit out twice in a row`);
    if (dB2B < 0) bits.push(`no longer sitting out twice in a row`);
    if (before.gamesPerTeam.equal && !after.gamesPerTeam.equal) bits.push("games are no longer equal");
    if (!before.gamesPerTeam.equal && after.gamesPerTeam.equal) bits.push("games are equal again");
    if (!after.valid) bits.push(`⚠ ${after.problems[0]}`);
    return bits.length ? bits.join(" · ") : "No change to fairness.";
  }

  /* ---------- moving ---------- */

  async function move(matchId, round, court) {
    const mt = data.matches.find((m) => m.id === matchId);
    if (!mt) return;
    if (mt.round === round && mt.court === court) return;
    // A played match being dragged is nearly always a mis-drag. Ask once; do not forbid.
    if (mt.played && !window.confirm(
      `${mt.team_a} v ${mt.team_b} has already been played (${mt.score_a}–${mt.score_b}). Move it anyway?`
    )) return;

    prevReport = data.report;
    const r = await api(`/api/admin/events/${eventId}/schedule/move`, {
      method: "POST", body: JSON.stringify({ match_id: matchId, round, court }),
    });
    if (!r.ok) return fail("sGrid", r.data.error || "Couldn't move that match.");
    data = r.data;
    render();
    const delta = describeDelta(prevReport, data.report);
    $("sDelta").textContent = (r.data.swapped_with ? "Swapped. " : "Moved. ") + delta;
  }

  function wireGrid() {
    const grid = $("sGrid");

    grid.querySelectorAll(".ed-match").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", el.dataset.id);
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));

      // Keyboard path: Enter picks up and drops, arrows move the carried match, Escape cancels.
      el.addEventListener("keydown", (e) => {
        const slot = el.closest(".ed-slot");
        const r = Number(slot.dataset.round), c = Number(slot.dataset.court);
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (carrying === null) {
            carrying = Number(el.dataset.id);
            el.classList.add("carrying");
            $("sDelta").textContent = "Picked up. Use the arrow keys to move it, Enter to drop, Escape to cancel.";
          } else {
            const id = carrying; carrying = null;
            move(id, r, c);
          }
          return;
        }
        if (e.key === "Escape" && carrying !== null) {
          carrying = null;
          grid.querySelectorAll(".carrying").forEach((x) => x.classList.remove("carrying"));
          $("sDelta").textContent = "Cancelled.";
          return;
        }
        const deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (!deltas[e.key]) return;
        e.preventDefault();
        const [dr, dc] = deltas[e.key];
        const nr = Math.min(data.rounds, Math.max(1, r + dr));
        const nc = Math.min(data.courts, Math.max(1, c + dc));
        if (carrying !== null) { const id = carrying; carrying = null; move(id, nr, nc); return; }
        // Not carrying: just walk focus around the grid.
        const target = grid.querySelector(`[data-round="${nr}"][data-court="${nc}"] .ed-match`);
        if (target) target.focus();
      });
    });

    grid.querySelectorAll(".ed-slot").forEach((slot) => {
      slot.addEventListener("dragover", (e) => { e.preventDefault(); slot.classList.add("over"); });
      slot.addEventListener("dragleave", () => slot.classList.remove("over"));
      slot.addEventListener("drop", (e) => {
        e.preventDefault();
        slot.classList.remove("over");
        const id = Number(e.dataTransfer.getData("text/plain"));
        if (id) move(id, Number(slot.dataset.round), Number(slot.dataset.court));
      });
    });
  }

  /* ---------- load ---------- */

  async function loadSchedule() {
    if (!eventId) return;
    const r = await api(`/api/admin/events/${eventId}/schedule`);
    if (!r.ok) return fail("sGrid", r.data.error || "Couldn't load that schedule.");
    data = r.data;
    prevReport = null;
    $("sDelta").textContent = "";
    render();
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return BT_ADMIN.loadFail("sGrid", r, "events"); // v0.89.0 Block B4: a 403 names the org, not the module
    const list = (r.data.events || []).slice(0, 40);
    $("sEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    if (!eventId) return BT_ADMIN.orgEmptyState("sGrid", "events"); // v0.89.0 Block B3: an empty org is not a broken module
    loadSchedule();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("sEvent").addEventListener("change", () => { eventId = Number($("sEvent").value); loadSchedule(); });
    $("sReload").addEventListener("click", loadSchedule);
    loadEvents();
  });
})();
