/* Boomtown Platform — App Shell
   Version: v0.11.0 · Date: 2026-08-24 · Ships in: v0.177.0 (v0.11.0 in v0.194.0)
   v0.10.0 (§-1r RF-17, owner 2026-08-24 "Default view to home"): completing a sign-in with no
   carried return page lands on home.html — the member's own dashboard — instead of this public
   grid. A SIGNED-IN member who navigates here (the rail's Explore item) still gets the grid;
   only the sign-in completion redirects, so Explore stays reachable.
   Handles: magic-link login, verify (?token=), session (Bearer, in-memory + sessionStorage),
   org switcher (≤2 clicks), theme toggle (instant — high-frequency action).
   v0.8.0 (§-1r RF-12, owner 2026-08-18): the v0.6.0 Member/Manager sign-in switch and the
           staff-gated Control Center card are DELETED — "there are options for the admin panel
           on that page or lead to the admin page. This is not allowable for security reason."
           Everyone signs in the same way (email link, or the passkey button passkey.js injects);
           the tab only ever flipped hint copy. Staff reach admin.html by URL or bookmark.
           Guards: header_actions.test.mjs v4.0 (card-grid verdict + widest-set RF-12 scan).
   v0.2.4: network failures show a clear message and re-enable the send button;
           startup guard if config.js is stale/placeholder.
   v0.6.0: member/manager sign-in switch · dashboard cards all clickable (Foundation → Settings,
           Leagues area, Member Management, Settings) · site-nav sidebar on the dashboard. */

