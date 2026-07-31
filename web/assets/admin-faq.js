/* Boomtown Platform — Help & FAQ (admin)
   File: web/assets/admin-faq.js · Version: v1.0 · Date: 2026-07-30 · Ships in: v0.40.0
   New/edit form (one form, create or update) · publish toggle saves itself in one click
   (req #19) · up/down reordering persists sort_order · soft delete with a two-step confirm.
   Uses BT_ADMIN helpers; errors render through fail() (Back + Dashboard, rule 2). */
(async function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);

  let ROWS = [];
  let editingId = null;

  async function load() {
    const r = await api("/api/admin/faqs");
    if (!r.ok) return fail(r.data.error || "Could not load the FAQ list.");
    ROWS = r.data.faqs || [];
    render();
  }

  function render() {
    if (!ROWS.length) {
      $("faqBody").innerHTML = `<tr><td colspan="4" class="muted">No articles yet. “New article” starts the first one — it stays a draft until you publish it.</td></tr>`;
      return;
    }
    $("faqBody").innerHTML = ROWS.map((f, i) => `
      <tr>
        <td>
          <div class="faq-actions">
            <button class="btn small ghost" data-act="up" data-id="${f.id}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button class="btn small ghost" data-act="down" data-id="${f.id}" ${i === ROWS.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
          </div>
        </td>
        <td>
          <div class="faq-q">${esc(f.question)}</div>
          <div class="faq-preview">${esc(f.answer)}</div>
        </td>
        <td><span class="faq-pub ${f.published ? "on" : "off"}">${f.published ? "Published" : "Draft"}</span></td>
        <td>
          <div class="faq-actions">
            <button class="btn small" data-act="pub" data-id="${f.id}">${f.published ? "Unpublish" : "Publish"}</button>
            <button class="btn small ghost" data-act="edit" data-id="${f.id}">Edit</button>
            <button class="btn small danger" data-act="del" data-id="${f.id}">Delete</button>
          </div>
        </td>
      </tr>`).join("");
  }

  function openForm(f) {
    editingId = f ? f.id : null;
    $("fQ").value = f ? f.question : "";
    $("fA").value = f ? f.answer : "";
    $("fT").value = f ? (f.tags || "") : "";
    $("fPub").checked = f ? !!f.published : false;
    $("fSave").textContent = f ? "Save changes" : "Save article";
    $("faqForm").hidden = false;
    $("fQ").focus();
  }
  function closeForm() { $("faqForm").hidden = true; editingId = null; }

  $("faqNew").addEventListener("click", () => openForm(null));
  $("fCancel").addEventListener("click", closeForm);

  $("faqForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      question: $("fQ").value.trim(),
      answer: $("fA").value.trim(),
      tags: $("fT").value.trim(),
      published: $("fPub").checked,
    };
    const r = editingId
      ? await api(`/api/admin/faqs/${editingId}`, { method: "PUT", body: JSON.stringify(body) })
      : await api("/api/admin/faqs", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) return fail(r.data.error || "The article could not be saved.");
    closeForm();
    await load();
  });

  $("faqBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = +btn.dataset.id;
    const f = ROWS.find((x) => x.id === id);
    if (!f) return;
    const act = btn.dataset.act;

    if (act === "edit") return openForm(f);

    if (act === "pub") {
      const r = await api(`/api/admin/faqs/${id}`, { method: "PUT", body: JSON.stringify({ published: !f.published }) });
      if (!r.ok) return fail(r.data.error || "The publish change did not save.");
      return load();
    }

    if (act === "del") {
      if (btn.dataset.armed !== "1") { btn.dataset.armed = "1"; btn.textContent = "Really delete?"; return; }
      const r = await api(`/api/admin/faqs/${id}/delete`, { method: "POST" });
      if (!r.ok) return fail(r.data.error || "The article could not be deleted.");
      return load();
    }

    if (act === "up" || act === "down") {
      const i = ROWS.indexOf(f);
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ROWS.length) return;
      [ROWS[i], ROWS[j]] = [ROWS[j], ROWS[i]];
      // Persist both swapped positions; index IS the order.
      const a = await api(`/api/admin/faqs/${ROWS[i].id}`, { method: "PUT", body: JSON.stringify({ sort_order: i }) });
      const b = await api(`/api/admin/faqs/${ROWS[j].id}`, { method: "PUT", body: JSON.stringify({ sort_order: j }) });
      if (!a.ok || !b.ok) return fail("Reordering did not save — refresh and try again.");
      return load();
    }
  });

  await load();
})();
