/* Boomtown Platform — Organization settings (admin)
   File: web/assets/admin-org-settings.js · Version: v1.1 · Date: 2026-08-01 · Ships in: v0.46.0
   v1.1: logo upload — POST /api/uploads (kind=logo, visibility=public), absolute URL into
   logo_url (server validator requires http(s)), preview, header-cache sync. Save stays explicit.

   Sends only the fields that actually changed. The server allow-lists again on arrival — this is
   a convenience, never the control (standards §7.2). Two consequences are surfaced at the moment
   of choosing rather than discovered afterwards:

     1. Editing the legal entity name RESETS the verified flag. The warning appears while typing,
        because finding out after saving means the operator has already stopped paying attention.
     2. Reactivating an organization changes what every admin can see, so it takes a typed reason.

   Failure renders through BT_ADMIN.fail() — Back + Dashboard, never a dead end (standing rule 8).
*/
(async function () {
  const { api, guard, esc, fail: failBox, openModal, closeModal } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const $ = (id) => document.getElementById(id);
  const fail = (m) => failBox($("app"), m);
  const fields = Array.from(document.querySelectorAll("[data-f]"));
  let loaded = null;

  function setSaid(msg, kind) {
    const s = $("said");
    s.textContent = msg || "";
    s.className = "og-said" + (kind ? " " + kind : "");
  }

  function render(org, missing) {
    loaded = org;
    fields.forEach((el) => { el.value = org[el.dataset.f] == null ? "" : String(org[el.dataset.f]); });

    const missingCols = new Set((missing || []).map((m) => m.column));
    $("ready").innerHTML = [
      { c: "name", t: "{{ORG_NAME}}" }, { c: "legal_entity", t: "{{ENTITY}}" },
      { c: "legal_entity_short", t: "{{ENTITY_SHORT}}" }, { c: "admin_email", t: "{{ORG_EMAIL}}" },
      { c: "address_line1", t: "{{ORG_ADDRESS}}" },
    ].map((f) => `<span class="og-pill ${missingCols.has(f.c) ? "missing" : "ok"}">${esc(f.t)}${
      missingCols.has(f.c) ? " missing" : ""}</span>`).join("");

    renderVerify(org);
    senderPreview();
    logoPreviewFrom(org.logo_url || "");
    // Keep the header's cached logo honest the moment the profile is on screen (admin-nav v2.5).
    try {
      const key = "bt_org_logo:" + (localStorage.getItem("bt_org") || "");
      org.logo_url ? localStorage.setItem(key, org.logo_url) : localStorage.removeItem(key);
    } catch (e) {}
  }

  function renderVerify(org) {
    const done = Number(org.legal_entity_verified) === 1;
    const v = $("verify");
    v.className = "og-verify" + (done ? " done" : "");
    v.innerHTML = done
      ? `<b>Legal entity confirmed.</b>
         <p>Recorded as checked against the Secretary of State. Editing the entity name above
            clears this automatically.</p>
         <button class="btn-min" type="button" id="unverify">Mark as unconfirmed</button>`
      : `<b>Legal entity not confirmed.</b>
         <p>Publishing still works — you'll see a warning. Confirming takes about five minutes:
            search the Colorado Secretary of State business database for
            <b>${esc(org.legal_entity || "this entity")}</b> and read the registered name back
            exactly, including whether it uses a comma before LLC.</p>
         <button class="btn-min" type="button" id="doVerify"
           ${String(org.legal_entity || "").trim() ? "" : "disabled"}>I checked — confirm it</button>
         ${String(org.legal_entity || "").trim() ? "" :
           `<span style="font-size:13px;color:var(--danger);margin-left:8px;">Enter the entity name first.</span>`}`;

    const go = v.querySelector("#doVerify");
    if (go) go.onclick = askVerify;
    const un = v.querySelector("#unverify");
    if (un) un.onclick = () => sendVerify(false, "");
  }

  /* Standards §7.3 — a typed source, not a checkbox. A dropdown would grow an "Other". */
  function askVerify() {
    const back = openModal(`
      <h2 style="margin-top:0;font-size:22px;">Confirm the legal entity</h2>
      <p style="color:var(--text-dim, var(--text-muted));font-size:15px;max-width:60ch;">
        This records that a person read the registration back. Write where you checked and when.
      </p>
      <div class="og-field" style="margin:16px 0;">
        <label for="vSrc">Where did you check?</label>
        <input id="vSrc" type="text" maxlength="200" placeholder="Colorado SOS business search, 2026-07-26" />
        <span class="hint">At least 10 characters. Written to the audit log.</span>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-min" type="button" id="vCancel">Cancel</button>
        <button class="btn-min primary" type="button" id="vGo" disabled>Confirm</button>
      </div>`);
    const src = back.querySelector("#vSrc"), go = back.querySelector("#vGo");
    src.addEventListener("input", () => { go.disabled = src.value.trim().length < 10; });
    back.querySelector("#vCancel").onclick = () => closeModal();
    go.onclick = () => { const s = src.value.trim(); closeModal(); sendVerify(true, s); };
  }

  async function sendVerify(verified, source) {
    const r = await api("/api/admin/org/verify-entity",
      { method: "POST", body: JSON.stringify({ verified, source }) });
    if (!r.ok) return setSaid(r.data.error || "Couldn't update the confirmation.", "bad");
    await load();
    setSaid(verified ? "Legal entity confirmed." : "Marked as unconfirmed.", "ok");
  }

  /* The verification reset is stated WHILE TYPING, not after saving. */
  ["legal_entity", "legal_entity_short"].forEach((name) => {
    const el = document.querySelector(`[data-f="${name}"]`);
    el.addEventListener("input", () => {
      const changed = el.value.trim() !== String(loaded?.[name] ?? "").trim();
      const warn = changed && Number(loaded?.legal_entity_verified) === 1;
      setSaid(warn ? "Saving this will clear the Secretary of State confirmation." : "", warn ? "bad" : "");
    });
  });

  function senderPreview() {
    const typed = document.querySelector('[data-f="email_sender_name"]').value.trim();
    const orgName = document.querySelector('[data-f="name"]').value.trim();
    $("senderPreview").textContent = `Recipients will see: ${typed || orgName || "—"}`;
  }
  document.querySelector('[data-f="email_sender_name"]').addEventListener("input", senderPreview);
  document.querySelector('[data-f="name"]').addEventListener("input", senderPreview);

  /* ---------------- logo upload (v0.46.0) ----------------
     Reuses the org file store: POST /api/uploads (kind=logo, visibility=public — the header
     must render for signed-out visitors and members, and readUpload gates non-public rows).
     The returned /api/uploads/:id is made ABSOLUTE against the API base before it goes into
     logo_url, because the server validator requires http(s) (orgs.js VALIDATORS.logo_url).
     Upload fills the field; the operator still clicks Save — one write path, no hidden save. */

  function logoPreviewFrom(url) {
    const img = $("logoPreview");
    if (url) { img.src = url; img.hidden = false; } else { img.hidden = true; img.removeAttribute("src"); }
  }
  function setLogoSaid(msg, kind) {
    const s = $("logoSaid");
    s.textContent = msg || "";
    s.className = "og-said" + (kind ? " " + kind : "");
  }

  $("logoUpload").onclick = () => $("logoFile").click();
  $("logoFile").addEventListener("change", async () => {
    const file = $("logoFile").files[0];
    if (!file) return;
    $("logoUpload").disabled = true;
    setLogoSaid("Uploading…", "");
    try {
      const apiBase = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
      const headers = { "Content-Type": file.type || "application/octet-stream" };
      const t = sessionStorage.getItem("bt_token");
      if (t) headers["Authorization"] = "Bearer " + t;
      const orgId = localStorage.getItem("bt_org");
      if (orgId) headers["X-Org-Id"] = orgId;
      const q = new URLSearchParams({
        filename: file.name || "logo", kind: "logo", visibility: "public",
        entity: "org", entity_id: String(orgId || ""),
      });
      const resp = await fetch(apiBase + "/api/uploads?" + q, {
        method: "POST", headers, credentials: "include", body: file,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Upload failed.");
      const abs = new URL(apiBase + "/api/uploads/" + data.upload.id, location.origin).href;
      $("f_logo_url").value = abs;
      logoPreviewFrom(abs);
      setLogoSaid("Uploaded. Click \u201CSave changes\u201D to apply it.", "ok");
    } catch (e) {
      setLogoSaid(e.message || "Upload failed.", "bad");
    } finally {
      $("logoUpload").disabled = false;
      $("logoFile").value = "";
    }
  });
  $("f_logo_url").addEventListener("input", () => logoPreviewFrom($("f_logo_url").value.trim()));

  /* ---------------- save ---------------- */

  $("save").onclick = async () => {
    document.querySelectorAll("[data-e]").forEach((e) => { e.textContent = ""; });
    const patch = {};
    fields.forEach((el) => {
      const was = String(loaded?.[el.dataset.f] ?? "");
      if (el.value !== was) patch[el.dataset.f] = el.value;
    });
    if (!Object.keys(patch).length) return setSaid("Nothing changed.", "");

    $("save").disabled = true;
    const r = await api("/api/admin/org/profile", { method: "PUT", body: JSON.stringify(patch) });
    $("save").disabled = false;
    if (!r.ok) {
      // Field-level errors land under their own field (standards §3), not in one banner.
      (r.data.errors || [r.data.error]).forEach((msg) => {
        const key = String(msg || "").split(" ")[0];
        const slot = document.querySelector(`[data-e="${key}"]`);
        if (slot) slot.textContent = msg;
      });
      return setSaid(r.data.error || "Couldn't save.", "bad");
    }
    render(r.data.org, r.data.missing_critical);
    setSaid(r.data.verification_reset
      ? "Saved. The entity confirmation was cleared because the entity name changed."
      : "Saved.", "ok");
  };

  /* ---------------- all organizations, admin only ---------------- */

  async function loadAllOrgs() {
    const r = await api("/api/admin/orgs/all");
    if (!r.ok) return;                              // 403 for staff — the card simply stays hidden
    $("allOrgsCard").hidden = false;
    const rows = r.data.orgs || [];
    $("allOrgs").innerHTML = `<table class="og-table">
      <thead><tr><th>Organization</th><th>Status</th><th>Legal entity</th><th></th></tr></thead>
      <tbody>${rows.map((o) => `<tr class="${Number(o.active) ? "" : "off"}">
        <td><b>${esc(o.name)}</b><div style="font-size:12px;color:var(--text-dim, var(--text-muted));">${esc(o.slug)}</div></td>
        <td>${Number(o.active) ? "Active" : "Deactivated"}</td>
        <td>${esc(o.legal_entity || "—")}${Number(o.legal_entity_verified) ? " ✓" : ""}</td>
        <td><button class="btn-min" type="button" data-org="${o.id}" data-to="${Number(o.active) ? 0 : 1}">
          ${Number(o.active) ? "Deactivate" : "Reactivate"}</button></td>
      </tr>`).join("")}</tbody></table>`;

    $("allOrgs").querySelectorAll("button[data-org]").forEach((b) => {
      b.onclick = () => askToggle(Number(b.dataset.org), Number(b.dataset.to),
        rows.find((o) => o.id === Number(b.dataset.org)).name);
    });
  }

  function askToggle(id, to, name) {
    const verb = to ? "Reactivate" : "Deactivate";
    const back = openModal(`
      <h2 style="margin-top:0;font-size:22px;">${verb} ${esc(name)}?</h2>
      <p style="color:var(--text-dim, var(--text-muted));font-size:15px;max-width:60ch;">
        ${to ? "It reappears in the organization switcher for every admin, and its API becomes reachable again."
             : "It disappears from the switcher and its API stops responding. Nothing is deleted — every record stays linked and it can be brought back here."}
      </p>
      <div class="og-field" style="margin:16px 0;">
        <label for="tWhy">Why?</label>
        <input id="tWhy" type="text" maxlength="200" placeholder="At least 10 characters" />
        <span class="hint">Written to the audit log.</span>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-min" type="button" id="tCancel">Cancel</button>
        <button class="btn-min primary" type="button" id="tGo" disabled>${verb}</button>
      </div>`);
    const why = back.querySelector("#tWhy"), go = back.querySelector("#tGo");
    why.addEventListener("input", () => { go.disabled = why.value.trim().length < 10; });
    back.querySelector("#tCancel").onclick = () => closeModal();
    go.onclick = async () => {
      const reason = why.value.trim();
      closeModal();
      const r = await api(`/api/admin/orgs/${id}/${to ? "reactivate" : "deactivate"}`,
        { method: "POST", body: JSON.stringify({ reason }) });
      if (!r.ok) return setSaid(r.data.error || "Couldn't change the status.", "bad");
      setSaid(`${r.data.name} is now ${to ? "active" : "deactivated"}.`, "ok");
      loadAllOrgs();
    };
  }

  /* ---------------- modules on the admin menu (v0.128.0, P-1) ----------------
     Rendered from window.BT_MODULES — admin-nav.js loads before this file on every admin page and
     is the ONE registry; this screen deliberately carries no module→pages list of its own
     (org_modules.test.mjs pins that). Checked = shown. The server stores only the OFF list, so a
     module added to the registry later is shown everywhere without anyone re-saving. */

  async function loadModules() {
    const grid = $("modulesGrid"), saveBtn = $("modulesSave"), said = $("modulesSaid");
    if (!grid || !window.BT_MODULES) return;
    const r = await api("/api/admin/org/modules");
    if (!r.ok) { grid.textContent = "Couldn't load the module list."; return; }
    let saved = new Set(r.data.off || []);

    grid.innerHTML = window.BT_MODULES.map((mod) => `
      <label class="og-module">
        <input type="checkbox" data-mod="${esc(mod.key)}" ${saved.has(mod.key) ? "" : "checked"} />
        <span>${esc(mod.label)}</span>
      </label>`).join("");

    const currentOff = () => Array.from(grid.querySelectorAll("[data-mod]"))
      .filter((c) => !c.checked).map((c) => c.dataset.mod);
    const dirty = () => {
      const now = currentOff();
      return now.length !== saved.size || now.some((k) => !saved.has(k));
    };
    grid.addEventListener("change", () => {
      saveBtn.disabled = !dirty();
      said.textContent = dirty() ? "Unsaved changes" : "";
    });
    saveBtn.addEventListener("click", async () => {
      const off = currentOff();
      const put = await api("/api/admin/org/modules", { method: "PUT", body: JSON.stringify({ off }) });
      if (!put.ok) { said.textContent = put.data.error || "Couldn't save."; return; }
      saved = new Set(put.data.off || []);
      saveBtn.disabled = true;
      said.textContent = "Saved. Menus update on the next page load.";
    });
  }

  /* ---------------- your default organization (§6 item 1, v0.169.0) ----------------
     A PERSONAL setting living on an ORG page, so it gets its own control and its own write.
     Folding it into "Save changes" would put a `users` write behind a button whose label promises
     an organization write — somebody editing the org would silently change their own account.
     Separate button, separate call, separate message.

     The button BELIEVES THE SERVER, not the click: `current` is re-read from the response rather
     than assumed, so a refused or partially-applied write can never leave the label claiming a
     state the database does not hold. */
  function wireDefaultOrg() {
    const btn = $("defOrgBtn"), said = $("defOrgSaid");
    if (!btn || !said) return;
    const orgId = Number((loaded && loaded.id) || localStorage.getItem("bt_org") || 0);
    if (!orgId) return;
    let current = Number((me.user && me.user.default_org_id) || 0);

    function paint() {
      const isDefault = current === orgId;
      btn.textContent = isDefault ? "Clear my default" : "Make this my default";
      btn.disabled = false;
      said.className = "og-said";
      said.textContent = isDefault
        ? "This organization opens first for you."
        : current ? "Another organization is currently your default."
                  : "You have no default set.";
    }
    paint();

    btn.onclick = async () => {
      const next = current === orgId ? null : orgId;
      btn.disabled = true;
      const r = await api("/api/me/default-org", { method: "PUT", body: JSON.stringify({ org_id: next }) });
      btn.disabled = false;
      if (!r.ok) {
        said.className = "og-said bad";
        said.textContent = (r.data && r.data.error) || "Couldn't save that.";
        return;
      }
      current = Number((r.data && r.data.default_org_id) || 0);
      paint();
      said.className = "og-said ok";
      said.textContent = current === orgId
        ? "Saved — this organization opens first for you."
        : "Saved — your default is cleared.";
    };
  }

  /* ---------------- push test (RF-12: moved here from the member Settings page) ---------------- */

  function wirePushTest() {
    const ptb = $("pushTestBtn");
    if (!ptb) return;
    ptb.onclick = async () => {
      ptb.disabled = true; ptb.textContent = "Sending…";
      const r = await api("/api/admin/push/test", { method: "POST", body: "{}" });
      ptb.disabled = false;
      ptb.textContent = r.ok ? `Sent to ${r.data.sent || 0} device${(r.data.sent || 0) === 1 ? "" : "s"}` : ((r.data && r.data.error) || "Failed");
      setTimeout(() => { ptb.textContent = "Send test"; }, 4000);
    };
  }

  /* ---------------- boot ---------------- */

  async function load() {
    const r = await api("/api/admin/org/profile");
    if (!r.ok) return fail(r.data.error || "Couldn't load organization settings.");
    render(r.data.org, r.data.missing_critical);
  }

  try {
    await load();
    wireDefaultOrg();   // after load(): it reads `loaded.id`
    wirePushTest();     // RF-12: the /api/admin/push/test caller lives on an admin page now
    await loadModules();
    await loadAllOrgs();
  } catch (e) {
    fail("Couldn't load this page. Reload to try again.");
  }
})();
