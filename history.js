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

/* ---------------------------------------------------------------
   Deletions that travel.

   History merges ride by ride, here and on the server, so that two devices
   can both add rides. A merge of lists cannot see a deletion: a ride removed
   here is simply a ride the other side still has, and it would come straight
   back. So a deletion is kept as a tombstone — the ride's id and when it was
   deleted — and carried with the history. A merge drops any ride whose id
   has a tombstone, unless the ride was rated after the deletion, which means
   someone chose to keep it. Planning the same ride again lifts the tombstone.
   Bounded, since ids are small and the list only grows.
----------------------------------------------------------------*/
const HISTORY_TOMBS_KEY = "cwem-history-deleted";
const HISTORY_REPLACED_KEY = "cwem-history-replaced";
const TOMBS_MAX = 500;

function loadTombstones(){
  try{ return normaliseTombstones(JSON.parse(localStorage.getItem(HISTORY_TOMBS_KEY) || "{}")); }
  catch(e){ return {}; }
}
function saveTombstones(t){
  const entries = Object.entries(t).sort((a, b) => a[1].localeCompare(b[1])).slice(-TOMBS_MAX);
  try{ localStorage.setItem(HISTORY_TOMBS_KEY, JSON.stringify(Object.fromEntries(entries))); }catch(e){}
}
/* id → ISO time, field by field, because it arrives from sync and backups. */
function normaliseTombstones(t){
  const out = {};
  if (!t || typeof t !== "object" || Array.isArray(t)) return out;
  for (const [id, at] of Object.entries(t)){
    if (typeof id === "string" && id && typeof at === "string" && at) out[id] = at;
  }
  return out;
}
function tombstone(ids){
  const t = loadTombstones();
  const now = new Date().toISOString();
  ids.forEach(id => { t[id] = now; });
  saveTombstones(t);
}
/* Does the tombstone still apply to this ride? Not if it was rated after. */
const buried = (ride, tombs) => {
  const at = tombs[ride.id];
  return !!at && !(ride.ratedAt && ride.ratedAt > at);
};

/* Which of two copies of the same ride stands. Shared with the server, which
   carries the same rule (rideWins in server.js, cross-checked by a test):
     - a rated copy beats an unrated one;
     - between two ratings the more recent stands; equal, the incoming one;
     - with the same rating, a copy carrying a recorded ride (actual) beats
       one without, so an attached file reaches every device;
     - two unrated copies: the incoming one, so a re-run's new numbers land. */
function rideWins(inc, existing){
  const incRated = inc.delta != null, hasRated = existing.delta != null;
  if (incRated !== hasRated) return incRated;
  if (incRated){
    const a = String(inc.ratedAt || ""), b = String(existing.ratedAt || "");
    if (a !== b) return a > b;
  }
  if (!!inc.actual !== !!existing.actual) return !!inc.actual;
  return true;
}

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
  const tombs = loadTombstones();
  if (tombs[id]){ delete tombs[id]; saveTombstones(tombs); }
  saveHistory(list);
  return list;
}

/* ---------------------------------------------------------------
   Attaching what actually happened.

   Speed is the model's weakest input: it is typed in beforehand, and it drives
   the self-generated wind chill. When a recorded file says you rode 24 and not
   the 27 you assumed, part of the model's error was that guess and not your
   physiology — and without separating the two, the calibration quietly absorbs
   bad speed estimates and calls them "runs cold".

   Speed touches ride-feel through exactly one term, so the size of that error
   is exact rather than estimated: the self-wind term at the real speed minus
   the same term at the assumed one.
----------------------------------------------------------------*/
function speedFeelEffect(entry){
  if (!entry || !entry.actual || entry.air == null || !entry.speed) return 0;
  if (!entry.actual.speed) return 0;
  return +(selfWindTerm(entry.air, entry.actual.speed)
         - selfWindTerm(entry.air, entry.speed)).toFixed(2);
}

/* What the calibration should actually learn from this ride. The verdict is a
   judgement on what was worn, which was chosen from the predicted feel; if the
   corrected model would already have been warmer, the rider correction only has
   to account for what is left. */
function effectiveDelta(entry){
  if (entry.delta == null) return null;
  const eff = speedFeelEffect(entry);
  if (!eff) return entry.delta;
  return +(entry.delta - eff).toFixed(2);
}

function attachActual(id, actual, fileName){
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (!e) return list;
  e.actual = actual;
  e.actualFrom = fileName || null;
  saveHistory(list);
  return list;
}

/* Fields a ride gains from intervals.icu: its id there, and when a rating
   was written back. Not a rating, so ratedAt does not move. */
function setRideFields(id, patch){
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (!e) return list;
  if ("icuId" in patch) e.icuId = patch.icuId;
  if ("icuSentAt" in patch) e.icuSentAt = patch.icuSentAt;
  saveHistory(list);
  return list;
}

