/* ---------------------------------------------------------------
   The model: air temperature -> ride-feel -> outfit -> heat-balance check.
----------------------------------------------------------------*/

const r1 = n => Math.round(n*10)/10;
const r2 = n => Math.round(n*100)/100;
const clamp = (n,a,b) => Math.min(b, Math.max(a, n));
const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compass = deg => COMPASS[Math.round(((deg%360)+360)%360 / 22.5) % 16];

/* Generic bands, keyed to ride-feel. Used when the rider hasn't got their own
   inventory loaded, and shown as the reference matrix either way. */
const BANDS = [
  {min: 25, label:"25 and up", core:"Short-sleeve jersey, mesh base layer or none", legs:"Bib shorts", ext:"Bare hands or mitts, light socks, sunglasses, cap for sun"},
  {min: 20, label:"20 to 25",  core:"SS jersey, light base layer", legs:"Bib shorts", ext:"Mitts, sunglasses"},
  {min: 15, label:"15 to 20",  core:"SS jersey, light base layer", legs:"Bib shorts", ext:"Mitts; arm warmers in the pocket for the first 30 min"},
  {min: 12, label:"12 to 15",  core:"SS jersey + arm warmers, base layer", legs:"Bib shorts + knee warmers", ext:"Mitts or light full gloves; gilet in pocket for descents"},
  {min:  9, label:"9 to 12",   core:"LS thermal jersey, or SS + arm warmers + gilet", legs:"Knee or leg warmers", ext:"Full-finger gloves, headband if windy"},
  {min:  5, label:"5 to 9",    core:"LS thermal jersey + gilet, long-sleeve base layer", legs:"Leg warmers or bib tights", ext:"Winter gloves, thermal headband, toe covers"},
  {min:  2, label:"2 to 5",    core:"Winter thermal jacket + thermal base layer", legs:"Bib tights, or leg warmers doubled with knee warmers", ext:"Winter gloves, thermal cap, overshoes, thicker socks"},
  {min: -2, label:"-2 to 2",   core:"Winter jacket + thermal base + LS thermal jersey underneath", legs:"Bib tights (thermal)", ext:"Winter gloves, thermal cap over the ears, overshoes — fingers and toes are the limiting factor"},
  {min:-99, label:"below -2",  core:"Maximum layering, and the kit is at its limit", legs:"Everything you own", ext:"Shorten the ride; black ice on shaded corners and bridge decks"}
];
const bandFor = t => BANDS.find(b => t >= b.min) || BANDS[BANDS.length-1];

/* The temperature ramp used for colour. Kept separate from BANDS, which decide
   what to wear: these are the seven steps of the visual scale, and a garment's
   colour should not shift just because an advice threshold moved. */
const RAMP_MIN = -5, RAMP_MAX = 30;
function rampFor(t){
  if (t <  -2) return "t-frozen";
  if (t <   4) return "t-cold";
  if (t <  10) return "t-cool";
  if (t <  15) return "t-mild";
  if (t <  20) return "t-warm";
  if (t <  25) return "t-hot";
  return "t-baking";
}
/* Position on the ramp, 0–100%, for markers and range bars. */
const rampPos = t => clamp((t - RAMP_MIN) / (RAMP_MAX - RAMP_MIN) * 100, 0, 100);

const BASE_SPEED = {road:27, gravel:22, mtb:16};
const PACE_SPEED = {easy:0.85, steady:1, hard:1.12};

/* The chill you make yourself. Extracted because it is the only place speed
   touches ride-feel, which makes it also the exact size of the error when the
   speed was guessed wrong — see rideNumbersFromActual in history.js. */
function selfWindTerm(air, speed){
  const speedFactor = clamp(speed / 27, 0.55, 1.45);
  return Math.round((air < 15 ? -3 : -1) * speedFactor * 2) / 2;
}

