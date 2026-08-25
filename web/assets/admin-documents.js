/* Boomtown Platform — Documents (admin)
   File: web/assets/admin-documents.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.31.0

   THE ONE STRUCTURAL DECISION HERE
   This file contains no token map and no token regex. The palette and the preview both come from
   the server (`/api/admin/documents/tokens`, `/api/admin/documents/preview`), which runs the same
   `resolveDocTokens` and the same widest-set literal-name scan that publishing runs. R-23 already
   records two deliberate copies of the token map in the worker; a third copy in JavaScript would
   be the one that tells the author "this is clean" a second before the server refuses. Preview is
   debounced at 300ms — one request per pause in typing, on a staff-only screen.

   MOTION (standards §2, frequency table)
   Token insert is a 100+/day action and has no animation, no transition and no scroll-into-view.
   The textarea keeps focus and the caret lands after the inserted token, so the author can keep
   typing without touching the mouse again. Click budget: 1 (§3, requirement 19).

   FAILURE (standing rule 8)
   Every error renders through BT_ADMIN.fail(), which draws Back + Dashboard, so no state on this
   page can dead-end.
*/
(async function () {
  const { api, guard, esc, fail: failBox, openModal, closeModal } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const $ = (id) => document.getElementById(id);
  const fail = (m) => failBox($("app"), m);

  const TOKEN_HELP = {
    ENTITY: "Full legal entity name", ENTITY_SHORT: "Short entity name",
    ORG_NAME: "Trading name", ORG_EMAIL: "Contact email", ORG_ADDRESS: "Full postal address",
    ORG_WEBSITE: "Website", ORG_PHONE: "Phone", ORG_CITY: "City", ORG_STATE: "State",
    ORG_POSTAL: "Postal code", GOVERNING_STATE: "Governing law state",
    ORG_TIMEZONE: "Time zone", RULES_REFERENCE: "Where the rules live",
    SIGNER_NAME: "Who signs", MEMBER_NAME: "The member", GUARDIAN_NAME: "Parent or guardian",
    CHILD_FIRST_NAME: "Child's first name", TODAY: "Date signed", EXPIRES: "Expiry date",
  };
  /* Signer tokens resolve at RENDER, not at publish (standards §9.1), so the server's publish-time
     resolver correctly leaves them alone. They are listed here for insertion only — never
     resolved, never validated against the org profile. */
  const SIGNER_TOKENS = ["SIGNER_NAME", "MEMBER_NAME", "GUARDIAN_NAME", "CHILD_FIRST_NAME", "TODAY", "EXPIRES"];

  let docs = [];
  let currentDoc = null;
  let lastPreview = null;

  /* ---------------- publish-readiness gate ---------------- */

  async function loadGate() {
    const r = await api("/api/admin/org/profile");
    if (!r.ok) return;
    const missing = r.data.missing_critical || [];
    const g = $("gate");
    g.hidden = false;
    if (!missing.length) {
      g.className = "dc-gate ok";
      g.innerHTML = `<div><b>${esc(r.data.org.name)} is ready to publish.</b>
        <p>Every token that has no fallback resolves.${
          Number(r.data.org.legal_entity_verified) === 1 ? ""
          : ` The legal entity name has not been confirmed against the Secretary of State; publishing still works, but you'll be warned. <a href="admin-org-settings.html">Confirm it</a>.`
        }</p></div>`;
    } else {
      g.className = "dc-gate";
      g.innerHTML = `<div><b>Publishing will refuse until the organization profile is filled in.</b>
        <p>Missing: ${missing.map((x) => esc(x.label)).join(", ")}.
        These have no fallback; a default would name the wrong party.
        <a href="admin-org-settings.html">Open organization settings</a>.</p></div>`;
    }
  }

  /* ---------------- token palette ---------------- */

  async function loadPalette() {
    const r = await api("/api/admin/documents/tokens");
    if (!r.ok) return fail(r.data.error || "Couldn't load the token list.");
    $("previewOrg").textContent = r.data.org_name ? `as ${r.data.org_name} sees it` : "";

    const orgHtml = (r.data.tokens || []).map((t) => btn(t.name, t.no_fallback, t.sample)).join("");
    const signerHtml = SIGNER_TOKENS.map((n) => btn(n, false, null, true)).join("");
    $("palette").innerHTML =
      `<div class="dc-palgroup"><div class="t">Organization: filled in when you publish</div>${orgHtml}</div>
       <div class="dc-palgroup"><div class="t">Signer: filled in when someone signs</div>${signerHtml}</div>`;

    $("palette").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tok]");
      if (b) insertToken(b.dataset.tok);
    });
  }

  function btn(name, noFallback, sample, signer) {
    const help = TOKEN_HELP[name] || "";
    const shown = signer ? "filled in at signing"
      : (sample && sample.length ? (sample.length > 34 ? sample.slice(0, 34) + "…" : sample) : "(empty)");
    return `<button class="dc-tok${noFallback ? " nofb" : ""}" type="button" data-tok="${esc(name)}">
      {{${esc(name)}}}<span class="d">${esc(help)}${help ? " · " : ""}${esc(shown)}</span></button>`;
  }

  /* ONE CLICK, NO ANIMATION (standards §9.3). setRangeText keeps the browser's own undo stack
     intact — reassigning .value would destroy it, and losing Ctrl+Z while drafting legal text is
     a worse defect than any styling choice on this page. */
  function insertToken(name) {
    const ta = $("body");
    const t = `{{${name}}}`;
    const start = ta.selectionStart ?? ta.value.length;
    ta.focus();
    if (typeof ta.setRangeText === "function") {
      ta.setRangeText(t, start, ta.selectionEnd ?? start, "end");
    } else {
      ta.value = ta.value.slice(0, start) + t + ta.value.slice(ta.selectionEnd ?? start);
      ta.selectionStart = ta.selectionEnd = start + t.length;
    }
    onEdit();
  }

  /* ---------------- documents ---------------- */

  async function loadDocs() {
    const r = await api("/api/admin/documents");
    if (!r.ok) return fail(r.data.error || "Couldn't load documents.");
    docs = r.data.documents || [];
    if (!docs.length) {
      $("docs").innerHTML = `<p style="font-size:14px;color:var(--text-dim, var(--text-muted));">
        No documents yet. Create one to get started.</p>`;
      renderVersions([]);
      return;
    }
    if (!currentDoc || !docs.some((d) => d.id === currentDoc.id)) currentDoc = docs[0];
    $("docs").innerHTML = docs.map((d) => `
      <button class="dc-doc" type="button" data-id="${d.id}" aria-current="${d.id === currentDoc.id}">
        ${esc(d.name)}
        <span class="meta">${d.version_count} version${d.version_count === 1 ? "" : "s"} ·
          ${d.signed_count} signed${d.requirement_id ? " · required" : ""}</span>
      </button>`).join("");
    $("docs").querySelectorAll("button[data-id]").forEach((b) => {
      b.onclick = () => { currentDoc = docs.find((d) => d.id === Number(b.dataset.id)); loadDocs(); loadVersions(); };
    });
    loadVersions();
  }

  async function loadVersions() {
    if (!currentDoc) return renderVersions([]);
    const r = await api(`/api/admin/documents/${currentDoc.id}/versions`);
    if (!r.ok) return fail(r.data.error || "Couldn't load versions.");
    renderVersions(r.data.versions || []);
  }

  function renderVersions(rows) {
    if (!rows.length) {
      $("versions").innerHTML = `<div class="dc-empty"><b>No versions yet</b>
        Write the text on the left and publish it. Nothing is enforced until you assign it.</div>`;
      return;
    }
    $("versions").innerHTML = `<table class="dc-table">
      <thead><tr><th>Label</th><th>Status</th><th>Change</th><th>Published</th><th>Fingerprint</th><th></th></tr></thead>
      <tbody>${rows.map((v) => `<tr>
        <td><b>${esc(v.label)}</b>${v.notes ? `<div class="sr-only">${esc(v.notes)}</div>` : ""}</td>
        <td><span class="dc-status${v.status === "active" ? " active" : ""}">${esc(v.status)}</span></td>
        <td>${Number(v.material) ? "Material" : "Minor"}</td>
        <td>${esc(String(v.published_at || "").replace("T", " ").slice(0, 16))}</td>
        <td class="dc-sha">${esc(String(v.body_sha || "").slice(0, 12))}</td>
        <td>${v.status === "active"
          ? `<button class="btn-min" type="button" data-assign="${v.id}">Who must sign it</button>` : ""}</td>
      </tr>`).join("")}</tbody></table>`;
    $("versions").querySelectorAll("button[data-assign]").forEach((b) => {
      b.onclick = () => openAssign(Number(b.dataset.assign));
    });
  }

  /* ---------------- live preview, server-resolved ---------------- */

  let timer = null;
  function onEdit() {
    $("charCount").textContent = `${$("body").value.length} characters`;
    clearTimeout(timer);
    timer = setTimeout(runPreview, 300);
  }

  async function runPreview() {
    const body = $("body").value;
    if (!body.trim()) {
      lastPreview = null;
      $("preview").textContent = "";
      $("chips").innerHTML = "";
      return setPublish(false, "Write the document text first.");
    }
    const r = await api("/api/admin/documents/preview", { method: "POST", body: JSON.stringify({ body }) });
    if (!r.ok) return setPublish(false, r.data.error || "Preview failed.");
    lastPreview = r.data;
    $("preview").textContent = r.data.text;

    const chips = [];
    (r.data.empty || []).forEach((t) => chips.push(chip(`{{${t}}} is empty`, "bad")));
    (r.data.unknown || []).forEach((t) => chips.push(chip(`{{${t}}} is not a token`, "bad")));
    if (r.data.bad_placeholder) chips.push(chip(`${r.data.bad_placeholder} would publish literally`, "bad"));
    (r.data.literal_names || []).forEach((n) => chips.push(chip(`"${n}" is a literal name`, "warn")));
    if (r.data.entity_unverified) chips.push(chip("Legal entity not confirmed", "warn"));
    if (!chips.length) chips.push(chip("Resolves cleanly", "ok"));
    $("chips").innerHTML = chips.join("");

    if (!r.data.ok) return setPublish(false, r.data.refusal || "This text cannot be published yet.");
    if ((r.data.literal_names || []).length) {
      return setPublish(true,
        `Contains the literal name ${r.data.literal_names.join(", ")}. Publishing will ask you to confirm.`, true);
    }
    setPublish(true, "");
  }

  const chip = (text, kind) => `<span class="dc-chip ${kind}">${esc(text)}</span>`;

  /* The reason is rendered BESIDE the disabled button, never instead of it (standards §9.3):
     a silently disabled control is indistinguishable from a broken one. */
  function setPublish(enabled, why, warnOnly) {
    $("publish").disabled = !enabled || !currentDoc;
    const w = $("why");
    w.textContent = !currentDoc ? "Select or create a document first." : (why || "");
    w.className = "dc-why" + (warnOnly ? " warn" : "");
  }

  $("body").addEventListener("input", onEdit);

  /* ---------------- publish ---------------- */

  async function publish(doPublish) {
    if (!currentDoc) return;
    const label = $("label").value.trim();
    if (!label) { $("label").focus(); return setPublish(true, "Give the version a label, for example v2."); }

    const payload = {
      label, body: $("body").value,
      material: $("material").value === "1",
      notes: $("notes").value.trim() || null,
      publish: !!doPublish,
    };
    let r = await api(`/api/admin/documents/${currentDoc.id}/versions`,
      { method: "POST", body: JSON.stringify(payload) });

    // 409 + needs_confirmation is the literal-name guard. Standards §7.3: bypassing a
    // member-facing rule takes a typed reason of at least 10 characters, never a checkbox.
    if (!r.ok && r.data && r.data.needs_confirmation) {
      const reason = await confirmLiteral(r.data.literal_names || []);
      if (!reason) return;
      payload.confirm_literal_names = true;
      payload.notes = (payload.notes ? payload.notes + " — " : "") + "Literal name confirmed: " + reason;
      r = await api(`/api/admin/documents/${currentDoc.id}/versions`,
        { method: "POST", body: JSON.stringify(payload) });
    }
    if (!r.ok) return setPublish(true, r.data.error || "Couldn't save this version.");

    $("label").value = ""; $("notes").value = "";
    setPublish(true, doPublish ? "Published." : "Saved as a draft.");
    await loadDocs();
  }

  function confirmLiteral(names) {
    return new Promise((resolve) => {
      const back = openModal(`
        <h2 style="margin-top:0;font-size:22px;">Publish with a literal name?</h2>
        <p style="color:var(--text-dim, var(--text-muted));font-size:15px;line-height:1.5;max-width:60ch;">
          The text contains ${names.map((n) => `<b>${esc(n)}</b>`).join(", ")} written out in full.
          Published to another organization, this document would name the wrong party; the release
          would run to the company in the text, not the one collecting the signature.
          Use <code>{{ENTITY}}</code> instead unless you mean it.
        </p>
        <div class="dc-field" style="margin:16px 0;">
          <label for="litWhy">Why is the literal name correct here?</label>
          <textarea id="litWhy" rows="2" maxlength="200"
            placeholder="At least 10 characters"></textarea>
          <span class="hint" id="litHint">This is written to the audit log.</span>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn-min" type="button" id="litCancel">Cancel</button>
          <button class="btn-min primary" type="button" id="litGo" disabled>Publish anyway</button>
        </div>`);
      const why = back.querySelector("#litWhy"), go = back.querySelector("#litGo");
      why.addEventListener("input", () => { go.disabled = why.value.trim().length < 10; });
      back.querySelector("#litCancel").onclick = () => { closeModal(); resolve(null); };
      go.onclick = () => { const v = why.value.trim(); closeModal(); resolve(v); };
    });
  }

  $("publish").onclick = () => publish(true);
  $("draft").onclick = () => publish(false);

  /* ---------------- assign: two radios, consequence under EACH ---------------- */

  async function openAssign(versionId) {
    const back = openModal(`
      <h2 style="margin-top:0;font-size:22px;">Who must sign this?</h2>
      <p style="color:var(--text-dim, var(--text-muted));font-size:15px;">
        ${esc(currentDoc.name)}: checking who this affects…</p>
      <div id="asBody"></div>`);

    const [fwd, retro] = await Promise.all([
      api("/api/admin/requirements/preview", { method: "POST",
        body: JSON.stringify({ document_id: currentDoc.id, version_id: versionId, retroactive: false }) }),
      api("/api/admin/requirements/preview", { method: "POST",
        body: JSON.stringify({ document_id: currentDoc.id, version_id: versionId, retroactive: true }) }),
    ]);
    if (!fwd.ok || !retro.ok) { closeModal(); return fail((fwd.data || retro.data).error || "Couldn't check who this affects."); }

    // The count IS the consequence, so it is written under each option rather than hidden behind
    // a checkbox (standards §9.3). Both numbers come from a server-side dry run — a client-side
    // array length is not a safety check.
    back.querySelector("#asBody").innerHTML = `
      <label class="dc-radio">
        <input type="radio" name="retro" value="0" checked /><b>New signatures only</b>
        <span class="csq">${esc(fwd.data.message)}</span>
      </label>
      <label class="dc-radio">
        <input type="radio" name="retro" value="1" /><b>Everyone signs again now</b>
        <span class="csq danger">${esc(retro.data.message)}</span>
      </label>
      <div class="dc-row" style="margin-top:12px;">
        <div class="dc-field"><label for="asWho">Applies to</label>
          <select id="asWho">
            <option value="all" selected>Everyone</option>
            <option value="adults">Adults only</option>
            <option value="minors">Minors only</option>
            <option value="staff">Staff only</option>
          </select></div>
        <div class="dc-field"><label for="asTerm">Valid for</label>
          <select id="asTerm">
            <option value="365" selected>One year</option>
            <option value="730">Two years</option>
            <option value="">Until replaced</option>
          </select></div>
      </div>
      <div id="asTyped" hidden class="dc-field" style="margin-bottom:12px;">
        <label for="asConfirm">Type the number of affected members to confirm</label>
        <input id="asConfirm" type="text" inputmode="numeric" autocomplete="off" />
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-min" type="button" id="asCancel">Cancel</button>
        <button class="btn-min primary" type="button" id="asGo">Assign</button>
      </div>`;

    const go = back.querySelector("#asGo");
    const typed = back.querySelector("#asTyped");
    const confirmField = back.querySelector("#asConfirm");
    const sync = () => {
      const isRetro = back.querySelector('input[name="retro"]:checked').value === "1";
      // Typed confirmation only above 50 (standards §7.5) — below that a modal is friction.
      const need = isRetro && retro.data.requires_typed_confirmation;
      typed.hidden = !need;
      go.disabled = need && confirmField.value.trim() !== String(retro.data.affected_count);
    };
    back.querySelectorAll('input[name="retro"]').forEach((r) => r.addEventListener("change", sync));
    confirmField.addEventListener("input", sync);
    sync();

    back.querySelector("#asCancel").onclick = () => closeModal();
    go.onclick = async () => {
      go.disabled = true;
      const term = back.querySelector("#asTerm").value;
      const r = await api("/api/admin/requirements", { method: "POST", body: JSON.stringify({
        document_id: currentDoc.id, version_id: versionId,
        applies_to: back.querySelector("#asWho").value,
        retroactive: back.querySelector('input[name="retro"]:checked').value === "1",
        term_days: term === "" ? null : Number(term),
      })});
      closeModal();
      if (!r.ok) return fail(r.data.error || "Couldn't assign this version.");
      await loadDocs();
    };
  }

  /* ---------------- new document ---------------- */

  $("newDoc").onclick = () => {
    const back = openModal(`
      <h2 style="margin-top:0;font-size:22px;">New document</h2>
      <div class="dc-field" style="margin-bottom:12px;">
        <label for="ndName">Name</label>
        <input id="ndName" type="text" maxlength="200" placeholder="Liability waiver" />
      </div>
      <div class="dc-field" style="margin-bottom:16px;">
        <label for="ndKind">Type</label>
        <select id="ndKind">
          <option value="waiver" selected>Waiver</option>
          <option value="policy">Policy</option>
          <option value="consent">Consent</option>
          <option value="media">Media release</option>
          <option value="code_of_conduct">Code of conduct</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-min" type="button" id="ndCancel">Cancel</button>
        <button class="btn-min primary" type="button" id="ndGo">Create</button>
      </div>`);
    back.querySelector("#ndCancel").onclick = () => closeModal();
    back.querySelector("#ndGo").onclick = async () => {
      const name = back.querySelector("#ndName").value.trim();
      if (!name) return back.querySelector("#ndName").focus();
      const r = await api("/api/admin/documents", { method: "POST", body: JSON.stringify({
        name, kind: back.querySelector("#ndKind").value })});
      closeModal();
      if (!r.ok) return fail(r.data.error || "Couldn't create the document.");
      currentDoc = null;
      await loadDocs();
    };
  };

  /* ---------------- boot ---------------- */
  try {
    await Promise.all([loadGate(), loadPalette(), loadDocs()]);
    setPublish(false, "Write the document text first.");
  } catch (e) {
    fail("Couldn't load this page. Reload to try again.");
  }
})();
