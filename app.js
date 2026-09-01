"use strict";

const $ = s => document.querySelector(s);

const state = {
  place:null, type:"road", pace:"steady", terrain:"flat", rider:"hot", mode:"wardrobe"
};
let gear = loadGear();

/* ---------------------------------------------------------------
   Preferences
----------------------------------------------------------------*/
function save(){
  try{
    localStorage.setItem("cwem", JSON.stringify({
      place:state.place, type:state.type, pace:state.pace,
      terrain:state.terrain, rider:state.rider, mode:state.mode
    }));
  }catch(e){}
}
function load(){
  try{ Object.assign(state, JSON.parse(localStorage.getItem("cwem") || "{}")); }catch(e){}
  if (state.place) showPlace(state.place);
  syncPills();
}
function syncPills(){
  document.querySelectorAll(".wx-choice").forEach(row => {
    const g = row.dataset.group;
    row.querySelectorAll(".wx-chip").forEach(p =>
      p.setAttribute("aria-pressed", p.dataset.v === state[g] ? "true" : "false"));
  });
}
document.querySelectorAll(".wx-choice").forEach(row => {
  row.addEventListener("click", e => {
    const b = e.target.closest(".wx-chip");
    if (!b) return;
    row.querySelectorAll(".wx-chip").forEach(p => p.setAttribute("aria-pressed", p === b ? "true" : "false"));
    state[row.dataset.group] = b.dataset.v;
    save();
    if (["type","pace"].includes(row.dataset.group)) updateSpeedHint();
  });
});

/* Default: next hour */
(function initWhen(){
  const d = new Date(Date.now() + 3600*1000);
  $("#date").value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  $("#time").value = `${String(d.getHours()).padStart(2,"0")}:00`;
})();

/* Distance, time and speed: any two give the third. Speed is the one you can
   state from experience when you don't know how long a route will take, which
   is the usual case for a route you haven't ridden. */
function rideNumbers(){
  const dist = parseFloat($("#dist").value);
  const hours = parseFloat($("#dur").value);
  const typed = parseFloat($("#speed").value);
  const assumed = BASE_SPEED[state.type] * PACE_SPEED[state.pace];

  const has = v => v > 0;
  let d = has(dist) ? dist : null, h = has(hours) ? hours : null, sp = has(typed) ? typed : null;
  let source;

  if (d && h){ sp = d / h; source = "measured"; }          // both facts: speed follows
  else if (d && sp){ h = d / sp; source = "typed"; }
  else if (h && sp){ d = h * sp; source = "typed"; }
  else if (d){ sp = assumed; h = d / sp; source = "assumed"; }
  else if (h){ sp = assumed; d = h * sp; source = "assumed"; }
  else { sp = sp || assumed; h = 2; d = h * sp; source = sp === assumed ? "assumed" : "typed"; }

  return {dist: d, hours: h, speed: sp, assumed, source};
}

function updateSpeedHint(){
  const n = rideNumbers(), el = $("#speedhint");
  const both = parseFloat($("#dist").value) > 0 && parseFloat($("#dur").value) > 0;
  if (both && parseFloat($("#speed").value) > 0){
    el.textContent = `Distance and time are both set, so speed comes from them: ${r1(n.speed)} km/h. Clear one of them to use the speed you typed.`;
  } else if (n.source === "measured"){
    el.textContent = `${r1(n.speed)} km/h average — that sets both the self-generated wind chill and the work rate.`;
  } else if (n.source === "typed"){
    el.textContent = `At ${r1(n.speed)} km/h that's ${r1(n.dist)} km in ${r1(n.hours)} h.`;
  } else {
    el.textContent = `Assuming ${r1(n.assumed)} km/h for ${state.type} at ${state.pace} pace — ${r1(n.dist)} km in ${r1(n.hours)} h. Type a speed if you know yours.`;
  }
}
$("#dist").addEventListener("input", updateSpeedHint);
$("#dur").addEventListener("input", updateSpeedHint);
$("#speed").addEventListener("input", updateSpeedHint);

/* ---------------------------------------------------------------
   Location
----------------------------------------------------------------*/
async function geocode(q){
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  if (!r.ok) throw new Error("Location lookup failed");
  return (await r.json()).results || [];
}
const placeLabel = p => [p.name, p.admin1, p.country].filter(Boolean).join(", ");
function showPlace(p){
  $("#picked").textContent = `${placeLabel(p)} · ${r1(p.latitude)}, ${r1(p.longitude)}`;
  $("#loc").value = p.name || "";
}
async function doSearch(){
  const q = $("#loc").value.trim();
  if (!q) return;
  const box = $("#geo");
  box.innerHTML = "<button disabled>Searching…</button>";
  box.classList.remove("wx-hidden");
  try{
    const res = await geocode(q);
    if (!res.length){ box.innerHTML = "<button disabled>No match</button>"; return; }
    box.innerHTML = "";
    res.forEach(p => {
      const b = document.createElement("button");
      b.textContent = placeLabel(p);
      b.onclick = () => { state.place = p; showPlace(p); box.classList.add("wx-hidden"); save(); };
      box.appendChild(b);
    });
  }catch(e){ box.innerHTML = `<button disabled>${e.message}</button>`; }
}
$("#search").onclick = doSearch;
$("#loc").addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); doSearch(); }});
$("#here").onclick = () => {
  if (!navigator.geolocation) return status("This browser has no geolocation.", true);
  status("Finding you…");
  navigator.geolocation.getCurrentPosition(pos => {
    state.place = {name:"Current position", latitude:pos.coords.latitude, longitude:pos.coords.longitude};
    showPlace(state.place); save(); status("");
  }, () => status("Couldn't get your position — search for a place instead.", true));
};
function status(msg, isErr){
  const el = $("#status");
  if (!msg){ el.className = "wx-hidden"; el.textContent = ""; return; }
  el.className = "wx-status" + (isErr ? " wx-status--err" : "");
  el.textContent = msg;
}

