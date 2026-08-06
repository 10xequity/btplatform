/* Boomtown Platform — Tryout squads (admin page script)
   File: web/assets/admin-squads.js · Version: v1.0 · Date: 2026-08-06 · Ships in: v0.97.0

   Roadmap §-1b W-E.2. Five routes that were built, tested and org-scoped with NO CALLER ANYWHERE:
   `GET/POST /api/admin/tryouts/:id/squads`, `PATCH/DELETE /api/admin/squads/:id`,
   `POST /api/admin/squads/:id/assign`, `POST /api/admin/squads/:id/remove`. The engine was never
   the gap. This file is the screen.

   THREE DESIGN DECISIONS WORTH KNOWING:

   1. TWO TAPS, NO DRAGGING. Pick a player, then pick the team. The pool board drags, and drag is
      the wrong tool here: a director does this holding a phone in one hand at the side of a court.
      Drag needs press-move-release with a pointer that never leaves the target, has no keyboard
      equivalent that is not a worse second path, and — see §-1c D-6 — is how the pool board ended
      up stacking handlers on a node it never recreates.

   2. EVERY LISTENER IS DELEGATED AND ATTACHED EXACTLY ONCE, AT BOOT. `#sqUnplaced` and `#sqGrid`
      have their innerHTML replaced on every render but are themselves never recreated, so a
      listener added inside render() would accumulate for the life of the page. That is D-6
      precisely. There is no wire() in this file and there must never be one.

   3. THE SERVER OWNS "SHORT" AND "FULL". `squadNeeds()` computes shortfall/filled/target/full and
      sends them down; this file renders them and does no arithmetic of its own. A squad of 10 with
      no setter is not full, and the one place that rule lives is the server. Re-deriving it here
      would be a second definition, and the two would drift.

   Assign MOVES a player who is already placed — that is the route's behaviour, not a special case
   handled here, and the copy says so rather than pretending a move is an error.

   Click budget (req #19): placing a player is 2 taps. Moving one is 2. Removing one is 1. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let squads = [];            // from GET /squads — each already carries needs/shortfall/filled/target/full
  let totals = {};            // the event-wide aggregate GET /squads sums from the same squadNeeds()
  let unplaced = [];          // from GET /board, the ones with no squad_id
  let verdicts = new Map();   // contact_id → the director's roll-up row, so a pick is an informed one
  let picked = null;          // contact_id of the player waiting for a team
  let editing = null;         // squad id whose edit form is open

  const POS_LABEL = { S: "Setter", OH: "Outside", RS: "Opposite", MB: "Middle", L: "Libero", DS: "Def. specialist" };
  const POSITIONS = ["S", "OH", "RS", "MB", "L", "DS"];

  /* ---------- render ---------- */

  function pickedName() {
    const p = unplaced.find((q) => q.contact_id === picked);
    if (p) return p.name;
    for (const s of squads) {
      const m = s.members.find((q) => q.contact_id === picked);
      if (m) return m.name;
    }
    return null;
  }

  function status() {
    const name = pickedName();
    $("sqWrap").dataset.picking = picked ? "1" : "0";
    $("sqStatus").textContent = name
      ? `${name} is picked. Choose a team, or press Escape to put them down.`
      : "Pick a player to place.";
  }

  /** The facts that decide a placement: what they play, and what the coaches said. */
  function playerMeta(p) {
    const v = verdicts.get(p.contact_id);
    const bits = [];
    if (p.positions && p.positions.length) bits.push(p.positions.map(esc).join("/"));
    if (p.height) bits.push(esc(p.height));
    // The split is the roll-up's own sentence ("2 of 3 said offer") — the same words on both
    // screens, because it is the same fact. Never an average; see tryouts_rollup.test.mjs.
    if (v && v.split) bits.push(esc(v.split));
    return bits.join(" · ");
  }

  function renderUnplaced() {
    const q = $("sqFind").value.trim().toLowerCase();
    const list = unplaced.filter((p) => !q || String(p.name).toLowerCase().includes(q));
    $("sqUnplaced").innerHTML = list.map((p) => `
      <button type="button" class="sq-pick" data-pick="${p.contact_id}" aria-pressed="${picked === p.contact_id}">
        <span class="nm">${esc(p.name)}</span>
        <span class="sq-meta"> ${playerMeta(p)}</span>
      </button>`).join("");
    $("sqUnEmpty").hidden = unplaced.length > 0;
    $("sqUnCount").textContent = unplaced.length
      ? `${list.length} shown of ${unplaced.length} still to place`
      : "";
  }

  function needChips(s) {
    const chips = Object.entries(s.shortfall || {}).map(([pos, gap]) =>
      `<span class="sq-need">still needs <b>${gap}</b> ${esc(POS_LABEL[pos] || pos)}</span>`);
    return chips.length ? `<div class="sq-needs">${chips.join("")}</div>` : "";
  }

  function editForm(s) {
    const rows = POSITIONS.map((pos) => `
      <label class="sr-only" for="nd${s.id}${pos}">${esc(POS_LABEL[pos])} wanted</label>
      <input id="nd${s.id}${pos}" type="number" min="0" max="30" inputmode="numeric"
             data-need="${pos}" value="${Number(s.needs && s.needs[pos]) || 0}"
             aria-label="${esc(POS_LABEL[pos])} wanted" />`).join("");
    return `<form class="sq-form" data-editform="${s.id}">
      <div class="row">
        <label class="sr-only" for="nm${s.id}">Team name</label>
        <input id="nm${s.id}" data-name value="${esc(s.name)}" required />
        <label class="sr-only" for="tg${s.id}">How many players</label>
        <input id="tg${s.id}" data-target type="number" min="1" max="30" inputmode="numeric"
               value="${Number(s.target_size) || 0}" aria-label="How many players" />
      </div>
      <p class="sq-count">How many of each position this team wants</p>
      <div class="row">${rows}</div>
      <div class="row">
        <button class="btn" type="submit" style="min-height:44px">Save team</button>
        <button class="btn ghost" type="button" data-cancel="${s.id}" style="min-height:44px">Cancel</button>
        <button class="btn ghost" type="button" data-del="${s.id}" style="min-height:44px">Remove team</button>
      </div>
    </form>`;
  }

  function squadCard(s) {
    const members = s.members.length
      ? s.members.map((m) => `
          <div class="sq-mem">
            <span>${esc(m.name)}${m.position ? ` <span class="pos-tag">${esc(m.position)}</span>` : ""}</span>
            <button type="button" class="sq-off" data-off="${s.id}:${m.contact_id}"
                    aria-label="Take ${esc(m.name)} off ${esc(s.name)}">Off</button>
          </div>`).join("")
      : `<p class="sq-count">Nobody on this team yet.</p>`;

    // "Full" is stated in words as well as the dot — a state carried by colour alone is a state a
    // third of the people reading this cannot see.
    const full = s.full ? `<p class="sq-fullmark">Full</p>` : "";

    return `<section class="sq-card" data-squad="${s.id}">
      <h2>${esc(s.name)}</h2>
      <p class="sq-count"><span class="num">${s.filled}</span> of <span class="num">${s.target}</span> players
        <button type="button" class="sq-edit" data-edit="${s.id}">Edit</button></p>
      ${needChips(s)}
      ${full}
      <div class="sq-list">${members}</div>
      <button type="button" class="sq-place" data-place="${s.id}">Place here</button>
      ${editing === s.id ? editForm(s) : ""}
    </section>`;
  }

  function renderSquads() {
    $("sqGrid").innerHTML = squads.map(squadCard).join("");
    $("sqEmpty").hidden = squads.length > 0;
    const t = totals || {};
    const short = Object.entries(t.shortfall || {})
      .map(([pos, gap]) => `${gap} ${POS_LABEL[pos] || pos}`).join(", ");
    $("sqTotals").textContent = squads.length
      ? `${t.full || 0} of ${t.squads || 0} teams full · ${t.placed || 0} players placed`
        + (short ? ` · still short ${short}` : "")
      : "";
  }

  function render() {
    renderUnplaced();
    renderSquads();
    status();
  }

  /* ---------- load ---------- */

  async function load() {
    if (!eventId) return;
    // The board carries every registrant and their squad_id; /squads carries the teams and what
    // each still needs; /summary carries what the coaches said. Three reads, one screen, in
    // parallel — a placement decision needs all three and a director should not wait three times.
    const [board, sq, sum] = await Promise.all([
      api(`/api/admin/tryouts/${eventId}/board`),
      api(`/api/admin/tryouts/${eventId}/squads`),
      api(`/api/admin/tryouts/${eventId}/summary`),
    ]);
    if (!sq.ok) return fail("sqGrid", sq.data.error || "Couldn't load the teams.");
    if (!board.ok) return fail("sqUnplaced", board.data.error || "Couldn't load the players.");

    squads = sq.data.squads || [];
    totals = sq.data.totals || {};
    unplaced = (board.data.players || []).filter((p) => !p.squad_id);

    // The roll-up is the only one of the three this screen can do without. If it fails, the board
    // still places players — it just says less about them.
    verdicts = new Map();
    if (sum.ok) for (const p of sum.data.players || []) verdicts.set(p.contact_id, p);

    render();
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return BT_ADMIN.loadFail("sqGrid", r, "events");
    const list = (r.data.events || []).slice(0, 40);
    $("sqEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    // Arriving from the evaluations page carries the tryout in the URL, so the director does not
    // re-choose the event they were already looking at (req #19).
    const want = Number(new URLSearchParams(location.search).get("event")) || null;
    const found = want && list.some((e) => e.id === want) ? want : (list.length ? list[0].id : null);
    eventId = found;
    if (!eventId) return BT_ADMIN.orgEmptyState("sqGrid", "events");
    $("sqEvent").value = String(eventId);
    $("sqBack").href = `admin-tryouts.html?event=${eventId}`;
    load();
  }

  /* ---------- writes ---------- */

  async function place(squadId) {
    if (!picked) return;
    const r = await api(`/api/admin/squads/${squadId}/assign`, {
      method: "POST", body: JSON.stringify({ contact_id: picked }),
    });
    if (!r.ok) return fail("sqGrid", r.data.error || "Couldn't put that player on the team.");
    picked = null;
    load();
  }

  async function takeOff(squadId, contactId) {
    const r = await api(`/api/admin/squads/${squadId}/remove`, {
      method: "POST", body: JSON.stringify({ contact_id: contactId }),
    });
    if (!r.ok) return fail("sqGrid", r.data.error || "Couldn't take that player off.");
    load();
  }

  async function saveSquad(form, squadId) {
    const needs = {};
    form.querySelectorAll("[data-need]").forEach((i) => {
      const n = Number(i.value);
      if (Number.isInteger(n) && n > 0) needs[i.dataset.need] = n;
    });
    const r = await api(`/api/admin/squads/${squadId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.querySelector("[data-name]").value,
        target_size: Number(form.querySelector("[data-target]").value),
        needs,
      }),
    });
    if (!r.ok) return fail("sqGrid", r.data.error || "Couldn't save that team.");
    editing = null;
    load();
  }

  async function removeSquad(squadId) {
    const s = squads.find((q) => q.id === squadId);
    // A delete that releases players is not obvious from the button, so the question says what
    // actually happens rather than asking "are you sure".
    const msg = s && s.filled
      ? `Remove ${s.name}? Its ${s.filled} player${s.filled === 1 ? "" : "s"} go back to the unplaced list.`
      : `Remove ${s ? s.name : "this team"}?`;
    if (!window.confirm(msg)) return;
    const r = await api(`/api/admin/squads/${squadId}`, { method: "DELETE" });
    if (!r.ok) return fail("sqGrid", r.data.error || "Couldn't remove that team.");
    editing = null;
    load();
  }

  async function addSquad(e) {
    e.preventDefault();
    const name = $("sqNewName").value.trim();
    if (!name) return;
    const r = await api(`/api/admin/tryouts/${eventId}/squads`, {
      method: "POST",
      body: JSON.stringify({ name, target_size: Number($("sqNewTarget").value) || 10 }),
    });
    if (!r.ok) return fail("sqGrid", r.data.error || "Couldn't add that team.");
    $("sqNewName").value = "";
    load();
  }

  /* ---------- boot ----------
     EVERY listener below is attached ONCE, here, and delegates. `#sqUnplaced` and `#sqGrid` have
     their innerHTML rewritten on every render but are never themselves replaced, so attaching in
     render() would stack a new handler per render for the life of the page — §-1c D-6, the pool
     board's live defect, which this page is written to not inherit. */
  document.addEventListener("DOMContentLoaded", () => {
    $("sqEvent").addEventListener("change", () => {
      eventId = Number($("sqEvent").value);
      picked = null; editing = null;
      $("sqBack").href = `admin-tryouts.html?event=${eventId}`;
      load();
    });
    $("sqFind").addEventListener("input", renderUnplaced);

    $("sqUnplaced").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      const id = Number(b.dataset.pick);
      picked = picked === id ? null : id;   // tapping the picked player again puts them down
      renderUnplaced();
      status();
    });

    $("sqGrid").addEventListener("click", (e) => {
      const onto = e.target.closest("[data-place]");
      if (onto) return void place(Number(onto.dataset.place));

      const off = e.target.closest("[data-off]");
      if (off) {
        const [sid, cid] = off.dataset.off.split(":");
        return void takeOff(Number(sid), Number(cid));
      }

      const ed = e.target.closest("[data-edit]");
      if (ed) {
        const id = Number(ed.dataset.edit);
        editing = editing === id ? null : id;
        return void renderSquads();
      }

      const cancel = e.target.closest("[data-cancel]");
      if (cancel) { editing = null; return void renderSquads(); }

      const del = e.target.closest("[data-del]");
      if (del) return void removeSquad(Number(del.dataset.del));
    });

    $("sqGrid").addEventListener("submit", (e) => {
      const form = e.target.closest("[data-editform]");
      if (!form) return;
      e.preventDefault();
      saveSquad(form, Number(form.dataset.editform));
    });

    $("sqNewForm").addEventListener("submit", addSquad);

    // Escape puts the picked player down. A modeful interface needs a way out that is not "find
    // the thing you tapped and tap it again".
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && picked) { picked = null; renderUnplaced(); status(); }
    });

    loadEvents();
  });
})();
