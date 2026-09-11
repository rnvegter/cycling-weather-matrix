"use strict";

/* ---------------------------------------------------------------
   Favourite rides.

   A favourite is a route you ride again: the track from a GPX file, plus the
   two things about it the Ride tab would otherwise have to be told every
   time — the surface, and how fast you usually go. Ride now puts all of that
   back on the Ride tab and leaves the date and time to you, because the day
   you ride it is the one thing a favourite cannot know.

   Tracks are stored thinned (see simplifyTrack in gpx.js). This list lives in
   localStorage, which is about 5 MB and shared with the gear list and the
   ride history, and it syncs into a state file capped at 4 MB; a handful of
   raw recordings would fill both. Packed as [lat, lon, ele] a 100 km route
   comes to roughly 60 KB.

   Nothing derived is stored. Distance, climbing and loop-or-not are worked
   out from the points when they are shown, so they can never disagree with
   the track they describe.
----------------------------------------------------------------*/

const FAV_KEY = "cwem-favourites-v1";
const FAV_STAMP_KEY = "cwem-favourites-updated";
const FAV_SPACING_M = 50;
const FAV_MAX_POINTS = 2500;
const FAV_TYPES = ["road", "gravel", "mtb"];

const favId = () => "fav-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const favIso = (v, fallback) =>
  (typeof v === "string" && Number.isFinite(Date.parse(v))) ? v : fallback;

// On disk a point is [lat, lon, ele]: about a third of the size of an object,
// and five decimals is a metre, which is finer than any GPS fix.
const packPoints = pts => pts.map(p => [
  +(+p.lat).toFixed(5), +(+p.lon).toFixed(5),
  p.ele == null || !Number.isFinite(+p.ele) ? null : Math.round(+p.ele)
]);
const unpackPoints = arr => arr.map(a => ({lat: a[0], lon: a[1], ele: a[2], t: null}));

/* Everything that arrives — from storage, from the sync server, from a backup
   being restored — is rebuilt field by field, the same way rides are. */
function normaliseFavourite(f){
  if (!f || typeof f !== "object") return null;
  const points = (Array.isArray(f.points) ? f.points : [])
    .filter(a => Array.isArray(a) && Number.isFinite(+a[0]) && Number.isFinite(+a[1])
              && Math.abs(+a[0]) <= 90 && Math.abs(+a[1]) <= 180)
    .map(a => [+a[0], +a[1], a[2] == null || !Number.isFinite(+a[2]) ? null : +a[2]]);
  if (points.length < 2) return null;
  const speed = Number.isFinite(+f.speed) && +f.speed >= 3 && +f.speed <= 80
    ? Math.round(+f.speed * 10) / 10 : null;
  return {
    id: typeof f.id === "string" && f.id ? f.id.slice(0, 64) : favId(),
    name: (typeof f.name === "string" && f.name.trim() ? f.name.trim() : "Unnamed route").slice(0, 80),
    points,
    type: FAV_TYPES.includes(f.type) ? f.type : "road",
    speed,
    speedFrom: speed == null ? null : (f.speedFrom === "recording" ? "recording" : "typed"),
    fileName: typeof f.fileName === "string" ? f.fileName.slice(0, 120) : null,
    addedAt: favIso(f.addedAt, new Date().toISOString()),
    lastRiddenAt: favIso(f.lastRiddenAt, null)
  };
}