/* ---------------------------------------------------------------
   Ride-feel. Standing-still "feels like" numbers are wrong on a bike,
   so start from air temperature and adjust for what the rider is doing.
----------------------------------------------------------------*/
function rideFeel(w, opts){
  const rows = [];
  const air = w.tStart;                       // dress for the start
  rows.push({label:"Air temperature at start", v:air, base:true});

  // Self-generated wind, scaled by actual average speed rather than a fixed 25-30 km/h.
  const self = selfWindTerm(air, opts.speed);
  rows.push({label:`Self-generated wind at ${r1(opts.speed)} km/h`, v:self});

  // Ambient wind only bites below 12°C.
  let ambient = 0;
  if (air < 12 && w.wind > 15) ambient = -Math.ceil((w.wind - 15) / 10);
  if (ambient) rows.push({label:`Ambient wind ${Math.round(w.wind)} km/h from the ${compass(w.dir)}`, v:ambient});

  // Rain. Drizzle and steady rain are not the same problem.
  const raining = w.precipTotal >= 0.2 || w.prob >= 60;
  const light = raining && w.precipTotal < 1 && w.precipPeak < 0.5;
  let rain = 0;
  if (raining) rain = (air < 10 ? -6 : -4) * (light ? 0.5 : 1);
  if (rain) rows.push({label:`${light ? "Drizzle" : "Getting rained on"} (${Math.round(w.prob)}% chance, ${r1(w.precipTotal)} mm)`, v:rain});

  let sun = 0;
  if (!raining && w.cloud < 35 && w.wind < 15 && w.dark < 0.3) sun = 2;
  if (sun) rows.push({label:"Full sun, low wind", v:sun});

  let dark = 0;
  if (w.dark >= 0.4) dark = -2;
  if (dark) rows.push({label:"Riding in the dark", v:dark});

  let pace = 0;
  if (opts.pace === "hard") pace = 2;
  if (opts.pace === "easy") pace = -2;
  if (pace) rows.push({label: pace > 0 ? "Hard pace or group ride" : "Easy pace, café or photo stops", v:pace});

  let terrain = 0;
  if (opts.terrain === "exposed") terrain = -2;
  if (terrain) rows.push({label:"Long descents or exposed ground", v:terrain});

  // The only factor that does NOT apply to hands and feet.
  let cal = 0;
  if (opts.rider === "hot") cal = 3;
  if (opts.rider === "cold") cal = -3;
  if (cal) rows.push({label: cal > 0 ? "Rider runs hot" : "Rider runs cold", v:cal, calibration:true});

  // What the rides themselves say, on top of the preset. Shown as its own row
  // rather than folded in, because a correction you cannot see is one you
  // cannot argue with.
  const learned = opts.learned || 0;
  if (learned){
    cal += learned;
    rows.push({label: opts.learnedLabel || "Learned from your rides",
               v: Math.round(learned * 10) / 10, calibration:true});
  }

  const feel = air + self + ambient + rain + sun + dark + pace + terrain + cal;
  // What the environment is doing, for the heat-balance sum: everything except
  // the rider's own preference (not physics) , the pace bonus (already in the
  // work rate) and the self-generated wind (handled as apparent airflow).
  const envTemp = air + ambient + rain + sun + dark + terrain;
  return {
    rows, feel: Math.round(feel), extFeel: Math.round(feel - cal), envTemp,
    raining, light, wet: raining && !light, air
  };
}

/* ---------------------------------------------------------------
   Heat balance.

   Required insulation:  It ≈ 0.148 × (33 − Ta) / M  clo
     33°C  minimum comfortable skin temperature
     M     metabolic rate in MET (1 MET = 58.2 W/m²)
   Cycling MET from the Compendium of Physical Activities, by average speed.

   Worn insulation is the static (catalogue) clo of the ensemble knocked down
   by the apparent wind, which on a bike is mostly self-generated. How much it
   gets knocked down depends on the OUTERMOST layer: a 75g windproof gilet
   preserves far more of the stack beneath it than a thicker permeable fleece.
----------------------------------------------------------------*/
function metFor(kmh){
  if (kmh < 16)   return 4.5;
  if (kmh < 19.3) return 6.8;
  if (kmh < 22.5) return 8.0;
  if (kmh < 25.7) return 10.0;
  if (kmh < 32.2) return 12.0;
  return 16.8;
}

/* Fraction of static insulation surviving the airflow, for a fully permeable
   garment. ISO 9920's correction is only validated to ~3 m/s, so it is applied
   to 3 and then decayed gently to a floor — cycling sits well past its range. */
