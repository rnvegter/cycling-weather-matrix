"use strict";

/* ---------------------------------------------------------------
   The history screen.

   A list of rides, newest first, split by the only distinction that matters
   here: whether it has happened yet. A ride in the future is waiting; a ride
   in the past is a question the calibration needs answered.
----------------------------------------------------------------*/

let histFilter = "all";

const RIDE_DATE = iso => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, {weekday:"short", day:"numeric", month:"short"})
       + " · " + d.toTimeString().slice(0,5);
};

function renderHistory(){
  const list = loadHistory();
  const now = Date.now();
  const rows = historyNewestFirst(list).filter(e => {
    if (histFilter === "rated") return e.delta != null;
    if (histFilter === "unrated") return e.delta == null && isRidden(e, now);
    return true;
  });

  const rated = ratedRides(list).length;
  document.getElementById("histcount").textContent =
    `${list.length} ride${list.length === 1 ? "" : "s"} · ${rated} rated`;

  const off = learnedOffset(list, {wet:false});
  const learnedEl = document.getElementById("histlearned");
  if (!list.length){
    learnedEl.textContent = "";
  } else if (!off.ready){
    learnedEl.textContent =
      `${rated} rated so far. ${MIN_RIDES - rated} more before the correction starts applying — `
      + "one cold morning shouldn't rewrite the model.";
  } else {
    const wetOff = learnedOffset(list, {wet:true});
    const sign = v => (v > 0 ? "+" : "") + (Math.round(v * 10) / 10);
    learnedEl.innerHTML =
      `Currently applying <b class="wx-num">${sign(off.value)}&deg;C</b> on top of your rider setting`
      + (wetOff.basis === "wet" && Math.abs(wetOff.value - off.value) >= 0.5
          ? `, and <b class="wx-num">${sign(wetOff.value)}&deg;C</b> when it's wet — you run differently in the rain.`
          : ".");
  }

  const el = document.getElementById("histlist");
  if (!rows.length){
    el.innerHTML = `<p class="wx-empty">${
      list.length ? "Nothing matches that filter." :
      "No rides yet. Work one out on the Ride tab and it will be kept here."}</p>`;
    return;
  }

  el.innerHTML = rows.map(e => {
    const ridden = isRidden(e, now);
    const v = e.verdict ? verdictById(e.verdict) : null;
    const kit = (e.kit || []).slice(0, 4).join(", ")
      + ((e.kit || []).length > 4 ? `, +${e.kit.length - 4} more` : "");
    return `
    <article class="wx-ride ${e.feel != null ? rampFor(e.feel) : ""}${v ? " is-rated" : ""}" data-id="${escHtml(e.id)}">
      <div class="wx-ride__head">
        <div>
          <p class="wx-ride__when">${RIDE_DATE(e.startISO)}</p>
          <p class="wx-ride__where">${escHtml(e.place || "—")}${
            e.routeName ? ` · ${escHtml(e.routeName)}` : ""}</p>
        </div>
        <div class="wx-ride__feel">
          ${e.feel != null ? `<span class="wx-num">${e.feel}</span><small>&deg;C felt</small>` : ""}
        </div>
      </div>

      <p class="wx-ride__meta">
        ${e.air != null ? `${e.air}&deg; air` : ""}${e.wet ? " · wet" : ""}${
          e.dist ? ` · ${e.dist} km` : ""}${e.rider ? ` · runs ${e.rider}` : ""}${
          e.legacy ? " · rated before history existed" : ""}
      </p>
      ${kit ? `<p class="wx-ride__kit">${escHtml(kit)}</p>` : ""}

      ${e.actual ? (() => {
        const eff = speedFeelEffect(e);
        const faster = e.actual.speed > (e.speed || 0);
        return `<div class="wx-actual">
          <p class="wx-actual__line"><b>Rode</b> ${e.actual.distance} km in
            ${hoursToClock(e.actual.movingH)} moving${
              e.actual.elapsedH - e.actual.movingH > 0.08
                ? ` (${hoursToClock(e.actual.elapsedH)} elapsed)` : ""} —
            <b class="wx-num">${e.actual.speed} km/h</b>${
              e.speed ? `, against the ${e.speed} assumed` : ""}.</p>
          ${eff ? `<p class="wx-actual__note">Riding ${faster ? "faster" : "slower"} than
            assumed made it <b>${eff > 0 ? "+" : ""}${eff}&deg;C</b> ${
            eff > 0 ? "warmer" : "colder"} than the forecast said, and that much of any
            mismatch was the speed guess rather than you.</p>` : ""}
        </div>`;
      })() : ""}

      <div class="wx-ride__foot">
        ${v
          ? `<span class="wx-verdict-set">Rated <b>${v.label.toLowerCase()}</b></span>
             <button class="wx-linkbtn" data-unrate="${escHtml(e.id)}">Change</button>`
          : ridden
            ? `<div class="wx-choice wx-choice--tight">
                 ${VERDICTS.map(x => `<button class="wx-chip" data-rate="${escHtml(e.id)}"
                    data-verdict="${x.id}">${x.label}</button>`).join("")}
               </div>`
            : `<span class="wx-waiting">Not ridden yet</span>`}
        <span class="wx-spacer"></span>
        ${ridden ? (e.actual
          ? `<button class="wx-linkbtn" data-detach="${escHtml(e.id)}">Remove ride file</button>`
          : `<label class="wx-linkbtn" for="act-${escHtml(e.id)}">Attach ride file</label>
             <input type="file" class="wx-hidden" id="act-${escHtml(e.id)}"
               accept=".gpx,application/gpx+xml,text/xml" data-attach="${escHtml(e.id)}">`) : ""}
        <button class="wx-linkbtn wx-linkbtn--warn" data-del="${escHtml(e.id)}">Delete</button>
      </div>
    </article>`;
  }).join("");
}

