/* Boomtown Platform — Schedule editor (admin page script)
   File: web/assets/admin-schedule-editor.js · Version: v1.2 · Date: 2026-08-24 · Ships in: v0.164.0 (v1.2 in v0.193.0)
   v1.2 (§-1r RF-3, the week-first flow): a Show filter renders ONE week (league) / round
   (tournament) at a time — a client-side filter, no reload; drag stays live within the shown
   week (switch to All to move across weeks). Print prints what is shown, so a filtered view IS
   the per-week print; the page's print CSS drops the controls and fairness panel.
   v1.1 (owner request): courts down the side / rounds across the top by default, with a switch
   back — the one bt_grid_axis preference shared with Tournament Ops; arrows follow the visual axes.

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
  const { api, esc, fail, downloadText, csvRow, emailDocument } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let data = null;          // last server payload; positions in it are the HELD (unsaved) state
  let weekFilter = 0;       // RF-3: 0 = every week; N = render round N only (a client-side filter)
  let eventType = "";       // "league" labels the filter Week; anything else, Round
  let prevReport = null;    // to describe what a move changed
  let carrying = null;      // match id being moved by keyboard
  /* T2-1a (§-0 B11), the owner's settled shape: hold changes until Save, revert back and
     forward, confirm to save — the pool board's "nothing saves until you say so", plus a
     history. Every move below mutates `data` LOCALLY and records its inverse; the server sees
     nothing until save() posts the changed positions to the one apply endpoint. Fairness still
     comes from the server after every held move — the preview endpoint scores the hypothetical
     arrangement with the generator's own rules and writes nothing — because this file's charter
     forbids a second, client-side definition of "fair". */
  let baseline = new Map();  // match id → {round, court} as last saved/loaded
  let undoStack = [];        // each entry: list of {id, round, court} to restore (the inverse)
  let redoStack = [];
  /* Grid axis (owner, 2026-08-16): the ONE preference Tournament Ops shares — courts down the
     side by default, the old rounds-down shape one press away. Cells keep data-round/data-court
     either way, so the mover, the drops and the apply payload never notice the orientation.
     B22 (v0.165.0): read and written through one guarded pair — a private-mode or blocked-cookie
     profile THROWS on storage access rather than returning null, and this read runs at first
     render. The fallback keeps the switch working for the session when the write is refused; it
     stops remembering across reloads, it does not stop working. Same shape as Tournament Ops'
     pair and as config.js's — and since D-42 below, the same MAP as both. */
  /* D-42 (v0.167.0): ONE fallback map per PAGE, not one per module. v0.166.0 gave each guarded
     file its own closure-private Map, which is coherent inside a file and incoherent across a
     page: with storage blocked, this module's write was invisible to every other module on the
     same page, so two of them disagreed about state they both read from one place (measured:
     `bt_org` and `bt_token` are touched by four guarded modules; tournament.html co-loads
     admin-nav.js, which WRITES bt_org, with this page's reader). The map hangs off `window`
     so every guarded file on the page shares one object for the page's lifetime; the
     `x || (x = new Map())` form is load-order-independent, so whichever script runs first
     creates it and the rest join it. Storage stays the source of truth whenever it works —
     the map is consulted only when a read throws or comes back empty. */
  const localMem = window.BT_MEM_FALLBACK || (window.BT_MEM_FALLBACK = new Map());
  const safeGet = (k) => {
    try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {}
    return localMem.has(k) ? localMem.get(k) : null;
  };
  const safeSet = (k, v) => { localMem.set(k, v); try { localStorage.setItem(k, v); } catch (e) {} };
  const courtsDown = () => safeGet("bt_grid_axis") !== "rounds-down";

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

  /** RF-3: the rounds the grid shows — every round, or the one the Show filter picked. A stale
      filter (the schedule shrank under it) falls back to All rather than an empty grid. */
  function shownRounds() {
    const all = Array.from({ length: data.rounds }, (_, i) => i + 1);
    if (weekFilter && weekFilter <= data.rounds) return [weekFilter];
    weekFilter = 0;
    return all;
  }

  function render() {
    if (!data) return;
    const { courts, matches } = data;
    $("sEmpty").hidden = matches.length > 0;
    if (!matches.length) { $("sGrid").innerHTML = ""; renderWeekFilter(); renderSide(); return; }

    const roundLabel = eventType === "league" ? "Week" : "Round";
    const rlist = shownRounds();
    const at = (r, c) => matches.find((m) => m.round === r && m.court === c);
    const slot = (r, c) => `<td class="ed-slot" data-round="${r}" data-court="${c}">${matchCell(at(r, c))}</td>`;
    let html = `<table class="ed-grid"><caption class="sr-only">Matches by round and court</caption><thead><tr>`;
    if (courtsDown()) {
      // Grid axis (owner, 2026-08-16): courts down the side, rounds across the top — the default.
      html += `<th scope="col">Court</th>`;
      for (const r of rlist) html += `<th scope="col">${roundLabel} ${r}</th>`;
      html += `</tr></thead><tbody>`;
      for (let c = 1; c <= courts; c++) {
        html += `<tr><th scope="row">${c}</th>`;
        for (const r of rlist) html += slot(r, c);
        html += `</tr>`;
      }
    } else {
      html += `<th scope="col">${roundLabel}</th>`;
      for (let c = 1; c <= courts; c++) html += `<th scope="col">Court ${c}</th>`;
      html += `</tr></thead><tbody>`;
      for (const r of rlist) {
        html += `<tr><th scope="row">${r}</th>`;
        for (let c = 1; c <= courts; c++) html += slot(r, c);
        html += `</tr>`;
      }
    }
    html += `</tbody></table>`;
    $("sGrid").innerHTML = html;
    renderWeekFilter();
    $("sAxis").textContent = courtsDown() ? "Courts across the top" : "Courts down the side";
    wireGrid();
    renderSide();
  }

  /** RF-3: the Show filter's options track the schedule's rounds; the selection survives a
      re-render. Hidden when there is nothing to filter (0-1 rounds). */
  function renderWeekFilter() {
    const sel = $("sWeek");
    if (!sel) return;
    const rounds = (data && data.rounds) || 0;
    const label = eventType === "league" ? "Week" : "Round";
    sel.hidden = rounds < 2;
    sel.innerHTML = `<option value="0">All</option>` +
      Array.from({ length: rounds }, (_, i) => `<option value="${i + 1}">${label} ${i + 1}</option>`).join("");
    sel.value = String(weekFilter);
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

  /* ---------- moving (LOCAL — nothing saves until you say so) ---------- */

  const positionsOf = (ids) => ids.map((id) => {
    const m = data.matches.find((x) => x.id === id);
    return { id, round: m.round, court: m.court };
  });
  const changedPositions = () => data.matches
    .filter((m) => { const b = baseline.get(m.id); return b && (b.round !== m.round || b.court !== m.court); })
    .map((m) => ({ match_id: m.id, round: m.round, court: m.court }));
  const dirty = () => changedPositions().length > 0;

  function applyLocal(entries) {
    for (const e of entries) {
      const m = data.matches.find((x) => x.id === e.id);
      if (m) { m.round = e.round; m.court = e.court; }
    }
  }

  async function move(matchId, round, court) {
    const mt = data.matches.find((m) => m.id === matchId);
    if (!mt) return;
    if (mt.round === round && mt.court === court) return;
    // A played match being dragged is nearly always a mis-drag. Ask once; do not forbid.
    if (mt.played && !window.confirm(
      `${mt.team_a} v ${mt.team_b} has already been played (${mt.score_a}–${mt.score_b}). Move it anyway?`
    )) return;

    const occupant = data.matches.find((m) => m.round === round && m.court === court && m.id !== matchId);
    // The inverse — restoring these positions undoes this move — goes on the history BEFORE the
    // mutation, and a new move burns the redo branch, as every editor's history does.
    undoStack.push(positionsOf(occupant ? [matchId, occupant.id] : [matchId]));
    redoStack = [];
    if (occupant) { occupant.round = mt.round; occupant.court = mt.court; }
    mt.round = round; mt.court = court;
    render();
    await previewScore(occupant ? "Swapped (not saved). " : "Moved (not saved). ");
  }

  /** The server scores the HELD arrangement — same rules as the generator, no write. */
  async function previewScore(prefix) {
    prevReport = data.report;
    const r = await api(`/api/admin/events/${eventId}/schedule/preview`, {
      method: "POST",
      body: JSON.stringify({ positions: data.matches.map((m) => ({ match_id: m.id, round: m.round, court: m.court })) }),
    });
    if (r.ok) {
      data.report = r.data.report; data.summary = r.data.summary; data.byes = r.data.byes;
      renderSide();
      $("sDelta").textContent = (prefix || "") + describeDelta(prevReport, data.report);
    } else {
      $("sDelta").textContent = (prefix || "") + (r.data.error || "Couldn't re-score the arrangement.");
    }
    paintState();
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return;
    redoStack.push(positionsOf(entry.map((e) => e.id)));
    applyLocal(entry);
    render();
    previewScore("Undid a move (not saved). ");
  }
  function redo() {
    const entry = redoStack.pop();
    if (!entry) return;
    undoStack.push(positionsOf(entry.map((e) => e.id)));
    applyLocal(entry);
    render();
    previewScore("Redid a move (not saved). ");
  }

  async function save() {
    const positions = changedPositions();
    if (!positions.length) return;
    const r = await api(`/api/admin/events/${eventId}/schedule/apply`, {
      method: "POST", body: JSON.stringify({ positions }),
    });
    if (!r.ok) { $("sDelta").textContent = r.data.error || "Couldn't save the arrangement."; return; }
    data = r.data;
    baseline = new Map(data.matches.map((m) => [m.id, { round: m.round, court: m.court }]));
    undoStack = []; redoStack = [];
    prevReport = null;
    render();
    $("sDelta").textContent = `Saved ${r.data.changed} change${r.data.changed === 1 ? "" : "s"}.`;
    paintState();
  }

  function paintState() {
    const n = changedPositions().length;
    $("sSave").disabled = n === 0;
    $("sSave").textContent = n ? `Save ${n} change${n === 1 ? "" : "s"}` : "Save";
    $("sUndo").disabled = undoStack.length === 0;
    $("sRedo").disabled = redoStack.length === 0;
    $("sState").textContent = n ? "Unsaved changes" : "Saved";
    $("sState").className = "ed-state" + (n ? " dirty" : "");
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
        // (round delta, court delta) — which pair an arrow means depends on which axis is
        // drawn down the page, so the keys always move along the VISUAL grid.
        const deltas = courtsDown()
          ? { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
          : { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
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
    baseline = new Map(data.matches.map((m) => [m.id, { round: m.round, court: m.court }]));
    undoStack = []; redoStack = [];
    prevReport = null;
    $("sDelta").textContent = "";
    render();
    paintState();
  }

  /** Held changes are the one thing this screen can now LOSE — save-every-move could not.
      Every exit while dirty asks first; "discard" reverts to the last saved arrangement. */
  function confirmDiscard(what) {
    return !dirty() || window.confirm(`You have unsaved schedule changes. ${what} without saving them?`);
  }

  /* WF-6 riders for RF-3's print (v0.193.0): the CSV and email siblings. Both export WHAT IS
     SHOWN — the Show filter narrows them to one week, exactly like the print. Held (unsaved)
     positions export as held: the sheet in your hand should match the grid on your screen. */
  function scheduleLines() {
    if (!data || !data.matches.length) return null;
    const label = eventType === "league" ? "Week" : "Round";
    const lines = [];
    for (const r of shownRounds()) {
      for (const mt of data.matches.filter((m) => m.round === r).sort((a, b) => a.court - b.court)) {
        lines.push(`${label} ${r} · Court ${mt.court}: ${mt.team_a || "TBD"} vs ${mt.team_b || "TBD"}${mt.played ? ` (${mt.score_a}–${mt.score_b})` : ""}`);
      }
    }
    return lines;
  }
  function eventLabel() {
    const opt = $("sEvent").selectedOptions && $("sEvent").selectedOptions[0];
    return (opt && opt.textContent) || "schedule";
  }
  function csvSchedule() {
    if (!data || !data.matches.length) { window.alert("Nothing to export yet — generate a schedule first."); return; }
    const label = eventType === "league" ? "Week" : "Round";
    const rows = [csvRow([label, "Court", "Team A", "Team B", "Score A", "Score B"])];
    for (const r of shownRounds()) {
      for (const mt of data.matches.filter((m) => m.round === r).sort((a, b) => a.court - b.court)) {
        rows.push(csvRow([mt.round, mt.court, mt.team_a || "", mt.team_b || "",
          mt.score_a != null ? mt.score_a : "", mt.score_b != null ? mt.score_b : ""]));
      }
    }
    downloadText(`${new Date().toISOString().slice(0, 10)}_${eventLabel().replace(/\W+/g, "-")}_schedule.csv`, rows.join("\r\n"));
  }
  function emailSchedule() {
    const lines = scheduleLines();
    if (!lines) { window.alert("Nothing to email yet — generate a schedule first."); return; }
    emailDocument(eventId, `${eventLabel()} — schedule`, [eventLabel(), "", ...lines].join("\n"));
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return BT_ADMIN.loadFail("sGrid", r, "events"); // v0.89.0 Block B4: a 403 names the org, not the module
    const list = (r.data.events || []).slice(0, 40);
    $("sEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    // RF-3: the filter speaks the event's own vocabulary — a league's rounds ARE its weeks.
    const typeOf = (id) => (list.find((e) => e.id === id) || {}).type || "";
    $("sEvent").addEventListener("change", () => { eventType = typeOf(Number($("sEvent").value)); weekFilter = 0; });
    // W-B (v0.93.0): honor ?event= so League Manager's "Rearrange courts & weeks" lands on the
    // right league instead of whatever sorts first. An id outside this org's list is ignored.
    const wanted = Number(new URLSearchParams(location.search).get("event"));
    const hit = wanted && list.find((e) => e.id === wanted);
    eventId = hit ? hit.id : (list.length ? list[0].id : null);
    if (!eventId) return BT_ADMIN.orgEmptyState("sGrid", "events"); // v0.89.0 Block B3: an empty org is not a broken module
    eventType = typeOf(eventId);
    if (hit) $("sEvent").value = String(eventId);
    loadSchedule();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("sEvent").addEventListener("change", () => {
      if (!confirmDiscard("Switch events")) { $("sEvent").value = String(eventId); return; }
      eventId = Number($("sEvent").value); loadSchedule();
    });
    $("sReload").addEventListener("click", () => { if (confirmDiscard("Reload")) loadSchedule(); });
    // RF-3: the Show filter is a VIEW — held moves and the undo history are untouched by it, the
    // same property the axis switch below already has. Print prints what is shown, and so do the
    // CSV and email hand-offs (WF-6: all three wherever there is one, honoring the filter).
    $("sWeek").addEventListener("change", () => { weekFilter = Number($("sWeek").value) || 0; render(); });
    $("sPrint").addEventListener("click", () => window.print());
    $("sCsv").addEventListener("click", csvSchedule);
    $("sEmail").addEventListener("click", emailSchedule);
    $("sAxis").addEventListener("click", () => {
      safeSet("bt_grid_axis", courtsDown() ? "rounds-down" : "courts-down");
      render(); // held state and history are untouched — only where the cells are drawn moves
    });
    /* B22: the other tab's flip. render() redraws from `data`, so held moves and the undo
       history survive a repaint — the same reason the switch above can call it directly. */
    window.addEventListener("storage", (e) => { if (e.key === "bt_grid_axis") render(); });
    $("sSave").addEventListener("click", save);
    $("sUndo").addEventListener("click", undo);
    $("sRedo").addEventListener("click", redo);
    // The history from the keyboard: Ctrl/Cmd+Z back, Ctrl/Cmd+Shift+Z or Ctrl+Y forward. No
    // animation on any of it — these are repeated actions, and the grid re-render IS the feedback.
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (k === "y") { e.preventDefault(); redo(); }
    });
    window.addEventListener("beforeunload", (e) => {
      if (dirty()) { e.preventDefault(); e.returnValue = ""; }
    });
    loadEvents();
  });
})();