function permeableFactor(v){
  const vc = clamp(v, 0.15, 3) - 0.15;
  let f = Math.exp(-0.281*vc + 0.044*vc*vc);
  if (v > 3) f *= (1 - 0.06*(v - 3));
  return clamp(f, 0.42, 1);
}

function heatBalance(f, w, opts, outfit){
  const met = metFor(opts.speed);
  const required = Math.max(0, 0.148 * (33 - f.envTemp) / met);

  // Apparent wind: own speed plus roughly half the ambient, averaged over a loop.
  const vApparent = opts.speed/3.6 + 0.4 * w.wind/3.6;
  const perm = permeableFactor(vApparent);

  // Torso stack: the outermost layer governs how much wind gets in.
  const torso = outfit.filter(it => ["base","mid","shell","vest"].includes(it.slot));
  const outerWind = torso.length ? Math.max(...torso.map(it => it.wind)) : 0;
  const shelter = 1 - (1 - perm) * (1 - outerWind);
  const staticClo = torso.reduce((a,it) => a + it.clo, 0);
  const worn = staticClo * shelter;

  const ratio = required > 0.02 ? worn / required : 1;
  let verdict = "about right", detail = "";
  // Tolerances are deliberately wide. The formula is a dry-heat requirement for
  // a fully covered body; a working cyclist dumps a lot of heat evaporatively
  // and through bare skin, so only a clear mismatch is worth flagging. Under-
  // insulation only matters on the cold side — above ~15°C surplus heat can
  // always be sweated away.
  if (ratio < 0.7 && f.air < 15){
    verdict = "light for the conditions";
    detail = "A windproof outer layer buys more here than a thicker permeable one.";
  } else if (ratio > 1.6 && f.air > 2){
    verdict = "warm for the conditions";
    detail = "Worth having something you can shed rather than a layer you're stuck in.";
  }
  return {met, required, worn, staticClo, shelter, perm, outerWind, vApparent, ratio, verdict, detail};
}

