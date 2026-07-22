/* Boomtown Platform — Members, Admins & Roles
   Version: v0.4.0 · Date: 2026-07-22 */
(async function () {
  const { api, guard, esc, fmtDT, openModal, closeModal } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const sw = document.getElementById("orgSwitcher");
  const orgs = (await api("/api/orgs")).data.orgs || [];
  const currentOrg = Number(localStorage.getItem("bt_org")) || (orgs[0] && orgs[0].id) || 1;
  sw.innerHTML = orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? "selected" : ""}>${esc(o.name)}</option>`).join("");
  sw.addEventListener("change", () => { localStorage.setItem("bt_org", sw.value); location.reload(); });
  const orgName = id => (orgs.find(o => o.id === id) || {}).name || ("Org " + id);

  /* tabs */
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
  function showTab(n) {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === n));
    for (const s of ["members", "roles", "perms"]) document.getElementById("tab-" + s).hidden = s !== n;
    location.hash = n === "members" ? "" : n;
  }
  if (location.hash === "#roles") showTab("roles");

  /* ---------- members ---------- */
  let searchTimer;
  document.getElementById("memberSearch").addEventListener("input", () => {
    clearTimeout(searchTimer); searchTimer = setTimeout(loadMembers, 250);
  });

  async function loadMembers() {
    const q = encodeURIComponent(document.getElementById("memberSearch").value.trim());
    const r = await api("/api/admin/members?q=" + q);
    const wrap = document.getElementById("membersWrap");
    if (!r.ok) { wrap.innerHTML = `<div class="empty">${esc(r.data.error || "Couldn't load members.")}</div>`; return; }
    const rows = r.data.members || [];
    document.getElementById("memberCount").textContent = `${r.data.total} member${r.data.total === 1 ? "" : "s"} in ${esc(orgName(currentOrg))}`;
    if (!rows.length) { wrap.innerHTML = `<div class="empty">No members yet — every registration adds one automatically.</div>`; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>From</th><th>Email opt-in</th><th></th></tr></thead><tbody>
      ${rows.map(m => `<tr>
        <td>${esc(m.full_name || "—")}</td><td>${esc(m.email || "—")}</td><td>${esc(m.phone || "—")}</td>
        <td>${esc([m.city, m.state].filter(Boolean).join(", ") || "—")}</td>
        <td>${m.unsubscribed ? '<span class="chip cancelled">Unsubscribed</span>' : '<span class="chip paid">Subscribed</span>'}</td>
        <td><button class="btn ghost" data-edit="${m.id}">Edit</button></td></tr>`).join("")}
    </tbody></table>`;
    wrap.querySelectorAll("[data-edit]").forEach(b =>
      b.addEventListener("click", () => memberModal(rows.find(m => m.id == b.dataset.edit))));
  }

  function memberModal(m) {
    const back = openModal(`
      <h2>Edit member</h2>
      <div class="field"><label>Name</label><input id="mm_name" value="${esc(m.full_name || "")}" /></div>
      <div class="row2">
        <div class="field"><label>Phone</label><input id="mm_phone" value="${esc(m.phone || "")}" /></div>
        <div class="field"><label>Instagram</label><input id="mm_ig" value="${esc(m.instagram || "")}" /></div>
      </div>
      <div class="row2">
        <div class="field"><label>City</label><input id="mm_city" value="${esc(m.city || "")}" /></div>
        <div class="field"><label>State</label><input id="mm_state" value="${esc(m.state || "")}" /></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px">
        <input type="checkbox" id="mm_unsub" ${m.unsubscribed ? "checked" : ""} /> Unsubscribed from marketing email</label>
      <div class="actions"><button class="btn ghost" id="mm_cancel">Cancel</button><button class="btn" id="mm_save">Save</button></div>`);
    back.querySelector("#mm_cancel").addEventListener("click", closeModal);
    back.querySelector("#mm_save").addEventListener("click", async () => {
      const r = await api("/api/admin/members/" + m.id, { method: "PATCH", body: JSON.stringify({
        full_name: back.querySelector("#mm_name").value.trim(),
        phone: back.querySelector("#mm_phone").value.trim(),
        instagram: back.querySelector("#mm_ig").value.trim(),
        city: back.querySelector("#mm_city").value.trim(),
        state: back.querySelector("#mm_state").value.trim(),
        unsubscribed: back.querySelector("#mm_unsub").checked ? 1 : 0,
      })});
      if (!r.ok) return alert(r.data.error || "Save failed.");
      closeModal(); loadMembers();
    });
  }

  /* ---------- users & roles ---------- */
  document.getElementById("addUserBtn").addEventListener("click", () => addUserModal());

  async function loadRoles() {
    const r = await api("/api/admin/users");
    const wrap = document.getElementById("rolesWrap");
    if (!r.ok) { wrap.innerHTML = `<div class="empty">${esc(r.data.error || "Admin role required to view this.")}</div>`; return; }
    const users = r.data.users || [];
    wrap.innerHTML = `<table class="tbl"><thead><tr><th>User</th><th>2FA</th><th>Roles</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr>
        <td>${esc(u.display_name || u.email)}${u.display_name ? `<div class="help-text">${esc(u.email)}</div>` : ""}</td>
        <td>${u.totp_enabled ? "On" : '<span class="help-text">Off</span>'}</td>
        <td>${u.roles.length ? u.roles.map(ro =>
            `<span class="chip ${ro.role === "admin" ? "role-admin" : ""}">${esc(orgName(ro.org_id))}: ${ro.role}</span>`).join(" ")
          : '<span class="help-text">No role (public)</span>'}</td>
        <td><button class="btn ghost" data-role="${u.id}">Change role</button></td></tr>`).join("")}
    </tbody></table>`;
    wrap.querySelectorAll("[data-role]").forEach(b =>
      b.addEventListener("click", () => roleModal(users.find(u => u.id == b.dataset.role))));
  }

  function roleModal(u) {
    const back = openModal(`
      <h2>Role for ${esc(u.email)}</h2>
      <div class="field"><label>Organization</label><select id="rm_org">
        ${orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Role</label><select id="rm_role">
        <option value="admin">Admin — everything, incl. people &amp; money</option>
        <option value="staff">Staff — run events, no user management or exports</option>
        <option value="member">Member — own profile only</option>
        <option value="none">Remove role in this org</option></select></div>
      <div class="actions"><button class="btn ghost" id="rm_cancel">Cancel</button><button class="btn" id="rm_save">Apply</button></div>`);
    back.querySelector("#rm_cancel").addEventListener("click", closeModal);
    back.querySelector("#rm_save").addEventListener("click", async () => {
      const org_id = Number(back.querySelector("#rm_org").value);
      const role = back.querySelector("#rm_role").value;
      const r = role === "none"
        ? await api(`/api/admin/users/${u.id}/role?org_id=${org_id}`, { method: "DELETE" })
        : await api(`/api/admin/users/${u.id}/role`, { method: "POST", body: JSON.stringify({ org_id, role }) });
      if (!r.ok) return alert(r.data.error || "Failed.");
      closeModal(); loadRoles();
    });
  }

  function addUserModal() {
    const back = openModal(`
      <h2>Add admin or staff</h2>
      <p class="help-text">They'll sign in with the normal email link — nothing to set up on their end.</p>
      <div class="field"><label>Email</label><input id="au_email" type="email" placeholder="person@example.com" /></div>
      <div class="field"><label>Name (optional)</label><input id="au_name" /></div>
      <div class="row2">
        <div class="field"><label>Organization</label><select id="au_org">
          ${orgs.map(o => `<option value="${o.id}" ${o.id === currentOrg ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Role</label><select id="au_role">
          <option value="staff">Staff</option><option value="admin">Admin</option><option value="member">Member</option></select></div>
      </div>
      <div class="actions"><button class="btn ghost" id="au_cancel">Cancel</button><button class="btn" id="au_go">Add</button></div>`);
    back.querySelector("#au_cancel").addEventListener("click", closeModal);
    back.querySelector("#au_go").addEventListener("click", async () => {
      const r = await api("/api/admin/users", { method: "POST", body: JSON.stringify({
        email: back.querySelector("#au_email").value.trim(),
        display_name: back.querySelector("#au_name").value.trim() || null,
        org_id: Number(back.querySelector("#au_org").value),
        role: back.querySelector("#au_role").value,
      })});
      if (!r.ok) return alert(r.data.error || "Failed.");
      closeModal(); showTab("roles"); loadRoles();
    });
  }

  /* ---------- permissions matrix ---------- */
  async function loadPerms() {
    const r = await api("/api/admin/permissions");
    const wrap = document.getElementById("permsWrap");
    if (!r.ok) { wrap.innerHTML = `<div class="empty">Couldn't load.</div>`; return; }
    const P = r.data.permissions;
    const labels = {
      manage_users: "Manage users & roles", manage_events: "Create & edit events",
      registrations: "See & manage registrations", finance_export: "Financial exports (CSV)",
      crm_export: "Member list exports", score_entry: "Enter scores",
    };
    wrap.innerHTML = `<table class="tbl"><thead><tr><th>Capability</th>
      ${r.data.roles.map(ro => `<th style="text-transform:capitalize">${ro}</th>`).join("")}</tr></thead><tbody>
      ${Object.keys(labels).map(k => `<tr><td>${labels[k]}</td>
        ${r.data.roles.map(ro => `<td>${P[ro][k] ? "✓" : "—"}</td>`).join("")}</tr>`).join("")}
    </tbody></table>`;
  }

  loadMembers(); loadRoles(); loadPerms();
})();
