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
  // v0.132.0 SG-1: drop-in types get the public sheet; team types keep the registration form.
  // v0.137.0 (D-29): the rule itself moved to config.js. It was stated here AND in
  // admin-event.js, and the third site that needed it (home.js) wrote its own link with the
  // wrong parameter instead. One judgement, imported — the whole link, page and parameter.
  const signupLink = e => BT_SIGNUP_LINK(e.type, e.id);
  const TZ = "America/Denver";

  let events = [], mode = "list", org = "";
  let typeFilter = "", sortKey = "date", sortRev = false;
  let calCursor = new Date(); calCursor.setDate(1);

  /* ── K-14 (§-0 B21, v0.145.0) — the owner's sort/filter tabs on the member events list.
     "B, main list of events needs to be sortable. Have tabs at the top to sort, similar to the
     tournament page in Boomtownvb.com." (owner 2026-08-11, Q2.)

     THE TABS THAT WERE ALREADY HERE ARE A VIEW SWITCHER, NOT A SORT. §-1m recorded this page as
     already having "a working .tab mechanism" and called K-14 an extension of it. It is List vs
     Month — a layout choice. Hanging the owner's categories off it would have put "in what order"
     and "in what layout" in one control. These are a sibling row, and BOTH listeners are now
     scoped by container id: the old selector was `document.querySelectorAll(".tab")`, so a second
     `.tab` anywhere on the page joined the view switcher and clicking it set `mode = undefined`,
     dropping the page into the calendar branch. That would have looked like a styling bug.

     EVERY CONTROL HERE IS BUILT FROM THE LOADED EVENTS. The schema allows five event types; live
     D1 on 2026-08-13 had published events of exactly two (tournament and league). A static tab
     row would have shipped three tabs that are permanently empty — K-13's pool-board lesson on a
     public page. Same rule for the sort keys, the direction toggle and the org filter, which was
     already computing `seen.size > 1` and then leaving itself on screen anyway. ── */

  /** The one place a sort key becomes a value. `sortEvents` orders by it and
      `availableSortKeys` counts its distinct values — one judgement, two readers, so the option
      offered and the order given cannot drift apart. */
  function sortPick(key) {
    const num = v => (v == null || v === "" ? "" : String(v).padStart(12, "0"));
    return {
      date: e => String(e.starts_at || ""),
      name: e => String(e.name || ""),
      price: e => num(e.price_cents),
    }[key] || null;
  }

  /** Order the list. REVERSE INVERTS THE COMPARISON, NOT THE ARRAY — an event with no date or no
      price sorts last in BOTH directions, because a blank at the top of a list is the first thing
      read and the least useful thing to read. Reversing the array would undo that on first press. */
  function sortEvents(list, key, reverse) {
    const out = list.slice();
    const pick = sortPick(key);
    if (!pick) return out;
    out.sort((a, b) => {
      const av = pick(a), bv = pick(b);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const c = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) || 0;
      return reverse ? -c : c;
    });
    return out;
  }

  /** Sorts worth offering. `date` is unconditional — it is the order the server already sends and
      the way back to it. The rest appear only when they could actually reorder something. */
  function availableSortKeys(list) {
    const always = ["date"];
    const conditional = ["name", "price"];
    const rows = list || [];
    return always.concat(conditional.filter(k => {
      const pick = sortPick(k);
      return pick && new Set(rows.map(pick)).size > 1;
    }));
  }

  /** The tab row: "" (All) plus each type present, in the order the schedule first shows it.
      Below two types, All sits beside a tab that selects everything, so the row is not drawn. */
  function availableTypes(list) {
    const seen = [];
    for (const e of list || []) if (e && e.type && !seen.includes(e.type)) seen.push(e.type);
    return seen.length > 1 ? [""].concat(seen) : [];
  }

  /** Human words on a public page — never the schema token. "court_rental" is a column value.
      A type added to the schema and not named here fails schedule_tabs.test.mjs. */
  function typeLabel(type) {
    return {
      "": "All", tournament: "Tournaments", league: "Leagues",
      training: "Training", event: "Events", court_rental: "Court rentals",
    }[type] || type;
  }

  /** What the direction toggle says. Each key gets its own words: "A–Z" on a price is the same
      lie K-13 avoided by refusing to put an alphabet on a number. */
  function dirLabel(key, reverse) {
    return {
      date: ["Soonest first", "Latest first"],
      name: ["A–Z", "Z–A"],
      price: ["Low to high", "High to low"],
    }[key][reverse ? 1 : 0];
  }

  /** Rebuild the control row for the events actually loaded. Called from `load()` only — the data
      it describes changes when the server answers, not while somebody is clicking. */
  function paintControls() {
    const row = document.getElementById("schedControls");
    const tabs = document.getElementById("schedTypeTabs");
    const sel = document.getElementById("schedSort");
    const dir = document.getElementById("schedDir");
    const types = availableTypes(events);
    if (!types.includes(typeFilter)) typeFilter = "";
    tabs.innerHTML = types.map(t =>
      `<button type="button" class="tab${t === typeFilter ? " active" : ""}" role="tab"
         aria-selected="${t === typeFilter}" data-type="${esc(t)}">${esc(typeLabel(t))}</button>`).join("");
    tabs.hidden = !types.length;

    const keys = availableSortKeys(events);
    if (!keys.includes(sortKey)) sortKey = "date";
    sel.innerHTML = keys.map(k =>
      `<option value="${k}"${k === sortKey ? " selected" : ""}>${esc({ date: "Date", name: "Name", price: "Price" }[k])}</option>`).join("");
    sel.value = sortKey;
    sel.hidden = keys.length < 2;
    document.querySelector(".sched-sortlab").hidden = sel.hidden;
    dir.hidden = events.length < 2;
    paintDir();
    row.hidden = tabs.hidden && sel.hidden && dir.hidden;
  }

  function paintDir() {
    const dir = document.getElementById("schedDir");
    dir.setAttribute("aria-pressed", String(sortRev));
    dir.textContent = dirLabel(sortKey, sortRev);
  }

  document.querySelectorAll("#schedViewTabs .tab").forEach(t => t.addEventListener("click", () => {
    mode = t.dataset.mode;
    document.querySelectorAll("#schedViewTabs .tab").forEach(x => x.classList.toggle("active", x === t));
    render();
  }));
  // Delegated: the type tabs are rebuilt on every load, so a handler per button would stack.
  document.getElementById("schedTypeTabs").addEventListener("click", e => {
    const t = e.target.closest(".tab");
    if (!t) return;
    typeFilter = t.dataset.type || "";
    for (const x of document.querySelectorAll("#schedTypeTabs .tab")) {
      x.classList.toggle("active", x === t);
      x.setAttribute("aria-selected", String(x === t));
    }
    render();
  });
  document.getElementById("schedSort").addEventListener("change", e => {
    sortKey = e.target.value; paintDir(); render();
  });
  document.getElementById("schedDir").addEventListener("click", () => {
    sortRev = !sortRev; paintDir(); render();
  });
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
    // K-14: this already knew when the control was pointless and drew it anyway. One org is live
    // today, so "All orgs" has been sitting there filtering nothing. It stays hidden once a
    // choice has been made, or changing org would hide the control that changed it.
    orgSel.hidden = seen.size <= 1 && !org;
    paintControls();
    render();
  }

  function fmtTime(s) {
    const d = new Date(s.replace(" ", "T"));
    return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  }

  function render() {
    const el = document.getElementById("schedBody");
    // K-14: the type filter narrows what BOTH views draw from, before the mode branch. A filter
    // applied inside the list branch only would leave someone on Leagues still seeing every
    // tournament in Month view — the calendar is the same events in a grid, not a different set.
    const upcoming = events.filter(e => e.status !== "cancelled")
      .filter(e => !typeFilter || e.type === typeFilter);
    if (!upcoming.length) {
      el.innerHTML = `<div class="empty">${typeFilter
        ? `No ${esc(typeLabel(typeFilter).toLowerCase())} scheduled right now — try another tab.`
        : "Nothing scheduled yet — check back soon."}</div>`;
      postHeight(); return;
    }
    if (mode === "list") {
      const future = upcoming.filter(e => new Date((e.starts_at || "").replace(" ", "T")) >= new Date(Date.now() - 86400000));
      el.innerHTML = sortEvents(future.length ? future : upcoming, sortKey, sortRev).map(e => {
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
          ${e.status === "published" ? `<a class="btn sched-cta" href="${signupLink(e)}" ${embed ? 'target="_blank" rel="noopener"' : ""}>Sign up</a>` : ""}
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
          ${day.map(e => `<a class="cal-ev" href="${signupLink(e)}" ${embed ? 'target="_blank" rel="noopener"' : ""} title="${esc(e.name)}">${esc(e.name)}</a>`).join("")}</div>`;
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
