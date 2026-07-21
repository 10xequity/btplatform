/* Boomtown Platform — App Shell
   Version: v0.1 · Date: 2026-07-21
   Handles: magic-link login, verify (?token=), session (Bearer, in-memory + sessionStorage),
   org switcher (≤2 clicks), theme toggle (instant — high-frequency action). */

(function () {
  const API = window.BT_CONFIG.apiBase;
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

  /* ---------- session ---------- */
  let bearer = sessionStorage.getItem("bt_token") || null;

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    if (bearer) headers["Authorization"] = "Bearer " + bearer;
    const orgId = localStorage.getItem("bt_org");
    if (orgId) headers["X-Org-Id"] = orgId;
    const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
    return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
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
    render(`
      <div class="login-wrap">
        <div class="card login-card reveal">
          <h1>Sign in</h1>
          <p>Enter your email and we'll send a one-time sign-in link. No password needed.</p>
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" />
          </div>
          <button id="sendLink" class="btn">Send sign-in link</button>
          <div id="loginNotice"></div>
        </div>
      </div>`);
    if (errorMsg) notice(errorMsg, true);
    const emailInput = document.getElementById("email");
    document.getElementById("sendLink").addEventListener("click", submit);
    emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    async function submit() {
      const email = emailInput.value.trim();
      if (!email) return notice("Enter your email address.", true);
      const btn = document.getElementById("sendLink");
      btn.disabled = true;
      const r = await api("/api/auth/request-link", { method: "POST", body: JSON.stringify({ email }) });
      btn.disabled = false;
      if (!r.ok) return notice(r.data.error || "Something went wrong. Try again.", true);
      if (r.data.mode === "sandbox") {
        notice(`Sandbox mode (no email provider yet). <a href="${r.data.dev_link}">Open your sign-in link</a>.`);
      } else {
        notice("Link sent. Check your email — it expires in 15 minutes.");
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
      render(`
        <h2 style="margin:0 0 2px">${org ? org.name : ""}</h2>
        <p style="margin:0;color:var(--text-muted)">Signed in as ${meData.user.email} · <span class="role-pill">${role}</span></p>
        <div class="grid">
          <div class="card module reveal">
            <h3>Foundation</h3>
            <p>Database, sign-in, roles, and org switching.</p>
            <span class="status live">Live</span>
          </div>
          ${role === "admin" || role === "staff"
            ? `<a class="card module reveal" href="tournament.html" style="text-decoration:none;color:inherit">
                <h3>Tournaments →</h3>
                <p>Formats, auto-scheduler, live scoring, standings, brackets.</p>
                <span class="status live">Live</span>
              </a>`
            : `<div class="card module reveal">
                <h3>Tournaments</h3>
                <p>Formats, auto-scheduler, live scoring, standings, brackets.</p>
                <span class="status next">Coming soon</span>
              </div>`}
          <div class="card module reveal">
            <h3>Registration</h3>
            <p>Sign-up forms, Square checkout, unpaid reminders.</p>
            <span class="status next">Module 4</span>
          </div>
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
