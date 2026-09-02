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

     gear      is last-write-wins, guarded by a timestamp. You edit it
               deliberately, in one sitting, rarely in two places at once.
               Merging it per garment would mean stamping every item to protect
               against something that does not really happen.
----------------------------------------------------------------*/

const SYNC_ENDPOINT = new URL("api/state", location.href.replace(/[^/]*$/, "")).toString();
const GEAR_STAMP_KEY = "cwem-gear-updated";
const PUSH_DEBOUNCE = 1200;

let syncAvailable = null;     // null = not yet known, false = no server
let syncBusy = false;         // guards the merge from re-triggering a push
let pushTimer = null;
let pendingPush = false;      // a push failed, or was queued while merging
let lastSyncedAt = null;
let lastError = null;

const gearStamp = () => { try{ return localStorage.getItem(GEAR_STAMP_KEY) || ""; }catch(e){ return ""; } };
const setGearStamp = v => { try{ localStorage.setItem(GEAR_STAMP_KEY, v); }catch(e){} };

/* --- Status ------------------------------------------------------ */

function syncStatusText(){
  if (syncAvailable === false) return "Not syncing — no server, so this browser keeps its own copy.";
  if (syncAvailable === null) return "Checking for a sync server…";
  if (lastError) return `Sync failed: ${lastError}. It will try again on the next change.`;
  if (pendingPush) return "Saving…";
  if (!lastSyncedAt) return "Synced.";
  const mins = Math.round((Date.now() - lastSyncedAt) / 60000);
  return mins < 1 ? "Synced just now" : `Synced ${mins} minute${mins === 1 ? "" : "s"} ago`;
}

function paintSyncStatus(){
  const el = document.getElementById("syncstate");
  if (!el) return;
  el.textContent = syncStatusText();
  el.classList.toggle("is-error", !!lastError);
}

/* --- Merge ------------------------------------------------------- */

function mergeIncoming(doc){
  syncBusy = true;
  try{
    // History: ride by ride, reusing the import's rules.
    if (Array.isArray(doc.history) && doc.history.length){
      importHistory(JSON.stringify(doc.history));
    }

    // Gear: newest document wins outright.
    if (Array.isArray(doc.gear) && doc.gear.length){
      const theirs = String(doc.gearUpdatedAt || "");
      const mine = gearStamp();
      if (theirs && theirs > mine){
        gear = doc.gear.map(normaliseItem);
        saveGear(gear);
        setGearStamp(theirs);
        if (typeof renderGear === "function") renderGear();
      }
    }
  } finally { syncBusy = false; }
}

function localDocument(){
  return {
    gear: loadGear(),
    gearUpdatedAt: gearStamp(),
    history: loadHistory(),
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
  if (syncAvailable === false) return;
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
    if (!r.ok) throw new Error(`server said ${r.status}`);
    lastSyncedAt = Date.now();
    pendingPush = false;
    lastError = null;
    syncAvailable = true;
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
