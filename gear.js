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
   notes:"Open 3D mesh that wicks rather than insulates — it moves sweat off the skin and adds almost no warmth, which is the point. The correct layer under the Perfetto and the Gabba R, both cut too close for anything thicker."},
  {brand:"Futurum", model:"Merino 150gsm short sleeve", slot:"base", tmin:8, tmax:18, clo:0.09, wind:0.1, water:0, short:true,
   notes:"150gsm is a lightweight: it manages damp well but adds little insulation. Merino keeps warming you when wet, which synthetics stop doing — so this is the base for rides that will get wet, and short sleeves suit the race-cut shells that have room for nothing else."},
  {brand:"Futurum", model:"Merino 150gsm long sleeve", slot:"base", tmin:2, tmax:12, clo:0.14, wind:0.1, water:0,
   notes:"Same lightweight 150gsm fabric with full sleeves, so roughly half a band warmer than the short one. Stacking the short sleeve underneath it buys two or three degrees and costs nothing, since you own both. Not a thermal base — see the gap note below −1°C."},

  // --- Jerseys and mid-layers ---
  {brand:"Assos", model:"Mille GT SS jersey S11", slot:"mid", tmin:14, tmax:40, clo:0.10, wind:0.15, water:0, short:true,
   notes:"Clima Code 1/3. The default top whenever a shell isn't needed. Pairs with arm warmers to reach the low teens, which is cheaper than owning another jersey for that band."},
  {brand:"Castelli", model:"Espresso Thermal (LS)", slot:"mid", tmin:6, tmax:14, clo:0.30, wind:0.20, water:0,
   notes:"Powerstretch-type fleece: light fleece inside, denser weave outside. Castelli quote 12–18°C but reviewers consistently ride it from about 6°C, and your range follows them rather than the label. Barely wind-resistant, so it wants a gilet over it on anything exposed. Three open rear pockets plus a zipped one."},
  {brand:"Assos", model:"Mille GT Spring Fall LS", slot:"mid", tmin:10, tmax:15, clo:0.28, wind:0.35, water:0,
   notes:"Clima Code 2/3. 250g/m² RX fabric on the front for insulation and abrasion resistance, breathable striped back. Relaxed regularFit, so it layers under a shell better than the Castelli race pieces. Assos rate the C2 at 12–20°C; your 10–15 is your own figure and sits sensibly below the label, the way a run-hot rider's range should — narrower at the top than they claim, a little braver at the bottom."},

  // --- Shells ---
  {brand:"Castelli", model:"Gabba R (SS)", slot:"shell", tmin:4, tmax:15, clo:0.18, wind:0.95, water:0.95, short:true,
   notes:"Functionally waterproof, over 5,000mm hydrostatic head, unlike every earlier Gabba. Race fit means almost no layering room: a short-sleeve base is the ceiling. The tight cut leaves no insulating air gap, so it feels cold once you stop or get soaked through. Worn AS the kit, not over it."},
  {brand:"Castelli", model:"Gabba RoS (SS)", slot:"shell", tmin:8, tmax:15, clo:0.18, wind:0.90, water:0.50, short:true,
   notes:"Gore-Tex Infinium Windstopper — 205 on the front, 203 stretch at the back, taped shoulders. Windproof and water-resistant but NOT waterproof, so this is the cold-and-dry choice while the Gabba R is the actual-rain one. Built to pair with Nano Flex arm warmers, which come off mid-ride when the R's fixed sleeves can't."},
  {brand:"Castelli", model:"Perfetto RoS (LS)", slot:"shell", tmin:3, tmax:11, clo:0.32, wind:0.90, water:0.50,
   notes:"Gore-Tex Infinium Windstopper softshell, maker-rated 4–14°C. Windproof, water-resistant, not waterproof. Two thin layers underneath at most before the fit goes. It breathes so well that once rain does get through, you cool fast — which is why the Shakedry goes over it rather than instead of it."},
  {brand:"Assos", model:"Mille GT Winter Jacket EVO", slot:"shell", tmin:-2, tmax:7, clo:0.55, wind:0.85, water:0.60,
   notes:"Clima Code 3/3. Neos Medium three-layer softshell front, Neos Light on the arms and back, fleece-backed under the arms. Windproof and highly water-repellent but not a rain jacket. Note it sits BELOW the Ultraz EVO in Assos's own winter range, so it is the milder of their two, not the extreme one."},
  {brand:"Gore", model:"Shakedry rain jacket", slot:"shell", tmin:-10, tmax:20, clo:0.08, wind:0.95, water:1.0, pack:true, rainOnly:true,
   notes:"The membrane is the outer surface, so it never wets out — no DWR to fail and no cold clammy face fabric. Around 120–150g depending on model. Three catches: uninsulated, so it only works over adequate layers; the membrane has no face fabric, so no backpack and care with frame bags and brambles; and cuffs are loose, so wear gloves."},
  {brand:"Assos", model:"Mille GT Wind Jacket C2", slot:"shell", tmin:10, tmax:18, clo:0.10, wind:0.85, water:0.30, pack:true,
   notes:"Packable windshell, water-repellent only — not a rain garment. Breaker fabric on the main panels with stretch Sens Super inserts at the sides and under the arms; the C2 revision is cut to stop it flapping and rustling. Lives in a jersey pocket as the insurance policy for uncertain mornings."},

  // --- Gilets ---
  {brand:"Assos", model:"Mille GT Wind Vest C2", slot:"vest", tmin:8, tmax:18, clo:0.06, wind:0.60, water:0.20, pack:true,
   notes:"75g in medium. Breaker front with water repellency, tear-resistant Ventamesh rear. That mesh back is what makes it the better default than the Wind Jacket for a rider who runs hot: it blocks wind on the chest, where chill actually bites, without trapping heat across the back. Almost nothing in rain."},
  {brand:"Castelli", model:"Espresso Vest", slot:"vest", tmin:10, tmax:18, clo:0.08, wind:0.45, water:0.20, pack:true,
   notes:"About 120g. The front is stretch-woven and deliberately air-permeable — wind-RESISTANT rather than windproof — which suits a hot rider on a merely cool day. Two things set it apart from the Assos: three rear pockets, so it can be the outer layer without losing pocket access, and a double-opening zip that reaches the jersey pockets underneath."},

  // --- Arms ---
  {brand:"Castelli", model:"Nano Flex arm warmers", slot:"arms", tmin:6, tmax:15, clo:0.08, wind:0.50, water:0.60,
   notes:"Termoflex fleece coated in nano filaments: water beads and rolls off rather than soaking in. Castelli rate them 8–20°C; yours run colder. Not waterproof — sustained rain will get through. Castelli designed the Gabba around this pairing, which is exactly the trick a hot rider wants: short sleeves plus warm arms, and the arms come off mid-ride."},
  {brand:"GripGrab", model:"thermal arm warmers", slot:"arms", tmin:6, tmax:14, clo:0.09, wind:0.35, water:0.20,
   notes:"The thermal pair rather than the lightweight or the water-repellent one, which puts them alongside the Nano Flex instead of above them. The Nano Flex still wins when it is wet, being water-repellent; these are the dry-cold choice."},
  {brand:"Bioracer", model:"Stratos arm warmers", slot:"arms", tmin:14, tmax:20, clo:0.04, wind:0.30, water:0.40, pack:true,
   notes:"Ultralight woven Aquaracer, water-repellent outside and hydrophilic inside, UPF 50. Packs to almost nothing, so this is the pair that lives in a pocket on uncertain mornings and comes off at the first climb. Also cuts wind chill on a long descent."},
  {brand:"Castelli", model:"UPF 50 sun sleeves", slot:"arms", tmin:20, tmax:45, clo:0.01, wind:0.10, water:0, pack:true,
   notes:"Not warmers at all — sun protection, and genuinely cooler than bare arms in strong sun because they keep the burn off and hold a little evaporative cooling. Belongs with summer kit, not the shoulder-season pile."},

  // --- Legs ---
  {brand:"Castelli", model:"Unlimited bib shorts", slot:"legs", tmin:14, tmax:40, clo:0.12, wind:0.20, water:0, short:true,
   notes:"Castelli rate them 15–35°C. Gravel-oriented: Kiss Air2 pad, abrasion-resistant double-layer side panels, and flapped cargo pockets on the thighs. Those pockets are the reason to default to these whenever a shell is being carried — the Shakedry and the Wind Vest ride on the legs and leave the jersey pockets free for food."},
  {brand:"Assos", model:"winter bib tights", slot:"legs", tmin:-4, tmax:6, clo:0.34, wind:0.45, water:0.20,
   notes:"The warmest of your three pairs, so this is the one for the genuinely cold days. Ranked by your own experience rather than a spec sheet, which is the better evidence."},
{brand:"", model:"Winter bib tights, Castelli or AGU", slot:"legs", tmin:-2, tmax:8, clo:0.30, wind:0.40, water:0.20,
   notes:"Two pairs you treat as the same thing, because on the road they are - only the Assos stands apart as the warmer one. Kept as a single row rather than two identical entries pretending to a distinction you do not make."},

  {brand:"", model:"Knee warmers", slot:"legextra", tmin:11, tmax:16, clo:0.06, wind:0.25, water:0,
   notes:"Knees are the part that actually complains, and they complain before the rest of the leg does. When the call is borderline, cover them: they weigh nothing and roll into a pocket."},
  {brand:"", model:"Leg warmers", slot:"legextra", tmin:8, tmax:13, clo:0.10, wind:0.25, water:0,
   notes:"Removable mid-ride, which bib tights are not — that is the whole argument for them on a day that starts cold and warms up, or on any route with a long descent in the middle."},
  {brand:"Endura", model:"spray over-trousers", slot:"legextra", tmin:-10, tmax:20, clo:0.08, wind:0.80, water:0.50, pack:true, rainOnly:true,
   notes:"Go over whatever is already on the legs, and only when it is wet — temperature barely bounds them. Showerproof rather than waterproof, so they buy you an hour and not a day: right for a shower or a spray-covered road, overwhelmed by sustained rain. Still the only waterproof-ish leg option you own."},
  {brand:"Bioracer", model:"bib tight, no chamois", slot:"legextra", tmin:-8, tmax:10, clo:0.14, wind:0.35, water:0.20,
   notes:"The most flexible leg item you own. Over bib shorts it converts a short-bib setup into a winter one, which matters on trips because one chamois then covers two temperature ranges. It also layers over a winter bib as a second skin when it is genuinely cold."},

  // --- Socks. Under the shoe, where overshoes and toe covers go over it. ---
  {brand:"", model:"Merino socks, summer weight", slot:"socks", tmin:13, tmax:40, clo:0.03, wind:0.15, water:0.10,
   notes:"Merino rather than synthetic, which matters more on the feet than anywhere else: shoes stay damp, and merino keeps working when wet where synthetics stop."},
  {brand:"", model:"Merino socks, winter weight", slot:"socks", tmin:-10, tmax:12, clo:0.06, wind:0.20, water:0.10,
   notes:"The thicker pair. Worth pairing with overshoes rather than instead of them — a shoe is mostly vents, so the sock warms and the overshoe blocks."},

  // --- Neck ---
{brand:"", model:"Merino buff", slot:"neck", tmin:2, tmax:14, clo:0.03, wind:0.25, water:0.10,
   notes:"The thin one that packs to nothing and lives in a pocket. Takes the edge off a cool morning and comes off without stopping. Little wind resistance, so it is warmth by coverage rather than by blocking anything."},
  {brand:"", model:"Thermal neck gaiter", slot:"neck", tmin:-10, tmax:8, clo:0.06, wind:0.45, water:0.10,
   notes:"Brushed inside, for actual winter. Pull it over the chin on a descent — the neck of a jersey is an open pipe pointing straight down your chest, which is why a gaiter buys more warmth than its weight suggests."},
  {brand:"", model:"Windproof neck gaiter", slot:"neck", tmin:-6, tmax:10, clo:0.05, wind:0.75, water:0.20,
   notes:"A membrane panel across the throat. The one to reach for on an exposed dike rather than a cold still morning: the neck is where airflow actually gets under a jacket, and blocking it there is worth more than another layer underneath."},

  // --- Hands, feet, head. These run on the air-based number, not ride-feel. ---
  {brand:"Castelli", model:"Arenberg Gel 2 (short finger)", slot:"hands", tmin:11, tmax:40, clo:0.02, wind:0.20, water:0,
   notes:"Short-finger with gel inserts, built for rough surfaces — the right choice for gravel and long days where hand numbness is the limiting factor. Reaches down to 11°C so there is no bare patch between these and the Laval, which is a fair call for a rider who runs hot."},
  {brand:"Rogelli", model:"Laval gloves", slot:"hands", tmin:0, tmax:10, clo:0.09, wind:0.50, water:0.30,
   notes:"The workhorse for Dutch autumn and spring, rated 0–10°C. That overlaps the Estremo below 5, where either will do and the Estremo is the warmer call; above 10 the Arenberg takes over."},
  {brand:"Castelli", model:"Estremo winter gloves", slot:"hands", tmin:-10, tmax:5, clo:0.14, wind:0.85, water:0.40,
   notes:"Model unspecified, which matters here: Castelli's winter gloves span roughly −5°C to 10°C depending on which line. Not waterproof in any case — in sustained cold rain your hands become the limiting factor on the whole ride."},
  {brand:"", model:"Toe covers", slot:"feet", tmin:8, tmax:13, clo:0.05, wind:0.55, water:0.40,
   notes:"The cheap half-measure that works: they cover the vents at the front of the shoe, which is where the cold actually gets in. Also worth wearing above their range in rain, because wet feet outlast the ride."},
  {brand:"", model:"Overshoes", slot:"feet", tmin:-10, tmax:8, clo:0.10, wind:0.75, water:0.70, notes:"Below 8°C or any wet ride. Full coverage rather than the toe cover's half measure, and the wind rating is what earns it — a shoe is mostly vents."},
  {brand:"", model:"Headband", slot:"head", tmin:4, tmax:10, clo:0.03, wind:0.40, water:0,
   notes:"Ears are the first thing to hurt in wind, well before the head feels cold, and a headband fixes that for almost no bulk. Fits under a helmet without moving the fit."},
  {brand:"", model:"Thermal cap", slot:"head", tmin:-10, tmax:4, clo:0.06, wind:0.55, water:0.20, notes:"Under the helmet below about 4°C. Covers the ears, which a headband also does, but adds a layer over the crown for when the headband alone stops being enough."},
  {brand:"", model:"Brimmed cap under the helmet", slot:"head", tmin:-10, tmax:25, clo:0.02, wind:0.20, water:0.30, pack:true,
   notes:"Rain only. The brim keeps spray off your glasses, which is the thing that actually ends wet rides early — not cold, but not being able to see.", rainOnly:true},
  {brand:"", model:"Sunglasses", slot:"eyes", tmin:-10, tmax:45, clo:0, wind:0, water:0,
   notes:"Low winter sun on flat open roads is a genuine hazard here, not a comfort item: it sits at eye height for hours and you ride into it. Model unspecified."},
  {brand:"", model:"Clear or light lenses", slot:"eyes", tmin:-10, tmax:45, clo:0, wind:0, water:0,
   notes:"For rain, dusk and dark. Clear lenses still keep grit and spray out of your eyes, which is why they beat riding without — the protection matters more than the tint.", rainOnly:true}
];

