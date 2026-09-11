"use strict";

/* ---------------------------------------------------------------
   The Favourites tab, and the Save as favourite button on the Ride tab.

   Ride now fills in the Ride tab — route, start point, surface, speed — and
   stops there. The date and start time are left as they are, because the day
   you mean to ride is the one thing a favourite cannot know, and advice for
   the wrong morning is worse than a second click.
----------------------------------------------------------------*/

let favEditing = null;              // id of the favourite being edited
let favStatusTimer = null;

const FAV_TYPE_LABEL = {road: "Road", gravel: "Gravel", mtb: "MTB"};

function favStatus(msg, isErr){
  const el = document.getElementById("favstatus");
  if (!el) return;
  el.className = msg ? ("wx-status" + (isErr ? " wx-status--err" : "")) : "wx-status wx-hidden";
  el.textContent = msg || "";
  clearTimeout(favStatusTimer);
  if (msg) favStatusTimer = setTimeout(() => {
    el.className = "wx-status wx-hidden"; el.textContent = "";
  }, 9000);
}

const favWhen = iso => new Date(iso).toLocaleDateString(undefined, {day: "numeric", month: "short"});
const favSize = bytes => bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
const favNameFromFile = name => String(name || "Route").replace(/\.gpx$/i, "");

/* The route's shape, drawn from its own points rather than from map tiles. A
   favourite you pick out by its outline needs nothing from the network, and a
   list of map thumbnails would fetch several tiles apiece from
   OpenStreetMap, whose usage policy that would lean on. North is up; east-west
   is scaled by the cosine of the latitude so the shape is not stretched. */
function routeOutline(fav, stats){
  const pts = fav.points;
  const W = 96, H = 72, PAD = 7;
  const k = Math.cos(pts.reduce((s, p) => s + p[0], 0) / pts.length * Math.PI / 180);
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = (maxX - minX) || 1e-9, h = (maxY - minY) || 1e-9;
  const s = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h);
  const ox = (W - w * s) / 2, oy = (H - h * s) / 2;
  const X = i => ((xs[i] - minX) * s + ox).toFixed(1);
  const Y = i => ((ys[i] - minY) * s + oy).toFixed(1);

  // An outline, not a map: a couple of hundred vertices is plenty.
  const step = Math.max(1, Math.ceil(pts.length / 240));
  let d = "";
  for (let i = 0; i < pts.length; i += step) d += (d ? "L" : "M") + X(i) + " " + Y(i);
  const last = pts.length - 1;
  d += "L" + X(last) + " " + Y(last);

  return `<svg class="wx-fav__map" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Outline of the route, ${stats.loop ? "a loop" : "point to point"}">
    <path class="wx-fav__line" d="${d}"/>
    ${stats.loop ? "" : `<circle class="wx-fav__end" cx="${X(last)}" cy="${Y(last)}" r="3"/>`}
    <circle class="wx-fav__start" cx="${X(0)}" cy="${Y(0)}" r="3.4"/>
  </svg>`;
}

function favSpeedText(fav){
  if (fav.speed == null) return "speed from the Ride tab";
  return `${r1(fav.speed)} km/h` + (fav.speedFrom === "recording" ? " from the recording" : "");
}

function favCard(fav){
  const st = favouriteStats(fav);
  const id = escHtml(fav.id);
  const editing = favEditing === fav.id;

  const text = editing ? `
      <label class="wx-fav__field">
        <span class="wx-label">Name</span>
        <input class="wx-input" data-field="name" type="text" maxlength="80" value="${escHtml(fav.name)}">
      </label>
      <div class="wx-fav__field">
        <span class="wx-label">Surface</span>
        <div class="wx-choice wx-choice--tight" data-favtype>
          ${Object.keys(FAV_TYPE_LABEL).map(t => `<button type="button" class="wx-chip" data-v="${t}"
              aria-pressed="${t === fav.type}">${FAV_TYPE_LABEL[t]}</button>`).join("")}
        </div>
      </div>
      <label class="wx-fav__field">
        <span class="wx-label">Usual speed, km/h</span>
        <input class="wx-input wx-fav__speed" data-field="speed" type="number" min="3" max="80"
               step="0.5" inputmode="decimal" value="${fav.speed == null ? "" : fav.speed}"
               placeholder="Ride tab's">
      </label>
      <p class="wx-note" style="margin:0">Leave the speed empty to use the Ride tab's assumption for
        the surface and pace.${fav.speedFrom === "recording"
          ? ` ${r1(fav.speed)} came from the recording.` : ""}</p>`
    : `
      <h3 class="wx-fav__name">${escHtml(fav.name)}</h3>
      <p class="wx-fav__meta">${r1(st.distance)} km${st.hasElevation ? ` · ${Math.round(st.ascent)} m up` : ""}
        · ${st.loop ? "loop" : "point to point"}</p>
      <p class="wx-fav__meta">${FAV_TYPE_LABEL[fav.type]} · ${favSpeedText(fav)}${
        fav.lastRiddenAt ? ` · last used ${favWhen(fav.lastRiddenAt)}` : ""}</p>`;

  const foot = editing ? `
      <button class="wx-btn wx-btn--primary" data-favsave="${id}">Save</button>
      <button class="wx-btn wx-btn--quiet" data-favcancel="${id}">Cancel</button>`
    : `
      <button class="wx-btn wx-btn--primary" data-ridenow="${id}">Ride now</button>
      <span class="wx-spacer"></span>
      <button class="wx-linkbtn" data-favedit="${id}">Edit</button>
      <button class="wx-linkbtn wx-linkbtn--warn" data-favdel="${id}">Delete</button>`;

  return `
    <article class="wx-fav${editing ? " is-editing" : ""}" data-id="${id}">
      <div class="wx-fav__body">
        ${routeOutline(fav, st)}
        <div class="wx-fav__text">${text}</div>
      </div>
      <div class="wx-fav__foot">${foot}</div>
    </article>`;
}

