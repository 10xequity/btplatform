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
  let dismissed = new Set(); // suggestion ids this director has waved away, for this event

  /* ---------- the waiting area's own view state (T2-8) ----------
     None of this is board arrangement, so none of it may mark the board dirty and none of it is
     ever sent to the server: `save()` writes `pools` and nothing else, and the workspace's order
     was never persisted in the first place. These are a director's preferences, so they live in
     localStorage and survive the next event. */
  const PB_VIEWS = ["bottom", "side"];   // the ONE list; the stylesheet and the buttons match it
  let view = "bottom";
  // WF-3 (v0.135.0): the divisions' own pivot, same discipline — one list, the owner's words.
  // Horizontal = divisions as full-width bands; vertical = divisions side by side as columns.
  // CSS-only: render() never reads divView, so no orientation can drop a division.
  const PB_DIV_VIEWS = ["horizontal", "vertical"];
  let divView = "horizontal";
  let sortKey = "board";
  let sortRev = false;
  let collapsed = false;

  /** THE ONE PLACE A SORT KEY BECOMES A VALUE (v0.144.0, K-13). Two callers read it: `sortTeams`
      orders by it, and `availableSortKeys` counts how many distinct values it yields to decide
      whether the option is worth offering at all. They must never disagree — an option a director
      is offered and the order they get from choosing it are the same judgement, so they are the
      same function. Returns null for a key it does not know, which is how both callers fail safe.

      Blank-yielding pickers return "" rather than null so the comparator has one blank test.

      Sorting by LEVEL groups teams by the label they registered with; it does not rank them. The
      labels are free text out of the registration form ("BB/A", "A/AA", "Open"), and there is no
      stored ordering for them — inventing one here would be a skill ranking nobody agreed to. What
      a director needs from this button is all the BB/A teams together, which grouping gives — and
      that is also the owner's "group" in the K-13 list, already implemented, so no second key was
      invented for it.

      NUMBER is the K-1 team number (`board_no`, derived once in divisions.js's loadBoard). It is
      the owner's "rank" per Q3's standing default AND his "registration date": board_no is rank by
      `t.id` within the event and ids are AUTOINCREMENT, so its order IS registration order. Two of
      his six words, one option — offering both would be two controls with identical output. */
  function sortPick(key) {
    // Numbers are compared as zero-padded strings so one comparator serves text and numbers alike.
    const num = (v) => (v == null || v === "" ? "" : String(v).padStart(6, "0"));
    return {
      name: (t) => String(t.name || ""),
      number: (t) => num(t.board_no),
      level: (t) => String(t.level || ""),
      division: (t) => num(t.division_rank),
      gender: (t) => String(t.gender_division || ""),
      captain: (t) => String(t.captain || ""),
      seed: (t) => num(t.seed),
    }[key] || null;
  }

  /** Order the waiting area. Pure, and deliberately closed over nothing but `sortPick` — it is the
      one piece of this file a test can execute directly, and a comparator that reaches outside
      itself cannot be reasoned about from anywhere.

      REVERSE INVERTS THE COMPARISON, NOT THE ARRAY, and that is the whole design of it. A team with
      no captain, no level or no seed sorts LAST rather than first, because a blank at the top of
      the list is the first thing read and the least useful thing to read. Reversing the array would
      throw every blank to the top the moment a director pressed the button — so descending flips
      the teams that HAVE a value and leaves the blanks where they were. */
  function sortTeams(list, key, reverse) {
    const out = list.slice();
    // The board's own order is a real ordering, so it reverses too — there is just nothing to pick.
    if (key === "board") return reverse ? out.reverse() : out;
    const pick = sortPick(key);
    if (!pick) return out;
    out.sort((a, b) => {
      const av = pick(a), bv = pick(b);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const c = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) || 0;
      return reverse ? -c : c;
    });
    return out;
  }

  /** Which sorts this board can actually offer (v0.144.0, K-13 — the owner's "where each applies").
      An option is offered only when sorting by it could separate two teams, measured with the SAME
      picker the sort uses.

      WHY THIS IS COMPUTED AND NOT A LIST. Live D1, 2026-08-13: every team in production is either
      ("Coed","BB/A") or (NULL,NULL). Gender would reorder nobody on any board that exists — and
      neither would Level, which has shipped as an always-visible option since v0.125.0. A control
      that acts on nothing is worse than one that is absent, so the rule repairs the old options at
      the same time as it adds the new ones. Division earns its place on exactly one live board,
      which is the point: it appears where it means something.

      Board order, team number and team name are unconditional. The first two can always reorder a
      list of distinct teams, and a board where every team shares a name is not a board. */
  function availableSortKeys(list) {
    const always = ["board", "number", "name"];
    const conditional = ["level", "division", "gender", "captain", "seed"];
    const teams = list || [];
    return always.concat(conditional.filter((k) => {
      const pick = sortPick(k);
      return pick && new Set(teams.map(pick)).size > 1;
    }));
  }

  /** The label a director reads for each key. Separate from `sortPick` on purpose: one is what a
      key MEANS, the other is what it is CALLED, and a rename should never be able to change a sort. */
  function sortLabel(key) {
    return {
      board: "Board order", number: "Team number", name: "Team name", level: "Level",
      division: "Division", gender: "Gender", captain: "Captain", seed: "Seed",
    }[key] || key;
  }

  /** Write the view state onto the DOM. One function so the attribute, the pressed states and the
      collapse label can never disagree about what is currently true. */
  function paintView() {
    const split = $("pbSplit");
    if (split) split.dataset.view = view;
    for (const b of document.querySelectorAll("[data-pbview]")) {
      b.setAttribute("aria-pressed", String(b.dataset.pbview === view));
    }
    const boardEl = $("pbBoard");
    if (boardEl) boardEl.dataset.divview = divView; // survives render()'s innerHTML rewrites
    for (const b of document.querySelectorAll("[data-pbdivview]")) {
      b.setAttribute("aria-pressed", String(b.dataset.pbdivview === divView));
    }
    const ws = $("pbWorkspace"), btn = $("pbCollapse");
    if (ws) ws.dataset.collapsed = collapsed ? "1" : "0";
    if (btn) {
      btn.textContent = collapsed ? "Show" : "Hide";
      btn.setAttribute("aria-expanded", String(!collapsed));
    }
    // K-13: the reverse toggle NAMES the direction it is currently in rather than showing a bare
    // arrow, because a lone ↑ leaves a director working out which way is on. "Ascending" and not
    // "A→Z": half these sorts are numbers (team number, seed, division rank) and an alphabet is a
    // lie on those. The pressed state carries the same fact for the styling and the screen reader.
    const rev = $("pbRev");
    if (rev) {
      rev.setAttribute("aria-pressed", String(sortRev));
      rev.textContent = sortRev ? "Descending" : "Ascending";
    }
  }

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
    paintSortOptions();
    renderSuggestions();
  }

  /** Rebuild the Sort menu for the board that is actually on screen (v0.144.0, K-13).
      Called from `ingest` and from NOWHERE else — deliberately not from `render()`. Two reasons:
      §-1c D-6 is that `render()` runs constantly and anything it touches accumulates, and more
      importantly a director drags teams in and out of the waiting area continuously. Recomputing
      the menu on every drag would make an option vanish under the hand that was using it. `ingest`
      runs on load and on save, which are the two moments the board's own truth changes. */
  function paintSortOptions() {
    const sel = $("pbSort");
    if (!sel) return;
    const keys = availableSortKeys(workspace);
    // A remembered key this board cannot offer falls back to the board's own order rather than
    // leaving the select showing one thing and the list sorted by another.
    if (!keys.includes(sortKey)) sortKey = "board";
    sel.innerHTML = keys.map((k) =>
      `<option value="${k}"${k === sortKey ? " selected" : ""}>${esc(sortLabel(k))}</option>`).join("");
    sel.value = sortKey;
  }

  /* ---------- suggestions ----------
     Drawn from `ingest`, and from NOWHERE else. `wire()` runs at the end of every `render()` and
     already stacks its drag handlers on #pbWork — a node that is never recreated — so wiring this
     panel there would reproduce that leak exactly. The list node is static, one delegated listener
     is attached once at startup, and this function only ever writes innerHTML.

     There is no "no suggestions" state on purpose. When the server has nothing to say the panel is
     simply absent: a first-ever event has no history, and a line explaining that would appear on
     every first event forever. */
  function renderSuggestions() {
    const panel = $("pbSug"), list = $("pbSugList");
    if (!panel || !list) return;
    const items = ((board && board.suggestions) || []).filter((s) => !dismissed.has(s.id));
    if (!items.length) { panel.hidden = true; list.innerHTML = ""; return; }
    // The server composes every sentence, numbers and all. Nothing here builds English — a client
    // that assembles its own copy is how two screens end up phrasing the same fact differently.
    list.innerHTML = items.map((s) => `<li class="pb-sug-item">
      <span class="pb-sug-text">${esc(s.text)}</span>
      <span class="pb-sug-acts">
        <button class="btn ghost" type="button" data-sugshow="${esc(s.id)}">Show me</button>
        <button class="btn ghost" type="button" data-sughide="${esc(s.id)}"
          aria-label="Dismiss this suggestion">Dismiss</button>
      </span>
    </li>`).join("");
    panel.hidden = false;
  }

  /** Ring the teams a suggestion is about. The ring clears itself — a highlight left on is a lie. */
  let hiTimer = null;
  function highlight(id) {
    const s = ((board && board.suggestions) || []).find((x) => x.id === id);
    if (!s) return;
    document.querySelectorAll(".pb-tile.pb-hi").forEach((el) => el.classList.remove("pb-hi"));
    if (hiTimer) clearTimeout(hiTimer);
    let first = null;
    for (const teamId of s.team_ids || []) {
      const el = document.querySelector(`.pb-tile[data-team="${teamId}"]`);
      if (!el) continue;
      el.classList.add("pb-hi");
      if (!first) first = el;
    }
    if (first) first.scrollIntoView({ block: "nearest", behavior: "smooth" });
    $("pbHint").textContent = first
      ? `Highlighted ${(s.team_ids || []).length} team${(s.team_ids || []).length === 1 ? "" : "s"}. Drag one wherever you want it.`
      : "Those teams are not on the board right now.";
    hiTimer = setTimeout(() => {
      document.querySelectorAll(".pb-tile.pb-hi").forEach((el) => el.classList.remove("pb-hi"));
    }, 4000);
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
    // The number leads the name, because that is the order a director reads it in: number off the
    // sheet, name to confirm. It is the team's registration rank, computed server-side, and it is
    // stable across saves and withdrawals — see loadBoard's note on why seed and board_order are
    // both the wrong number for this job.
    const num = t.board_no ? `<span class="pb-num">${esc(String(t.board_no))}</span>` : "";
    // Level and captain share a row: together they are "who is this", where the note below is
    // "what to remember". The accessible name appends both rather than prefixing them, because
    // the team name has to stay the first thing a screen reader says.
    const meta = (t.level || t.captain) ? `<span class="pb-meta">
        ${t.level ? `<span class="pb-level">${esc(t.level)}</span>` : ""}
        ${t.captain ? `<span class="pb-cap">${esc(t.captain)}</span>` : ""}
      </span>` : "";
    return `<li class="pb-tile" draggable="true" tabindex="0" data-team="${t.id}"
        aria-label="${esc(t.name)}${t.board_no ? ", team " + esc(String(t.board_no)) : ""}${t.level ? ", level " + esc(t.level) : ""}${t.captain ? ", captain " + esc(t.captain) : ""}${t.note ? ", note: " + esc(t.note) : ""}. Press Enter to pick up.">
      <span class="pb-name">${num}${esc(t.name)}</span>${record}
      ${meta}
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

    // Sorted for DISPLAY only. `workspace` keeps the server's order, so switching back to "Board
    // order" is a real return rather than an approximation of one.
    $("pbWork").innerHTML = sortTeams(workspace, sortKey, sortRev).map(tile).join("")
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
    if (!r.ok) return BT_ADMIN.loadFail("pbBoard", r, "events"); // v0.89.0 Block B4: a 403 names the org, not the module
    const list = (r.data.events || []).slice(0, 40);
    $("pbEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    // WF-5 H-1 (v0.139.0): the manager hub points this page at ONE event via ?event=N. ADDITIVE
    // on purpose — with no ?event= the page behaves exactly as it did from the rail, which is what
    // makes the hub reversible and what lets this page keep its own way in. An id that is not in
    // this org's list is ignored rather than forced: the picker is the org's own truth.
    const fromUrl = Number(new URLSearchParams(location.search).get("event")) || 0;
    eventId = list.length ? list[0].id : null;
    if (fromUrl && list.some((e) => e.id === fromUrl)) eventId = fromUrl;
    if (!eventId) return BT_ADMIN.orgEmptyState("pbBoard", "events"); // v0.89.0 Block B3: an empty org is not a broken module
    $("pbEvent").value = String(eventId);
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
      dismissed = new Set();          // a different event's suggestions were never waved away
      load();
    });
    // ONE delegated listener, on the static list node, attached once. Every re-render replaces the
    // buttons inside it and this keeps working.
    $("pbSugList").addEventListener("click", (e) => {
      const show = e.target.closest("[data-sugshow]");
      if (show) return highlight(show.dataset.sugshow);
      const hide = e.target.closest("[data-sughide]");
      if (!hide) return;
      dismissed.add(hide.dataset.sughide);
      renderSuggestions();
    });
    /* The waiting area's controls (T2-8). Wired HERE, at boot, and never inside wire() — wire()
       runs at the end of every render and stacks handlers on nodes it does not recreate (§-1c
       D-6), so a listener added there would fire once per render by the twentieth drag. These four
       nodes are static markup, so one listener each is correct and sufficient. */
    try {
      const savedView = localStorage.getItem("bt_pb_view");
      if (PB_VIEWS.includes(savedView)) view = savedView;
      const savedDivView = localStorage.getItem("bt_pb_divview");
      if (PB_DIV_VIEWS.includes(savedDivView)) divView = savedDivView; // validated — a poisoned value never becomes the layout
      // The saved key is remembered but NOT applied here — paintSortOptions() decides whether this
      // board can offer it, because bt_pb_sort crosses events. A director who sorted by Division on
      // a board that has three of them and opens one that has none must not land on a selection the
      // select cannot show.
      const savedSort = localStorage.getItem("bt_pb_sort");
      if (savedSort) sortKey = savedSort;
      sortRev = localStorage.getItem("bt_pb_rev") === "1";
    } catch (e) { /* a browser with storage denied still gets a working board */ }
    paintView();

    $("pbSort").addEventListener("change", () => {
      // A view change, not an arrangement change: it must not mark the board unsaved, because the
      // workspace's order is not part of what Save writes.
      sortKey = $("pbSort").value;
      try { localStorage.setItem("bt_pb_sort", sortKey); } catch (e) {}
      render();
    });
    $("pbRev").addEventListener("click", () => {
      sortRev = !sortRev;
      try { localStorage.setItem("bt_pb_rev", sortRev ? "1" : "0"); } catch (e) {}
      paintView();
      render();
    });
    for (const b of document.querySelectorAll("[data-pbview]")) {
      b.addEventListener("click", () => {
        view = b.dataset.pbview;
        try { localStorage.setItem("bt_pb_view", view); } catch (e) {}
        paintView();
      });
    }
    // WF-3: static markup, so boot wiring is correct and sufficient — like the pbview pair above.
    for (const b of document.querySelectorAll("[data-pbdivview]")) {
      b.addEventListener("click", () => {
        divView = b.dataset.pbdivview;
        try { localStorage.setItem("bt_pb_divview", divView); } catch (e) {}
        paintView();
      });
    }
    $("pbCollapse").addEventListener("click", () => { collapsed = !collapsed; paintView(); });

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
