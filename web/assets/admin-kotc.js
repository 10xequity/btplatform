/* Boomtown Platform — Court board (admin page script)
   File: web/assets/admin-kotc.js · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.86.0

   Screen (a) of King/Queen of the Court. Nets down the page, a person on each seat, drag to re-seat.

   ── THE SERVER OWNS THE BOARD, AND THAT IS THE WHOLE DESIGN ──
   Every move POSTs and the response IS the next board — `boardPayload`, the same object the GET
   returns. This page never patches its own copy and never works out what a move did. The player link
   (kotc.html) is built the same way for the same reason: two things deciding the same state
   independently is two chances to show the wrong one, and the one that is wrong is always the one
   somebody is looking at.

   That also means the pool board's model does NOT apply here even though the drag mechanics come from
   it. `admin-pool-board.js` is local-then-Save, because arranging pools before a tournament is a draft.
   This is a live Tuesday: the person is standing on the court now, and a board that needed saving would
   be a board that gets left unsaved.

   ── WHAT THE SERVER GUARANTEES, so this page does not re-implement it ──
     · A move is never refused. Dropping on somebody SWAPS the two, so the board cannot lose a person.
     · A game that already has a score is NEVER re-paired. The evening that happened stays happened.
       Nothing on this screen would look wrong if that broke, which is why it is asserted server-side
       with a negative control rather than trusted here.
     · Names are full names because this is staff-only. The public standings page abbreviates, and that
       trim happens on the server — never by this page choosing to render less.

   ── CLICKS, COUNTED (owner req #19) ──
     Seeing tonight's board: ZERO. The newest session loads itself; the picker is for the other nights.
     Moving a player: one drag. Keyboard: focus, Enter, arrows, Enter.
     Starting the next round: one tap.

   ── DELIBERATELY NOT BUILT ──
   There is no "take someone off the board" control. You free a seat by dragging a benched player onto
   it, which is the same gesture and one the server already supports. Withdrawing somebody for the night
   is a different operation (`kotc_players.withdrawn_at`) with no route yet, and inventing a client-side
   half of it would leave a person with a net and no standing. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let sessionId = null;
  let data = null;         // the server's last word — the only board there is
  let carrying = null;     // contact id picked up by keyboard
  let cursor = 0;          // which drop target the keyboard is pointing at
  let landed = null;       // contact id to flash once, so a move is visible without a sentence

  /* ---------- render ---------- */

  const netsNow = () => {
    if (!data || !data.rounds || !data.rounds.length) return [];
    const r = data.rounds[data.rounds.length - 1];
    return r ? r.nets : [];
  };

  /** Seat indices a net is missing, so a freed seat is a real drop target rather than a gap. */
  function gaps(net) {
    const taken = new Set(net.players.map((p) => p.seat));
    // Four is the normal net; five happens when the numbers do not divide (spec §6, owner). A net
    // showing five keeps five slots, so re-seating one does not silently offer to make it six.
    const size = Math.max(4, net.players.length);
    const out = [];
    for (let s = 0; s < size; s++) if (!taken.has(s)) out.push(s);
    return out;
  }

  const tick = (state) =>
    state === "confirmed" ? '<span class="kb-tick yes" title="Checked their net">✓</span>'
      : state === "disputed" ? '<span class="kb-tick no" title="Said the scores were wrong">!</span>'
      : '<span class="kb-tick" title="Has not checked yet">·</span>';

  function seatHtml(net, p) {
    return `<li class="kb-seat${landed === p.contact_id ? " kb-landed" : ""}" draggable="true" tabindex="0"
        data-net="${net.net_no}" data-seat="${p.seat}" data-contact="${p.contact_id}"
        aria-label="${esc(p.name)}, net ${net.net_no} seat ${p.seat + 1}. Press Enter to pick up.">
      <span class="kb-no">${p.seat + 1}</span>
      <span class="kb-who">${esc(p.name)}</span>${tick(p.confirmed)}
    </li>`;
  }

  const emptyHtml = (net, seat) =>
    `<li class="kb-empty" tabindex="0" data-net="${net.net_no}" data-seat="${seat}"
        aria-label="Empty seat ${seat + 1} on net ${net.net_no}. Drop somebody here.">Empty seat</li>`;

  function netHtml(net) {
    const games = net.games.map((g) => {
      const has = g.score_a !== null && g.score_b !== null;
      return `<div class="kb-game"><span>Game ${g.game_no}</span>
        <span class="kb-sc${has ? "" : " none"}">${has ? `${g.score_a}–${g.score_b}` : "not in yet"}</span></div>`;
    }).join("");

    const state = net.complete ? '<span class="kb-chip done">all scores in</span>'
      : net.disputed ? `<span class="kb-chip warn">${net.disputed} disputed</span>`
      : `<span class="kb-chip">${net.checked} of ${net.players.length} checked</span>`;

    const seats = net.players.slice().sort((a, b) => a.seat - b.seat).map((p) => seatHtml(net, p)).join("")
      + gaps(net).map((s) => emptyHtml(net, s)).join("");

    return `<div class="kb-net" data-netbox="${net.net_no}">
      <div class="kb-net-head">
        <h2 class="kb-net-h">Net ${net.net_no}${net.net_no === 1 ? '<span class="kb-top">top net</span>' : ""}</h2>
        ${state}
      </div>
      <ul class="kb-seats">${seats}</ul>
      <div class="kb-games">${games || '<div class="kb-game"><span>No games yet</span></div>'}</div>
    </div>`;
  }

  function leaderboardHtml() {
    const rows = (data.leaderboard || []);
    if (!rows.length) return `<p class="muted">Nothing to rank yet — the first scores will fill this in.</p>`;
    return `<table><thead><tr>
        <th>#</th><th>Player</th><th class="num">Pts</th><th class="num">Diff</th><th class="num">W–L</th><th class="num">Games</th>
      </tr></thead><tbody>${rows.map((r) => `<tr>
        <td class="num">${r.place}</td>
        <td class="${r.place === 1 ? "lead" : ""}">${esc(r.name)}</td>
        <td class="num">${r.points}</td>
        <td class="num">${r.point_diff > 0 ? "+" : ""}${r.point_diff}</td>
        <td class="num">${r.wins}–${r.losses}</td>
        <td class="num">${r.games}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  function render() {
    if (!data) return;
    const nets = netsNow();

    $("kbRoundStrip").innerHTML = data.current_round
      ? `<span class="kb-chip now">Round ${data.current_round}</span>` +
        `<span class="kb-chip">${nets.length} net${nets.length === 1 ? "" : "s"}</span>` +
        `<span class="kb-chip">first to ${data.session ? data.session.points_to : 21}</span>` +
        (data.session && data.session.move_up ? `<span class="kb-chip">${data.session.move_up} up, ${data.session.move_up} down</span>` : "")
      : `<span class="kb-chip warn">No round yet</span>`;

    $("kbNets").innerHTML = nets.length
      ? nets.map(netHtml).join("")
      : `<p class="muted">No round has been dealt for this session. Press <b>Next round</b> to seat the nets from the entry list.</p>`;

    const bench = data.bench || [];
    $("kbBench").innerHTML = bench.length
      ? bench.map((p) => `<li class="kb-seat${landed === p.contact_id ? " kb-landed" : ""}" draggable="true" tabindex="0"
            data-contact="${p.contact_id}" data-bench="1"
            aria-label="${esc(p.name)}, not on a net. Press Enter to pick up.">
          <span class="kb-who">${esc(p.name)}</span>
        </li>`).join("")
      : `<li class="kb-empty" style="cursor:default">Everybody entered is on a net.</li>`;
    $("kbBenchCount").textContent = bench.length ? `${bench.length} waiting` : "";

    $("kbLb").innerHTML = leaderboardHtml();
    landed = null;           // flash once, not on every later render
    wire();
  }

  /* ---------- interaction ---------- */

  /** Every place a person can be dropped, in the order the arrow keys walk them. */
  const targets = () => [...document.querySelectorAll("[data-net][data-seat]")];

  function wire() {
    document.querySelectorAll("[data-contact]").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", el.dataset.contact);
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
      el.addEventListener("keydown", onKey);
    });

    for (const el of targets()) {
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("over");
        const id = Number(e.dataTransfer.getData("text/plain"));
        if (id) moveTo(id, Number(el.dataset.net), Number(el.dataset.seat));
      });
    }
  }

  /* HTML5 drag-and-drop cannot be driven from a keyboard, so the same operation is a second path to
     the SAME mover — never a second implementation of it. Enter picks up, arrows choose, Enter drops,
     Escape cancels. Standards §5: keyboard parity is not optional. */
  function onKey(e) {
    const el = e.currentTarget;
    const id = Number(el.dataset.contact);

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (carrying == null) {
        carrying = id;
        el.classList.add("carrying");
        cursor = Math.max(0, targets().findIndex((t) => Number(t.dataset.contact) === id));
        $("kbHint").textContent = `Holding ${nameOf(id)}. Arrow keys choose a seat, Enter drops, Escape cancels.`;
      } else {
        const t = el.closest("[data-net][data-seat]") || targets()[cursor];
        const held = carrying;
        carrying = null;
        if (t) moveTo(held, Number(t.dataset.net), Number(t.dataset.seat));
      }
      return;
    }

    if (e.key === "Escape" && carrying != null) {
      carrying = null;
      document.querySelectorAll(".carrying").forEach((x) => x.classList.remove("carrying"));
      $("kbHint").textContent = "Cancelled — nobody moved.";
      return;
    }

    if (carrying == null) return;
    if (["ArrowRight", "ArrowDown"].includes(e.key)) { e.preventDefault(); step(1); }
    else if (["ArrowLeft", "ArrowUp"].includes(e.key)) { e.preventDefault(); step(-1); }
  }

  function step(by) {
    const all = targets();
    if (!all.length) return;
    cursor = (cursor + by + all.length) % all.length;
    const t = all[cursor];
    document.querySelectorAll(".kb-net.target, .over").forEach((x) => x.classList.remove("target", "over"));
    t.classList.add("over");
    const box = t.closest("[data-netbox]");
    if (box) box.classList.add("target");
    const who = t.dataset.contact ? nameOf(Number(t.dataset.contact)) : null;
    $("kbHint").textContent = who
      ? `Swap with ${who} on net ${t.dataset.net}? Enter to confirm.`
      : `Drop into net ${t.dataset.net}, seat ${Number(t.dataset.seat) + 1}? Enter to confirm.`;
    // Enter on the highlighted seat is what drops, so it has to be on screen.
    t.scrollIntoView({ block: "nearest" });
    t.focus({ preventScroll: true });
  }

  function nameOf(contactId) {
    for (const n of netsNow()) {
      const p = n.players.find((y) => y.contact_id === contactId);
      if (p) return p.name;
    }
    const b = (data.bench || []).find((y) => y.contact_id === contactId);
    return b ? b.name : "them";
  }

  /** The one mover. Both the drag path and the keyboard path end up here. */
  async function moveTo(contactId, netNo, seat) {
    if (!sessionId) return;
    const r = await api(`/api/admin/kotc/${sessionId}/move`, {
      method: "POST",
      body: JSON.stringify({ contact_id: contactId, net_no: netNo, seat }),
    });
    if (!r.ok) return fail("kbNets", (r.data && r.data.error) || "Couldn't move them just now.");
    landed = contactId;
    data = r.data;                        // the response IS the next board
    render();
    // The server says what the move cost — including what it deliberately left alone.
    $("kbHint").textContent = r.data.note || "Moved.";
  }

  /* ---------- load ---------- */

  async function load() {
    if (!sessionId) return;
    const r = await api(`/api/admin/kotc/${sessionId}`);
    if (!r.ok) return fail("kbNets", (r.data && r.data.error) || "Couldn't load that board.");
    data = r.data;
    render();
  }

  async function nextRound() {
    if (!sessionId) return;
    const r = await api(`/api/admin/kotc/${sessionId}/round`, { method: "POST" });
    if (!r.ok) return fail("kbNets", (r.data && r.data.error) || "Couldn't start the next round.");
    await load();
    $("kbHint").textContent = `Round ${r.data.round_no} is seated.`;
  }

  async function loadSessions() {
    const r = await api("/api/admin/kotc");
    if (!r.ok) return fail("kbNets", "Couldn't load your sessions.");
    const list = r.data.sessions || [];
    $("kbSession").innerHTML = list.length
      ? list.map((s) => `<option value="${s.id}">${esc(s.name)} — ${esc(s.event)} (${s.players} player${s.players === 1 ? "" : "s"})</option>`).join("")
      : `<option value="">No sessions yet</option>`;
    if (!list.length) {
      $("kbNets").innerHTML = `<p class="muted">No King of the Court session has been set up yet. Create one on the event, add the entry list, then come back here to seat the nets.</p>`;
      return;
    }
    // Newest first from the server, so the night in progress is already chosen: zero taps to see it.
    sessionId = list[0].id;
    load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("kbSession").addEventListener("change", () => {
      sessionId = Number($("kbSession").value) || null;
      load();
    });
    $("kbRound").addEventListener("click", nextRound);
    $("kbReload").addEventListener("click", load);
    loadSessions();
  });
})();