/* ---------------------------------------------------------------
   Route file
----------------------------------------------------------------*/
let route = null;

$("#gpx").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const parsed = parseGPX(fr.result);
      const stats = routeStats(parsed.points);
      if (!(stats.distance > 0.5)) throw new Error("That route is shorter than half a kilometre.");
      route = {name: parsed.name, points: parsed.points, stats};

      // The route knows the distance better than the form does.
      $("#dist").value = Math.round(stats.distance);
      updateSpeedHint();
      // A route file usually carries its own start point.
      if (!state.place) state.place = {name: parsed.name || "Route start",
        latitude: parsed.points[0].lat, longitude: parsed.points[0].lon};
      showPlace(state.place);

      $("#gpxnote").innerHTML =
        `<b>${route.name ? escapeText(route.name) + " — " : ""}${r1(stats.distance)} km</b>`
        + (stats.hasElevation ? `, ${Math.round(stats.ascent)} m up` : ", no elevation data")
        + (stats.loop ? ", a loop" : ", point to point")
        + `. ${route.points.length} points.`;
      $("#gpxclear").classList.remove("wx-hidden");
      status("");
    }catch(err){
      route = null;
      status(err.message, true);
    }
  };
  fr.readAsText(file);
  e.target.value = "";
};
$("#gpxclear").onclick = () => {
  route = null;
  $("#gpxclear").classList.add("wx-hidden");
  $("#gpxnote").textContent =
    "Optional. A GPX checks the kit against the whole ride — where you'll be, how high, and which way you're pointing — rather than only the start.";
};
const escapeText = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");

