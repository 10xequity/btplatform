/* Boomtown Platform — Passkeys (Face ID / fingerprint)
   File: web/assets/passkey.js · Version: v1.0 · Date: 2026-07-22 · Ships in: v0.5.0
   Progressive enhancement:
   - On the sign-in screen (app.js renders #sendLink), injects a "Sign in with
     Face ID / fingerprint" button when the browser supports passkeys.
   - Exposes window.btPasskey { supported, login, enroll, list, remove } for profile.js.
   No frameworks. Fails silently to the email link on any error. */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";
  const supported = !!(window.PublicKeyCredential && navigator.credentials);

  function bearerHeaders() {
    const h = { "content-type": "application/json" };
    const t = sessionStorage.getItem("bt_token");
    if (t) h["Authorization"] = "Bearer " + t;
    const org = localStorage.getItem("bt_org");
    if (org) h["X-Org-Id"] = org;
    return h;
  }
  async function api(path, opts = {}) {
    const resp = await fetch(API + path, Object.assign({ headers: bearerHeaders(), credentials: "include" }, opts, {
      headers: Object.assign(bearerHeaders(), (opts.headers || {})),
    }));
    return { ok: resp.ok, data: await resp.json().catch(() => ({})) };
  }

  /* ---------- base64url ↔ bytes ---------- */
  function b2u(bytes) {
    let s = ""; new Uint8Array(bytes).forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function u2b(str) {
    const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- login (usernameless) ---------- */
  async function login() {
    const opt = await api("/api/passkey/login-options", { method: "POST", body: "{}" });
    if (!opt.ok) throw new Error(opt.data.error || "Couldn't start sign-in.");
    const pk = opt.data.publicKey;
    pk.challenge = u2b(pk.challenge);
    (pk.allowCredentials || []).forEach((c) => (c.id = u2b(c.id)));
    const cred = await navigator.credentials.get({ publicKey: pk });
    const body = {
      id: cred.id,
      response: {
        clientDataJSON: b2u(cred.response.clientDataJSON),
        authenticatorData: b2u(cred.response.authenticatorData),
        signature: b2u(cred.response.signature),
        userHandle: cred.response.userHandle ? b2u(cred.response.userHandle) : null,
      },
    };
    const r = await api("/api/passkey/login", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.data.error || "That didn't go through.");
    sessionStorage.setItem("bt_token", r.data.token);
    return true;
  }

  /* ---------- enroll (requires an existing session) ---------- */
  async function enroll(label) {
    const opt = await api("/api/passkey/register-options");
    if (!opt.ok) throw new Error(opt.data.error || "Sign in first.");
    const pk = opt.data.publicKey;
    pk.challenge = u2b(pk.challenge);
    pk.user.id = u2b(pk.user.id);
    (pk.excludeCredentials || []).forEach((c) => (c.id = u2b(c.id)));
    const cred = await navigator.credentials.create({ publicKey: pk });
    const body = {
      id: cred.id,
      label: label || "",
      response: {
        clientDataJSON: b2u(cred.response.clientDataJSON),
        attestationObject: b2u(cred.response.attestationObject),
      },
    };
    const r = await api("/api/passkey/register", { method: "POST", body: JSON.stringify(body) });
    if (!r.ok) throw new Error(r.data.error || "That didn't go through.");
    return r.data.label;
  }

  async function list() {
    const r = await api("/api/passkey/list");
    return r.ok ? r.data.passkeys : [];
  }
  async function remove(credentialId) {
    return api("/api/passkey/remove", { method: "POST", body: JSON.stringify({ credential_id: credentialId }) });
  }

  window.btPasskey = { supported, login, enroll, list, remove };

  /* ---------- inject the button on the app-shell sign-in screen ---------- */
  function tryInject() {
    if (!supported) return;
    const send = document.getElementById("sendLink");
    if (!send || document.getElementById("passkeyLogin")) return;
    const btn = document.createElement("button");
    btn.id = "passkeyLogin";
    btn.className = "btn";
    btn.style.cssText = "width:100%;margin-top:10px";
    btn.textContent = "Sign in with Face ID / fingerprint";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "Waiting for your device…";
      try {
        await login();
        location.reload(); // app.js boots with the fresh bt_token
      } catch (e) {
        btn.disabled = false;
        btn.textContent = old;
        const n = document.getElementById("loginNotice");
        if (n) n.innerHTML = `<div class="notice error">${(e && e.message) || "That didn't go through. Try again, or use the email link."}</div>`;
      }
    });
    send.insertAdjacentElement("afterend", btn);
  }
  const mo = new MutationObserver(tryInject);
  const app = document.getElementById("app");
  if (app) mo.observe(app, { childList: true, subtree: true });
  tryInject();
})();
