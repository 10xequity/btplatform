/* Boomtown Platform — King / Queen of the Court, the player's link
   File: web/assets/kotc.js · Version: v1.0 · Date: 2026-08-04 · Ships in: v0.85.0
   Link: kotc.html?t=TOKEN — the token IS the credential, there is no sign-in (kotcplay.js v1.0).

   ══════════════════════════════════════════════════════════════════════════════════════════════
   THIS PAGE DOES NOT DECIDE WHAT IT IS.

   `/api/kotc/:token` returns `mode` — "enter", "confirm" or "done" — computed in one place,
   `playerView` in kotcplay.js, from the one question that settles it: has anybody entered anything
   for this net yet? This file reads that field and renders it. It never inspects the scores and
   works the answer out again, because two screens deciding the same question independently is two
   chances to show the wrong one, and the wrong one here means a player overwriting a scoreline they
   were supposed to be checking.

   Every POST response also spreads a fresh `playerView`, so the screen after an action is the
   SERVER's next screen, not this file's guess at it. There is no client-side state machine to drift.

   `editing` below is the one local flag, and it is deliberately NOT a mode: it is whether the edit
   form is open inside confirm mode, which is a UI affordance the server has no opinion about.
   `kotc_screen.test.mjs` asserts this file contains no mode derivation and no mode assignment, with
   a negative control that puts one back and proves the guard fires.
   ══════════════════════════════════════════════════════════════════════════════════════════════

   Click budget (owner requirement #19, counted): confirming what somebody else typed is ONE tap.
   Entering a whole net is type-then-save. A player who only remembers their own points total types
   ONE number and the v0.79.0 solver derives the rest of the net — it never guesses, and a game it
   cannot pin comes back named as still needing a score. */

