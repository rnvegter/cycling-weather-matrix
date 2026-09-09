"use strict";

/* ---------------------------------------------------------------
   The backup screen.

   Two things kept here cannot be regenerated: the gear list, which is your own
   calibration of every garment you own, and the ride history, which is the
   only record of how the model has actually done. localStorage is one cleared
   site-data away from losing both, and state.prev.json is a single step of
   insurance -- the wrong thing entirely when what you want is the gear list as
   it stood in March.

   So: dated versions, in a directory of their own, with a schedule that can
   write them without anyone being at the keyboard.

   It degrades the way the rest of the app does. With a server there is a list
   of versions to restore from and a schedule that runs whether or not a tab is
   open. With no server -- the files opened directly, a static deployment --
   the two things that never needed one still work: downloading a copy, and
   restoring from a file you downloaded earlier. The page says which of those
   two situations you are in rather than showing dead buttons.
----------------------------------------------------------------*/

const BACKUP_LIST_URL = new URL("api/backups", location.href.replace(/[^/]*$/, "")).toString();
const BACKUP_ONE_URL  = new URL("api/backup",  location.href.replace(/[^/]*$/, "")).toString();

let backupServer = null;      // null = not asked yet, false = no server
let backupState = {backups: [], schedule: null, dir: null};
let backupBusy = false;

const bkStatus = (msg, bad) => {
  const el = document.getElementById("bkstatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("is-error", !!bad);
};

const bkWhen = iso => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, {day:"numeric", month:"short", year:"numeric"})
       + " · " + d.toTimeString().slice(0, 5);
};
/* "1 gear items" is the sort of thing that makes a page look unfinished. */
const bkCount = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const bkSize = n => (n >= 1024 * 1024
  ? `${(n / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(n / 1024))} kB`);

/* Why a version exists, in the words a reader would use. "pre-restore" is the
   one worth spelling out: it is the copy taken of what you had a moment before
   you replaced it, and it is the reason a restore is not a one-way door. */
const BK_REASON = {
  manual: "You asked for it",
  scheduled: "On schedule",
  "pre-restore": "Taken just before a restore"
};

/* --- The document this app backs up ------------------------------
   Built from the same localDocument() the sync uses, so a file downloaded with
   no server in sight holds exactly what a server-side version would. */
function backupEnvelope(){
  return {
    app: "cycling-weather-matrix", version: 1,
    backupAt: new Date().toISOString(), reason: "manual",
    state: typeof localDocument === "function"
      ? localDocument()
      : {gear: loadGear(), history: loadHistory(), updatedAt: new Date().toISOString()}
  };
}

/* Anything about to overwrite the gear list and every ride is checked first.
   A half-applied restore is worse than a refused one, so this insists on the
   envelope rather than accepting any JSON with the right-looking keys. */
function validEnvelope(doc){
  if (!doc || typeof doc !== "object") return "That file is not JSON this app wrote.";
  const st = doc.state;
  if (!st || typeof st !== "object") return "That file has no state in it.";
  if (!Array.isArray(st.gear) && !Array.isArray(st.history))
    return "That file holds neither gear nor rides.";
  return null;
}

/* Replace, not merge, and that is the whole difference between a restore and
   an import. Import exists for bringing another browser's rides in alongside
   your own; restore is for putting back what you had. Merging here would make
   it impossible to undo a bad afternoon of edits, which is the main thing
   anyone ever wants a backup for.

   The gear stamp is set to NOW rather than to the backup's own, so the restored
   list wins the next sync against a device still holding the newer one it
   replaced. Stamping it with the backup's older time would have the thing you
   just undid quietly come back. */
function applyRestore(state){
  let rides = 0, items = 0;
  if (Array.isArray(state.history)){ saveHistory(state.history); rides = state.history.length; }
  if (Array.isArray(state.gear)){
    gear = state.gear.map(typeof normaliseItem === "function" ? normaliseItem : (x => x));
    saveGear(gear);
    items = gear.length;
    if (typeof setGearStamp === "function") setGearStamp(new Date().toISOString());
  }
  ["renderGear", "renderHistory", "renderScorecard"].forEach(fn => {
    if (typeof window[fn] === "function") window[fn]();
  });
  return {rides, items};
}

/* --- Talking to the server --------------------------------------- */

