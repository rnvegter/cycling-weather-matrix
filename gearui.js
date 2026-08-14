"use strict";

/* ---------------------------------------------------------------
   The gear screen: browse, add, edit, delete, and look garments up.

   The lookup goes through the local service in server.js, which can reach
   manufacturer pages the browser can't. If that service isn't running — the
   files opened directly, or served by something else — it falls back to the
   same inference engine running here in the page, and says so.
----------------------------------------------------------------*/

let selected = -1;          // index into gear[], -1 for nothing selected
let formMode = null;        // "add" | "edit" | null
let editIndex = -1;
let lastLookup = null;
let originalItem = null;    // snapshot, to detect edits

/* --- Screens ---------------------------------------------------- */
function showScreen(name){
  document.getElementById("screen-ride").classList.toggle("wx-hidden", name !== "ride");
  document.getElementById("screen-gear").classList.toggle("wx-hidden", name !== "gear");
  document.querySelectorAll(".wx-tab[data-screen]").forEach(t =>
    t.setAttribute("aria-pressed", t.dataset.screen === name ? "true" : "false"));
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);
}
// Only the tabs that name a screen — the glove toggle sits in the same row.
document.querySelectorAll(".wx-tab[data-screen]").forEach(t =>
  t.onclick = () => showScreen(t.dataset.screen));
window.addEventListener("hashchange", () => showScreen(location.hash === "#gear" ? "gear" : "ride"));

/* Glove mode: bigger targets and type. Not an accessibility afterthought —
   it's the intended winter state, so it persists between rides. */
function setGloves(on){
  document.documentElement.dataset.touch = on ? "gloves" : "";
  document.getElementById("gloves").setAttribute("aria-pressed", String(on));
  try{ localStorage.setItem("cwem-gloves", on ? "1" : ""); }catch(e){}
}
document.getElementById("gloves").onclick = () =>
  setGloves(document.documentElement.dataset.touch !== "gloves");
try{ if (localStorage.getItem("cwem-gloves")) setGloves(true); }catch(e){}

/* --- List ------------------------------------------------------- */
const escHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");

function renderGear(){
  const tbody = document.querySelector("#geartable tbody");
  tbody.innerHTML = gear.map((it, i) => {
    const flags = [it.short && "SS", it.pack && "PACK", it.rainOnly && "RAIN"].filter(Boolean).join(" ");
    // The range drawn rather than written: the same band chart as the ride
    // screen, so a hole in the wardrobe shows up as a hole in the column.
    const lo = rampPos(it.tmin), hi = rampPos(it.tmax);
    const mid = (it.tmin + it.tmax) / 2;
    const bar = it.slot === "eyes"
      ? `<div class="wx-bar wx-bar--empty" style="left:0;right:0">any</div>`
      : `<div class="wx-bar" style="left:${lo}%;right:${100 - hi}%"></div>`;
    const inUse = !it.off;
    return `<tr data-i="${i}" class="${rampFor(mid)}${it.off ? " is-off" : ""}${i === selected ? " is-sel" : ""}">
      <td><button class="wx-toggle" data-act="use" aria-pressed="${inUse}"
            title="${inUse ? "Counted in the advice. Click to leave it out." : "Left out of the advice. Click to put it back."}"
          >${inUse ? "In" : "Out"}</button></td>
      <td class="wx-item">${escHtml(it.name)}</td>
      <td class="wx-dim">${SLOT_LABEL[it.slot] || it.slot}</td>
      <td><div class="wx-lane" title="${it.tmin} to ${it.tmax}&deg;C">${bar}</div></td>
      <td class="wx-right wx-num">${it.clo}</td>
      <td class="wx-right wx-num">${it.wind}</td>
      <td class="wx-right wx-num">${it.water}</td>
      <td class="wx-flagcell">${flags}</td>
    </tr>`;
  }).join("");

  const using = gear.filter(g => !g.off).length;
  document.getElementById("gearcount").innerHTML =
    `<b class="wx-num">${using}</b> of ${gear.length} counted in the advice`;
  document.getElementById("gearedit").disabled = selected < 0;
  document.getElementById("geardel").disabled = selected < 0;
  document.getElementById("gearall").disabled = using === gear.length;
  document.getElementById("gearnone").disabled = using === 0;
}

/* Bulk in/out. Packing for a trip is the case that needs it: turn everything
   off, then switch on the few things going in the bag. */
document.getElementById("gearall").onclick = () => {
  gear.forEach(g => g.off = false); saveGear(gear); renderGear();
};
document.getElementById("gearnone").onclick = () => {
  gear.forEach(g => g.off = true); saveGear(gear); renderGear();
};

document.getElementById("geartable").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-i]");
  if (!tr) return;
  const i = +tr.dataset.i;
  // In/out is its own control; clicking anywhere else picks the row to edit.
  if (e.target.closest('[data-act="use"]')){
    gear[i].off = !gear[i].off;
    saveGear(gear);
    renderGear();
    return;
  }
  selected = (selected === i) ? -1 : i;
  renderGear();
});

