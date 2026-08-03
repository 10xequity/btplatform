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

  const POS_LABEL = { S: "Setter", OH: "Outside", RS: "Opposite", MB: "Middle", L: "Libero", DS: "Def. specialist" };

  /* ---------- render ---------- */

  function card(p) {
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
    if (!r.ok) return fail("tList", "Couldn't load your events.");
    // Tryouts are run as training or event records; show the recent ones and let staff pick.
    const list = (r.data.events || []).slice(0, 40);
    $("tEvent").innerHTML = list.length
      ? list.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    eventId = list.length ? list[0].id : null;
    $("tSummary").href = eventId ? `admin-buildstatus.html#tryout-${eventId}` : "#";
    loadBoard();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tEvent").addEventListener("change", () => { eventId = Number($("tEvent").value); loadBoard(); });
    ["tFind", "tPos", "tShow"].forEach((k) => $(k).addEventListener("input", render));
    loadEvents();
  });
})();
