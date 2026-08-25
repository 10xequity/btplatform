/* Boomtown Platform — the member Play frame
   File: web/assets/play.js · Version: v1.0 · Date: 2026-08-25 · Ships in: v0.202.0

   §-1g C-2, the member half of the owner's 2026-08-08 sentence: "when doing the horizontal
   buttons that becomes a frame itself where it does not reload and acts as a tab with the
   vertical menu on the side, reducing the options on the left menu and keep items together that
   are only applicable to certain modules."

   This is the manager hub's idiom (admin-manager.js v1.0, v0.139.0), reused for the member rail's
   Play group: each tab's content is the EXISTING page in a same-origin chromeless iframe. Frames
   are created on first visit and KEPT — hidden, never destroyed — which is the "does not reload",
   and also why the Live tab keeps its scores when a member flips to the schedule and back. The
   embed plumbing predates this file and is universal: config.js posts {bt_widget_height, slug}
   for any page opened with ?embed=1, app.css hides the chrome, site-nav.js skips itself.

   The five surfaces stay real pages at their own addresses — deep links, cross-page links and
   the external widget are untouched. This file adds a parent; it forks nothing.

   Guards: member_frame.test.mjs (pane list, kept frames, hash routing, the embed contract, the
   rail collapse and its exit). */
(function () {
  const $ = (id) => document.getElementById(id);

  /* THE ONE LIST — the rail items the Play group carried until v0.202.0, same order, same names.
     member_frame.test.mjs pins both halves so the frame and the rail cannot drift apart. */
  const PANES = [
    { key: "schedule",  label: "Event Schedule", page: "schedule.html" },
    { key: "leagues",   label: "Leagues",        page: "leagues.html" },
    { key: "live",      label: "Live scores",    page: "live.html" },
    { key: "community", label: "Community Play", page: "lfg.html" },
    { key: "subs",      label: "Sub-Finder",     page: "subs.html" },
  ];

  /* Created on first visit, then kept. Hidden, never destroyed. */
  const frames = {};

  function readHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    return PANES.find((p) => p.key === raw) || PANES[0];
  }

  function frameFor(pane) {
    if (frames[pane.key]) return frames[pane.key];
    const f = document.createElement("iframe");
    /* slug rides along so the child can echo it back: two frames on one page must not resize
       each other (widget.js has filtered by slug since v0.4.0 for exactly this reason). */
    f.src = `${pane.page}?embed=1&slug=${encodeURIComponent(pane.key)}`;
    f.className = "pf-frame";
    f.title = pane.label;
    f.setAttribute("loading", "lazy");
    $("pfPanes").appendChild(f);
    frames[pane.key] = f;
    return f;
  }

  function show(pane) {
    for (const b of $("pfTabs").children) {
      b.classList.toggle("active", b.dataset.pane === pane.key);
      b.setAttribute("aria-selected", String(b.dataset.pane === pane.key));
    }
    const wanted = frameFor(pane);
    for (const k of Object.keys(frames)) frames[k].hidden = frames[k] !== wanted;
  }

  /* The parent half of the embed contract — same message, same slug filter as admin-manager.js
     and widget.js. The child half is config.js, which every framed page already loads. */
  window.addEventListener("message", (e) => {
    if (!e.data || typeof e.data.bt_widget_height !== "number") return;
    const f = frames[e.data.slug];
    if (!f) return;                                   // a slug we do not own
    f.style.height = Math.max(420, e.data.bt_widget_height + 8) + "px";
  });

  $("pfPanes").innerHTML = "";
  $("pfTabs").innerHTML = PANES.map((p) =>
    `<button type="button" class="pf-tab" role="tab" aria-selected="false" data-pane="${p.key}">${p.label}</button>`).join("");
  for (const b of $("pfTabs").children) b.onclick = () => { location.hash = b.dataset.pane; };

  window.addEventListener("hashchange", () => show(readHash()));
  show(readHash());
})();
/* Changelog: v1.0 (2026-08-25, v0.202.0) — §-1g C-2 member half: the Play frame. Five kept
   panes over the hub idiom; the rail's Play group collapses to this page (site-nav.js v2.26). */
