/* Boomtown Platform — Membership fields (admin page script)
   File: web/assets/admin-member-fields.js · Version: v1.0 · Date: 2026-08-03 · Ships in: v0.61.0

   Drives the M22 registry shipped in v0.57.0.

   THE ONE THING THIS SCREEN MUST GET RIGHT is that hiding is not deleting. The server keeps every
   answer when a field goes inactive, so the UI says so out loud — on the button, in the row, and
   in the confirm — because a director who believes "hide" destroys data will never use it, and
   one who believes "delete" is reversible will lose a season of answers.

   Click budget (req #19): add a field = 1 click to open, 1 to save. Hide = 1 click, no dialog,
   because it is reversible. Delete = 1 click plus a confirm, because it is not. */
(function () {
  "use strict";
  const { api, esc, fail } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);

  let fields = [];
  let editingId = null;

  const TYPE_LABEL = {
    text: "Short text", textarea: "Long text", select: "List", checkbox: "Yes / no",
    number: "Number", date: "Date", email: "Email", phone: "Phone",
  };

  /* ---------- table ---------- */

  function whoSees(f) {
    const bits = [];
    if (f.member_visible) bits.push("Members");
    else bits.push("Staff only");
    if (f.show_on_forms) bits.push("public signup");
    return bits.join(" · ");
  }

  function row(f) {
    return `<tr>
      <td data-label="Question"><b>${esc(f.label)}</b>${f.required ? ' <span class="pill on">Required</span>' : ""}
        ${f.help_text ? `<div class="mf-note">${esc(f.help_text)}</div>` : ""}
        ${f.field_type === "select" && f.options.length ? `<div class="mf-note">${f.options.map(esc).join(" · ")}</div>` : ""}</td>
      <td data-label="Type">${esc(TYPE_LABEL[f.field_type] || f.field_type)}</td>
      <td data-label="Who sees it">${esc(whoSees(f))}</td>
      <td data-label="Status">${f.active
        ? '<span class="pill on">On</span>'
        : '<span class="pill off">Hidden</span> <span class="mf-note">answers kept</span>'}</td>
      <td data-label="Actions" class="mf-actions-cell"><div class="mf-actions">
        <button class="btn ghost" data-edit="${f.id}">Edit</button>
        <button class="btn ghost" data-toggle="${f.id}">${f.active ? "Hide" : "Turn back on"}</button>
        <button class="btn ghost" data-del="${f.id}">Delete</button>
      </div></td>
    </tr>`;
  }

  async function load() {
    const r = await api("/api/admin/member-fields");
    if (!r.ok) return fail("fBody", r.data.error || "Couldn't load the fields.");
    fields = r.data.fields || [];
    $("fBody").innerHTML = fields.map(row).join("");
    $("fEmpty").hidden = fields.length > 0;
    wire();
  }

  function wire() {
    $("fBody").querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => edit(Number(b.dataset.edit))));
    $("fBody").querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () => toggle(Number(b.dataset.toggle))));
    $("fBody").querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => remove(Number(b.dataset.del))));
  }

  /* ---------- actions ---------- */

  async function toggle(id) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    // No confirm: hiding is reversible and keeps every answer. Asking would imply otherwise.
    const r = await api(`/api/admin/member-fields/${id}`, {
      method: "PATCH", body: JSON.stringify({ active: !f.active }),
    });
    if (!r.ok) return fail("fBody", r.data.error || "Couldn't change that field.");
    load();
  }

  async function remove(id) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    if (!window.confirm(
      `Delete "${f.label}"?\n\nIf you only want it off forms and profiles, use Hide instead; that keeps every answer and can be undone.`
    )) return;
    const r = await api(`/api/admin/member-fields/${id}`, { method: "DELETE" });
    if (!r.ok) return fail("fBody", r.data.error || "Couldn't delete that field.");
    load();
  }

  function edit(id) {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    editingId = id;
    $("fLabel").value = f.label;
    $("fType").value = f.field_type;
    $("fOpts").value = (f.options || []).join("\n");
    $("fHelp").value = f.help_text || "";
    $("fReq").checked = !!f.required;
    $("fVis").checked = !!f.member_visible;
    $("fForms").checked = !!f.show_on_forms;
    $("fSave").textContent = "Save changes";
    syncOptions();
    $("fForm").hidden = false;
    $("fLabel").focus();
  }

  function resetForm() {
    editingId = null;
    ["fLabel", "fOpts", "fHelp"].forEach((k) => { $(k).value = ""; });
    $("fType").value = "text";
    $("fReq").checked = false;
    $("fVis").checked = true;
    $("fForms").checked = false;
    $("fSave").textContent = "Save field";
    $("fErr").textContent = "";
    syncOptions();
  }

  /** The choices box only makes sense for a list, so it only exists for a list. */
  function syncOptions() {
    $("fOptWrap").hidden = $("fType").value !== "select";
  }

  async function submit(e) {
    e.preventDefault();
    $("fErr").textContent = "";
    const body = {
      label: $("fLabel").value.trim(),
      field_type: $("fType").value,
      options: $("fOpts").value.split("\n").map((s) => s.trim()).filter(Boolean),
      help_text: $("fHelp").value.trim(),
      required: $("fReq").checked,
      member_visible: $("fVis").checked,
      show_on_forms: $("fForms").checked,
    };

    const save = $("fSave");
    const label = save.textContent;
    save.disabled = true; save.textContent = "Saving…";
    const r = editingId
      ? await api(`/api/admin/member-fields/${editingId}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api("/api/admin/member-fields", { method: "POST", body: JSON.stringify(body) });
    save.disabled = false; save.textContent = label;

    if (!r.ok) {
      // 409 with existing_id means the field is there but hidden. Say that, and say what to do —
      // the server already worded it; repeating it in our own words would drift.
      $("fErr").textContent = r.data.error || "Couldn't save that field.";
      return;
    }
    resetForm();
    $("fForm").hidden = true;
    load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("fNew").addEventListener("click", () => {
      const showing = !$("fForm").hidden;
      if (showing) { $("fForm").hidden = true; return; }
      resetForm();
      $("fForm").hidden = false;
      $("fLabel").focus();
    });
    $("fCancel").addEventListener("click", () => { resetForm(); $("fForm").hidden = true; });
    $("fType").addEventListener("change", syncOptions);
    $("fForm").addEventListener("submit", submit);
    load();
  });
})();