(function () {
  const API = (window.BT_CONFIG || {}).apiBase;
  const app = document.getElementById("kotcApp");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  if (!API || API.includes("PENDING")) {
    app.innerHTML = "<div class='card'><h1>One moment</h1><p>Settings still loading — pull down to refresh.</p></div>";
    return;
  }
  /* theme: the pre-paint snippet applies it, site-nav.js owns the toggle. No per-page copy — a
     surviving second listener double-binds and the button goes dead (v0.53.0). */

  const token = new URLSearchParams(location.search).get("t");
  if (!token) {
    app.innerHTML = "<div class='card'><h1>Missing link code</h1><p>Use the exact link whoever is running the night sent you.</p></div>";
    return;
  }

  /** Open only inside confirm mode, and only because the player pressed "no". Not a mode. */
  let editing = false;

  async function api(opts = {}) {
    const headers = { "content-type": "application/json" };
    try {
      const resp = await fetch(`${API}/api/kotc/${encodeURIComponent(token)}`, Object.assign({}, opts, { headers }));
      return { ok: resp.ok, data: await resp.json().catch(() => ({})) };
    } catch {
      return { ok: false, data: { error: "Can't reach the server — check your signal and try again." } };
    }
  }

  async function load() {
    const r = await api();
    if (!r.ok) return fail(r.data.error);
    render(r.data);
  }

  const fail = (msg) => {
    app.innerHTML = `<div class="card"><h1>Hmm</h1><p>${esc(msg || "Something went wrong. Find whoever is running the night.")}</p></div>`;
  };

  /**
   * Render one server view. `note` is what just happened (a POST response); `prompt` is the question
   * being asked (every view). They are separate fields on purpose — they were briefly the same one
   * and every action reported the question instead of the outcome.
   */
  function render(v) {
    if (v.error) return fail(v.error);

    // On the entry list but not seated this round — a real state when somebody arrives late. The
    // server says so and supplies the sentence; this page does not invent a diagnosis.
    if (!v.on_a_net) {
      app.innerHTML = `<div class="card kotc-settle">
        <div class="kotc-where"><span class="kotc-net">${esc(v.session)}</span><span class="kotc-round">Round ${esc(v.round)}</span></div>
        <p class="kotc-prompt" style="margin-top:10px">${esc(v.prompt)}</p></div>`;
      return;
    }

    const head = `<div class="card">
      <div class="kotc-where">
        <span class="kotc-net">Net ${esc(v.net)}</span>
        <span class="kotc-round">Round ${esc(v.round)} · ${esc(v.session)} · games to ${esc(v.points_to)}</span>
      </div>
      <p class="kotc-round" style="margin:6px 0 0">You are ${esc(v.you)}.</p>
    </div>`;

    const note = v.note ? `<div class="card kotc-settle"><p class="kotc-note" style="margin:0">${esc(v.note)}</p></div>` : "";

    /* THE MODE IS THE SERVER'S. Read, never computed — see the header. */
    let body;
    switch (v.mode) {
      case "done":
        body = `<div class="card kotc-settle">
            <p class="kotc-prompt">${esc(v.prompt)}</p>
            ${evidence(v)}
            ${checkedLine(v)}
          </div>`;
        break;

      case "confirm":
        body = editing
          ? `<div class="card">
              <p class="kotc-prompt">Put in what it should be. Everyone else will be asked to check it again.</p>
              ${form(v)}
            </div>`
          : `<div class="card kotc-settle">
              <p class="kotc-prompt">${esc(v.prompt)}</p>
              ${evidence(v)}
              <div class="kotc-verdict">
                <button class="btn primary kotc-tap" id="kotcYes">Yes, that's right</button>
                <button class="btn ghost kotc-tap" id="kotcNo">${anyBlank(v) ? "Add what's missing" : "No, fix them"}</button>
              </div>
              ${checkedLine(v)}
            </div>`;
        break;

      default: // "enter"
        body = `<div class="card">
            <p class="kotc-prompt">${esc(v.prompt)}</p>
            ${form(v)}
          </div>`;
    }

    app.innerHTML = head + note + body;
    wire(v);
  }

  /** A blank score is a real state: somebody entered part of the net. Display only. */
  const anyBlank = (v) => v.games.some((g) => g.score_a === null || g.score_b === null);

  const pairCell = (names, mine) =>
    `<span class="kotc-pair${mine ? " kotc-mine" : ""}">${mine ? '<span class="kotc-you" aria-hidden="true"></span>' : ""}${esc(names.filter(Boolean).join(" + "))}</span>`;

  /** Is the player looking at this screen in one of this game's pairs? Marks the dot, nothing more. */
  const inPair = (v, names) => {
    const me = v.players.find((p) => p.is_you);
    return !!me && names.some((n) => n === me.name);
  };

  /** The numbers as evidence — read-only. What is being checked, not a field to fight with. */
  function evidence(v) {
    return v.games.map((g) => `<div class="kotc-game">
      <div class="kotc-game-no">Game ${esc(g.game_no)}${g.entered_by ? " · entered by " + esc(g.entered_by) : ""}</div>
      <div class="kotc-side">${pairCell(g.a, inPair(v, g.a))}<div class="kotc-shown${g.score_a === null ? " kotc-blank" : ""}">${g.score_a === null ? "—" : esc(g.score_a)}</div></div>
      <div class="kotc-side">${pairCell(g.b, inPair(v, g.b))}<div class="kotc-shown${g.score_b === null ? " kotc-blank" : ""}">${g.score_b === null ? "—" : esc(g.score_b)}</div></div>
    </div>`).join("");
  }

  /** The editable net. Same shape as the evidence so the page does not rearrange under a player. */
  function form(v) {
    const rows = v.games.map((g) => `<div class="kotc-game">
      <div class="kotc-game-no">Game ${esc(g.game_no)}</div>
      <div class="kotc-side">${pairCell(g.a, inPair(v, g.a))}
        <input class="kotc-score" type="number" inputmode="numeric" min="0" max="99" step="1"
               data-g="${esc(g.game_no)}" data-side="a" value="${g.score_a === null ? "" : esc(g.score_a)}"
               aria-label="Game ${esc(g.game_no)}, points for ${esc(g.a.filter(Boolean).join(" and "))}" /></div>
      <div class="kotc-side">${pairCell(g.b, inPair(v, g.b))}
        <input class="kotc-score" type="number" inputmode="numeric" min="0" max="99" step="1"
               data-g="${esc(g.game_no)}" data-side="b" value="${g.score_b === null ? "" : esc(g.score_b)}"
               aria-label="Game ${esc(g.game_no)}, points for ${esc(g.b.filter(Boolean).join(" and "))}" /></div>
    </div>`).join("");

    // The one-number path. Worth its own affordance: it is the difference between a player who
    // remembers only their own total being useless and being enough to finish the net.
    return rows + `<div class="kotc-total">
        <label for="kotcTotal">Only remember your own points? Put your total for the round here instead.</label>
        <div class="kotc-total-row">
          <input class="kotc-score" id="kotcTotal" type="number" inputmode="numeric" min="0" step="1" aria-label="Your total points for the round" />
          <span class="kotc-round">We work out the rest of the net from it where the numbers allow it.</span>
        </div>
      </div>
      <div class="kotc-verdict"><button class="btn primary kotc-tap" id="kotcSave" disabled>Save the net</button></div>
      <p class="kotc-round kotc-note" id="kotcHint">Fill in what you know — you can do the whole net.</p>`;
  }

  const checkedLine = (v) =>
    `<p class="kotc-checked">${esc(v.checked_by)} of ${esc(v.of_players)} players have checked this net.</p>`;

  function wire(v) {
    const yes = document.getElementById("kotcYes");
    if (yes) yes.onclick = () => post({ action: "confirm" }, yes);

    const no = document.getElementById("kotcNo");
    if (no) no.onclick = () => { editing = true; render(v); };

    const save = document.getElementById("kotcSave");
    if (!save) return;

    const fields = [...document.querySelectorAll(".kotc-score")];
    // Save stays disabled until there is something to send. A disabled button is kinder than an
    // error sentence, and it keeps the "send something" rule in one place — the server's.
    const touched = () => fields.some((f) => f.value !== "");
    fields.forEach((f) => f.addEventListener("input", () => { save.disabled = !touched(); }));

    save.onclick = () => {
      const games = [];
      for (const g of v.games) {
        const a = document.querySelector(`[data-g="${g.game_no}"][data-side="a"]`);
        const b = document.querySelector(`[data-g="${g.game_no}"][data-side="b"]`);
        const one = { game_no: g.game_no };
        // An empty field is OMITTED, never sent as null: a partial submission must not wipe
        // somebody else's work, and the server leaves any field nobody sent alone.
        if (a && a.value !== "") one.score_a = Number(a.value);
        if (b && b.value !== "") one.score_b = Number(b.value);
        if (one.score_a !== undefined || one.score_b !== undefined) games.push(one);
      }
      const total = document.getElementById("kotcTotal");
      const body = {};
      if (games.length) body.games = games;
      if (total && total.value !== "") body.my_total = Number(total.value);
      // An edit over existing numbers is a dispute — same write path, different provenance, and it
      // is what resets everyone else to pending.
      if (editing) body.action = "dispute";
      post(body, save);
    };
  }

  async function post(body, btn) {
    const buttons = [...document.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    const r = await api({ method: "POST", body: JSON.stringify(body) });
    if (!r.ok) {
      buttons.forEach((b) => (b.disabled = false));
      const hint = document.getElementById("kotcHint");
      const msg = esc(r.data.error);
      if (hint) hint.outerHTML = `<p class="kotc-note kotc-bad" id="kotcHint">${msg}</p>`;
      else if (btn) btn.insertAdjacentHTML("afterend", `<p class="kotc-note kotc-bad">${msg}</p>`);
      return;
    }
    // The response carries the server's next screen. Close the edit form and render what it says.
    editing = false;
    render(r.data);
  }

  load();
})();
