"use strict";

/* ---------------------------------------------------------------
   Letting the garment ranges follow the evidence.

   tmin and tmax on each garment are the rider's own calibration: the ride-feel
   at which they reach for it and at which they stop. They are the most
   influential numbers in the wardrobe advice, and until now they were set once
   and never revisited — while the history quietly filled up with exactly the
   evidence needed to revisit them: every rated ride carries the ride-feel it
   was planned at and the garments it was planned with.

   A verdict is about the whole outfit, so it is not pinned on one garment
   lightly. Only rides near a garment's own EDGE count for that garment,
   because the edge is the only place where its range decided anything: too
   warm at 11° in a jacket rated to 12° says the jacket's top end is too high;
   too warm at 5° in the same jacket says nothing about the jacket, since any
   kit would have been chosen there. Rides in the middle of the range are left
   to the rider correction in feedback.js, which is what it is for.

   Nothing is changed by itself. A suggestion is shown on the Gear tab with the
   rides behind it, and the rider applies or dismisses it. Applying it moves
   the rides out of the edge zone, so the suggestion does not come back.

   The sign convention is the one feedback.js explains: a verdict of "too
   warm" is +2 and means the rider was too warm in what was chosen.
----------------------------------------------------------------*/

const EDGE_ZONE = 3;        // °C inside the range that count as "at the edge"
const MIN_SUPPORT = 3;      // rides pointing the same way before anything is said
const MAX_STEP = 3;         // °C a range moves per suggestion
const MIN_WIDTH = 2;        // °C a range must keep
const MARGIN = 1;           // °C the new edge sits past the worst ride

/* Garments picked on the extremity number rather than the core one, as in
   pickOutfit. Legs use a shaded core number; close enough to read as core. */
const EXTREMITY_SLOTS = new Set(["hands", "socks", "feet", "neck", "head"]);

/* Which zone's verdict judges this garment: the hands for gloves, the feet
   for shoes and socks, the core for the rest (neck and head have no verdict
   of their own and are read with the core's). */
const zoneOf = item => item.slot === "hands" ? "hands" : (item.slot === "feet" || item.slot === "socks") ? "feet" : null;

/* The temperature a ride was planned at, for this garment's slot: the
   zone's own corrected number where the ride recorded one. */
function plannedFeel(ride, item){
  const zone = zoneOf(item);
  if (zone === "hands" && ride.handsFeel != null) return ride.handsFeel;
  if (zone === "feet" && ride.feetFeel != null) return ride.feetFeel;
  if (EXTREMITY_SLOTS.has(item.slot) && ride.extFeel != null) return ride.extFeel;
  return ride.feel;
}

/* The verdict that counts for this garment: the zone's where the rider gave
   one, else the body's. */
function verdictFor(ride, item){
  const zone = zoneOf(item);
  if (zone){
    const d = zoneDelta(ride, zone);
    if (d != null) return d;
  }
  return effectiveDelta(ride);
}

/* Every suggestion the history supports, one per garment edge at most.
   `dismissed` holds suggestion keys the rider has waved away. Pure. */
function gearSuggestions(gear, history, dismissed){
  const skip = new Set(dismissed || []);
  const rated = ratedRides(history).filter(r => Array.isArray(r.kit) && r.feel != null);
  const out = [];

  gear.forEach((item, index) => {
    if (item.slot === "eyes" || item.rainOnly) return;    // chosen by light and rain, not warmth
    const worn = rated.filter(r => r.kit.includes(item.name));
    if (worn.length < MIN_SUPPORT) return;

    for (const edge of ["tmax", "tmin"]){
      const zone = worn.filter(r => {
        const t = plannedFeel(r, item);
        return edge === "tmax" ? t >= item.tmax - EDGE_ZONE : t <= item.tmin + EDGE_ZONE;
      });
      const sign = edge === "tmax" ? 1 : -1;        // too warm at the top, too cold at the bottom
      const support = zone.filter(r => sign * verdictFor(r, item) >= 1);
      const against = zone.length - support.length;  // about right, or the other way
      if (support.length < MIN_SUPPORT || support.length < 2 * against) continue;

      const temps = support.map(r => plannedFeel(r, item));
      let to = edge === "tmax"
        ? Math.min(...temps) - MARGIN
        : Math.max(...temps) + MARGIN;
      to = Math.round(to);
      // Never more than a step at a time, and never a range that closes up.
      if (edge === "tmax") to = Math.max(to, item.tmax - MAX_STEP, item.tmin + MIN_WIDTH);
      else                 to = Math.min(to, item.tmin + MAX_STEP, item.tmax - MIN_WIDTH);
      if (to === item[edge]) continue;
      if (edge === "tmax" ? to > item.tmax : to < item.tmin) continue;   // evidence inside the range only tightens it

      const key = `${item.name}|${edge}|${to}`;
      if (skip.has(key)) continue;
      out.push({
        key, index, name: item.name, slot: item.slot, edge, from: item[edge], to,
        rides: support.length, against,
        // Newest first, for the line under the suggestion.
        examples: support.slice().sort((a, b) => (b.startISO || "").localeCompare(a.startISO || ""))
          .slice(0, 4).map(r => ({startISO: r.startISO, feel: plannedFeel(r, item), verdict: r.verdict}))
      });
    }
  });
  return out;
}

/* One sentence per suggestion, for the Gear tab. */
function suggestionText(s){
  const what = s.edge === "tmax"
    ? `too warm near the top of its range (${s.from}°)`
    : `too cold near the bottom of its range (${s.from}°)`;
  const to = s.edge === "tmax" ? `down to ${s.to}°` : `up to ${s.to}°`;
  const n = `${s.rides} rated ride${s.rides === 1 ? "" : "s"}`;
  const ag = s.against ? `, ${s.against} said otherwise` : "";
  return `${n} were ${what}${ag}. Move its ${s.edge === "tmax" ? "warm" : "cold"} end ${to}?`;
}

/* --- Dismissals -------------------------------------------------- */
const SUGGEST_DISMISS_KEY = "cwem-gear-suggest-dismissed";

function dismissedSuggestions(){
  try{
    const v = JSON.parse(localStorage.getItem(SUGGEST_DISMISS_KEY) || "[]");
    return Array.isArray(v) ? v.filter(k => typeof k === "string") : [];
  }catch(e){ return []; }
}
function dismissSuggestion(key){
  const list = dismissedSuggestions();
  if (!list.includes(key)) list.push(key);
  try{ localStorage.setItem(SUGGEST_DISMISS_KEY, JSON.stringify(list.slice(-200))); }catch(e){}
}
