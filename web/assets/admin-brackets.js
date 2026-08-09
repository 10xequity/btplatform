/* Boomtown Platform — Brackets (admin page script)
   File: web/assets/admin-brackets.js · Version: v2.1 · Date: 2026-08-05 · Ships in: v0.91.0

   v2.1 (Block E1, audit §6.1): the chooser can no longer read as frozen. The filter used to hide
   every non-matching <li> with NO empty state, so a typo emptied the dialog completely and the
   tester report called it hung ("adfaf"). A miss now says so and how to recover, and clicking the
   backdrop closes the dialog (Escape and the Close button always did).

   The bracket is drawn as one column per round, earliest on the left, so it reads the way a bracket
   on a gym wall reads.

   v2.0 — THE SEEDING IS A STARTING POINT, NOT AN ANSWER. Owner 2026-08-03: "brackets should auto
   populate but can be overrided with drag and drop or type entry ... teams might forfeit so we can
   replace them in the bracket ... The assignment of bracket will be dependent on the admin running
   it, and reviewing the scores of the game. many people quit at this point too, so we want to have
   flexibility to modify."

   So every slot takes any team in the event: drag one off the bench, or pick it from a list. The
   bench shows the POOL each team came out of and where they finished, because when three teams have
   gone home the only question that matters is who is available and how they did.

   ONE WARNING IS LOAD-BEARING. Advancement is recomputed from scores, so a team placed by hand into
   a slot whose feeding game has not been played yet WILL be replaced by that game's winner. The
   server says so and this page repeats it, because a change that silently reverts itself looks like
   the software losing your work. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let data = null;
  let picking = null;        // { matchId, side } while the chooser is open

  /* ---------- render ---------- */

  // Pool, finish and captain on one line. The captain is here for the same reason the pool is: when
  // a slot has to be filled or a team chased down, the name of the person to find is the answer.
  const origin = (pool, rank, captain) => {
    const bits = [];
    if (pool) bits.push(pool);
    if (rank) bits.push(`${rank}${ord(rank)}`);
    if (captain) bits.push(captain);
    return bits.length ? `<span class="br-from">${esc(bits.join(" · "))}</span>` : "";
  };
  const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");

  function side(mt, which) {
    const name = which === "a" ? mt.team_a : mt.team_b;
    const id = which === "a" ? mt.team_a_id : mt.team_b_id;
    const waiting = which === "a" ? mt.waiting_a : mt.waiting_b;
    const score = which === "a" ? mt.score_a : mt.score_b;
    const won = mt.winner && mt.winner === name;
    const pool = which === "a" ? mt.pool_a : mt.pool_b;
    const rank = which === "a" ? mt.rank_a : mt.rank_b;
    const cap = which === "a" ? mt.captain_a : mt.captain_b;
    return `<button class="br-side${won ? " won" : ""}${name ? "" : " tbd"}"
        type="button" data-slot="${mt.id}:${which}"
        aria-label="${name ? esc(name) : esc(waiting || "empty")}. Choose a different team for this slot."
        ${id ? `draggable="true" data-drag="${id}"` : ""}>
      <span class="br-line">
        <span class="br-name">${name ? esc(name) : esc(waiting || "To be decided")}</span>
        <span class="br-score">${score === null || score === undefined ? "" : score}</span>
      </span>
      ${origin(pool, rank, cap)}
    </button>`;
  }

  function matchCard(mt) {
    const done = !!mt.winner;
    return `<li class="br-match"${done ? ' data-done="1"' : ""} data-match="${mt.id}">
      <span class="br-court">Ct ${mt.court}</span>
      ${side(mt, "a")}
      ${side(mt, "b")}
      ${!done && mt.team_a_id && mt.team_b_id ? `<span class="br-ff">
        <button class="br-ffbtn" type="button" data-ff="${mt.id}:a" aria-label="${esc(mt.team_a)} forfeited">${esc(mt.team_a)} forfeits</button>
        <button class="br-ffbtn" type="button" data-ff="${mt.id}:b" aria-label="${esc(mt.team_b)} forfeited">${esc(mt.team_b)} forfeits</button>
      </span>` : ""}
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

  function benchHtml() {
    const list = (data && data.bench) || [];
    if (!list.length) return `<li class="br-empty">No teams on this event yet.</li>`;
    return list.map((t) => `<li>
      <button class="br-bench-tile${t.in_bracket ? " used" : ""}" type="button"
          draggable="true" data-drag="${t.id}"
          aria-label="${esc(t.name)}${t.pool ? ", " + esc(t.pool) : ""}${t.rank ? ", finished " + t.rank + ord(t.rank) : ""}${t.captain ? ", captain " + esc(t.captain) : ""}${t.in_bracket ? ", already in the bracket" : ""}">
        <span class="br-name">${esc(t.name)}</span>
        <span class="br-from">${esc([t.pool, t.rank ? `${t.rank}${ord(t.rank)}` : null, `${t.wins}-${t.losses}`, t.captain].filter(Boolean).join(" · "))}</span>
        ${t.in_bracket ? `<span class="br-used">in bracket</span>` : ""}
      </button>
    </li>`).join("");
  }

  function render() {
    const list = (data && data.brackets) || [];
    $("bEmpty").hidden = list.length > 0;
    $("bTrees").innerHTML = list.map(treeHtml).join("");
    $("bBench").innerHTML = benchHtml();
    wire();
  }

  /* ---------- editing a slot ---------- */

  async function setSlot(matchId, sideKey, teamId) {
    const r = await api(`/api/admin/events/${eventId}/brackets/slot`, {
      method: "POST",
      body: JSON.stringify({ match_id: Number(matchId), side: sideKey, team_id: teamId }),
    });
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't change that slot.");
    data = r.data;
    render();
    $("bNote").textContent = r.data.note;
  }

  async function forfeit(matchId, sideKey) {
    const mt = allMatches().find((m) => m.id === Number(matchId));
    const who = sideKey === "a" ? mt.team_a : mt.team_b;
    if (!window.confirm(`Record ${who} as forfeiting? The other team is credited with the win and moves on.`)) return;
    const r = await api(`/api/admin/events/${eventId}/brackets/forfeit`, {
      method: "POST", body: JSON.stringify({ match_id: Number(matchId), side: sideKey }),
    });
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't record that forfeit.");
    data = r.data;
    render();
    $("bNote").textContent = r.data.note;
  }

  const allMatches = () => ((data && data.brackets) || []).flatMap((b) => b.rounds).flatMap((r) => r.matches);

  /** The type-entry path the owner asked for, alongside dragging. */
  function openChooser(matchId, sideKey) {
    picking = { matchId, side: sideKey };
    const list = (data.bench || []);
    $("bPickList").innerHTML = list.map((t) => `<li>
      <button class="btn ghost" type="button" data-pick="${t.id}">
        ${esc(t.name)} <span class="br-from">${esc([t.pool, t.rank ? `${t.rank}${ord(t.rank)}` : null, t.captain].filter(Boolean).join(" · "))}</span>
      </button></li>`).join("") +
      `<li><button class="btn ghost" type="button" data-pick="">Leave empty</button></li>` +
      `<li id="bPickNone" class="help-text" style="padding:10px 4px" hidden></li>`;
    $("bPick").hidden = false;
    $("bPickFilter").value = "";
    $("bPickFilter").focus();
    $("bPick").querySelectorAll("[data-pick]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.pick === "" ? null : Number(b.dataset.pick);
        closeChooser();
        setSlot(matchId, sideKey, id);
      });
    });
  }

  function closeChooser() { picking = null; $("bPick").hidden = true; }

  function wire() {
    document.querySelectorAll("[data-slot]").forEach((el) => {
      el.addEventListener("click", () => {
        const [id, s] = el.dataset.slot.split(":");
        openChooser(id, s);
      });
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
      el.addEventListener("dragleave", () => el.classList.remove("over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("over");
        const teamId = Number(e.dataTransfer.getData("text/plain"));
        if (!teamId) return;
        const [id, s] = el.dataset.slot.split(":");
        setSlot(id, s, teamId);
      });
    });

    document.querySelectorAll("[data-drag]").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", el.dataset.drag);
        e.dataTransfer.effectAllowed = "copy";
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => el.classList.remove("dragging"));
    });

    document.querySelectorAll("[data-ff]").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const [id, s] = b.dataset.ff.split(":");
        forfeit(id, s);
      });
    });
  }

  /* ---------- load / generate / advance ---------- */

  async function load() {
    if (!eventId) return;
    const r = await api(`/api/admin/events/${eventId}/brackets`);
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't load that bracket.");
    data = r.data;
    render();
  }

  /* WHAT FITS IN THE TIME WE HAVE LEFT — v0.108.0.

     Owner, 2026-08-08: the end-of-league tournament "changes based on participants and timeframe
     available", and the goal is "to get everyone sufficient games (so we can double games in pool
     play if needbe)". So this line is not a validation message and never blocks the button: a
     director is allowed to draw a bracket that overruns, because they are the one who knows whether
     the gym will be handed back on time. It is a number offered before the decision, not after it.

     THE ARITHMETIC IS THE SERVER'S, DELIBERATELY. Doing it here would be a second implementation of
     "how many rounds is this", and it would agree with the real draw right up until it didn't.
     /brackets/preview runs the same planner and the same allocator the draw runs and writes nothing.

     No animation on this line. It updates on every keystroke, which is exactly the frequency at
     which motion turns into noise. */
  let fitSeq = 0, fitTimer = null;

  function bodyFromControls() {
    return {
      a_size: Number($("bASize").value) || undefined,
      include_rest: $("bRest").checked,
      points_to: Number($("bPoints").value) || undefined,
      courts: Number($("bCourts").value) || undefined,
      best_of: $("bBo3").checked ? 3 : 1,
    };
  }

  async function estimate() {
    if (!eventId) return;
    const slot = Number($("bSlot").value) || undefined;
    const have = Number($("bHave").value) || undefined;
    // A stale response must never overwrite a fresher one — the requests are debounced, not serial.
    const seq = ++fitSeq;
    const r = await api(`/api/admin/events/${eventId}/brackets/preview`, {
      method: "POST",
      body: JSON.stringify({ ...bodyFromControls(), slot_minutes: slot, minutes_available: have }),
    });
    if (seq !== fitSeq) return;

    if (!r.ok) { $("bFit").textContent = r.data.error || ""; return; }
    const d = r.data;
    /* GAMES PER TEAM LEADS. Owner, 2026-08-08: "do not use time as the core unit of measure." The
       clock is still shown — the day has to end — but it comes after the number the decision is
       actually made on, and it is never the verdict. */
    /* Both ends of the band, because the owner's rule has two: a floor of 8 games and a ceiling of
       16 ("more than 16 become physically unplayable"). Showing only the guaranteed number hides
       the team that goes all the way, which is the team the ceiling is about. */
    const bits = [
      `${d.guaranteed_games}–${d.max_games} games each (floor ${d.target_games}, ceiling ${d.max_games_ceiling})`,
      `${d.pool_games_per_team.min} from pool`,
      `${d.teams} teams · ${d.games} bracket game${d.games === 1 ? "" : "s"} · ${d.waves} round${d.waves === 1 ? "" : "s"} on ${d.courts} court${d.courts === 1 ? "" : "s"}`,
    ];
    // Derived from the template (20 min a match, 23.75 for a best-of-3), not from a typed guess.
    if (d.estimated_minutes) bits.push(`about ${Math.round(d.estimated_minutes)} min of bracket`);
    if (d.needs_minutes && d.minutes_available) bits.push(`window ${d.minutes_available} min`);
    $("bFit").textContent = bits.join(" · ") + (d.suggestion ? " — " + d.suggestion : ".");
    $("bFit").dataset.short = d.meets_minimum ? "" : "1";
    $("bSeedWarn").textContent = d.seed_warning || "";
  }

  const scheduleEstimate = () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(estimate, 250);
  };

  async function generate() {
    const body = {
      ...bodyFromControls(),
      slot_minutes: Number($("bSlot").value) || undefined,
    };
    let r = await api(`/api/admin/events/${eventId}/brackets`, { method: "POST", body: JSON.stringify(body) });
    if (r.status === 409 && r.data.existing_matches) {
      if (!window.confirm(`${r.data.error}\n\nReplace it? The current bracket is kept and can be restored.`)) return;
      r = await api(`/api/admin/events/${eventId}/brackets`, {
        method: "POST", body: JSON.stringify({ ...body, replace: true }),
      });
    }
    if (!r.ok) return fail("bTrees", r.data.error || "Couldn't generate that bracket.");
    $("bNote").textContent = r.data.summary.join(" · ") + " Drag from the bench to change any slot.";
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
    if (!r.ok) return BT_ADMIN.loadFail("bTrees", r, "events"); // v0.89.0 Block B4: a 403 names the org, not the module
    const list = (r.data.events || []).slice(0, 40);
    $("bEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    if (!eventId) return BT_ADMIN.orgEmptyState("bTrees", "events"); // v0.89.0 Block B3: an empty org is not a broken module
    load();
    estimate();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("bEvent").addEventListener("change", () => { eventId = Number($("bEvent").value); load(); estimate(); });
    // Every control that changes the shape of the draw also changes how long it takes.
    ["bASize", "bPoints", "bCourts", "bSlot", "bHave"].forEach((id) =>
      $(id).addEventListener("input", scheduleEstimate));
    $("bRest").addEventListener("change", scheduleEstimate);
    $("bBo3").addEventListener("change", scheduleEstimate);
    $("bReload").addEventListener("click", load);
    $("bGen").addEventListener("click", generate);
    $("bAdvance").addEventListener("click", advance);
    $("bPickClose").addEventListener("click", closeChooser);
    // E1: clicking the backdrop closes, same as Escape — but a click INSIDE the panel never does.
    $("bPick").addEventListener("click", (e) => { if (e.target === $("bPick")) closeChooser(); });
    $("bPickFilter").addEventListener("input", () => {
      const q = $("bPickFilter").value.toLowerCase();
      let shown = 0;
      $("bPickList").querySelectorAll("li:not(#bPickNone)").forEach((li) => {
        const hit = !q || li.textContent.toLowerCase().includes(q);
        li.hidden = !hit;
        if (hit) shown++;
      });
      // E1: a filter that hides everything must say so — an empty dialog reads as a hung one.
      const none = $("bPickNone");
      if (none) {
        none.textContent = `No teams match “${$("bPickFilter").value.trim()}”. Clear the search to see everyone.`;
        none.hidden = shown > 0;
      }
    });
    // Escape closes the chooser — a dialog with no keyboard exit is a trap.
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && picking) closeChooser(); });
    loadEvents();
  });
})();
