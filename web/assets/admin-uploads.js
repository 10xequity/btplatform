/* Boomtown Platform — Files (admin)
   File: web/assets/admin-uploads.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.30.0

   Uses BT_ADMIN helpers; errors render through fail() so no page dead-ends (standing rule 2).

   WHY XMLHttpRequest AND NOT fetch
   fetch() has no upload progress event. A 9 MB file over venue wifi is a twenty-second wait, and
   a spinner that cannot say "70%" is indistinguishable from a hang — the operator cancels and
   retries, doubling the load. XHR is the only way to read upload.onprogress today, so this one
   call site uses it and rebuilds the three headers api() would have set. Everything else on the
   page goes through api().

   OPTIMISTIC UI (standards §3): a queue row appears the instant a file is picked, before the
   request is sent. The row is the receipt. It turns positive on 201, danger on failure, and the
   failure text is the server's own sentence rather than a generic "upload failed".
*/
(async function () {
  const { api, guard, esc, fail: failBox } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;

  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const $ = (id) => document.getElementById(id);
  const fail = (m) => failBox($("app"), m);

  const KIND_LABELS = {
    photo: "Photo", logo: "Logo", roster: "Roster", schedule: "Schedule", form: "Form",
    receipt: "Receipt", report: "Report", policy: "Policy", import: "Import", other: "Other",
  };
  const VIS_LABELS = { private: "Staff only", members: "Members", public: "Public" };

  const bytesHuman = (n) => {
    const b = Number(n) || 0;
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  };
  const when = (s) => String(s || "").replace("T", " ").slice(0, 16);

  /* ---------------- kind pickers ---------------- */
  const kinds = Object.keys(KIND_LABELS);
  $("kind").innerHTML = kinds.map((k) =>
    `<option value="${k}"${k === "other" ? " selected" : ""}>${esc(KIND_LABELS[k])}</option>`).join("");
  $("fKind").innerHTML = `<option value="">All labels</option>` +
    kinds.map((k) => `<option value="${k}">${esc(KIND_LABELS[k])}</option>`).join("");

  /* Public is a real consequence, so it is stated at the moment of choosing rather than
     discovered afterwards. Not a modal — a modal for a select is friction, not safety (§8.3). */
  $("vis").addEventListener("change", () => {
    const v = $("vis").value;
    $("visHint").textContent =
      v === "public" ? "Anyone with the link can open these without signing in."
      : v === "members" ? "Any signed-in member of this organization can open these."
      : "Staff only is the default.";
    $("visHint").style.color = v === "public" ? "var(--warn, #e6a23c)" : "";
  });

  /* ---------------- drop zone ---------------- */
  const drop = $("drop"), input = $("file");
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) send(e.dataTransfer.files);
  });
  input.addEventListener("change", () => {
    if (input.files && input.files.length) { send(input.files); input.value = ""; }
  });

  /* ---------------- upload ---------------- */
  function send(fileList) {
    const kind = $("kind").value, vis = $("vis").value, notes = $("notes").value.trim();
    [...fileList].forEach((f) => one(f, kind, vis, notes));
  }

  function one(file, kind, visibility, notes) {
    const row = document.createElement("div");
    row.className = "up-item";
    row.innerHTML =
      `<div class="name"></div>
       <div class="meta">Uploading…</div>
       <div class="up-bar"><i></i></div>`;
    row.querySelector(".name").textContent = file.name; // textContent, never innerHTML — the
    row.setAttribute("role", "status");                 // filename is untrusted input
    $("queue").prepend(row);

    const bar = row.querySelector(".up-bar > i");
    const meta = row.querySelector(".meta");

    const qs = new URLSearchParams({
      filename: file.name,
      kind, visibility,
    });
    if (notes) qs.set("notes", notes);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", API + "/api/uploads?" + qs.toString(), true);
    xhr.withCredentials = true;
    // The three headers api() sets. Kept in step with admin-nav.js api() by hand — there is one
    // other place that builds these, and this comment is the pointer to it.
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    const tok = sessionStorage.getItem("bt_token") || localStorage.getItem("bt_token");
    if (tok) xhr.setRequestHeader("Authorization", "Bearer " + tok);
    const org = localStorage.getItem("bt_org");
    if (org) xhr.setRequestHeader("X-Org-Id", org);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      bar.style.width = pct + "%";
      meta.textContent = pct < 100 ? `${pct}% of ${bytesHuman(file.size)}` : "Finishing…";
    };

    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText || "{}"); } catch (e) {}
      if (xhr.status === 201 && d.upload) {
        row.classList.add("done");
        bar.style.width = "100%";
        meta.textContent = d.duplicate_of
          ? `Uploaded: identical to "${d.duplicate_of.filename}" already on file`
          : `Uploaded · ${bytesHuman(d.upload.bytes)} · ${VIS_LABELS[d.upload.visibility]}`;
        load();
      } else {
        row.classList.add("err");
        row.querySelector(".up-bar").remove();
        meta.textContent = d.error || `Upload failed (${xhr.status}).`;
      }
    };
    xhr.onerror = () => {
      row.classList.add("err");
      row.querySelector(".up-bar").remove();
      meta.textContent = "Can't reach the server. Check your connection and try again.";
    };
    xhr.send(file);
  }

  /* ---------------- list ---------------- */
  let TIMER = null;
  ["fKind", "fDel"].forEach((id) => $(id).addEventListener("change", load));
  $("fQ").addEventListener("input", () => { clearTimeout(TIMER); TIMER = setTimeout(load, 250); });

  function skeleton() {
    // The shape of the answer arrives before the answer (§3). Three rows is enough to read as
    // "a table is coming" without implying a count.
    $("list").innerHTML =
      `<table class="up-table"><tbody>${
        [0, 1, 2].map(() => `<tr><td><div class="sk" style="width:40%"></div></td>
          <td><div class="sk" style="width:60px"></div></td>
          <td><div class="sk" style="width:80px"></div></td>
          <td><div class="sk" style="width:120px"></div></td></tr>`).join("")
      }</tbody></table>`;
  }

  async function load() {
    skeleton();
    const q = new URLSearchParams({ limit: "100" });
    if ($("fKind").value) q.set("kind", $("fKind").value);
    if ($("fQ").value.trim()) q.set("q", $("fQ").value.trim());
    if ($("fDel").value === "1") q.set("include_deleted", "1");

    const r = await api("/api/uploads?" + q.toString());
    if (!r.ok) return fail(r.data.error || "Could not load files.");
    const { uploads, total, quota } = r.data;

    $("quota").textContent =
      `${total} file${total === 1 ? "" : "s"} · ${bytesHuman(quota.bytes_used)} stored · ` +
      `${quota.files} file limit · ${bytesHuman(quota.max_file_bytes)} per file`;

    if (!uploads.length) {
      // Empty state names the next action rather than the absence (R-18).
      $("list").innerHTML =
        `<div class="up-empty"><b>${$("fQ").value.trim() || $("fKind").value ? "Nothing matches that filter" : "No files yet"}</b>
         ${$("fQ").value.trim() || $("fKind").value
            ? "Clear the filter to see everything."
            : "Drop a roster, a schedule, or a logo into the box above to start."}</div>`;
      return;
    }

    $("list").innerHTML =
      `<table class="up-table">
        <thead><tr><th>File</th><th>Label</th><th>Visible to</th><th>Added</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${uploads.map(rowHtml).join("")}</tbody>
      </table>`;

    $("list").querySelectorAll("button[data-act]").forEach((b) => {
      b.addEventListener("click", () => act(b.dataset.act, Number(b.dataset.id), b.dataset.name));
    });
  }

  function rowHtml(u) {
    const gone = !!u.deleted_at;
    return `<tr class="${gone ? "gone" : ""}">
      <td><div class="up-name">${esc(u.filename)}</div>
          <div class="meta" style="font-size:13px;color:var(--text-dim,var(--text-muted))">
            ${bytesHuman(u.bytes)}${u.notes ? " · " + esc(u.notes) : ""}${gone ? " · removed" : ""}
          </div></td>
      <td><span class="up-chip">${esc(KIND_LABELS[u.kind] || u.kind)}</span></td>
      <td><span class="up-chip ${esc(u.visibility)}">${esc(VIS_LABELS[u.visibility] || u.visibility)}</span></td>
      <td>${esc(when(u.created_at))}${u.uploaded_by ? `<br><span style="font-size:12px;color:var(--text-dim,var(--text-muted))">${esc(u.uploaded_by)}</span>` : ""}</td>
      <td><div class="up-row-actions">
        ${gone
          ? `<button data-act="restore" data-id="${u.id}" data-name="${esc(u.filename)}">Restore</button>`
          : `<a href="${API}/api/uploads/${u.id}" target="_blank" rel="noopener">Open</a>
             <a href="${API}/api/uploads/${u.id}?download=1">Download</a>
             <button data-act="vis" data-id="${u.id}" data-name="${esc(u.filename)}">Visibility</button>
             <button class="danger" data-act="del" data-id="${u.id}" data-name="${esc(u.filename)}">Remove</button>`}
      </div></td></tr>`;
  }

  async function act(what, id, name) {
    if (what === "del") {
      // Soft delete, so the confirmation says so. A confirmation that overstates the consequence
      // trains people to click through it.
      if (!confirm(`Remove "${name}" from the list?\n\nThe file is kept and can be restored; switch "Show" to "Include removed".`)) return;
      const r = await api(`/api/uploads/${id}`, { method: "DELETE" });
      if (!r.ok) return fail(r.data.error || "Could not remove that file.");
      return load();
    }
    if (what === "restore") {
      const r = await api(`/api/uploads/${id}/restore`, { method: "POST" });
      if (!r.ok) return fail(r.data.error || "Could not restore that file.");
      return load();
    }
    if (what === "vis") {
      const next = prompt(`Who can see "${name}"?\n\nType: private, members, or public`, "private");
      if (!next) return;
      const v = String(next).trim().toLowerCase();
      if (!["private", "members", "public"].includes(v)) return fail("Type private, members, or public.");
      const r = await api(`/api/uploads/${id}`, { method: "PATCH", body: JSON.stringify({ visibility: v }) });
      if (!r.ok) return fail(r.data.error || "Could not change visibility.");
      return load();
    }
  }

  load();
})();
