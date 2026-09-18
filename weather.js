"use strict";

/* ---------------------------------------------------------------
   Sky, wind and the direction to set off in.

   Icons are inline SVG drawn from the design system's own tokens — no image
   files, no icon font, and they take their colour from the temperature ramp
   so a rain hour reads blue and a clear one reads warm.
----------------------------------------------------------------*/

/* WMO weather codes, as returned by Open-Meteo. Grouped into the handful of
   states that actually change what you wear or how you ride. */
const WMO = {
  0:  ["clear",    "Clear"],
  1:  ["mostly",   "Mostly clear"],
  2:  ["partly",   "Partly cloudy"],
  3:  ["overcast", "Overcast"],
  45: ["fog",      "Fog"],
  48: ["fog",      "Rime fog"],
  51: ["drizzle",  "Light drizzle"],
  53: ["drizzle",  "Drizzle"],
  55: ["drizzle",  "Heavy drizzle"],
  56: ["sleet",    "Freezing drizzle"],
  57: ["sleet",    "Freezing drizzle"],
  61: ["rain",     "Light rain"],
  63: ["rain",     "Rain"],
  65: ["heavy",    "Heavy rain"],
  66: ["sleet",    "Freezing rain"],
  67: ["sleet",    "Freezing rain"],
  71: ["snow",     "Light snow"],
  73: ["snow",     "Snow"],
  75: ["snow",     "Heavy snow"],
  77: ["snow",     "Snow grains"],
  80: ["showers",  "Light showers"],
  81: ["showers",  "Showers"],
  82: ["heavy",    "Violent showers"],
  85: ["snow",     "Snow showers"],
  86: ["snow",     "Snow showers"],
  95: ["thunder",  "Thunderstorm"],
  96: ["thunder",  "Thunderstorm, hail"],
  99: ["thunder",  "Thunderstorm, hail"]
};
const skyFor = code => WMO[code] || ["overcast", "Cloud"];

/* Which ramp colour an icon takes. Sky is not temperature, but it reads on the
   same scale: clear is warm, rain is the cold end, ice is colder still. */
const SKY_TINT = {
  clear:"var(--t-warm)", mostly:"var(--t-warm)", partly:"var(--t-mild)",
  overcast:"var(--text-dim)", fog:"var(--text-dim)",
  drizzle:"var(--minus)", rain:"var(--minus)", showers:"var(--minus)",
  heavy:"var(--t-frozen)", sleet:"var(--t-cold)", snow:"var(--t-cold)",
  thunder:"var(--signal)"
};

/* --- Icons ------------------------------------------------------
   22×22, stroke-based, currentColor. Geometric rather than cartoon:
   this is an instrument panel, not a weather app for children. */
const CLOUD = `<path d="M6.5 17h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A3.2 3.2 0 0 0 6.5 17Z"/>`;
/* A smaller cloud, so "mainly clear" reads as mostly sun at a glance and
   "partly cloudy" reads as mostly cloud. Same-sized clouds made the two
   commonest codes in the forecast look identical. */