/* --- Form ------------------------------------------------------- */
const F = id => document.getElementById("f-" + id);
const FIELDS = ["name","slot","tmin","tmax","clo","wind","water","short","pack","rainonly","notes"];

(function fillSlots(){
  F("slot").innerHTML = SLOTS.map(([v,l]) => `<option value="${v}">${l}</option>`).join("");
})();

function readForm(){
  return normaliseItem({
    name: F("name").value.trim() || "Unnamed",
    slot: F("slot").value,
    tmin: +F("tmin").value, tmax: +F("tmax").value,
    clo: +F("clo").value, wind: +F("wind").value, water: +F("water").value,
    short: F("short").checked, pack: F("pack").checked, rainOnly: F("rainonly").checked,
    notes: F("notes").value.trim(),
    off: formMode === "edit" ? gear[editIndex].off : false
  });
}
function writeForm(it){
  F("name").value = it.name === "Unnamed" ? "" : it.name;
  F("slot").value = it.slot;
  F("tmin").value = it.tmin; F("tmax").value = it.tmax;
  F("clo").value = it.clo; F("wind").value = it.wind; F("water").value = it.water;
  F("short").checked = it.short; F("pack").checked = it.pack; F("rainonly").checked = it.rainOnly;
  F("notes").value = it.notes;
}

function openForm(mode, index){
  formMode = mode; editIndex = index === undefined ? -1 : index;
  lastLookup = null;
  document.getElementById("formtitle").textContent =
    mode === "add" ? "Add gear" : `Edit — ${gear[editIndex].name}`;
  writeForm(mode === "add"
    ? normaliseItem({name:"", slot:"mid", tmin:5, tmax:15, clo:0.2, wind:0.3, water:0})
    : gear[editIndex]);
  originalItem = JSON.stringify(readForm());
  document.getElementById("gearform").classList.remove("wx-hidden");
  document.getElementById("f-result").classList.add("wx-hidden");
  document.getElementById("f-result").innerHTML = "";
  document.getElementById("f-lookupnote").textContent = "";
  // Add offers the lookup straight away; edit only offers it once something changed.
  F("lookup").classList.toggle("wx-hidden", mode !== "add");
  F("update").classList.add("wx-hidden");
  document.getElementById("f-dirty").textContent = "";
  F("name").focus();
}
function closeForm(){
  formMode = null; editIndex = -1; lastLookup = null; originalItem = null;
  document.getElementById("gearform").classList.add("wx-hidden");
}

/* In edit mode, changing anything reveals the Update button — pressing it
   re-runs the lookup against the edited name and slot. */
document.getElementById("gearform").addEventListener("input", () => {
  if (formMode !== "edit" || !originalItem) return;
  const changed = JSON.stringify(readForm()) !== originalItem;
  F("update").classList.toggle("wx-hidden", !changed);
  document.getElementById("f-dirty").textContent = changed ? "Unsaved changes" : "";
});

document.getElementById("gearadd").onclick = () => openForm("add");
document.getElementById("gearedit").onclick = () => { if (selected >= 0) openForm("edit", selected); };
document.getElementById("geardel").onclick = () => {
  if (selected < 0) return;
  if (!confirm(`Remove ${gear[selected].name} from your gear?`)) return;
  gear.splice(selected, 1); selected = -1; saveGear(gear); renderGear(); closeForm();
};
F("cancel").onclick = closeForm;
F("save").onclick = () => {
  const it = readForm();
  if (it.name === "Unnamed"){ F("name").focus(); return; }
  if (formMode === "add"){ gear.push(it); selected = gear.length - 1; }
  else gear[editIndex] = it;
  saveGear(gear); renderGear(); closeForm();
};

/* --- Lookup ----------------------------------------------------- */
async function runLookup(){
  const name = F("name").value.trim();
  const slot = F("slot").value;
  const note = document.getElementById("f-lookupnote");
  if (!name){ note.textContent = "Give it a name first."; F("name").focus(); return; }

  [F("lookup"), F("update")].forEach(b => b.disabled = true);
  note.textContent = "Searching manufacturer and retailer pages…";
  let data = null, why = "lookup service not reachable";
  try{
    // Relative, so the app works when mounted under a sub-path as well as at root.
    const endpoint = new URL("api/lookup", location.href.replace(/[^/]*$/, ""));
    endpoint.searchParams.set("name", name);
    endpoint.searchParams.set("slot", slot);
    const r = await fetch(endpoint);
    if (r.ok) data = await r.json();
    else if (r.status === 429) why = "rate limited — wait a minute";
    else why = `lookup service returned ${r.status}`;
  }catch(e){ /* service not running — fall through */ }

  if (!data || data.error){
    const detail = data && data.error ? data.error : why;
    data = inferGarment({name, slot});
    data.source = `inference (${detail})`;
    data.sources = [];
    data.evidence.push(`Nothing was read from the web (${detail}), so these come from the garment name and fabric words alone. Check them against how it actually wears.`);
  }
  lastLookup = data;
  note.textContent = "";
  [F("lookup"), F("update")].forEach(b => b.disabled = false);
  renderLookup(data);
}
F("lookup").onclick = runLookup;
F("update").onclick = runLookup;

