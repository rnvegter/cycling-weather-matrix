"use strict";

/* ---------------------------------------------------------------
   intervals.icu, the buttons. The decisions are in intervals.js; the key is
   on the server, which answers /api/intervals/... with only what the app uses.

   Nothing here shows until the server says a key is set, so an install
   without one — or a static one, with no server at all — looks exactly as it
   did before.
----------------------------------------------------------------*/

const ICU_API = new URL("api/intervals/", location.href.replace(/[^/]*$/, "")).toString();
let icuReady = false;

async function icuGet(p){
  const r = await fetch(ICU_API + p, {cache: "no-store"});
  const text = await r.text();
  if (!r.ok){
    let why = "";
    try{ why = JSON.parse(text).error; }catch(e){}
    throw new Error(why || `intervals.icu could not be read (${r.status}).`);
  }
  return text;
}

const icuShow = on => ["icuimport", "icuroutes", "icuplanned"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("wx-hidden", !on);
});

/* --- Recorded rides into History ---------------------------------- */

let icuImporting = false;
async function icuImport(){
  if (icuImporting) return;
  icuImporting = true;
  const btn = document.getElementById("icuimport");
  btn.disabled = true;
  try{
    let last = null;
    try{ last = localStorage.getItem(ICU_LAST_KEY); }catch(e){}
    const win = icuImportWindow(last);
    histStatus("Asking intervals.icu for your rides…");
    const rides = JSON.parse(await icuGet(`rides?oldest=${win.oldest}&newest=${win.newest}`));
    const todo = ridesToImport(rides, loadHistory());
    const skipped = rides.filter(r => r.hasGps === false).length;
    let matched = 0, added = 0;
    const failed = [];
    for (const [k, r] of todo.entries()){
      histStatus(`Importing ${k + 1} of ${todo.length}: ${r.name || r.start}…`);
      try{
        const gpx = await icuGet(`ride-gpx?id=${encodeURIComponent(r.id)}`);
        const planned = matchPlanned(loadHistory(), r);
        const label = `intervals.icu: ${r.name || r.id}`;
        if (planned){
          // The ride planned here: the recording replaces the speed guess.
          const parsed = parseGPX(gpx);
          const stats = parsed.recorded ? activityStats(parsed.points) : null;
          if (!stats) throw new Error("its GPX has no times in it");
          attachActual(planned.id, stats, label);
          setRideFields(planned.id, {icuId: r.id});
          matched++;
        } else {
          // Never planned here: the archive supplies the weather, as for a file.
          const out = await rideFromActivity(gpx, label);
          setRideFields(out.id, {icuId: r.id});
          added++;
        }
      }catch(err){ failed.push(`${r.name || r.id} (${err.message})`); }
    }
    /* Move the window on only when everything in it was seen; a ride that
       failed (the archive runs a day behind) or did not fit in this press is
       asked for again next time, and the ids already imported are skipped. */
    if (!failed.length && todo.length < ICU_IMPORT_MAX){
      try{ localStorage.setItem(ICU_LAST_KEY, win.newest); }catch(e){}
    }
    renderHistory();
    const parts = [];
    if (matched) parts.push(`${matched} matched to rides planned here`);
    if (added) parts.push(`${added} added from the archive`);
    histStatus((parts.length ? `Imported ${matched + added}: ${parts.join(", ")}.` : "Nothing new on intervals.icu.")
      + (skipped ? ` ${skipped} without GPS left out.` : "")
      + (failed.length ? ` Not yet: ${failed.join("; ")}.` : ""), failed.length > 0 && !matched && !added);
  }catch(err){
    histStatus(err.message, true);
  }finally{
    icuImporting = false;
    btn.disabled = false;
  }
}

/* --- Ratings back to intervals.icu --------------------------------- */

let icuSending = false;
async function icuSendComments(){
  if (!icuReady || icuSending) return;
  const due = icuCommentsDue(loadHistory());
  if (!due.length) return;
  icuSending = true;
  try{
    for (const e of due){
      const text = icuComment(e);
      if (!text) continue;
      const r = await fetch(ICU_API + "comment", {method: "POST", headers: {"content-type": "application/json"},
                                                  body: JSON.stringify({id: e.icuId, text})});
      if (!r.ok) break;               // try again on the next round; the rating is safe here
      // Marked with the rating it carried, so a later change is sent again.
      setRideFields(e.id, {icuSentAt: e.ratedAt});
    }
  }catch(e){
  }finally{ icuSending = false; }
}

/* --- Planned workouts onto the Ride tab ---------------------------- */