/* ---------------------------------------------------------------
   Forecast
----------------------------------------------------------------*/
async function forecast(lat, lon){
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lat}&longitude=${lon}`
    + "&hourly=temperature_2m,precipitation_probability,precipitation,cloud_cover,"
    + "wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,weather_code,apparent_temperature"
    + "&daily=sunrise,sunset&timezone=auto&forecast_days=16&past_days=2";
  const r = await fetch(url);
  if (!r.ok) throw new Error("Forecast request failed");
  return r.json();
}

function rideWindow(fc, dateStr, timeStr, hours){
  const times = fc.hourly.time;
  const i = times.indexOf(`${dateStr}T${timeStr.slice(0,2)}:00`);
  if (i < 0) throw new Error("That start time is outside the 16-day forecast window.");
  const last = Math.min(times.length - 1, i + Math.max(0, Math.ceil(hours) - 1));
  const idx = []; for (let k = i; k <= last; k++) idx.push(k);
  const g = key => idx.map(k => fc.hourly[key][k]).filter(v => v != null);

  const temps=g("temperature_2m"), winds=g("wind_speed_10m"), gusts=g("wind_gusts_10m"),
        precip=g("precipitation"), probs=g("precipitation_probability"),
        cloud=g("cloud_cover"), day=g("is_day"), dirs=g("wind_direction_10m"),
        codes=g("weather_code");

  // Directions are angles, so they average on the unit circle — a naive mean of
  // 350° and 10° gives 180°, which is the exact opposite of the truth.
  const meanDir = list => {
    let sx=0, sy=0;
    list.forEach(d => { const rad=d*Math.PI/180; sx+=Math.cos(rad); sy+=Math.sin(rad); });
    return ((Math.atan2(sy,sx)*180/Math.PI)+360)%360;
  };
  const dirMean = meanDir(dirs);
  // The return leg is ridden in the later wind, and that is the leg that hurts.
  const dirLate = meanDir(dirs.slice(Math.floor(dirs.length/2)));

  const dayIdx = fc.daily.time.indexOf(dateStr);
  const sunrise = dayIdx>=0 ? fc.daily.sunrise[dayIdx] : null;
  const sunset  = dayIdx>=0 ? fc.daily.sunset[dayIdx]  : null;

  const startDT = new Date(`${dateStr}T${timeStr}`);
  const endDT = new Date(startDT.getTime() + hours*3600*1000);
  // Darkness from actual sunrise/sunset, so a 06:30 start after a 06:21
  // sunrise doesn't read as a night ride.
  let darkFrac = day.filter(d => d === 0).length / day.length;
  if (sunrise && sunset){
    const lit = Math.max(0, Math.min(endDT, new Date(sunset)) - Math.max(startDT, new Date(sunrise)));
    darkFrac = clamp(1 - lit/(endDT - startDT), 0, 1);
  }

  return {
    startDT, endDT, times: idx.map(k => times[k]),
    tStart:temps[0], tEnd:temps[temps.length-1], tMin:Math.min(...temps), tMax:Math.max(...temps),
    wind: winds.reduce((a,b)=>a+b,0)/winds.length, gust: Math.max(...gusts), dir: dirMean,
    precipTotal: precip.reduce((a,b)=>a+b,0), precipPeak: Math.max(...precip),
    prob: Math.max(...probs), cloud: cloud.reduce((a,b)=>a+b,0)/cloud.length,
    dark: darkFrac, wetHours: precip.filter(p => p >= 0.1).length, hoursCount: idx.length,
    sunrise, sunset, dirLate,
    hourly: idx.map((k,n) => ({
      time:times[k], t:temps[n], wind:winds[n], precip:precip[n], prob:probs[n],
      dir:dirs[n], gust:gusts[n], code:codes[n], day:day[n], cloud:cloud[n]
    })),
    // What is coming: the ride hours plus a few beyond, so a shower arriving
    // just after the planned finish is visible rather than a surprise.
    outlook: (() => {
      const out = [];
      for (let k = i; k <= Math.min(times.length - 1, last + 3); k++){
        const h = fc.hourly;
        out.push({
          time: times[k], t: h.temperature_2m[k], wind: h.wind_speed_10m[k],
          gust: h.wind_gusts_10m[k], dir: h.wind_direction_10m[k],
          precip: h.precipitation[k], prob: h.precipitation_probability[k],
          code: h.weather_code[k], day: h.is_day[k], riding: k <= last
        });
      }
      return out;
    })()
  };
}

/* ---------------------------------------------------------------
   Do the models agree?

   Open-Meteo's default already picks the highest-resolution model available
   for a location — over the Netherlands that is KNMI HARMONIE at 2.5 km, and
   it is what the forecast above is built from. What a single model cannot tell
   you is how much to trust it.

   So ask the global models the same question and see whether they say the same
   thing. Flipping between ECMWF, GFS and ICON to see if they agree is what
   people actually use a Windy subscription for; it is one extra request here,
   and it turns "the wind is from the NW" into "the wind is from the NW, and
   everyone agrees" or "...but nobody agrees, so don't plan the route on it".
----------------------------------------------------------------*/
const SPREAD_MODELS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"];

async function modelSpread(lat, lon, dateStr, hourKey){
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lat}&longitude=${lon}`
    + "&hourly=wind_speed_10m,wind_direction_10m,temperature_2m"
    + `&models=${SPREAD_MODELS.join(",")}`
    + `&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("model comparison unavailable");
  const h = (await r.json()).hourly;
  const i = h.time.indexOf(hourKey);
  if (i < 0) throw new Error("hour outside the comparison window");

  const dirs = [], speeds = [], temps = [], named = [];
  SPREAD_MODELS.forEach(m => {
    const d = h[`wind_direction_10m_${m}`]?.[i];
    const sp = h[`wind_speed_10m_${m}`]?.[i];
    const t = h[`temperature_2m_${m}`]?.[i];
    if (d == null || sp == null) return;
    dirs.push(d); speeds.push(sp); if (t != null) temps.push(t);
    named.push({model: m.split("_")[0].toUpperCase(), dir: d, speed: sp, temp: t});
  });
  if (named.length < 2) throw new Error("not enough models answered");

  // Widest disagreement between any two, which is the honest measure — an
  // average would hide one model sitting 40° off on its own.
  let dirSpread = 0;
  for (let a = 0; a < dirs.length; a++)
    for (let b = a + 1; b < dirs.length; b++)
      dirSpread = Math.max(dirSpread, angleGap(dirs[a], dirs[b]));

  return {
    models: named,
    dirSpread,
    speedSpread: Math.max(...speeds) - Math.min(...speeds),
    tempSpread: temps.length ? Math.max(...temps) - Math.min(...temps) : null
  };
}

/* ---------------------------------------------------------------
   Route analysis

   One forecast call covers every leg: Open-Meteo takes comma-separated
   coordinates and answers with one block per location.
----------------------------------------------------------------*/
async function forecastMany(legs){
  const lats = legs.map(l => l.lat.toFixed(4)).join(",");
  const lons = legs.map(l => l.lon.toFixed(4)).join(",");
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lats}&longitude=${lons}`
    + "&hourly=temperature_2m,precipitation_probability,precipitation,cloud_cover,"
    + "wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,weather_code"
    + "&daily=sunrise,sunset&timezone=auto&forecast_days=16&past_days=2";
  const r = await fetch(url);
  if (!r.ok) throw new Error("Route forecast request failed");
  const j = await r.json();
  return Array.isArray(j) ? j : [j];      // one location comes back unwrapped
}

/* Build the weather for a single leg: the forecast at its position, at its
   clock time, corrected for its height, with only the headwind counted. */