async function backupGet(){
  const r = await fetch(BACKUP_LIST_URL, {method: "GET", cache: "no-store"});
  if (!r.ok) throw new Error(`server said ${r.status}`);
  return r.json();
}

async function backupPost(body){
  const r = await fetch(BACKUP_LIST_URL, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body)
  });
  const doc = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(doc.error || `server said ${r.status}`);
  return doc;
}

async function refreshBackups(quiet){
  try{
    const doc = await backupGet();
    backupServer = true;
    backupState = doc;
  }catch(e){
    // No endpoint is the normal case for a static deployment, not a failure.
    backupServer = false;
  }
  renderBackup();
  if (!quiet && backupServer === false)
    bkStatus("No server here, so versions are not being kept. Downloading a copy still works.");
}

/* --- Actions ----------------------------------------------------- */

async function backupNow(){
  if (backupBusy) return;
  backupBusy = true;
  bkStatus("Backing up…");
  try{
    /* Push whatever this browser is holding first. The server backs up its own
       copy of the document, so without this a backup taken seconds after an
       edit would quietly miss it. */
    if (typeof syncPush === "function") await syncPush(true);
    const doc = await backupPost({action: "create"});
    backupState = Object.assign({}, backupState, {backups: doc.backups});
    renderBackup();
    bkStatus(`Backed up.${doc.pruned && doc.pruned.length
      ? ` ${doc.pruned.length} older version${doc.pruned.length === 1 ? "" : "s"} pruned to stay inside the limit.`
      : ""}`);
  }catch(e){
    bkStatus(String(e.message || e), true);
  }finally{ backupBusy = false; }
}

async function restoreVersion(name){
  const b = (backupState.backups || []).find(x => x.name === name);
  const what = b ? `${bkWhen(b.at)} — ${bkCount(b.rides, "ride")}, ${bkCount(b.items, "gear item")}` : name;
  if (!confirm(`Restore ${what}?\n\nThis replaces the gear list and the whole ride history `
             + `with that version. A copy of what you have now is taken first, so this can `
             + `be undone.`)) return;
  bkStatus("Restoring…");
  try{
    const doc = await backupPost({action: "restore", name});
    const applied = applyRestore(doc.state || {});
    backupState = Object.assign({}, backupState, {backups: doc.backups});
    renderBackup();
    bkStatus(`Restored ${bkCount(applied.rides, "ride")} and ${bkCount(applied.items, "gear item")}. `
           + `What you had before is saved as ${doc.safety || "a pre-restore copy"}.`);
  }catch(e){
    bkStatus(String(e.message || e), true);
  }
}

async function deleteVersion(name){
  if (!confirm(`Delete this backup?\n\n${name}\n\nThe rides and gear it holds stay where they `
             + `are — this only removes the saved copy.`)) return;
  try{
    const doc = await backupPost({action: "delete", name});
    backupState = Object.assign({}, backupState, {backups: doc.backups});
    renderBackup();
    bkStatus("Deleted.");
  }catch(e){ bkStatus(String(e.message || e), true); }
}

function bkDownload(text, filename){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type: "application/json"}));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadVersion(name){
  try{
    const r = await fetch(`${BACKUP_ONE_URL}?name=${encodeURIComponent(name)}`, {cache: "no-store"});
    if (!r.ok) throw new Error(`server said ${r.status}`);
    bkDownload(await r.text(), name);
    bkStatus(`Downloaded ${name}.`);
  }catch(e){ bkStatus(String(e.message || e), true); }
}

/* Works with no server at all, which is the point of it: whatever this browser
   holds, in one file, on your own disk. */
function downloadNow(){
  const env = backupEnvelope();
  const rides = (env.state.history || []).length, items = (env.state.gear || []).length;
  if (!rides && !items) return bkStatus("Nothing to back up yet.", true);
  bkDownload(JSON.stringify(env),
    `backup-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-manual.json`);
  bkStatus(`Downloaded a copy: ${bkCount(rides, "ride")}, ${bkCount(items, "gear item")}.`);
}

