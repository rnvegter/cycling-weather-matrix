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

## Humidity, and the heat you can't get rid of

Everything above is dry heat: air, wind, and rain landing on the outside of the garment. But
a working rider sheds most of their surplus by evaporating sweat, and whether that works
depends on the air it has to evaporate into. **24 °C at 85% and 24 °C at 45% are the same
figure on the forecast and two quite different rides.**

It takes both humidity numbers to say this, and either one alone gets a corner of the world
wrong.

What physically blocks evaporation is the water already in the air — the **vapour pressure**,
in hPa, which is what a dew point states outright and a percentage only implies. So the size
of the penalty comes from that. A percentage cannot size it: 90% at 8 °C is drier air, in
absolute terms, than 50% at 26 °C, and reading the percentage ranks them the wrong way round.

But vapour pressure alone cannot decide *whether* there is a penalty, which a desert
afternoon proves. Las Vegas at 37 °C and 23% carries more water than a pleasant Dutch morning
does, and evaporates sweat off you faster than anywhere else in this model, because the air
is nowhere near full. An early version of this term called that **muggy**, which is the kind
of number that stops a reader trusting the rest of the page. So the percentage gates the
penalty — it says how close the air is to being full — and nothing is charged until it is
getting there. The dry side is the same argument mirrored: thirsty air is a real help, and
how thirsty it is, is the vapour pressure deficit.

The coefficient is anchored to the Bureau of Meteorology's apparent temperature, which
carries humidity as +0.33 e with e in hPa. That is a standing person in still air, and a
rider has 25–30 km/h of their own airflow carrying the vapour away — the single most
effective thing there is for evaporation — so what is charged here sits well under it, capped
at +3 °C and −2 °C.

Below 10 °C the term is off entirely. Cold damp air does feel worse than cold dry air, but
the mechanism there is conduction through wet clothing rather than blocked evaporation, and
the rain term already owns it. Every threshold ramps rather than steps.

**It does not touch the heat balance's requirement, and that is deliberate.** Insulation is
what holds heat *in*, and how much you need is a dry question. Humidity governs getting heat
*out*. What it does change is the tolerance: the balance above allows a wide surplus because
"above 15 °C the extra can always be sweated away", and that clause is only true while the
air will take the sweat. So the warm-side tolerance closes as evaporation is blocked — the
same surplus layer that is harmless at 22 °C and 40% is genuinely too much at 22 °C and 90%.

### Wet through before the top

Climbing at 7% is the warmest **and the wettest** you will be all day: hard effort, low speed,
and almost no airflow to carry the sweat away. The descent that follows is then ridden in
whatever the climb left you wearing — and that leg's ride-feel was worked out for a dry
rider.

It is the pair that matters, so the route check looks across legs rather than at any one of
them: a wet climb with only flat road after it dries out as you ride, and a cold descent with
no climb before it is already described by its own numbers. Where both halves are there, the
route card names the climb, the descent, and the drop between them. The answer is not a
thicker layer underneath but something windproof you can shut over a wet one.

Off a route, the same warning is drawn from the pace and the length of the ride instead, and
it steps aside when the route card has already said it with kilometres attached.

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

**Five columns, not nine.** The table shows what you scan a wardrobe for — whether it counts,
who made it, which garment, what it competes with, and the range it covers. clo, wind and
water are two or three characters each and flags is a word, but a column's width is set by its
heading, and every heading carries a label, a sort button and a filter control: those four
were charging 100–115px apiece to display a 32px number. Nine columns is also why this screen
used to widen the whole page from 44 to 82rem, moving the header, the tabs and the footer as
you arrived. One page width now, and the table fits inside it.

The three flags travel with the model instead, as small **SS / PACK / RAIN** badges beside the
garment's name — whether something packs into a pocket is worth seeing while reading down the
list, and it is what the route packing plan reads to decide what can go on at the roadside.

Clicking a row opens a **detail line** underneath it with clo, wind, water, the flags, the
range and the garment's note — more than the columns ever showed, since no column had room for
the note. Not a tooltip, deliberately: this app is read on a phone at 06:40 with cold hands,
and hover does not exist there, so the numbers would have been unreachable on the device that
matters most. One tap works everywhere.

Brand and model are separate fields, so the table sorts and filters by maker. Every column
header carries its description on hover or keyboard focus, plus a sort button cycling
ascending, descending and off, and a filter shaped to the column: a checklist for brand and
type, contains-text for model, and for the range a single temperature that asks the question
actually worth asking — *what covers 8°C?* Filters stack, and the row count says how many are
showing. Sorting and filtering by clo, wind, water or flags went with their columns; the
values themselves are a tap away, and in the editor.

The range column is a chart, so it carries a scale: ticks every 5 °C under the heading and
gridlines at the same spacing on every row, which is what lets one bar be read as a
temperature rather than only as longer or shorter than its neighbours.

