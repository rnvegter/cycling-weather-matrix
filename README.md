# Cycling Weather Effect Matrix

Works out what to wear on the bike for one specific ride. You give it a location, a date and
start time, and a distance or duration; it pulls the hourly forecast for the hours you are
actually riding, converts air temperature into a **ride-feel** temperature, and names the
garments — from your own inventory, or from a generic list.

```bash
node server.js          # http://localhost:8765
```

No build step, no npm dependencies, no API key. To put it on a server, see
[INSTALL.md](INSTALL.md).

## Why ride-feel rather than "feels like"

Standing-still numbers are wrong on a bike, because a rider makes their own 25–30 km/h
headwind. The app starts from air temperature at the ride's start hour and adjusts for
self-generated wind (scaled by your actual average speed), ambient wind, rain, sun, darkness,
pace, terrain, and whether you run hot or cold. Every adjustment is shown as a line in the
effect matrix, so the number can be checked against your own experience instead of being
taken on trust.

Hands and feet get their own number. They sit still in the airflow while the body generates
heat, so they run several degrees behind — and a rider who runs hot does not run hot in the
fingers.

## The heat-balance check

On top of the empirical model sits a physical one. Required insulation is

```
It ≈ 0.148 × (33 − T) ÷ MET    clo
```

with 33 °C the minimum comfortable skin temperature and MET the work rate, taken from the
[Compendium of Physical Activities](https://pacompendium.com/bicycling/) by average speed
(6.8 at 16–19 km/h, 12 at 26–31 km/h).

The outfit's catalogue clo is then knocked down by the apparent wind, and how much survives
depends on the **outermost** layer. That is why a 75 g windproof gilet beats a much thicker
permeable fleece — the physics reproduces the advice rather than being told it.

The tolerances are deliberately wide. The formula is a dry-heat requirement for a fully
covered body, while a working cyclist dumps a great deal of heat evaporatively and through
bare skin, so only a clear mismatch is worth flagging.

## Gear

`gear.js` seeds an inventory. Each item carries a slot, the coldest and warmest ride-feel °C
it works at, clo, windproofness and waterproofness (0–1), and flags for short-sleeve,
packable and rain-only.

**Ranges select the garment; clo sizes the stack.** The ranges are the rider's own
calibration rather than any maker's air-temperature claim, so they stay in charge — the
heat balance is a check on top, allowed to add a gilet only when it is genuinely cold.

The gear screen (`#gear`) adds, edits and removes items. Each row carries an **In / Out**
toggle deciding whether that garment is considered when picking kit — for anything lent out,
in the wash, or not packed for a trip — with All In / All Out for the packing case. Clicking a
row anywhere else selects it; double-clicking it opens the editor, which saves a trip back up
to the toolbar for anything near the bottom of a long list. Opening the editor either way
scrolls it into view.

Brand and model are separate fields, so the table sorts and filters by maker. Every column
header carries its description on hover or keyboard focus, plus a sort button cycling
ascending, descending and off, and a filter shaped to the column: a checklist for brand and
type, contains-text for model, min and max for the numbers, and for the range a single
temperature that asks the question actually worth asking — *what covers 8°C?* Filters stack,
and the row count says how many are showing.

The range column is a chart, so it carries a scale: ticks every 5 °C under the heading and
gridlines at the same spacing on every row, which is what lets one bar be read as a
temperature rather than only as longer or shorter than its neighbours.

Columns are declared once in `GEAR_COLS`, which carries each label, description, sort
accessor and filter type, so the header controls can't drift out of step with the data. Both the add and edit flows offer a
lookup that fetches manufacturer and retailer pages through the local service and extracts
the quoted temperature range and fabric technology. Found values are shown next to yours with
per-field checkboxes — nothing is overwritten silently.

Edits live in `localStorage` and sync to the server when one is running — see below.

## The lookup service

Browsers cannot fetch manufacturer sites directly, so `/api/lookup` in `server.js` does it
server-side: it searches, pulls the two or three most promising pages, strips them to text,
and hands that to the same inference engine that runs in the page.

Scraped pages carry navigation, related products and reviews of other garments, so a keyword
appearing once proves nothing. Each fabric signature is scored by where it appears and how
often, and the best-supported one sets each property — without which a Perfetto page that
mentions Shakedry in a sidebar comes back waterproof, which it is not.

When the search or the fetches fail, the engine still runs on the garment name alone and says
so. Confidence is reported on every result.

The inference fallback is fitted against the seeded wardrobe: mean error 0.016 clo and
1.4 °C on the temperature ranges.

**This is scraping, and scraping breaks.** Site markup changes, search endpoints rate-limit.
The fallback means the button always returns something, but treat a low-confidence result as
a starting point rather than an answer.

## The hours ahead, and which way to set off

The forecast runs from the start hour to a few hours past the planned finish, so a shower
landing twenty minutes after you would be home is visible before you decide how long to go
out for. Riding hours are lit; the rest are dimmed but present. Each hour carries its sky as
an inline SVG icon tinted from the ramp, its temperature, an arrow pointing the way the wind
is blowing, and the chance of rain.

Distance, time and speed are one triangle: give any two and the third follows. Speed is the
one you can state from experience when you have no idea how long a route will take, which is
the usual case for a route you have not ridden. Give all three and the two facts win, and it
says so rather than quietly ignoring what you typed.

Wind gets a map, a compass rose, a **Beaufort** force with what that force means on a bike, and a
bearing to set off on. The rule is out into it, home with it: the return leg is the one ridden
tired, and a headwind there is what actually makes people cold. The bearing follows the wind
in the **second half** of the ride rather than the average, because that is the wind the way
home is ridden in — and when the two differ by more than 40° the app says so rather than
quietly picking one.

Below force 3 it says the wind isn't worth planning a route around, instead of inventing
advice.

**How sure is it?** Open-Meteo's default already serves the highest-resolution model for a
location — over the Netherlands that is KNMI HARMONIE at 2.5 km, and it is what everything
above is built from. What one model cannot say is how much to trust itself, so the ensemble
answers that: ECMWF runs its model **51 times** from slightly different starting conditions.
Where the members agree the atmosphere is behaving predictably; where they scatter it is not.
That turns "it might rain" into "9 of 51 members have rain", and it covers the globe — checked
from Reykjavik to Sydney. If it fails, the line disappears and nothing else changes.

The map is what makes the bearing usable: "set off towards the WSW" means nothing until you
can see which way that is from where you're standing. It draws the route, or the start point,
north-up with the wind and the outbound bearing over the top. Tiles come from OpenStreetMap —
no key, but it does need crediting, and the credit is on the map. **Everything except the
tiles is drawn locally**, so a blocked host or an offline server costs you the basemap and
leaves the route, arrows, north arrow and scale bar intact.

## Checking a route

Load a GPX and the kit gets checked against the whole ride rather than the start point. Three
things change along a route and none are visible from where you set off: **where you are**,
because a coastal leg and an inland one are different weather; **how high**, at roughly
0.65 °C per 100 m; and **which way you're pointing**, because wind only chills you by the part
of it you ride into.

The route is cut into legs — more of them when there's climbing, since cutting an 11 km
mountain route by distance alone smooths a col down to its leg average and hides the thing you
loaded the route to find. Each leg gets its own position, elevation, heading, and clock time,
arrived at with a gradient-adjusted speed so a col is reached when you'd actually reach it.
One forecast call covers every leg.

Climbing and descending are treated as opposite problems, which they are: climbing at 7% is
the warmest you'll be all day — hard effort, low speed, almost no airflow — and the descent
that follows is the cold one.

The verdict compares what you'd have to **put on or take off**, not garment names. Two
near-equivalent jerseys swapping over a single degree is the model breaking a tie, not the ride
needing different kit, and reporting that as a change would cry wolf on every route.

When the kit doesn't hold, it says what to bring. The distinction that decides everything is
what you can change at the roadside: arm warmers, a gilet, gloves and overshoes go on and come
off in a layby, while a base layer, a jersey and bib tights mean stripping. So the
unchangeable things are chosen for the **warmest** leg — anything warmer would cook you on the
climb with no way out — and the cold end is covered by what goes in a pocket, with the
kilometre and clock time each item goes on.

That plan is then checked rather than assumed: worn plus carried is run back through the heat
balance at the coldest leg. If a pocket can't close it, the conflict is named as one garment
with the trade either way, plus any workaround the wardrobe has — the shorts-and-warmers route
to where tights reach. If nothing closes it, it says so and suggests shortening the ride.

## Syncing

The gear list and the ride history are the two things here that cannot be regenerated, and
`localStorage` is one browser and one cleared-site-data away from losing them. When the server
is running they sync to a single `state.json` beside it.

**Local-first, deliberately.** `localStorage` stays the working copy, so the app still answers
at 06:40 on bad signal with nothing reachable; the server is a sync point rather than the
source of truth. Writes land locally first and are pushed after, a failed push is queued and
retried on the next change, and where there is no server at all — files opened directly, or a
static deployment — none of it runs and the app behaves exactly as it did before.

The two stores merge differently because they are used differently. **History merges ride by
ride**, on the same rules as the import: rides accumulate independently on whichever device you
open, so both sides hold real entries the other has never seen. **Gear is last-write-wins**,
guarded by a timestamp — you edit it deliberately, in one sitting, and merging per garment
would mean stamping every item to protect against something that does not happen.

The file is written temp-then-rename so a crash mid-write cannot leave truncated JSON where
your gear list was, and the previous version is kept alongside as `state.prev.json`. Backing up
is a file copy. Note that the endpoint has no authentication of its own: on a public
deployment, put auth in front of it — see INSTALL.md.

## Ride history

Every ride the model works out is kept, because the question the calibration needs — how did
that actually feel — can only be answered after the ride, while the forecast is read before it.
Rating happens on the History tab and nowhere else: the ride screen is read before you leave,
which is the one moment the question cannot be answered.
Without somewhere to put them, rating a ride meant remembering to re-run the identical query
afterwards.

A ride is identified by where and when, not by when you looked it up, so tweaking the pace and
pressing the button again updates that entry instead of filling the list with near-duplicates
of one morning — and any rating already given survives the re-run.

The history splits on the only distinction that matters: a ride in the future says *not ridden
yet* and waits, and a ride in the past asks the question. Rides can be rated, re-rated and
deleted, and deleting a rated one tells you it also removes what that ride taught the model.

**A ride you never planned here can still be rated.** For a long time only rides worked out on
the Ride tab could be, which quietly assumed you always plan before riding — and if you simply
went out and rode, there was nowhere to put the result. **Add a ride from GPX** closes that: a
recorded file already says where you were, when you started and how long you took, and the
weather is the one missing input that can be looked up afterwards. The archive is asked what
actually happened, the same model is run over it, and the ride lands in the history rateable,
tagged *from GPX* so its provenance stays visible.

The reconstruction is better evidence than a planned entry, not worse. It uses measured weather
rather than a forecast, and measured speed rather than an estimate — which is the larger of the
two errors the calibration otherwise has to absorb. So these count toward the learned offset on
equal footing. Effort is the one thing a GPX cannot tell you, since a slow hour into a headwind
and a slow hour freewheeling look identical, so that keeps whatever pace you have set.

**Attach what actually happened.** Speed is the model's weakest input: it is typed in
beforehand and it drives the self-generated wind chill. Drop the GPX of a completed activity
onto a ride — Strava's activity export carries a timestamp on every point, its route export
does not — and the real moving average replaces the guess.

That separation matters more than it sounds. Speed touches ride-feel through exactly one term,
so the size of the error is exact rather than estimated, and the calibration learns only what
is left after it. Assume 24 km/h, ride 30, and come home cold, and the naive reading is "runs
cold"; the correct reading is that you rode harder, and the correction is zero.

Export writes `cycling-rides-<date>.json`. **Import merges rather than replaces** — the
opposite of the gear list, and deliberately. Gear is one inventory kept in one place; rides
accumulate wherever you happen to open the app, so a file from the laptop must not discard what
the phone recorded since. Where the same ride exists on both sides the rated one wins, because
a rating is evidence and an empty slot is not, and if both are rated the more recent rating
stands.

## Learning your calibration

The rider setting began as a single hand-set number — +3 °C for "runs hot", decided once. It
is the most influential term in the model and was the least evidenced.

After a ride, one question: too cold, about right, or too warm. Each answer is a correction,
and the running mean of the corrections is worth more than any one-off self-assessment. Two
guards keep it honest: nothing applies until three rides exist, because one cold morning says
more about that day than about you; and only the last twenty count, so the number follows a new
jacket or a fitter spring instead of being anchored to a season that has passed. It is capped
at ±4 °C and shown as its own row in the effect matrix, because a correction you cannot see is
one you cannot argue with.

Once there are enough wet rides it keeps a separate correction for them. Plenty of riders run
hot in the dry and cold in the wet, and one number cannot hold both.

## Look

An instrument rather than a lifestyle app: it gets read on a phone at 06:40 in December,
outdoors, in poor light, often with cold hands. So it is dark by default, nearly square-
cornered, and set in a condensed display face with a monospace for anything numeric — figures
that don't shift width as they count.

Colour is data. A seven-step temperature ramp runs from frozen blue to baking rust, and every
non-chrome colour comes from it: the ride-feel figure, the mark on the scale beneath it, the
left edge of each card, and the range bars on the gear screen, which are the same band chart
in miniature — a gap in the wardrobe reads as a gap in the column.

The mark is the app rather than a picture of a bicycle: the temperature ramp wrapped into a
wheel and cut into its seven bands, with a needle reading off it. It is drawn from the same
gradient stops as `--ramp`, so the logo and the scale under the ride-feel figure cannot drift
apart, and it takes the theme's ink for the needle so it inverts with everything else. The
favicon is the same mark with the colours baked in, inline as a data URI — no image file.

**Glove mode** enlarges tap targets and type for cold hands. It lives on the ride screen,
where it is needed, rather than in the tab row, where it would read as a destination.

The three fonts load from Google Fonts. They degrade to Arial Narrow, the system sans and the
system monospace if that request fails or you are offline, so nothing breaks — but see
INSTALL.md if you want to self-host them for a genuinely offline install.

## Files

| File | |
|---|---|
| `index.html` | Three screens — ride, history, gear |
| `model.js` | Ride-feel, heat balance, outfit selection |
| `gear.js` | Seeded inventory and storage |
| `insulation.js` | Inference engine, runs in both browser and Node |
| `server.js` | Static files plus `/api/lookup` |
| `app.js` | Forecast, form wiring, rendering |
| `gearui.js` | Gear screen: add, edit, delete, lookup |
| `sync.js` | Local-first sync of gear and history |
| `gpx.js` | Route parsing, leg sampling, headwind and lapse rate |
| `history.js` | Ride records, and the calibration's source of truth |
| `historyui.js` | The history screen |
| `feedback.js` | Turning ratings into a temperature correction |
| `map.js` | Slippy-map projection, tiles, and the drawn overlay |
| `styles.css` | The Weather Effect design system, plus app chrome |

Forecast data from [Open-Meteo](https://open-meteo.com/). Wind correction after
ISO 11079 / 9920.
