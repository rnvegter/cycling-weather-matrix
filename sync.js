"use strict";

/* ---------------------------------------------------------------
   Syncing the gear list and the ride history.

   Local-first, deliberately. localStorage stays the working copy, so the app
   still answers at 06:40 on bad signal with nothing reachable; the server is a
   sync point rather than the source of truth. Every write lands locally first
   and is pushed afterwards, and a failed push never blocks an answer.

   Where there is no server at all — the files opened directly, or a static
   deployment — none of this runs and the app behaves exactly as it did before.

   The two stores want different merge rules, because they are used differently:

     history   merges ride by ride. Rides accumulate independently on whatever
               device you happen to open, so both sides hold real entries the
               other has never seen. The rules are the ones the import already
               uses: a rated ride beats an unrated one, and between two ratings
               the more recent stands.

               A deletion travels as a tombstone (history.js), because a
               merge of lists cannot see one; and a restore from a backup
               carries a stamp that tells the server to replace rather than
               merge, since putting the old rides back is the point of it.

     gear      is last-write-wins, guarded by a timestamp. You edit it
               deliberately, in one sitting, rarely in two places at once.
               Merging it per garment would mean stamping every item to protect
               against something that does not really happen.
----------------------------------------------------------------*/

/* The shape of the synced document. Raise it when a field changes meaning,
   not when one is added: normalise functions already absorb additions. A
   document with no number is version 1, which is everything written before
   the number existed. The server holds the same constant (server.js), and a
   test keeps the two equal. When it is raised, the migration from the old
   shape goes in mergeIncoming, before anything is read. */
const STATE_SCHEMA = 1;
const docSchema = doc => (Number.isInteger(doc && doc.schema) && doc.schema >= 1 ? doc.schema : 1);
let schemaBlocked = false;    // the server holds a newer shape: read nothing, write nothing

const SYNC_ENDPOINT = new URL("api/state", location.href.replace(/[^/]*$/, "")).toString();
const GEAR_STAMP_KEY = "cwem-gear-updated";
const PUSH_DEBOUNCE = 1200;

let syncAvailable = null;     // null = not yet known, false = no server
let syncBusy = false;         // guards the merge from re-triggering a push
let pushTimer = null;
let pendingPush = false;      // a push failed, or was queued while merging
let lastSyncedAt = null;
let lastError = null;
let lastNotice = null;        // what the last push brought back from another device

const gearStamp = () => { try{ return localStorage.getItem(GEAR_STAMP_KEY) || ""; }catch(e){ return ""; } };
const setGearStamp = v => { try{ localStorage.setItem(GEAR_STAMP_KEY, v); }catch(e){} };

// Favourites follow the gear's rule, so they need the same kind of stamp.
const hasFavourites = typeof loadFavourites === "function" && typeof FAV_STAMP_KEY === "string";
const favStamp = () => {
  if (!hasFavourites) return "";
  try{ return localStorage.getItem(FAV_STAMP_KEY) || ""; }catch(e){ return ""; }
};
const setFavStamp = v => { if (hasFavourites) try{ localStorage.setItem(FAV_STAMP_KEY, v); }catch(e){} };

/* --- Status ------------------------------------------------------ */

function syncStatusText(){
  if (syncAvailable === false) return "Not syncing — no server, so this browser keeps its own copy.";
  if (syncAvailable === null) return "Checking for a sync server…";
  if (schemaBlocked) return `Not syncing: ${lastError}. Changes stay in this browser until then.`;
  if (lastError) return `Sync failed: ${lastError}. It will try again on the next change.`;
  if (pendingPush) return "Saving…";
  const when = (() => {
    if (!lastSyncedAt) return "Synced.";
    const mins = Math.round((Date.now() - lastSyncedAt) / 60000);
    return mins < 1 ? "Synced just now." : `Synced ${mins} minute${mins === 1 ? "" : "s"} ago.`;
  })();
  return lastNotice ? `${when} ${lastNotice}` : when;
}

function paintSyncStatus(){
  const el = document.getElementById("syncstate");
  if (!el) return;
  el.textContent = syncStatusText();
  el.classList.toggle("is-error", !!lastError);
}

/* --- Merge ------------------------------------------------------- */

function mergeIncoming(doc){
  // Written by a newer version of the app. Reading it with this code would
  // misread it, and pushing would write the old shape over the new one.
  if (docSchema(doc) > STATE_SCHEMA){
    schemaBlocked = true;
    lastError = "the server holds data from a newer version of this app; reload the page to update it";
    return;
  }
  syncBusy = true;
  try{
    // History: ride by ride, with the import's rules and their deletions.
    if (Array.isArray(doc.history) || doc.deletedRides){
      const incoming = (Array.isArray(doc.history) ? doc.history : []).map(normaliseRide).filter(Boolean);
      const restored = String(doc.historyReplacedAt || "");
      // A restore made elsewhere replaces rather than merges, once.
      if (restored && restored > historyReplacedAt()) adoptRestoredHistory(incoming, doc.deletedRides || {}, restored);
      else mergeRides(incoming, doc.deletedRides || {});
    }

    /* Gear: newest document wins outright. A missing stamp is older than any
       stamp — and when neither side has one, a browser that only holds the
       seed takes the server's list, because otherwise its first push would
       write the seed over a list someone actually built. */
    if (Array.isArray(doc.gear) && doc.gear.length){
      const theirs = String(doc.gearUpdatedAt || "");
      const mine = gearStamp();
      const seedOnly = !mine && !theirs && !hasStoredGear();
      if ((theirs && theirs > mine) || seedOnly){
        gear = doc.gear.map(normaliseItem);
        saveGear(gear);
        if (theirs) setGearStamp(theirs);
        if (typeof renderGear === "function") renderGear();
      }
    }

    /* Favourites: the newest list wins outright, as the gear does. They are
       edited deliberately and rarely in two places at once, and whole-list
       means a favourite deleted on one device cannot be merged back in by
       another that still has it. An empty list counts — deleting the last one
       is a real change — which is why this does not test for length the way
       the gear does. */
    if (hasFavourites && Array.isArray(doc.favourites)){
      const theirs = String(doc.favouritesUpdatedAt || "");
      if (theirs && theirs > favStamp()){
        try{
          saveFavourites(doc.favourites.map(normaliseFavourite).filter(Boolean));
          setFavStamp(theirs);
        }catch(e){
          // A full browser must not take the rest of sync down with it.
          lastError = e.message;
        }
        if (typeof renderFavourites === "function") renderFavourites();
        if (typeof refreshFavButton === "function") refreshFavButton();
      }
    }
  } finally { syncBusy = false; }
}