Columns are declared once in `GEAR_COLS`, which carries each label, description, sort
accessor and filter type, so the header controls can't drift out of step with the data. The
four that left the table are still declared there, marked `inTable: false` — a column this app
stops drawing is not a column it stops knowing about, and the detail line reads their labels
and descriptions straight from those definitions. Both the add and edit flows offer a
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

## Favourite rides

The routes you ride again live on the **Favourites** tab. Add them from GPX files there — a
planned route or a recorded ride, several at once — or load one on the Ride tab and press
**Save as favourite**. **Ride now** puts a favourite back on the Ride tab: the route, where it
starts, its surface and your usual speed on it. It deliberately stops short of asking for the
forecast, because the date and start time are the one thing a favourite cannot know, and advice
for the wrong morning is worse than a second click.

A favourite always moves the start point to the route's own start, where loading a file only
fills it in when nothing is set. That is the difference between a place you searched for on
purpose and a ride that starts where it starts; keeping Utrecht in the box while loading a
route from Amerongen would forecast for the wrong town without a word. It also clears any
leftover ride duration, which would otherwise override the favourite's speed.

A **recorded** ride brings its own average speed, read off the timestamps of the full recording.
A planned route has none until you give it one, and meanwhile uses the Ride tab's assumption
for the surface and pace — so it follows those instead of freezing a guess.

Tracks are kept thinned to about one point per 50 m, never more than 2,500. A four-hour
recording is some 14,000 points and the best part of a megabyte, and favourites share
localStorage's 5 MB with the gear and history and sync into a state file capped at 4 MB. In
testing, a 677 KB recorded file and a second planned route took 43 KB between them once thinned
and packed. The start, finish, highest and lowest points are always kept, since the summit is
the reason to check a route at all.

Favourites sync between devices and go into backups like the rest. Whole-list, newest wins, as
the gear does — so a favourite deleted on one device cannot be merged back in by another that
still has it, and deleting the last one counts. Restoring a backup taken before favourites
existed leaves the current list alone rather than wiping it.

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

## Backups

`state.prev.json` is one step of insurance: the version before the last write. That is the
wrong thing entirely when what you want is the gear list as it stood in March, or the history
back from before an afternoon of edits went sideways. The two stores here cannot be
regenerated from anything — the gear list is your own calibration of every garment you own,
the history is the only record of how the model has done — so the **Backup** tab keeps dated
versions of both.

**In a directory of its own, and that is the point.** Updating this app means replacing the
files in its own directory: a `git pull`, a fresh clone, a rebuilt container. Anything sitting
among them is at the mercy of that. Backups go to `BACKUP_DIR`, which defaults to a `backups/`
directory inside `STATE_DIR` — under systemd that is already outside the app, and locally it
is a directory git neither tracks nor checks out over. Point `BACKUP_DIR` at an external disk
or a synced folder and nothing else changes.

Each version is one JSON file holding the whole document inside an envelope that says when it
was taken and why. The envelope earns its place on the way back in: a restore can check that a
file is one of these before it overwrites anything, rather than trusting a filename. Names are
dated, so sorting them by name sorts them by time, and carry no colons — illegal in a Windows
filename, a nuisance in a shell.

**On a schedule, kept by the server rather than the page.** A backup that only happens while a
tab is open is not a schedule, it is a coincidence — and the morning you most want yesterday's
copy is the one you never opened the app. It is off until you ask for it, because writing files
on someone's disk uninvited is not a decision an app should make for itself. Retention is a
plain count: the newest N survive, the rest are pruned oldest-first. A run that finds nothing
changed since the last version writes no file, so a fortnight off the bike does not fill the
directory with the same document thirty times — and `savedAt` is excluded from that comparison,
since the sync stamps it on every push whether or not anything you own actually moved.

**Restoring replaces rather than merges**, and that is the whole difference between a restore
and the History tab's import. Import is for bringing another browser's rides in alongside your
own; restore is for putting back what you had. Merging here would make it impossible to undo a
bad afternoon, which is the main thing anyone ever wants a backup for. A copy of the current
state is taken first and the restore stops if that copy cannot be written, so a restore is
itself undoable. The restored gear list is stamped with the current time rather than the
backup's own, or the next sync from a device still holding the newer list would quietly bring
back the very thing you just undid.

**With no server there is no list and no schedule**, and the tab says so instead of showing
dead buttons. The two things that never needed one still work: download a copy to your disk,
and restore from a file you downloaded earlier.

Names that arrive from the browser are checked twice before they address a file — against the
pattern this writes, and against the directory listing — so a name can only ever reach
something the app put there. The backup directory is refused by the static file server by
name as well as by extension, and backup actions have their own rate limit rather than sharing
the gear lookup's, which had meant a handful of lookups could leave a restore refused.

