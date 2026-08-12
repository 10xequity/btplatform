/* Boomtown Platform — Event Manager hub (§-1p WF-5 H-1)
   File: web/assets/admin-manager.js · Version: v1.0 · Date: 2026-08-12 · Ships in: v0.139.0

   The owner's 2026-08-11 items 6 and 7, approved 2026-08-12: one manager page per event, with
   horizontal tabs across the top that do NOT reload — Registrations (Waitlist a subsection) ·
   Divisions & Create Pools · Scoring Links · Schedule editor · Scoring Edit · Live Scoring Board ·
   Bracket. H-1 ships the shell and the first two tabs; H-2 fills in the rest.

   EACH TAB'S CONTENT IS THE EXISTING PAGE, IN A SAME-ORIGIN CHROMELESS IFRAME.
   Reuse is literal: no page's logic is forked, copied or wrapped, so a fix to the Pool Board is a
   fix in the Pool Board. The reason it is an iframe and not a mount: seven of the nine surfaces
   carry page-local <style> (the pool board alone is 200+ lines) and one tab is a member-side page
   with a different stylesheet set entirely. A single document would put all of that in one
   cascade — standards §11, in the form that actually bites. The iframe makes §11 structural
   instead of a rule someone has to keep remembering. It also means an id collision between two
   tabs is not expressible (#eventSelect exists on two of the nine today).

   THE EMBED CONTRACT IS NOT NEW. `schedule.js?embed=1` has posted {bt_widget_height, slug} to its
   parent since v0.4.0, and `web/widget.js` has been the parent that listens, filters by slug and
   sizes the frame. This file is the second parent; `admin-nav.js` is the second child. They are
   two implementations because widget.js is a drop-in <script> served to EXTERNAL sites and cannot
   import from this repo — so what stops them drifting is a test, not a file (manager_hub.test.mjs
   asserts the message key is identical in all four). */
(function () {
  const { api, guard, esc, fmtDT } = window.BT_ADMIN;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const eventId = Number(params.get("event")) || 0;

  /* THE ONE LIST, in the owner's order, item 7 verbatim. All seven tabs are declared now so the
     ORDER is settled before H-2 fills them in; the renderer shows only the ones that have panes,
     so an unbuilt tab is absent rather than a dead button. A tab with more than one pane grows a
     sub-tab row — which is what "Waitlist is a sub section of registration" asks for. */
  const TABS = [
    { key: "registrations", label: "Registrations", panes: [
      { key: "list", label: "Registrations", page: "admin-registrations.html" },
      { key: "waitlist", label: "Waitlist", page: "admin-waitlists.html" },
    ] },
    { key: "divisions", label: "Divisions & Pools", panes: [
      { key: "divisions", label: "Divisions", page: "admin-divisions.html" },
      { key: "pools", label: "Create Pools", page: "admin-pool-board.html" },
    ] },
    { key: "scoring-links", label: "Scoring Links" },
    { key: "schedule", label: "Schedule editor" },
    { key: "scoring", label: "Scoring Edit" },
    { key: "live", label: "Live Scoring Board" },
    { key: "bracket", label: "Bracket" },
  ];

  const READY = TABS.filter((t) => t.panes && t.panes.length);

  /* Frames are created on first visit and KEPT. Revisiting a tab must not reload its page — that
     is the "do not reload" requirement, and it is also what makes the hub feel like one screen
     rather than seven. Hidden, never destroyed. */
  const frames = {};
  let current = null;

  function paneId(tabKey, paneKey) { return tabKey + "/" + paneKey; }

  function readHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    const [tabKey, paneKey] = raw.split("/");
    const tab = READY.find((t) => t.key === tabKey) || READY[0];
    if (!tab) return null;
    const pane = tab.panes.find((p) => p.key === paneKey) || tab.panes[0];
    return { tab, pane };
  }

  function frameFor(tab, pane) {
    const id = paneId(tab.key, pane.key);
    if (frames[id]) return frames[id];
    const f = document.createElement("iframe");
    /* slug rides along so the child can echo it back: two frames on one page must not resize each
       other (widget.js has filtered by slug since v0.4.0 for exactly this reason). */
    f.src = `${pane.page}?event=${encodeURIComponent(eventId)}&embed=1&slug=${encodeURIComponent(id)}`;
    f.className = "mgr-frame";
    f.title = `${tab.label} — ${pane.label}`;
    f.setAttribute("loading", "lazy");
    $("mgrPanes").appendChild(f);
    frames[id] = f;
    return f;
  }

  function show(tab, pane) {
    current = { tab, pane };
    for (const t of $("mgrTabs").children) t.classList.toggle("active", t.dataset.tab === tab.key);
    for (const t of $("mgrTabs").children) t.setAttribute("aria-selected", String(t.dataset.tab === tab.key));

    const sub = $("mgrSubtabs");
    sub.hidden = tab.panes.length < 2;
    sub.innerHTML = tab.panes.length < 2 ? "" : tab.panes.map((p) =>
      `<button class="tab${p.key === pane.key ? " active" : ""}" role="tab" aria-selected="${p.key === pane.key}" data-pane="${esc(p.key)}">${esc(p.label)}</button>`).join("");
    for (const b of sub.children) b.onclick = () => { location.hash = paneId(tab.key, b.dataset.pane); };

    const wanted = frameFor(tab, pane);
    for (const id of Object.keys(frames)) frames[id].hidden = frames[id] !== wanted;
  }

  function route() {
    const next = readHash();
    if (!next) return;
    show(next.tab, next.pane);
  }

  /* The parent half of the embed contract. Same message, same slug filter as web/widget.js. */
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data.bt_widget_height !== "number") return;
    const f = frames[e.data.slug];
    if (!f) return;                                   // a slug we do not own
    f.style.height = Math.max(420, e.data.bt_widget_height + 8) + "px";
  });

  async function boot() {
    const me = await guard(); if (!me) return;
    if (!eventId) {
      $("mgrName").textContent = "Choose an event";
      $("mgrNote").innerHTML = 'This page manages one event at a time. <a href="admin-events.html">Pick an event on Events &amp; Programs</a> and open its manager.';
      return;
    }
    const r = await api(`/api/events/${eventId}`);
    if (!r.ok) return BT_ADMIN.loadFail("main", r, "events");
    const ev = r.data.event || r.data;
    $("mgrName").textContent = ev.name || "Event";
    $("mgrMeta").textContent = [ev.starts_at ? fmtDT(ev.starts_at) : "", ev.location || "", ev.type || ""]
      .filter(Boolean).join(" · ");

    $("mgrTabs").innerHTML = READY.map((t) =>
      `<button class="tab" role="tab" aria-selected="false" data-tab="${esc(t.key)}">${esc(t.label)}</button>`).join("");
    for (const b of $("mgrTabs").children) b.onclick = () => { location.hash = b.dataset.tab; };

    window.addEventListener("hashchange", route);
    route();
  }

  boot();
})();
/* Changelog: v1.0 (2026-08-12, v0.139.0) — WF-5 H-1: the shell, the tab row over the shared
   .tabs/.tab component, hash routing with kept frames, and the first two tabs (Registrations with
   Waitlist as its subsection; Divisions & Pools with Create Pools as its second pane). */