const CLOUD_SM = `<path d="M12 18.5h5.5a2.4 2.4 0 0 0 .2-4.8 3.5 3.5 0 0 0-6.6.8A2.2 2.2 0 0 0 12 18.5Z"/>`;
const SUN_RAYS = (cx, cy, r) => {
  let out = `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  for (let i = 0; i < 8; i++){
    const a = i * Math.PI / 4;
    const x1 = cx + Math.cos(a) * (r + 1.8), y1 = cy + Math.sin(a) * (r + 1.8);
    const x2 = cx + Math.cos(a) * (r + 3.6), y2 = cy + Math.sin(a) * (r + 3.6);
    out += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
  }
  return out;
};
const DROPS = n => Array.from({length:n}, (_, i) =>
  `<path d="M${7 + i*3.5} 19l-1 2.4"/>`).join("");

const SKY_ICON = {
  clear:    () => SUN_RAYS(11, 11, 4),
  moon:     () => `<path d="M17.5 14.2A7 7 0 0 1 9 5.2a7.2 7.2 0 1 0 8.5 9Z"/>`,
  mostly:   () => SUN_RAYS(9.5, 8.5, 3.6) + CLOUD_SM,
  partly:   () => SUN_RAYS(7, 6.5, 2.6) + CLOUD,
  overcast: () => `<path d="M4 13.5a3 3 0 0 1 2.6-3A5 5 0 0 1 16 9.4"/>` + CLOUD,
  fog:      () => CLOUD + `<path d="M3 19.5h7M12.5 19.5h6M5 22h10"/>`,
  drizzle:  () => CLOUD + DROPS(2),
  rain:     () => CLOUD + DROPS(3),
  heavy:    () => CLOUD + `<path d="M7 18.5l-1.6 3.6M11 18.5l-1.6 3.6M15 18.5l-1.6 3.6"/>`,
  showers:  () => SUN_RAYS(8, 7.5, 2.6) + CLOUD + DROPS(2),
  sleet:    () => CLOUD + `<path d="M7.5 19l-1 2.4"/><path d="M13 19.6v2.4M11.8 20.2l2.4 1.2M14.2 20.2l-2.4 1.2"/>`,
  snow:     () => CLOUD + `<path d="M8 19.4v2.6M6.8 20v1.4M9.2 20v1.4M14 19.4v2.6M12.8 20v1.4M15.2 20v1.4"/>`,
  thunder:  () => CLOUD + `<path d="M12 18l-3 4h3l-1.5 3.5"/>`
};

function skyIcon(code, isDay, size){
  let [key] = skyFor(code);
  if (!isDay && (key === "clear" || key === "mostly")) key = "moon";
  const draw = SKY_ICON[key] || SKY_ICON.overcast;
  const s = size || 22;
  return `<svg class="wx-ico" viewBox="0 0 24 26" width="${s}" height="${s * 26/24}"
    fill="none" stroke="${SKY_TINT[key] || "currentColor"}" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${draw()}</svg>`;
}

/* --- Beaufort ---------------------------------------------------
   The Netherlands talks in Beaufort, not km/h, and the descriptions carry
   what the number means on a bike better than a speed does. */
const BEAUFORT = [
  [1,    0,  "Calm",           "Smoke rises straight up."],
  [6,    1,  "Light air",      "You won't notice it."],
  [12,   2,  "Light breeze",   "Felt on the face."],
  [20,   3,  "Gentle breeze",  "Noticeable, not a problem."],
  [29,   4,  "Moderate breeze","Raises dust. Costs you a gear into it."],
  [39,   5,  "Fresh breeze",   "Hard work into it on open ground."],
  [50,   6,  "Strong breeze",  "Umbrellas fail. Two gears down, and plan the route around it."],
  [62,   7,  "Near gale",      "Whole trees moving. Serious effort into it."],
  [75,   8,  "Gale",           "Twigs break off. Crosswinds move you across the lane."],
  [89,   9,  "Strong gale",    "Structural damage begins. Reconsider the ride."],
  [103, 10,  "Storm",          "Trees uprooted. Don't."],
  [118, 11,  "Violent storm",  "Widespread damage. Don't."],
  [999, 12,  "Hurricane",      "Don't."]
];
function beaufort(kmh){
  for (const [ceiling, force, name, note] of BEAUFORT){
    if (kmh < ceiling) return {force, name, note};
  }
  return {force:12, name:"Hurricane", note:"Don't."};
}

/* --- Direction --------------------------------------------------
   Meteorological convention: a "west wind" comes FROM the west. The arrow
   drawn on screen points the way the air is travelling, which is the opposite,
   so both are labelled explicitly and never left to the reader to infer. */
/* Shortest separation between two bearings, 0–180°. The +540 wrap is what
   stops 350° and 10° reading as 340° apart instead of 20°. */
const angleGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/* Small inline arrow for the hourly strip: points the way the air travels. */
function windArrow(fromDeg, size){
  const s = size || 15;
  return `<svg viewBox="0 0 16 16" width="${s}" height="${s}" class="wx-windarrow"
    style="transform:rotate(${((fromDeg + 180) % 360).toFixed(0)}deg)" aria-hidden="true">
    <path d="M8 1.5 L8 14.5 M8 1.5 L4.6 5.4 M8 1.5 L11.4 5.4"
      fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