async function restoreFromFile(file){
  if (!file) return;
  try{
    const doc = JSON.parse(await file.text());
    const bad = validEnvelope(doc);
    if (bad) return bkStatus(bad, true);
    const st = doc.state;
    if (!confirm(`Restore from ${file.name}?\n\n`
      + `${bkCount((st.history || []).length, "ride")} and `
      + `${bkCount((st.gear || []).length, "gear item")}, taken ${bkWhen(doc.backupAt)}.`
      + `\n\nThis replaces what you have now.`)) return;

    /* A safety copy first, where there is a server to hold one. Restoring from
       a file is the one path that can arrive with no server behind it, and then
       there is nowhere to put such a copy -- so the confirm above is the only
       guard, and it says as much. */
    let safety = null;
    if (backupServer){
      try{
        if (typeof syncPush === "function") await syncPush(true);
        const made = await backupPost({action: "create", reason: "pre-restore"});
        safety = made.name;
        backupState = Object.assign({}, backupState, {backups: made.backups});
      }catch(e){ /* Not fatal: the restore is what was asked for. */ }
    }
    const applied = applyRestore(st);
    renderBackup();
    bkStatus(`Restored ${bkCount(applied.rides, "ride")} and `
           + `${bkCount(applied.items, "gear item")} from ${file.name}.`
           + (safety ? ` What you had before is saved as ${safety}.` : ""));
  }catch(e){
    bkStatus(`That file could not be read: ${e.message || e}`, true);
  }
}

async function saveSchedule(){
  const enabled = document.getElementById("bkenabled").checked;
  const everyHours = +document.getElementById("bkevery").value;
  const keep = +document.getElementById("bkkeep").value;
  try{
    const doc = await backupPost({action: "schedule", enabled, everyHours, keep});
    backupState = Object.assign({}, backupState, {schedule: doc.schedule, backups: doc.backups});
    renderBackup();
    bkStatus(doc.schedule.enabled
      ? `Scheduled: every ${doc.schedule.everyHours} h, keeping the newest ${doc.schedule.keep}.`
        + (doc.pruned && doc.pruned.length ? ` ${doc.pruned.length} pruned now.` : "")
      : "Scheduled backup off.");
  }catch(e){ bkStatus(String(e.message || e), true); }
}

/* --- Render ------------------------------------------------------ */