/* --- Events ----------------------------------------------------- */

document.getElementById("histlist").addEventListener("click", e => {
  const rate = e.target.closest("[data-rate]");
  if (rate){
    rateRide(rate.dataset.rate, rate.dataset.verdict);
    renderHistory();
    return;
  }
  const un = e.target.closest("[data-unrate]");
  if (un){ unrateRide(un.dataset.unrate); renderHistory(); return; }

  const detach = e.target.closest("[data-detach]");
  if (detach){ detachActual(detach.dataset.detach); renderHistory(); return; }

  const del = e.target.closest("[data-del]");
  if (del){
    const entry = loadHistory().find(x => x.id === del.dataset.del);
    const what = entry ? `${RIDE_DATE(entry.startISO)}, ${entry.place}` : "this ride";
    if (!confirm(`Delete ${what}?` + (entry && entry.delta != null
      ? "\n\nIt has been rated, so removing it also removes what it taught the model." : ""))) return;
    deleteRide(del.dataset.del);
    renderHistory();
  }
});

/* Attaching a recorded ride. Delegated, because the inputs are rebuilt with
   the list on every render. */
document.getElementById("histlist").addEventListener("change", e => {
  const input = e.target.closest("[data-attach]");
  if (!input || !input.files[0]) return;
  const id = input.dataset.attach, file = input.files[0];
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const parsed = parseGPX(fr.result);
      if (!parsed.recorded)
        throw new Error("That file has no timestamps, so it is a planned route rather than a recorded ride. Export the activity itself.");
      const stats = activityStats(parsed.points);
      if (!stats) throw new Error("Couldn't read a distance and a time from that file.");
      attachActual(id, stats, file.name);
      renderHistory();
      histStatus(`Attached ${stats.distance} km at ${stats.speed} km/h.`);
    }catch(err){ histStatus(err.message, true); }
  };
  fr.onerror = () => histStatus("Couldn't read that file.", true);
  fr.readAsText(file);
  input.value = "";
});

document.getElementById("histfilter").addEventListener("click", e => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  histFilter = b.dataset.filter;
  document.querySelectorAll("#histfilter .wx-chip").forEach(c =>
    c.setAttribute("aria-pressed", c === b ? "true" : "false"));
  renderHistory();
});

/* A short-lived note under the toolbar. */
let histStatusTimer = null;
function histStatus(msg, isErr){
  const el = document.getElementById("histstatus");
  el.className = msg ? ("wx-status" + (isErr ? " wx-status--err" : "")) : "wx-status wx-hidden";
  el.textContent = msg || "";
  clearTimeout(histStatusTimer);
  if (msg) histStatusTimer = setTimeout(() => {
    el.className = "wx-status wx-hidden"; el.textContent = "";
  }, 9000);
}

document.getElementById("histexport").onclick = () => {
  const list = loadHistory();
  if (!list.length) return histStatus("Nothing to export yet.", true);
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([exportHistory()], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cycling-rides-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  const rated = ratedRides(list).length;
  histStatus(`Exported ${list.length} ride${list.length === 1 ? "" : "s"}, ${rated} of them rated.`);
};

document.getElementById("histimport").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const r = importHistory(fr.result);
      renderHistory();
      const bits = [];
      if (r.added) bits.push(`${r.added} added`);
      if (r.updated) bits.push(`${r.updated} updated with a rating`);
      if (r.unchanged) bits.push(`${r.unchanged} already here`);
      histStatus(`Merged: ${bits.join(", ") || "nothing new"}. ${r.total} rides in total.`);
    }catch(err){
      histStatus(err.message, true);
    }
  };
  fr.onerror = () => histStatus("Couldn't read that file.", true);
  fr.readAsText(file);
  e.target.value = "";
};

document.getElementById("histclear").onclick = () => {
  const rated = ratedRides(loadHistory()).length;
  if (!confirm("Delete every ride in the history?"
      + (rated ? `\n\n${rated} of them are rated, so the learned correction goes back to zero.` : ""))) return;
  clearHistory();
  renderHistory();
};

renderHistory();
