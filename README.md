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
row anywhere else selects it for editing, so the two actions never fight each other.

Brand and model are separate fields, so the table sorts and filters by maker. Every column
header carries its description on hover or keyboard focus, plus a sort button cycling
ascending, descending and off, and a filter shaped to the column: a checklist for brand and
slot, contains-text for model, min and max for the numbers, and for the range a single
temperature that asks the question actually worth asking — *what covers 8°C?* Filters stack,
and the row count says how many are showing.

Columns are declared once in `GEAR_COLS`, which carries each label, description, sort
accessor and filter type, so the header controls can't drift out of step with the data. Both the add and edit flows offer a
lookup that fetches manufacturer and retailer pages through the local service and extracts
the quoted temperature range and fabric technology. Found values are shown next to yours with
per-field checkboxes — nothing is overwritten silently.

Edits live in `localStorage`, so they are per-browser. Use Export/Import to move them.

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

Wind gets a compass rose, a **Beaufort** force with what that force means on a bike, and a
bearing to set off on. The rule is out into it, home with it: the return leg is the one ridden
tired, and a headwind there is what actually makes people cold. The bearing follows the wind
in the **second half** of the ride rather than the average, because that is the wind the way
home is ridden in — and when the two differ by more than 40° the app says so rather than
quietly picking one.

Below force 3 it says the wind isn't worth planning a route around, instead of inventing
advice.

## Look

An instrument rather than a lifestyle app: it gets read on a phone at 06:40 in December,
outdoors, in poor light, often with cold hands. So it is dark by default, nearly square-
cornered, and set in a condensed display face with a monospace for anything numeric — figures
that don't shift width as they count.

Colour is data. A seven-step temperature ramp runs from frozen blue to baking rust, and every
non-chrome colour comes from it: the ride-feel figure, the mark on the scale beneath it, the
left edge of each card, and the range bars on the gear screen, which are the same band chart
in miniature — a gap in the wardrobe reads as a gap in the column.

**Glove mode** enlarges tap targets and type for cold hands. It lives on the ride screen,
where it is needed, rather than in the tab row, where it would read as a destination.

The three fonts load from Google Fonts. They degrade to Arial Narrow, the system sans and the
system monospace if that request fails or you are offline, so nothing breaks — but see
INSTALL.md if you want to self-host them for a genuinely offline install.

## Files

| File | |
|---|---|
| `index.html` | Two screens — ride, and gear |
| `model.js` | Ride-feel, heat balance, outfit selection |
| `gear.js` | Seeded inventory and storage |
| `insulation.js` | Inference engine, runs in both browser and Node |
| `server.js` | Static files plus `/api/lookup` |
| `app.js` | Forecast, form wiring, rendering |
| `gearui.js` | Gear screen: add, edit, delete, lookup |
| `styles.css` | The Weather Effect design system, plus app chrome |

Forecast data from [Open-Meteo](https://open-meteo.com/). Wind correction after
ISO 11079 / 9920.
