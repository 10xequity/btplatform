/* Boomtown Platform — Waivers (admin)
   File: web/assets/admin-waivers.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.22.0
   Publish a new waiver version · list history with signature counts · read any past text.

   Publishing is two-step on purpose: the confirm dialog shows the exact text about to become
   binding and, for a material change, names how many members will be prompted to re-sign.
   A published version is never edited — corrections are a new version marked minor.
   Uses BT_ADMIN helpers; errors render through fail() (Back + Dashboard, rule 2). */
(async function () {
  const { api, guard, esc, fmtDT } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);
  const show = (text, ok) => { const m = $("wvMsg"); m.className = "msg " + (ok ? "ok" : "err"); m.textContent = text; };

  const BODY_MIN = 50;
  let ACTIVE_SIGNERS = 0;
  let VERSIONS = [];

  /* ---------------- load ---------------- */

  async function load() {
    const r = await api("/api/admin/waivers/versions");
    if (!r.ok) return fail(r.data.error || "Could not load waiver versions.");
    VERSIONS = r.data.versions || [];
    ACTIVE_SIGNERS = Number(r.data.active_signer_count || 0);
    renderCurrent();
    renderHistory();
    renderImpact();
  }

  function displayLabel(v) {
    return v.label === "v1-legacy" ? "v1 (pre-versioning)" : v.label;
  }

  function renderCurrent() {
    const cur = VERSIONS.find((v) => v.status === "active");
    const box = $("wvCurrent");
    if (!cur) {
      box.innerHTML = `<h2>No waiver published</h2>
        <p class="wv-meta">Registrations are blocked until a waiver is published. Paste your document on the left and publish it.</p>`;
      return;
    }
    box.innerHTML = `
      <h2>Live now — ${esc(displayLabel(cur))}</h2>
      <div class="wv-meta">
        Published ${esc(fmtDT(cur.published_at))} · ${Number(cur.signature_count).toLocaleString()} signature${Number(cur.signature_count) === 1 ? "" : "s"} pinned · ${Number(cur.body_chars).toLocaleString()} characters
      </div>
      ${cur.notes ? `<div class="wv-meta" style="margin-top:4px">Note: ${esc(cur.notes)}</div>` : ""}
      <button class="btn ghost" data-view="${cur.id}" style="margin-top:12px;min-height:44px">Read the live text</button>`;
  }

  function renderHistory() {
    if (!VERSIONS.length) { $("wvBodyRows").innerHTML = `<tr><td colspan="5" class="muted">Nothing published yet.</td></tr>`; return; }
    $("wvBodyRows").innerHTML = VERSIONS.map((v) => {
      const statusClass = v.label === "v1-legacy" ? "legacy" : v.status;
      const statusText = v.label === "v1-legacy" && v.status !== "active" ? "legacy" : v.status;
      return `<tr class="wv-row-in">
        <td><strong>${esc(displayLabel(v))}</strong> <span class="wv-pill ${esc(statusClass)}">${esc(statusText)}</span></td>
        <td>${esc(fmtDT(v.published_at))}</td>
        <td>${Number(v.material) === 1 ? "Material" : `<span class="wv-pill minor">Minor</span>`}</td>
        <td>${Number(v.signature_count).toLocaleString()}</td>
        <td><button class="btn ghost" data-view="${v.id}" style="min-height:44px">Read</button></td>
      </tr>`;
    }).join("");
  }

  function renderImpact() {
    const box = $("wvImpact");
    const minor = $("wvMinor").checked;
    if (!ACTIVE_SIGNERS) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = minor
      ? `<strong>Minor edit:</strong> the ${ACTIVE_SIGNERS.toLocaleString()} member${ACTIVE_SIGNERS === 1 ? "" : "s"} with a current waiver will <strong>not</strong> be asked to re-sign. Their signatures stay pinned to the text they read.`
      : `<strong>Material change:</strong> ${ACTIVE_SIGNERS.toLocaleString()} member${ACTIVE_SIGNERS === 1 ? " has" : "s have"} a current waiver and will be prompted to sign again. Existing signatures are kept exactly as they are.`;
  }

  /* ---------------- read a version ---------------- */

  async function viewVersion(id) {
    const r = await api(`/api/admin/waivers/versions/${encodeURIComponent(id)}`);
    if (!r.ok) return show(r.data.error || "Could not load that version.", false);
    const v = r.data.version;
    $("wvViewTitle").textContent = `Waiver ${displayLabel(v)}`;
    $("wvViewMeta").textContent = `Published ${fmtDT(v.published_at)} · ${Number(v.material) === 1 ? "material" : "minor"} · ${v.status}`;
    $("wvViewBody").textContent = v.body; // textContent, never innerHTML — this is untrusted stored text
    $("wvViewDlg").showModal();
    $("wvViewBody").focus();
  }

  /* ---------------- publish ---------------- */

  function readForm() {
    return {
      label: $("wvLabel").value.trim(),
      body: $("wvBody").value.replace(/\r\n/g, "\n").trim(),
      material: $("wvMinor").checked ? 0 : 1,
      notes: $("wvNotes").value.trim(),
    };
  }

  function openConfirm() {
    const f = readForm();
    if (!f.label) return show("Give this version a label first.", false);
    if (f.body.length < BODY_MIN) return show(`The waiver text looks too short (${f.body.length} characters). Paste the full document.`, false);
    if (VERSIONS.some((v) => v.label.toLowerCase() === f.label.toLowerCase())) {
      return show(`Version "${f.label}" already exists. Pick a new label.`, false);
    }
    show("", true);

    const cur = VERSIONS.find((v) => v.status === "active");
    $("wvConfirmText").innerHTML =
      `<p style="margin:0 0 8px">Publishing <strong>${esc(f.label)}</strong>${cur ? ` replaces <strong>${esc(displayLabel(cur))}</strong> as the live waiver` : " as the first live waiver"}.</p>` +
      (f.material === 1
        ? `<p style="margin:0"><strong>${ACTIVE_SIGNERS.toLocaleString()} member${ACTIVE_SIGNERS === 1 ? "" : "s"}</strong> with a current waiver will be prompted to sign again. Nobody's existing signature is altered.</p>`
        : `<p style="margin:0">Marked as a <strong>minor</strong> edit — nobody will be asked to re-sign.</p>`) +
      `<p style="margin:8px 0 0;color:var(--text-muted);font-size:13px">Published text cannot be edited afterwards. Read it once more:</p>`;
    $("wvConfirmBody").textContent = f.body;
    $("wvConfirmDlg").showModal();
  }

  async function doPublish() {
    const f = readForm();
    const btn = $("wvConfirmGo");
    btn.disabled = true; btn.textContent = "Publishing…";
    const r = await api("/api/admin/waivers/versions", { method: "POST", body: JSON.stringify(f) });
    btn.disabled = false; btn.textContent = "Publish";
    $("wvConfirmDlg").close();

    if (!r.ok) return show(r.data.error || "Could not publish that version.", false);
    $("wvLabel").value = ""; $("wvBody").value = ""; $("wvNotes").value = ""; $("wvMinor").checked = false;
    updateCount();
    await load();
    show(r.data.resign_prompted
      ? `Published ${f.label}. Members with a current waiver will be prompted to sign again.`
      : `Published ${f.label} as a minor edit. No re-signing required.`, true);
    $("wvMsg").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function updateCount() {
    const n = $("wvBody").value.replace(/\r\n/g, "\n").trim().length;
    const el = $("wvCount");
    el.textContent = `${n.toLocaleString()} characters`;
    el.className = "wv-count" + (n > 0 && n < BODY_MIN ? " warn" : "");
    if (n > 0 && n < BODY_MIN) el.textContent += ` — too short, paste the full document`;
  }

  /* ---------------- wiring ---------------- */

  $("wvBody").addEventListener("input", updateCount);
  $("wvMinor").addEventListener("change", renderImpact);
  $("wvPublish").onclick = openConfirm;
  $("wvConfirmGo").onclick = doPublish;
  $("wvConfirmCancel").onclick = () => $("wvConfirmDlg").close();
  $("wvViewClose").onclick = () => $("wvViewDlg").close();
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (btn) viewVersion(btn.dataset.view);
  });

  updateCount();
  await load();
})();
