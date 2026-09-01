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


/* ---------------------------------------------------------------
   Export and import.

   Import MERGES rather than replaces, which is the opposite of the gear list
   and deliberately so. Gear is one inventory you keep in one place; rides
   accumulate wherever you happen to open the app, so bringing a file in from
   the laptop must not discard what the phone has recorded since.

   Where the same ride exists on both sides, the rated one wins — a rating is
   evidence and an empty slot is not. If both are rated, the more recent rating
   is the one that stands.
----------------------------------------------------------------*/

/* Enough shape-checking to reject a file that isn't this, without being
   precious about fields a future version might add. */
function normaliseRide(e){
  if (!e || typeof e !== "object") return null;
  const startISO = typeof e.startISO === "string" ? e.startISO : null;
  const place = typeof e.place === "string" ? e.place : "";
  if (!startISO && !e.id) return null;
  const num = v => (Number.isFinite(+v) ? +v : null);
  const v = e.verdict && verdictById(e.verdict) ? e.verdict : null;
  return {
    id: typeof e.id === "string" && e.id ? e.id : rideId(startISO, place),
    savedAt: typeof e.savedAt === "string" ? e.savedAt : new Date().toISOString(),
    startISO, place,
    dist: num(e.dist), hours: num(e.hours), speed: num(e.speed),
    feel: num(e.feel), extFeel: num(e.extFeel), air: num(e.air),
    wet: !!e.wet, raining: !!e.raining,
    rider: typeof e.rider === "string" ? e.rider : null,
    mode: typeof e.mode === "string" ? e.mode : null,
    routeName: typeof e.routeName === "string" ? e.routeName : null,
    kit: Array.isArray(e.kit) ? e.kit.filter(k => typeof k === "string") : [],
    verdict: v,
    delta: v ? verdictById(v).delta : null,
    ratedAt: typeof e.ratedAt === "string" ? e.ratedAt : null,
    legacy: !!e.legacy
  };
}

function exportHistory(){
  return JSON.stringify(loadHistory(), null, 2);
}

function importHistory(text){
  let parsed;
  try{ parsed = JSON.parse(text); }
  catch(e){ throw new Error("That isn't valid JSON."); }
  if (!Array.isArray(parsed)) throw new Error("Expected a list of rides.");

  const incoming = parsed.map(normaliseRide).filter(Boolean);
  if (!incoming.length) throw new Error("No rides in that file that this recognises.");

  const list = loadHistory();
  const byId = new Map(list.map(e => [e.id, e]));
  let added = 0, updated = 0, unchanged = 0;

  incoming.forEach(inc => {
    const existing = byId.get(inc.id);
    if (!existing){ list.push(inc); byId.set(inc.id, inc); added++; return; }

    const incRated = inc.delta != null, hasRated = existing.delta != null;
    const incWins = incRated && !hasRated
      || (incRated && hasRated && String(inc.ratedAt || "") > String(existing.ratedAt || ""));
    if (incWins){
      Object.assign(existing, inc);
      updated++;
    } else unchanged++;
  });

  saveHistory(list);
  return {added, updated, unchanged, total: list.length};
}