function legWeather(fc, leg, opts){
  const t = leg.startTime;
  const key = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`
            + `T${String(t.getHours()).padStart(2,"0")}:00`;
  const h = fc.hourly;
  let i = h.time.indexOf(key);
  if (i < 0) i = 0;
  const j = Math.min(h.time.length - 1, i + Math.max(0, Math.ceil(leg.hours) - 1));

  const airRaw = h.temperature_2m[i];
  const air = lapseAdjust(airRaw, leg.ele, fc.elevation);
  const airEnd = lapseAdjust(h.temperature_2m[j], leg.ele, fc.elevation);
  const wind = h.wind_speed_10m[i], dir = h.wind_direction_10m[i];
  const comp = headwindComponent(wind, dir, leg.heading);

  const dayIdx = fc.daily.time.indexOf(key.slice(0,10));
  const sunrise = dayIdx >= 0 ? fc.daily.sunrise[dayIdx] : null;
  const sunset  = dayIdx >= 0 ? fc.daily.sunset[dayIdx]  : null;
  let dark = h.is_day[i] === 0 ? 1 : 0;
  if (sunrise && sunset){
    const lit = Math.max(0, Math.min(leg.endTime, new Date(sunset)) - Math.max(leg.startTime, new Date(sunrise)));
    dark = clamp(1 - lit / Math.max(1, leg.endTime - leg.startTime), 0, 1);
  }

  return {
    startDT: leg.startTime, endDT: leg.endTime,
    times: [h.time[i]],
    tStart: air, tEnd: airEnd, tMin: Math.min(air, airEnd), tMax: Math.max(air, airEnd),
    // Only the part of the wind you ride into does the chilling.
    wind: Math.max(0, comp), gust: h.wind_gusts_10m[i], dir,
    headwind: comp, ambient: wind,
    precipTotal: h.precipitation[i] || 0, precipPeak: h.precipitation[i] || 0,
    prob: h.precipitation_probability[i] || 0, cloud: h.cloud_cover[i] || 0,
    dark, wetHours: (h.precipitation[i] || 0) >= 0.1 ? 1 : 0, hoursCount: 1,
    sunrise, sunset, dirLate: dir, code: h.weather_code[i], day: h.is_day[i],
    hourly: [{time:h.time[i], t:air, wind, precip:h.precipitation[i]||0,
              prob:h.precipitation_probability[i]||0, dir, gust:h.wind_gusts_10m[i],
              code:h.weather_code[i], day:h.is_day[i]}],
    outlook: []
  };
}

/* ---------------------------------------------------------------
   What to carry when one outfit won't cover the whole route.

   The distinction that matters is what you can actually change at the
   roadside. Arm warmers, a gilet, gloves and overshoes go on and come off in a
   layby. A base layer, a jersey and bib tights do not — changing those means
   stripping, so they have to be right from the start or not at all.
----------------------------------------------------------------*/
const POCKETABLE_SLOTS = new Set(["arms","hands","head","feet","legextra","eyes","vest"]);
const canCarry = it => !!it.pack || POCKETABLE_SLOTS.has(it.slot);

function packingPlan(analysis, opts){
  const {legs, coldest, warmest} = analysis;
  const km = n => `${Math.round(n)} km`;
  const bySlotWarmest = items => {
    const m = new Map();
    items.forEach(it => { const c = m.get(it.slot); if (!c || it.clo > c.clo) m.set(it.slot, it); });
    return [...m.values()];
  };

  /* You can add a layer at the roadside; you cannot take off a jersey. So the
     things you can't change are chosen for the WARMEST leg — anything warmer
     would cook you on the climb with no way out — and the cold end is covered
     by what you carry. */
  const wear = warmest.out.wear.filter(i => !canCarry(i));

  /* Carry one item per slot: the warmest anything asks for. Carrying both knee
     warmers and leg warmers is just carrying knee warmers you won't use. */
  const carryCandidates = bySlotWarmest(legs.flatMap(l => l.out.wear.filter(canCarry)));
  const wornNames = new Set(wear.map(i => i.name));

  const carry = [];
  const wornOn = it => legs.filter(l => l.out.wear.some(x => x.name === it.name));
  carryCandidates.forEach(it => {
    if (wornNames.has(it.name)) return;
    // On when the model first actually picks it, not merely when the temperature
    // touches the top of its range — those are different moments on a climb.
    const used = wornOn(it);
    const leg = used[0] || coldest;
    carry.push({item: it, leg, fromStart: leg === legs[0],
                at: km(leg.fromKm), time: hhmm(leg.startTime)});
  });

  /* Does what you're wearing plus everything you're carrying actually cover the
     coldest leg? Check it rather than assume it. */
  const combined = [...wear, ...carry.map(c => c.item)];
  const hb = heatBalance(coldest.f, coldest.w, coldest.opts, combined);
  const holds = hb.ratio >= 0.8;

  /* Where it doesn't hold, the conflict is in a slot you can't change: name the
     one garment, the trade either way, and any workaround the wardrobe has. */
  const conflicts = [];
  if (!holds){
    const warmBySlot = new Map(wear.map(i => [i.slot, i]));
    coldest.out.wear.filter(i => !canCarry(i)).forEach(cold => {
      const warm = warmBySlot.get(cold.slot);
      if (warm && warm.name === cold.name) return;
      let fix;
      if (cold.slot === "legs" && warm && warm.short){
        const bridge = gear.filter(x => !x.off && x.slot === "legextra"
                          && coldest.f.feel >= x.tmin && coldest.f.feel <= x.tmax)
                        .sort((a, b) => b.clo - a.clo)[0];
        fix = bridge
          ? `Stay in the ${warm.name.toLowerCase()} and carry ${bridge.name.toLowerCase()} — same reach, and they roll into a pocket.`
          : `Nothing you own bridges this mid-ride. Start in them and run warm early, or take the cold end as it comes.`;
      } else if (warm && warmest.f.feel <= cold.tmax){
        fix = `Wear the ${cold.name} from the start instead — the warmest leg is still inside its range, so it won't cook you.`;
      } else {
        fix = `Starting in it means running warm until ${km(coldest.fromKm)}. That is the trade, and on a long climb it is usually the wrong side of it.`;
      }
      conflicts.push({cold, warm, fix});
    });
  }

  /* Anything worn from the start that the route stops wanting, and that can
     actually come off. */
  const lastNeed = new Map();
  legs.forEach(leg => leg.out.wear.forEach(it => lastNeed.set(it.name, leg)));
  const shedAt = [];
  [...wear, ...carry.filter(c => c.fromStart).map(c => c.item)].forEach(it => {
    if (!canCarry(it)) return;
    const last = lastNeed.get(it.name);
    if (!last || last === legs[legs.length - 1]) return;
    const next = legs[legs.indexOf(last) + 1];
    // Only shed into warmth. The model dropping a garment because it swapped to
    // a warmer one is not a reason to take a layer off — and on this route that
    // read as "shed the wind jacket" at the coldest point of the day.
    if (next && next.f.feel > last.f.feel) {
      shedAt.push({item: it, at: km(next.fromKm), time: hhmm(next.startTime)});
    }
  });

  return {wear, carry, conflicts, shedAt, holds,
          worn: r2(hb.worn), required: r2(hb.required)};
}

