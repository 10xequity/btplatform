/* Boomtown Platform — Build Status indicators (shared)
   File: web/assets/build-status.js · Version: v1.1 · Date: 2026-08-02 · Ships in: v0.55.0
   v1.0: 2026-07-26, v0.24.0

   v1.1 — THE REGISTRY HAD GONE STALE, AND ONE ENTRY WAS ACTIVELY WRONG.
   This file is tester-facing copy, so a wrong entry does not just mislead — it manufactures
   bug reports about correct behaviour, and burns the tester's trust in every other row.
     · admin-checkin + "Waiver enforcement at the door" both claimed the door REFUSES a member
       with no current waiver. That gate was removed in v0.33.1 on the owner's instruction
       (D-MIN-8, "no gating"); checkin.js v1.3 replaced it with a non-blocking advisory. A
       tester reading the old copy would have filed the absence of a block as a defect.
     · 16 of 45 real pages were absent from PAGES, so they silently rendered as "live" with no
       caveat — including admin-sms, which cannot send at all.
     · Four FEATURES rows said "soon" for things that had shipped (teammate self-sign and
       media-release record in v0.25, Player Exchange substantially in v0.45, SMS built then
       frozen), and the .ics row claimed no feed button existed anywhere while admin-calendar
       has had one for three releases.
   build_status.test.mjs now ratchets the page half of this: a new web/*.html that never gets
   a registry entry fails the suite. Prose cannot hold a registry current; a guard can.

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
    "admin-checkin.html":       { s: "beta", n: "Check-in never blocks anyone. A member with no current waiver still checks in — the door just shows a note so staff can follow up (owner decision 2026-07-29, \"no gating\"). Not built yet: the outstanding-balance chip and one-tap resolve." },
    "admin-facility.html":      { s: "beta", n: "Calendar, space presets and the conflict engine are finished. Public rental requests stay hidden until RENTALS_ENABLED is switched on." },
    "admin-calendar.html":      { s: "live" },
    "admin-tryouts.html":       { s: "beta", n: "Evaluate players at a tryout: their registration details, your own notes, a 1-5 rating and offer / no. Your notes are private to you — the director sees everyone’s together. The drag-and-drop team builder that uses this data is the next piece." },
    "admin-event.html":         { s: "live" },
    "tournament.html":          { s: "live" },
    "admin-league.html":        { s: "live" },
    "admin-schedule-editor.html": { s: "beta", n: "Drag matches between rounds and courts; drop on an occupied slot to swap. It never blocks a move — the panel just tells you what it did to fairness. Moving a match that already has a score asks first." },
    "admin-brackets.html":      { s: "beta", n: "Single elimination seeded from pool finish. Byes go to the top seeds — no play-in games. Winners move forward by recomputing the tree from the scores, so fixing a result that was typed in backwards also fixes the round above it." },
    "admin-score-links.html":   { s: "beta", n: "One scoring link per team, with a QR code. Teams record their own results in two taps; the page retires itself once a team has no games left. The QR is generated on the page — no outside service, so it works on venue wifi." },
    "admin-pool-board.html":    { s: "beta", n: "Drag teams into pools before any schedule exists. Drop on a + to start a pool; an empty one disappears on save. Notes typed on a tile stay with the team wherever it is dragged. Nothing is written until you press Save." },
    "admin-divisions.html":     { s: "beta", n: "Set up divisions and the courts each one owns — overlapping court ranges are flagged as you type. The placement check reads how teams actually finished and suggests moves with the numbers behind them; nothing moves until you accept, and declining is recorded too." },

    /* --- Money --- */
    "admin-reports.html":       { s: "live" },
    "admin-pos.html":           { s: "beta", n: "Square is in SANDBOX. Sales, line items and reporting are all real; the payment is not. No card is ever charged." },
    "admin-plans.html":         { s: "beta", n: "Square subscriptions are in SANDBOX. Do not sell a real membership from this screen — nothing will bill." },
    "admin-staff-pay.html":     { s: "beta", n: "Set what each coach is paid and see what a date range comes to. It works out the money and keeps a record; it does NOT run payroll, file tax or clock anyone in — pay people however you normally do." },
    "admin-passes.html":        { s: "beta", n: "Issue and spend passes, punch cards and the guest passes a membership includes. Fully working — but it does NOT take a payment: record the price for your own records and collect it however you normally do, until Square is live." },

    /* --- Marketing --- */
    "admin-marketing.html":     { s: "wip",  n: "Sending is deliberately blocked in code until two things are done: the physical mailing address is saved in Settings, and the Brevo API key plus SPF/DKIM/DMARC are verified. You can build contacts, segments and campaigns; you cannot send. This is expected — not a bug." },
    "admin-messages.html":      { s: "live" },
    "admin-announcements.html": { s: "beta", n: "Writing, scheduling and targeting all work. Anything that goes out by email is still sandboxed until the Brevo key is set." },
    "admin-sms.html":           { s: "wip",  n: "Texting is switched off at the platform level: Twilio A2P 10DLC registration is frozen by the owner. The screen, the recipient preview and the consent controls are all built and safe to look at, but no message can leave. Expected — not a bug." },

    /* --- People --- */
    "admin-users.html":         { s: "live" },
    "admin-security.html":      { s: "live" },
    "admin-waivers.html":       { s: "beta", n: "Versioning, publishing and signature pinning are finished and tested. The live text is still the v1 legacy placeholder — waiver v2 is drafted and waiting on one email address before it can be published." },
    "admin-consent.html":       { s: "live" },
    "admin-documents.html":     { s: "live" },
    "admin-uploads.html":       { s: "live" },
    "admin-tiers.html":         { s: "live" },
    "admin-member-fields.html": { s: "live" },
    "admin-org-settings.html":  { s: "live" },
    "admin-faq.html":           { s: "live" },
    "settings.html":            { s: "live" },
    "admin-buildstatus.html":   { s: "live" },
    "kiosk.html":               { s: "live" },

    /* --- Member site --- */
    "index.html":               { s: "live" },
    "home.html":                { s: "live" },
    "schedule.html":            { s: "live" },
    "live.html":                { s: "beta", n: "The public scoreboard — no sign-in needed, so it works on a TV by the door or a parent phone on venue wifi. Shows which court is on now first, then standings and brackets. Refreshes itself every 25 seconds and tells you when it last did. Team names only; no player details are sent." },
    "leagues.html":             { s: "live" },
    "library.html":             { s: "live" },
    "member-inbox.html":        { s: "live" },
    "profile.html":             { s: "live" },
    "membership.html":          { s: "beta", n: "Square is in SANDBOX. You can walk the whole join-a-plan flow; no real card is charged and no real membership starts." },
    "register.html":            { s: "beta", n: "Registration, teammates, waiver and Square checkout all work (SANDBOX). Promo codes cannot be entered at checkout yet — they are admin-applied only." },
    "checkin.html":             { s: "live" },
    "score.html":               { s: "live" },
    "kotc.html":                { s: "beta", n: "King and Queen of the Court, from a player's own link — no sign-in. Whoever opens it first types the net's scores; anyone opening it after that is shown what was entered and asked yes or no, and \"no\" becomes an edit that asks everyone else to look again. If you only remember your own points for the round, type that one number and we work out the rest of the net where the numbers allow it. The director's board that seats the nets is now built too — see Court board." },
    "admin-kotc.html":          { s: "beta", n: "The director's board for King and Queen of the Court: nets down the page, a player on each seat, drag somebody to move them. Drop them on another player and the two swap, so the board can never lose a person, and it never refuses a move — you know things the seeding does not. Games that already have a score are left exactly as they were played. Keyboard works throughout: focus a player, Enter to pick up, arrows to choose, Enter to drop. Not built yet: taking somebody off for the night, which still needs the entry list." },
    "kotc-live.html":           { s: "beta", n: "Public standings for a King and Queen of the Court night — no sign-in, so it works on a TV by the door or a parent's phone. Every player for themselves: wins first, then point difference. Updates itself every 25 seconds and only redraws when a position actually changes. Names are shortened to a first name and an initial, and no scoring links are ever sent to this page. Needs the session link that ends in ?s= and a number." },
    "member.html":              { s: "live" },
    "lfg.html":                 { s: "beta", n: "The sub board and the free-agent pool are finished. Replying to a roster invitation (RSVP) is the one piece still to come." },
    "sign.html":                { s: "live" },
    "guardian-complete.html":   { s: "live" },
    "help.html":                { s: "live" },
  };

  /* ---------------------------------------------------------------------
     2. FEATURES — cross-cutting things that are not a single page.
     Shown on the Build Status page only.
     --------------------------------------------------------------------- */
  const FEATURES = [
    { name: "Waiver status at the door",      s: "live", area: "People",
      n: "Check-in shows whether a member has a current waiver, and never blocks on it. The hard gate that used to refuse entry was REMOVED on the owner's instruction (2026-07-29, \"no gating\"). Someone getting in without a waiver is the intended behaviour — please do not file it." },
    { name: "Calendar feeds (.ics)",          s: "beta", area: "Run events",
      n: "The feed works, and admins can mint and copy a feed URL from the Calendar screen. Members still have no way to get their own feed — that ships with the member subscribe button." },
    { name: "Push notifications",             s: "wip",  area: "Member site",
      n: "The full PWA and push stack is built, but the three VAPID server secrets have never been set, so the browser cannot subscribe. Every push feature will look broken until that is done. Known — do not file." },
    { name: "Add to Home Screen (PWA)",       s: "live", area: "Member site",
      n: "Works on Android and desktop Chrome. On iOS use Share → Add to Home Screen." },
    { name: "Email delivery (Brevo)",         s: "wip",  area: "Marketing",
      n: "Every email path in the platform — reminders, waitlist offers, waiver notices, campaigns — is in sandbox mode. Nothing reaches a real inbox yet." },
    { name: "Payments (Square)",              s: "beta", area: "Money",
      n: "SANDBOX across the whole platform. Switching to production is the owner's call and is a deliberate, separate step." },
    { name: "SMS",                            s: "wip",  area: "Marketing",
      n: "Built, and deliberately dormant. Sending needs Twilio plus A2P 10DLC registration, which the owner has frozen, and its own opt-in that can never be bundled with the email consent. Every SMS route answers with a plain sentence and touches nothing until then." },
    { name: "Teammate self-sign links",       s: "live", area: "People",
      n: "Teammates get their own link and sign their own waiver — the captain no longer signs on their behalf." },
    { name: "Media-release opt-out record",   s: "live", area: "People",
      n: "A family's media-release choice is recorded against the person, and re-asked when the waiver version changes." },
    { name: "Promo redemption at checkout",   s: "soon", area: "Money",
      n: "Promos exist and work admin-side; the public checkout has no code box yet." },
    { name: "Achievements & public standings",s: "soon", area: "Run events", n: "M17. Spec approved, queued behind the format engine." },
    { name: "Tournament format engine",       s: "soon", area: "Run events", n: "M-TF. Pluggable formats: single/double elim, Swiss, King of the Court, ladder, blind draw." },
    { name: "Player Exchange (free agents, subs)", s: "beta", area: "People", n: "The sub board and the free-agent pool are live. Roster RSVP — replying yes or no to a team invitation — is the remaining piece." },
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
