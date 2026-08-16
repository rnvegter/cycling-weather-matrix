"use strict";

/* ---------------------------------------------------------------
   A small map, so the bearing means something.

   "Set off towards the WSW" is only useful if you know which way that is from
   where you are standing. The compass rose gives the angle; this gives it a
   place — the route or the start point drawn north-up, with the wind and the
   outbound bearing over the top.

   Tiles come from OpenStreetMap, which needs no key but does need crediting.
   Everything except the tiles is drawn here, so if they fail to load — no
   network, a blocked host, an offline server — the route, the arrows and the
   scale all still render on a plain background.
----------------------------------------------------------------*/

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/* Web Mercator, in fractional tile units. */
const lon2x = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
const lat2y = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
};

/* The largest zoom at which the whole thing still fits the frame. */
function fitZoom(bounds, w, h, maxZoom){
  for (let z = (maxZoom || 16); z >= 1; z--){
    const dx = (lon2x(bounds.east, z) - lon2x(bounds.west, z)) * TILE;
    const dy = (lat2y(bounds.south, z) - lat2y(bounds.north, z)) * TILE;
    if (dx <= w && dy <= h) return z;
  }
  return 1;
}

function boundsOf(points){
  let north = -90, south = 90, east = -180, west = 180;
  points.forEach(p => {
    north = Math.max(north, p.lat); south = Math.min(south, p.lat);
    east  = Math.max(east,  p.lon); west  = Math.min(west,  p.lon);
  });
  return {north, south, east, west};
}

/* Pad a bounds box so a route never runs into the edge of the frame, and so a
   single point becomes an area rather than a zero-sized box. */
function padBounds(b, fraction, minSpan){
  const latSpan = Math.max(b.north - b.south, minSpan);
  const lonSpan = Math.max(b.east - b.west, minSpan);
  const padLat = latSpan * fraction, padLon = lonSpan * fraction;
  const cLat = (b.north + b.south) / 2, cLon = (b.east + b.west) / 2;
  return {
    north: cLat + latSpan/2 + padLat, south: cLat - latSpan/2 - padLat,
    east:  cLon + lonSpan/2 + padLon, west:  cLon - lonSpan/2 - padLon
  };
}

/* Metres per pixel at this latitude and zoom, for the scale bar. */
const metresPerPixel = (lat, z) =>
  156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);

function scaleBar(lat, z, maxPx){
  const mpp = metresPerPixel(lat, z);
  const targets = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let best = targets[0];
  targets.forEach(t => { if (t / mpp <= maxPx) best = t; });
  return {metres: best, px: Math.round(best / mpp),
          label: best >= 1000 ? `${best/1000} km` : `${best} m`};
}

