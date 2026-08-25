/* Boomtown Platform — Tournament / League Management picker (admin)
   File: web/assets/admin-manage.js · Version: v1.1 · Date: 2026-08-21 · Ships in: v0.174.0

   §-1r RF-4, the owner's option C (2026-08-18, verbatim): "A - but create an option C - whre
   tournaments and Leagues have their own buttons for management that sorts which they can pick
   of a filtered list. This also adds the caveate that as the list grows, the events that past
   must be removed from the active management list. They should still be available in the events
   page as an option to duplicate and historical data, but should not force a user to scroll
   through every event over time."

   THE ACTIVE/PAST RULE (RF-4b) IS DATE-DERIVED, NOT STATUS-DERIVED — measured on live D1,
   2026-08-21: 4 of 7 events carried ends_at in the past while status was still
   published/in_progress, and the only 'completed' row was sandbox seed data. Nothing in real use
   writes status='completed', so a status filter would show every old event forever — which is
   the complaint itself. PAST = ends_at before now, OR the operator's explicit word
   (completed/cancelled). A NULL ends_at means "not ended": a draft under construction stays
   manageable. Timestamps compare as "YYYY-MM-DD HH:MM" strings against local now — DB values are
   naive local as entered by the operator; a boundary misread costs one click on the Show-past
   toggle, so no timezone machinery is bought for it.

   Rows land on the event's manager hub (admin-manager.html?event=N — WF-5). The rail reaches
   this page as admin-manage.html#tournaments / #leagues; a hash-less visit defaults to
   #tournaments because hash entries highlight nothing without one (nav_highlight's class).
   Guards: admin_manage.test.mjs (the rule is EXECUTED there, extracted from this file). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const SCOPES = {
    tournaments: { type: "tournament", title: "Tournament Management", noun: "tournaments" },
    leagues:     { type: "league",     title: "League Management",     noun: "leagues" },
  };

  const isPast = (ev, now) =>
    ev.status === "completed" || ev.status === "cancelled" ||
    (!!ev.ends_at && String(ev.ends_at).replace("T", " ").slice(0, 16) <= now);

  const nowStamp = () => {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (ev) => {
    const day = (v) => (v ? String(v).replace("T", " ").slice(0, 10) : "");
    const a = day(ev.starts_at), b = day(ev.ends_at);
    return !a && !b ? "no date yet" : (b && b !== a ? a + " → " + b : a);
  };

  const row = (ev, past) => `
    <a class="mg-row${past ? " past" : ""}" href="admin-manager.html?event=${encodeURIComponent(ev.id)}">
      <span class="mg-name">${esc(ev.name)}</span>
      <span class="mg-status ${esc(ev.status)}">${esc(ev.status)}</span>
      <span class="mg-when">${esc(when(ev))}</span>
      ${ev.location ? `<span class="mg-where">${esc(ev.location)}</span>` : ""}
      <span class="mg-go" aria-hidden="true">→</span>
    </a>`;

  let events = null; // fetched once; hash flips re-render from memory

  async function render() {
    const scope = SCOPES[location.hash.replace("#", "")];
    if (!scope) { location.replace("#tournaments"); return; }
    document.title = scope.title + " · Boomtown Athletics";
    $("mgTitle").textContent = scope.title;
    $("mgSub").textContent = "Pick one of your active " + scope.noun + " to open its manager hub.";
    if (!events) {
      const r = await api("/api/events");
      if (!r.ok) { $("mgActive").innerHTML = `<p class="mg-empty">Could not load events (${r.status}). Reload to retry.</p>`; return; }
      events = r.data.events || [];
    }
    const now = nowStamp();
    const mine = events.filter((e) => e.type === scope.type);
    const active = mine.filter((e) => !isPast(e, now));
    const past = mine.filter((e) => isPast(e, now));
    $("mgActive").innerHTML = active.length
      ? active.map((e) => row(e, false)).join("")
      : `<p class="mg-empty">No active ${scope.noun}. Create one on <a href="admin-events.html">Events &amp; Programs</a>.</p>`;
    const t = $("mgPastToggle"), box = $("mgPast");
    box.innerHTML = past.map((e) => row(e, true)).join("");
    t.hidden = past.length === 0;
    box.hidden = true;
    t.textContent = `Show past ${scope.noun} (${past.length})`;
    t.setAttribute("aria-expanded", "false"); // v1.1: screen readers hear open/closed, not a dead button
    t.onclick = () => {
      box.hidden = !box.hidden;
      t.setAttribute("aria-expanded", String(!box.hidden));
      t.textContent = (box.hidden ? "Show" : "Hide") + ` past ${scope.noun} (${past.length})`;
    };
  }

  window.addEventListener("hashchange", render);
  render();
})();
