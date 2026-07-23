/* Boomtown Platform — App Shell
   Version: v0.6.0 · Date: 2026-07-23
   Handles: magic-link login, verify (?token=), session (Bearer, in-memory + sessionStorage),
   org switcher (≤2 clicks), theme toggle (instant — high-frequency action).
   v0.2.4: network failures show a clear message and re-enable the send button;
           startup guard if config.js is stale/placeholder.
   v0.6.0: member/manager sign-in switch · dashboard cards all clickable (Foundation → Settings,
           Leagues area, Member Management, Settings) · site-nav sidebar on the dashboard. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const app = document.getElementById("app");
  const orgSwitcher = document.getElementById("orgSwitcher");
  const themeToggle = document.getElementById("themeToggle");
  const logoutBtn = document.getElementById("logoutBtn");

  /* ---------- theme (system preference honored, user override persisted) ---------- */
  const savedTheme = localStorage.getItem("bt_theme");
  const systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(savedTheme || (systemLight ? "light" : "dark"));
  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("bt_theme", next);
  });
  function setTheme(t) { document.documentElement.dataset.theme = t; }

  /* ---------- config guard (catches stale cached config.js) ---------- */
  if (!API || API.includes("PENDING")) {
    render(`<div class='login-wrap'><div class='card login-card'><h1>One moment</h1><p>The app is still loading its latest settings. Hold <strong>Ctrl</strong> and press <strong>F5</strong> to refresh. If this message stays after a few minutes, tell Claude.</p></div></div>`);
    return;
  }

  /* ---------- session ---------- */
  let bearer = sessionStorage.getItem("bt_token") || null;

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = localStorage.getItem("bt_org");
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
  if (params.get("token")) {
    verifyToken(params.get("token"));
  } else {
    route();
  }

  async function route() {
    const me = bearer ? await api("/api/me") : { ok: false };
    if (me.ok) renderDashboard(me.data);
    else renderLogin();
  }

  async function verifyToken(token) {
    history.replaceState({}, "", location.pathname); // scrub token from the URL
    render(`<div class="login-wrap"><div class="card login-card"><p>Signing you in…</p></div></div>`);
    const r = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
    if (r.ok) {
      bearer = r.data.token;
      sessionStorage.setItem("bt_token", bearer);
      route();
    } else {
      renderLogin(r.data.error || "Sign-in failed. Request a new link.");
    }
  }

  /* ---------- views ---------- */
  function renderLogin(errorMsg) {
    logoutBtn.hidden = true;
    orgSwitcher.hidden = true;
    const savedRole = localStorage.getItem("bt_login_role") || "member";
    render(`
      <div class="login-wrap">
        <div class="card login-card reveal">
          <h1>Sign in</h1>
          <div class="login-tabs" role="tablist" aria-label="Sign in as">
            <button id="tabMember" class="login-tab" role="tab" aria-selected="false">Member</button>
            <button id="tabManager" class="login-tab" role="tab" aria-selected="false">Manager</button>
          </div>
          <p id="loginHint"></p>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" />
          </div>
          <button id="sendLink" class="btn">Send sign-in link</button>
          <div id="loginNotice"></div>
        </div>
      </div>`);
    if (errorMsg) notice(errorMsg, true);

    const tabs = { member: document.getElementById("tabMember"), manager: document.getElementById("tabManager") };
    function pickRole(r) {
      localStorage.setItem("bt_login_role", r);
      tabs.member.classList.toggle("active", r === "member");
      tabs.manager.classList.toggle("active", r === "manager");
      tabs.member.setAttribute("aria-selected", r === "member");
      tabs.manager.setAttribute("aria-selected", r === "manager");
      document.getElementById("loginHint").textContent = r === "manager"
        ? "Staff & admins: use Face ID / fingerprint below if you\u2019ve added a passkey, or the email link."
        : "We\u2019ll email you a one-time sign-in link. No password needed.";
    }
    tabs.member.addEventListener("click", () => pickRole("member"));
    tabs.manager.addEventListener("click", () => pickRole("manager"));
    pickRole(savedRole);

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
        r = await api("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
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
    orgSwitcher.innerHTML = orgs.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
    const savedOrg = localStorage.getItem("bt_org");
    if (savedOrg && orgs.some((o) => String(o.id) === savedOrg)) orgSwitcher.value = savedOrg;
    else localStorage.setItem("bt_org", orgSwitcher.value);
    orgSwitcher.onchange = () => { localStorage.setItem("bt_org", orgSwitcher.value); paint(); };

    paint();

    function paint() {
      const orgId = Number(orgSwitcher.value);
      const org = orgs.find((o) => o.id === orgId);
      const role = roleByOrg[orgId] || "member";
      const staff = role === "admin" || role === "staff";
      const card = (href, title, desc, status) => `
        <a class="card module reveal" href="${href}" style="text-decoration:none;color:inherit">
          <h3>${title} \u2192</h3><p>${desc}</p>
          <span class="status ${status === "Live" ? "live" : "next"}">${status}</span>
        </a>`;
      render(`
        <h2 style="margin:0 0 2px">${org ? org.name : ""}</h2>
        <p style="margin:0;color:var(--text-muted)">Signed in as ${meData.user.email} \u00b7 <span class="role-pill">${role}</span></p>
        <div class="grid">
          ${card("schedule.html", "Schedule", "Every upcoming tournament, league night, and event.", "Live")}
          ${staff
            ? card("tournament.html", "Tournaments", "Formats, auto-scheduler, live scoring, standings, brackets.", "Live")
            : card("schedule.html?type=tournament", "Tournaments", "Standings, schedules, and results.", "Live")}
          ${card("leagues.html", "Leagues", "League nights, weekly schedules, and season standings.", "Live")}
          ${card("profile.html", "My Profile", "Photo, results r\u00e9sum\u00e9, family accounts, reminders.", "Live")}
          ${staff ? card("admin-users.html", "Member Management", "Members, roles, and admin access.", "Live") : ""}
          ${staff ? card("admin-registrations.html", "Registrations", "Sign-ups, Square payments, unpaid reminders.", "Live") : ""}
          ${card("settings.html", "Settings", "Sign-in \u0026 security, passkeys, appearance, reminders.", "Live")}
          ${staff ? card("settings.html#system", "Foundation", "Database, sign-in, roles, and org switching.", "Live") : ""}
        </div>`);
    }
  }

  logoutBtn.addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    bearer = null;
    sessionStorage.removeItem("bt_token");
    renderLogin();
  });

  function render(html) { app.innerHTML = html; }
})();
