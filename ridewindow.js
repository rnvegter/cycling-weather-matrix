"use strict";

/* ---------------------------------------------------------------
   The hours you ride, out of the forecast — and which hours to pick.

   rideWindow turns the hourly forecast into the numbers the model reads for
   one start time and duration. bestStarts runs it for every start across the
   day and says which one rides best, so a ride that could just as well go two
   hours later is told that it would miss the rain.

   Kept apart from app.js so both can be tested in Node: they read the
   forecast and nothing else. Uses clamp and rideFeel from model.js and
   rampTable from fuel.js, which load before this file.
----------------------------------------------------------------*/

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
        codes=g("weather_code"), freeze=g("freezing_level_height"),
        rhs=g("relative_humidity_2m"), dews=g("dew_point_2m");

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
    /* Averaged over the riding hours rather than read off the start, because
       unlike temperature this is a property of the day rather than the moment
       you set off — and it barely moves inside a morning. Absent from a feed
       that didn't carry it, which the model reads as "say nothing". */
    rh: rhs.length ? rhs.reduce((a,b)=>a+b,0)/rhs.length : null,
    dew: dews.length ? dews.reduce((a,b)=>a+b,0)/dews.length : null,
    // Altitude of 0°C. Lower than the ground you are riding on means freezing.
    freezingLevel: freeze.length ? Math.min(...freeze) : null,
    // Quarter-hourly rain start, when the 15-minute feed reaches this far out.
    rainStart15: (() => {
      const m = fc.minutely_15;
      if (!m || !m.time) return null;
      const from = startDT.getTime(), to = endDT.getTime();
      for (let k = 0; k < m.time.length; k++){
        const t = new Date(m.time[k]).getTime();
        if (t < from || t > to) continue;
        if ((m.precipitation[k] || 0) >= 0.1) return m.time[k];
      }
      return null;
    })(),
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
   The best start across the day.

   Every whole-hour start from 05:00 to the last one that is home by 22:00 is
   run through rideWindow and rideFeel, exactly as the chosen start is, and
   given a cost. Lowest cost rides best.

   The cost adds what makes a ride worse, each as a ramp so no start wins or
   loses on a tenth of a degree or a tenth of a millimetre:

     rain    the rain expected while you ride, and how likely it is at all
     cold    ride-feel below 12°, a quarter point a degree
     heat    ride-feel above 24°
     wind    mean wind above 15 km/h, gusts above 45
     dark    the share of the ride after sunset or before sunrise

   The weights are a judgement, not a fit: roughly, a millimetre of rain
   costs about as much as five degrees colder, and an hour in the dark about
   as much as a light shower. They decide the order of starts, never the kit,
   which is still worked out for the start you choose.

   Only the start point is read. A loaded route's legs are checked for the
   start you choose, not for every start in the scan.
----------------------------------------------------------------*/

const START_EARLIEST = 5, HOME_BY = 22;

function startCost(w, f){
  const parts = {
    rain: rampTable(w.precipTotal, [[0, 0], [0.3, 0.6], [1, 1.4], [4, 3]])
        + rampTable(w.prob, [[20, 0], [80, 0.6]]),
    cold: rampTable(f.feel, [[-5, 4.25], [12, 0]]),
    heat: rampTable(f.feel, [[24, 0], [34, 2.5]]),
    wind: rampTable(w.wind, [[15, 0], [40, 2]]) + rampTable(w.gust, [[45, 0], [70, 1]]),
    dark: 1.5 * (w.dark || 0)
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return {total, parts};
}

/* fc: the forecast; dateStr "2026-11-09"; hours the ride length; opts as for
   rideFeel; chosenTime "07:15"; now in ms, so a start already gone today is
   not offered. Returns null when fewer than two starts can be compared. */
function bestStarts(fc, dateStr, hours, opts, chosenTime, now){
  const pad = n => String(n).padStart(2, "0");
  const nowMs = now == null ? Date.now() : now;
  const read = time => {
    try{
      const w = rideWindow(fc, dateStr, time, hours);
      const f = rideFeel(w, opts);
      return {time, w, f, cost: startCost(w, f)};
    }catch(e){ return null; }        // outside the forecast
  };

  const latest = Math.max(START_EARLIEST, Math.floor(HOME_BY - hours));
  const starts = [];
  for (let h = START_EARLIEST; h <= latest; h++){
    const time = `${pad(h)}:00`;
    if (new Date(`${dateStr}T${time}`).getTime() < nowMs) continue;
    const s = read(time);
    if (s) starts.push(s);
  }
  if (starts.length < 2) return null;

  const best = starts.reduce((a, b) => b.cost.total < a.cost.total ? b : a);
  const chosen = chosenTime ? read(chosenTime) : null;
  /* Worth saying only when it is clearly better: half a point is about two
     degrees, or a light shower's worth of rain. Under that the start you
     picked stands, and the scan just shows the day. */
  const better = !!chosen && best.time.slice(0, 2) !== chosenTime.slice(0, 2)
    && chosen.cost.total - best.cost.total >= 0.5;
  return {starts, best, chosen, better};
}

/* In words, what the better start gains over the chosen one: the two or three
   biggest differences, largest first. */
function startGains(best, chosen){
  const out = [];
  const dRain = chosen.w.precipTotal - best.w.precipTotal;
  if (dRain >= 0.2) out.push([chosen.cost.parts.rain - best.cost.parts.rain,
    best.w.precipTotal < 0.1 ? "dry instead of wet" : `${r1(dRain)} mm less rain`]);
  const dFeel = best.f.feel - chosen.f.feel;
  if (Math.abs(dFeel) >= 1.5 && (chosen.cost.parts.cold + chosen.cost.parts.heat) > (best.cost.parts.cold + best.cost.parts.heat))
    out.push([chosen.cost.parts.cold + chosen.cost.parts.heat - best.cost.parts.cold - best.cost.parts.heat,
      `${Math.round(Math.abs(dFeel))}° ${dFeel > 0 ? "warmer" : "cooler"} on the bike`]);
  const dWind = chosen.w.wind - best.w.wind;
  if (dWind >= 5) out.push([chosen.cost.parts.wind - best.cost.parts.wind, `${Math.round(dWind)} km/h less wind`]);
  if (chosen.w.dark - best.w.dark >= 0.25) out.push([chosen.cost.parts.dark - best.cost.parts.dark, "more of it in daylight"]);
  return out.sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]);
}
