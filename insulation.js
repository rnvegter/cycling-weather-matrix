/* ---------------------------------------------------------------
   Insulation inference.

   Turns a garment name — and, when the lookup service found any, the text of
   the manufacturer's own page — into clo / windproofness / waterproofness and
   a suggested temperature range.

   Two sources feed it:
     1. Fabric and technology names, which are the strongest signal. A garment
        built on Gore-Tex Infinium is windproof and not waterproof, whatever the
        marketing copy says; Shakedry is the reverse.
     2. Garment class and the usual descriptive words (winter, thermal, mesh,
        long sleeve), which set the baseline.

   Runs unchanged in the browser and in Node, so the same numbers come out
   whether or not the lookup service is reachable.
----------------------------------------------------------------*/

(function (root) {
  "use strict";

  /* Fabric and technology signatures. `clo` sets an absolute value, `cloAdd`
     nudges the baseline. First match of each property wins, so order matters:
     put the specific membranes above the generic words. */
  const FABRICS = [
    {re:/shake\s*-?dry/i,                     wind:0.95, water:1.00, clo:0.08,
     why:"Shakedry — the membrane is the outer surface, so it never wets out. Uninsulated."},
    {re:/gore-?tex\s*(pro|active|paclite)/i,  wind:0.95, water:1.00,
     why:"Gore-Tex — fully waterproof, taped construction."},
    {re:/gore-?tex\s*infinium|windstopper/i,  wind:0.90, water:0.50,
     why:"Gore-Tex Infinium / Windstopper — windproof and water-resistant, not waterproof."},
    {re:/polartec\s*power\s*shield/i,         wind:0.85, water:0.40, why:"Polartec Power Shield softshell."},
    {re:/polartec\s*power\s*stretch|power\s*-?stretch/i, wind:0.20, clo:0.30,
     why:"Powerstretch fleece — warm and very breathable, little wind resistance."},
    {re:/primaloft|polartec\s*alpha/i,        cloAdd:0.30, wind:0.60, water:0.40,
     why:"Synthetic insulation — significant loft."},
    {re:/pertex/i,                            wind:0.85, water:0.30, why:"Pertex windshell fabric."},
    {re:/nano\s*-?flex/i,                     wind:0.50, water:0.60, why:"Nano Flex — water-repellent thermal."},
    {re:/roubaix/i,                           clo:0.28, wind:0.25, why:"Roubaix brushed backing — thermal, minimal wind resistance."},
    {re:/ventamesh|air_?o\s*stretch|open\s*mesh/i, wind:0.05, cloAdd:-0.04,
     why:"Mesh panelling — deliberately open to the airflow."},
    {re:/softshell/i,                         wind:0.80, water:0.40, why:"Softshell construction."},
    {re:/hydrostatic|taped\s*seams|fully\s*waterproof|\b\d{4,5}\s*mm\b/i, water:0.90,
     why:"Waterproof rating quoted."},
    {re:/waterproof/i,                        water:0.85, generic:true, why:"Described as waterproof."},
    {re:/water[- ]?(resistant|repellent)|dwr/i, water:0.35, generic:true, why:"Water-repellent finish only."},
    {re:/wind\s*-?proof/i,                    wind:0.85, generic:true, why:"Described as windproof."},
    {re:/wind\s*-?(resistant|blocking)/i,     wind:0.55, generic:true, why:"Wind-resistant rather than windproof."},
    {re:/fleece|brushed|thermal|thermo|winter/i, cloAdd:0.14, generic:true, why:"Thermal / fleece-backed construction."},
    // Merino keeps you warm when damp, which is not the same as keeping water
    // out — so it sets no waterproofing, only the note.
    {re:/merino/i, why:"Merino — holds warmth when damp, unlike synthetics."}
  ];

  /* Baseline clo by slot, before fabric and descriptor adjustments. */
  const SLOT_BASE = {
    base:0.09, mid:0.15, shell:0.20, vest:0.07, arms:0.06,
    legs:0.15, legextra:0.10, hands:0.06, socks:0.04, feet:0.06, neck:0.05, head:0.04, eyes:0
  };
  const SLOT_WIND = {
    base:0.10, mid:0.20, shell:0.80, vest:0.55, arms:0.30,
    legs:0.25, legextra:0.25, hands:0.40, socks:0.15, feet:0.55, neck:0.45, head:0.35, eyes:0
  };

  /* Descriptive words that move the baseline. */
  const DESCRIPTORS = [
    {re:/sleeveless|mesh\s*base/i, cloAdd:-0.05, why:"Sleeveless."},
    {re:/short\s*sleeve|\bss\b/i,  cloAdd:-0.02, short:true, why:"Short sleeve."},
    {re:/long\s*sleeve|\bls\b/i,   cloAdd: 0.05, why:"Long sleeve."},
    // Plural only — "short sleeve" and "short finger" are not shorts.
    {re:/\bshorts\b/i,             cloAdd:-0.02, short:true, why:"Shorts."},
    {re:/\btights?\b/i,            cloAdd: 0.10, why:"Full-length tights."},
    {re:/winter\s*(jacket|coat|parka)/i, cloAdd:0.20, why:"Winter outer jacket — substantially insulated."},
    {re:/deep\s*winter|arctic|extreme/i, cloAdd:0.18, why:"Marketed for deep winter."},
    {re:/lightweight|ultralight|summer|packable/i, cloAdd:-0.05, pack:true, why:"Lightweight / packable."},
    {re:/upf|sun\s*sleeve/i,       cloAdd:-0.05, why:"Sun protection rather than insulation."},
    {re:/gilet|vest/i,             cloAdd:-0.03, why:"Sleeveless outer layer."},
    {re:/wind\s*(jacket|shell|breaker)/i, cloAdd:-0.10, pack:true, why:"Windshell — blocks wind without adding warmth."},
    {re:/short\s*finger|fingerless|\bmitts?\b/i, cloAdd:-0.10, short:true, why:"Short-finger / fingerless."},
    {re:/overshoe|shoe\s*cover|bootie/i, cloAdd:0.12, why:"Overshoe — covers the whole shoe."},
    {re:/knee\s*warmer/i,          cloAdd:-0.05, why:"Knees only, not the whole leg."}
  ];

  /* A thermal lining means something very different on a jacket and on a glove.
     Additive adjustments are scaled to the size of the garment. */
  const SLOT_CLO_SCALE = {
    base:0.7, mid:1, shell:1, vest:0.5, arms:0.4,
    legs:0.75, legextra:0.6, hands:0.35, socks:0.30, feet:0.35, neck:0.30, head:0.30, eyes:0
  };

  /* Merino weight is quoted in gsm and maps almost linearly onto clo. */
  function merinoClo(text, short){
    const m = text.match(/(\d{3})\s*gsm/i);
    if (!m) return null;
    const gsm = +m[1];
    if (gsm < 120 || gsm > 400) return null;
    // Fabric weight sets the insulation per unit area; sleeve length sets how
    // much of the rider it actually covers.
    const clo = gsm * 0.00095 * (short ? 0.65 : 1);
    return {clo: +clo.toFixed(3), why:`Merino at ${gsm} gsm${short ? ", short sleeve" : ""}.`};
  }

  /* Temperature ranges quoted on a product page, e.g. "4-18°C", "40 to 60°F". */
  function extractRanges(text){
    const out = [];
    const re = /(-?\d{1,2})\s*(?:°|deg(?:rees)?\s*)?\s*(?:C|F)?\s*(?:-|–|—|to|until)\s*(-?\d{1,3})\s*(?:°|deg(?:rees)?\s*)?\s*(C|F)\b/gi;
    let m;
    while ((m = re.exec(text)) !== null){
      let lo = +m[1], hi = +m[2];
      const unit = m[3].toUpperCase();
      if (unit === "F"){ lo = (lo - 32) * 5/9; hi = (hi - 32) * 5/9; }
      if (hi < lo) [lo, hi] = [hi, lo];
      if (lo < -30 || hi > 45 || hi - lo > 35 || hi - lo < 2) continue;
      // Only trust it if the surrounding text is actually about temperature.
      const around = text.slice(Math.max(0, m.index - 90), m.index + 90).toLowerCase();
      if (!/temp|range|ideal|suited|condition|weather|climate|wear|°|degree/.test(around)) continue;
      out.push({tmin: Math.round(lo), tmax: Math.round(hi)});
    }
    // Most frequently quoted range wins.
    const tally = new Map();
    out.forEach(r => { const k = `${r.tmin}|${r.tmax}`; tally.set(k, (tally.get(k) || 0) + 1); });
    let bestKey = null, bestN = 0;
    tally.forEach((n, k) => { if (n > bestN){ bestN = n; bestKey = k; } });
    if (!bestKey) return null;
    const [tmin, tmax] = bestKey.split("|").map(Number);
    return {tmin, tmax, mentions: bestN};
  }

  /* When no range is quoted, derive one from the insulation itself.

     The constants below are fitted to the seeded wardrobe, whose ranges are the
     rider's own calibration rather than any maker's claim. Each slot family
     needs its own mapping, because the same clo means different things
     depending on how the garment is worn: a base layer sits under everything,
     an arm warmer pairs with a jersey, and a jacket faces the weather alone. */
  function rangeFromClo(clo, slot, wind, water, short, name){
    const R = (tmin, tmax) => ({tmin: Math.round(tmin), tmax: Math.round(tmax)});
    name = name || "";

    if (slot === "eyes") return R(-10, 45);
    // A rain cap is worn for the spray, not the temperature.
    if (slot === "head" && /brim|rain\s*cap/i.test(name)) return R(-10, 25);

    // An uninsulated waterproof shell is worn over other layers whenever it's
    // raining, so temperature barely bounds it.
    if (water >= 0.85 && clo <= 0.12) return R(-10, 20);

    if (slot === "base"){
      const tmin = 14 - 85*clo;
      return R(tmin, clo <= 0.06 ? 40 : tmin + 10);
    }
    if (slot === "arms" || slot === "legextra"){
      const tmax = 21 - 75*clo;
      return R(tmax - 7, clo <= 0.045 ? 45 : tmax);
    }
    if (slot === "legs"){
      if (short || clo <= 0.15) return R(22 - 60*clo, 40);   // shorts
      const tmax = 18 - 40*clo;
      return R(tmax - 10, tmax);
    }
    if (slot === "neck" || slot === "head"){
      const tmax = 13 - 150*clo;
      return R(clo >= 0.05 ? -10 : tmax - 6, tmax);
    }
    if (slot === "hands" || slot === "feet" || slot === "socks"){
      const tmax = 17 - 90*clo;
      // Past a certain thickness it's the warmest thing you own for that slot,
      // so there's no lower bound worth quoting.
      return R(clo >= 0.09 ? -10 : tmax - 6, (short || clo <= 0.03) && water < 0.3 ? 40 : tmax);
    }
    // Torso outer layers: mid, shell, vest.
    // A light, non-windproof jersey is a summer garment with no upper limit.
    if (clo <= 0.13 && wind < 0.4 && slot === "mid") return R(22 - 60*clo, 40);
    const tmax = 20 - 24*clo;
    return R(tmax - 9, tmax);
  }

  function inferGarment(opts){
    const name = opts.name || "";
    const slot = SLOT_BASE[opts.slot] !== undefined ? opts.slot : "mid";
    const pageText = opts.text || "";
    // The name is the reliable part; page text is noisier, so it's weighted
    // only for fabric detection, not for the descriptor baseline.
    const hay = `${name} ${pageText}`;
    const evidence = [];

    let clo = SLOT_BASE[slot];
    let wind = SLOT_WIND[slot];
    let water = 0;
    let short = false, pack = false;
    let cloSet = false, windSet = false, waterSet = false;

    const scale = SLOT_CLO_SCALE[slot] !== undefined ? SLOT_CLO_SCALE[slot] : 1;

    DESCRIPTORS.forEach(d => {
      if (!d.re.test(name)) return;
      if (d.cloAdd) clo += d.cloAdd * scale;
      if (d.short) short = true;
      if (d.pack) pack = true;
      evidence.push(d.why);
    });

    /* Scraped pages carry navigation, related products and reviews of other
       garments, so a keyword appearing once proves nothing — a Perfetto page
       that mentions Shakedry in a sidebar must not come back waterproof.
       Score each signature by where it appears and how often, then let the
       best-supported one set each property. */
    const count = (text, re) => {
      if (!text) return 0;
      const g = new RegExp(re.source, "gi");
      let n = 0; while (g.exec(text) !== null && n < 50) n++;
      return n;
    };
    const scored = FABRICS.map(fb => {
      const inName = fb.re.test(name);
      const hits = count(pageText, fb.re);
      const specificity = fb.generic ? 0.4 : 1;
      return {fb, inName, hits, score: (inName ? 6 : 0) + Math.min(hits, 5) * specificity};
    })
    // A single passing mention in page text isn't evidence; the name always is.
    .filter(x => x.inName || x.score >= 1.2)
    .sort((a, b) => b.score - a.score);

    scored.forEach(({fb, inName, hits}) => {
      let used = false;
      if (fb.clo !== undefined && !cloSet){ clo = fb.clo; cloSet = true; used = true; }
      // A named membrane states the insulation outright. Don't let the word
      // "thermal", picked up from surrounding page copy, then pile on top of it.
      if (fb.cloAdd && !(fb.generic && cloSet)){
        const delta = fb.cloAdd * scale * (inName ? 1 : 0.5);
        if (delta) { clo += delta; used = true; }
      }
      if (fb.wind !== undefined && !windSet){ wind = fb.wind; windSet = true; used = true; }
      if (fb.water !== undefined && !waterSet){ water = fb.water; waterSet = true; used = true; }
      if (used) evidence.push(fb.why + (inName ? "" : ` (found ${hits}× on the page)`));
    });

    const mer = merinoClo(hay, short);
    if (mer && !cloSet){ clo = mer.clo; evidence.push(mer.why); }

    clo = Math.max(0, Math.round(clo * 1000) / 1000);
    wind = Math.min(1, Math.max(0, Math.round(wind * 100) / 100));
    water = Math.min(1, Math.max(0, Math.round(water * 100) / 100));

    const quoted = pageText ? extractRanges(pageText) : null;
    const derived = rangeFromClo(clo, slot, wind, water, short, name);
    if (quoted) evidence.push(`Temperature range quoted on the page: ${quoted.tmin} to ${quoted.tmax}°C.`);
    else evidence.push(`No range quoted — ${derived.tmin} to ${derived.tmax}°C derived from ${clo} clo.`);

    // Confidence: how much of this came from real signals rather than defaults.
    let confidence = "low";
    const hits = (cloSet?1:0) + (windSet?1:0) + (waterSet?1:0);
    if (pageText && quoted && hits >= 2) confidence = "high";
    else if (hits >= 2 || (pageText && quoted)) confidence = "medium";

    return {
      clo, wind, water, short, pack,
      tmin: quoted ? quoted.tmin : derived.tmin,
      tmax: quoted ? quoted.tmax : derived.tmax,
      rangeQuoted: !!quoted,
      derivedRange: derived,
      confidence,
      evidence: [...new Set(evidence)]
    };
  }

  const api = {inferGarment, extractRanges, rangeFromClo, FABRICS};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
