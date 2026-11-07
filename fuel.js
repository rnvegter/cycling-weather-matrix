"use strict";

/* ---------------------------------------------------------------
   Fuel and drink for one ride.

   What you carry in your bottles is a weather question first: how much you
   sweat is set by the air temperature and by whether that sweat can leave
   (the same evaporation the ride-feel model already works out). How much you
   eat is a question of how long and how hard. The kit advice already knows the
   first; the second arrives from the training planner (Fietscoach) as an effort
   score of 1–5, and falls back to the pace chips when the ride comes from here.

   General sports-nutrition ranges, not a personal sweat test. Everything
   ramps rather than steps, for the same reason the ride-feel model does: a
   ride of 89 minutes and one of 91 should not get different advice.
----------------------------------------------------------------*/

const BOTTLE_ML = 750;      // a large bottle; two cages hold 1.5 L
const GEL_G = 25;           // one gel, or half a bar

/* Straight lines between the given points, flat beyond both ends. */
function rampTable(x, pts){
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++){
    if (x <= pts[i][0]){
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

const PACE_EFFORT = {easy: 2, steady: 3, hard: 4};

/* Sweat rate rises with the warmest hour you ride in. Cold air still costs
   water through breathing, which is why the floor is not zero. */
const FLUID_BY_TEMP = [[0, 350], [10, 450], [18, 550], [24, 700], [30, 900], [35, 1000]];
const FLUID_BY_EFFORT = [[1, 0.8], [3, 1], [5, 1.2]];

/* Carbohydrate per hour (top of the range) against "effective hours": a hard
   hour burns through glycogen faster than an easy one, so it counts for more.
   Up to about an hour your own stores cover it; 90 g is what a trained gut
   takes from a glucose–fructose mix. */
const CARB_BY_HOURS = [[0.9, 0], [1.3, 40], [2.5, 60], [3.5, 80], [5, 90]];
const CARB_BY_EFFORT = [[1, 0.8], [3, 1], [5, 1.25]];

const round = (x, step) => Math.round(x / step) * step;

/* opts: hours, effort (1–5, optional), pace; w: the ride window (tMax, tMin);
   f: the ride-feel result (evap, 0–1, when the humidity was known). */
function fuelPlan(w, f, opts){
  const hours = Math.max(0, opts.hours || 0);
  const effort = clampN(opts.effort || PACE_EFFORT[opts.pace] || 3, 1, 5);
  const evap = (f && f.evap) || 0;

  // --- Drink
  const base = rampTable(w.tMax, FLUID_BY_TEMP) * rampTable(effort, FLUID_BY_EFFORT) * (1 + 0.15 * evap);
  const perHour = [Math.max(250, round(base * 0.85, 50)), round(base * 1.1, 50)];
  const total = perHour.map(v => v * hours);
  const mid = (total[0] + total[1]) / 2;
  const bottles = Math.max(1, Math.ceil(mid / BOTTLE_ML - 0.15));
  // When two bottles run dry, at the middle of the range.
  const refillAt = bottles > 2 ? (2 * BOTTLE_ML) / ((perHour[0] + perHour[1]) / 2) : null;
  const salt = w.tMax >= 24 || (mid >= 1500 && w.tMax >= 15) || (evap >= 0.4 && hours >= 2);

  // --- Eat
  const eff = hours * rampTable(effort, CARB_BY_EFFORT);
  const hi = round(rampTable(eff, CARB_BY_HOURS), 5);
  const carbs = hi >= 20 ? [round(hi * 0.65, 5), hi] : null;
  const carbTotal = carbs ? carbs.map(v => round(v * hours, 10)) : null;
  const gels = carbTotal ? Math.round((carbTotal[0] + carbTotal[1]) / 2 / GEL_G) : 0;

  const notes = [];
  if (carbs) notes.push("Start eating within the first 30–45 minutes, a little every 20 minutes. Waiting until you are hungry is waiting too long.");
  if (carbs && carbs[1] >= 80) notes.push("Above 60 g an hour needs a glucose–fructose mix, and a gut that has practised it on training rides.");
  if (w.tMax < 5) notes.push("Cold blunts thirst. Drink to the clock rather than to feel; warm drink in an insulated bottle helps.");
  if (refillAt) notes.push(`Two bottles run out after about ${fmtHours(refillAt)}. Plan a refill stop before then.`);

  return {effort, perHour, total, bottles, refillAt, salt, carbs, carbTotal, gels, notes,
          fromPlanner: !!opts.effort};
}

function clampN(x, lo, hi){ return Math.min(hi, Math.max(lo, x)); }

function fmtHours(h){
  const m = Math.round(h * 60 / 5) * 5;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

/* What the ride said on arrival, when it came from the training planner:
   ?date=2026-11-14&time=09:30&hours=2.25&pace=steady&effort=3&name=Long%20ride
   Read once; the fields stay editable, and the effort is kept until the hours
   or pace are changed by hand, because then it is a different ride. */
function readHandoff(search){
  const q = new URLSearchParams(search || "");
  const num = (k, lo, hi) => {
    const v = parseFloat(q.get(k));
    return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") || "") ? q.get("date") : null;
  const time = /^\d{2}:\d{2}$/.test(q.get("time") || "") ? q.get("time") : null;
  const pace = ["easy", "steady", "hard"].includes(q.get("pace")) ? q.get("pace") : null;
  const out = {date, time, hours: num("hours", 0.25, 24), pace,
               effort: num("effort", 1, 5), name: (q.get("name") || "").slice(0, 80) || null};
  return Object.values(out).some(v => v != null) ? out : null;
}