/* Does one outfit differ from another in a way worth mentioning? */
const outfitKey = out => out.wear.map(i => i.name).sort().join("|");

async function analyseRoute(route, opts){
  const legs = legTiming(sampleRoute(route.points, route.stats, opts), opts.startDT, opts.speed);
  const blocks = await forecastMany(legs);

  legs.forEach((leg, k) => {
    const fc = blocks[Math.min(k, blocks.length - 1)];
    leg.modelEle = fc.elevation;
    const w = legWeather(fc, leg, opts);
    // Up and down are opposite problems, and treating them the same was wrong.
    // Climbing at 7% is the warmest you will be all day: hard effort, low speed,
    // almost no airflow. The descent that follows is the cold one.
    const climbing = leg.gradient > 0.03, descending = leg.gradient < -0.03;
    const legOpts = Object.assign({}, opts, {
      speed: leg.speed, hours: leg.hours, dist: leg.toKm - leg.fromKm,
      terrain: descending ? "exposed" : opts.terrain,
      pace: climbing ? "hard" : opts.pace
    });
    leg.climbing = climbing; leg.descending = descending;
    leg.w = w;
    leg.opts = legOpts;
    leg.f = rideFeel(w, legOpts);
    leg.out = state.mode === "wardrobe" ? pickOutfit(leg.f, w, legOpts, gear)
                                        : genericOutfit(leg.f, w, legOpts);
    leg.key = outfitKey(leg.out);
  });

  const feels = legs.map(l => l.f.feel);
  const coldest = legs[feels.indexOf(Math.min(...feels))];
  const warmest = legs[feels.indexOf(Math.max(...feels))];
  const spread = Math.max(...feels) - Math.min(...feels);

  // Compare by what you'd have to put on or take off, not by garment names.
  // Two near-equivalent jerseys swapping over a degree is the model breaking a
  // tie, not the ride needing different kit, and reporting it as a change
  // would cry wolf on every route.
  const coldSlots = new Map(coldest.out.wear.map(i => [i.slot, i.name]));
  const warmSlots = new Map(warmest.out.wear.map(i => [i.slot, i.name]));
  const extra = [...coldSlots].filter(([s]) => !warmSlots.has(s)).map(([,n]) => n);
  const shed  = [...warmSlots].filter(([s]) => !coldSlots.has(s)).map(([,n]) => n);
  const swaps = [...coldSlots].filter(([s, n]) => warmSlots.has(s) && warmSlots.get(s) !== n)
                              .map(([s, n]) => `${warmSlots.get(s)} → ${n}`);

  const changes = extra.length > 0 || shed.length > 0 || spread >= 3;

  const result = {legs, coldest, warmest, extra, shed, swaps, changes, spread};
  // Only the wardrobe knows what packs; the generic list has no such detail.
  if (changes && state.mode === "wardrobe") result.plan = packingPlan(result, opts);
  return result;
}

/* ---------------------------------------------------------------
   Render
----------------------------------------------------------------*/
const fmtDay = s => new Date(s + "T12:00").toLocaleDateString(undefined, {weekday:"long", day:"numeric", month:"long"});
const hhmm = d => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

