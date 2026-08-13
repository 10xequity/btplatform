/* Boomtown Platform — Settings
   File: web/assets/settings.js · Version: v1.1 · Date: 2026-07-25 · Ships in: v0.6.0 (v1.1 in v0.20.0)
   v1.1: Push-notification row in the Reminders card (BT_PUSH from push.js).
   Sections: Account (name/email/photo — edits live on the Profile page; email is your
   sign-in identity, changed by staff on request), Sign-in & security (passkeys replace
   passwords AND 2FA — one gesture is both factors), Appearance, Reminders, System (staff).
   Only calls endpoints that exist in v0.5.0: /api/me, /api/profile/me, /api/profile/reminders,
   /api/passkey/* (via window.btPasskey), /api/auth/logout. */

(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const app = document.getElementById("app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* theme + logout: site-nav.js v2.13 owns both listeners (per-page copies DELETED in
     v0.53.0 — double-bind kills the toggle; double logout double-fires the POST). The
     #themeNow label update moved into the single-source listener. signOut2 below still
     relays through #logoutBtn and keeps working. */

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    const t = sessionStorage.getItem("bt_token");
    if (t) headers["Authorization"] = "Bearer " + t;
    const org = localStorage.getItem("bt_org");
    if (org) headers["X-Org-Id"] = org;
    try {
      const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
      return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection and try again." } };
    }
  }

  boot();
  async function boot() {
    if (!sessionStorage.getItem("bt_token")) { location.href = "index.html"; return; }
    const me = await api("/api/me");
    if (!me.ok) { location.href = "index.html"; return; }
    const profile = await api("/api/profile/me");
    render(me.data, profile.ok ? profile.data : {});
  }

  function render(me, prof) {
    const orgId = Number(localStorage.getItem("bt_org")) || null;
    const roleRow = (me.roles || []).find(r => !orgId || r.org_id === orgId) || (me.roles || [])[0];
    const role = roleRow ? roleRow.role : "member";
    const staff = role === "admin" || role === "staff";
    const p = prof.profile || prof || {};
    const name = p.full_name || (prof.contact && prof.contact.full_name) || me.user.full_name || "";
    const theme = document.documentElement.dataset.theme;
    const remindersOn = !!(p.reminders_opt_in || prof.reminders_opt_in);

    app.innerHTML = `
      <h2 style="margin:0 0 14px">Settings</h2>

      <section class="card settings-section reveal" aria-labelledby="sAcct">
        <h3 id="sAcct">Account</h3>
        <div class="settings-row">
          <div class="grow"><div class="k">Name</div><div class="v">${esc(name) || "Not set yet"}</div></div>
          <a class="btn ghost" href="profile.html" style="text-decoration:none">Edit on Profile</a>
        </div>
        <!-- B2 (v0.130.0): the ACCOUNT display name — what greetings use and what a passkey is
             registered under. Distinct from the profile name above on purpose (D-18): this one
             never touches your member profile. Until this row existed, nothing could set it for
             an existing account and greetings fell back to the front of your email. -->
        <div class="settings-row">
          <div class="grow">
            <div class="k"><label for="dnInput">Display name</label></div>
            <div class="v" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px">
              <input id="dnInput" type="text" maxlength="80" autocomplete="nickname"
                     placeholder="How greetings address you"
                     style="font:inherit;min-height:44px;padding:8px 12px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;flex:1 1 200px" />
              <button class="btn" id="dnSave" type="button" disabled>Save</button>
            </div>
            <div class="v" id="dnSaid" role="status" aria-live="polite"
                 style="color:var(--text-muted);font-size:13px;min-height:1.3em;margin-top:4px">
              Leave it empty and we'll use the front of your email.</div>
          </div>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="k">Profile photo</div><div class="v">Crop &amp; upload a new photo on your profile.</div></div>
          <a class="btn ghost" href="profile.html" style="text-decoration:none">Change photo</a>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="k">Email (your sign-in)</div><div class="v">${esc(me.user.email)}</div></div>
          <a class="btn ghost" href="help.html" data-org-contact data-org-contact-subject="Change my sign-in email" style="text-decoration:none">Request change</a>
        </div>
        <p class="v" style="color:var(--text-muted);font-size:13px;margin:8px 0 0">
          Your email is how you sign in and where results and reminders go, so a staff member
          verifies it's really you before changing it. One quick email does it.</p>
      </section>

      <section class="card settings-section reveal" aria-labelledby="sSec">
        <h3 id="sSec">Sign-in &amp; security</h3>
        <p class="v" style="color:var(--text-muted);font-size:14px;margin:0 0 4px">
          There are no passwords here. A passkey (Face ID / fingerprint) is both your password
          and your second factor in one gesture &#8212; stronger than a code app, nothing to type.
          The email link always works as a backup.</p>
        <div class="settings-row">
          <div class="grow"><div class="k">Passkeys on this account</div><div class="v" id="pkCount">Checking&#8230;</div></div>
          <button id="pkAdd" class="btn">Add this device</button>
        </div>
        <div id="pkList"></div>
        <div class="settings-row">
          <div class="grow"><div class="k">Sign out</div><div class="v">Ends this session on this device.</div></div>
          <button id="signOut2" class="btn ghost">Sign out</button>
        </div>
      </section>

      <section class="card settings-section reveal" aria-labelledby="sApp">
        <h3 id="sApp">Appearance</h3>
        <div class="settings-row">
          <div class="grow"><div class="k">Theme</div>
            <div class="v" id="themeNow">${theme === "dark" ? "Dark (black &amp; gold)" : "Light (white &amp; navy)"}</div></div>
          <button class="btn ghost" onclick="document.getElementById('themeToggle').click()">Switch theme</button>
        </div>
      </section>

      <section class="card settings-section reveal" aria-labelledby="sNotif">
        <h3 id="sNotif">Reminders &amp; notifications</h3>
        <div class="settings-row">
          <div class="grow"><div class="k">Event email reminders</div>
            <div class="v">We'll email you 24 hours before events you're registered for.</div></div>
          <button id="remBtn" class="btn ghost">${remindersOn ? "Turn off" : "Turn on"}</button>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="k">Push notifications on this device</div>
            <div class="v" id="pushState">Checking&#8230;</div></div>
          <button id="pushBtn" class="btn ghost" hidden>Turn on</button>
        </div>
      </section>

      ${staff ? `
      <section class="card settings-section reveal" aria-labelledby="sSys" id="system">
        <h3 id="sSys">System (staff)</h3>
        <div class="settings-row">
          <div class="grow"><div class="k">Test push notifications</div>
            <div class="v">Sends a test notification to every device where you turned push on.</div></div>
          <button id="pushTestBtn" class="btn ghost">Send test</button>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="k">Members, roles &amp; admin access</div>
            <div class="v">Add staff, change roles, look up any member.</div></div>
          <a class="btn ghost" href="admin-users.html" style="text-decoration:none">Open</a>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="k">Events &amp; programs</div>
            <div class="v">Create and publish tournaments, leagues, and training.</div></div>
          <a class="btn ghost" href="admin-events.html" style="text-decoration:none">Open</a>
        </div>
        <div class="settings-row">
          <div class="grow"><div class="k">Foundation</div>
            <div class="v">Database, sign-in, roles, and org switching &#8212; running on Cloudflare D1. Healthy when the app loads.</div></div>
        </div>
      </section>` : ""}
    `;

    document.getElementById("signOut2").addEventListener("click", () => document.getElementById("logoutBtn").click());

    /* v0.143.0 (§-0 B29): the "Request change" anchor above carries [data-org-contact] and ships
       href="help.html". site-nav.js fills every such anchor with the ORGANIZATION's own contact
       address, but its pass runs when the rail paints — this row does not exist until render()
       has been called with /api/me, so the rail's single pass cannot have seen it. Calling the
       shared filler here is what makes this the fifth site rather than the one that stayed
       broken; it is idempotent, and if the brand has not resolved the help.html fallback stands. */
    if (window.btOrgContact) window.btOrgContact();

    /* staff push test (v1.1) */
    const ptb = document.getElementById("pushTestBtn");
    if (ptb) ptb.onclick = async () => {
      ptb.disabled = true; ptb.textContent = "Sending\u2026";
      const r = await api("/api/admin/push/test", { method: "POST", body: "{}" });
      ptb.disabled = false;
      ptb.textContent = r.ok ? `Sent to ${r.data.sent || 0} device${(r.data.sent||0) === 1 ? "" : "s"}` : (r.data.error || "Failed");
      setTimeout(() => { ptb.textContent = "Send test"; }, 4000);
    };

    /* push notifications (v1.1) */
    initPush();
    async function initPush() {
      const stateEl = document.getElementById("pushState");
      const btn = document.getElementById("pushBtn");
      if (!window.BT_PUSH) { stateEl.textContent = "Not available on this page."; return; }
      if (BT_PUSH.iosNeedsInstall()) {
        stateEl.textContent = "On iPhone/iPad: first tap Share \u2192 Add to Home Screen, then open Boomtown from that icon to turn these on.";
        return;
      }
      if (!BT_PUSH.supported()) { stateEl.textContent = "This browser doesn't support push notifications."; return; }
      async function refresh() {
        const s = await BT_PUSH.state();
        if (s === "blocked") { stateEl.textContent = "Blocked in your browser settings for this site."; btn.hidden = true; return; }
        const on = s === "on";
        stateEl.textContent = on ? "On \u2014 waitlist offers and updates arrive instantly." : "Off \u2014 you'll only get emails.";
        btn.textContent = on ? "Turn off" : "Turn on";
        btn.hidden = false;
        btn.onclick = async () => {
          btn.disabled = true;
          const r = on ? await BT_PUSH.disable() : await BT_PUSH.enable();
          btn.disabled = false;
          if (!r.ok) stateEl.textContent = r.error;
          else await refresh();
        };
      }
      await refresh();
    }

    /* reminders toggle */
    document.getElementById("remBtn").addEventListener("click", async (e) => {
      const turningOn = e.target.textContent.includes("on");
      e.target.disabled = true;
      const r = await api("/api/profile/reminders", { method: "POST", body: JSON.stringify({ opt_in: turningOn }) });
      e.target.disabled = false;
      if (r.ok) e.target.textContent = turningOn ? "Turn off" : "Turn on";
      else alert(r.data.error || "Couldn't save that. Try again.");
    });

    /* passkeys via window.btPasskey (assets/passkey.js) */
    paintPasskeys();
    document.getElementById("pkAdd").addEventListener("click", async () => {
      if (!(window.btPasskey && window.btPasskey.supported)) {
        return alert("This browser doesn't support passkeys. Try Safari, Chrome, or Edge on a device with Face ID, Touch ID, or Windows Hello.");
      }
      try { await window.btPasskey.enroll(); await paintPasskeys(); }
      catch (err) { /* user cancelled or enroll failed — passkey.js reports its own errors */ }
    });
    async function paintPasskeys() {
      const countEl = document.getElementById("pkCount");
      const listEl = document.getElementById("pkList");
      if (!(window.btPasskey && window.btPasskey.list)) { countEl.textContent = "Passkeys aren't available in this browser."; return; }
      let items = [];
      try { items = (await window.btPasskey.list()) || []; } catch (e) { countEl.textContent = "Couldn't load passkeys."; return; }
      countEl.textContent = items.length
        ? items.length + (items.length === 1 ? " passkey enrolled." : " passkeys enrolled.")
        : "None yet \u2014 add this device to sign in with Face ID / fingerprint.";
      listEl.innerHTML = items.map(k => `
        <div class="settings-row">
          <div class="grow"><div class="k">${esc(k.device_label || "Passkey")}</div>
            <div class="v">Added ${esc(k.created_at || "")}</div></div>
          <button class="btn ghost" data-remove="${esc(k.credential_id)}">Remove</button>
        </div>`).join("");
      listEl.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", async () => {
        if (!confirm("Remove this passkey? You can always sign in with the email link.")) return;
        try { await window.btPasskey.remove(b.dataset.remove); await paintPasskeys(); }
        catch (e) { alert("Couldn't remove it. Try again."); }
      }));
    }

    /* display name (B2, v0.130.0). PATCH /api/me writes the SESSION's own user — the server never
       reads an id from the body. Wired inside render like every other row here: render rebuilds
       #app wholesale, so these nodes are fresh each time and listeners cannot stack. */
    const dnInput = document.getElementById("dnInput");
    const dnSave = document.getElementById("dnSave");
    const dnSaid = document.getElementById("dnSaid");
    const dnStart = me.user.display_name || "";
    dnInput.value = dnStart;
    dnInput.addEventListener("input", () => {
      dnSave.disabled = dnInput.value.trim() === dnStart.trim();
    });
    dnSave.addEventListener("click", async () => {
      dnSave.disabled = true;
      const r = await api("/api/me", { method: "PATCH", body: JSON.stringify({ display_name: dnInput.value }) });
      if (!r.ok) {
        dnSaid.textContent = r.data.error || "Couldn't save that. Try again.";
        dnSave.disabled = false;
        return;
      }
      dnSaid.textContent = r.data.display_name
        ? `Saved — greetings will call you ${r.data.display_name}.`
        : "Saved — cleared, so greetings use the front of your email.";
    });
  }
})();