/* ---------------------------------------------------------------
   Outfit selection, driven entirely by the gear inventory.
   Ranges pick the garment; clo breaks ties and sizes the whole stack.
----------------------------------------------------------------*/
function pickOutfit(f, w, opts, gear){
  const rf = f.feel, ex = f.extFeel;
  const windy = w.wind >= 22 || w.gust >= 45 || opts.terrain === "exposed";
  const longRide = opts.hours >= 3;
  const swing = w.tMax - w.tMin;

  const live = gear.filter(g => !g.off);
  const inSlot = s => live.filter(g => g.slot === s);
  const fits = (it, t) => t >= it.tmin && t <= it.tmax;
  // How well a garment is centred on the target temperature.
  const centred = (it, t) => Math.abs(((it.tmin + it.tmax)/2) - t);
  const best = (list, t) => list.length ? list.slice().sort((a,b) => centred(a,t) - centred(b,t))[0] : null;

  const wear = [], pocket = [], notes = [];
  const push = (it, why) => { if (it && !wear.includes(it)) { wear.push(it); if (why) it._why = why; } };

  /* Colder than everything in a slot: fall back to the warmest thing there and
     record that it's past its limit. Warmer than everything: return nothing,
     because bare hands and uncovered feet are a valid answer in July. */
  const edges = [];
  function bestOrEdge(slot, t){
    const usable = inSlot(slot).filter(i => !i.rainOnly);
    if (!usable.length) return null;
    const fitting = usable.filter(i => fits(i, t));
    if (fitting.length) return best(fitting, t);
    if (t > Math.max(...usable.map(i => i.tmax))) return null;
    const pick = usable.slice().sort((a,b) => b.clo - a.clo)[0];
    edges.push(SLOT_LABEL[slot].toLowerCase());
    return pick;
  }

  /* --- Torso outer layer -----------------------------------------
     A breathable jersey is the default and the more adjustable choice, so it
     takes the outer slot whenever one actually covers the temperature. Rain,
     wind, and cold beyond any jersey's range hand the slot to a shell. */
  let mid = best(inSlot("mid").filter(m => fits(m, rf)), rf);
  let shell = null;
  const shells = inSlot("shell").filter(s => fits(s, rf));
  if (f.wet){
    // Staying wet the whole ride: wear the waterproof one. Showers: carry it.
    const proof = shells.filter(s => s.water >= 0.8);
    const showersOnly = w.wetHours < w.hoursCount * 0.6;
    if (proof.length && !showersOnly){
      // Wet from the start and staying wet: prefer the one worn AS the kit over
      // the one that packs away — a packable shell is for rain that comes and goes.
      const worn_ = proof.filter(s => !s.pack);
      shell = best(worn_.length ? worn_ : proof, rf);
    }
    else if (proof.length){
      const carry = proof.find(s => s.pack) || proof[0];
      pocket.push([carry, "Goes over the kit when the shower arrives, back in the pocket when it clears."]);
    } else if (shells.length){
      shell = best(shells.filter(s => s.water >= 0.5), rf) || best(shells, rf);
      notes.push("Nothing fully waterproof in range — this is water-resistant only, so expect to be wet through in sustained rain.");
    }
  } else if (f.light){
    const carry = shells.filter(s => s.water >= 0.8 && s.pack);
    if (carry.length) pocket.push([best(carry, rf), "Drizzle: carry it rather than ride in it. A shell over a hot rider is a sauna."]);
  } else if (windy && rf < 16){
    const wind = shells.filter(s => s.wind >= 0.6);
    if (wind.length) shell = best(wind, rf);
  } else if (!mid){
    shell = bestOrEdge("shell", rf);
  }
  // Colder than every jersey AND every shell: take the warmest jersey anyway.
  if (!shell && !mid) mid = bestOrEdge("mid", rf);

  // A warm shell (Perfetto, winter jacket) is itself the mid layer, and a race-cut
  // shell has room for a base only.
  const shellIsWarm = shell && shell.clo >= 0.28;
  if (shellIsWarm) mid = null;
  else if (shell && shell.clo < 0.2 && shell.short && mid && mid.clo > 0.15) mid = null;

  /* --- Base ----------------------------------------------------- */
  let base = bestOrEdge("base", rf);
  // In the wet, prefer merino: it holds warmth when damp, synthetics don't.
  if (f.wet){
    const wetBase = inSlot("base").filter(b => fits(b, rf) && /merino/i.test(b.name));
    if (wetBase.length) base = best(wetBase, rf);
  }

  if (shell) push(shell);
  if (mid) push(mid);
  if (base) push(base);

  /* --- Arms: only if the top layer is short-sleeved -------------- */
  const topLayer = shell || mid;
  if (topLayer && topLayer.short){
    const arms = inSlot("arms").filter(a => fits(a, rf) && !a.rainOnly);
    const pick = f.raining ? (best(arms.filter(a => a.water >= 0.5), rf) || best(arms, rf)) : best(arms, rf);
    if (pick){
      if (rf >= 14 && pick.pack) pocket.push([pick, "In the pocket for the first 30 minutes, off at the first climb."]);
      else push(pick);
    }
  }

  /* --- Legs. Bands overlap: take the lower option when long, slow or wet. */
  const legFeel = rf - (longRide?1:0) - (f.wet?1:0) - (opts.pace==="easy"?1:0);
  let legsPick = best(inSlot("legs").filter(l => fits(l, legFeel)), legFeel);
  if (!legsPick && legFeel >= 4){
    // No single leg garment covers this, but shorts plus a warmer will — that's
    // the whole 8–13°C band, and it's removable in a way tights aren't.
    const shorts = best(inSlot("legs").filter(l => l.short), legFeel);
    const extra = best(inSlot("legextra").filter(l => fits(l, legFeel)), legFeel);
    if (shorts && extra) legsPick = shorts;
  }
  if (!legsPick) legsPick = bestOrEdge("legs", legFeel) || best(inSlot("legs"), legFeel);
  if (legsPick){
    push(legsPick);
    if (legsPick.short && legFeel < legsPick.tmin){
      const extra = best(inSlot("legextra").filter(l => fits(l, legFeel)), legFeel);
      if (extra) push(extra);
      else notes.push(`No leg warmer you own covers ${legFeel}°C over shorts.`);
    } else if (legFeel < legsPick.tmin){
      const extra = best(inSlot("legextra").filter(l => l.tmin <= legFeel), legFeel);
      if (extra) push(extra, "Over the top — the tights alone don't reach this far down.");
    }
  }

  /* --- Extremities run on the air-based number ------------------- */
  ["hands","feet","neck","head"].forEach(slot => push(bestOrEdge(slot, ex)));
  // Feet get covered in the wet whatever the temperature.
  if (f.wet && !wear.some(i => i.slot === "feet")){
    const feet = best(inSlot("feet"), ex);
    if (feet) push(feet, "Wet feet are the complaint that outlasts the ride.");
  }
  /* Rain-only items, wherever they live. A brimmed cap and waterproof
     over-trousers are the same kind of thing: chosen by the weather rather than
     the temperature, and worn over whatever is already on. */
  if (f.wet){
    SLOTS.forEach(([slot]) => {
      const pick = inSlot(slot).filter(i => i.rainOnly)
        .sort((a, b) => b.water - a.water)[0];
      if (pick && !wear.includes(pick)) push(pick);
    });
  }

  const eyes = inSlot("eyes").filter(i => !!i.rainOnly === (f.raining || w.dark >= 0.4));
  if (eyes.length) push(eyes[0]);

  /* --- Gilet, and the clo check ---------------------------------- */
  let hb = heatBalance(f, w, opts, wear);
  // The clo check is allowed to add a gilet only when it's genuinely cold. The
  // garment ranges are the selector; the heat balance is a check on top of them.
  if (hb.ratio < 0.85 && rf < 12 && !wear.some(i => i.slot === "vest")){
    const vest = best(inSlot("vest").filter(v => fits(v, rf)), rf);
    if (vest){
      // Windy days want the windproof one; still days the breathable one.
      const vests = inSlot("vest").filter(v => fits(v, rf));
      const choice = windy ? vests.slice().sort((a,b) => b.wind - a.wind)[0] : vest;
      push(choice, windy ? "Exposed and blowing — the Breaker front actually blocks it."
                         : "Air-permeable front won't cook you, and the pockets mean it can stay on.");
      hb = heatBalance(f, w, opts, wear);
    }
  }

  /* --- Pocket --------------------------------------------------- */
  if (swing > 5){
    const shed = wear.find(i => i.slot === "vest" || i.slot === "arms" || i.slot === "legextra");
    if (shed) notes.push(`Air climbs ${r1(swing)}°C across the ride — the ${shed.name.toLowerCase()} is what comes off.`);
    else {
      const outer = wear.find(i => i.slot === "shell");
      if (outer && !outer.pack)
        notes.push(`Air climbs ${r1(swing)}°C and the ${outer.name} can't come off mid-ride. If you'd rather shed than cook, drop to a jersey with a packable layer over it.`);
      const carry = best(inSlot("vest").filter(v => v.pack), rf);
      if (carry && !wear.includes(carry)) pocket.push([carry, "Dress for the start and shed as it warms."]);
    }
  }
  if (!f.raining && w.prob >= 30 && w.prob < 60){
    const rainShell = inSlot("shell").filter(s => s.water >= 0.8 && s.pack)[0];
    if (rainShell && !pocket.some(p => p[0] === rainShell) && !wear.includes(rainShell))
      pocket.push([rainShell, `${Math.round(w.prob)}% chance of rain — the insurance policy.`]);
  }

  if (edges.length)
    notes.push(`Colder than anything you own for ${[...new Set(edges)].join(", ")} — what's listed is the warmest you have, and it's past its limit. Be honest about shortening the ride.`);

  GEAR_GAPS.forEach(g => { if (g.when(f)) notes.push(g.text); });

  return {wear, pocket, notes, hb};
}