function render(f, w, opts, place, analysis){
  const out = state.mode === "wardrobe" ? pickOutfit(f, w, opts, gear) : genericOutfit(f, w, opts);
  const watch = watchFor(f, w, opts);
  const band = bandFor(f.feel);
  const hb = out.hb;
  const ramp = rampFor(f.feel);

  // Head to feet, because that is the order you get dressed in.
  const byZone = items => items.slice().sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a.slot), ib = ZONE_ORDER.indexOf(b.slot);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const kitRows = items => byZone(items).map(it => `
    <div class="wx-kit__row">
      <div class="wx-kit__zone">${it._label || ZONE_LABEL[it.slot] || ""}</div>
      <p class="wx-kit__items">${it.name}${it._why || it.notes
        ? ` <em>${it._why || it.notes}</em>` : ""}</p>
    </div>`).join("");

  // Air -> ride-feel, as chips. Sign is carried by colour so the arithmetic
  // scans without being read.
  const chips = f.rows.filter(r => !r.base).map(r => `
    <li class="wx-chip${r.v > 0 ? " wx-chip--plus" : ""}">
      <b>${r.v > 0 ? "+" : "−"}${Math.abs(r1(r.v))}</b> ${r.label.toLowerCase()}
    </li>`).join("");

  $("#out").innerHTML = `
  <section class="wx-readout ${ramp}">
    <p class="wx-eyebrow">${placeLabel(place)} &middot; ${fmtDay(w.times[0].slice(0,10))}
       &middot; ${hhmm(w.startDT)}–${hhmm(w.endDT)} &middot; ${r1(opts.dist)} km</p>
    <div class="wx-readout__row">
      <div>
        <span class="wx-readout__value">${f.feel}</span>
        <span class="wx-readout__unit">&deg;C felt</span>
      </div>
      <div class="wx-readout__air">
        ${r1(w.tStart)}&deg;C air, ${r1(w.tEnd)}&deg; by the end<br>
        wind ${compass(w.dir)} ${Math.round(w.wind)} km/h${w.gust >= 40 ? `, gusts ${Math.round(w.gust)}` : ""}<br>
        rain ${Math.round(w.prob)}%${w.precipTotal >= 0.1 ? `, ${r1(w.precipTotal)} mm` : ""}
      </div>
    </div>
    <div class="wx-strip"><span class="wx-strip__mark" style="left:${rampPos(f.feel)}%"></span></div>
    <div class="wx-scale"><span>&minus;5&deg;</span><span>5&deg;</span><span>15&deg;</span><span>25&deg;</span></div>
  </section>

  <section class="wx-card wx-card--flat ${ramp}">
    <div class="wx-card__head">
      <h2 class="wx-heading">The next hours</h2>
      <span class="wx-eyebrow" style="margin:0">Riding hours lit</span>
    </div>
    <div class="wx-scroll">
      <div class="wx-hours">${w.outlook.map(h => `
        <div class="wx-hour${h.riding ? " is-riding" : ""} ${rampFor(h.t)}">
          <div class="wx-hour__time">${fmtTime(h.time)}</div>
          ${skyIcon(h.code, h.day, 26)}
          <div class="wx-hour__temp">${Math.round(h.t)}&deg;</div>
          <div class="wx-hour__wind">${windArrow(h.dir)}<span class="wx-num">${Math.round(h.wind)}</span></div>
          <div class="wx-hour__rain${h.prob >= 40 ? " is-wet" : ""}">${Math.round(h.prob)}%</div>
        </div>`).join("")}</div>
    </div>
    <p class="wx-note">${skyFor(w.outlook[0].code)[1]} at the start${
      w.outlook.some(h => !h.riding && h.prob >= 50)
        ? `, and it turns wet after you would be home, around ${fmtTime(w.outlook.find(h => !h.riding && h.prob >= 50).time)}`
        : ""}. Arrows point the way the wind is blowing.</p>
  </section>

  <section class="wx-card ${ramp}">
    <div class="wx-card__head">
      <h2 class="wx-heading">Wear</h2>
      <span class="wx-eyebrow" style="margin:0">Head to feet</span>
    </div>
    <div class="wx-kit">${kitRows(out.wear)}</div>
  </section>

  ${out.pocket.length ? `
  <section class="wx-card wx-card--flat ${ramp}">
    <h2 class="wx-heading">Carry</h2>
    <div class="wx-kit">${out.pocket.map(([it, why]) => `
      <div class="wx-kit__row">
        <div class="wx-kit__zone">Pocket</div>
        <p class="wx-kit__items">${it.name}${why ? ` <em>${why}</em>` : ""}</p>
      </div>`).join("")}</div>
  </section>` : ""}

  ${(() => {
    const bft = beaufort(w.wind), gustBft = beaufort(w.gust);
    // Ride out into the wind so the way home has it behind: the return leg is
    // ridden tired, and a headwind there is what actually makes people cold.
    const outbound = w.dirLate;
    const shifts = angleGap(w.dir, w.dirLate) > 40;
    const matters = bft.force >= 3;
    return `
  <section class="wx-card ${ramp}">
    <div class="wx-card__head">
      <h2 class="wx-heading">Wind, and which way to go</h2>
      <span class="wx-eyebrow" style="margin:0">Out into it, home with it</span>
    </div>
    ${(() => {
      // The bearing only means something if you can see where it points. With a
      // route loaded that is the route itself; without one, the start point.
      const box = document.querySelector(".wx-shell");
      const width = Math.max(240, Math.min(560, (box ? box.clientWidth : 600) - 44));
      const m = renderMap({
        width, height: Math.round(width * (route ? 0.62 : 0.5)),
        points: route ? route.points : null,
        lat: place.latitude, lon: place.longitude,
        windFrom: w.dir, outbound: matters ? outbound : null
      });
      return m + `<p class="wx-maplegend">
        <span><i class="k-wind"></i> wind, blowing this way</span>
        ${matters ? `<span><i class="k-go"></i> set off this way</span>` : ""}
        ${route ? `<span><i class="k-route"></i> your route</span>` : ""}
      </p>`;
    })()}

    <div class="wx-windgrid">
      <div class="wx-rosewrap">${compassRose(w.dir, outbound, 148)}</div>
      <div>
        <div class="wx-bft">
          <span class="wx-bft__n">${bft.force}</span>
          <span class="wx-bft__u">Bft</span>
          <span class="wx-bft__name">${bft.name}</span>
        </div>
        <p class="wx-note" style="margin-top:var(--sp-2)">
          From the <b>${compass(w.dir)}</b>, ${Math.round(w.wind)} km/h${
            w.gust >= w.wind + 12 ? `, gusting ${Math.round(w.gust)} which is force ${gustBft.force}` : ""}.
          ${bft.note}
        </p>
        ${(() => {
          const sp = w.spread;
          if (!sp) return "";
          const names = sp.models.map(m => m.model).join(", ");
          // A tight spread is a reason to trust the bearing; a wide one is a
          // reason to treat it as a steer rather than a plan. Saying which is
          // the whole point of asking more than one model.
          const tight = sp.dirSpread <= 20;
          return `<p class="wx-agree ${tight ? "is-tight" : "is-loose"}">
            <b>${names}</b> ${tight
              ? `agree within ${Math.round(sp.dirSpread)}&deg; on the direction`
              : `spread over ${Math.round(sp.dirSpread)}&deg; on the direction`}${
              sp.speedSpread >= 8 ? ` and ${Math.round(sp.speedSpread)} km/h on the speed` : ""}.
            ${tight
              ? "The bearing is worth planning around."
              : "Treat the bearing as a steer, not a plan, and look again nearer the time."}
            ${sp.tempSpread != null && sp.tempSpread >= 3
              ? `They also differ by ${r1(sp.tempSpread)}&deg;C on air temperature, so the kit call is less settled than one number makes it look.`
              : ""}</p>`;
        })()}
        ${matters ? `
        <p class="wx-startdir"><b>Set off towards the ${compass(outbound)}.</b>
          That puts the wind in your face going out and behind you coming back,
          which is the leg you ride tired.</p>
        ${shifts ? `<p class="wx-note">It veers from ${compass(w.dir)} to ${compass(w.dirLate)}
          across the ride, so this bearing follows the later wind, which is what
          you will actually be riding home in.</p>` : ""}`
        : `<p class="wx-note">Force ${bft.force} is not worth planning a route around.
           Go whichever way you like.</p>`}
      </div>
    </div>
  </section>`;
  })()}

  ${(() => {
    if (!analysis) return "";
    if (analysis.error)
      return `<p class="wx-alert"><b>Route check failed.</b> ${analysis.error}
        The advice above still stands for the start point.</p>`;

    const {legs, coldest, warmest, extra, shed, swaps, changes, spread} = analysis;
    const consistent = !changes;
    const km = n => `${Math.round(n)} km`;

    return `
  <section class="wx-card ${consistent ? ramp : rampFor(coldest.f.feel)}">
    <div class="wx-card__head">
      <h2 class="wx-heading">Along the route</h2>
      <span class="wx-eyebrow" style="margin:0">${legs.length} legs &middot; ${km(route.stats.distance)}${
        route.stats.hasElevation ? ` &middot; ${Math.round(route.stats.ascent)} m up` : ""}</span>
    </div>

    <div class="wx-scroll">
      <div class="wx-legs">${legs.map(l => `
        <div class="wx-leg ${rampFor(l.f.feel)}">
          <div class="wx-leg__km">${km(l.fromKm)}</div>
          ${skyIcon(l.w.code, l.w.day, 22)}
          <div class="wx-leg__feel">${l.f.feel}&deg;</div>
          <div class="wx-leg__air">${r1(l.w.tStart)}&deg; air</div>
          <div class="wx-leg__wind" title="${Math.round(l.w.ambient)} km/h wind, ${Math.round(Math.abs(l.w.headwind))} km/h of it ${windLabel(l.w.headwind)}">
            ${l.heading != null ? windArrow(l.w.dir) : ""}
            <span class="wx-num">${l.w.headwind > 0 ? "+" : ""}${Math.round(l.w.headwind)}</span>
          </div>
          ${l.ele != null ? `<div class="wx-leg__ele">${Math.round(l.ele)} m</div>` : ""}
          <div class="wx-leg__time">${hhmm(l.startTime)}</div>
        </div>`).join("")}</div>
    </div>

    ${consistent ? `
      <p class="wx-startdir"><b>The same kit works the whole way.</b>
        Ride-feel moves ${spread <= 1 ? "barely at all" : `about ${Math.round(spread)}&deg;`}
        between the legs, and nothing in that range changes what you'd put on or take off.</p>
      ${swaps.length ? `<p class="wx-note">Borderline either way: ${swaps.join("; ")}. Same
        warmth, so it isn't worth carrying both.</p>` : ""}`
    : `
      <p class="wx-startdir"><b>The kit doesn't hold for the whole ride.</b>
        Coldest is ${coldest.f.feel}&deg; around ${km(coldest.fromKm)}${
          coldest.ele != null && route.stats.hasElevation ? ` at ${Math.round(coldest.ele)} m` : ""},
        warmest ${warmest.f.feel}&deg; around ${km(warmest.fromKm)}.</p>

      ${analysis.plan ? (() => {
        const {wear: pWear, carry, conflicts, shedAt, holds, worn, required} = analysis.plan;
        return `
        <h3 class="wx-heading" style="margin-top:var(--sp-4)">To make it hold</h3>
        <div class="wx-kit">
          ${pWear.length ? `
          <div class="wx-kit__row">
            <div class="wx-kit__zone">Wear</div>
            <p class="wx-kit__items">${pWear.map(i => i.name).join(", ")}
              <em>Chosen for the warmest leg, because a jersey can't come off at the roadside.</em></p>
          </div>` : ""}
          ${carry.map(c => `
            <div class="wx-kit__row">
              <div class="wx-kit__zone">${c.fromStart ? "On now" : "Carry"}</div>
              <p class="wx-kit__items">${c.item.name}
                <em>${c.fromStart
                  ? "Wanted from the off."
                  : `On around ${c.at}, about ${c.time}, where it reads ${c.leg.f.feel}&deg;.`}${
                  c.item.pack ? " Packs into a pocket." : ""}</em></p>
            </div>`).join("")}
          ${shedAt.map(sd => `
            <div class="wx-kit__row">
              <div class="wx-kit__zone">Shed</div>
              <p class="wx-kit__items">${sd.item.name}
                <em>Off around ${sd.at}, about ${sd.time} — into a pocket, not left behind.</em></p>
            </div>`).join("")}
          ${conflicts.map(c => `
            <div class="wx-kit__row">
              <div class="wx-kit__zone">Decide</div>
              <p class="wx-kit__items">${c.cold.name} against ${c.warm ? c.warm.name : "nothing"}
                <em>${c.fix}</em></p>
            </div>`).join("")}
        </div>

        ${holds
          ? `<p class="wx-note">Everything the cold end needs goes in a pocket, so start in what
             the warm legs want and add as the route cools. Worn and carried together come to
             ${worn} clo against ${required} required at the coldest point.</p>`
          : `<p class="wx-alert"><b>Carrying isn't enough on its own.</b> Even with everything
             above on, the coldest leg wants ${required} clo and this gives ${worn}. ${
               conflicts.length
                 ? "The decision above is the one that closes it."
                 : "And nothing else in your gear closes it — this route is colder than what you have with you. Shorten it, start later when it has warmed, or go back for more kit."
             }</p>`}`;
      })() : `
        ${extra.length ? `<p class="wx-note"><b>The cold end wants</b> ${extra.join(", ")} —
          carry what you can rather than starting in it.</p>` : ""}
        ${shed.length ? `<p class="wx-note"><b>The warm end doesn't want</b> ${shed.join(", ")}.</p>` : ""}`}`}

    ${(() => {
      const hard = legs.filter(l => l.w.headwind >= 15);
      if (!hard.length) return "";
      return `<p class="wx-note">Into the wind from ${hard.map(l => km(l.fromKm)).join(", ")} —
        ${Math.round(Math.max(...hard.map(l => l.w.headwind)))} km/h of headwind at the worst of it.</p>`;
    })()}
    ${(() => {
      const wet = legs.filter(l => l.w.prob >= 50);
      if (!wet.length) return "";
      return `<p class="wx-note">Rain most likely around ${wet.map(l => km(l.fromKm)).join(", ")}.</p>`;
    })()}
  </section>`;
  })()}

  ${out.notes.map(n => `<p class="wx-alert">${n}</p>`).join("")}
  ${watch.map(x => `<p class="wx-alert"><b>Watch.</b> ${x}</p>`).join("")}

  <h2 class="wx-heading" style="margin-top:var(--sp-6)">Air &rarr; ride-feel</h2>
  <p class="wx-eyebrow">${r1(f.air)}&deg;C air, ${f.feel}&deg; felt${
    f.extFeel !== f.feel ? ` &middot; hands and feet ${f.extFeel}&deg;` : ""}</p>
  <ul class="wx-chips">${chips}</ul>
  <p class="wx-note">Hands and feet sit still in the airflow, and running hot does not apply
     to fingers — so they are read on ${f.extFeel}&deg;, not ${f.feel}&deg;.</p>

  ${hb ? `
  <details class="wx-more">
    <summary>Heat balance &middot; ${r2(hb.worn)} of ${r2(hb.required)} clo, ${hb.verdict}</summary>
    <div class="wx-scroll"><table class="wx-table ${ramp}">
      <tbody>
        <tr><td>Work rate at ${r1(opts.speed)} km/h</td><td class="wx-right wx-num">${hb.met} MET</td></tr>
        <tr><td>Insulation required, 0.148 &times; (33 &minus; ${r1(f.envTemp)}) &divide; ${hb.met}</td>
            <td class="wx-right wx-num">${r2(hb.required)}</td></tr>
        <tr><td>Worn on the torso, catalogue value</td><td class="wx-right wx-num">${r2(hb.staticClo)}</td></tr>
        <tr><td>Apparent wind ${r1(hb.vApparent)} m/s against a ${Math.round(hb.outerWind*100)}% windproof outer layer</td>
            <td class="wx-right wx-num">&times;${r2(hb.shelter)}</td></tr>
        <tr class="wx-total"><td>Effective</td><td class="wx-right wx-feel">${r2(hb.worn)} clo</td></tr>
      </tbody>
    </table></div>
    <p class="wx-note">A windproof outer layer keeps the stack beneath it; a permeable one lets
       the airflow strip it. That is why 75&nbsp;g of gilet can beat a much thicker fleece.</p>
  </details>` : ""}

  <details class="wx-more">
    <summary>The whole scale</summary>
    <div class="wx-scroll"><table class="wx-table">
      <thead><tr><th>Ride-feel</th><th>Core</th><th>Legs</th><th>Extremities</th></tr></thead>
      <tbody>${BANDS.map(b => `
        <tr class="${rampFor(b.min + 1)}${b === band ? " is-here" : ""}">
          <td class="wx-num">${b.label}</td><td>${b.core}</td><td>${b.legs}</td><td>${b.ext}</td>
        </tr>`).join("")}</tbody>
    </table></div>
  </details>

`;
  $("#out").scrollIntoView({behavior:"smooth", block:"start"});
}

