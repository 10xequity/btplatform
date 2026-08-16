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
    /* SG-5 (§-1o): the event's own FACE comes first — details, publish/cancel, the share link,
       the minimum-to-run count line and the message-participants card all live on
       admin-event.html, which learned the hub's ?event= spelling for exactly this frame. */
    { key: "overview", label: "Overview", panes: [
      { key: "event", label: "Overview", page: "admin-event.html" },
    ] },
    { key: "registrations", label: "Registrations", panes: [
      { key: "list", label: "Registrations", page: "admin-registrations.html" },
      { key: "waitlist", label: "Waitlist", page: "admin-waitlists.html" },
      /* B14/T2-9a (v0.161.0): the desk flow completed — who signed up, who is waiting, who is
         HERE. The owner's tester complaint was that check-in was "not linked from the flow";
         this pane is that link, with the ?event= context the standalone rail page never had.
         Scoped to team types because the door roster walks team_members JOIN teams — a
         drop-in's sheet sign-ups (team_id NULL) are invisible to it and an unscoped pane
         would show a false "No roster yet" (recorded: §-1c D-38). */
      { key: "checkin", label: "Check-in", page: "admin-checkin.html", types: ["tournament", "league"] },
    ] },
    /* SG-5: the megaphone sits beside the guest list — admin-marketing.html has spoken ?event=
       since W-F ("Email these registrants": the segment form opens with this event chosen), so
       Announce is that hand-off given a tab rather than a second sender. */
    { key: "announce", label: "Announce", panes: [
      { key: "compose", label: "Announce", page: "admin-marketing.html" },
    ] },
    { key: "divisions", label: "Divisions & Pools", panes: [
      { key: "divisions", label: "Divisions", page: "admin-divisions.html" },
      { key: "pools", label: "Create Pools", page: "admin-pool-board.html" },
    ] },
    { key: "scoring-links", label: "Scoring Links", panes: [
      { key: "links", label: "Scoring Links", page: "admin-score-links.html" },
    ] },
    { key: "schedule", label: "Schedule editor", panes: [
      { key: "editor", label: "Schedule editor", page: "admin-schedule-editor.html" },
    ] },
    /* "a tournament OR league management page" — his item 6. The scoring surface is not the same
       page for the two, so the PANE carries the type rather than the tab: pool play for a
       tournament, the League Manager for a league. One tab, the right screen behind it. */
    { key: "scoring", label: "Scoring Edit", panes: [
      { key: "pools", label: "Pool play", page: "tournament.html", types: ["tournament"] },
      { key: "weeks", label: "League weeks", page: "admin-league.html", types: ["league"] },
    ] },
    { key: "live", label: "Live Scoring Board", panes: [
      { key: "board", label: "Live board", page: "live.html" },
    ] },
    { key: "bracket", label: "Bracket", panes: [
      { key: "bracket", label: "Bracket", page: "admin-brackets.html" },
    ] },
  ];

  /* WHICH TABS AN EVENT TYPE ACTUALLY NEEDS. The keys are the schema's own event types — the
     CHECK constraint on events.type — and manager_hub.test.mjs DERIVES that list from the schema
     and asserts this map matches it exactly. That check earned its keep immediately: the approved
     design's visibility table carried a "tryout" row, and there is no tryout event TYPE (tryouts
     are their own module). A row for a type nobody can create is a rule nobody ever reaches.

     A tab that does not apply is ABSENT, never greyed out — a disabled tab is a question the
     operator cannot answer. The one deliberate exception to "hide what is empty" is Bracket on a
     league: WF-2 proved that a filter which hides everything can delete the only way back in, and
     admin-brackets' own empty state plus its Generate panel IS that way in. So a league sees every
     tab, and the pages themselves say when they have nothing yet. */
  const TAB_TYPES = {
    tournament:   ["overview", "registrations", "announce", "divisions", "scoring-links", "schedule", "scoring", "live", "bracket"],
    league:       ["overview", "registrations", "announce", "divisions", "scoring-links", "schedule", "scoring", "live", "bracket"],
    /* SG-5: every type has a face and people worth telling something — a drop-in session is
       the events program's common case (Cathy's Tuesdays), and for one this hub is now the
       whole screen: the event's page, who is coming, and the megaphone. */
    training:     ["overview", "registrations", "announce"],
    event:        ["overview", "registrations", "announce"],
    court_rental: ["overview", "registrations", "announce"],
  };

  /* Until the event loads we know no type, so nothing type-specific is rendered yet. */
  let evType = null;

  function visibleTabs() {
    const allowed = TAB_TYPES[evType] || [];
    return TABS
      .filter((t) => t.panes && t.panes.length && allowed.includes(t.key))
      .map((t) => ({ ...t, panes: t.panes.filter((p) => !p.types || p.types.includes(evType)) }))
      .filter((t) => t.panes.length);
  }

  /* Frames are created on first visit and KEPT. Revisiting a tab must not reload its page — that
     is the "do not reload" requirement, and it is also what makes the hub feel like one screen
     rather than seven. Hidden, never destroyed. */
  const frames = {};
  let current = null;

  function paneId(tabKey, paneKey) { return tabKey + "/" + paneKey; }

  function readHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    const [tabKey, paneKey] = raw.split("/");
    const shown = visibleTabs();
    const tab = shown.find((t) => t.key === tabKey) || shown[0];
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
    evType = ev.type || null;   // decides which tabs exist at all — set before the row renders
    $("mgrName").textContent = ev.name || "Event";
    $("mgrMeta").textContent = [ev.starts_at ? fmtDT(ev.starts_at) : "", ev.location || "", ev.type || ""]
      .filter(Boolean).join(" · ");

    $("mgrTabs").innerHTML = visibleTabs().map((t) =>
      `<button class="tab" role="tab" aria-selected="false" data-tab="${esc(t.key)}">${esc(t.label)}</button>`).join("");
    for (const b of $("mgrTabs").children) b.onclick = () => { location.hash = b.dataset.tab; };

    if (!visibleTabs().length) {
      $("mgrNote").textContent = `A ${ev.type || "event"} has no manager tabs yet — open it from Events & Programs instead.`;
      return;
    }
    window.addEventListener("hashchange", route);
    route();
  }

  boot();
})();
/* Changelog: v1.0 (2026-08-12, v0.139.0) — WF-5 H-1: the shell, the tab row over the shared
   .tabs/.tab component, hash routing with kept frames, and the first two tabs (Registrations with
   Waitlist as its subsection; Divisions & Pools with Create Pools as its second pane). */