## Does the model work?

The calibration above takes every rating you give and collapses it into one mean. That is
the least interesting thing that can be done with them. The ratings are a record of **when
the model was wrong, and in which direction** — read whole, they say *where* it is biased
rather than only by how much on average, and whether the correction it draws from them is
worth anything at all.

So the **Model** tab argues with the model the way the effect matrix argues with its inputs.

Three figures at the top. **Called it right** is the share of rides you answered *about
right*, counted from your verdicts and nothing else. **Mean error** is the average signed
error, and its sign is the part worth being careful about: a verdict of *too warm* is +2,
because you were overdressed, which means the model predicted a colder ride than you got. So
a positive mean means the model **reads cold** — it under-states ride-feel and overdresses
you. **Typical miss** is the same error with the direction thrown away.

The mean is only allowed to claim a bias when it clears its own noise: **anything inside two
standard errors of zero is reported as noise**, not as a finding, because a mean error of
+1.2 over four rides and the same figure over forty are not the same claim. Every figure on
the page carries the number of rides behind it.

### Where it is biased

The same summary again, over each half of the splits the model already treats as different
cases: rain, air temperature at 5 °C, wind, length, and where the ride came from. **The
thresholds are the model's own** — windy is what the outfit picker calls windy, three hours
is what it calls a long ride — because inventing new ones here would measure a model nobody
is running.

The last split is a provenance check rather than a condition. This README claims a ride
rebuilt from a recorded GPX is better evidence than a forecast one; that row is where the
claim can be read off instead of asserted.

A split can also say **don't know**, which is not the same as false. Rides recorded before
the wind was stored carry no wind reading, and counting those as calm would invent evidence,
so they are reported as uncovered. And a side with three or four rides on it is shown greyed
and labelled rather than hidden — a hint about where to look next, not a finding.

One number saying the model is half a degree out cannot tell you it is two degrees out in the
wet and right in the dry. That is a different problem with a different fix, and it is the
reason this section exists.

### Leave one out

The correction is a mean of your ratings, so scoring it against those same ratings would
flatter it — it would do well by construction. So each rated ride is set aside in turn, the
correction is worked out from **every other** ride, and then applied to the ride it never
saw. Against the only baseline that matters: **doing nothing**.

It reports the average miss, the same weighted so that one 3° miss counts for more than three
1° ones, and how many rides would have been called right. **The two can disagree, and when
they do it says so** rather than quoting whichever flatters the feature: shifting every ride
by one number pulls the far misses in and pushes the rides that were already spot on off
their mark. It is entirely possible for a mean of scattered ratings to be worse than no
correction at all, and if that is what the rides say, the page says it.

The wet correction gets the same treatment. `feedback.js` keeps a second mean for rides in
the rain on the argument that a rider can run hot in the dry and cold in the wet and one
number cannot hold both. That is a claim, and it is checked the same way: for each wet ride,
is the wet-only mean of the others closer to it than the pooled mean?

**What this cannot tell you** is on the page too, in as many words. Leaving one out is not a
replay of your season — it does not take the ratings in the order they arrived, so it says
whether the correction generalises, not whether it would have helped on any particular
morning. And every figure rests on one rider's memory of how a ride felt, recorded
afterwards. That is the right evidence for the question, and it is the only evidence there
is, but it is not a measurement.

Nothing in the tab is a second model. It reuses the same `learnedOffset` the app applies,
because a scorecard grading its own reimplementation of the estimator grades the wrong thing.

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
| `index.html` | Six screens — ride, favourites, history, model, gear, backup |
| `model.js` | Ride-feel, heat balance, outfit selection |
| `gear.js` | Seeded inventory and storage |
| `insulation.js` | Inference engine, runs in both browser and Node |
| `server.js` | Static files, `/api/lookup`, the synced state, and the backups |
| `app.js` | Forecast, form wiring, rendering |
| `gearui.js` | Gear screen: add, edit, delete, lookup |
| `sync.js` | Local-first sync of gear, history and favourites |
| `gpx.js` | Route parsing, thinning, leg sampling, headwind and lapse rate |
| `history.js` | Ride records, and the calibration's source of truth |
| `historyui.js` | The history screen |
| `favourites.js` | Favourite routes: storage, thinning, duplicates |
| `favouritesui.js` | The favourites screen, Ride now, and Save as favourite |
| `feedback.js` | Turning ratings into a temperature correction |
| `scorecard.js` | Whether the model and that correction are any good |
| `scorecardui.js` | The model screen |
| `backupui.js` | The backup screen: versions, restore, schedule |
| `map.js` | Slippy-map projection, tiles, and the drawn overlay |
| `styles.css` | The Weather Effect design system, plus app chrome |

Forecast data from [Open-Meteo](https://open-meteo.com/). Wind correction after
ISO 11079 / 9920.