function loadFavourites(){
  try{
    const raw = localStorage.getItem(FAV_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(normaliseFavourite).filter(Boolean) : [];
  }catch(e){ return []; }
}

/* Unlike the other stores this one refuses to fail quietly. A favourite is
   something you just chose to keep; losing it to a full quota without a word
   would be the same silent failure the scheduled backups used to have. */
function saveFavourites(list){
  try{ localStorage.setItem(FAV_KEY, JSON.stringify(list)); }
  catch(e){
    throw new Error("There is no room left in this browser's storage for that. "
      + "Delete a favourite or two, or old rides from History, and try again.");
  }
}

/* Newest use first, then newest added: the route you ride most rises to the top. */
const favouritesInOrder = list => list.slice().sort((a, b) =>
  String(b.lastRiddenAt || "").localeCompare(String(a.lastRiddenAt || ""))
  || String(b.addedAt).localeCompare(String(a.addedAt)));

/* What a favourite looks like as a route: the same shape parseGPX returns, so
   the Ride tab takes it exactly as it takes a file. */
function favouriteAsParsed(fav){
  return {name: fav.name, points: unpackPoints(fav.points), recorded: false};
}

function favouriteStats(fav){
  return routeStats(unpackPoints(fav.points));
}

/* Two copies of the same file should not become two favourites. Start, finish
   and length identify a route well enough.

   The length has to be measured on the same thing both times. A stored
   favourite is thinned, and thinning shortens a track slightly — it cuts the
   corners between kept points — so a raw file measured raw and its favourite
   measured thinned could round differently and never match. A raw track is
   therefore thinned exactly as it would be on saving before it is keyed.
   (A route put on the Ride tab BY a favourite is recognised by its id instead:
   thinning an already-thinned track again is not guaranteed to give the same
   points back.) */
function favouriteKey(points){
  if (!points || points.length < 2) return "";
  const packed = Array.isArray(points[0])
    ? points : packPoints(simplifyTrack(points, FAV_SPACING_M, FAV_MAX_POINTS));
  const first = packed[0], last = packed[packed.length - 1];
  const km = routeStats(unpackPoints(packed)).distance;
  return [first[0], first[1], last[0], last[1]].map(v => (+v).toFixed(4)).join(",")
       + "|" + km.toFixed(1);
}

function findFavouriteLike(points, list){
  const key = favouriteKey(points);
  return (list || loadFavourites()).find(f => favouriteKey(f.points) === key) || null;
}

/* Build a favourite from parseGPX output.

   The speed comes from the full-resolution recording, before thinning: the
   thinned track keeps no timestamps, and a recording is the best evidence
   there is of how fast you actually ride this route. A route file carries no
   times, so its speed is whatever the caller passes — typed on the Ride tab —
   or none, in which case the Ride tab's usual assumption applies. */
function favouriteFromParsed(parsed, opts){
  const o = opts || {};
  let speed = o.speed != null ? o.speed : null;
  let speedFrom = o.speed != null ? "typed" : null;
  if (parsed.recorded){
    const a = activityStats(parsed.points);
    if (a && a.speed > 0){ speed = a.speed; speedFrom = "recording"; }
  }
  return normaliseFavourite({
    name: o.name || parsed.name,
    points: packPoints(simplifyTrack(parsed.points, FAV_SPACING_M, FAV_MAX_POINTS)),
    type: o.type,
    speed, speedFrom,
    fileName: o.fileName || null,
    addedAt: new Date().toISOString()
  });
}

/* Returns {added: true, fav} or {added: false, existing} for a route already
   kept. Throws if storage is full. */
function addFavourite(fav){
  if (!fav) throw new Error("That route could not be read.");
  const list = loadFavourites();
  const existing = findFavouriteLike(fav.points, list);
  if (existing) return {added: false, existing};
  list.push(fav);
  saveFavourites(list);
  return {added: true, fav};
}

function updateFavourite(id, patch){
  const list = loadFavourites();
  const i = list.findIndex(f => f.id === id);
  if (i < 0) return null;
  const next = normaliseFavourite(Object.assign({}, list[i], patch, {id, points: list[i].points}));
  if (!next) return null;
  list[i] = next;
  saveFavourites(list);
  return next;
}

function deleteFavourite(id){
  const list = loadFavourites();
  const next = list.filter(f => f.id !== id);
  if (next.length !== list.length) saveFavourites(next);
  return next;
}

/* Size on disk, so the tab can say how much of the browser's room it takes. */
function favouritesBytes(list){
  try{ return JSON.stringify(list || loadFavourites()).length; }catch(e){ return 0; }
}
