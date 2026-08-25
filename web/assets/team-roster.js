/* Boomtown Platform — Team roster editor (shared)
   File: web/assets/team-roster.js · Version: v1.0 · Date: 2026-08-05 · Ships in: v0.92.0

   W-A (roadmap §-1b, owner 2026-08-05): the roster a registration creates, visible and editable.
   One modal, opened from wherever a team appears — the event page's registrations table and the
   League Manager's levels board both call BT_ROSTER.open(teamId). The modal shows WHERE the team
   came from (its registration, with status) and WHAT event it belongs to, because the owner's
   complaint was precisely that the two were never visibly linked.

   Server truth only: every edit POSTs and re-renders from the response (the same design as the
   KOTC board — two things deciding the same state independently is two chances to show the wrong
   one). Uses BT_ADMIN.api/esc/openModal, so it must load AFTER admin-nav.js. */
(function () {
  "use strict";

  function open(teamId) {
    const { api, esc, openModal, closeModal } = window.BT_ADMIN;
    const back = openModal(`<h2 id="trTitle">Team roster</h2><div id="trBody"><p class="help-text">Loading…</p></div>`);
    const body = back.querySelector("#trBody");

    async function load(promise) {
      const r = await (promise || api(`/api/admin/teams/${teamId}`));
      if (!r.ok) {
        body.innerHTML = `<p class="help-text">${esc(r.data.error || "Couldn't load this team.")}</p>
          <div class="actions"><button class="btn ghost" id="trClose" type="button">Close</button></div>`;
        body.querySelector("#trClose").addEventListener("click", closeModal);
        return;
      }
      render(r.data);
    }

    function render(d) {
      const t = d.team, reg = d.registration;
      back.querySelector("#trTitle").textContent = t.name;
      body.innerHTML = `
        <p class="help-text" style="margin:0 0 10px">
          ${esc(t.event_name)}${t.level ? ` · ${esc(t.level)}` : ""} ·
          ${reg
            ? `from registration <span class="chip ${esc(reg.status)}">${esc(reg.status)}</span>`
            : "no registration linked (added by hand or from Tournament Ops)"}
          · <a href="admin-event.html?id=${t.event_id}">Open the event</a>
        </p>
        <div class="field"><label for="trName">Team name</label>
          <div style="display:flex;gap:8px">
            <input id="trName" value="${esc(t.name)}" style="flex:1" />
            <button class="btn ghost" id="trRename" type="button">Save name</button>
          </div>
        </div>
        <p class="help-text" style="margin:10px 0 4px;font-weight:700">Roster</p>
        <div id="trRows"></div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <input id="trAddName" placeholder="Name" aria-label="New member name" style="flex:1;min-width:120px" />
          <input id="trAddEmail" placeholder="Email (optional)" aria-label="New member email" type="email" style="flex:1;min-width:140px" />
          <button class="btn" id="trAdd" type="button">Add member</button>
        </div>
        <div class="actions" style="margin-top:14px">
          <span id="trNote" class="help-text" role="status" aria-live="polite"></span>
          <div class="spacer"></div>
          <button class="btn ghost" id="trClose" type="button">Close</button>
        </div>`;

      const rows = body.querySelector("#trRows");
      rows.innerHTML = (d.members || []).map((m) => `
        <div style="display:flex;gap:8px;align-items:center;padding:4px 0;flex-wrap:wrap" data-member="${m.id}">
          <input value="${esc(m.member_name || "")}" data-f="name" aria-label="Member name" style="flex:1;min-width:120px" />
          <input value="${esc(m.member_email || "")}" data-f="email" aria-label="Member email" type="email" style="flex:1;min-width:140px" />
          ${m.contact_id === t.captain_contact_id ? `<span class="chip">captain</span>` : ""}
          <button class="btn ghost" data-save type="button">Save</button>
          <button class="btn ghost" data-remove type="button" aria-label="Remove ${esc(m.member_name || "this member")}">Remove</button>
        </div>`).join("") || `<p class="help-text">Nobody on the roster yet.</p>`;

      const note = (msg) => { body.querySelector("#trNote").textContent = msg || ""; };

      body.querySelector("#trClose").addEventListener("click", closeModal);
      body.querySelector("#trRename").addEventListener("click", async () => {
        note("Saving…");
        await load(api(`/api/admin/teams/${teamId}`, { method: "PATCH", body: JSON.stringify({ name: body.querySelector("#trName").value }) }));
      });
      body.querySelector("#trAdd").addEventListener("click", async () => {
        const name = body.querySelector("#trAddName").value.trim();
        if (!name) return note("Give the new member a name first.");
        note("Adding…");
        await load(api(`/api/admin/teams/${teamId}/members`, { method: "POST", body: JSON.stringify({ name, email: body.querySelector("#trAddEmail").value }) }));
      });
      rows.querySelectorAll("[data-member]").forEach((row) => {
        const id = Number(row.dataset.member);
        row.querySelector("[data-save]").addEventListener("click", async () => {
          note("Saving…");
          await load(api(`/api/admin/team-members/${id}`, { method: "PATCH", body: JSON.stringify({
            name: row.querySelector('[data-f="name"]').value,
            email: row.querySelector('[data-f="email"]').value,
          }) }));
        });
        row.querySelector("[data-remove]").addEventListener("click", async () => {
          if (!window.confirm("Remove this person from the roster? Their contact record is kept.")) return;
          note("Removing…");
          await load(api(`/api/admin/team-members/${id}`, { method: "DELETE" }));
        });
      });
    }

    load();
  }

  window.BT_ROSTER = { open };
})();