function localDocument(){
  return {
    schema: STATE_SCHEMA,
    gear: loadGear(),
    gearUpdatedAt: gearStamp(),
    history: loadHistory(),
    deletedRides: loadTombstones(),
    historyReplacedAt: historyReplacedAt(),
    favourites: hasFavourites ? loadFavourites() : undefined,
    favouritesUpdatedAt: favStamp(),
    updatedAt: new Date().toISOString()
  };
}

/* --- Pull and push ----------------------------------------------- */

async function syncPull(){
  try{
    const r = await fetch(SYNC_ENDPOINT, {method:"GET", cache:"no-store"});
    if (!r.ok) throw new Error(`server said ${r.status}`);
    const doc = await r.json();
    syncAvailable = true;
    lastError = null;
    if (!doc.empty) mergeIncoming(doc);
    if (schemaBlocked){ paintSyncStatus(); return; }
    // Whatever this browser holds that the server has not seen goes up now,
    // which also covers the very first run against an empty server.
    await syncPush(true);
  }catch(e){
    // No endpoint is the normal case for a static deployment, not an error.
    syncAvailable = false;
    lastError = null;
  }
  paintSyncStatus();
  if (typeof renderHistory === "function") renderHistory();
}

async function syncPush(immediate){
  if (syncAvailable === false || schemaBlocked) return;
  if (!immediate){
    pendingPush = true;
    paintSyncStatus();
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncPush(true), PUSH_DEBOUNCE);
    return;
  }
  try{
    const r = await fetch(SYNC_ENDPOINT, {
      method: "PUT",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(localDocument())
    });
    if (r.status === 409){
      // The server refused on the document's version; its reason says which way.
      let why = "";
      try{ why = (await r.json()).error || ""; }catch(e){}
      schemaBlocked = true;
      throw new Error(why || "the server holds a different version of this app's data");
    }
    if (!r.ok) throw new Error(`server said ${r.status}`);
    let res = {};
    try{ res = await r.json(); }catch(e){}
    lastSyncedAt = Date.now();
    pendingPush = false;
    lastError = null;
    syncAvailable = true;
    lastNotice = null;
    /* The server kept a newer list, or merged in rides this page has never
       seen: what it holds is not what was sent. Fetch it now rather than at
       the next load, and say what changed, because a page that just said
       "Synced" while showing yesterday's gear is the thing being fixed. */
    const kept = Array.isArray(res.kept) ? res.kept : [];
    if (kept.length || res.historyChanged){
      const g = await fetch(SYNC_ENDPOINT, {method: "GET", cache: "no-store"});
      if (g.ok) mergeIncoming(await g.json());
      const parts = kept.filter(k => k === "gear" || k === "favourites");
      if (res.historyChanged) parts.push("rides");
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
      lastNotice = `Another device had newer ${list}; this page shows ${parts.length === 1 && parts[0] === "gear" ? "it" : "them"} now.`;
      if (typeof renderHistory === "function") renderHistory();
    }
  }catch(e){
    // Keep the change locally and try again on the next one — never lose it.
    pendingPush = true;
    lastError = String(e.message || e);
  }
  paintSyncStatus();
}

/* --- Hooks -------------------------------------------------------
   Wrapping the two save functions means every existing call site syncs
   without being touched, and nothing can be added later that forgets to. */

const _saveGear = saveGear;
saveGear = function(list){
  _saveGear(list);
  if (!syncBusy){ setGearStamp(new Date().toISOString()); syncPush(false); }
};

const _saveHistory = saveHistory;
saveHistory = function(list){
  _saveHistory(list);
  if (!syncBusy) syncPush(false);
};

if (hasFavourites){
  const _saveFavourites = saveFavourites;
  saveFavourites = function(list){
    _saveFavourites(list);          // throws when storage is full — let it reach the UI
    if (!syncBusy){ setFavStamp(new Date().toISOString()); syncPush(false); }
  };
}

/* A last-gasp attempt on the way out, for a change made seconds before the tab
   closes. Best-effort by design — the change is already safe locally. */
window.addEventListener("pagehide", () => {
  if (!pendingPush || syncAvailable === false) return;
  try{
    navigator.sendBeacon(SYNC_ENDPOINT,
      new Blob([JSON.stringify(localDocument())], {type:"application/json"}));
  }catch(e){}
});

setInterval(paintSyncStatus, 60000);
syncPull();
