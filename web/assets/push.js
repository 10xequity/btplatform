/* Boomtown Platform — Push client helper
   File: web/assets/push.js · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.20.0
   window.BT_PUSH = { supported, state, enable, disable }
   - supported(): browser can do SW + Push (on iOS only when installed to Home Screen)
   - enable(): registers sw.js, asks permission, subscribes, POSTs to /api/push/subscribe
   - disable(): unsubscribes locally + POSTs /api/push/unsubscribe
   Uses the same session pattern as settings.js (Bearer bt_token + X-Org-Id). */
(function () {
  const API = (window.BT_CONFIG && window.BT_CONFIG.apiBase) || "";

  function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent); }
  function isInstalled() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({ "content-type": "application/json" }, opts.headers || {});
    const t = sessionStorage.getItem("bt_token");
    if (t) headers["Authorization"] = "Bearer " + t;
    const org = localStorage.getItem("bt_org");
    if (org) headers["X-Org-Id"] = org;
    const resp = await fetch(API + path, Object.assign({}, opts, { headers, credentials: "include" }));
    return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => ({})) };
  }

  function b64uToBytes(s) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function reg() { return navigator.serviceWorker.register("sw.js"); }

  const BT_PUSH = {
    supported() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
      if (isIOS() && !isInstalled()) return false; // iOS: push only for Home-Screen apps
      return true;
    },
    iosNeedsInstall() { return isIOS() && !isInstalled(); },

    async state() {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const r = await navigator.serviceWorker.getRegistration();
      const sub = r && (await r.pushManager.getSubscription());
      if (sub) return "on";
      if (typeof Notification !== "undefined" && Notification.permission === "denied") return "blocked";
      return "off";
    },

    async enable() {
      if (this.iosNeedsInstall())
        return { ok: false, error: "First add Boomtown to your Home Screen (Share button → Add to Home Screen), then open it from there and try again." };
      if (!this.supported()) return { ok: false, error: "This browser doesn't support notifications." };
      const vk = await api("/api/push/vapid-key");
      if (!vk.ok || !vk.data.key) return { ok: false, error: vk.data.error || "Notifications aren't configured yet." };
      const r = await reg();
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return { ok: false, error: "Notifications were not allowed. You can change this in your browser settings." };
      const sub = await r.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToBytes(vk.data.key),
      });
      const saved = await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!saved.ok) { try { await sub.unsubscribe(); } catch {} return { ok: false, error: saved.data.error || "Couldn't save the subscription." }; }
      return { ok: true };
    },

    async disable() {
      const r = await navigator.serviceWorker.getRegistration();
      const sub = r && (await r.pushManager.getSubscription());
      if (sub) {
        try { await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch {}
        try { await sub.unsubscribe(); } catch {}
      }
      return { ok: true };
    },
  };

  window.BT_PUSH = BT_PUSH;

  // Passive SW registration so the site is installable everywhere push.js loads.
  if ("serviceWorker" in navigator) reg().catch(() => {});
})();

/* CHANGELOG
 * v1.0 (2026-07-25): Initial client helper — supported/state/enable/disable, iOS
 *   Home-Screen hint, passive SW registration. Ships in v0.20.0. */
