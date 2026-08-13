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
  document.querySelectorAll(".pill-row").forEach(row => {
    const g = row.dataset.group;
    row.querySelectorAll(".pill").forEach(p =>
      p.setAttribute("aria-pressed", p.dataset.v === state[g] ? "true" : "false"));
  });
}
document.querySelectorAll(".pill-row").forEach(row => {
  row.addEventListener("click", e => {
    const b = e.target.closest(".pill");
    if (!b) return;
    row.querySelectorAll(".pill").forEach(p => p.setAttribute("aria-pressed", p === b ? "true" : "false"));
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

function updateSpeedHint(){
  const dist = parseFloat($("#dist").value), dur = parseFloat($("#dur").value), el = $("#speedhint");
  if (dist > 0 && dur > 0)
    el.textContent = `Average speed ${r1(dist/dur)} km/h — sets both the self-generated wind chill and the work rate.`;
  else if (dist > 0 || dur > 0){
    const sp = BASE_SPEED[state.type] * PACE_SPEED[state.pace];
    el.textContent = dist > 0 ? `Estimating ${r1(dist/sp)} h at ${r1(sp)} km/h (${state.type}, ${state.pace}).`
                              : `Estimating ${Math.round(dur*sp)} km at ${r1(sp)} km/h (${state.type}, ${state.pace}).`;
  } else el.textContent = "Fill in either distance or duration — the other is estimated from your ride type and pace.";
}
$("#dist").addEventListener("input", updateSpeedHint);
$("#dur").addEventListener("input", updateSpeedHint);

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
  box.classList.remove("hidden");
  try{
    const res = await geocode(q);
    if (!res.length){ box.innerHTML = "<button disabled>No match</button>"; return; }
    box.innerHTML = "";
    res.forEach(p => {
      const b = document.createElement("button");
      b.textContent = placeLabel(p);
      b.onclick = () => { state.place = p; showPlace(p); box.classList.add("hidden"); save(); };
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
  if (!msg){ el.classList.add("hidden"); el.textContent = ""; return; }
  el.className = "status" + (isErr ? " err" : "");
  el.textContent = msg;
}

/* ---------------------------------------------------------------
   Forecast
----------------------------------------------------------------*/
async function forecast(lat, lon){
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${lat}&longitude=${lon}`
    + "&hourly=temperature_2m,precipitation_probability,precipitation,cloud_cover,"
    + "wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day"
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
        cloud=g("cloud_cover"), day=g("is_day"), dirs=g("wind_direction_10m");

  let sx=0, sy=0;
  dirs.forEach(d => { const rad=d*Math.PI/180; sx+=Math.cos(rad); sy+=Math.sin(rad); });
  const dirMean = ((Math.atan2(sy,sx)*180/Math.PI)+360)%360;

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
    sunrise, sunset,
    hourly: idx.map((k,n) => ({time:times[k], t:temps[n], wind:winds[n], precip:precip[n], prob:probs[n]}))
  };
}

/* ---------------------------------------------------------------
   Render
----------------------------------------------------------------*/
const fmtDay = s => new Date(s + "T12:00").toLocaleDateString(undefined, {weekday:"long", day:"numeric", month:"long"});
const hhmm = d => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

function render(f, w, opts, place){
  const out = state.mode === "wardrobe" ? pickOutfit(f, w, opts, gear) : genericOutfit(f, w, opts);
  const watch = watchFor(f, w, opts);
  const band = bandFor(f.feel);
  const hb = out.hb;

  const kitList = items => items.map(it => `
    <li><span class="slot">${it._label || SLOT_LABEL[it.slot] || ""}</span>
    <span class="item">${it.name}${it._why || it.notes ? `<span class="why">${it._why || it.notes}</span>` : ""}</span></li>`).join("");

  $("#out").innerHTML = `
  <div class="panel">
    <div class="headline">
      <strong>${placeLabel(place)}</strong>
      <span>${fmtDay(w.times[0].slice(0,10))} · ${hhmm(w.startDT)}–${hhmm(w.endDT)} · ${r1(opts.dist)} km</span>
    </div>
    <div class="condline">
      ${r1(w.tStart)}°C → ${r1(w.tEnd)}°C · wind ${Math.round(w.wind)} km/h ${compass(w.dir)}${w.gust>=40?`, gusts ${Math.round(w.gust)}`:""} ·
      ${Math.round(w.prob)}% rain${w.precipTotal>=0.1?` (${r1(w.precipTotal)} mm)`:""} · ${Math.round(w.cloud)}% cloud
    </div>

    <div class="feelbox">
      <div><div class="feellabel">Feels like riding</div><div class="feelnum">${f.feel}<small>°C</small></div></div>
      <div class="feelsep"></div>
      <div><div class="feellabel">Hands &amp; feet</div><div class="feelnum">${f.extFeel}<small>°C</small></div></div>
      <div class="feelsep"></div>
      <div><div class="feellabel">Band</div>
        <div style="font-size:17px;font-weight:600">${band.label}${/\d$/.test(band.label)?"°C":""}</div>
        <div style="color:var(--muted);font-size:13px">${r1(opts.speed)} km/h avg over ${r1(opts.hours)} h</div></div>
      ${hb ? `<div class="feelsep"></div>
      <div><div class="feellabel">Insulation</div>
        <div style="font-size:17px;font-weight:600">${r2(hb.worn)} / ${r2(hb.required)} clo</div>
        <div style="color:var(--muted);font-size:13px">${hb.verdict}</div></div>` : ""}
    </div>

    <h3>Wear</h3>
    <ul class="kit">${kitList(out.wear)}</ul>

    ${out.pocket.length ? `<h3>Pocket</h3><ul class="kit">${out.pocket.map(([it,why]) => `
      <li><span class="slot">Carry</span><span class="item">${it.name}${why?`<span class="why">${why}</span>`:""}</span></li>`).join("")}</ul>` : ""}

    ${out.notes.length ? `<h3>Notes</h3><ul class="plain">${out.notes.map(n=>`<li>${n}</li>`).join("")}</ul>` : ""}
    ${watch.length ? `<h3>Watch for</h3><ul class="plain">${watch.map(x=>`<li>${x}</li>`).join("")}</ul>` : ""}
    ${hb && hb.detail ? `<div class="warnbox">Insulation reads <strong>${hb.verdict}</strong>: ${r2(hb.worn)} clo effective against ${r2(hb.required)} required. ${hb.detail}</div>` : ""}
  </div>

  <div class="panel">
    <h2>Effect matrix — how the air temperature became ride-feel</h2>
    <div class="scroll"><table>
      <thead><tr><th>Factor</th><th style="text-align:right">Effect</th></tr></thead>
      <tbody>
        ${f.rows.map(r => `<tr><td>${r.label}</td>
          <td class="num ${r.base?"":(r.v>0?"pos":"neg")}">${r.base?r1(r.v)+"°C":(r.v>0?"+":"")+r1(r.v)+"°C"}</td></tr>`).join("")}
        <tr class="total"><td>Ride-feel</td><td class="num">${f.feel}°C</td></tr>
        <tr><td style="color:var(--muted);font-size:13px">Hands and feet — the rider calibration doesn't apply to them; they sit still in the airflow</td>
            <td class="num">${f.extFeel}°C</td></tr>
      </tbody>
    </table></div>

    ${hb ? `
    <details open>
      <summary>Heat balance</summary>
      <div class="scroll"><table>
        <tbody>
          <tr><td>Work rate at ${r1(opts.speed)} km/h</td><td class="num">${hb.met} MET</td></tr>
          <tr><td>Insulation required — 0.148 × (33 − ${r1(f.air)}) ÷ ${hb.met}</td><td class="num">${r2(hb.required)} clo</td></tr>
          <tr><td>Garments on the torso, catalogue value</td><td class="num">${r2(hb.staticClo)} clo</td></tr>
          <tr><td>Apparent wind ${r1(hb.vApparent)} m/s, outer layer ${Math.round(hb.outerWind*100)}% windproof</td><td class="num">×${r2(hb.shelter)}</td></tr>
          <tr class="total"><td>Effective insulation</td><td class="num">${r2(hb.worn)} clo — ${hb.verdict}</td></tr>
        </tbody>
      </table></div>
      <div class="hint">A windproof outer layer preserves the stack beneath it; a permeable one lets the airflow strip it. That is why a 75&nbsp;g gilet can beat a much thicker fleece.</div>
    </details>` : ""}

    <details>
      <summary>Full band matrix</summary>
      <div class="scroll"><table class="matrix">
        <thead><tr><th>Ride-feel</th><th>Core</th><th>Legs</th><th>Extremities</th></tr></thead>
        <tbody>${BANDS.map(b => `<tr class="${b===band?"hi":""}"><td>${b.label}</td><td>${b.core}</td><td>${b.legs}</td><td>${b.ext}</td></tr>`).join("")}</tbody>
      </table></div>
      <div class="hint">Your band is highlighted. Where one of your own garments gives a range, that range wins — this table is the generic fallback.</div>
    </details>

    <details>
      <summary>Hour by hour</summary>
      <div class="scroll"><table>
        <thead><tr><th>Time</th><th style="text-align:right">Temp</th><th style="text-align:right">Wind</th><th style="text-align:right">Rain</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${w.hourly.map(h => `<tr><td>${fmtTime(h.time)}</td><td class="num">${r1(h.t)}°C</td>
          <td class="num">${Math.round(h.wind)} km/h</td><td class="num">${Math.round(h.prob)}%</td>
          <td class="num">${h.precip?r1(h.precip)+" mm":"—"}</td></tr>`).join("")}</tbody>
      </table></div>
    </details>
  </div>`;
  $("#out").scrollIntoView({behavior:"smooth", block:"start"});
}

/* ---------------------------------------------------------------
   Go
----------------------------------------------------------------*/
$("#go").onclick = async () => {
  if (!state.place) return status("Pick a location first.", true);
  const date = $("#date").value, time = $("#time").value;
  if (!date || !time) return status("Set a date and start time.", true);

  let dist = parseFloat($("#dist").value), hours = parseFloat($("#dur").value);
  const assumed = BASE_SPEED[state.type] * PACE_SPEED[state.pace];
  if (!(dist > 0) && !(hours > 0)){ hours = 2; dist = hours * assumed; }
  else if (!(dist > 0)) dist = hours * assumed;
  else if (!(hours > 0)) hours = dist / assumed;

  const opts = {dist, hours, speed:dist/hours, pace:state.pace, terrain:state.terrain,
                rider:state.rider, type:state.type};
  status("Fetching forecast…");
  $("#go").disabled = true;
  try{
    const fc = await forecast(state.place.latitude, state.place.longitude);
    const w = rideWindow(fc, date, time, hours);
    status("");
    render(rideFeel(w, opts), w, opts, state.place);
  }catch(e){
    status(e.message, true);
    $("#out").innerHTML = "";
  }finally{ $("#go").disabled = false; }
};

load();
updateSpeedHint();
