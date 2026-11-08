"use strict";

/* Installable, and opens offline: registers sw.js (see the comment there).
   Browsers only allow a service worker on HTTPS, or on this machine. Where
   it cannot be registered, the app works exactly as before, online. */
if ("serviceWorker" in navigator
    && (location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
