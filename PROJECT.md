# Cycling Weather Effect Matrix — project record

A single reference for everything built in this project: the instructions it started from, the files it was built on, every decision and validated approach, and the requests that worked. Compiled on 17 September 2026 from the conversation, the repository's first 41 commits, and the knowledge files on disk.

**Repository:** `rnvegter/cycling-weather-matrix` (private, GitHub) · **Local path:** `~/Downloads/Claude code/cycling-weather-matrix` · **Describes the app as of commit:** `fea1ba8` · **Tests:** 170 passing, zero dependencies.

**What it is:** a web app that tells one rider exactly which of their own garments to wear for a specific ride — from location, start time, distance or speed, and optionally a GPX route — and learns from how each ride actually felt. Six tabs: Ride, Favourites, History, Model, Gear, Backup.

---

## Project instructions

### No custom instructions were set

This project was built in **Claude Code** (the desktop app's Code tab), not in a claude.ai Project, so there is no custom-instructions field to quote. Checked on disk rather than assumed:

- No `CLAUDE.md` exists in `~/Downloads/Claude code/` or any folder up to three levels below it.
- No user-level `~/.claude/CLAUDE.md` exists.
- The project memory folder (`~/.claude/projects/-Users-nielsvegter-Downloads-Claude-code/memory/`) is empty.

Nothing was invented to fill this section.

### The standing instructions the app was built from

The nearest thing to project instructions is the **`cycling-kit` skill**, which defined the advice the app turns into software — the ride-feel adjustments, the kit bands, the answer shape and the wardrobe rules. It is reproduced verbatim below. Source: `…/skills-plugin/…/skills/cycling-kit/SKILL.md` (7,596 bytes).

````markdown
---
name: cycling-kit
description: Recommends exactly which cycling clothing to wear for a specific ride, based on the location, the forecast for the ride window, and the rider's own wardrobe. Use this whenever the user asks what to wear on the bike, what kit to pack, whether they need a jacket/warmers/overshoes, whether it's too cold or too wet to ride in what they have, or what to bring on a cycling trip — including indirect phrasings like "riding to Utrecht at 7am, how cold is it going to feel?", "gravel ride tomorrow morning, bib tights or leg warmers?", or "packing the bike for two weeks in the Dordogne". Also use it when the user mentions a planned ride and the weather in the same breath, even if they don't explicitly ask for clothing advice.
---

# Cycling kit advisor

Pick kit for one specific ride, out of the clothes the rider actually owns. The whole value of this skill is specificity: "long-sleeve thermal jersey, gilet, knee warmers, mid gloves" is useful, "dress in layers" is not.

Mirror the user's language — answer in Dutch if they write Dutch, English if English.

## Workflow

### 1. Establish the ride

Needed: **where**, **when** (start time + rough duration), and **what kind of ride**. Ask only for what's genuinely missing — if they say "gravel ride tomorrow morning from home, about 3 hours", that's all three.

- "here" / "near me" / no location → `user_location_v0`
- relative times ("tomorrow", "this evening") → `user_time_v0` first
- No duration given → assume 2 hours and say so.
- No ride type given → assume the rider's usual (see `references/wardrobe.md`).

### 2. Get the forecast for the ride window, not the day

Search for an hourly forecast covering the actual hours on the bike. A day's high is useless for a 07:00 start. Pull:

- temperature at start hour and at end hour
- wind speed **and direction**, plus gusts
- precipitation probability and intensity
- cloud cover / sun
- sunrise and sunset if the ride runs near either

A ride that starts at 8°C and finishes at 17°C is a layering problem, not a temperature problem. Note both ends.

### 3. Compute ride-feel temperature

Standing-still "feels like" numbers are wrong on a bike — a rider makes their own 25–30 km/h headwind. Start from the actual air temperature and adjust:

| Factor | Adjustment |
|---|---|
| Self-generated wind, below 15°C | −3°C |
| Self-generated wind, 15°C and above | −1°C |
| Ambient wind above 15 km/h (only below 12°C) | −1°C per further 10 km/h |
| Actually getting rained on | −4°C (−6°C if air is below 10°C) |
| Full sun, low wind | +2°C |
| Dark / before sunrise / after sunset | −2°C |
| Hard pace or group ride | +2°C |
| Easy pace, family pace, café or photo stops | −2°C |
| Long descents or exposed climbs | −2°C |
| Rider runs hot | +3°C |
| Rider runs cold | −3°C |

Apply the rider's calibration from `references/wardrobe.md`. Do the arithmetic and state the result — "8°C air, feels like about 4°C on the bike" — because that number is what the rider will sanity-check against their own experience, and it's what makes the advice trustworthy rather than arbitrary.

When start and end differ by more than about 5°C, dress for the **start** and build in something removable that fits in a jersey pocket.

### 4. Pick the kit

Read `references/wardrobe.md` and choose from what's listed there. Never recommend an item the rider doesn't own — if the right answer for the conditions isn't in the wardrobe, say so plainly and give the best available substitute plus the workaround ("no waterproof gloves, so winter gloves and accept wet hands after the first hour").

Then use the bands below. They are keyed to **ride-feel** temperature, after the adjustments above. Where `wardrobe.md` gives a specific range for a specific garment, that range wins — it's calibrated to the actual item, whereas this table is a generic fallback for anything not listed there.

| Ride-feel | Core | Legs | Extremities |
|---|---|---|---|
| 25°C+ | Short-sleeve jersey, mesh base layer or none | Bib shorts | Bare hands or mitts, light socks, sunglasses, cap for sun |
| 20–25°C | SS jersey, light base layer | Bib shorts | Mitts, sunglasses |
| 15–20°C | SS jersey, light base layer | Bib shorts | Mitts; arm warmers in the pocket for the first 30 min |
| 12–15°C | SS jersey + arm warmers, base layer | Bib shorts + knee warmers | Mitts or light full gloves; gilet in pocket for descents |
| 9–12°C | LS thermal jersey, or SS + arm warmers + gilet | Knee or leg warmers | Full-finger gloves, headband if windy |
| 5–9°C | LS thermal jersey + gilet, long-sleeve base layer | Leg warmers or bib tights | Winter gloves, thermal headband, toe covers |
| 2–5°C | Winter thermal jacket + thermal base layer | Bib tights, or leg warmers doubled with knee warmers | Winter gloves, thermal cap, overshoes, thicker socks |
| −2–2°C | Winter jacket + thermal base + LS thermal jersey underneath | Bib tights (thermal) | Winter gloves, thermal cap covering ears, overshoes; flag frozen fingers and toes as the limiting factor |
| Below −2°C | Maximum layering, and be honest that the kit is at its limit | | Shorten the ride, warn about black ice, especially on shaded corners and bridge decks |

**Rain.** A hardshell over a hot rider is a sauna. Below 15°C ride-feel, or for rain lasting more than about 30 minutes, the shell wins. Above 15°C in light rain, a gilet plus getting wet is usually more comfortable, as long as the ride doesn't include a long descent. Always add: overshoes, a cap with a brim under the helmet to keep spray off glasses, and clear or light lenses.

**Wind.** Say which direction it's coming from and what that means for the route. A 25 km/h wind means planning the outbound leg into it so the ride finishes with a tailwind — a rider who does it the other way arrives home cold, tired, and underdressed for how slowly they're going. Gusts above 50 km/h on open, exposed ground (dikes, polder, coastal roads, ridgelines) are a safety point, not a comfort one — mention it, especially on gravel or with deep-section wheels.

### 5. Answer in this shape

Keep it scannable — this gets read on a phone, five minutes before leaving.

```
**[Location] · [day, time window]**
[Air temp start → end] · wind [speed, direction] · [rain %] · **feels like ~[X]°C riding**

**Wear**
- head → feet, one line each, naming actual garments

**Pocket**
- what to carry rather than wear, and when they'd put it on

**Watch for**
- one or two lines: wind direction, ice, low sun, rain timing, nothing else
```

Skip any section that has nothing worth saying. Don't pad "Watch for" with generic safety advice.

## Multi-day trips

If the ride is a trip rather than a single outing, switch to packing mode: look at the range across the whole period, then list a kit that covers the coldest likely morning and the warmest likely afternoon with the fewest garments. Call out the two or three items that would be genuinely painful to be without, and the ones that can be left home. Mountains change this — a valley at 22°C is a col at 8°C with a 40-minute descent, so pack for the descent, not the climb.

## Keeping the wardrobe current

`references/wardrobe.md` is the rider's actual inventory. If they mention new gear, a gap, or that something no longer fits, offer to update the file. If a recommendation depends on something the file doesn't cover, ask a direct question about that item rather than guessing — one question, not an inventory audit.
````

---

## Knowledge files

Four files shaped the app. Two were attached directly during the build (`@style-preview.html`, `@weather-effect.css`); the other two are the `cycling-kit` skill and its wardrobe reference, which seeded the model and the gear library. `wardrobe.md` exists both in `~/Downloads/` and inside the skill's `references/` folder, at the same 15,397 bytes.

### `wardrobe.md`

**Purpose:** the rider's inventory and personal calibration — the source of every garment row and temperature range in the app's seeded gear library.

**Digest:** An editable inventory for a rider who runs hot (+3 °C to ride-feel) and rides road and gravel in the flat, windy Netherlands, with hillier family trips abroad. Tables list shells, jerseys, legs and extremities with maker's range, the rider's own ride-feel range, and notes — including the Gabba R versus Gabba RoS, the Shakedry's abrasion limits, and three over-layers split by wind and pockets. It sets leg bands by ride-feel, insists extremities ignore the run-hot calibration, and names two gaps: no waterproof gloves and no heavyweight base layer. Decision rules cover light rain versus pouring and the crowded 8–15 °C band, and it closes with questions still open.

### `SKILL.md` — the `cycling-kit` skill

**Purpose:** the advice method the app implements: how to establish a ride, compute ride-feel, pick kit, and phrase the answer.

**Digest:** Instructions for recommending specific garments for one ride from the rider's own wardrobe, never generic "dress in layers" advice. The workflow establishes where, when and what kind of ride, assuming two hours when unstated; it takes the forecast for the actual ride window rather than the day. It gives an adjustment table from air temperature to ride-feel — self-generated wind, ambient wind, rain, sun, dark, pace, descents, rider calibration — and generic kit bands for fallback. It adds rules for rain shells, and for starting into the wind. Answers follow a fixed phone-readable shape — Wear, Pocket, Watch for — with a packing mode for multi-day trips.

### `style-preview.html`

**Purpose:** the visual reference for the "Weather Effect" design system, adopted as the app's look.

**Digest:** A standalone preview page titled "Weather Effect — style preview" that shows the design system applied to real content rather than as a component list. It renders the oversized ride-feel readout as the page's signature; a head-to-feet Wear list and a Carry list; an "Air → ride-feel" row of adjustment chips whose sign is carried by colour; a torso garment band chart by temperature range, overlapping because the wardrobe overlaps; a year-long view titled "The Haarlem year"; and the temperature ramp itself. At 21.8 KB it loads the stylesheet's tokens and fonts, and served as the target the app's existing interface was restyled to match.

### `weather-effect.css`

**Purpose:** the stylesheet and design tokens behind the app's `styles.css`.

**Digest:** A 13.5 KB stylesheet whose brief is "an instrument, not a lifestyle app", read on a phone at 06:40 in December with cold hands — hence dark-first, with light mode for daylight and print. Section 1 defines tokens: a seven-step temperature ramp from frozen to baking that is data, not decoration; semantic signal, plus and minus colours; Barlow Condensed, IBM Plex Sans and IBM Plex Mono; a type scale and 4 px spacing; 44 px touch targets and a 3 px temperature edge. Further sections style the ride-feel readout, cards, head-to-feet kit list, adjustment chips, garment bars, controls, tables, alerts, "glove mode", responsive layout, motion and print.

---

## Decisions and patterns

### 1. How the work was done — validated working patterns

These held across the whole project and are worth carrying into any future session.

- **Ask when a request is genuinely unclear, with recommended options first.** The favourites feature opened with three multiple-choice questions (what Ride now does, what a favourite remembers, whether the Ride tab saves favourites); all three recommended options were chosen. Routine choices were made and stated instead of asked.
- **Build, test, then push to GitHub** was the standing definition of done ("build it and test it and them push it to github").
- **Prove a bug before fixing it.** Write the test, run it against the *old* code and watch it fail, then fix. Used for the silent scheduled-backup failure, the favourites duplicate key, and the climbing count (old code passed 12 of 42 tests, new code 42 of 42).
- **Measure, don't reason.** Claims were checked against the real thing: live Open-Meteo calls, real Podman containers, a live SSRF probe with a control, DOM measurements instead of eyeballed screenshots.
- **Check a finding before acting on it — including external reviews and the lookup service.** The reviewer's X-Forwarded-For claim was confirmed against the actual nginx and Caddy configs before patching. The scraper's "Windstopper found 10×" was confirmed by search before applying it.
- **Verify with the app's own functions**, not an approximation of them. An estimate of route-section heights was wrong (970 m) until rerun through `sampleRoute` itself (1,098 m).
- **Verify in the real app** on an isolated server with a scratch `STATE_DIR`, so the user's data is never touched; remove every test ride, container, volume and config afterwards.
- **The rider's own calibration beats a maker's rating.** Stored ranges describe when *this* rider reaches for a garment; maker ranges go in the notes. Applied to the Perfetto, Espresso Thermal, Spring Fall LS, Gore C3 knee warmers and Bioracer leg warmers.
- **Report honestly:** say what was not done, not tested, or only partly fixed; name trade-offs rather than hide them in loose tolerances; correct a wrong earlier claim plainly (e.g. "my harness used the wrong field names").
- **Scope discipline:** fix what was asked; report adjacent bugs and offer them as a next step rather than silently widening a change (e.g. the climbing bug was reported, then fixed only when asked; `render()` refactor deferred).
- **Commit messages explain why** — the problem, the evidence, what changed downstream, and what is still open.
- **Zero dependencies** is a hard rule: no npm packages, Node ≥18 built-ins only, tests on `node:test`.
- **Smaller commands when the app is unstable.** After repeated "permission stream closed" interruptions, large combined shell commands were split into small steps with output saved to files.

### 2. The ride-feel model

- **Ride-feel, not "feels like".** Start from air temperature at the start and adjust for what the rider is doing: self-generated wind, ambient wind, rain, sun, darkness, pace, terrain, humidity, and the rider's calibration.
- **Self-generated wind is scaled by actual speed** (`speed / 27`, clamped 0.55–1.45) and rounded to 0.5 °C. It is the *only* term speed touches, which makes speed errors exactly correctable.
- **The self-wind term ramps, it does not step.** It used to jump from −1 to −3 at exactly 15 °C, moving ride-feel 2 °C for 0.1 °C of air; knee warmers were advised across 0.5 °C of air at 27 km/h and *never* at 32 km/h. Now blended from −3 to −1 across 12–18 °C. Speed correction stays exact because the air term cancels (verified, max error 0).
- **Ambient wind** only bites below 12 °C and above 15 km/h: −1 °C per further 10 km/h.
- **Rain:** −4 °C (−6 °C below 10 °C air), halved for light rain; "wet" means raining and not light.
- **Humidity** (from commit `6543020`): vapour pressure sizes the penalty, relative humidity gates whether it applies (Las Vegas at 37 °C / 23 % must not read "muggy"); dew point preferred when available; capped +3 / −2; off below 10 °C; every threshold ramps. Reported to 0.1 °C because a 0.5 °C step made ride-feel tick *up* as air fell.
- **Heat-balance check:** required insulation `It ≈ 0.148 × (33 − T) ÷ MET` clo; cycling MET from the Compendium of Physical Activities (6.8 at 16–19 km/h, 12 at 26–31 km/h). Wind knocks insulation down per ISO 9920; the outermost layer governs shelter. Warm-side tolerance closes from 1.6 to 1.25 when evaporation is blocked.
- **Extremities run on the air-based number** (`extFeel`), not the run-hot-calibrated ride-feel.
- **Altitude:** lapse rate 0.65 °C per 100 m relative to model elevation; Open-Meteo's measured `freezing_level_height` warns when a summit is above or within 300 m of 0 °C.
- **Wet through before the top** (from `6543020`): a wet climb followed by a descent is flagged as a pair; the wet base layer is a *warning*, not a model term, until the history holds evidence to size it.
- **Monotonicity is a tested invariant:** colder air must never produce a warmer ride-feel.

### 3. Outfit selection rules

- **Legs:** a warmer is only offered below the bib shorts' `tmin` (14 °C). So knee warmers are advised at 11–13 °C ride-feel, not their stated 11–16 — two of the rider's own numbers overlapping, left as the rider's call. Ladder verified: bare legs → knee warmers at 13 → leg warmers at 11 → winter tights at 7.
- **Eyewear is chosen by light, not temperature.** Clear lenses (`rainOnly`) when raining or `dark ≥ 0.4`; the tinted Oakley Sutro Lite otherwise. Exactly one pair, verified across noon, overcast, dusk, night, drizzle and heavy rain.
- **Rain-only items** (brimmed cap, over-trousers, clear lenses) are selected by weather in any slot, worn over what is already on.
- **Route packing plan:** unchangeable layers (base, jersey, tights) are chosen for the *warmest* leg; the cold end is covered by pocket items with the kilometre and clock time each goes on; the plan is re-run through the heat balance. Shedding is only suggested into warmth.
- **Route verdicts compare what you'd put on or take off**, not garment names — two near-identical jerseys swapping over one degree is a tie-break, not a change.

### 4. Weather data

- **Open-Meteo, keyless, for everything:** forecast, geocoding, ensemble, air quality (pollen), archive.
- **`best_match` is already the best local model:** matched KNMI HARMONIE on 48 of 48 hours for Utrecht, so there was no better model to switch to.
- **ECMWF 51-member ensemble** replaced a three-model comparison (ECMWF/GFS/ICON): "9 of 51 members have rain" is actionable; global.
- **Quarter-hourly rain** (`minutely_15`) gives the start time to the 15 minutes where available, falling back to the hour.
- **Pollen** mentioned from 20 grains/m³.
- **Optional feeds can never cost the forecast:** ensemble, pollen and comparison requests are wrapped so a failure removes one line and nothing else.
- **Wind direction averages on the unit circle** (a naive mean of 350° and 10° gives 180°). **`angleGap` fixed** after it returned 180° for identical bearings.
- **Archive API for past rides** serves data up to yesterday, but has no `precipitation_probability` or `freezing_level_height`; probability is filled from measured precipitation (100 if ≥ 0.1 mm, else 0) so `rideWindow` never takes `Math.max` of an empty list.

### 5. Options researched and rejected

- **Windy.app lifetime subscription:** includes no API access; the trial key returns deliberately shuffled data; the Professional API is €990/yr. Open-Meteo already serves the same models. Not used.
- **Strava connection:** the API has required a paid subscription since 1 June 2026, Standard tier ≤10 athletes and 1,000 requests/day. Chosen instead: **GPX files with timestamps**, no auth.
- **Multi-user profiles with authentication:** recommended against for a personal tool; if ever needed, delegate identity to the reverse proxy (e.g. Cloudflare Access).
- **Map thumbnails for favourites:** rejected in favour of an SVG outline drawn from the route's own points — no network, and no load on OpenStreetMap's tile usage policy.

### 6. Gear library

- **Seeded inventory in `gear.js`:** 40 items, 13 slots (base, mid, shell, vest, arms, legs, legextra, socks, neck, hands, feet, head, eyes). Each item carries brand, model, slot, `tmin`/`tmax` (ride-feel), clo, wind (0–1), water (0–1), short/pack/rainOnly/off flags, and a note on what it is for and when it is the wrong call.
- **Answers the rider gave, now in the library:** Castelli Estremo winter gloves (warmest); Assos winter bib tights warmest, Castelli and AGU genuinely interchangeable; Shakedry is the Race cut; Assos Spring Fall LS is the C2, used 10–15 °C; GripGrab arm warmers are the Thermal; Endura spray over-trousers are showerproof/water-resistant, not waterproof; neck gaiter(s); Rogelli Laval gloves 0–10 °C; merino socks in summer and winter weights, no waterproof socks.
- **Named later:** Oakley Sutro Lite sunglasses (tinted, so the clear pair stays a separate row); **Gore C3 Windstopper knee warmers** — wind 0.9 / water 0.5, the same membrane class as the Perfetto and Gabba RoS, range kept at 11–16 against Gore's 5–15; **Bioracer thermal leg warmers** — clo 0.12, water 0.35, range kept at 8–13 against Bioracer's 10–20.
- **Still unbranded (12):** merino socks ×2, buff, thermal neck gaiter, windproof neck gaiter, toe covers, overshoes, headband, thermal cap, brimmed cap, clear lenses, and "winter bib tights, Castelli or AGU".
- **Gear page design:** Brand and Model split; Slot renamed Type; columns sortable and filterable with descriptions; a 5 °C-scaled range bar; double-click to edit; In/Out toggle instead of a tick box (with All In / All Out for trip packing); clo, wind, water and flags moved out of the table into SS / PACK / RAIN badges and a click-to-open detail row with the note — so the page keeps the same width as every other tab and works without hover on a phone. A save made behind an active filter clears the filter and says so.
- **The lookup service is a starting point, not an authority.** It fetches up to three manufacturer/review pages and infers clo, wind and water with frequency scoring. Lessons that shaped it: "Shakedry" in a sidebar once made the Perfetto waterproof; "thermal" inflated the Espresso Thermal to 0.22 clo; `/\bshorts?\b/` matched "short sleeve". Calibrated to a mean error of 0.016 clo / 1.4 °C against the seed. Always confirm a surprising finding before applying it.
- **Updating the code does not update a saved gear list.** `loadGear()` returns the stored copy and only falls back to the seed when nothing is stored; the seed is never read again after first use. **Reset** on the Gear tab loads a new seed (Export first). Deliberately no automatic migration — the gear list is treated as the rider's.

### 7. Routes and GPX

- **A GPX checks the kit along the whole ride:** each leg gets its own position, elevation, heading and clock time (gradient-adjusted speed); one forecast call covers every leg.
- **Leg count follows climbing as well as distance:** `max(distance / 10 km, ascent / 150 m, 4)`, capped at 12 — distance alone smoothed an 1,850 m col to 1,659 m.
- **Climbing sets `pace: "hard"`; only descending sets `terrain: "exposed"`.** Leg gradient comes from the leg's endpoints by distance, not whichever points fell inside it.
- **Headwind component** = `wind × cos(windFrom − heading)`. A map (OSM tiles plus an SVG overlay) shows the route and wind so the rider knows which way to set off.
- **Distance, time and speed triangle:** any two give the third; average speed can be entered when ride time is unknown.
- **Climbing is measured on the shape of the road** (commit `fea1ba8`). The old per-point `> 1 m` count read a clean one-second recording of a 150 m climb as **0 m** and a noisy GPS recording as **365 m**. Now: elevation binned at 20 m along distance, gaps interpolated, smoothed over 100 m (widened up to 400 m for noisy dense tracks, with noise measured from the track's own second differences; files with points > 60 m apart left alone), and climbing counted between turning points with 2 m hysteresis. On a 34 km recorded col ride: 0 → 822 m (truly 825), 4 → 5 route sections, highest section 906 → 1,098 m — about 1.2 °C colder at the col. **Trade-off:** 8 m bridges under ±3 m GPS noise read 26–34 m of a true 48; never more than the road climbed.
- **`routeStats` now includes the first point** in the summit and low point; it used to skip it.
- **Tracks are thinned for storage** (`simplifyTrack`): about one point per 50 m, never more than 2,500, always keeping start, finish, highest and lowest points.

### 8. Ride history, feedback and the Model tab

- **Every ride the model works out is kept** in History, identified by start time and place, so re-running the same ride updates the entry and keeps any rating.
- **Feedback lives only in History** — the Ride tab is read before leaving, the one moment the question cannot be answered. History sits next to Ride.
- **Verdict scale:** too cold −2, a bit cold −1, right 0, a bit warm +1, too warm +2. "Too warm" means the model read *cold*.
- **Learned offset:** nothing applies before 3 rated rides; only the last 20 count; capped at ±4 °C; wet and dry rides get separate corrections once enough wet rides exist.
- **Speed errors are not blamed on the rider:** `effectiveDelta = verdictDelta − speedFeelEffect`, exact because speed touches ride-feel through one term. Worked example: assumed 24, rode 30, "a bit cold" → effective delta 0.
- **Attach a recorded ride** (GPX with timestamps) to an existing entry to replace the guessed speed with the measured one.
- **Add a ride from a GPX file** for a ride never planned in the app: the archive supplies the weather, the same model runs over it, and the entry is tagged *from GPX* and counts on equal footing (measured weather and speed beat a forecast). Place name comes from the track name, falling back to coordinates — no keyless reverse geocoder was added.
- **Export and import** history as JSON; import *merges* (a rated ride beats an unrated one; between two ratings the more recent stands).
- **`normaliseRide` now keeps `actual`, `actualFrom` and `reconstructed`.** It runs on import and every sync merge, and was silently discarding attached ride files.
- **Model tab** (from commit `2990c65`): hit rate, mean signed error and mean absolute error; a mean inside two standard errors of zero is reported as noise; under 3 rated rides it says so; splits use the model's own thresholds (rain, 5 °C, windy, long ride) plus forecast-versus-GPX-reconstructed; leave-one-out tests whether the correction helps against doing nothing, and names the trade when it lowers the average miss while calling fewer rides right.

### 9. Favourites

- **A Favourites tab** holds routes ridden again, added from GPX files (several at once) or with **Save as favourite** on the Ride tab after loading a route.
- **Ride now fills in and stops:** route, start point, distance, surface and speed, then switches to the Ride tab. Date and start time are left to the rider; the forecast is not fetched automatically.
- **Ride now always moves the start point** to the route's own start (a plain file load only fills an empty place), and **clears any leftover duration** — an old "3 h" would override the favourite's speed (20.7 km/h instead of the recorded 15.4).
- **A favourite remembers surface and speed.** A recorded ride brings its average speed from the full-resolution timestamps; a planned route keeps a speed the rider typed, or none — never the Ride tab's own guess, which would stop following surface and pace.
- **Stored packed** as `[lat, lon, ele]`, thinned; a 677 KB recording and a second route took 43 KB together.
- **Duplicates are keyed on the thinned track** (start, finish, length to 0.1 km); a route loaded by a favourite is recognised by its id. The first version keyed raw and thinned tracks differently and would have offered "Save as favourite" forever.
- **Storage refuses loudly** when the browser is full rather than dropping a favourite silently.
- Each card shows an SVG outline (start dot, finish ring for point-to-point), distance, climb, loop or point-to-point, surface, speed and last used; Edit (name, surface, speed; Enter saves, Escape cancels) and Delete with confirmation.

### 10. Sync, storage and backups

- **Local-first sync.** `localStorage` is the working copy, so the app answers at 06:40 on bad signal; the server is a sync point. Writes land locally first and push afterwards (1.2 s debounce, `sendBeacon` on page hide). With no server the app behaves as a static page.
- **Merge rules by store:** history merges ride by ride; gear and favourites are whole-list, newest timestamp wins. Favourites accept an empty list as a real change, so deleting the last one propagates.
- **Server state** is one `state.json` in `STATE_DIR`, written temp-file-then-rename, with `state.prev.json` kept; 4 MB cap. Never inside a read-only app directory under systemd.
- **Backup tab** (from commit `26c74ef`): dated JSON versions in an envelope; `BACKUP_DIR` defaults to `backups/` inside `STATE_DIR`; schedule kept by the server, off until turned on; retention is a plain newest-N count; a run with nothing changed writes nothing; restore *replaces* (import merges) and takes a pre-restore copy first; backup actions have their own 60/minute limit so a restore is never blocked by lookups.
- **Backups outside a Docker container** need a host folder owned by `1000:1000` *and* the `:Z` mount flag on SELinux hosts — tested: root-owned fails with or without `:Z`; uid 1000 fails without `:Z` where SELinux is on. Rootless Podman uses `:Z,U`. The image creates `/backups` owned by `node`.
- **Scheduled backup failures are no longer silent.** A bare catch used to swallow them; now they are logged once (and again only if the reason changes), shown in red on the Backup tab, retried every 5 minutes, and recovery is logged.
- **Restoring a backup from before favourites existed leaves the current favourites alone.**

### 11. Deployment and updating

- **Recommended stack:** Caddy + systemd (automatic HTTPS). Alternatives documented: nginx (+ certbot), **Nginx Proxy Manager**, **Cloudflare Tunnel** (no open port), Docker, Podman with a Quadlet unit, static hosting without Node (the lookup falls back to in-browser inference).
- **systemd:** code stays root-owned in `/opt` and read-only to the service; `StateDirectory=` gives `/var/lib/cycling-weather-matrix`. Do not `chown` the checkout, or `sudo git pull` fails with "dubious ownership".
- **Docker/Podman: replace the container, never just restart it** — a restart keeps running the old image (proven with a marker file). State lives in the `cwem-state` volume at `/state`; bind to `127.0.0.1`.
- **Static deploys copy with an allow-list rsync** (`*.js`, `index.html`, `styles.css`, exclude everything else), so `.git` never reaches a web root.
- **Proxies send `Cache-Control: no-cache`** so new HTML is never served against week-old scripts.
- **Prove an update landed:** compare `shasum model.js` in the checkout with `curl -s https://<domain>/model.js | shasum`.
- **Environment knobs:** `PORT`, `HOST`, `STATE_DIR`, `BACKUP_DIR`, `LOOKUP_RATE` (12/min), `BACKUP_RATE` (60/min), `TRUST_PROXY_HOPS` (1).

### 12. Security

- **Static allow-list (`isServable`):** only browser file types; dotfiles, `deploy/`, `node_modules`, `backups`, `server.js`, `package.json` and `Dockerfile` refused. The server once served `/.git/config` with a 200 — fixed.
- **SSRF closed in the lookup service:** every destination resolved and refused if loopback, private, link-local (incl. `169.254.169.254`), carrier NAT, multicast or reserved, in v4, v6 and v4-mapped v6; redirects followed by hand and re-checked each hop; only ports 80/443. Proven with a live internal server and a redirector, plus a control. **Still open:** DNS rebinding.
- **Rate-limit bypass closed:** the client IP is read `TRUST_PROXY_HOPS` entries from the *end* of `X-Forwarded-For`, and the header is ignored unless the connection came from loopback.
- **Writes require same origin:** a PUT/POST with a foreign `Origin` is refused.
- **The API has no authentication of its own, by design** — expose it only behind proxy auth (Cloudflare Access, basic auth) or not at all.
- **Backup names are checked twice** — against the pattern the server writes and against the directory listing.
- **XSS hygiene:** all rendered user text goes through `escHtml` or `textContent`.

### 13. Interface and design

- **The Weather Effect design system:** dark-first instrument look, the seven-step temperature ramp as data, a temperature edge on cards, Barlow Condensed / IBM Plex Sans / IBM Plex Mono, near-square corners, 44 px targets, and a **glove mode** for winter.
- **A logo:** the temperature ramp wrapped into a wheel.
- **Hours ahead** with sky icons, a wind-direction indicator, a Beaufort rating and a bearing to set off on; the redundant hour-by-hour table was dropped.
- **Tab order:** Ride, Favourites, History, Model, Gear, Backup.
- **Chip rows only sync to settings when they name one** (`[data-group]`), after `syncPills` was found clearing the History filter.
- **`.wx-spacer` is global,** so Edit and Delete sit at the far right of card footers.
- **`.is-error` is styled on notes** so backup errors show in the signal colour rather than grey.
- **Form layout** (from commit `70ca31d`): the ride row uses as many equal columns of at least 140 px as fit; the gear form's span no longer invents an implicit column; a `<label>` styled as a button centres its own text.

### 14. Testing

- **`node:test`, zero dependencies,** run with `npm test` → `node --test`. The directory form `node --test test/` fails on Node 26.
- **170 tests across 31 suites** in `security`, `backup`, `model`, `scorecard`, `favourites` and `climbing` test files.
- **Browser scripts are loaded into tests with `vm.runInThisContext`**, in `index.html` order; `localStorage` is faked in memory where needed.
- **`parseGPX` needs a DOM** (`DOMParser`) and is exercised in the browser; everything downstream of it is tested in Node.
- **`server.js` exports its internals and only listens when run directly,** so tests bind nothing and write to temporary directories.
- **Climbing is tested against known roads × kinds of track** (6 × 6), with the truth defined as what the file itself can express — a 400 m route whose points straddle a summit genuinely does not contain it.
- **Every regression test was confirmed to fail against the old code** before being trusted.

### 15. File map

| File | Role |
|---|---|
| `index.html` | Six screens: ride, favourites, history, model, gear, backup |
| `model.js` | Ride-feel, heat balance, outfit selection |
| `gear.js` | Seeded inventory, slots, storage |
| `insulation.js` | Garment inference engine (browser and Node) |
| `server.js` | Static files, `/api/lookup`, `/api/state`, backups, scheduler |
| `app.js` | Forecast, archive, form wiring, route loading, rendering |
| `gpx.js` | Parsing, thinning, climbing, leg sampling, headwind, lapse rate |
| `history.js` / `historyui.js` | Ride records and the History screen |
| `feedback.js` | Ratings into a temperature correction |
| `scorecard.js` / `scorecardui.js` | The Model screen |
| `favourites.js` / `favouritesui.js` | Favourites storage and screen, Ride now, Save as favourite |
| `sync.js` | Local-first sync of gear, history and favourites |
| `backupui.js` | Backup screen: versions, restore, schedule |
| `gearui.js` | Gear screen and tab switching |
| `map.js` / `weather.js` | Map projection and overlay; sky icons, Beaufort, compass |
| `styles.css` | Design system plus app chrome |
| `INSTALL.md` / `README.md` / `deploy/` | Install, update, proxy and systemd configs |
| `test/` | The six test files |

### 16. Known limitations and open items

- **Offered, not built:** give the gear seed a version so stored lists upgrade themselves, and make sync treat a missing `gearUpdatedAt` as older-than-anything (today an empty stamp means the server's gear is never adopted and an old browser can overwrite it).
- **Deferred:** split `app.js`'s ~310-line `render()` into per-section builders (a maintainability finding from an external review).
- **DNS rebinding** in the lookup service remains a narrow open window.
- **Rootless Podman** backup mounts (`:Z,U`) follow Podman's documentation but were not tested.
- **Wet base layer** is a warning, not a model term.
- **Small bumps under poor GPS** read short (the smoothing trade-off).
- **Knee warmers advised only at 11–13 °C** because the shorts claim 14 °C — the rider's call whether to raise the shorts' `tmin`.
- **GPX-added ride places** use the track name, not a real place name.
- **Enhancements suggested but never requested:** best-window scan across the day, multi-day trip packing in the app.

### 17. Commit timeline

| Date | Commit | Change |
|---|---|---|
| 2026-08-13 | `403edf3` | Cycling weather effect matrix |
| 2026-08-13 | `c33c17b` | Add install instructions and harden for standalone deployment |
| 2026-08-14 | `cf28c61` | Adopt the Weather Effect design system |
| 2026-08-14 | `2b10363` | Add the hours ahead, sky icons, Beaufort and a bearing to set off on |
| 2026-08-14 | `61e7614` | Drop the hour-by-hour table, and make gear inclusion an explicit toggle |
| 2026-08-14 | `79c06d6` | Split gear into brand and model, and give every column a description, a sort and a filter |
| 2026-08-14 | `f86963b` | Fix gear saved behind an active filter vanishing without a word |
| 2026-08-14 | `765b362` | Widen the gear screen, and stop column controls reading as the next column's |
| 2026-08-14 | `c1c8dcb` | Rename Slot to Type, realign the headings, and put a scale on the range |
| 2026-08-14 | `8aaa741` | Double-click a row to edit it, and scroll the editor into view |
| 2026-08-14 | `a2058f9` | Check the kit against a GPX route, not just the start point |
| 2026-08-14 | `383850a` | Say what to bring when one outfit won't cover the route |
| 2026-08-14 | `b69aefb` | Review the gear list against the makers, and write a note for every item |
| 2026-08-14 | `b31dcc5` | A mark for the app: the ramp wrapped into a wheel |
| 2026-08-16 | `09595f0` | Enter an average speed, and put the bearing on a map |
| 2026-08-22 | `d7d3676` | Document updating, and stop the proxy caching scripts for a week |
| 2026-08-22 | `2c176b8` | Add a Podman route, and stop the server handing out its own .git |
| 2026-09-01 | `e2f557f` | Add Nginx Proxy Manager and Cloudflare Tunnel as proxy alternatives |
| 2026-09-01 | `99bb420` | Ask three more models whether they agree |
| 2026-09-01 | `d197a84` | Learn from the ride, and use four free feeds that were sitting there |
| 2026-09-01 | `b269887` | Keep a ride history, and ask for feedback at a time you can answer |
| 2026-09-01 | `48a0442` | Export and import the ride history |
| 2026-09-01 | `0bf103d` | Rate rides only in History, and put History next to Ride |
| 2026-09-01 | `e1a68a8` | Attach a recorded ride, and stop blaming the rider for a bad speed guess |
| 2026-09-02 | `70bcaed` | Sync gear and rides to the server, local-first |
| 2026-09-02 | `985a206` | Fill the gaps in the gear library, and give the neck a slot |
| 2026-09-02 | `b222308` | Three gaiters, socks, named gloves, and an honest rain-trouser rating |
| 2026-09-02 | `6bb634d` | Name the sunglasses, knee warmers and leg warmers |
| 2026-09-02 | `b47b709` | Knee warmers are the C3 Windstopper |
| 2026-09-02 | `bb59d41` | Ramp the self-wind term instead of stepping it at 15C |
| 2026-09-02 | `8f5ead9` | Fix the update paths that silently did nothing |
| 2026-09-02 | `c2dd0a3` | Add a ride from a GPX file, and rate it |
| 2026-09-08 | `46ef76b` | Close the SSRF and the rate-limit bypass, and add tests |
| 2026-09-08 | `6543020` | Weigh the humidity, and say when you'll be wet through |
| 2026-09-08 | `70ca31d` | Let the form rows line up, and stop a span inventing a column |
| 2026-09-09 | `2990c65` | Ask the model how it is actually doing |
| 2026-09-09 | `26c74ef` | Keep dated backups somewhere an update cannot reach |
| 2026-09-09 | `cfe31e6` | Give the gear screen the same width as every other one |
| 2026-09-11 | `7d1661b` | Keep backups in a host folder, and stop scheduled failures hiding |
| 2026-09-11 | `a6145cd` | Add a Favourites tab: keep routes, and put one on the Ride tab |
| 2026-09-15 | `fea1ba8` | Measure climbing on the shape of the road, not point to point |

---

## Reusable prompts

### No prompts were saved as reusable templates

No prompt was refined into a template during this project — there is no prompt library, saved command or skill created from these requests. What follows is not invented: these are **your own requests, verbatim** (typos included), grouped by the kind of work they started, chosen because each one produced a complete, shipped result. They are the raw material if you want to turn any of them into a template.

### Starting a build

> I want to build a simple web application (cycling weather effect matrix) that can advise which cycling gear to wear depending on location, time, expected distance and expected time

> can you add an extra tab to the application where i can maintain favourite rides based on imported gpx files. The favourites can be selected with a button "ride now" and when clicked the ride is loaded in the ride tab. Ask me additional questions if my request is not clear.

*Why it worked:* one outcome stated from the user's side, plus explicit permission to ask. It produced three multiple-choice questions and a build with no rework.

### Multi-part change requests

> can you make the following changes: * rename the slot column to Type * The flags column does not align properly. Its too far to the left * It would be nice of you can add a scale to the ride feel range column. For example in increments of 5 degress celcius

> The filter button is too far to the right and in looks like it is in the next colum / The width of the page is too narrow and the columns are now squuezed. / The windproofness column is no longer visible / Expand the width of the page so the layout is clean

> can you make the following changes: * add the option to enter the average ride speed if the ride time is unknow * add a map of the location or ride when showing the wind direction so I know the starting direction relative to the map.

*Why it worked:* one bullet per change, each describing what is wrong as seen on screen.

### Definition of done

> yes please. build it and test it and them push it to github

> can you push this release to my github

> are all updates committed in github?

### Asking for judgement before building

> i have a windy.app lifetime subscription. would the data from windy.app help to make a more accurate and elaborate forecast such as wind direction?

> I use strava to record my rides. Would it make sense to add a connection with it?

> no but would it be a good addition to add a profile module that also enables a multi user approach with authentication

> can you suggest a number of enhancements I can make to futher improve the application? For example by looking at commercial alternatives?

*Why it worked:* each asks whether something is worth doing before asking for it, which led to researched answers (no API in Windy's consumer plans, Strava's paid API) and cheaper alternatives.

### Reporting a problem

> i can't upload a gpx file of a completed ride to give feedback to the model. Is that a bug or intentional? The upload screen does not accept a gpx file

> the whole app does not update if i follow the install.md instructions

> after updating it still see the old version

*Why it worked:* the symptom as experienced, with "bug or intentional?" inviting a diagnosis rather than a guess at a fix.

### Handing over an external review

> I reviewed the code for this application and received the following comments. Can you check does and patch any holes in the code?

*Why it worked:* "check" before "patch" — each finding was verified against the code and configs before being fixed, and the one maintainability item was deliberately deferred.

### Completing the gear library

> what do you need to know in order to complete the gear library i have? ask me questions to fill in the missing info

> sun glasses are oakley sutro light, knee warmers are gore c3 and leg warmers are bioracer thermal

### Deployment

> can you add a how to install instruction and push it to github. I want to be able to install it on a standalone web server. Include recommended tools or web servers to use

> can you also add an install and update route using podman as container platform?

> can you add an alternative for caddy as a reverse proxy. For example nginx proxy manager or solution using tunnels within cloudflare

> where is the backup saved when the app is deplotyed via docker

> i want to save the backups in a folder outside the container
