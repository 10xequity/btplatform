/* Boomtown Platform — Build Status indicators (shared)
   File: web/assets/build-status.js · Version: v1.0 · Date: 2026-07-26 · Ships in: v0.24.0

   WHY THIS EXISTS
   Testers are about to be pointed at a site where some screens are finished, some work
   but cannot complete their core job yet (email sending is code-blocked, Square is in
   SANDBOX), and some modules are not built at all. Without a marker, every half-built
   screen generates a bug report that is really a roadmap item. This file is the single
   registry of module maturity: the admin rail, the member rail, the per-page banner and
   the Build Status page all read from it. Change a status HERE and it changes everywhere.

   STATES
     live  — finished. No badge. Test it normally, file bugs.
     beta  — works end to end, but with a stated caveat (usually SANDBOX money). Safe to
             test. Small amber badge + one dismissible banner on the page.
     wip   — UNDER CONSTRUCTION. Cannot complete its core job right now. Dimmed in the
             rail, cone icon, and a confirm step before the page opens. Do not file bugs.
     soon  — not built. Never appears in a rail; listed on the Build Status page only.

   DESIGN NOTES
   - No animation on rail badges. They are in view on every page load, hundreds of times a
     day (emil-design-eng frequency rule / standards §2). Only the page banner fades in,
     and only for prefers-reduced-motion: no-preference.
   - Status is never communicated by colour alone: every badge carries a text label and an
     aria-label (standards §3 / WCAG 1.4.1).
   - No hardcoded hex. Tokens only (standards §1).
*/

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     1. THE REGISTRY — pages that exist in the app
     Key = filename as it appears in href. s = state. n = tester-facing note.
     --------------------------------------------------------------------- */
  const PAGES = {
    /* --- Run events --- */
    "admin.html":               { s: "live" },
    "admin-events.html":        { s: "live" },
    "admin-registrations.html": { s: "live" },
    "admin-waitlists.html":     { s: "beta", n: "Queue, auto-offer and expiring claim links all work. The offer email will not actually arrive until the Brevo key is set — check the sandbox link in the admin list instead." },
    "admin-checkin.html":       { s: "beta", n: "The waiver gate is live: check-in returns a block if the member has no current waiver, and staff can override with a typed reason. Not built yet: the outstanding-balance chip and one-tap resolve." },
    "admin-facility.html":      { s: "beta", n: "Calendar, space presets and the conflict engine are finished. Public rental requests stay hidden until RENTALS_ENABLED is switched on." },
    "tournament.html":          { s: "live" },
    "admin-league.html":        { s: "live" },

    /* --- Money --- */
    "admin-reports.html":       { s: "live" },
    "admin-pos.html":           { s: "beta", n: "Square is in SANDBOX. Sales, line items and reporting are all real; the payment is not. No card is ever charged." },
    "admin-plans.html":         { s: "beta", n: "Square subscriptions are in SANDBOX. Do not sell a real membership from this screen — nothing will bill." },

    /* --- Marketing --- */
    "admin-marketing.html":     { s: "wip",  n: "Sending is deliberately blocked in code until two things are done: the physical mailing address is saved in Settings, and the Brevo API key plus SPF/DKIM/DMARC are verified. You can build contacts, segments and campaigns; you cannot send. This is expected — not a bug." },
    "admin-messages.html":      { s: "beta", n: "The report queue works. Muting a member still has to be done from their member record — one-click mute from this queue is not built yet." },

    /* --- People --- */
    "admin-users.html":         { s: "live" },
    "admin-security.html":      { s: "live" },
    "admin-waivers.html":       { s: "beta", n: "Versioning, publishing and signature pinning are finished and tested. The live text is still the v1 legacy placeholder — waiver v2 is drafted and waiting on one email address before it can be published." },
    "settings.html":            { s: "live" },
    "admin-buildstatus.html":   { s: "live" },

    /* --- Member site --- */
    "index.html":               { s: "live" },
    "home.html":                { s: "live" },
    "schedule.html":            { s: "live" },
    "leagues.html":             { s: "live" },
    "library.html":             { s: "live" },
    "member-inbox.html":        { s: "live" },
    "profile.html":             { s: "live" },
    "membership.html":          { s: "beta", n: "Square is in SANDBOX. You can walk the whole join-a-plan flow; no real card is charged and no real membership starts." },
    "register.html":            { s: "beta", n: "Registration, teammates, waiver and Square checkout all work (SANDBOX). Promo codes cannot be entered at checkout yet — they are admin-applied only." },
    "checkin.html":             { s: "live" },
    "score.html":               { s: "live" },
  };

  /* ---------------------------------------------------------------------
     2. FEATURES — cross-cutting things that are not a single page.
     Shown on the Build Status page only.
     --------------------------------------------------------------------- */
  const FEATURES = [
    { name: "Waiver enforcement at the door", s: "live", area: "People",
      n: "Check-in and walk-in both refuse a member with no current waiver. Staff override needs a typed reason of 8+ characters and is written to the audit log." },
    { name: "Calendar feeds (.ics)",          s: "beta", area: "Run events",
      n: "The feed itself is built and tested. There is no button anywhere to get your feed URL yet — that ships with the subscribe UI." },
    { name: "Push notifications",             s: "wip",  area: "Member site",
      n: "The full PWA and push stack is built, but the three VAPID server secrets have never been set, so the browser cannot subscribe. Every push feature will look broken until that is done. Known — do not file." },
    { name: "Add to Home Screen (PWA)",       s: "live", area: "Member site",
      n: "Works on Android and desktop Chrome. On iOS use Share → Add to Home Screen." },
    { name: "Email delivery (Brevo)",         s: "wip",  area: "Marketing",
      n: "Every email path in the platform — reminders, waitlist offers, waiver notices, campaigns — is in sandbox mode. Nothing reaches a real inbox yet." },
    { name: "Payments (Square)",              s: "beta", area: "Money",
      n: "SANDBOX across the whole platform. Switching to production is the owner's call and is a deliberate, separate step." },
    { name: "SMS",                            s: "soon", area: "Marketing",
      n: "Phase 3. Needs Twilio plus A2P 10DLC registration and its own opt-in, which can never be bundled with the email consent." },
    { name: "Teammate self-sign links",       s: "soon", area: "People",
      n: "Today only the captain signs a waiver; teammates are just a name and an email. Next build." },
    { name: "Media-release opt-out record",   s: "soon", area: "People",
      n: "The waiver names a written opt-out path, but the platform has nowhere to record that a family used it." },
    { name: "Promo redemption at checkout",   s: "soon", area: "Money",
      n: "Promos exist and work admin-side; the public checkout has no code box yet." },
    { name: "Achievements & public standings",s: "soon", area: "Run events", n: "M17. Spec approved, queued behind the format engine." },
    { name: "Tournament format engine",       s: "soon", area: "Run events", n: "M-TF. Pluggable formats: single/double elim, Swiss, King of the Court, ladder, blind draw." },
    { name: "Player Exchange (free agents, subs)", s: "soon", area: "People", n: "M18. Sub board, free-agent pool, roster RSVP." },
    { name: "Lessons, clinics & camps",       s: "soon", area: "Money", n: "M20. Multi-coach booking and lesson packs." },
    { name: "Auto-scheduler v1",              s: "soon", area: "Run events", n: "M21." },
  ];

  const META = {
    live: { label: "",       full: "Finished",          rank: 0 },
    beta: { label: "BETA",   full: "Works, with a caveat", rank: 1 },
    wip:  { label: "WIP",    full: "Under construction", rank: 2 },
    soon: { label: "SOON",   full: "Not built yet",      rank: 3 },
  };

  const CONE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3 4 20h16L12 3z"/><path d="M9.2 11h5.6M7.4 15.5h9.2"/></svg>';

  /* ---------------------------------------------------------------------
     3. STYLES — injected once, tokens only
     --------------------------------------------------------------------- */
  function injectCSS() {
    if (document.getElementById("bt-status-css")) return;
    const st = document.createElement("style");
    st.id = "bt-status-css";
    st.textContent = `
      .bt-chip { display:inline-flex; align-items:center; gap:3px; flex:none;
        margin-left:auto; padding:1px 5px; border-radius:999px; font-size:9px;
        font-weight:700; letter-spacing:.05em; line-height:1.6; text-transform:uppercase;
        border:1px solid currentColor; background:transparent; }
      .bt-chip--beta { color: var(--warn); }
      .bt-chip--wip  { color: var(--danger); }
      .bt-chip--soon { color: var(--text-dim); }
      .bt-chip svg { width:10px; height:10px; }
      /* collapsed admin rail: text is hidden, so the chip becomes a dot */
      html[data-nav="min"] .bt-chip { padding:0; width:6px; height:6px; border-radius:50%;
        background:currentColor; border:0; margin-left:2px; overflow:hidden; }
      html[data-nav="min"] .bt-chip * { display:none; }
      .nav-item.bt-wip { opacity:.62; }
      @media (hover:hover) and (pointer:fine) { .nav-item.bt-wip:hover { opacity:.85; } }

      .bt-banner { display:flex; gap:10px; align-items:flex-start;
        border:1px solid var(--border); border-left:3px solid var(--warn);
        background:var(--surface); color:var(--text);
        border-radius:10px; padding:12px 14px; margin:0 0 16px; font-size:14px;
        line-height:1.5; }
      .bt-banner--wip { border-left-color: var(--danger); }
      .bt-banner b { display:block; font-size:13px; letter-spacing:.03em;
        text-transform:uppercase; margin-bottom:2px; }
      .bt-banner--beta b { color: var(--warn); }
      .bt-banner--wip  b { color: var(--danger); }
      .bt-banner p { margin:0; color: var(--text-dim); }
      .bt-banner button { flex:none; min-width:44px; min-height:44px; margin:-10px -8px -10px 0;
        background:none; border:0; color:var(--text-dim); font-size:18px; cursor:pointer;
        border-radius:8px; }
      .bt-banner button:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
      @media (prefers-reduced-motion: no-preference) {
        .bt-banner { animation: bt-fade 180ms cubic-bezier(.23,1,.32,1) both; }
        @keyframes bt-fade { from { opacity:0 } to { opacity:1 } }
      }

      .bt-status-table { width:100%; border-collapse:collapse; font-size:14px; }
      .bt-status-table th, .bt-status-table td { text-align:left; padding:10px 12px;
        border-bottom:1px solid var(--border); vertical-align:top; }
      .bt-status-table th { font-size:12px; text-transform:uppercase; letter-spacing:.05em;
        color:var(--text-dim); font-weight:700; }
      .bt-status-table td.n { color:var(--text-dim); line-height:1.5; }
      .bt-status-table tr:last-child td { border-bottom:0; }
      .bt-legend { display:flex; flex-wrap:wrap; gap:16px; margin:0 0 20px; padding:14px;
        border:1px solid var(--border); border-radius:10px; background:var(--surface);
        font-size:13px; color:var(--text-dim); }
      .bt-legend span { display:inline-flex; align-items:center; gap:6px; }
    `;
    document.head.appendChild(st);
  }

  const chip = (s) => s === "live" ? "" :
    `<span class="bt-chip bt-chip--${s}" aria-hidden="true">${s === "wip" ? CONE : ""}${META[s].label}</span>`;

  const fileOf = (href) => String(href || "").split("#")[0].split("/").pop();

  /* ---------------------------------------------------------------------
     4. DECORATE NAV — runs against whatever rail happens to be on the page.
     Safe to call more than once; skips links it has already touched.
     --------------------------------------------------------------------- */
  function decorate(root) {
    injectCSS();
    const scope = root || document;
    scope.querySelectorAll(".nav-item[href]").forEach((a) => {
      if (a.dataset.btStatus) return;
      const rec = PAGES[fileOf(a.getAttribute("href"))];
      if (!rec || rec.s === "live") { if (rec) a.dataset.btStatus = "live"; return; }
      a.dataset.btStatus = rec.s;
      a.insertAdjacentHTML("beforeend", chip(rec.s));
      // Screen readers get the state as words, appended to the existing link text.
      const words = a.textContent.replace(META[rec.s].label, "").trim();
      a.setAttribute("aria-label", `${words} — ${META[rec.s].full}`);
      a.title = `${words} — ${META[rec.s].full}${rec.n ? ": " + rec.n : ""}`;
      if (rec.s === "wip") {
        a.classList.add("bt-wip");
        a.addEventListener("click", (e) => {
          if (a.dataset.btAck === "1") return;
          e.preventDefault();
          if (window.confirm(`${words} is still under construction.\n\n${rec.n}\n\nOpen it anyway?`)) {
            a.dataset.btAck = "1";
            location.href = a.getAttribute("href");
          }
        });
      }
    });
  }

  /* ---------------------------------------------------------------------
     5. PAGE BANNER — one per page, dismissible for the session.
     --------------------------------------------------------------------- */
  function banner() {
    const here = fileOf(location.pathname) || "index.html";
    const rec = PAGES[here];
    if (!rec || rec.s === "live" || !rec.n) return;
    if (sessionStorage.getItem("bt_status_ack_" + here) === "1") return;
    injectCSS();
    const host = document.querySelector("main, .admin-main, .content, .wrap") || document.body;
    const el = document.createElement("div");
    el.className = `bt-banner bt-banner--${rec.s}`;
    el.setAttribute("role", "status");
    el.innerHTML =
      `<div style="flex:1"><b>${rec.s === "wip" ? "Under construction" : "Beta — read this first"}</b>
       <p>${rec.n}</p></div>
       <button type="button" aria-label="Dismiss this notice">&times;</button>`;
    el.querySelector("button").addEventListener("click", () => {
      sessionStorage.setItem("bt_status_ack_" + here, "1");
      el.remove();
    });
    host.prepend(el);
  }

  /* ---------------------------------------------------------------------
     6. FULL TABLE — used by admin-buildstatus.html
     --------------------------------------------------------------------- */
  function renderTable(mountSel) {
    injectCSS();
    const mount = document.querySelector(mountSel);
    if (!mount) return;
    const rows = [];
    Object.keys(PAGES).forEach((f) => {
      const r = PAGES[f];
      rows.push({ name: f, kind: "Screen", s: r.s, n: r.n || "" });
    });
    FEATURES.forEach((f) => rows.push({ name: f.name, kind: f.area, s: f.s, n: f.n || "" }));
    rows.sort((a, b) => META[b.s].rank - META[a.s].rank || a.name.localeCompare(b.name));

    const count = (s) => rows.filter((r) => r.s === s).length;
    mount.innerHTML = `
      <div class="bt-legend">
        <span><b style="color:var(--text)">${count("live")}</b> finished</span>
        <span>${chip("beta").replace(" aria-hidden=\"true\"", "")} <b>${count("beta")}</b> work with a caveat — safe to test</span>
        <span>${chip("wip").replace(" aria-hidden=\"true\"", "")} <b>${count("wip")}</b> under construction — don't file bugs</span>
        <span>${chip("soon").replace(" aria-hidden=\"true\"", "")} <b>${count("soon")}</b> not built yet</span>
      </div>
      <table class="bt-status-table">
        <caption class="sr-only">Build status of every screen and feature</caption>
        <thead><tr><th scope="col">Status</th><th scope="col">Screen or feature</th><th scope="col">Area</th><th scope="col">What testers need to know</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr><td>${r.s === "live"
                ? '<span style="color:var(--positive);font-weight:700;font-size:12px">DONE</span>'
                : chip(r.s).replace(" aria-hidden=\"true\"", "")}</td>
            <td><b>${r.name}</b></td><td>${r.kind}</td><td class="n">${r.n || "—"}</td></tr>`).join("")}
        </tbody>
      </table>`;
  }

  /* ---------------------------------------------------------------------
     7. Public surface + auto-run
     --------------------------------------------------------------------- */
  window.BT_STATUS = { PAGES, FEATURES, META, decorate, banner, renderTable,
                       stateOf: (href) => (PAGES[fileOf(href)] || { s: "live" }).s };

  function boot() { decorate(); banner(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Rails render themselves after their own script runs; catch late arrivals once.
  setTimeout(decorate, 0);
  setTimeout(decorate, 400);
})();