(function () {
  /* D-42 (v0.167.0): ONE fallback map per PAGE, not one per module. v0.166.0 gave each guarded
     file its own closure-private Map, which is coherent inside a file and incoherent across a
     page: with storage blocked, this module's write was invisible to every other module on the
     same page, so two of them disagreed about state they both read from one place (measured:
     `bt_org` and `bt_token` are touched by four guarded modules; tournament.html co-loads
     admin-nav.js, which WRITES bt_org, with this page's reader). The map hangs off `window`
     so every guarded file on the page shares one object for the page's lifetime; the
     `x || (x = new Map())` form is load-order-independent, so whichever script runs first
     creates it and the rest join it. Storage stays the source of truth whenever it works —
     the map is consulted only when a read throws or comes back empty. */
  const localMem = window.BT_MEM_FALLBACK || (window.BT_MEM_FALLBACK = new Map());
  const sessionMem = window.BT_SESSION_FALLBACK || (window.BT_SESSION_FALLBACK = new Map());
  const safeGet = (k) => { try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) {} return localMem.has(k) ? localMem.get(k) : null; };
  const safeSet = (k, v) => { localMem.set(k, v); try { localStorage.setItem(k, v); } catch (e) {} };
  const safeDel = (k) => { localMem.delete(k); try { localStorage.removeItem(k); } catch (e) {} };
  const ssGet = (k) => { try { const v = sessionStorage.getItem(k); if (v != null) return v; } catch (e) {} return sessionMem.has(k) ? sessionMem.get(k) : null; };
  const ssSet = (k, v) => { sessionMem.set(k, v); try { sessionStorage.setItem(k, v); } catch (e) {} };
  const ssDel = (k) => { sessionMem.delete(k); try { sessionStorage.removeItem(k); } catch (e) {} };
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const app = document.getElementById("app");
  const orgSwitcher = document.getElementById("orgSwitcher");
  const themeToggle = document.getElementById("themeToggle");
  const logoutBtn = document.getElementById("logoutBtn");

  /* ---------- theme: ONE WRITER, AND IT IS NOT THIS FILE (§-1r RF-9, 2026-08-18) ----------
     index.html's two pre-paint lines (:15 and :16) already applied `data-theme` AND `data-template`
     before the first stylesheet, so there is nothing for this file to apply on load. What it used to
     do was flip `dataset.theme` on its own and leave `data-template` alone — and because
     tokens.css's template block follows the base block at EQUAL SPECIFICITY, the template kept
     supplying every colour token. The ◐ was therefore a visible no-op on this one page, while still
     writing `bt_theme` and leaving `bt_template_<mode>` behind, so the next page a member opened
     disagreed with this one. Every other surface — 38 admin pages via admin-nav.js and 17 member
     pages via site-nav.js — already delegates to BT_THEME; index.html was the 56th and the only
     holdout. config.js loads at index.html:33, ahead of this script, so the service is always there.
     THIS FILE STILL OWNS THE HANDOFF, deliberately: site-nav.js gates its own binding on
     #btHdrMail, which index.html does not carry, precisely so the two cannot double-bind.
     v0.11.0 (RF-15, owner 2026-08-24): the ◐ opens the six-chip picker — attachPicker binds the
     click and owns the popover; the flip is the picker's first two chips. */
  window.BT_THEME.attachPicker(themeToggle);

  /* ---------- config guard (catches stale cached config.js) ---------- */
  if (!API || API.includes("PENDING")) {
    render(`<div class='login-wrap'><div class='card login-card'><h1>One moment</h1><p>The app is still loading its latest settings. Hold <strong>Ctrl</strong> and press <strong>F5</strong> to refresh. If this message stays after a few minutes, tell Claude.</p></div></div>`);
    return;
  }

  /* ---------- session ---------- */
  let bearer = ssGet("bt_token") || null;

  /** HTML-escape anything that came from the server before it reaches innerHTML. */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = safeGet("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, networkError: true,
        data: { error: "Can't reach the server. Check your internet connection, hard-refresh (Ctrl+F5), and try again." } };
    }
  }

  /* ---------- boot ---------- */
  const params = new URLSearchParams(location.search);
  /* D-48 (v0.177.0), the reader half of admin-nav's expired bounce and of the emailed link.
     ONE validator — this value becomes location.replace(), so ONLY a bare same-directory page
     name passes (the open-redirect line); anything else reads as absent. The server embeds
     `from` into the magic link through the same judgement, because the link may be opened on
     another device and the LINK is the only carry that survives. Captured at boot, before
     verifyToken scrubs the URL. */
  const safeFrom = (v) => (typeof v === "string" && /^[a-z0-9-]+\.html$/.test(v) ? v : null);
  const returnTo = safeFrom(params.get("from"));
  if (params.get("token")) {
    verifyToken(params.get("token"));
  } else {
    route();
  }

  async function route() {
    const me = bearer ? await api("/api/me") : { ok: false };
    /* D-48: back to the page the session died on. This covers the passkey path too — passkey.js
       signs in and reloads with ?expired=1&from= still in the URL. returnTo is boot-validated. */
    if (me.ok && returnTo) { location.replace(returnTo); return; }
    if (me.ok) renderDashboard(me.data);
    else renderLogin();
  }

  async function verifyToken(token) {
    history.replaceState({}, "", location.pathname); // scrub token from the URL (returnTo was captured at boot)
    render(`<div class="login-wrap"><div class="card login-card"><p>Signing you in…</p></div></div>`);
    const r = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
    if (r.ok) {
      bearer = r.data.token;
      ssSet("bt_token", bearer);
      if (returnTo) { location.replace(returnTo); return; } // D-48: the emailed link carried the way back
      // RF-17 (v0.193.0, owner: "Default view to home"): a fresh sign-in lands on the member's
      // own dashboard. Navigating HERE while signed in (the Explore rail item) still renders the
      // grid — only the sign-in completion redirects, so Explore keeps its way in.
      location.replace("home.html");
    } else {
      renderLogin(r.data.error || "Sign-in failed. Request a new link.");
    }
  }

  /* ---------- views ---------- */
  /* v0.106.0 (§-1f F-3) — WHICH ORG THIS SIGN-IN SCREEN IS FOR.
     `?org=<slug|id>` first: it is explicit, shareable, and the only source that works for someone
     who has never signed in here and so has no stored org. Then the last org they used. Then
     nothing — and "nothing" means no lockup is rendered at all, which is also why that branch
     cannot shift: there is never anything to arrive. Subdomains were not an option; the app is
     served from a PATH (10xequity.github.io/btplatform/web), not a host an org could own. */
  function loginOrgHint() {
    try {
      const q = (new URLSearchParams(location.search).get("org") || "").trim();
      if (q) return q;
      return safeGet("bt_org") || null;
    } catch (e) { return null; }
  }

  /* The org brand, swapped INTO a lockup that is already on screen. This is applyOrgBrand()
     from site-nav.js, which has done exactly this for the member rail since v0.50.0 — same
     endpoint, same 5-minute cache key, same fail-closed rules. Deliberately NOT /api/orgs:
     that enumerates every active org to brand one card, and S-1b now gates it. */
  async function applyLoginBrand(org) {
    if (!org || !API || API.includes("PENDING")) return;
    const KEY = "bt_org_brand:" + org;
    let brand = null;
    try {
      const cached = JSON.parse(safeGet(KEY) || "null");
      if (cached && (Date.now() - cached.at) < 5 * 60 * 1000) brand = cached.v;
    } catch (e) { /* bad cache = no cache */ }
    if (!brand) {
      try {
        const r = await fetch(API + "/api/public/org-brand?org=" + encodeURIComponent(org));
        if (!r.ok) return;                      // unknown org = the default lockup stays
        brand = await r.json();
        safeSet(KEY, JSON.stringify({ at: Date.now(), v: brand }));
      } catch (e) { return; }                   // offline = the default lockup stays
    }
    if (!brand || !brand.display_name) return;  // a nameless payload changes nothing
    const nameEl = document.getElementById("loginBrandName");
    if (nameEl) nameEl.textContent = brand.display_name;
    const img = document.getElementById("loginBrandLogo");
    if (img && brand.logo_url) {
      img.onerror = () => { img.src = "assets/logo-boom-icon-512.png?v=0.199.0"; }; // fail closed on 404
      img.src = brand.logo_url;
    }
  }

  function renderLogin(errorMsg) {
    logoutBtn.hidden = true;
    orgSwitcher.hidden = true;
    const org = loginOrgHint();
    /* The lockup ships in the SYNCHRONOUS template, never injected after the fetch — D-15 closed
       exactly that defect on the member rail one release ago and the card is one await from it.
       The logo carries explicit width/height so it reserves its box before it loads, and the name
       fills sideways into a fixed-width card, so the swap changes no height. */
    /* RF-8(a): the lockup ships UNCONDITIONALLY with the Boomtown default, so an arrival with no
       ?org hint gets a branded card instead of a bare one. applyLoginBrand(org) swaps in an org's
       own name/logo when one resolves; with no org it is a no-op and this default stands. */
    const brandSlot = `<div class="login-brand"><img id="loginBrandLogo" src="assets/logo-boom-icon-512.png?v=0.199.0" alt="" width="36" height="36" /><span id="loginBrandName">Boomtown Athletics</span></div>`;
    render(`
      <div class="login-wrap">
        <div class="card login-card reveal">
          ${brandSlot}
          <h1>Sign in</h1>
          <p id="loginHint">${params.get("expired") === "1"
            ? `Your session expired. Sign in again${returnTo ? " and you’ll land back where you were" : ""}. No password needed.`
            : "We’ll email you a one-time sign-in link. No password needed."}</p>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" />
          </div>
          <button id="sendLink" class="btn">Send sign-in link</button>
          <div id="loginNotice"></div>
        </div>
      </div>`);
    if (errorMsg) notice(errorMsg, true);
    applyLoginBrand(org); // v0.106.0 — AFTER the card exists, deliberately not awaited

    /* RF-12: the Member/Manager tablist is gone \u2014 it only ever flipped this hint's copy, and it
       advertised the admin panel on the public front door. One flow for everyone: the email
       link, or the passkey button passkey.js injects after #sendLink for anyone who added one. */
    const emailInput = document.getElementById("email");
    document.getElementById("sendLink").addEventListener("click", submit);
    emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    async function submit() {
      const email = emailInput.value.trim();
      if (!email) return notice("Enter your email address.", true);
      const btn = document.getElementById("sendLink");
      btn.disabled = true;
      btn.textContent = "Sending\u2026";
      let r;
      try {
        /* D-48: the return page rides the REQUEST so the server can put it in the emailed link —
           the link may be opened on another device, where no storage from this page exists. */
        r = await api("/api/auth/request-link", { method: "POST",
          body: JSON.stringify({ email, from: safeFrom(params.get("from")) || undefined }) });
      } finally {
        btn.disabled = false;
        btn.textContent = "Send sign-in link";
      }
      if (!r.ok) return notice(r.data.error || "Something went wrong. Try again.", true);
      if (r.data.mode === "sandbox") {
        notice(`Sandbox mode (no email provider yet). <a href="${r.data.dev_link}">Open your sign-in link</a>.`);
      } else {
        notice("Link sent. Check your email \u2014 it expires in 15 minutes.");
      }
    }
    function notice(msg, isError) {
      document.getElementById("loginNotice").innerHTML =
        `<div class="notice${isError ? " error" : ""}">${msg}</div>`;
    }
  }

  async function renderDashboard(meData) {
    logoutBtn.hidden = false;
    const orgs = (await api("/api/orgs")).data.orgs || [];
    const roleByOrg = {};
    (meData.roles || []).forEach((r) => (roleByOrg[r.org_id] = r.role));

    orgSwitcher.hidden = false;
    orgSwitcher.innerHTML = orgs.map((o) => `<option value="${Number(o.id)}">${esc(o.name)}</option>`).join("");
    const savedOrg = safeGet("bt_org");
    if (savedOrg && orgs.some((o) => String(o.id) === savedOrg)) orgSwitcher.value = savedOrg;
    else safeSet("bt_org", orgSwitcher.value);
    orgSwitcher.onchange = () => { safeSet("bt_org", orgSwitcher.value); paint(); };

    paint();

    function paint() {
      const orgId = Number(orgSwitcher.value);
      const org = orgs.find((o) => o.id === orgId);
      const role = roleByOrg[orgId] || "member";
      const card = (href, title, desc, status) => `
        <a class="card module reveal" href="${href}" style="text-decoration:none;color:inherit">
          <h3>${title} \u2192</h3><p>${desc}</p>
          <span class="status ${status === "Live" ? "live" : "next"}">${status}</span>
        </a>`;
      render(`
        <h2 style="margin:0 0 2px">${org ? esc(org.name) : ""}</h2>
        <p style="margin:0;color:var(--text-muted)">Signed in as ${esc(meData.user.email)} \u00b7 <span class="role-pill">${esc(role)}</span></p>
        <div class="grid">
          ${card("schedule.html", "Event Schedule", "Every upcoming tournament, league night, and event.", "Live")}
          ${card("schedule.html?type=tournament", "Tournaments", "Standings, schedules, and results.", "Live")}
          ${card("leagues.html", "Leagues", "League nights, weekly schedules, and season standings.", "Live")}
          ${card("profile.html", "My Profile", "Photo, results r\u00e9sum\u00e9, family accounts, reminders.", "Live")}
          ${card("settings.html", "Settings", "Sign-in \u0026 security, passkeys, appearance, reminders.", "Live")}
        </div>`);
    }
  }

  logoutBtn.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    bearer = null;
    ssDel("bt_token");
    renderLogin();
  });

  function render(html) { app.innerHTML = html; }
})();
