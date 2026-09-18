"use strict";

/* ---------------------------------------------------------------
   The mark: a gauge.

   Seven arcs in ramp order, frozen at the bottom left sweeping round to
   baking at the bottom right, open at the bottom like a dial, with a needle
   as the reading. The app has one job — put a needle on that scale — and the
   mark is that job in one shape.

   It used to be a full ring coloured by a left-to-right gradient, which put
   the colours where they fell across the width rather than in order round
   the ring: clockwise from the top it read warm, baking, hot, mild, cold,
   frozen, cool, with the top and the bottom both the same middle olive. The
   seven bands it was drawn around were never actually drawn.

   Both the header mark and the browser-tab icon are built here, from one
   geometry, so they cannot drift apart as the two hand-written copies did.
----------------------------------------------------------------*/

const LOGO_BANDS = ["frozen", "cold", "cool", "mild", "warm", "hot", "baking"];

/* The icon cannot read CSS variables, so it carries the ramp as hex. A test
   checks these against the tokens in styles.css. */
const LOGO_RAMP_HEX = {
  frozen: "#2E6C9E", cold: "#4A8299", cool: "#6E9A93", mild: "#A3A075",
  warm: "#C9A03F", hot: "#DF8B26", baking: "#C85A2B"
};

const LOGO_SWEEP_FROM = -135, LOGO_SWEEP_TO = 135;   // degrees clockwise from 12 o'clock

/* Each band as {band, from, to} in degrees. `gap` opens a sliver between
   neighbours; the two ends stay exactly on the sweep. */
function logoArcs(gap){
  const g = gap == null ? 3 : gap, n = LOGO_BANDS.length;
  const span = LOGO_SWEEP_TO - LOGO_SWEEP_FROM;
  return LOGO_BANDS.map((band, i) => ({
    band,
    from: LOGO_SWEEP_FROM + span * i / n + (i > 0 ? g / 2 : 0),
    to:   LOGO_SWEEP_FROM + span * (i + 1) / n - (i < n - 1 ? g / 2 : 0)
  }));
}

function logoMarkup(mode){
  const icon = mode === "favicon";
  const c = 22, r = 16;
  const pt = (deg, rad) => {
    const a = deg * Math.PI / 180;
    return `${(c + rad * Math.sin(a)).toFixed(2)} ${(c - rad * Math.cos(a)).toFixed(2)}`;
  };
  // At 16 pixels a gap is under a pixel and only blurs, so the icon has none
  // and draws everything heavier.
  const arcs = logoArcs(icon ? 0 : 3.2).map(a => {
    const colour = icon ? `stroke="${LOGO_RAMP_HEX[a.band]}"` : `style="stroke:var(--t-${a.band})"`;
    return `<path d="M${pt(a.from, r)} A${r} ${r} 0 0 1 ${pt(a.to, r)}" fill="none" ${colour}
      stroke-width="${icon ? 6 : 4.5}" stroke-linecap="butt"/>`;
  }).join("");

  // The needle reads the middle of "warm": a comfortable ride, not a warning.
  const warm = logoArcs(0)[LOGO_BANDS.indexOf("warm")];
  const tip = pt((warm.from + warm.to) / 2, r - (icon ? 4 : 3.5));
  const needle = icon
    ? `<path d="M${c} ${c} L${tip}" stroke="#E8EDEB" stroke-width="3.4" stroke-linecap="round"/>
       <circle cx="${c}" cy="${c}" r="3.6" fill="#0E1A24" stroke="#E8EDEB" stroke-width="2.4"/>`
    : `<path d="M${c} ${c} L${tip}" style="stroke:var(--bg)" stroke-width="4.6" stroke-linecap="round"/>
       <path d="M${c} ${c} L${tip}" style="stroke:var(--text)" stroke-width="2.2" stroke-linecap="round"/>
       <circle cx="${c}" cy="${c}" r="3.2" style="fill:var(--bg);stroke:var(--text)" stroke-width="2.2"/>`;

  return icon
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><rect width="44" height="44" rx="7" fill="#0E1A24"/>${arcs}${needle}</svg>`
    : `<svg class="wx-logo" viewBox="0 0 44 44" role="img" aria-label="Weather Effect">${arcs}${needle}</svg>`;
}

/* In the page: swap the header placeholder for the mark, and hand the tab
   the same drawing as its icon. */
if (typeof document !== "undefined"){
  const slot = document.getElementById("logo");
  if (slot) slot.outerHTML = logoMarkup("header");
  let link = document.querySelector('link[rel="icon"]');
  if (!link){
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = "data:image/svg+xml," + encodeURIComponent(logoMarkup("favicon"));
}