function renderLookup(d){
  const box = document.getElementById("f-result");
  const cur = readForm();
  const rows = [
    ["clo",   "clo",   cur.clo,   d.clo],
    ["wind",  "Wind",  cur.wind,  d.wind],
    ["water", "Water", cur.water, d.water]
  ];
  const rangeDiffers = d.tmin !== cur.tmin || d.tmax !== cur.tmax;

  box.innerHTML = `
    <div class="wx-found ${rampFor((d.tmin + d.tmax) / 2)}">
      <div class="wx-found__head">
        <span class="wx-eyebrow" style="margin:0">Found</span>
        <span class="wx-badge wx-badge--${d.confidence}">${d.confidence}</span>
        <span class="wx-note" style="margin:0">via ${escHtml(d.source)}</span>
      </div>

      <table class="wx-table wx-cmp">
        <thead><tr><th>Property</th><th class="wx-right">Yours</th><th class="wx-right">Found</th><th>Use</th></tr></thead>
        <tbody>
          ${rows.map(([k, label, mine, found]) => `
            <tr>
              <td>${label}</td>
              <td class="wx-right wx-num">${mine}</td>
              <td class="wx-right wx-num ${found !== mine ? "wx-new" : ""}">${found}</td>
              <td><input type="checkbox" class="use" data-k="${k}" ${found !== mine ? "checked" : ""}></td>
            </tr>`).join("")}
          <tr>
            <td>Range${d.rangeQuoted ? "" : " <span class='wx-dim'>(derived)</span>"}</td>
            <td class="wx-right wx-num">${cur.tmin} to ${cur.tmax}</td>
            <td class="wx-right wx-num ${rangeDiffers ? "wx-new" : ""}">${d.tmin} to ${d.tmax}</td>
            <!-- Left unticked on purpose: a maker's air-temperature claim is weaker
                 evidence than the rider's own ride-feel calibration. -->
            <td><input type="checkbox" class="use" data-k="range"></td>
          </tr>
        </tbody>
      </table>

      ${d.rangeQuoted ? `<p class="wx-note">That range is the maker's claim, in air temperature.
        Yours is ride-feel and runs colder because you run hot — keep yours unless you have
        better evidence.</p>` : ""}

      <details class="wx-more" open>
        <summary>What this was based on</summary>
        <ul class="wx-why">${d.evidence.map(e => `<li>${escHtml(e)}</li>`).join("")}</ul>
        ${d.sources && d.sources.length ? `<p class="wx-note">Read: ${
          d.sources.map(u => `<a href="${escHtml(u)}" target="_blank" rel="noreferrer">${escHtml(new URL(u).hostname)}</a>`).join(", ")
        }</p>` : ""}
      </details>

      <div class="wx-bar-row">
        <button id="f-apply" class="wx-btn wx-btn--primary">Apply ticked</button>
        <button id="f-discard" class="wx-btn wx-btn--quiet">Discard</button>
      </div>
    </div>`;
  box.classList.remove("wx-hidden");

  document.getElementById("f-apply").onclick = () => {
    box.querySelectorAll(".use").forEach(cb => {
      if (!cb.checked) return;
      const k = cb.dataset.k;
      if (k === "range"){ F("tmin").value = d.tmin; F("tmax").value = d.tmax; }
      else F(k).value = d[k];
    });
    if (d.short) F("short").checked = true;
    if (d.pack) F("pack").checked = true;
    box.classList.add("wx-hidden");
    document.getElementById("gearform").dispatchEvent(new Event("input", {bubbles:true}));
  };
  document.getElementById("f-discard").onclick = () => box.classList.add("wx-hidden");
}

/* --- Import / export / reset ------------------------------------ */
document.getElementById("gearexport").onclick = () => {
  const blob = new Blob([JSON.stringify(gear, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "cycling-gear.json"; a.click();
  URL.revokeObjectURL(a.href);
};
document.getElementById("gearimport").onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try{
      const parsed = JSON.parse(fr.result);
      if (!Array.isArray(parsed)) throw new Error("Expected a list of items");
      gear = parsed.map(normaliseItem); selected = -1; saveGear(gear); renderGear(); closeForm();
    }catch(err){ alert("Couldn't read that file: " + err.message); }
  };
  fr.readAsText(file);
  e.target.value = "";
};
document.getElementById("gearreset").onclick = () => {
  if (!confirm("Replace your edits with the original inventory?")) return;
  gear = resetGear(); selected = -1; renderGear(); closeForm();
};

renderGear();
showScreen(location.hash === "#gear" ? "gear" : "ride");
