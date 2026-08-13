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
  document.getElementById("screen-ride").classList.toggle("hidden", name !== "ride");
  document.getElementById("screen-gear").classList.toggle("hidden", name !== "gear");
  document.querySelectorAll(".tab").forEach(t =>
    t.setAttribute("aria-pressed", t.dataset.screen === name ? "true" : "false"));
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach(t => t.onclick = () => showScreen(t.dataset.screen));
window.addEventListener("hashchange", () => showScreen(location.hash === "#gear" ? "gear" : "ride"));

/* --- List ------------------------------------------------------- */
const escHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");

function renderGear(){
  const tbody = document.querySelector("#geartable tbody");
  tbody.innerHTML = gear.map((it, i) => {
    const flags = [it.short && "SS", it.pack && "pack", it.rainOnly && "rain"].filter(Boolean).join(" · ");
    return `<tr data-i="${i}" class="${it.off ? "gear-off" : ""} ${i === selected ? "gear-sel" : ""}">
      <td><input type="checkbox" class="have" ${it.off ? "" : "checked"} title="In the wardrobe"></td>
      <td class="gname">${escHtml(it.name)}</td>
      <td>${SLOT_LABEL[it.slot] || it.slot}</td>
      <td class="num">${it.tmin} to ${it.tmax}</td>
      <td class="num">${it.clo}</td>
      <td class="num">${it.wind}</td>
      <td class="num">${it.water}</td>
      <td class="flags">${flags}</td>
    </tr>`;
  }).join("");
  document.getElementById("gearcount").textContent =
    `${gear.filter(g => !g.off).length} of ${gear.length} in use`;
  document.getElementById("gearedit").disabled = selected < 0;
  document.getElementById("geardel").disabled = selected < 0;
}

document.getElementById("geartable").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-i]");
  if (!tr) return;
  const i = +tr.dataset.i;
  if (e.target.classList.contains("have")){
    gear[i].off = !e.target.checked;
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
  document.getElementById("gearform").classList.remove("hidden");
  document.getElementById("f-result").classList.add("hidden");
  document.getElementById("f-result").innerHTML = "";
  document.getElementById("f-lookupnote").textContent = "";
  // Add offers the lookup straight away; edit only offers it once something changed.
  F("lookup").classList.toggle("hidden", mode !== "add");
  F("update").classList.add("hidden");
  document.getElementById("f-dirty").textContent = "";
  F("name").focus();
}
function closeForm(){
  formMode = null; editIndex = -1; lastLookup = null; originalItem = null;
  document.getElementById("gearform").classList.add("hidden");
}

/* In edit mode, changing anything reveals the Update button — pressing it
   re-runs the lookup against the edited name and slot. */
document.getElementById("gearform").addEventListener("input", () => {
  if (formMode !== "edit" || !originalItem) return;
  const changed = JSON.stringify(readForm()) !== originalItem;
  F("update").classList.toggle("hidden", !changed);
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
    <div class="lookupres">
      <div class="lookuphead">
        <strong>Found</strong>
        <span class="badge badge-${d.confidence}">${d.confidence} confidence</span>
        <span class="hint">via ${escHtml(d.source)}</span>
      </div>

      <table class="cmp">
        <thead><tr><th>Property</th><th class="num">Yours</th><th class="num">Found</th><th>Use</th></tr></thead>
        <tbody>
          ${rows.map(([k,label,mine,found]) => `
            <tr>
              <td>${label}</td>
              <td class="num">${mine}</td>
              <td class="num ${found !== mine ? "changed" : ""}">${found}</td>
              <td><input type="checkbox" class="use" data-k="${k}" ${found !== mine ? "checked" : ""}></td>
            </tr>`).join("")}
          <tr>
            <td>Range °C${d.rangeQuoted ? "" : " <span class='hint'>(derived, not quoted)</span>"}</td>
            <td class="num">${cur.tmin} to ${cur.tmax}</td>
            <td class="num ${rangeDiffers ? "changed" : ""}">${d.tmin} to ${d.tmax}</td>
            <!-- Left unticked on purpose: a maker's air-temperature claim is weaker
                 evidence than the rider's own ride-feel calibration. -->
            <td><input type="checkbox" class="use" data-k="range"></td>
          </tr>
        </tbody>
      </table>

      ${d.rangeQuoted ? `<p class="hint" style="margin:10px 0 0">
        That range is the maker's own claim, in air temperature. Yours is ride-feel and runs a few
        degrees colder because you run hot — keep yours unless you've no better evidence.</p>` : ""}

      <details style="margin-top:12px" open>
        <summary>What this was based on</summary>
        <ul class="plain">${d.evidence.map(e => `<li>${escHtml(e)}</li>`).join("")}</ul>
        ${d.sources && d.sources.length ? `<p class="hint" style="margin-top:10px">Read: ${
          d.sources.map(u => `<a href="${escHtml(u)}" target="_blank" rel="noreferrer">${escHtml(new URL(u).hostname)}</a>`).join(", ")
        }</p>` : ""}
      </details>

      <div class="gearbar" style="margin-top:12px">
        <button id="f-apply" class="primary-sm">Apply selected</button>
        <button id="f-discard">Discard</button>
      </div>
    </div>`;
  box.classList.remove("hidden");

  document.getElementById("f-apply").onclick = () => {
    box.querySelectorAll(".use").forEach(cb => {
      if (!cb.checked) return;
      const k = cb.dataset.k;
      if (k === "range"){ F("tmin").value = d.tmin; F("tmax").value = d.tmax; }
      else F(k).value = d[k];
    });
    if (d.short) F("short").checked = true;
    if (d.pack) F("pack").checked = true;
    box.classList.add("hidden");
    document.getElementById("gearform").dispatchEvent(new Event("input", {bubbles:true}));
  };
  document.getElementById("f-discard").onclick = () => box.classList.add("hidden");
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
