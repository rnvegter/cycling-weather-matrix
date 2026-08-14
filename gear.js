/* ---------------------------------------------------------------
   Gear inventory: the editable list the wardrobe advice is drawn from.

   Each item carries:
     slot   which part of the outfit it competes for
     tmin   coldest ride-feel °C it still works at
     tmax   warmest ride-feel °C it still works at
     clo    static thermal insulation (1 clo = 0.155 m²K/W)
     wind   windproofness 0–1 (0 = open mesh, 1 = sealed membrane)
     water  waterproofness 0–1 (0.5 = water-resistant, 1 = taped waterproof)
     short  true for short-sleeve tops and shorts, so arm/leg warmers get added
     pack   packs into a jersey pocket, so it can be carried rather than worn

   The temperature ranges are the rider's own calibrated ride-feel bands, not
   the maker's air-temperature claims. Where the two disagree, the rider wins.
   The clo values are estimates in the usual garment range (a business suit is
   1.0 clo); they are there to size the whole outfit, not to grade fabrics.
----------------------------------------------------------------*/

const GEAR_SEED = [
  // --- Base layers ---
  {brand:"Castelli", model:"Core Mesh 3 (sleeveless)", slot:"base", tmin:14, tmax:40, clo:0.05, wind:0.05, water:0, short:true,
   notes:"Open mesh — wicks rather than insulates. The correct layer under the Perfetto and Gabba R, which have room for little else."},
  {brand:"Futurum", model:"Merino 150gsm short sleeve", slot:"base", tmin:8, tmax:18, clo:0.09, wind:0.1, water:0, short:true,
   notes:"Merino holds warmth when damp. The right base under the Gabba R and the Shakedry, both of which cool fast once water gets in."},
  {brand:"Futurum", model:"Merino 150gsm long sleeve", slot:"base", tmin:2, tmax:12, clo:0.14, wind:0.1, water:0,
   notes:"Lightweight, not thermal. Stacking the short sleeve underneath buys two or three degrees and costs nothing."},

  // --- Jerseys and mid-layers ---
  {brand:"Assos", model:"Mille GT SS jersey S11", slot:"mid", tmin:14, tmax:40, clo:0.10, wind:0.15, water:0, short:true,
   notes:"Clima Code 1/3. The default top whenever a shell isn't needed; pairs with arm warmers to reach the low teens."},
  {brand:"Castelli", model:"Espresso Thermal (LS)", slot:"mid", tmin:6, tmax:14, clo:0.30, wind:0.20, water:0,
   notes:"Fleece-lined Powerstretch, very breathable, only slight wind resistance — wants a gilet over it on exposed days."},
  {brand:"Assos", model:"Mille GT Spring Fall LS", slot:"mid", tmin:7, tmax:14, clo:0.28, wind:0.35, water:0,
   notes:"Insulating front, breathable striped back. Relaxed fit, so it layers under a shell better than the Castelli race pieces."},

  // --- Shells ---
  {brand:"Castelli", model:"Gabba R (SS)", slot:"shell", tmin:4, tmax:15, clo:0.18, wind:0.95, water:0.95, short:true,
   notes:"Functionally waterproof, >5,000mm head. Race fit — a short-sleeve base is the ceiling. Worn as the kit, not over it."},
  {brand:"Castelli", model:"Gabba RoS (SS)", slot:"shell", tmin:8, tmax:15, clo:0.18, wind:0.90, water:0.50, short:true,
   notes:"Gore-Tex Infinium Windstopper softshell. Windproof, NOT waterproof — the cold-and-dry option. Built to pair with Nano Flex arms."},
  {brand:"Castelli", model:"Perfetto RoS (LS)", slot:"shell", tmin:3, tmax:11, clo:0.32, wind:0.90, water:0.50,
   notes:"Windstopper softshell. Max two thin layers underneath. Breathes so well that a rider soaked through in it cools fast."},
  {brand:"Assos", model:"Mille GT Winter Jacket EVO", slot:"shell", tmin:-2, tmax:7, clo:0.55, wind:0.85, water:0.60,
   notes:"Clima Code 3/3. Windproof and highly water-repellent but not a rain jacket — the Shakedry goes over it in prolonged rain."},
  {brand:"Gore", model:"Shakedry rain jacket", slot:"shell", tmin:-10, tmax:20, clo:0.08, wind:0.95, water:1.0, pack:true, rainOnly:true,
   notes:"Fully waterproof, RET<3, never wets out. Uninsulated, so it only works over adequate layers. No backpack — the membrane won't take abrasion."},
  {brand:"Assos", model:"Mille GT Wind Jacket C2", slot:"shell", tmin:10, tmax:18, clo:0.10, wind:0.85, water:0.30, pack:true,
   notes:"Packable windshell, water-repellent only. Lives in a jersey pocket — insurance for uncertain mornings, not a rain garment."},

  // --- Gilets ---
  {brand:"Assos", model:"Mille GT Wind Vest C2", slot:"vest", tmin:8, tmax:18, clo:0.06, wind:0.60, water:0.20, pack:true,
   notes:"75g. Breaker front, Ventamesh back — blocks wind where it bites without trapping heat across the back. Almost nothing in rain."},
  {brand:"Castelli", model:"Espresso Vest", slot:"vest", tmin:10, tmax:18, clo:0.08, wind:0.45, water:0.20, pack:true,
   notes:"120g, deliberately air-permeable front. Three rear pockets, so it can be the outer layer without losing pocket access."},

  // --- Arms ---
  {brand:"Castelli", model:"Nano Flex arm warmers", slot:"arms", tmin:6, tmax:15, clo:0.08, wind:0.50, water:0.60,
   notes:"Water-repellent thermal. Castelli designed the Gabba around these — the default whenever it's cold and wet."},
  {brand:"GripGrab", model:"arm warmers", slot:"arms", tmin:11, tmax:17, clo:0.07, wind:0.30, water:0.20,
   notes:"Model unspecified — GripGrab make lightweight, thermal and water-repellent versions with quite different ranges."},
  {brand:"Bioracer", model:"Stratos arm warmers", slot:"arms", tmin:14, tmax:20, clo:0.04, wind:0.30, water:0.40, pack:true,
   notes:"Ultralight, UPF 50, packs to nothing. The pair that lives in a pocket on uncertain mornings."},
  {brand:"Castelli", model:"UPF 50 sun sleeves", slot:"arms", tmin:20, tmax:45, clo:0.01, wind:0.10, water:0, pack:true,
   notes:"Not warmers — sun protection, and cooler than bare arms in strong sun."},

  // --- Legs ---
  {brand:"Castelli", model:"Unlimited bib shorts", slot:"legs", tmin:14, tmax:40, clo:0.12, wind:0.20, water:0, short:true,
   notes:"Gravel-oriented, abrasion-resistant panels and flapped thigh cargo pockets — worth defaulting to when a shell is being carried."},
  {brand:"", model:"Winter bib tights", slot:"legs", tmin:-2, tmax:8, clo:0.30, wind:0.40, water:0.20,
   notes:"Three pairs (AGU, Assos, Castelli), treated as interchangeable until ranked. They almost certainly differ by a few degrees."},
  {brand:"", model:"Knee warmers", slot:"legextra", tmin:11, tmax:16, clo:0.06, wind:0.25, water:0,
   notes:"Knees are the part that actually complains. When the call is borderline, cover them."},
  {brand:"", model:"Leg warmers", slot:"legextra", tmin:8, tmax:13, clo:0.10, wind:0.25, water:0,
   notes:"Removable mid-ride, which bib tights aren't."},
  {brand:"Bioracer", model:"bib tight, no chamois", slot:"legextra", tmin:-8, tmax:10, clo:0.14, wind:0.35, water:0.20,
   notes:"Over bib shorts it converts a short-bib setup into a winter one — one chamois covering two ranges. Also layers over winter bibs below -2°C."},

  // --- Hands, feet, head. These run on the air-based number, not ride-feel. ---
  {brand:"Castelli", model:"Arenberg Gel 2 (short finger)", slot:"hands", tmin:13, tmax:40, clo:0.02, wind:0.20, water:0,
   notes:"Gel inserts built for rough surfaces — earns its place on gravel and long days."},
  {brand:"", model:"Mid-weight long-finger gloves", slot:"hands", tmin:6, tmax:13, clo:0.07, wind:0.45, water:0.20,
   notes:"The workhorse for Dutch autumn and spring."},
  {brand:"Castelli", model:"winter gloves", slot:"hands", tmin:-10, tmax:8, clo:0.12, wind:0.65, water:0.30,
   notes:"Model unspecified. Not waterproof — in sustained cold rain, hands are the limiting factor."},
  {brand:"", model:"Toe covers", slot:"feet", tmin:8, tmax:13, clo:0.05, wind:0.55, water:0.40,
   notes:"Also worth it above that in rain — wet feet are the complaint that outlasts the ride."},
  {brand:"", model:"Overshoes", slot:"feet", tmin:-10, tmax:8, clo:0.10, wind:0.75, water:0.70, notes:"Below 8°C, or any wet ride."},
  {brand:"", model:"Headband", slot:"head", tmin:4, tmax:10, clo:0.03, wind:0.40, water:0,
   notes:"Ears are the first thing to hurt in wind, well before the head feels cold."},
  {brand:"", model:"Thermal cap", slot:"head", tmin:-10, tmax:4, clo:0.06, wind:0.55, water:0.20, notes:""},
  {brand:"", model:"Brimmed cap under the helmet", slot:"head", tmin:-10, tmax:25, clo:0.02, wind:0.20, water:0.30, pack:true,
   notes:"Rain only — keeps spray off the glasses.", rainOnly:true},
  {brand:"", model:"Sunglasses", slot:"eyes", tmin:-10, tmax:45, clo:0, wind:0, water:0,
   notes:"Low winter sun on flat open roads is a genuine hazard here, not a comfort item."},
  {brand:"", model:"Clear or light lenses", slot:"eyes", tmin:-10, tmax:45, clo:0, wind:0, water:0,
   notes:"Rain and dark.", rainOnly:true}
];