function renderBackup(){
  const el = document.getElementById("bkbody");
  if (!el) return;
  const rides = loadHistory().length, items = loadGear().length;
  const sched = backupState.schedule;
  const list = backupState.backups || [];

  const count = document.getElementById("bkcount");
  if (count) count.textContent = backupServer === true
    ? `${list.length} version${list.length === 1 ? "" : "s"} kept`
    : backupServer === false ? "no server — download only" : "";

  const held = `<p class="wx-note">This browser is holding
    <b>${bkCount(rides, "ride")}</b> and <b>${bkCount(items, "gear item")}</b>. Neither can be worked out again from
    anything else: the gear list is your own calibration of what you own, and the history is
    the only record of how the model has done.</p>`;

  if (backupServer === null){
    el.innerHTML = `${held}<p class="wx-note">Looking for a server to keep versions on…</p>`;
    return;
  }

  if (backupServer === false){
    el.innerHTML = `${held}
      <p class="wx-alert"><b>No server, so no versions are being kept.</b> The two things that
        never needed one still work: take a copy onto your disk now, and put one back later.
        For dated versions and a schedule that runs whether or not this tab is open, run the
        app with <span class="wx-num">node server.js</span> — see INSTALL.md.</p>
      <div class="wx-bar-row">
        <button id="bkdownload" class="wx-btn wx-btn--primary">Download a copy</button>
        <label class="wx-file" for="bkfile">Restore from a file</label>
        <input type="file" id="bkfile" accept=".json,application/json" class="wx-hidden">
      </div>
      <p class="wx-note" id="bkstatus" style="margin-top:var(--sp-3)"></p>`;
    wireBackup();
    return;
  }

  el.innerHTML = `${held}

  <div class="wx-bar-row">
    <button id="bknow" class="wx-btn wx-btn--primary">Back up now</button>
    <button id="bkdownload" class="wx-btn wx-btn--quiet">Download a copy</button>
    <label class="wx-file" for="bkfile">Restore from a file</label>
    <input type="file" id="bkfile" accept=".json,application/json" class="wx-hidden">
  </div>
  <p class="wx-note" id="bkstatus" style="margin-top:var(--sp-3)"></p>

  <p class="wx-note"><b>Where they are kept.</b>
    <span class="wx-num">${backupState.dir || "—"}</span><br>
    A directory of its own, and that is the point: updating this app means replacing the files
    in its own directory, and anything sitting among them is at the mercy of that. This one is
    never tracked by git and never checked out over. Set <span class="wx-num">BACKUP_DIR</span>
    to move it somewhere else entirely — an external disk, a synced folder.</p>

  <h3 class="wx-label" style="margin-top:var(--sp-5)">On a schedule</h3>
  <p class="wx-note">Kept by the server rather than by this page, because a backup that only
    happens when a tab is open is not a schedule — and the morning you most want yesterday's
    copy is the one you never opened the app. Off until you ask for it.</p>
  <label class="wx-check" for="bkenabled" style="margin-bottom:var(--sp-3)">
    <input type="checkbox" id="bkenabled" ${sched && sched.enabled ? "checked" : ""}>
    Back up automatically
  </label>
  <!-- The switch on its own line above the two numbers it governs. In the same
       row it sat a label's height below them, since a checkbox has no label
       over it to line up with. -->
  <div class="wx-grid wx-grid--2">
    <div>
      <label class="wx-label" for="bkevery">Every (hours)</label>
      <input type="number" id="bkevery" class="wx-input" min="${backupState.everyHoursMin || 1}"
             max="${backupState.everyHoursMax || 720}" step="1"
             value="${sched ? sched.everyHours : 24}">
    </div>
    <div>
      <label class="wx-label" for="bkkeep">Versions to keep</label>
      <input type="number" id="bkkeep" class="wx-input" min="1" max="${backupState.keepMax || 500}"
             step="1" value="${sched ? sched.keep : 30}">
    </div>
  </div>
  <div class="wx-bar-row">
    <button id="bksave" class="wx-btn wx-btn--quiet">Save schedule</button>
    <span class="wx-note" style="margin:0">${sched && sched.enabled
      ? `Last run ${bkWhen(sched.lastAt)}. The newest ${sched.keep} are kept and the rest
         pruned oldest-first; a run that finds nothing changed writes no file.`
      : "Nothing is written automatically while this is off."}</span>
  </div>

  <h3 class="wx-label" style="margin-top:var(--sp-5)">Versions</h3>
  ${!list.length ? `<p class="wx-note">None yet. <b>Back up now</b> writes the first.</p>` : `
  <div class="wx-scroll"><table class="wx-table">
    <thead><tr><th>Taken</th><th>Why</th><th class="wx-right">Rides</th>
      <th class="wx-right">Gear</th><th class="wx-right">Size</th><th></th></tr></thead>
    <tbody>${list.map(b => `
      <tr>
        <td>${bkWhen(b.at)}${b.unreadable
          ? ` <span class="wx-score__n">unreadable — the file is there but will not parse</span>`
          : ""}</td>
        <td>${BK_REASON[b.reason] || b.reason || "—"}</td>
        <td class="wx-right wx-num">${b.rides == null ? "—" : b.rides}</td>
        <td class="wx-right wx-num">${b.items == null ? "—" : b.items}</td>
        <td class="wx-right wx-num">${bkSize(b.bytes)}</td>
        <td class="wx-right">
          <button class="wx-linkbtn" data-restore="${b.name}" ${b.unreadable ? "disabled" : ""}>Restore</button>
          <button class="wx-linkbtn" data-download="${b.name}">Download</button>
          <button class="wx-linkbtn" data-delete="${b.name}">Delete</button>
        </td>
      </tr>`).join("")}</tbody>
  </table></div>`}
  <p class="wx-note">Restoring <b>replaces</b> the gear list and the whole history with that
    version — it does not merge, which is what Import on the History tab is for. A copy of
    what you have now is taken first, so a restore can itself be undone.</p>`;

  wireBackup();
}

/* Wired after every render, because the render replaces the nodes. */
function wireBackup(){
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  on("bknow", backupNow);
  on("bkdownload", downloadNow);
  on("bksave", saveSchedule);
  const file = document.getElementById("bkfile");
  if (file) file.onchange = e => {
    restoreFromFile(e.target.files && e.target.files[0]);
    e.target.value = "";        // so the same file can be picked twice
  };
  document.querySelectorAll("#bkbody [data-restore]").forEach(b =>
    b.onclick = () => restoreVersion(b.dataset.restore));
  document.querySelectorAll("#bkbody [data-download]").forEach(b =>
    b.onclick = () => downloadVersion(b.dataset.download));
  document.querySelectorAll("#bkbody [data-delete]").forEach(b =>
    b.onclick = () => deleteVersion(b.dataset.delete));
}
