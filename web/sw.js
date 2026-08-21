/* Boomtown Platform — Service Worker (PWA)
   File: web/sw.js · Version: v2.0 · Date: 2026-08-05 · Ships in: v0.89.0
   Strategy (deliberately conservative — never serve stale admin data):
     - Same-origin GET static files: NETWORK-FIRST, cache fallback (offline shell).
     - API origin (boomtown-api.*.workers.dev): NEVER touched — requests pass through.
     - push: show notification (payload JSON {title, body, url, tag}).
     - notificationclick: focus an open tab on our scope or open the target URL.

   v2.0 (roadmap §-1 Block C, audit R3 — the stale-cache class):
     - THE CACHE NAME DERIVES FROM THE RELEASE BUSTER. v1.0 pinned "bt-shell-v1" and never
       changed it across 67 releases, and `activate` only evicts keys !== CACHE — so the cache
       from v0.20.0 was never invalidated. The literal below is rewritten by sweep-buster.mjs
       on every release, so every deploy gets a fresh cache and `activate` evicts the old one —
       INCLUDING the long-poisoned "bt-shell-v1" the moment this file reaches a browser (the SW
       update check bypasses HTTP cache, so a normal navigation delivers it; that IS the
       one-time purge the audit asked for, and it needs no flag).
     - THE FALLBACK IS EXACT. v1.0 matched with `ignoreSearch: true`, so an asset cached under
       an OLD buster satisfied a request carrying the NEW one and one failed fetch left new HTML
       running old JS/CSS. (No literal example versions here — sweep-buster rewrites every
       `?v=` literal in this file, which would rewrite the example into nonsense; the real
       before/after pair is in the audit, docs/2026-08-05_audit_tester-round_v1_0.md §3.)
       A stale asset can no longer satisfy a fresh request; the offline fallback never crosses
       a version boundary. */

const V = ("?v=0.174.0").slice(3); // ← swept by sweep-buster.mjs --write on every release
const CACHE = "bt-shell-v" + V;

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
      const hit = await caches.match(req); // exact URL, buster included — never cross a version boundary
      return hit || Response.error();
    }
  })());
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || "Boomtown Athletics";
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
 * v2.0 (2026-08-05): Block C — version-derived cache name (swept per release, so activate
 *   finally evicts; the first activation purges the long-poisoned bt-shell-v1) and an exact
 *   fallback match (ignoreSearch retired — a stale asset can never satisfy a fresh request).
 *   Ships in v0.89.0.
 * v1.0 (2026-07-25): Initial SW — network-first shell cache, API pass-through,
 *   push display + click-through. Ships in v0.20.0. */