/* Gaps the rider knows about — surfaced when the forecast walks into them. */
const GEAR_GAPS = [
  {when: (f) => f.raining && !f.light && f.extFeel < 5,
   text: "No waterproof gloves in the inventory. Below about 5°C in sustained rain your hands become the limiting factor and they'll shorten the ride whatever the jacket is doing."},
  {when: (f) => f.feel < -1,
   text: "No heavyweight base layer — both merinos are 150gsm, so the bottom of the Winter Jacket's range isn't properly supported. Stack the two merinos and accept the layering is at its limit."}
];

const SLOTS = [
  ["base","Base layer"], ["mid","Jersey / mid"], ["shell","Shell / jacket"], ["vest","Gilet"],
  ["arms","Arm warmers"], ["legs","Legs"], ["legextra","Leg warmers / over-tight"],
  ["hands","Hands"], ["feet","Feet"], ["head","Head"], ["eyes","Eyes"]
];
const SLOT_LABEL = Object.fromEntries(SLOTS);

/* Short zone words for the kit list, and the order you actually get dressed in:
   head down to feet, base layer before what goes over it. */
const ZONE_LABEL = {
  head:"Head", eyes:"Eyes", base:"Base", mid:"Torso", shell:"Shell", vest:"Gilet",
  arms:"Arms", hands:"Hands", legs:"Legs", legextra:"Legs", feet:"Feet"
};
const ZONE_ORDER = ["head","eyes","base","mid","shell","vest","arms","hands","legs","legextra","feet"];

