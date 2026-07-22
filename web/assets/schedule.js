/* Boomtown Platform — Public Schedule
   Version: v0.4.0 · Date: 2026-07-22
   Reads GET /api/schedule (no auth). What's visible (names/counts) is decided by the
   server-side view profile, never by this page. ?embed=1 → chromeless, posts its height
   to the parent so the widget iframe can auto-size. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const params = new URLSearchParams(location.search);
  const viewSlug = params.get("view") || "public";
  const embed = params.get("embed") === "1";
  if (embed) document.body.classList.add("embed");

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = c => c ? "$" + (c / 100).toFixed(2).replace(/\.00$/, "") : "Free";
  const TZ = "America/Denver";

  let events = [], mode = "list", org = "";
  let calCursor = new Date(); calCursor.setDate(1);

  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    mode = t.dataset.mode;
    document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x === t));
    render();
  }));
  document.getElementById("orgFilter").addEventListener("change", e => { org = e.target.value; load(); });

  async function load() {
    const from = new Date(); from.setDate(from.getDate() - 7);
    const to = new Date(); to.setDate(to.getDate() + 180);
    const qs = new URLSearchParams({ view: viewSlug, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    if (org) qs.set("org", org);
    let r;
    try { r = await (await fetch(`${API}/api/schedule?${qs}`)).json(); }
    catch { document.getElementById("schedBody").innerHTML = `<div class="empty">Can't reach the schedule right now — try refreshing.</div>`; return; }
    if (r.error) { document.getElementById("schedBody").innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
    events = r.events || [];
    document.getElementById("schedTitle").textContent = r.view && r.view.name !== "Public" ? `Schedule — ${r.view.name}` : "Schedule";
    const orgSel = document.getElementById("orgFilter");
    const seen = new Map(events.map(e => [e.org_id, e.org_name]));
    if (orgSel.options.length <= 1 && seen.size > 1) {
      for (const [id, name] of seen) orgSel.insertAdjacentHTML("beforeend", `<option value="${id}">${esc(name)}</option>`);
    }
    render();
  }

  function fmtTime(s) {
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  }

  function render() {
    const el = document.getElementById("schedBody");
    const upcoming = events.filter(e => e.status !== "cancelled");
    if (!upcoming.length) { el.innerHTML = `<div class="empty">Nothing scheduled yet — check back soon.</div>`; postHeight(); return; }
    if (mode === "list") {
      const future = upcoming.filter(e => new Date((e.starts_at || "").replace(" ", "T")) >= new Date(Date.now() - 86400000));
      el.innerHTML = (future.length ? future : upcoming).map(e => {
        const d = new Date((e.starts_at || "").replace(" ", "T"));
        return `<div class="sched-ev">
          <div class="sched-date"><div class="d">${d.getDate()}</div>
            <div class="m">${d.toLocaleString("en-US", { month: "short" })}</div></div>
          <div class="sched-body">
            <div class="sched-name">${esc(e.name)}</div>
            <div class="sched-meta">${fmtTime(e.starts_at)}${e.location ? " · " + esc(e.location) : ""} · ${esc(e.org_name)} · ${money(e.price_cents)}
              ${e.registered_count != null ? ` · ${e.registered_count} registered${e.capacity ? " / " + e.capacity : ""}` : ""}</div>
            ${e.team_names && e.team_names.length ? `<div class="sched-meta">Teams: ${e.team_names.map(esc).join(", ")}</div>` : ""}
          </div>
          ${e.status === "published" ? `<a class="btn sched-cta" href="register.html?event=${e.id}" ${embed ? 'target="_blank" rel="noopener"' : ""}>Sign up</a>` : ""}
        </div>`;
      }).join("");
    } else {
      const y = calCursor.getFullYear(), mo = calCursor.getMonth();
      const first = new Date(y, mo, 1);
      const start = new Date(first); start.setDate(1 - first.getDay());
      let html = `<div class="cal-toolbar">
          <button class="btn ghost" id="cp" aria-label="Previous month">‹</button>
          <strong style="min-width:150px;text-align:center">${calCursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</strong>
          <button class="btn ghost" id="cn" aria-label="Next month">›</button></div>
        <div class="cal-grid">` +
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="cal-dow">${d}</div>`).join("");
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const day = upcoming.filter(e => (e.starts_at || "").slice(0, 10) === ds);
        html += `<div class="cal-day${d.getMonth() !== mo ? " other" : ""}"><div class="dnum">${d.getDate()}</div>
          ${day.map(e => `<a class="cal-ev" href="register.html?event=${e.id}" ${embed ? 'target="_blank" rel="noopener"' : ""} title="${esc(e.name)}">${esc(e.name)}</a>`).join("")}</div>`;
      }
      el.innerHTML = html + "</div>";
      el.querySelector("#cp").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); render(); });
      el.querySelector("#cn").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); render(); });
    }
    postHeight();
  }

  function postHeight() {
    if (!embed || !window.parent) return;
    requestAnimationFrame(() => {
      parent.postMessage({ bt_widget_height: document.documentElement.scrollHeight, slug: viewSlug }, "*");
    });
  }
  if (embed) new ResizeObserver(postHeight).observe(document.body);

  load();
})();
