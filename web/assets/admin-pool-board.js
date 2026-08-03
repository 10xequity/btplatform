/* Boomtown Platform — Pool board (admin page script)
   File: web/assets/admin-pool-board.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.70.0

   A board for arranging teams before any schedule exists. Owner 2026-08-03:
   "Add drag and drop for me to sort which teams go where and allow me to write a note that is
    displayed on the tile. I will need areas to drag and drop for each division, and if i drag to a
    square or block with + it will add a pool. and if it is empty, itll auto delete. i will also
    need a workspace area to arrange teams to move."

   FOUR THINGS THIS SCREEN IS BUILT AROUND:

   1. THE WORKSPACE IS WHERE EVERYONE STARTS. A team with no pool is not an error state, it is the
      staging area. Dragging out of a pool puts a team back there rather than nowhere.

   2. THE "+" TILE IS THE ONLY WAY TO MAKE A POOL, and dropping on it is what makes it. There is no
      "create pool" button that then needs filling — an empty pool is not a thing this board can
      hold, because an empty pool auto-deletes the moment it is saved.

   3. NOTHING SAVES UNTIL YOU SAY SO. Every drag is local. One Save writes the whole arrangement in
      a single request, so a dropped connection mid-session cannot leave a team in two pools or in
      none. The unsaved state is announced, because an unsaved board that looks saved is how a
      director walks away from twenty minutes of work.

   4. KEYBOARD PARITY. HTML5 drag-and-drop cannot be driven from a keyboard. Focus a tile, Enter to
      pick up, arrows to choose a destination, Enter to drop, Escape to cancel. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let board = null;          // the server's last word
  let dirty = false;         // local changes not yet written
  let carrying = null;       // team id being moved by keyboard
  let tempSeq = -1;          // negative ids for pools that do not exist server-side yet

  /* ---------- local model ----------
     Kept as plain arrays so a drag is a splice, not a request. `id` is negative for a pool this
     board invented; the server treats those as new. */
  let zones = [];            // [{ key, poolId, divisionId, name, teams: [team] }]
  let workspace = [];

  function ingest(data) {
    board = data;
    zones = [];
    for (const d of data.divisions || []) {
      for (const p of d.pools || []) {
        zones.push({ key: `p${p.id}`, poolId: p.id, divisionId: d.id, name: p.name, teams: [...p.teams] });
      }
    }
    for (const p of data.loose_pools || []) {
      zones.push({ key: `p${p.id}`, poolId: p.id, divisionId: null, name: p.name, teams: [...p.teams] });
    }
    workspace = [...(data.workspace || [])];
    dirty = false;
    tempSeq = -1;
  }

  const allTeams = () => [...workspace, ...zones.flatMap((z) => z.teams)];
  const findTeam = (id) => allTeams().find((t) => t.id === id);

  function removeTeam(id) {
    workspace = workspace.filter((t) => t.id !== id);
    for (const z of zones) z.teams = z.teams.filter((t) => t.id !== id);
  }

  /** Move a team into a zone, or into the workspace when `key` is "workspace". */
  function place(teamId, key) {
    const team = findTeam(teamId);
    if (!team) return;
    removeTeam(teamId);
    if (key === "workspace") workspace.push(team);
    else {
      const z = zones.find((x) => x.key === key);
      if (!z) { workspace.push(team); return; }
      z.teams.push(team);
    }
    dirty = true;
    render();
  }

  /** The "+" tile: a drop here invents a pool and puts the team in it. */
  function newPool(teamId, divisionId) {
    const id = tempSeq--;
    const inDiv = zones.filter((z) => z.divisionId === divisionId).length;
    zones.push({
      key: `t${id}`, poolId: null, divisionId,
      name: `Pool ${String.fromCharCode(65 + inDiv)}`, teams: [],
    });
    place(teamId, `t${id}`);
  }

  /* ---------- render ---------- */

  function tile(t) {
    const record = (t.wins || t.losses) ? `<span class="pb-rec">${t.wins}-${t.losses}</span>` : "";
    return `<li class="pb-tile" draggable="true" tabindex="0" data-team="${t.id}"
        aria-label="${esc(t.name)}${t.note ? ", note: " + esc(t.note) : ""}. Press Enter to pick up.">
      <span class="pb-name">${esc(t.name)}</span>${record}
      ${t.note ? `<span class="pb-note">${esc(t.note)}</span>` : ""}
      <button class="pb-notebtn" type="button" data-note="${t.id}"
        aria-label="${t.note ? "Edit" : "Add"} note for ${esc(t.name)}">${t.note ? "✎" : "+ note"}</button>
    </li>`;
  }

  function zoneHtml(z) {
    const n = z.teams.length;
    // The size warning is advisory, never blocking: the owner's preferred range is 6-11 on grass and
    // indoors is "a lot more limited due to number of courts", so a small pool is often the only
    // option and the board must not nag about it.
    const size = n < 6 ? `<span class="pb-warn">${n} — under 6</span>`
      : n > 11 ? `<span class="pb-warn">${n} — over 11</span>`
      : `<span class="pb-ok">${n}</span>`;
    return `<div class="pb-pool" data-zone="${z.key}">
      <div class="pb-pool-head">
        <input class="pb-poolname" value="${esc(z.name)}" data-rename="${z.key}"
          aria-label="Pool name" maxlength="60" />
        ${size}
      </div>
      <ul class="pb-list" data-zone="${z.key}">${z.teams.map(tile).join("")}</ul>
    </div>`;
  }

  function render() {
    if (!board) return;
    const divs = board.divisions || [];
    $("pbBoard").innerHTML = divs.map((d) => `
      <section class="pb-div" aria-labelledby="pbd${d.id}">
        <h2 class="pb-div-h" id="pbd${d.id}">${esc(d.name)}
          ${d.court_from ? `<span class="pb-courts">courts ${d.court_from}–${d.court_to}</span>` : ""}
        </h2>
        <div class="pb-pools">
          ${zones.filter((z) => z.divisionId === d.id).map(zoneHtml).join("")}
          <button class="pb-add" type="button" data-add="${d.id}"
            aria-label="Add a pool to ${esc(d.name)} — drop a team here or press Enter">+</button>
        </div>
      </section>`).join("") +
      (zones.some((z) => z.divisionId === null) ? `
      <section class="pb-div" aria-labelledby="pbdloose">
        <h2 class="pb-div-h" id="pbdloose">Not in a division</h2>
        <div class="pb-pools">${zones.filter((z) => z.divisionId === null).map(zoneHtml).join("")}</div>
      </section>` : "");

    $("pbWork").innerHTML = workspace.map(tile).join("")
      || `<li class="pb-empty">Everyone is placed. Drag a tile back here to take them out of a pool.</li>`;
    $("pbCount").textContent = `${workspace.length} waiting`;
    $("pbSave").disabled = !dirty;
    $("pbState").textContent = dirty ? "Unsaved changes" : "Saved";
    $("pbState").className = "pb-state" + (dirty ? " dirty" : "");
    wire();
  }

  /* ---------- interaction ---------- */

  function wire() {
    document.querySelectorAll(".pb-tile").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", el.dataset.team);
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("keydown", onTileKey);
    });

    document.querySelectorAll("[data-note]").forEach((b) => {
      b.addEventListener("click", (e) => { e.stopPropagation(); editNote(Number(b.dataset.note)); });
    });

    document.querySelectorAll("[data-rename]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const z = zones.find((x) => x.key === inp.dataset.rename);
        if (z && z.name !== inp.value) { z.name = inp.value; dirty = true; render(); }
      });
    });

    // Drop targets: every pool list, the workspace, and each "+" tile.
    const drops = [
      ...document.querySelectorAll(".pb-list"),
      $("pbWork"),
      ...document.querySelectorAll(".pb-add"),
    ];
    for (const el of drops) {
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("over");
        const id = Number(e.dataTransfer.getData("text/plain"));
        if (!id) return;
        if (el.dataset.add) newPool(id, Number(el.dataset.add));
        else if (el.id === "pbWork") place(id, "workspace");
        else place(id, el.dataset.zone);
      });
    }

    document.querySelectorAll("[data-add]").forEach((b) => {
      b.addEventListener("click", () => {
        if (carrying == null) {
          $("pbHint").textContent = "Pick a team up first — focus a tile and press Enter.";
          return;
        }
        const id = carrying; carrying = null;
        newPool(id, Number(b.dataset.add));
      });
    });
  }

  /** Keyboard path. Enter picks up and drops; arrows walk the destinations; Escape cancels. */
  function onTileKey(e) {
    const el = e.currentTarget;
    const id = Number(el.dataset.team);
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (carrying == null) {
        carrying = id;
        el.classList.add("carrying");
        $("pbHint").textContent = `Holding ${findTeam(id).name}. Arrow keys choose a pool, Enter drops, Escape cancels.`;
      } else {
        const target = el.closest("[data-zone]");
        const key = target ? target.dataset.zone : "workspace";
        const held = carrying; carrying = null;
        place(held, key);
        $("pbHint").textContent = "Dropped.";
      }
      return;
    }
    if (e.key === "Escape" && carrying != null) {
      carrying = null;
      document.querySelectorAll(".carrying").forEach((x) => x.classList.remove("carrying"));
      $("pbHint").textContent = "Cancelled.";
      return;
    }
    if (carrying == null) return;
    const order = [...zones.map((z) => z.key), "workspace"];
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault(); step(order, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault(); step(order, -1);
    }
  }

  let cursor = 0;
  function step(order, by) {
    cursor = (cursor + by + order.length) % order.length;
    const key = order[cursor];
    const z = zones.find((x) => x.key === key);
    $("pbHint").textContent = `Drop into ${z ? z.name : "the workspace"}? Enter to confirm.`;
    document.querySelectorAll(".pb-pool, #pbWork").forEach((x) => x.classList.remove("target"));
    const el = key === "workspace" ? $("pbWork") : document.querySelector(`.pb-pool[data-zone="${key}"]`);
    if (el) {
      el.classList.add("target");
      // Enter on the highlighted destination is what actually drops, so it has to be reachable.
      el.scrollIntoView({ block: "nearest" });
    }
  }

  /** The note lives on the team, so it survives every drag. */
  async function editNote(teamId) {
    const t = findTeam(teamId);
    if (!t) return;
    const next = window.prompt(`Note for ${t.name} — shown on the tile:`, t.note || "");
    if (next === null) return;                       // cancelled, not cleared
    const r = await api(`/api/admin/events/${eventId}/board/note`, {
      method: "POST", body: JSON.stringify({ team_id: teamId, note: next }),
    });
    if (!r.ok) return fail("pbBoard", r.data.error || "Couldn't save that note.");
    t.note = r.data.note;                            // saved immediately; not part of the layout
    render();
  }

  /* ---------- load and save ---------- */

  async function load() {
    if (!eventId) return;
    const r = await api(`/api/admin/events/${eventId}/board`);
    if (!r.ok) return fail("pbBoard", r.data.error || "Couldn't load that board.");
    ingest(r.data);
    if (!(r.data.divisions || []).length) {
      $("pbHint").textContent = "This event has no divisions yet. Set them up on the event first — pools live inside a division.";
    }
    render();
  }

  async function save() {
    const payload = {
      pools: zones
        .filter((z) => z.teams.length)               // empty pools are not sent; the server drops them anyway
        .map((z) => ({
          id: z.poolId || undefined,
          division_id: z.divisionId || undefined,
          name: z.name,
          team_ids: z.teams.map((t) => t.id),
        })),
    };
    const r = await api(`/api/admin/events/${eventId}/board`, { method: "POST", body: JSON.stringify(payload) });
    if (!r.ok) return fail("pbBoard", r.data.error || "Couldn't save the board.");
    ingest(r.data);
    render();
    $("pbHint").textContent = r.data.note;
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return fail("pbBoard", "Couldn't load your events.");
    const list = (r.data.events || []).slice(0, 40);
    $("pbEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("pbEvent").addEventListener("change", () => {
      // Switching events with unsaved work would throw it away silently.
      if (dirty && !window.confirm("You have unsaved changes on this board. Switch event and lose them?")) {
        $("pbEvent").value = String(eventId);
        return;
      }
      eventId = Number($("pbEvent").value);
      load();
    });
    $("pbSave").addEventListener("click", save);
    $("pbReload").addEventListener("click", () => {
      if (dirty && !window.confirm("Discard unsaved changes and reload?")) return;
      load();
    });
    // The browser's own guard, for the tab-close case a page script cannot otherwise catch.
    window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    loadEvents();
  });
})();