/* --- Storage ---------------------------------------------------- */
const GEAR_KEY = "cwem-gear-v1";

function loadGear(){
  try{
    const raw = localStorage.getItem(GEAR_KEY);
    if (raw){
      const g = JSON.parse(raw);
      if (Array.isArray(g) && g.length) return g.map(normaliseItem);
    }
  }catch(e){}
  return GEAR_SEED.map(normaliseItem);
}
function saveGear(gear){
  try{ localStorage.setItem(GEAR_KEY, JSON.stringify(gear)); }catch(e){}
}
function resetGear(){
  try{ localStorage.removeItem(GEAR_KEY); }catch(e){}
  return GEAR_SEED.map(normaliseItem);
}
/* Brands seen in the seed, used only to split a legacy single-field name back
   into brand and model. Anything unrecognised stays wholly in the model. */
const KNOWN_BRANDS = ["Castelli","Assos","Gore","Bioracer","GripGrab","Futurum","AGU",
  "Rapha","Sportful","Endura","Pearl Izumi","Santini","MAAP","Velocio","Specialized",
  "Giro","Oakley","Shimano","Fizik","dhb","Van Rysel","Le Col","Q36.5","7mesh"];

function splitLegacyName(name){
  for (const b of KNOWN_BRANDS){
    if (name.toLowerCase().startsWith(b.toLowerCase() + " "))
      return {brand: b, model: name.slice(b.length + 1)};
  }
  return {brand:"", model:name};
}