async function icuShowPlanned(){
  const box = document.getElementById("icuplannedlist");
  box.classList.remove("wx-hidden");
  box.innerHTML = `<p class="wx-note">Asking intervals.icu…</p>`;
  try{
    const now = new Date(), to = new Date(Date.now() + 7 * 86400000);
    const list = JSON.parse(await icuGet(`planned?oldest=${isoDay(now)}&newest=${isoDay(to)}`));
    box.innerHTML = list.length ? list.map(p => {
      const r = plannedToRide(p);
      return `<div class="wx-advice">
        <p class="wx-advice__text"><b>${escHtml(p.name || "Planned ride")}</b> — ${escHtml(r.date || "")}${r.time ? ` ${r.time}` : ""}${
          r.hours ? ` · ${r.hours} h` : ""}${r.effort ? ` · effort ${r.effort} of 5` : ""}</p>
        <button class="wx-btn wx-btn--quiet" data-icuplan="${escHtml(p.id)}">Use</button>
      </div>`;
    }).join("") : `<p class="wx-note">Nothing planned on intervals.icu for the next seven days.</p>`;
    box._plans = list;
  }catch(err){ box.innerHTML = `<p class="wx-note is-error">${escHtml(err.message)}</p>`; }
}

function icuUsePlanned(p){
  const r = plannedToRide(p);
  if (r.date) $("#date").value = r.date;
  if (r.time) $("#time").value = r.time;
  if (r.hours){ $("#dur").value = r.hours; $("#dist").value = ""; }
  if (r.pace){ state.pace = r.pace; syncPills(); }
  // The same channel the Fietscoach link uses: the effort reaches the fuel card
  // until the hours or the pace are changed by hand.
  handoff = {date: r.date, time: r.time, hours: r.hours, pace: r.pace, effort: r.effort, name: r.name};
  const el = $("#handoff");
  el.textContent = `From intervals.icu${r.name ? ": " + r.name : ""}${r.effort ? ` · effort ${r.effort} of 5` : ""}${
    r.time ? "" : ". No start time was planned, so set one"}. The fuel advice uses it.`;
  el.classList.remove("wx-hidden");
  document.getElementById("icuplannedlist").classList.add("wx-hidden");
  updateSpeedHint();
  status(r.time ? "Planned ride filled in. Press Read the weather." : "Planned ride filled in; set the start time, then Read the weather.");
}

/* --- Routes into Favourites ---------------------------------------- */

async function icuShowRoutes(){
  const box = document.getElementById("icuroutelist");
  box.classList.remove("wx-hidden");
  box.innerHTML = `<p class="wx-note">Asking intervals.icu…</p>`;
  try{
    const list = JSON.parse(await icuGet("routes")).sort((a, b) => (b.rides || 0) - (a.rides || 0));
    const have = new Set(loadFavourites().map(f => f.icuRouteId).filter(Boolean));
    box.innerHTML = list.length ? list.map(r => `<div class="wx-advice">
        <p class="wx-advice__text"><b>${escHtml(r.name)}</b>${r.distanceKm ? ` — ${r1(r.distanceKm)} km` : ""}${
          r.rides ? ` · ridden ${r.rides}×` : ""}${r.commute ? " · commute" : ""}</p>
        ${have.has(r.id) ? `<span class="wx-note" style="margin:0">Already a favourite</span>`
          : `<button class="wx-btn wx-btn--quiet" data-icuroute="${escHtml(r.id)}">Add</button>`}
      </div>`).join("")
      : `<p class="wx-note">intervals.icu has no routes yet. It finds them in rides you repeat.</p>`;
  }catch(err){ box.innerHTML = `<p class="wx-note is-error">${escHtml(err.message)}</p>`; }
}

async function icuAddRoute(id, btn){
  btn.disabled = true;
  try{
    const route = JSON.parse(await icuGet(`route?id=${encodeURIComponent(id)}`));
    const fav = routeToFavourite(route);
    if (!fav) throw new Error("That route has no path on intervals.icu.");
    const r = addFavourite(fav);
    renderFavourites();
    favStatus(r.added ? `Added ${fav.name}.` : `${fav.name} is already a favourite, as ${r.existing.name}.`);
    if (!r.added && !r.existing.icuRouteId) updateFavourite(r.existing.id, {icuRouteId: id});
    icuShowRoutes();
  }catch(err){ favStatus(err.message, true); btn.disabled = false; }
}

/* --- Wiring -------------------------------------------------------- */

document.getElementById("icuimport").onclick = icuImport;
document.getElementById("icuplanned").onclick = icuShowPlanned;
document.getElementById("icuroutes").onclick = icuShowRoutes;
document.getElementById("icuplannedlist").addEventListener("click", e => {
  const b = e.target.closest("[data-icuplan]");
  if (!b) return;
  const p = (document.getElementById("icuplannedlist")._plans || []).find(x => x.id === b.dataset.icuplan);
  if (p) icuUsePlanned(p);
});
document.getElementById("icuroutelist").addEventListener("click", e => {
  const b = e.target.closest("[data-icuroute]");
  if (b) icuAddRoute(b.dataset.icuroute, b);
});

fetch(ICU_API + "status", {cache: "no-store"}).then(r => r.ok ? r.json() : {configured: false})
  .then(s => {
    icuReady = !!(s && s.configured);
    icuShow(icuReady);
    if (icuReady){ icuSendComments(); setInterval(icuSendComments, 15000); }
  }).catch(() => {});
