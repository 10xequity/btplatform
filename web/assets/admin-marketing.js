/* Boomtown Platform — Marketing & Email (admin)
   File: web/assets/admin-marketing.js · Version: v1.0 · Date: 2026-07-24 · Ships in: v0.16.0
   Segments (create/edit/preview with live counts), campaigns (compose → test → send →
   batch progress), compliance address, sandbox-mode messaging. Uses BT_ADMIN helpers;
   errors always render through fail() (Back + Dashboard, standing rule 2). */
(async function () {
  const { api, guard, esc, openModal, closeModal } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);
  const fmt = (s) => String(s || "").replace("T", " ").slice(0, 16);

  let SEGMENTS = [];

  /* ---------- overview strip + settings ---------- */
  async function loadOverview() {
    const r = await api("/api/admin/marketing/overview");
    if (!r.ok) return fail(r.data.error || "Could not load marketing overview.");
    const o = r.data;
    $("overviewStrip").innerHTML =
      `<span class="mkt-chip"><b>${o.reachable}</b> reachable contacts</span>` +
      `<span class="mkt-chip">${o.unsubscribed} unsubscribed (never emailed)</span>` +
      (o.email_mode === "sandbox"
        ? `<span class="mkt-chip warn">SANDBOX — no real emails until the Brevo key is set</span>`
        : `<span class="mkt-chip">Email: Brevo connected</span>`) +
      (o.address_set ? `<span class="mkt-chip">Address on file ✓</span>`
                     : `<span class="mkt-chip warn">Mailing address missing — sending blocked</span>`);
    if (o.mailing_address) $("mailAddr").value = o.mailing_address;
  }

  $("saveAddrBtn").onclick = async () => {
    const r = await api("/api/admin/marketing/settings", {
      method: "POST", body: JSON.stringify({ mailing_address: $("mailAddr").value }),
    });
    $("addrMsg").textContent = r.ok ? "Saved." : (r.data.error || "Could not save.");
    if (r.ok) loadOverview();
  };

  /* ---------- segments ---------- */
  async function loadSegments() {
    const r = await api("/api/admin/marketing/segments");
    if (!r.ok) return fail(r.data.error || "Could not load segments.");
    SEGMENTS = r.data.segments || [];
    $("segList").innerHTML = SEGMENTS.length ? SEGMENTS.map((s) => `
      <div class="mkt-row" data-id="${s.id}">
        <div class="grow"><div class="k">${esc(s.name)}</div>
          <div class="v">${esc(describeFilter(s.filter))}</div></div>
        <span class="status-pill"><b>${s.count}</b> people</span>
        <button class="btn ghost" data-act="preview">Preview</button>
        <button class="btn ghost" data-act="edit">Edit</button>
        <button class="btn ghost" data-act="del">Delete</button>
      </div>`).join("")
      : `<p class="help-text" style="margin:8px 0 0">No segments yet — create one to choose who gets your first campaign.</p>`;
    $("segList").querySelectorAll("button").forEach((b) => {
      const id = Number(b.closest(".mkt-row").dataset.id);
      if (b.dataset.act === "preview") b.onclick = () => previewSegment(id);
      if (b.dataset.act === "edit") b.onclick = () => segmentModal(SEGMENTS.find((s) => s.id === id));
      if (b.dataset.act === "del") b.onclick = () => deleteSegment(id);
    });
  }

  function describeFilter(f) {
    const bits = [];
    if (f.tags && f.tags.length) bits.push(`tag: ${f.tags.join(", ")}`);
    if (f.played === "any") bits.push("played anything");
    if (f.played === "league") bits.push("played a league");
    if (f.played === "tournament") bits.push("played a tournament");
    if (f.played === "none") bits.push("never played yet");
    if (f.since) bits.push(`joined since ${f.since}`);
    return bits.length ? bits.join(" · ") : "Everyone reachable";
  }

  function segmentModal(seg) {
    const f = (seg && seg.filter) || {};
    openModal(`
      <h2 style="margin-top:0">${seg ? "Edit segment" : "New segment"}</h2>
      <div class="mkt-form">
        <label for="mSegName">Name</label>
        <input id="mSegName" value="${seg ? esc(seg.name) : ""}" placeholder="League players, fall" />
        <label for="mSegTags">Has any of these tags (comma-separated, optional)</label>
        <input id="mSegTags" value="${f.tags ? esc(f.tags.join(", ")) : ""}" placeholder="newsletter, queens-club" />
        <label for="mSegPlayed">Play history</label>
        <select id="mSegPlayed">
          <option value="">Doesn't matter</option>
          <option value="any" ${f.played === "any" ? "selected" : ""}>Played anything</option>
          <option value="league" ${f.played === "league" ? "selected" : ""}>Played a league</option>
          <option value="tournament" ${f.played === "tournament" ? "selected" : ""}>Played a tournament</option>
          <option value="none" ${f.played === "none" ? "selected" : ""}>Never played yet</option>
        </select>
        <label for="mSegSince">Joined on or after (optional)</label>
        <input id="mSegSince" type="date" value="${f.since || ""}" />
        <div class="mkt-actions">
          <button class="btn" id="mSegSave">${seg ? "Save changes" : "Create segment"}</button>
          <button class="btn ghost" id="mSegCancel">Cancel</button>
          <span class="mkt-hint" id="mSegMsg" role="status"></span>
        </div>
      </div>`);
    $("mSegCancel").onclick = closeModal;
    $("mSegSave").onclick = async () => {
      const body = JSON.stringify({
        name: $("mSegName").value,
        filter: {
          tags: $("mSegTags").value.split(",").map((t) => t.trim()).filter(Boolean),
          played: $("mSegPlayed").value || undefined,
          since: $("mSegSince").value || undefined,
        },
      });
      const r = seg
        ? await api(`/api/admin/marketing/segments/${seg.id}/update`, { method: "POST", body })
        : await api("/api/admin/marketing/segments", { method: "POST", body });
      if (!r.ok) { $("mSegMsg").textContent = r.data.error || "Could not save."; return; }
      closeModal(); loadSegments();
    };
  }
  $("newSegBtn").onclick = () => segmentModal(null);

  async function previewSegment(id) {
    const r = await api(`/api/admin/marketing/segments/${id}/preview`);
    if (!r.ok) return fail(r.data.error || "Could not preview.");
    openModal(`
      <h2 style="margin-top:0">Who's in this segment</h2>
      <p><b>${r.data.count}</b> reachable people. First ${r.data.sample.length}:</p>
      ${r.data.sample.map((c) => `<div class="mkt-row"><div class="grow"><div class="k">${esc(c.full_name || "(no name)")}</div><div class="v">${esc(c.email)}</div></div></div>`).join("") || "<p>No one matches yet.</p>"}
      <div class="mkt-actions"><button class="btn ghost" id="mPrevClose">Close</button></div>`);
    $("mPrevClose").onclick = closeModal;
  }

  async function deleteSegment(id) {
    if (!confirm("Delete this segment? Campaigns already sent keep their records.")) return;
    const r = await api(`/api/admin/marketing/segments/${id}/delete`, { method: "POST" });
    if (!r.ok) return fail(r.data.error || "Could not delete.");
    loadSegments();
  }

  /* ---------- campaigns ---------- */
  async function loadCampaigns() {
    const r = await api("/api/admin/marketing/campaigns");
    if (!r.ok) return fail(r.data.error || "Could not load campaigns.");
    const rows = r.data.campaigns || [];
    $("campList").innerHTML = rows.length ? rows.map((c) => `
      <div class="mkt-row" data-id="${c.id}">
        <div class="grow"><div class="k">${esc(c.name)}${c.sandbox ? " · sandbox" : ""}</div>
          <div class="v">${esc(c.subject || "(no subject)")} → ${esc(c.segment_name || "no segment")}
            ${c.status !== "draft" ? ` · ${c.sent_count}/${c.recipient_count} sent${c.queued_count ? `, ${c.queued_count} queued` : ""}` : ""}</div></div>
        <span class="status-pill ${esc(c.status)}">${esc(c.status)}</span>
        ${c.status === "draft" ? `<button class="btn ghost" data-act="edit">Edit</button>` : ""}
        ${c.status === "sending" ? `<button class="btn" data-act="batch">Send next batch</button>` : ""}
        ${c.status === "draft" ? `<button class="btn ghost" data-act="del">Delete</button>` : ""}
      </div>`).join("")
      : `<p class="help-text" style="margin:8px 0 0">No campaigns yet.</p>`;
    $("campList").querySelectorAll("button").forEach((b) => {
      const id = Number(b.closest(".mkt-row").dataset.id);
      if (b.dataset.act === "edit") b.onclick = () => campaignModal(id);
      if (b.dataset.act === "del") b.onclick = () => deleteCampaign(id);
      if (b.dataset.act === "batch") b.onclick = () => processBatch(id);
    });
  }

  async function campaignModal(id) {
    let c = { name: "", subject: "", html_body: "", segment_id: null };
    if (id) {
      const r = await api(`/api/admin/marketing/campaigns/${id}`);
      if (!r.ok) return fail(r.data.error || "Could not open campaign.");
      c = r.data.campaign;
    }
    openModal(`
      <h2 style="margin-top:0">${id ? "Edit campaign" : "New campaign"}</h2>
      <div class="mkt-form">
        <label for="mCName">Name (internal)</label>
        <input id="mCName" value="${esc(c.name)}" placeholder="Fall league early-bird" />
        <label for="mCSubj">Subject line</label>
        <input id="mCSubj" value="${esc(c.subject)}" placeholder="Fall leagues open Monday — early-bird pricing" />
        <label for="mCSeg">Send to segment</label>
        <select id="mCSeg"><option value="">Choose…</option>
          ${SEGMENTS.map((s) => `<option value="${s.id}" ${c.segment_id === s.id ? "selected" : ""}>${esc(s.name)} (${s.count})</option>`).join("")}
        </select>
        <label for="mCBody">Email body (HTML or plain text)</label>
        <textarea id="mCBody" placeholder="Hi {{first_name}}, ...">${esc(c.html_body)}</textarea>
        <p class="mkt-hint">Personalize with {{first_name}}, {{full_name}}, {{email}}. The legal footer (address + unsubscribe) is added automatically — never write your own.</p>
        <label for="mCTest">Test address</label>
        <input id="mCTest" type="email" placeholder="you@boomtownvb.com" />
        <div class="mkt-actions">
          <button class="btn ghost" id="mCSave">Save draft</button>
          <button class="btn ghost" id="mCTestBtn">Send test</button>
          <button class="btn" id="mCSendBtn">Send to segment</button>
          <button class="btn ghost" id="mCCancel">Cancel</button>
        </div>
        <div class="mkt-hint" id="mCMsg" role="status" style="margin-top:8px"></div>
        <div id="mCPreview" hidden class="preview-box"></div>
      </div>`);
    $("mCCancel").onclick = closeModal;

    const save = async () => {
      const body = JSON.stringify({
        name: $("mCName").value, subject: $("mCSubj").value,
        html_body: $("mCBody").value, segment_id: Number($("mCSeg").value) || null,
      });
      const r = id
        ? await api(`/api/admin/marketing/campaigns/${id}/update`, { method: "POST", body })
        : await api("/api/admin/marketing/campaigns", { method: "POST", body });
      if (r.ok && !id) id = r.data.id;
      return r;
    };
    $("mCSave").onclick = async () => {
      const r = await save();
      $("mCMsg").textContent = r.ok ? "Draft saved." : (r.data.error || "Could not save.");
      if (r.ok) loadCampaigns();
    };
    $("mCTestBtn").onclick = async () => {
      const s = await save();
      if (!s.ok) { $("mCMsg").textContent = s.data.error || "Save the draft first."; return; }
      const r = await api(`/api/admin/marketing/campaigns/${id}/test`, {
        method: "POST", body: JSON.stringify({ email: $("mCTest").value }),
      });
      $("mCMsg").textContent = r.ok ? (r.data.message || "Test sent.") : (r.data.error || "Test failed.");
      if (r.ok && r.data.preview_html) { $("mCPreview").hidden = false; $("mCPreview").innerHTML = r.data.preview_html; }
    };
    $("mCSendBtn").onclick = async () => {
      const s = await save();
      if (!s.ok) { $("mCMsg").textContent = s.data.error || "Save the draft first."; return; }
      if (!confirm("Send this campaign to the whole segment? Sent campaigns can't be edited.")) return;
      const r = await api(`/api/admin/marketing/campaigns/${id}/send`, { method: "POST" });
      $("mCMsg").textContent = r.ok ? r.data.message : (r.data.error || "Could not send.");
      if (r.ok) { loadCampaigns(); loadOverview(); }
    };
  }
  $("newCampBtn").onclick = () => campaignModal(null);

  async function deleteCampaign(id) {
    if (!confirm("Delete this draft?")) return;
    const r = await api(`/api/admin/marketing/campaigns/${id}/delete`, { method: "POST" });
    if (!r.ok) return fail(r.data.error || "Could not delete.");
    loadCampaigns();
  }

  async function processBatch(id) {
    const r = await api(`/api/admin/marketing/campaigns/${id}/process`, { method: "POST" });
    if (!r.ok) return fail(r.data.error || "Could not process the batch.");
    loadCampaigns();
  }

  await loadOverview();
  await loadSegments();
  await loadCampaigns();
})();
/* Changelog: v1.0 (2026-07-24) — initial admin UI for M14 Phase A. */