/* Generic fallback — the band table, extremities picked on the air-based number. */
function genericOutfit(f, w, opts){
  const cb = bandFor(f.feel), eb = bandFor(f.extFeel);
  const wear = [
    {_label:"Core", name:cb.core, _why:""},
    {_label:"Legs", name:cb.legs, _why:""},
    {_label:"Extremities", name:eb.ext, _why: eb !== cb ? `Hands and feet run colder — picked on the ${f.extFeel}°C number, not the core one.` : ""}
  ];
  const pocket = [];
  if (f.wet && f.feel < 15)
    wear.push({_label:"Shell", name:"Waterproof jacket, overshoes, brimmed cap under the helmet",
      _why:"Below 15°C ride-feel, or rain lasting more than half an hour, the shell wins."});
  else if (f.raining)
    pocket.push([{name:"Gilet"}, "In light rain above 15°C, a gilet plus getting wet beats a sauna — unless there's a long descent."]);
  if (w.tMax - w.tMin > 5)
    pocket.push([{name:"Removable layer"}, `Air goes ${r1(w.tStart)}°C → ${r1(w.tEnd)}°C. Dress for the start, carry something pocketable.`]);
  if (!f.raining && w.prob >= 30 && w.prob < 60)
    pocket.push([{name:"Packable shell"}, `${Math.round(w.prob)}% chance of rain.`]);
  return {wear, pocket, notes:[], hb:null};
}

