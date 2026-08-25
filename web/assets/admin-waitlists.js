/* Boomtown Platform — Waitlists (admin)
   File: web/assets/admin-waitlists.js · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.19.0
   Event picker → queue table → Offer next / Offer (override) / Remove.
   Uses BT_ADMIN helpers; errors always render through fail() (Back + Dashboard, rule 2). */
(async function () {
  const { api, guard, esc, fmtDT } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);

  let EVENTS = [];

  async function loadEvents() {
    const r = await api("/api/events"); // same source as admin-registrations.js
    if (!r.ok) return fail(r.data.error || "Could not load events.");
    EVENTS = (r.data.events || []).filter((e) => !e.status || ["published", "in_progress"].includes(e.status));
    if (!EVENTS.length) { $("wlEvent").innerHTML = `<option value="">No open events</option>`; $("wlBody").innerHTML = ""; $("wlCap").textContent = ""; return; }
    $("wlEvent").innerHTML = EVENTS.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join("");
    const pre = new URLSearchParams(location.search).get("event");
    if (pre && EVENTS.some((e) => String(e.id) === pre)) $("wlEvent").value = pre;
    await loadQueue();
  }

  async function loadQueue() {
    const eventId = $("wlEvent").value;
    if (!eventId) return;
    const r = await api(`/api/admin/events/${encodeURIComponent(eventId)}/waitlist`);
    if (!r.ok) return fail(r.data.error || "Could not load the waitlist.");
    const { event, spots_taken, is_full, waitlist } = r.data;
    const capTxt = event.capacity ? `${spots_taken}/${event.capacity} spots taken` : `${spots_taken} registered (no cap)`;
    $("wlCap").textContent = capTxt + (is_full ? " · FULL" : "");
    $("wlCap").className = "wl-cap" + (is_full ? " full" : "");
    $("wlOfferNext").disabled = is_full || !waitlist.some((w) => w.status === "queued");
    $("wlOfferNext").title = is_full ? "Event is still full; cancel a registration to open a spot first" : "";

    let live = 0;
    $("wlBody").innerHTML = waitlist.map((w) => {
      const displayPos = ["queued", "offered"].includes(w.status) ? ++live : "—";
      const who = `${esc(w.team_name || "")}${w.team_name ? " · " : ""}${esc(w.name)}`;
      const contact = `${esc(w.email)}${w.phone ? "<br/>" + esc(w.phone) : ""}`;
      const expires = w.status === "offered" && w.offer_expires_at ? esc(fmtDT ? fmtDT(w.offer_expires_at) : w.offer_expires_at) : "—";
      const actions = [];
      if (["queued", "expired"].includes(w.status)) actions.push(`<button class="btn small" data-act="offer" data-id="${w.id}">Offer</button>`);
      if (w.status === "offered") actions.push(`<button class="btn small ghost" data-act="offer" data-id="${w.id}" title="Re-send with a fresh 48h window">Re-offer</button>`);
      if (!["claimed", "removed"].includes(w.status)) actions.push(`<button class="btn small danger" data-act="remove" data-id="${w.id}">Remove</button>`);
      return `<tr class="wl-row-in">
        <td>${displayPos}</td>
        <td>${who}</td>
        <td>${contact}</td>
        <td><span class="wl-status ${esc(w.status)}">${esc(w.status)}</span></td>
        <td>${expires}</td>
        <td><div class="wl-actions">${actions.join("")}</div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="6">Nobody on the waitlist for this event.</td></tr>`;
  }

  $("wlBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    btn.disabled = true;
    const id = btn.dataset.id;
    const path = btn.dataset.act === "offer" ? `/api/admin/waitlists/${id}/offer` : `/api/admin/waitlists/${id}/remove`;
    if (btn.dataset.act === "remove" && !confirm("Remove this team from the waitlist?")) { btn.disabled = false; return; }
    const r = await api(path, { method: "POST", body: JSON.stringify({}) });
    btn.disabled = false;
    if (!r.ok) return fail(r.data.error || r.data.reason || "Action failed.");
    await loadQueue();
  });

  $("wlOfferNext").addEventListener("click", async () => {
    const eventId = $("wlEvent").value;
    $("wlOfferNext").disabled = true;
    const r = await api(`/api/admin/events/${encodeURIComponent(eventId)}/waitlist/offer-next`, { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) { $("wlOfferNext").disabled = false; return fail(r.data.reason || r.data.error || "Could not offer."); }
    await loadQueue();
  });

  $("wlEvent").addEventListener("change", loadQueue);
  $("wlRefresh").addEventListener("click", loadQueue);

  await loadEvents();
})();
