/* Boomtown Platform — Service Worker (PWA)
   File: web/sw.js · Version: v1.0 · Date: 2026-07-25 · Ships in: v0.20.0
   Strategy (deliberately conservative — never serve stale admin data):
     - Same-origin GET static files: NETWORK-FIRST, cache fallback (offline shell).
     - API origin (boomtown-api.*.workers.dev): NEVER touched — requests pass through.
     - push: show notification (payload JSON {title, body, url, tag}).
     - notificationclick: focus an open tab on our scope or open the target URL. */

const CACHE = "bt-shell-v1"; // bump suffix to invalidate everything

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) =>
    c.addAll(["./home.html", "./index.html", "./manifest.webmanifest", "./assets/logo-boom-icon-512.png"])
      .catch(() => {}) // precache is best-effort
  ));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // API + third parties: untouched
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || "Boomtown Volleyball";
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "./assets/logo-boom-icon-512.png",
    badge: "./assets/logo-boom-icon-512.png",
    tag: data.tag || "bt",
    data: { url: data.url || "./home.html" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "./home.html";
  e.waitUntil((async () => {
    const abs = new URL(target, self.location.href).href;
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); await w.navigate(abs); return; }
    }
    await self.clients.openWindow(abs);
  })());
});

/* CHANGELOG
 * v1.0 (2026-07-25): Initial SW — network-first shell cache, API pass-through,
 *   push display + click-through. Ships in v0.20.0. */
