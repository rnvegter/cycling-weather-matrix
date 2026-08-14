"use strict";

/* ---------------------------------------------------------------
   Route files.

   A single forecast for a start point answers "what is it like there, then".
   A route answers the question actually being asked: is the kit right for the
   whole ride. Three things change along a route and none of them are visible
   from the start point —

     where you are   a coastal leg and an inland one are different weather
     how high        about 0.65°C per 100 m, and a col is a different garment
     which way       wind only chills you by the part of it you ride into

   So the route is cut into segments, each gets its own position, elevation,
   clock time and heading, and the kit is checked against every one.
----------------------------------------------------------------*/

const EARTH_R = 6371;   // km

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

function haversine(a, b){
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat/2)**2
          + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon/2)**2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

/* Initial bearing from a to b, degrees clockwise from north. */
function bearing(a, b){
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
          - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/* Bearings are angles: average them on the unit circle or 350° and 10° come
   out as due south. */
function meanBearing(list){
  let sx = 0, sy = 0;
  list.forEach(d => { const r = toRad(d); sx += Math.cos(r); sy += Math.sin(r); });
  return (toDeg(Math.atan2(sy, sx)) + 360) % 360;
}

/* --- Parsing ---------------------------------------------------- */

function parseGPX(text){
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("That file isn't valid XML.");

  // Track points are the usual case; route points cover exported plans.
  let nodes = [...doc.getElementsByTagName("trkpt")];
  if (!nodes.length) nodes = [...doc.getElementsByTagName("rtept")];
  if (!nodes.length) throw new Error("No track or route points in that file — is it a GPX?");

  const pts = nodes.map(n => {
    const ele = n.getElementsByTagName("ele")[0];
    return {
      lat: +n.getAttribute("lat"),
      lon: +n.getAttribute("lon"),
      ele: ele ? +ele.textContent : null
    };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length < 2) throw new Error("That route has fewer than two points.");

  const nameEl = doc.querySelector("trk > name, rte > name, metadata > name");
  return {name: nameEl ? nameEl.textContent.trim() : "", points: pts};
}

/* --- Shape ------------------------------------------------------ */

function routeStats(points){
  let dist = 0, ascent = 0, descent = 0;
  let minEle = Infinity, maxEle = -Infinity;
  const cum = [0];
  for (let i = 1; i < points.length; i++){
    dist += haversine(points[i-1], points[i]);
    cum.push(dist);
    const a = points[i-1].ele, b = points[i].ele;
    if (a != null && b != null){
      const d = b - a;
      // A metre of noise per point adds up to a fictional mountain over
      // thousands of points, so only count moves that are actually climbs.
      if (d > 1) ascent += d; else if (d < -1) descent += -d;
    }
    if (points[i].ele != null){
      minEle = Math.min(minEle, points[i].ele);
      maxEle = Math.max(maxEle, points[i].ele);
    }
  }
  const hasEle = Number.isFinite(minEle);
  return {
    distance: dist, cum, ascent, descent,
    minEle: hasEle ? minEle : null, maxEle: hasEle ? maxEle : null,
    hasElevation: hasEle,
    loop: haversine(points[0], points[points.length-1]) < Math.max(1, dist * 0.03)
  };
}

/* Cut the route into legs of roughly equal distance. Each carries the position
   to ask the forecast about, the height to correct it to, and the heading that
   decides how much of the wind is in your face. */
function sampleRoute(points, stats, opts){
  const total = stats.distance;
  // Resolution has to follow the climbing, not just the distance. An 11 km
  // mountain route cut by distance alone smooths a 1,850 m col down to its
  // leg average and hides the thing you loaded the route to find.
  const byDistance = total / 10;
  const byClimb = (stats.ascent || 0) / 150;
  const n = Math.round(clamp(Math.max(byDistance, byClimb, 4), 4, 12));
  const legs = [];

  for (let k = 0; k < n; k++){
    const from = total * k / n, to = total * (k + 1) / n;
    const idx = [];
    for (let i = 0; i < points.length; i++) if (stats.cum[i] >= from && stats.cum[i] <= to) idx.push(i);
    if (idx.length < 2){
      // A very coarse file can leave a leg with too few points to work with.
      const mid = stats.cum.findIndex(c => c >= (from + to) / 2);
      idx.length = 0;
      idx.push(Math.max(0, mid - 1), Math.max(1, mid));
    }
    const seg = idx.map(i => points[i]);
    const mid = seg[Math.floor(seg.length / 2)];

    const bearings = [];
    for (let i = 1; i < seg.length; i++){
      if (haversine(seg[i-1], seg[i]) > 0.02) bearings.push(bearing(seg[i-1], seg[i]));
    }
    // Gradient from the leg's own endpoints, found by distance along the route.
    // Taking it from whichever points happened to fall inside the leg made the
    // gradient jitter between legs, which flipped the climbing/descending flag
    // and put a sawtooth through an otherwise steady climb.
    const at = km => {
      let i = stats.cum.findIndex(c => c >= km);
      if (i < 0) i = points.length - 1;
      return points[i];
    };
    const eStart = at(from).ele, eEnd = at(to).ele;
    const eles = seg.map(p => p.ele).filter(e => e != null);
    const climb = (eStart != null && eEnd != null) ? eEnd - eStart : 0;

    legs.push({
      index: k, fromKm: from, toKm: to,
      lat: mid.lat, lon: mid.lon,
      ele: eles.length ? eles.reduce((a,b)=>a+b,0) / eles.length : null,
      climb,
      heading: bearings.length ? meanBearing(bearings) : null,
      gradient: (to - from) > 0 ? climb / ((to - from) * 1000) : 0
    });
  }
  return legs;
}

/* Climbing is slower and descending is faster, so a col is reached later in the
   day than flat maths suggests — which is the whole point of asking when. */
function legTiming(legs, startDT, avgSpeed){
  let t = startDT.getTime();
  legs.forEach(leg => {
    const km = leg.toKm - leg.fromKm;
    // Roughly: every 1% of gradient costs about 8% of speed, floored so a wall
    // doesn't produce an infinite ride.
    const factor = clamp(1 - leg.gradient * 100 * 0.08, 0.35, 1.35);
    const hours = km / (avgSpeed * factor);
    leg.startTime = new Date(t);
    t += hours * 3600 * 1000;
    leg.endTime = new Date(t);
    leg.speed = avgSpeed * factor;
    leg.hours = hours;
  });
  return legs;
}

/* --- Wind against a heading -------------------------------------
   Meteorological direction is where the wind comes FROM, so a wind from the
   same bearing you are travelling on is a pure headwind. Only that component
   chills; a tailwind takes airflow away. */
function headwindComponent(windKmh, windFromDeg, headingDeg){
  if (headingDeg == null) return windKmh * 0.4;      // unknown heading: assume a loop
  return windKmh * Math.cos(toRad(windFromDeg - headingDeg));
}

const windLabel = comp =>
  comp > 6 ? "headwind" : comp < -6 ? "tailwind" : "crosswind";

/* Air cools with height at about 0.65°C per 100 m. Forecast models run on a
   smoothed terrain, so correct from the model's own elevation to the route's
   rather than from sea level. */
function lapseAdjust(temp, routeEle, modelEle){
  if (routeEle == null || modelEle == null) return temp;
  return temp - (routeEle - modelEle) * 0.0065;
}
