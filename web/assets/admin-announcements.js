/* Boomtown Platform — Announcements (admin)
   File: web/assets/admin-announcements.js · Version: v1.0 · Date: 2026-08-02 · Ships in: v0.51.0
   Staff authoring over /api/admin/announcements (announcements.js v1.0, migration 0033).
   One always-open form (req #19: 0 clicks to start, 1 to save) · kind = news | cta.
   Owner rule of record (2026-08-02): the priority CTA is pinned and hide controls don't
   apply to it — a member's hide attempt is silently ignored server-side, the CTA simply
   stays, no error is surfaced. The UI states this plainly on the cta option.
   Live preview renders the EXACT member markup home.js uses (.ann-cta / .feed-item) so
   what staff see is what members get. Times: inputs are local; storage is UTC
   "YYYY-MM-DD HH:MM" (isLive() appends Z — one vocabulary with the server).
   Uses BT_ADMIN helpers; errors render through fail() (Back + Dashboard, rule 2). */
(async function () {
  const { api, guard, esc } = window.BT_ADMIN;
  const me = await guard();
  if (!me) return;
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.BT_ADMIN.fail($("app"), msg);

  let ROWS = [];
  let editingId = null;

  /* ---- time helpers: datetime-local (local) <-> "YYYY-MM-DD HH:MM" (UTC, server vocab) ---- */
  const toUtc = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace("T", " ");
  };
  const fromUtc = (v) => {
    if (!v) return "";
    const d = new Date(String(v).replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime())) return "";
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  /* Mirrors announcements.js isLive(): started (or unscheduled) and not yet ended. */
  function status(r) {
    const t = (v) => Date.parse(String(v).replace(" ", "T") + "Z");
    const now = Date.now();
    if (r.starts_at && t(r.starts_at) > now) return "scheduled";
    if (r.ends_at && t(r.ends_at) <= now) return "expired";
    return "live";
  }
  const STATUS_LABEL = { live: "Live", scheduled: "Scheduled", expired: "Ended" };

  /* ---------------- load + list ---------------- */
  async function load() {
    const r = await api("/api/admin/announcements");
    if (!r.ok) return fail(r.data.error || "Could not load announcements.");
    ROWS = r.data.announcements || [];
    render();
  }

  function render() {
    if (!ROWS.length) {
      $("annBody").innerHTML = `<tr><td colspan="4" class="muted">Nothing posted yet. The form above publishes straight to every member's home page.</td></tr>`;
      return;
    }
    $("annBody").innerHTML = ROWS.map((a) => {
      const st = status(a);
      return `
      <tr>
        <td><span class="ann-kind ${a.kind === "cta" ? "cta" : ""}">${a.kind === "cta" ? "Priority CTA" : "News"}</span></td>
        <td>
          <div class="ann-title">${esc(a.title)}</div>
          ${a.body ? `<div class="ann-snip">${esc(a.body)}</div>` : ""}
          ${a.link_url ? `<div class="ann-snip">Links to: ${esc(a.link_url)}</div>` : ""}
        </td>
        <td><span class="ann-st ${st}">${STATUS_LABEL[st]}</span>${a.starts_at || a.ends_at ? `<div class="ann-snip">${a.starts_at ? "from " + esc(fmtLocal(a.starts_at)) : ""}${a.ends_at ? " until " + esc(fmtLocal(a.ends_at)) : ""}</div>` : ""}</td>
        <td>
          <div class="ann-actions">
            <button class="btn sm ghost" data-act="edit" data-id="${a.id}">Edit</button>
            <button class="btn sm danger" data-act="del" data-id="${a.id}">Remove</button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  const fmtLocal = (v) => {
    const d = new Date(String(v).replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  /* ---------------- live preview — the member's exact markup ---------------- */
  // Parity rule: these two fragments are byte-for-byte the shapes home.js renders
  // (renderCtas' .ann-cta and renderGroups' news .feed-item, minus the member-only
  // hide button — staff preview has nothing to hide with).
  function preview() {
    const kind = document.querySelector('input[name="kind"]:checked').value;
    const title = $("fTitle").value.trim() || "Your headline";
    const body = $("fBody").value.trim();
    const url = $("fUrl").value.trim();
    const label = $("fLabel").value.trim();
    if (kind === "cta") {
      $("prevBox").innerHTML = `
      <div class="ann-cta">
        <div><b>${esc(title)}</b>
          ${body ? `<div class="b">${esc(body)}</div>` : ""}
          ${url ? `<a href="${esc(url)}">${esc(label || "Open")} &rarr;</a>` : ""}</div>
      </div>`;
    } else {
      $("prevBox").innerHTML = `<div class="feed-group"><h3>News</h3>
        <div class="feed-item"><div class="fx"><b>${esc(title)}</b>
          ${body ? `<span>${esc(body)}</span>` : ""}
          ${url ? `<span><a href="${esc(url)}">${esc(label || "More")}</a></span>` : ""}</div></div></div>`;
    }
    $("prevNote").textContent = kind === "cta"
      ? "Pinned at the top of every member's home box. Hide controls don't apply. It simply stays."
      : "Appears under News. Members can hide a single post or the whole News section.";
  }
  ["fTitle", "fBody", "fUrl", "fLabel"].forEach((id) => $(id).addEventListener("input", preview));
  document.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener("change", preview));

  /* ---------------- save / edit / delete ---------------- */
  function formBody() {
    return {
      kind: document.querySelector('input[name="kind"]:checked').value,
      title: $("fTitle").value.trim(),
      body: $("fBody").value.trim() || null,
      link_url: $("fUrl").value.trim() || null,
      link_label: $("fLabel").value.trim() || null,
      starts_at: toUtc($("fStart").value),
      ends_at: toUtc($("fEnd").value),
    };
  }

  function resetForm() {
    editingId = null;
    $("annForm").reset();
    $("saveBtn").textContent = "Post it";
    $("cancelBtn").hidden = true;
    $("formMsg").textContent = "";
    preview();
  }

  $("saveBtn").onclick = async () => {
    const b = formBody();
    if (!b.title) { $("formMsg").textContent = "A title is required."; return; }
    if (b.starts_at && b.ends_at && b.ends_at <= b.starts_at) {
      $("formMsg").textContent = "The end time has to be after the start time."; return;
    }
    $("saveBtn").disabled = true;
    const r = editingId
      ? await api(`/api/admin/announcements/${editingId}`, { method: "PUT", body: JSON.stringify(b) })
      : await api("/api/admin/announcements", { method: "POST", body: JSON.stringify(b) });
    $("saveBtn").disabled = false;
    if (!r.ok) { $("formMsg").textContent = r.data.error || "That didn't save. Try again."; return; }
    resetForm();
    load();
  };

  $("cancelBtn").onclick = resetForm;

  $("annBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const row = ROWS.find((x) => x.id === id);
    if (btn.dataset.act === "edit" && row) {
      editingId = id;
      document.querySelector(`input[name="kind"][value="${row.kind === "cta" ? "cta" : "news"}"]`).checked = true;
      $("fTitle").value = row.title || "";
      $("fBody").value = row.body || "";
      $("fUrl").value = row.link_url || "";
      $("fLabel").value = row.link_label || "";
      $("fStart").value = fromUtc(row.starts_at);
      $("fEnd").value = fromUtc(row.ends_at);
      $("saveBtn").textContent = "Save changes";
      $("cancelBtn").hidden = false;
      $("formMsg").textContent = "";
      preview();
      window.scrollTo({ top: 0 });
      return;
    }
    if (btn.dataset.act === "del") {
      // two-step confirm, FAQ precedent — no modal, one extra click max
      if (btn.dataset.armed !== "1") {
        btn.dataset.armed = "1";
        btn.textContent = "Really remove?";
        setTimeout(() => { btn.dataset.armed = "0"; btn.textContent = "Remove"; }, 4000);
        return;
      }
      const r = await api(`/api/admin/announcements/${id}`, { method: "DELETE" });
      if (!r.ok) { $("formMsg").textContent = r.data.error || "Couldn't remove that one."; return; }
      if (editingId === id) resetForm();
      load();
    }
  });

  preview();
  load();
})();