function detachActual(id){
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (e){ delete e.actual; delete e.actualFrom; saveHistory(list); }
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

/* Hands and feet, rated apart from the core. The verdict scale is the same;
   what differs is what it teaches: each zone keeps its own correction
   (learnedExtremities in feedback.js), and a glove's range follows the hands
   verdict rather than the body's. ratedAt moves so the newer copy wins a
   merge, which is how the answer reaches other devices. */
const ZONES = ["hands", "feet"];
function rateZone(id, zone, verdict){
  if (!ZONES.includes(zone)) return loadHistory();
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (!e) return list;
  const v = verdict ? verdictById(verdict) : null;
  e.zones = Object.assign({}, e.zones);
  if (v) e.zones[zone] = v.id; else delete e.zones[zone];
  e.ratedAt = new Date().toISOString();
  saveHistory(list);
  return list;
}
/* What a zone's verdict says, with the speed guess's share taken out, as
   effectiveDelta does for the core. null when that zone was not answered. */
function zoneDelta(entry, zone){
  const v = entry && entry.zones && entry.zones[zone] ? verdictById(entry.zones[zone]) : null;
  if (!v) return null;
  const eff = speedFeelEffect(entry);
  return eff ? +(v.delta - eff).toFixed(2) : v.delta;
}

function unrateRide(id){
  const list = loadHistory();
  const e = list.find(x => x.id === id);
  if (e){ e.verdict = null; e.delta = null; e.ratedAt = null; saveHistory(list); }
  return list;
}

function deleteRide(id){
  const list = loadHistory().filter(e => e.id !== id);
  tombstone([id]);
  saveHistory(list);
  return list;
}

function clearHistory(){
  tombstone(loadHistory().map(e => e.id));
  try{ localStorage.removeItem(HISTORY_KEY); }catch(e){}
  saveHistory([]);              // through the hook, so the clearing syncs
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
    // The numbers the gloves and the shoes were actually chosen on, once a
    // learned zone correction is in play; absent on older rides.
    handsFeel: num(e.handsFeel), feetFeel: num(e.feetFeel),
    wet: !!e.wet, raining: !!e.raining,
    rider: typeof e.rider === "string" ? e.rider : null,
    mode: typeof e.mode === "string" ? e.mode : null,
    routeName: typeof e.routeName === "string" ? e.routeName : null,
    kit: Array.isArray(e.kit) ? e.kit.filter(k => typeof k === "string") : [],
    verdict: v,
    delta: v ? verdictById(v).delta : null,
    ratedAt: typeof e.ratedAt === "string" ? e.ratedAt : null,
    zones: (() => {
      const out = {};
      const z = e.zones;
      if (z && typeof z === "object" && !Array.isArray(z))
        ["hands", "feet"].forEach(k => { if (z[k] && verdictById(z[k])) out[k] = z[k]; });
      return out;
    })(),
    legacy: !!e.legacy,
    /* The recorded ride, when one has been attached. This is rebuilt field by
       field rather than passed through, because it arrives from a file or from
       the sync server and everything else here is validated the same way.

       It has to survive: this function runs on import AND on every sync merge,
       so anything it drops is lost the moment history round-trips through the
       server — which would silently undo an attached ride and, with it, the
       speed correction that depends on it. */
    actual: (() => {
      const a = e.actual;
      if (!a || typeof a !== "object") return null;
      const out = {};
      ["distance","speed","elapsedH","movingH","elapsedSpeed"].forEach(k => {
        if (Number.isFinite(+a[k])) out[k] = +a[k];
      });
      ["start","end"].forEach(k => { if (typeof a[k] === "string") out[k] = a[k]; });
      return Number.isFinite(out.speed) ? out : null;
    })(),
    actualFrom: typeof e.actualFrom === "string" ? e.actualFrom : null,
    // Weather looked up after the ride rather than forecast before it.
    reconstructed: !!e.reconstructed,
    // The same ride on intervals.icu, and when its rating was last written
    // back there (intervals.js).
    icuId: typeof e.icuId === "string" && /^i?\d{1,15}$/.test(e.icuId) ? e.icuId : null,
    icuSentAt: typeof e.icuSentAt === "string" ? e.icuSentAt : null
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

  return mergeRides(incoming, {});
}

/* The merge itself: incoming rides (already normalised) and tombstones from
   elsewhere, against what is stored here. Used by import and by sync. */
function mergeRides(incoming, theirTombs){
  const tombs = loadTombstones();
  // Their deletions become ours, newest time per id.
  for (const [id, at] of Object.entries(normaliseTombstones(theirTombs))){
    if (!tombs[id] || at > tombs[id]) tombs[id] = at;
  }
  const list = loadHistory().filter(e => !buried(e, tombs));
  const byId = new Map(list.map(e => [e.id, e]));
  let added = 0, updated = 0, unchanged = 0;

  incoming.forEach(inc => {
    if (buried(inc, tombs)){ unchanged++; return; }
    const existing = byId.get(inc.id);
    if (!existing){ list.push(inc); byId.set(inc.id, inc); added++; return; }
    if (rideWins(inc, existing)){
      Object.assign(existing, inc);
      updated++;
    } else unchanged++;
  });

  saveTombstones(tombs);
  saveHistory(list);
  return {added, updated, unchanged, total: list.length};
}

/* A restore replaces the history outright, and the server must take it as
   such rather than merge the old rides back in. The stamp says when. */
function replaceHistory(list){
  try{ localStorage.removeItem(HISTORY_TOMBS_KEY); }catch(e){}
  try{ localStorage.setItem(HISTORY_REPLACED_KEY, new Date().toISOString()); }catch(e){}
  saveHistory(list);
}
function historyReplacedAt(){
  try{ return localStorage.getItem(HISTORY_REPLACED_KEY) || ""; }catch(e){ return ""; }
}

/* A restore made on another device, arriving by sync. Merging would put the
   rides it undid straight back, so its list is taken as it is, with its
   deletions and its stamp (not a new one: it is the same restore, not
   another). A ride saved here after that restore is the only thing kept
   from this side, because the restore cannot have meant to undo it. */
function adoptRestoredHistory(incoming, tombs, stamp){
  const after = loadHistory().filter(e => e.savedAt && e.savedAt > stamp && !incoming.some(i => i.id === e.id));
  try{ localStorage.setItem(HISTORY_TOMBS_KEY, JSON.stringify(normaliseTombstones(tombs))); }catch(e){}
  try{ localStorage.setItem(HISTORY_REPLACED_KEY, stamp); }catch(e){}
  saveHistory(incoming.concat(after));
}
