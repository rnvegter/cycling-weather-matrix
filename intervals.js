"use strict";

/* ---------------------------------------------------------------
   intervals.icu, the decisions: what to import, which planned ride an
   imported one belongs to, how a planned workout fills in the Ride tab, how a
   route becomes a favourite, and what is written back once a ride is rated.

   Pure functions; the fetching and the buttons are in intervalsui.js, and the
   API key never leaves the server (server.js, "intervals.icu").
----------------------------------------------------------------*/

const ICU_LAST_KEY = "cwem-icu-last-import";
const ICU_FIRST_DAYS = 30;          // the first import looks this far back
const ICU_MATCH_MIN = 90;           // a planned ride and a recorded one, this far apart at most
const ICU_IMPORT_MAX = 20;          // per press, so one press cannot eat the day's request limit

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* The window to ask for: from the day of the last import (that day again, in
   case a ride arrived after it) or a month back, to today. */
function icuImportWindow(lastImport, now){
  const today = new Date(now == null ? Date.now() : now);
  const from = lastImport && /^\d{4}-\d{2}-\d{2}$/.test(lastImport)
    ? lastImport
    : isoDay(new Date(today.getTime() - ICU_FIRST_DAYS * 86400000));
  return {oldest: from, newest: isoDay(today)};
}

/* "2026-11-09T07:58:12" → minutes since the epoch, read as local time. */
const localMinutes = s => {
  const m = typeof s === "string" && s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() / 60000 : null;
};

/* Which of the recorded rides are new: outdoor, with GPS, not yet in the
   history by their intervals.icu id. Oldest first, at most ICU_IMPORT_MAX. */
function ridesToImport(rides, history){
  const known = new Set(history.map(e => e.icuId).filter(Boolean));
  return rides.filter(r => r && r.id && !known.has(r.id) && r.hasGps !== false)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, ICU_IMPORT_MAX);
}

/* The ride planned here that a recorded one is: the nearest in start time,
   within ICU_MATCH_MIN minutes, not yet given a recording. Planned rides are
   the ones worked out on the Ride tab — not reconstructed from a file. */
function matchPlanned(history, ride){
  const t = localMinutes(ride.start);
  if (t == null) return null;
  let best = null, gap = Infinity;
  for (const e of history){
    if (e.icuId || e.actual || e.reconstructed) continue;
    const s = localMinutes(e.startISO);
    if (s == null) continue;
    const d = Math.abs(s - t);
    if (d <= ICU_MATCH_MIN && d < gap){ best = e; gap = d; }
  }
  return best;
}

/* A planned workout, as the Ride tab wants it: the date and, when the
   workout has one, the start time; the hours; and an effort of 1–5 from the
   training load per hour, which is what the fuel advice reads. Load per hour
   is 100 for an hour at threshold, so: 30 or less is 1, 45 is 2, 60 is 3,
   75 is 4, 90 and up is 5, in between by straight lines, rounded. */
function plannedToRide(p){
  const m = typeof p.start === "string" && p.start.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  const date = m ? m[1] : null;
  const time = m && m[2] !== "00:00" ? m[2] : null;      // midnight means "no time set"
  const hours = p.hours > 0 ? Math.round(p.hours * 4) / 4 : null;
  let effort = null;
  if (p.load > 0 && p.hours > 0){
    const lph = p.load / p.hours;
    effort = Math.round(Math.min(5, Math.max(1, 1 + (lph - 30) / 15)));
  }
  const pace = effort == null ? null : effort <= 2 ? "easy" : effort >= 4 ? "hard" : "steady";
  return {date, time, hours, effort, pace, name: p.name || null};
}

/* A route, as a favourite: points without height (intervals.icu keeps the
   path as latitude and longitude only), thinned like any other. */
function routeToFavourite(route){
  const pts = (route.path || []).map(([lat, lon]) => ({lat, lon, ele: null, t: null}));
  if (pts.length < 2) return null;
  return normaliseFavourite({
    name: route.name, points: packPoints(simplifyTrack(pts, FAV_SPACING_M, FAV_MAX_POINTS)),
    icuRouteId: route.id, addedAt: new Date().toISOString()
  });
}

/* What is written back to the ride on intervals.icu once it is rated: the
   verdicts, and the numbers the kit was chosen on, so the comment still makes
   sense read in a year. */
function icuComment(e){
  const v = e.verdict ? verdictById(e.verdict) : null;
  if (!v) return null;
  const zones = ["hands", "feet"].filter(z => e.zones && e.zones[z])
    .map(z => `${z} ${verdictById(e.zones[z]).label.toLowerCase()}`);
  const kit = (e.kit || []).slice(0, 8).join(", ");
  return `Weather Effect: kit ${v.label.toLowerCase()}${zones.length ? ` (${zones.join(", ")})` : ""}. `
    + `Planned at ${e.feel}° ride-feel, ${e.air}° air${e.extFeel != null ? `, hands and feet ${e.extFeel}°` : ""}.`
    + (kit ? ` Wore: ${kit}${e.kit.length > 8 ? ", …" : ""}.` : "");
}

/* Rated rides whose rating has not reached intervals.icu yet, once the rating
   has stood for `settleMs` — so changing your mind straight away does not post
   twice. A rating changed after it was sent is sent again. */
function icuCommentsDue(history, now, settleMs){
  const t = now == null ? Date.now() : now, wait = settleMs == null ? 20000 : settleMs;
  return history.filter(e => e.icuId && e.verdict && e.ratedAt
    && (!e.icuSentAt || e.icuSentAt < e.ratedAt)
    && t - Date.parse(e.ratedAt) >= wait);
}
