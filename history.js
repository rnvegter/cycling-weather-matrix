"use strict";

/* ---------------------------------------------------------------
   Ride history.

   Every ride the model works out gets kept, because the question the
   calibration needs — how did that actually feel — can only be answered after
   the ride, and the forecast is read before it. Without somewhere to put them,
   rating a ride meant remembering to re-run the identical query afterwards.

   A ride is identified by where and when, not by when you looked it up. Tweak
   the distance or the pace and press the button again and it updates the same
   entry rather than filling the list with near-duplicates of one morning.
----------------------------------------------------------------*/

const HISTORY_KEY = "cwem-history-v1";
const LEGACY_FEEDBACK_KEY = "cwem-feedback-v1";

const rideId = (startISO, place) => `${startISO}|${place || ""}`;

function loadHistory(){
  let list = [];
  try{
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed;
  }catch(e){}

  /* Ratings recorded before there was a history to hold them. They carry a
     verdict and the conditions but no ride, so they come across as entries
     that can still teach the calibration and say plainly where they came
     from. Runs once — the legacy key is cleared after. */
  try{
    const legacyRaw = localStorage.getItem(LEGACY_FEEDBACK_KEY);
    if (legacyRaw){
      const legacy = JSON.parse(legacyRaw);
      if (Array.isArray(legacy) && legacy.length){
        legacy.forEach((e, i) => {
          list.push({
            id: `legacy-${e.at || i}`,
            savedAt: e.at || new Date().toISOString(),
            startISO: (e.at || "").slice(0, 16) || null,
            place: e.place || "Recorded before history existed",
            feel: e.feel ?? null, air: e.air ?? null, wet: !!e.wet,
            rider: e.rider || null, kit: [],
            verdict: e.verdict || null, delta: e.delta ?? null,
            ratedAt: e.at || null, legacy: true
          });
        });
      }
      localStorage.removeItem(LEGACY_FEEDBACK_KEY);
      saveHistory(list);
    }
  }catch(e){}

  return list;
}

function saveHistory(list){
  try{
    // Newest last, and bounded — this is a calibration record, not an archive.
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-300)));
  }catch(e){}
}

/* Record a ride the model has just worked out. Same ride, same entry: any
   rating already given survives a re-run. */
function recordRide(entry){
  const list = loadHistory();
  const id = rideId(entry.startISO, entry.place);
  const at = list.findIndex(e => e.id === id);
  if (at >= 0){
    list[at] = Object.assign({}, list[at], entry, {
      id,
      // A re-run must not silently discard the verdict you already gave.
      verdict: list[at].verdict, delta: list[at].delta, ratedAt: list[at].ratedAt
    });
  } else {
    list.push(Object.assign({id, savedAt: new Date().toISOString()}, entry));
  }
  saveHistory(list);
  return list;
}

function rateRide(id, verdict){
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (!e) return list;
  const v = verdictById(verdict);
  if (!v) return list;
  e.verdict = v.id;
  e.delta = v.delta;
  e.ratedAt = new Date().toISOString();
  saveHistory(list);
  return list;
}

function unrateRide(id){
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (e){ e.verdict = null; e.delta = null; e.ratedAt = null; saveHistory(list); }
  return list;
}

function deleteRide(id){
  const list = loadHistory().filter(e => e.id !== id);
  saveHistory(list);
  return list;
}

function clearHistory(){
  try{ localStorage.removeItem(HISTORY_KEY); }catch(e){}
  return [];
}

/* A ride can only be rated once it has been ridden. Everything upstream of
   that — the whole reason this tab exists — depends on knowing which is which. */
function isRidden(entry, now){
  if (!entry.startISO) return true;                 // legacy, already in the past
  return new Date(entry.startISO).getTime() <= (now || Date.now());
}

/* Newest first for reading; the calibration reads the raw list in order. */
const historyNewestFirst = list =>
  list.slice().sort((a, b) => String(b.startISO || b.savedAt).localeCompare(String(a.startISO || a.savedAt)));

const ratedRides = list => list.filter(e => e.delta != null);