/* ---------------------------------------------------------------
   Go
----------------------------------------------------------------*/
$("#go").onclick = async () => {
  if (!state.place) return status("Pick a location first.", true);
  const date = $("#date").value, time = $("#time").value;
  if (!date || !time) return status("Set a date and start time.", true);

  const n = rideNumbers();
  const dist = n.dist, hours = n.hours;
  const opts = {dist, hours, speed:n.speed, pace:state.pace, terrain:state.terrain,
                rider:state.rider, type:state.type};
  status("Fetching forecast…");
  $("#go").disabled = true;
  try{
    const fc = await forecast(state.place.latitude, state.place.longitude);
    const w = rideWindow(fc, date, time, hours);
    // Agreement is a nice-to-have: a failure here must not cost the forecast.
    try{
      w.spread = await modelSpread(state.place.latitude, state.place.longitude,
                                   date, `${date}T${time.slice(0,2)}:00`);
    }catch(e){ w.spread = null; }
    let analysis = null;
    if (route){
      status("Checking the kit along the route…");
      try{
        analysis = await analyseRoute(route, Object.assign({}, opts, {startDT: w.startDT}));
      }catch(err){
        // A route that fails shouldn't cost you the advice for the start point.
        analysis = {error: err.message};
      }
    }
    status("");
    render(rideFeel(w, opts), w, opts, state.place, analysis);
  }catch(e){
    status(e.message, true);
    $("#out").innerHTML = "";
  }finally{ $("#go").disabled = false; }
};

load();
updateSpeedHint();