function renderFavourites(){
  const el = document.getElementById("favlist");
  if (!el) return;
  const list = loadFavourites();
  const count = document.getElementById("favcount");
  if (count) count.textContent = list.length
    ? `${list.length} favourite${list.length === 1 ? "" : "s"}` : "";
  const size = document.getElementById("favsize");
  if (size) size.textContent = list.length ? `${favSize(favouritesBytes(list))} in this browser` : "";

  if (!list.length){
    el.innerHTML = `<p class="wx-empty">No favourites yet. <b>Add from GPX</b> takes a route file or a
      recorded ride — or load one on the Ride tab and press <b>Save as favourite</b>.</p>`;
    return;
  }
  el.innerHTML = favouritesInOrder(list).map(favCard).join("");
  const input = el.querySelector(".is-editing [data-field=name]");
  if (input) input.focus();
}

/* --- Ride now ----------------------------------------------------- */

function rideNow(id){
  const fav = loadFavourites().find(f => f.id === id);
  if (!fav) return;
  try{
    useRoute(favouriteAsParsed(fav), {movePlace: true});
  }catch(e){ favStatus(e.message, true); return; }
  route.favId = fav.id;
  refreshFavButton();

  state.type = fav.type;
  syncPills();
  save();
  /* Distance and time together decide the speed, so a duration left over from
     the last ride would quietly override this one's. It goes; the speed is the
     favourite's, or empty for the Ride tab's own assumption. */
  $("#dur").value = "";
  $("#speed").value = fav.speed == null ? "" : fav.speed;
  updateSpeedHint();

  try{ updateFavourite(fav.id, {lastRiddenAt: new Date().toISOString()}); }catch(e){}

  showScreen("ride");
  status(`${fav.name} is loaded. Set the date and start time, then press Read the weather.`);
}

/* --- The list's buttons ------------------------------------------- */

document.getElementById("favlist").addEventListener("click", e => {
  const chip = e.target.closest("[data-favtype] .wx-chip");
  if (chip){
    chip.parentElement.querySelectorAll(".wx-chip").forEach(c =>
      c.setAttribute("aria-pressed", String(c === chip)));
    return;
  }

  const go = e.target.closest("[data-ridenow]");
  if (go){ rideNow(go.dataset.ridenow); return; }

  const edit = e.target.closest("[data-favedit]");
  if (edit){ favEditing = edit.dataset.favedit; renderFavourites(); return; }

  if (e.target.closest("[data-favcancel]")){ favEditing = null; renderFavourites(); return; }

  const saveBtn = e.target.closest("[data-favsave]");
  if (saveBtn){ saveFavouriteEdit(saveBtn.dataset.favsave); return; }

  const del = e.target.closest("[data-favdel]");
  if (del){
    const fav = loadFavourites().find(f => f.id === del.dataset.favdel);
    if (!fav || !confirm(`Delete ${fav.name}?`)) return;
    try{
      deleteFavourite(fav.id);
      if (favEditing === fav.id) favEditing = null;
      renderFavourites();
      refreshFavButton();
      favStatus(`Deleted ${fav.name}.`);
    }catch(err){ favStatus(err.message, true); }
  }
});