function normaliseItem(it){
  // Gear saved before brand and model were separate fields carries only `name`.
  let brand = it.brand, model = it.model;
  if (brand === undefined && model === undefined){
    const split = splitLegacyName(String(it.name || "Unnamed"));
    brand = split.brand; model = split.model;
  }
  brand = String(brand || "").trim();
  model = String(model || "").trim() || "Unnamed";

  return {
    brand, model,
    // Kept as the single display string the advice and the lookup both use.
    name: [brand, model].filter(Boolean).join(" "),
    slot: SLOT_LABEL[it.slot] ? it.slot : "mid",
    tmin: Number.isFinite(+it.tmin) ? +it.tmin : 0,
    tmax: Number.isFinite(+it.tmax) ? +it.tmax : 20,
    clo:  Number.isFinite(+it.clo)  ? +it.clo  : 0.1,
    wind: Number.isFinite(+it.wind) ? +it.wind : 0.2,
    water:Number.isFinite(+it.water)? +it.water: 0,
    short: !!it.short, pack: !!it.pack, rainOnly: !!it.rainOnly,
    off: !!it.off,
    notes: String(it.notes || "")
  };
}


/* ---------------------------------------------------------------
   Gear table columns. One definition per column carries its label, the
   description shown on hover, how it sorts, and what kind of filter it takes —
   so the header controls stay in step with the data instead of drifting.
----------------------------------------------------------------*/
const GEAR_COLS = [
  {key:"use", label:"In advice", type:"use", align:"center",
   desc:"Whether this garment is considered when picking kit. Switch it Out for anything lent out, in the wash, or not packed for a trip.",
   val: g => g.off ? 0 : 1, text: g => g.off ? "Out" : "In"},

  {key:"brand", label:"Brand", type:"enum",
   desc:"Who made it. Left blank for the generic items — overshoes, headband, plain leg warmers — where the maker doesn't change the advice.",
   val: g => g.brand.toLowerCase(), text: g => g.brand || "—"},

  {key:"model", label:"Model", type:"text",
   desc:"The specific garment. This is what the web lookup searches for, so the closer it matches the maker's own name, the better the result.",
   val: g => g.model.toLowerCase(), text: g => g.model},

  {key:"slot", label:"Slot", type:"enum",
   desc:"Which part of the outfit it competes for. Only one garment wins each slot, except legs, which can take a warmer over the top.",
   val: g => SLOT_LABEL[g.slot] || g.slot, text: g => SLOT_LABEL[g.slot] || g.slot},

  {key:"range", label:"Ride-feel range", type:"covers",
   desc:"The coldest and warmest ride-feel °C this works at — your own calibration, not the maker's air-temperature claim. Ranges pick the garment; clo sizes the stack.",
   val: g => (g.tmin + g.tmax) / 2, text: g => `${g.tmin} to ${g.tmax}`},

  {key:"clo", label:"clo", type:"num", align:"right",
   desc:"Thermal insulation, where 1.0 is a business suit and a summer jersey is about 0.10. Used to size the whole outfit against what the conditions require.",
   val: g => g.clo, text: g => g.clo},

  {key:"wind", label:"Wind", type:"num", align:"right",
   desc:"Windproofness from 0 to 1. It matters more than thickness on a bike: the outermost layer decides how much of the stack beneath it survives the airflow.",
   val: g => g.wind, text: g => g.wind},

  {key:"water", label:"Water", type:"num", align:"right",
   desc:"Waterproofness from 0 to 1. Around 0.5 is water-resistant and will wet through in sustained rain; 0.9 and above is a taped, genuinely waterproof shell.",
   val: g => g.water, text: g => g.water},

  {key:"flags", label:"Flags", type:"flags",
   desc:"SS marks short sleeves or shorts, which is what triggers arm and leg warmers. PACK means it fits in a pocket, so it can be carried. RAIN means it only appears when it's wet.",
   val: g => (g.short?4:0) + (g.pack?2:0) + (g.rainOnly?1:0),
   text: g => [g.short && "SS", g.pack && "PACK", g.rainOnly && "RAIN"].filter(Boolean).join(" ")}
];
