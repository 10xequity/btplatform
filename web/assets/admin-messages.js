/* Boomtown Platform — Message Reports (admin)
   File: web/assets/admin-messages.js · Version: v1.1 · Date: 2026-07-25 · Ships in: v0.21.0
   v1.1 (M16): one-click mute — every open report row gets "Mute sender 7d"
   (or "Unmute" when they're already muted). Single tap, no prompt: POST
   /api/admin/messages/mute {contact_id} then reload. Mute ≠ resolve — the
   report stays open so the review trail is intact.
   GET /api/admin/messages/flags?status= → list; POST /api/admin/messages/flags/resolve.
   Uses BT_ADMIN helpers; errors always render through fail() (Back + Dashboard, standing
   rule 2). Staff-gated by admin-nav guard() + server requireStaff. */
(function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);
  let status = "open";

  const when = (iso) => { try { return new Date(iso + "Z").toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return iso || ""; } };

  async function load() {
    $("flagList").innerHTML = '<p class="help-text">Loading…</p>';
    const r = await api("/api/admin/messages/flags?status=" + status);
    if (!r.ok) return fail(r.data.error || "Could not load message reports.");
    const flags = r.data.flags || [];
    if (!flags.length) {
      $("flagList").innerHTML = `<p class="help-text">${status === "open" ? "Nothing to review. Inbox zero. 🎉" : "None here."}</p>`;
      return;
    }
    $("flagList").innerHTML = flags.map((f) => `
      <div class="flag-row">
        <div class="top">
          <b>${esc(f.reporter_name || "A member")}</b> reported a message from
          <b>${esc(f.sender_name || "(deleted)")}</b>
          <span class="when">${when(f.created_at)}</span>
        </div>
        <div class="flag-quote">${esc(f.message_body || "(message no longer available)")}</div>
        ${f.reason ? `<p class="flag-reason">Reason: ${esc(f.reason)}</p>` : ""}
        ${f.resolution_note ? `<p class="flag-reason">Resolution: ${esc(f.resolution_note)}</p>` : ""}
        ${f.sender_muted ? `<p class="flag-reason">Sender is muted.</p>` : ""}
        ${status === "open" ? `<div class="flag-actions">
          <button class="btn" data-resolve="${f.id}" type="button">Resolve</button>
          <button class="btn ghost" data-dismiss="${f.id}" type="button">Dismiss</button>
          ${f.sender_contact_id ? `<button class="btn ghost" data-mute="${f.sender_contact_id}"
            data-muted="${f.sender_muted ? 1 : 0}" type="button">${f.sender_muted ? "Unmute" : "Mute sender 7d"}</button>` : ""}
        </div>` : ""}
      </div>`).join("");
    $("flagList").querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", () => act(b.dataset.resolve, "resolved")));
    $("flagList").querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", () => act(b.dataset.dismiss, "dismissed")));
    $("flagList").querySelectorAll("[data-mute]").forEach((b) => b.addEventListener("click", () => muteSender(b)));
  }

  /* v1.1: one click, no prompt — mute is reversible and audited, so no friction. */
  async function muteSender(btn) {
    btn.disabled = true;
    const muted = btn.dataset.muted === "1";
    const r = await api(`/api/admin/messages/${muted ? "unmute" : "mute"}`, {
      method: "POST", body: JSON.stringify({ contact_id: Number(btn.dataset.mute) }) });
    btn.disabled = false;
    if (!r.ok) return fail(r.data.error || "Couldn't update the mute.");
    load();
  }

  async function act(id, newStatus) {
    const note = prompt(newStatus === "resolved" ? "What did you do about it? (optional note)" : "Why is it fine? (optional note)") ?? "";
    const r = await api("/api/admin/messages/flags/resolve", { method: "POST", body: JSON.stringify({ id: Number(id), status: newStatus, note }) });
    if (!r.ok) return fail(r.data.error || "Could not update the report.");
    load();
  }

  function tab(which) {
    status = which;
    for (const [id, s] of [["tabOpen", "open"], ["tabResolved", "resolved"], ["tabDismissed", "dismissed"]]) {
      $(id).className = s === which ? "btn" : "btn ghost";
      $(id).setAttribute("aria-pressed", String(s === which));
    }
    load();
  }
  $("tabOpen").onclick = () => tab("open");
  $("tabResolved").onclick = () => tab("resolved");
  $("tabDismissed").onclick = () => tab("dismissed");

  guard().then(load);
})();
/* Changelog: v1.0 (2026-07-24) — initial Message Reports admin logic (M14 Phase B). */
/* Changelog: v1.1 (2026-07-25) — one-click mute/unmute per report row (M16). */