// Enter saves and Escape cancels, as they would in any other form.
document.getElementById("favlist").addEventListener("keydown", e => {
  if (!favEditing || !e.target.matches(".is-editing input")) return;
  if (e.key === "Enter"){ e.preventDefault(); saveFavouriteEdit(favEditing); }
  if (e.key === "Escape"){ favEditing = null; renderFavourites(); }
});

function saveFavouriteEdit(id){
  const card = [...document.querySelectorAll("#favlist .wx-fav")].find(c => c.dataset.id === id);
  const fav = loadFavourites().find(f => f.id === id);
  if (!card || !fav) return;

  const name = card.querySelector("[data-field=name]").value.trim();
  const pressed = card.querySelector("[data-favtype] .wx-chip[aria-pressed=true]");
  const raw = card.querySelector("[data-field=speed]").value.trim();
  const speed = raw === "" ? null : parseFloat(raw);
  if (!name) return favStatus("Give it a name.", true);
  if (raw !== "" && !(speed >= 3 && speed <= 80))
    return favStatus("A speed between 3 and 80 km/h, or leave it empty.", true);

  const patch = {name, type: pressed ? pressed.dataset.v : fav.type};
  // Touching the speed makes it yours; leaving it alone keeps where it came from.
  if (speed !== fav.speed) Object.assign(patch, {speed, speedFrom: "typed"});

  try{
    updateFavourite(id, patch);
    favEditing = null;
    renderFavourites();
    refreshFavButton();
    favStatus(`Saved ${name}.`);
  }catch(err){ favStatus(err.message, true); }
}

/* --- Adding from GPX files ----------------------------------------- */

document.getElementById("favgpx").onchange = async e => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;

  const added = [], already = [], failed = [];
  for (const file of files){
    try{
      const parsed = parseGPX(await file.text());
      if (!(routeStats(parsed.points).distance > 0.5))
        throw new Error("shorter than half a kilometre");
      const fav = favouriteFromParsed(parsed, {
        name: parsed.name || favNameFromFile(file.name),
        type: state.type,
        fileName: file.name
      });
      const r = addFavourite(fav);
      if (r.added) added.push(r.fav); else already.push(r.existing.name);
    }catch(err){
      failed.push(`${file.name} (${String(err.message).replace(/\.$/, "")})`);
      // A full browser will refuse the rest as well; say so once, not per file.
      if (/no room left/.test(err.message)) break;
    }
  }

  renderFavourites();
  refreshFavButton();
  const bits = [];
  if (added.length === 1){
    const f = added[0];
    bits.push(`Added ${f.name} as ${FAV_TYPE_LABEL[f.type].toLowerCase()}`
      + (f.speedFrom === "recording" ? `, ${r1(f.speed)} km/h from the recording` : "")
      + ". Edit changes either.");
  } else if (added.length){
    bits.push(`Added ${added.length}: ${added.map(f => f.name).join(", ")}.`);
  }
  if (already.length) bits.push(`Already a favourite: ${already.join(", ")}.`);
  if (failed.length) bits.push(`Could not add ${failed.join("; ")}.`);
  favStatus(bits.join(" "), !added.length && (failed.length > 0));
};

/* --- Save as favourite, on the Ride tab ---------------------------- */

function refreshFavButton(){
  const b = document.getElementById("gpxfav");
  if (!b) return;
  if (!route){ b.classList.add("wx-hidden"); return; }
  b.classList.remove("wx-hidden");
  const list = loadFavourites();
  const kept = (route.favId && list.find(f => f.id === route.favId))
            || findFavouriteLike(route.points, list);
  b.disabled = !!kept;
  b.textContent = kept ? "In favourites" : "Save as favourite";
  b.title = kept ? `Kept as “${kept.name}”` : "";
}

document.getElementById("gpxfav").onclick = () => {
  if (!route) return;
  /* A recording brings its own speed — favouriteFromParsed reads it off the
     timestamps. Otherwise keep a speed you gave the Ride tab, typed or worked
     out from distance and time, but not the tab's own guess: frozen into the
     favourite, that would stop following the surface and pace you pick. */
  const n = rideNumbers();
  const speed = !route.recorded && (n.source === "typed" || n.source === "measured")
    ? n.speed : null;
  try{
    const fav = favouriteFromParsed(
      {name: route.name, points: route.points, recorded: route.recorded},
      {name: route.name || favNameFromFile(route.fileName), type: state.type,
       speed, fileName: route.fileName || null});
    const r = addFavourite(fav);
    if (r.added) route.favId = r.fav.id;
    status(r.added ? `Saved ${r.fav.name} to Favourites.`
                   : `That route is already a favourite, as ${r.existing.name}.`);
  }catch(err){ status(err.message, true); }
  refreshFavButton();
};
