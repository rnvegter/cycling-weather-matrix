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
    // A planned route has no timestamps; a recorded activity does, and that is
    // the whole difference between "where I meant to go" and "what I did".
    const t = n.getElementsByTagName("time")[0];
    const when = t ? Date.parse(t.textContent) : NaN;
    return {
      lat: +n.getAttribute("lat"),
      lon: +n.getAttribute("lon"),
      ele: ele ? +ele.textContent : null,
      t: Number.isFinite(when) ? when : null
    };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length < 2) throw new Error("That route has fewer than two points.");

  const nameEl = doc.querySelector("trk > name, rte > name, metadata > name");
  const timed = pts.filter(p => p.t != null).length;
  return {
    name: nameEl ? nameEl.textContent.trim() : "",
    points: pts,
    // A file is a recording rather than a plan when most of its points are
    // stamped. Strava's activity export is; its route export is not.
    recorded: timed >= Math.max(2, pts.length * 0.5)
  };
}

/* --- Shape ------------------------------------------------------ */

/* Thin a track to roughly one point per `spacing` metres, and never more than
   `max` points in all.

   A recorded ride is stamped every second, so four hours is some 14,000
   points — the best part of a megabyte to keep. Nothing downstream needs that:
   the route check cuts a ride into legs of several kilometres. What it does
   need is the summit, and thinning by distance alone would shave it off
   whenever the highest point fell between two kept ones, understating exactly
   the climb the route was loaded to find. So the highest and lowest points are
   always kept, along with the start and the finish. */
function simplifyTrack(points, spacing = 50, max = 2500){
  if (!Array.isArray(points)) return [];
  const n = points.length;
  if (n <= 2) return points.slice();

  let hi = -1, lo = -1;
  for (let i = 0; i < n; i++){
    const e = points[i].ele;
    if (e == null) continue;
    if (hi < 0 || e > points[hi].ele) hi = i;
    if (lo < 0 || e < points[lo].ele) lo = i;
  }

  const pass = gap => {
    const keep = [0];
    let since = 0;                                  // metres since the last kept point
    for (let i = 1; i < n - 1; i++){
      since += haversine(points[i - 1], points[i]) * 1000;
      if (since >= gap || i === hi || i === lo){ keep.push(i); since = 0; }
    }
    keep.push(n - 1);
    return keep;
  };

  // A very long ride at 50 m spacing can still exceed the cap; widen until it fits.
  let gap = spacing, keep = pass(gap);
  while (keep.length > max && gap < 20000){ gap *= 1.5; keep = pass(gap); }
  return keep.map(i => points[i]);
}

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


/* ---------------------------------------------------------------
   What a recorded activity actually did.

   Elapsed time is the clock; moving time ignores the stops, and the two differ
   by however long you stood at the lights or in the café. The model wants the
   moving average, because that is the speed the airflow was made at — a coffee
   stop does not chill you at 25 km/h.
----------------------------------------------------------------*/
const MOVING_MIN_KMH = 1.5;    // slower than this is a stop, not riding
const GPS_SPIKE_KMH = 120;     // a jump this fast is the receiver, not you

function activityStats(points){
  const timed = points.filter(p => p.t != null);
  if (timed.length < 2) return null;

  let distance = 0, movingSeconds = 0, movingDistance = 0;
  for (let i = 1; i < timed.length; i++){
    const d = haversine(timed[i-1], timed[i]);
    const secs = (timed[i].t - timed[i-1].t) / 1000;
    if (secs <= 0) continue;
    const kmh = d / (secs / 3600);
    if (kmh > GPS_SPIKE_KMH) continue;
    distance += d;
    if (kmh >= MOVING_MIN_KMH){ movingSeconds += secs; movingDistance += d; }
  }

  const start = timed[0].t, end = timed[timed.length - 1].t;
  const elapsedH = (end - start) / 3600000;
  const movingH = movingSeconds / 3600;
  if (!(distance > 0.2) || !(elapsedH > 0)) return null;

  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    distance: +distance.toFixed(2),
    elapsedH: +elapsedH.toFixed(3),
    movingH: +movingH.toFixed(3),
    // The moving average is the one the model wants.
    speed: movingH > 0 ? +(movingDistance / movingH).toFixed(1)
                       : +(distance / elapsedH).toFixed(1),
    elapsedSpeed: +(distance / elapsedH).toFixed(1)
  };
}

/* h:mm, because 2.783 hours means nothing to anyone. */
function hoursToClock(h){
  if (h == null) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}`;
}
