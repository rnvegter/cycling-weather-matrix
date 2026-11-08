"use strict";

/* ---------------------------------------------------------------
   Service worker: the app opens with no connection.

   The app is read at 06:40, and the stairwell or garage it is read in often
   has no signal. Without this the page itself would not load, whatever the
   app kept in localStorage. So every file of the app this page loads is kept
   in a cache as it arrives, and served from there only when the network
   fails.

   Network first, always. A cache-first worker would keep serving last
   month's scripts after an update — the failure INSTALL.md already warns
   about with proxies — so the cache is a stand-in for a missing network and
   never a shortcut past a present one. An update lands on the first load
   with a connection, as it does without a worker.

   Only this app's own files. The API (sync, lookups, backups) is live or
   nothing; Open-Meteo answers are kept by the app itself (weather.js), with
   the time they are from; fonts and map tiles fall back on their own.
----------------------------------------------------------------*/

const CACHE = "cwem-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  // Old shell caches, from a version of this file that named another.
  for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  e.respondWith((async () => {
    try{
      const res = await fetch(req);
      if (res.ok){
        const cache = await caches.open(CACHE);
        await cache.put(req, res.clone());
      }
      return res;
    }catch(err){
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, {ignoreSearch: true});
      if (hit) return hit;
      // Opening the app offline asks for "/" or "/index.html", whichever it
      // was not when it was cached.
      if (req.mode === "navigate"){
        const scope = self.registration.scope;
        const page = await cache.match(scope) || await cache.match(new URL("index.html", scope).href);
        if (page) return page;
      }
      throw err;
    }
  })());
});