/* Gaps the rider knows about — surfaced when the forecast walks into them. */
const GEAR_GAPS = [
  {when: (f) => f.raining && !f.light && f.extFeel < 5,
   text: "No waterproof gloves in the inventory. Below about 5°C in sustained rain your hands become the limiting factor and they'll shorten the ride whatever the jacket is doing."},
  {when: (f) => f.wet && f.extFeel < 6,
   text: "No waterproof socks. Overshoes keep the worst of it out, but on a long wet ride water runs down your legs and into the shoe anyway — wet feet are the complaint that outlasts the ride, and nothing you own actually prevents it."},
  {when: (f) => f.feel < -1,
   text: "No heavyweight base layer — both merinos are 150gsm, so the bottom of the Winter Jacket's range isn't properly supported. Stack the two merinos and accept the layering is at its limit."}
];

const SLOTS = [
  ["base","Base layer"], ["mid","Jersey / mid"], ["shell","Shell / jacket"], ["vest","Gilet"],
  ["arms","Arm warmers"], ["legs","Legs"], ["legextra","Leg warmers / over-tight"],
  ["hands","Hands"], ["socks","Socks"], ["feet","Feet"], ["neck","Neck"], ["head","Head"], ["eyes","Eyes"]
];
const SLOT_LABEL = Object.fromEntries(SLOTS);

/* Short zone words for the kit list, and the order you actually get dressed in:
   head down to feet, base layer before what goes over it. */
const ZONE_LABEL = {
  head:"Head", eyes:"Eyes", neck:"Neck", base:"Base", mid:"Torso", shell:"Shell", vest:"Gilet",
  arms:"Arms", hands:"Hands", legs:"Legs", legextra:"Legs", socks:"Socks", feet:"Feet"
};
const ZONE_ORDER = ["head","eyes","neck","base","mid","shell","vest","arms","hands","legs","legextra","socks","feet"];

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

  {key:"slot", label:"Type", type:"enum",
   desc:"Which part of the outfit this competes for. Only one garment wins each type, except legs, which can take a warmer over the top.",
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