/* ---------------------------------------------------------------
   Render. `points` draws a route; without them it centres on one place.
----------------------------------------------------------------*/
function renderMap(opts){
  const w = opts.width, h = opts.height;
  const pts = opts.points && opts.points.length > 1 ? opts.points : null;

  // A lone point gets about a 12 km box, which is enough to recognise where
  // you are without becoming a street plan.
  const raw = pts ? boundsOf(pts) : {north:opts.lat, south:opts.lat, east:opts.lon, west:opts.lon};
  const b = padBounds(raw, pts ? 0.12 : 0, pts ? 0 : 0.11);

  const z = fitZoom(b, w, h, 15);
  const cLat = (b.north + b.south) / 2, cLon = (b.east + b.west) / 2;

  // Centre the frame on the middle of the box, in pixels at this zoom.
  const cx = lon2x(cLon, z) * TILE, cy = lat2y(cLat, z) * TILE;
  const originX = cx - w/2, originY = cy - h/2;
  const project = p => [lon2x(p.lon, z) * TILE - originX, lat2y(p.lat, z) * TILE - originY];

  // Tiles covering the frame.
  const x0 = Math.floor(originX / TILE), x1 = Math.floor((originX + w) / TILE);
  const y0 = Math.floor(originY / TILE), y1 = Math.floor((originY + h) / TILE);
  const max = Math.pow(2, z);
  const tiles = [];
  for (let x = x0; x <= x1; x++){
    for (let y = y0; y <= y1; y++){
      if (y < 0 || y >= max) continue;
      const wrapped = ((x % max) + max) % max;
      tiles.push(`<img src="${TILE_URL(z, wrapped, y)}" alt="" loading="lazy"
        style="left:${Math.round(x*TILE - originX)}px;top:${Math.round(y*TILE - originY)}px">`);
    }
  }

  /* --- Overlay ------------------------------------------------- */
  let path = "", start = "", finish = "";
  if (pts){
    // One point per pixel or so is plenty; a 5,000-point GPX doesn't need to
    // become a 5,000-point path.
    const step = Math.max(1, Math.floor(pts.length / 400));
    const d = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
                 .map((p, i) => {
                   const [x, y] = project(p);
                   return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
                 }).join("");
    path = `<path d="${d}" fill="none" stroke="var(--bg)" stroke-width="5"
              stroke-linejoin="round" stroke-linecap="round" opacity=".55"/>
            <path d="${d}" fill="none" stroke="var(--temp)" stroke-width="2.5"
              stroke-linejoin="round" stroke-linecap="round"/>`;
    const [sx, sy] = project(pts[0]);
    const [fx, fy] = project(pts[pts.length - 1]);
    finish = `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="4"
                fill="none" stroke="var(--text)" stroke-width="2"/>`;
    start = `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5.5"
               fill="var(--text)" stroke="var(--bg)" stroke-width="2"/>`;
  } else {
    const [px, py] = project({lat:opts.lat, lon:opts.lon});
    start = `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6"
               fill="var(--text)" stroke="var(--bg)" stroke-width="2.5"/>`;
  }

  // The two arrows, anchored at the start so they read as "from here".
  const anchor = pts ? project(pts[0]) : project({lat:opts.lat, lon:opts.lon});
  const ray = (deg, len, colour, width, dash) => {
    const a = (deg - 90) * Math.PI / 180;
    const x = anchor[0] + Math.cos(a) * len, y = anchor[1] + Math.sin(a) * len;
    const d = `M${anchor[0].toFixed(1)} ${anchor[1].toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
    const head = colour === "var(--minus)" ? "wind" : "go";
    // Drawn twice: a background-coloured halo first, so the arrow stays legible
    // over motorways, forest and coastline rather than only over open water.
    return `<path d="${d}" stroke="var(--bg)" stroke-width="${width + 3.5}"
              stroke-linecap="round" opacity=".65"/>
            <path d="${d}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"
              ${dash ? `stroke-dasharray="${dash}"` : ""} marker-end="url(#wx-map-head-${head})"/>`;
  };

  const reach = Math.min(w, h) * 0.34;
  const windRay = opts.windFrom != null
    ? ray((opts.windFrom + 180) % 360, reach * 0.8, "var(--minus)", 3)
    : "";
  const goRay = opts.outbound != null
    ? ray(opts.outbound, reach, "var(--temp)", 3, "5 4")
    : "";

  const sb = scaleBar(cLat, z, w * 0.3);

  return `
  <figure class="wx-map" style="height:${h}px">
    <div class="wx-map__tiles">${tiles.join("")}</div>
    <svg class="wx-map__ink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <defs>
        <marker id="wx-map-head-wind" viewBox="0 0 10 10" refX="7" refY="5"
                markerWidth="4.5" markerHeight="4.5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--minus)"/></marker>
        <marker id="wx-map-head-go" viewBox="0 0 10 10" refX="7" refY="5"
                markerWidth="4.5" markerHeight="4.5" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--temp)"/></marker>
      </defs>
      ${path}${windRay}${goRay}${finish}${start}
      <g class="wx-map__north" transform="translate(${w - 26} 22)">
        <path d="M0 12 L0 -10" stroke="var(--text)" stroke-width="1.6"/>
        <path d="M0 -13 L-4 -5 L4 -5 z" fill="var(--text)"/>
        <text x="0" y="24" text-anchor="middle" font-size="9"
              font-family="var(--data)" fill="var(--text)">N</text>
      </g>
      <g transform="translate(12 ${h - 14})">
        <path d="M0 0 h${sb.px}" stroke="var(--text)" stroke-width="2"/>
        <path d="M0 -4 v8 M${sb.px} -4 v8" stroke="var(--text)" stroke-width="2"/>
        <text x="${sb.px/2}" y="-6" text-anchor="middle" font-size="9"
              font-family="var(--data)" fill="var(--text)">${sb.label}</text>
      </g>
    </svg>
    <figcaption class="wx-map__credit">
      &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank"
        rel="noreferrer">OpenStreetMap</a> contributors
    </figcaption>
  </figure>`;
}
