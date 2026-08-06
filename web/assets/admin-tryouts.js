/* Boomtown Platform — Tryout evaluations (admin page script)
   File: web/assets/admin-tryouts.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.60.0

   One card per registered player. Facts on top (what they told us at registration), a free-text
   box, a 1–5 rating, and offer / no-offer.

   TWO DESIGN DECISIONS WORTH KNOWING:
   1. Notes save on BLUR, not on a Save button. A coach evaluating forty players in a gym is not
      going to remember to press save forty times, and losing a note because they walked away is
      the failure that makes people stop using the tool. The mark buttons save immediately.
   2. Nothing here ever renders another coach's note, because the server never sends one. The
      privacy is enforced in SQL, not in this file — a client-side filter would be one careless
      change away from leaking (tryouts.js).

   Click budget (req #19): judging a player is type + one tap. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let eventId = null;
  let players = [];
  let rollup = [];                 // the director's view: every coach's verdict, per player
  let rollOpen = false;
  let sortKey = "name", sortDir = 1;
  let fixOpen = null;              // the one contact whose correction form is open
  let fixDraft = null;             // its live values, so a filter keystroke cannot discard typing

  const POS_LABEL = { S: "Setter", OH: "Outside", RS: "Opposite", MB: "Middle", L: "Libero", DS: "Def. specialist" };

  /* ---------- staff card correction (W-E.2b) ----------
     `PUT /api/admin/tryouts/:eventId/card/:contactId` has been built, tested and org-scoped since
     v0.60.0 with no caller anywhere — the last tryouts route where the engine was whole and only
     the screen was missing. It exists so staff can fix what a player typed at registration.

     TWO THINGS THIS FILE DELIBERATELY DOES NOT DO:

     1. It does not convert feet and inches to centimetres. Height is STORED metric and the server
        renders the imperial a coach actually reads (`cmToImperial`). A converter here would have
        to round-trip — and 5'11" is a range of centimetres, not one — so every save would quietly
        rewrite a stored height that was never wrong. The field asks for centimetres, says so in
        its own label, and shows what is on file today in the server's words.

     2. It never sends a comma-separated STRING for a list. `parseList` JSON.parses a string before
        it falls back to splitting, so a lone "16" would parse as the NUMBER 16, fail the
        Array.isArray check, and come back as an empty list — a silent delete of the age group the
        user just typed. Arrays go over the wire. */

  function fixForm(p) {
    const v = fixDraft || {
      positions: p.positions.slice(),
      age_groups: p.age_groups.join(", "),
      height_cm: p.height_cm == null ? "" : String(p.height_cm),
      prev_club: p.prev_club || "",
      jersey_size: p.jersey_size || "",
      player_note: p.player_note || "",
    };
    // Checkboxes rather than the aria-pressed toggles the rating row uses: those fire an action on
    // tap, these are a value saved with the rest of the form.
    const boxes = Object.keys(POS_LABEL).map((x) =>
      `<label><input type="checkbox" data-pos="${x}"${v.positions.includes(x) ? " checked" : ""} /> ${esc(POS_LABEL[x])}</label>`
    ).join("");

    return `<div class="fix-form" id="fix${p.contact_id}" data-fixform="${p.contact_id}">
      <fieldset class="fix-set fix-wide">
        <legend class="fix-hint">Positions</legend>
        <div class="fix-pos">${boxes}</div>
      </fieldset>
      <label>Age groups
        <input data-f="age_groups" value="${esc(v.age_groups)}" placeholder="14U, 16U" autocomplete="off" />
        <span class="fix-hint">Separate them with commas.</span>
      </label>
      <label>Height in centimetres
        <input data-f="height_cm" type="number" inputmode="numeric" min="90" max="250" value="${esc(v.height_cm)}" />
        <span class="fix-hint">${p.height ? `On file now: ${esc(p.height)}.` : "Nothing on file yet."}</span>
      </label>
      <label>Previous club
        <input data-f="prev_club" value="${esc(v.prev_club)}" maxlength="120" autocomplete="off" />
      </label>
      <label>Jersey size
        <input data-f="jersey_size" value="${esc(v.jersey_size)}" maxlength="12" autocomplete="off" />
      </label>
      <label class="fix-wide">What they told us
        <textarea class="fix-note" data-f="player_note" maxlength="1000">${esc(v.player_note)}</textarea>
      </label>
      <div class="fix-actions fix-wide">
        <button class="btn" type="button" data-fixsave="${p.contact_id}">Save details</button>
        <span class="fix-error" data-fixerror hidden></span>
      </div>
    </div>`;
  }

  /** Put focus back on the card's own toggle after a re-render replaced it. */
  function refocusFix(contactId) {
    const b = document.querySelector(`[data-fixopen="${contactId}"]`);
    if (b) b.focus();
  }

  function readForm(form) {
    const get = (n) => { const el = form.querySelector(`[data-f="${n}"]`); return el ? el.value : ""; };
    return {
      positions: [...form.querySelectorAll("[data-pos]")].filter((b) => b.checked).map((b) => b.dataset.pos),
      age_groups: get("age_groups"),
      height_cm: get("height_cm"),
      prev_club: get("prev_club"),
      jersey_size: get("jersey_size"),
      player_note: get("player_note"),
    };
  }

  async function saveCard(contactId, form) {
    if (!form) return;
    const v = readForm(form);
    const err = form.querySelector("[data-fixerror]");
    err.hidden = true;
    const r = await api(`/api/admin/tryouts/${eventId}/card/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({
        positions: v.positions,
        age_groups: v.age_groups.split(",").map((s) => s.trim()).filter(Boolean),
        height_cm: v.height_cm,
        prev_club: v.prev_club,
        jersey_size: v.jersey_size,
        player_note: v.player_note,
      }),
    });
    // The error belongs in the form, next to the field that caused it — fail() would replace the
    // whole list with a dead end and take the half-typed correction with it.
    if (!r.ok) {
      err.textContent = r.data.error || "Couldn't save those details.";
      err.hidden = false;
      return;
    }
    fixOpen = null;
    fixDraft = null;
    await loadBoard();   // the server normalises what it stores, so the card is redrawn from the server
    refocusFix(contactId);
  }

  /* ---------- render ---------- */

  function card(p) {
    const open = fixOpen === p.contact_id;
    const facts = [
      p.age ? `<span class="num">${p.age}</span> yrs` : null,
      p.height ? `<span class="num">${esc(p.height)}</span>` : null,
      p.prev_club ? `from ${esc(p.prev_club)}` : null,
      p.age_groups.length ? `plays ${p.age_groups.map(esc).join(", ")}` : null,
    ].filter(Boolean).join(" · ");

    const tags = p.positions.length
      ? p.positions.map((x) => `<span class="pos-tag" title="${esc(POS_LABEL[x] || x)}">${esc(x)}</span>`).join(" ")
      : `<span class="mf-note">no position given</span>`;

    const rate = [1, 2, 3, 4, 5].map((n) =>
      `<button type="button" data-rate="${n}" aria-pressed="${p.my_evaluation.rating === n}" aria-label="Rate ${n} out of 5">${n}</button>`
    ).join("");

    return `<article class="eval-card" data-id="${p.contact_id}">
      <div class="eval-top"><b>${esc(p.name)}</b> ${tags}</div>
      <div class="eval-facts">${facts || "<span>nothing recorded at registration</span>"}</div>
      ${p.player_note ? `<div class="mf-note">They wrote: ${esc(p.player_note)}</div>` : ""}
      <div class="fix-open">
        <button class="btn ghost sm" type="button" data-fixopen="${p.contact_id}"
          aria-expanded="${open}"${open ? ` aria-controls="fix${p.contact_id}"` : ""}>${open ? "Close details" : "Fix details"}</button>
      </div>
      ${open ? fixForm(p) : ""}
      <label class="sr-only" for="n${p.contact_id}">Notes on ${esc(p.name)}</label>
      <textarea class="eval-note" id="n${p.contact_id}" placeholder="What did you see?">${esc(p.my_evaluation.notes || "")}</textarea>
      <div class="eval-actions">
        <div class="eval-rate" role="group" aria-label="Rating out of 5">${rate}</div>
        <button class="btn" data-verdict="offer" aria-pressed="${p.my_evaluation.verdict === "offer"}">Offer</button>
        <button class="btn ghost" data-verdict="no_offer" aria-pressed="${p.my_evaluation.verdict === "no_offer"}">No</button>
        <span class="eval-saved" data-saved hidden>Saved</span>
      </div>
    </article>`;
  }

  function visible() {
    const q = $("tFind").value.trim().toLowerCase();
    const pos = $("tPos").value;
    const show = $("tShow").value;
    return players.filter((p) => {
      if (q && !String(p.name).toLowerCase().includes(q)) return false;
      if (pos && !p.positions.includes(pos)) return false;
      const v = p.my_evaluation.verdict;
      if (show === "todo" && v !== "undecided") return false;
      if (show === "offer" && v !== "offer") return false;
      if (show === "no_offer" && v !== "no_offer") return false;
      return true;
    });
  }

  function render() {
    const list = visible();
    $("tList").innerHTML = list.map(card).join("");
    $("tEmpty").hidden = players.length > 0;
    const judged = players.filter((p) => p.my_evaluation.verdict !== "undecided").length;
    $("tCount").textContent = players.length
      ? `${list.length} shown · you have judged ${judged} of ${players.length}`
      : "";
    wire();
  }

  /* ---------- the director's roll-up ----------
     The one place every coach's verdict is visible at once. The evaluating cards above show one
     coach their own work only, and that is enforced in SQL — this view is the deliberate exception,
     for after the gym has emptied.

     THE RATING IS A RANGE, NEVER A MEAN. The server sends `rating_low` and `rating_high` and this
     file does no arithmetic on them at all. Two coaches at 2 and 5 is the case a director needs to
     see; an average of 3.5 is a number no coach gave and it hides the disagreement that matters. */

  const SORTS = {
    name: (p) => String(p.name || "").toLowerCase(),
    offer: (p) => p.offer || 0,
    no_offer: (p) => p.no_offer || 0,
    evaluations: (p) => p.evaluations || 0,
    // Sorting by "rating" means sorting by the top mark anyone gave, with the low end breaking ties.
    // Not an average — see above.
    rating: (p) => (p.rating_high == null ? -1 : p.rating_high * 10 + (p.rating_low || 0)),
  };

  function sortedRollup() {
    const get = SORTS[sortKey] || SORTS.name;
    return [...rollup].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x < y) return -1 * sortDir;
      if (x > y) return 1 * sortDir;
      return String(a.name || "").localeCompare(String(b.name || ""));   // stable, always by name
    });
  }

  function renderRollup() {
    const rows = sortedRollup();
    $("tRollBody").innerHTML = rows.map((p) => {
      const range = p.rating_high == null
        ? `<span class="roll-none">not rated</span>`
        : p.rating_low === p.rating_high
          ? `${p.rating_low}`
          : `${p.rating_low}–${p.rating_high}`;
      return `<tr>
        <td>${esc(p.name)}</td>
        <td class="roll-num">${p.offer || 0}</td>
        <td class="roll-num">${p.no_offer || 0}</td>
        <td class="roll-num">${p.evaluations || 0}</td>
        <td class="roll-range">${range}</td>
        <td>${esc(p.split)}</td>
      </tr>`;
    }).join("");
    $("tRollEmpty").hidden = rows.length > 0;
    // aria-sort lives on the th, which is what a screen reader announces — the arrow is its twin.
    $("tRollTable").querySelectorAll("th[aria-sort]").forEach((th) => {
      const key = th.querySelector(".roll-sort")?.dataset.sort;
      th.setAttribute("aria-sort", key !== sortKey ? "none" : sortDir === 1 ? "ascending" : "descending");
    });
  }

  async function openRollup() {
    const r = await api(`/api/admin/tryouts/${eventId}/summary`);
    if (!r.ok) return fail("tRollup", r.data.error || "Couldn't load the summary.");
    rollup = r.data.players || [];
    renderRollup();
  }

  /** Swap which half of the tryout is on screen. One tap, no navigation, same event. */
  function showRollup(on) {
    rollOpen = on;
    $("tRollup").hidden = !on;
    $("tList").hidden = on;
    $("tEmpty").hidden = on || players.length > 0;
    document.querySelector(".mf-filter").hidden = on;   // those filters drive the cards, not the table
    $("tSummary").setAttribute("aria-pressed", String(on));
    $("tSummary").textContent = on ? "Back to my evaluations" : "Director summary";
    if (on) openRollup();
  }

  /* ---------- saving ---------- */

  function flash(el) {
    const tag = el.closest(".eval-card").querySelector("[data-saved]");
    if (!tag) return;
    tag.hidden = false;
    setTimeout(() => { tag.hidden = true; }, 1400);
  }

  async function save(contactId, patch, el) {
    const p = players.find((q) => q.contact_id === contactId);
    if (!p) return;
    const next = Object.assign({}, p.my_evaluation, patch);
    const r = await api(`/api/admin/tryouts/${eventId}/eval/${contactId}`, {
      method: "PUT",
      body: JSON.stringify({ rating: next.rating, notes: next.notes, verdict: next.verdict }),
    });
    if (!r.ok) return fail("tList", r.data.error || "Couldn't save that.");
    p.my_evaluation = next;
    if (el) flash(el);
  }

  function wire() {
    $("tList").querySelectorAll(".eval-card").forEach((cardEl) => {
      const id = Number(cardEl.dataset.id);

      // Blur, not a Save button: nobody presses save forty times in a gym.
      const note = cardEl.querySelector(".eval-note");
      note.addEventListener("blur", () => {
        const p = players.find((q) => q.contact_id === id);
        if (p && note.value === (p.my_evaluation.notes || "")) return; // nothing changed
        save(id, { notes: note.value }, note);
      });

      cardEl.querySelectorAll("[data-rate]").forEach((b) => {
        b.addEventListener("click", () => {
          const n = Number(b.dataset.rate);
          const p = players.find((q) => q.contact_id === id);
          // Tapping the current rating clears it — a coach who mis-taps needs a way back.
          const rating = p.my_evaluation.rating === n ? null : n;
          cardEl.querySelectorAll("[data-rate]").forEach((o) =>
            o.setAttribute("aria-pressed", String(Number(o.dataset.rate) === rating)));
          save(id, { rating }, b);
        });
      });

      cardEl.querySelectorAll("[data-verdict]").forEach((b) => {
        b.addEventListener("click", () => {
          const p = players.find((q) => q.contact_id === id);
          const want = b.dataset.verdict;
          const verdict = p.my_evaluation.verdict === want ? "undecided" : want;
          cardEl.querySelectorAll("[data-verdict]").forEach((o) =>
            o.setAttribute("aria-pressed", String(o.dataset.verdict === verdict)));
          save(id, { verdict }, b);
        });
      });
    });
  }

  /* ---------- load ---------- */

  async function loadBoard() {
    if (!eventId) return;
    const r = await api(`/api/admin/tryouts/${eventId}/board`);
    if (!r.ok) return fail("tList", r.data.error || "Couldn't load the tryout.");
    players = r.data.players || [];
    render();
  }

  async function loadEvents() {
    const r = await api("/api/events");
    if (!r.ok) return BT_ADMIN.loadFail("tList", r, "events"); // v0.89.0 Block B4: a 403 names the org, not the module
    // Tryouts are run as training or event records; show the recent ones and let staff pick.
    const list = (r.data.events || []).slice(0, 40);
    $("tEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    // Arriving back from the squad board carries the tryout in the URL, so the director does not
    // re-choose the event they were already looking at (req #19). v0.97.0.
    const want = Number(new URLSearchParams(location.search).get("event")) || null;
    eventId = want && list.some((e) => e.id === want) ? want : (list.length ? list[0].id : null);
    if (!eventId) return BT_ADMIN.orgEmptyState("tList", "events"); // v0.89.0 Block B3: an empty org is not a broken module
    $("tEvent").value = String(eventId);
    $("tSquads").href = `admin-squads.html?event=${eventId}`;
    loadBoard();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tEvent").addEventListener("change", () => {
      eventId = Number($("tEvent").value);
      loadBoard();
      if (rollOpen) openRollup();          // stay on the view the director chose, on the new tryout
    });
    ["tFind", "tPos", "tShow"].forEach((k) => $(k).addEventListener("input", render));
    // Until v0.96.0 this button was an <a> pointing at admin-buildstatus.html — a page about which
    // modules exist, not about this tryout. The summary route it should always have called has been
    // built and tested since v0.60.0 with no caller anywhere.
    $("tSummary").addEventListener("click", () => showRollup(!rollOpen));
    // One delegated listener on the static table head; the body is rewritten on every sort.
    $("tRollTable").addEventListener("click", (e) => {
      const b = e.target.closest(".roll-sort");
      if (!b) return;
      const key = b.dataset.sort;
      // Same column again reverses. A new column starts descending for the counts — a director
      // opening "Offers" wants the most-wanted players first, not the least.
      if (key === sortKey) sortDir = -sortDir;
      else { sortKey = key; sortDir = key === "name" ? 1 : -1; }
      renderRollup();
    });
    /* The correction form is delegated on #tList, at boot, once. render() replaces that node's
       innerHTML but never the node itself, so a listener attached here cannot accumulate — which
       is §-1c D-6, the pool board's handler leak, deliberately not inherited a second time. */
    $("tList").addEventListener("click", (e) => {
      const open = e.target.closest("[data-fixopen]");
      if (open) {
        const id = Number(open.dataset.fixopen);
        fixOpen = fixOpen === id ? null : id;   // one open at a time; closing discards the draft
        fixDraft = null;
        render();
        return refocusFix(id);   // render() just replaced this button; focus must not fall to body
      }
      const save = e.target.closest("[data-fixsave]");
      if (save) saveCard(Number(save.dataset.fixsave), save.closest("[data-fixform]"));
    });
    // Every keystroke is kept, so typing in the filter box — which rebuilds every card — cannot
    // silently discard a half-finished correction.
    $("tList").addEventListener("input", (e) => {
      const form = e.target.closest("[data-fixform]");
      if (form) fixDraft = readForm(form);
    });
    loadEvents();
  });
})();