/* --- Watch-for: only things that change a decision --------------- */
function watchFor(f, w, opts){
  const out = [];
  if (w.wind >= 20)
    out.push(`Wind ${Math.round(w.wind)} km/h from the ${compass(w.dir)}. Plan the outbound leg into it so you finish with a tailwind — the other way round you arrive cold, tired and underdressed for how slowly you're going.`);
  if (w.gust >= 50)
    out.push(`Gusts to ${Math.round(w.gust)} km/h. On open ground — dikes, polder, coastal road, ridgeline — that's a safety point, not a comfort one${opts.type !== "road" ? ", especially on gravel" : " with deep-section wheels"}.`);
  if (w.tMin <= 2)
    out.push("Black ice on shaded corners and bridge decks. They freeze first and thaw last.");

  // Measured rather than inferred: the altitude of 0°C, against the ground you
  // will actually be on.
  if (w.freezingLevel != null && opts.maxElevation != null){
    const gap = w.freezingLevel - opts.maxElevation;
    if (gap < 0)
      out.push(`The freezing line sits at ${Math.round(w.freezingLevel)} m and your high point is ${Math.round(opts.maxElevation)} m — the top of this ride is below zero, whatever the valley says.`);
    else if (gap < 300)
      out.push(`Freezing line at ${Math.round(w.freezingLevel)} m, only ${Math.round(gap)} m above your high point. Close enough that a colder-than-forecast morning puts ice on the top.`);
  }
  if (w.dark >= 0.2 && w.dark < 1)
    out.push(`Part of this ride is in the dark — sunrise ${fmtTime(w.sunrise)}, sunset ${fmtTime(w.sunset)}. Lights.`);
  else if (w.dark >= 1)
    out.push("Whole ride is in the dark. Lights, and reflective on the moving parts — ankles read best.");
  if (f.raining && w.hourly.length > 1){
    const first = w.hourly.find(h => h.precip >= 0.1);
    const dry = w.hourly.filter(h => h.precip < 0.1).length;
    // The quarter-hourly feed knows 08:45 where the hourly one can only say
    // "sometime in the 09:00 hour", and that decides whether you leave early.
    if (w.rainStart15)
      out.push(`Rain starts about ${fmtTime(w.rainStart15)} — near enough to the quarter hour to be worth leaving before.`);
    else if (first && dry > 0)
      out.push(`Rain starts around ${fmtTime(first.time)} — ${dry} of ${w.hourly.length} hours look dry.`);
  }

  // Hay fever on a bike: hard breathing, through the mouth, at head height in
  // open country for hours.
  if (w.pollen && w.pollen.worst){
    const band = pollenBand(w.pollen.worst.count);
    if (band)
      out.push(`${band.charAt(0).toUpperCase() + band.slice(1)} ${w.pollen.worst.name} pollen, ${Math.round(w.pollen.worst.count)} grains/m³. If that bothers you, it is worth an antihistamine before you leave rather than halfway round.`);
  }
  return out;
}

const fmtTime = s => s ? s.slice(11,16) : "—";
