"use strict";

/* ---------------------------------------------------------------
   Favourite rides: the thinning, the storage rules, and the two ways a
   favourite could quietly go wrong — a route that stops being recognised as
   the one you already kept, and a summit that thinning shaves off.

   favourites.js is a browser script that expects localStorage, so a small
   in-memory one stands in. node --test gives each file its own process, so
   this touches nothing else.
----------------------------------------------------------------*/

const {test, describe, before, beforeEach} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let quota = Infinity;          // bytes the fake storage will hold
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => {
    const used = [...store].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
    if (used + String(v).length > quota){
      const e = new Error("quota"); e.name = "QuotaExceededError"; throw e;
    }
    store.set(k, String(v));
  },
  removeItem: k => store.delete(k)
};

before(() => {
  ["gpx.js", "favourites.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});
beforeEach(() => { store.clear(); quota = Infinity; });

const T0 = Date.parse("2026-08-01T06:00:00Z");

/* A dense, wiggly, climbing track: one point every ~11 m, like a recording,
   with the summit somewhere in the middle rather than at a kept point. */
function recording(n = 4000, {timed = true, summitAt = 1733, summit = 412} = {}){
  return Array.from({length: n}, (_, i) => ({
    lat: 52 + i * 0.0001 + Math.sin(i / 9) * 0.00004,
    lon: 5 + Math.cos(i / 13) * 0.0003,
    ele: i === summitAt ? summit : 20 + 150 * Math.sin(i / n * Math.PI),
    t: timed ? T0 + i * 3000 : null
  }));
}

/* --- Thinning ----------------------------------------------------- */

describe("simplifyTrack", () => {
  test("thins a dense recording a long way", () => {
    const raw = recording();
    const thin = simplifyTrack(raw, 50, 2500);
    assert.ok(thin.length < raw.length / 3, `${thin.length} of ${raw.length} kept`);
  });

  test("keeps the start and the finish exactly", () => {
    const raw = recording();
    const thin = simplifyTrack(raw);
    assert.deepEqual(thin[0], raw[0]);
    assert.deepEqual(thin[thin.length - 1], raw[raw.length - 1]);
  });

  test("keeps the summit even when it falls between two kept points", () => {
    // The route check exists to find the high point; losing it understates the climb.
    const raw = recording(4000, {summitAt: 1733, summit: 412});
    const thin = simplifyTrack(raw);
    assert.equal(Math.max(...thin.map(p => p.ele)), 412);
    assert.equal(routeStats(thin).maxEle, routeStats(raw).maxEle);
  });

  test("keeps the lowest point too", () => {
    const raw = recording();
    raw[2999].ele = -7;
    assert.equal(Math.min(...simplifyTrack(raw).map(p => p.ele)), -7);
  });

  test("barely changes the distance", () => {
    const raw = recording();
    const a = routeStats(raw).distance, b = routeStats(simplifyTrack(raw)).distance;
    assert.ok(Math.abs(a - b) / a < 0.03, `raw ${a.toFixed(2)} km, thinned ${b.toFixed(2)} km`);
  });

  test("never exceeds the cap, however long the ride", () => {
    const raw = recording(40000);
    assert.ok(simplifyTrack(raw, 50, 2500).length <= 2500);
  });

  test("leaves tiny inputs alone and survives bad ones", () => {
    assert.deepEqual(simplifyTrack([]), []);
    assert.deepEqual(simplifyTrack(null), []);
    const two = recording(2);
    assert.equal(simplifyTrack(two).length, 2);
  });
});

/* --- Storage shape ------------------------------------------------ */

describe("favourites on disk", () => {
  test("packing to [lat, lon, ele] survives the round trip to a metre", () => {
    const pts = recording(50);
    const back = unpackPoints(packPoints(pts));
    back.forEach((p, i) => {
      assert.ok(Math.abs(p.lat - pts[i].lat) < 1e-5);
      assert.ok(Math.abs(p.lon - pts[i].lon) < 1e-5);
      assert.equal(p.ele, Math.round(pts[i].ele));
      assert.equal(p.t, null, "a favourite is a route, not a timed activity");
    });
  });

  test("a 100 km route stays small", () => {
    const fav = favouriteFromParsed({name: "Long", points: recording(9000), recorded: true}, {});
    const kb = JSON.stringify(fav).length / 1024;
    assert.ok(kb < 120, `${kb.toFixed(0)} KB`);
  });

  test("normalising rebuilds what arrives rather than trusting it", () => {
    assert.equal(normaliseFavourite(null), null);
    assert.equal(normaliseFavourite({points: [[52, 5, 1]]}), null, "one point is not a route");
    const f = normaliseFavourite({
      name: "  x  ", type: "unicycle", speed: 900,
      points: [[52, 5, 1], [999, 5, 1], [52.01, 5, "high"], ["a", 5, 1], [52.02, 5.01, null]]
    });
    assert.equal(f.name, "x");
    assert.equal(f.type, "road", "an unknown surface falls back to road");
    assert.equal(f.speed, null, "an impossible speed is dropped");
    assert.equal(f.points.length, 3, "out-of-range and non-numeric points are dropped");
    assert.equal(f.points[1][2], null, "non-numeric elevation becomes none, not zero");
  });

  test("a speed without a source is called typed, never recording", () => {
    assert.equal(normaliseFavourite({points: [[52, 5], [52.1, 5]], speed: 25}).speedFrom, "typed");
    assert.equal(normaliseFavourite({points: [[52, 5], [52.1, 5]], speed: 25,
      speedFrom: "recording"}).speedFrom, "recording");
    assert.equal(normaliseFavourite({points: [[52, 5], [52.1, 5]], speedFrom: "recording"}).speedFrom,
      null, "no speed, no source");
  });
});

/* --- Speed -------------------------------------------------------- */

describe("where a favourite's speed comes from", () => {
  test("a recording supplies its own, from the full-resolution timestamps", () => {
    const pts = recording();
    const fav = favouriteFromParsed({name: "R", points: pts, recorded: true}, {});
    assert.equal(fav.speedFrom, "recording");
    assert.ok(Math.abs(fav.speed - activityStats(pts).speed) < 0.1);
  });

  test("a recording outranks a speed passed in", () => {
    const fav = favouriteFromParsed({name: "R", points: recording(), recorded: true}, {speed: 99});
    assert.equal(fav.speedFrom, "recording");
  });

  test("a route file keeps a speed you gave it, or none", () => {
    const route = {name: "P", points: recording(4000, {timed: false}), recorded: false};
    assert.equal(favouriteFromParsed(route, {speed: 26}).speed, 26);
    assert.equal(favouriteFromParsed(route, {speed: 26}).speedFrom, "typed");
    assert.equal(favouriteFromParsed(route, {}).speed, null);
  });
});

/* --- Recognising a route already kept ----------------------------- */

describe("duplicates", () => {
  test("the raw file and its stored favourite get the same key", () => {
    /* The regression this guards. Thinning shortens a track slightly, so a raw
       file measured raw and its favourite measured thinned could round to
       different lengths: the same route would never be recognised, and the
       Ride tab's Save button would offer to save it again forever. */
    for (const n of [900, 2500, 4000, 7777]){
      const raw = recording(n);
      const fav = favouriteFromParsed({name: "K", points: raw, recorded: true}, {});
      assert.equal(favouriteKey(raw), favouriteKey(fav.points), `${n}-point track`);
    }
  });

  test("adding the same file twice keeps one", () => {
    const parsed = {name: "Twice", points: recording(), recorded: true};
    assert.equal(addFavourite(favouriteFromParsed(parsed, {})).added, true);
    const again = addFavourite(favouriteFromParsed(parsed, {}));
    assert.equal(again.added, false);
    assert.equal(again.existing.name, "Twice");
    assert.equal(loadFavourites().length, 1);
  });

  test("a different route is not mistaken for it", () => {
    addFavourite(favouriteFromParsed({name: "A", points: recording(3000), recorded: true}, {}));
    const other = recording(3000).map(p => Object.assign({}, p, {lon: p.lon + 0.2}));
    assert.equal(addFavourite(favouriteFromParsed({name: "B", points: other, recorded: true}, {})).added, true);
    assert.equal(loadFavourites().length, 2);
  });
});

/* --- Editing ------------------------------------------------------ */

describe("maintaining the list", () => {
  const add = (name, extra) =>
    addFavourite(favouriteFromParsed({name, points: recording(1500 + name.length * 37),
      recorded: false}, extra || {})).fav;

  test("rename and change surface, keeping the track", () => {
    const f = add("Old name");
    const next = updateFavourite(f.id, {name: "New name", type: "gravel"});
    assert.equal(next.name, "New name");
    assert.equal(next.type, "gravel");
    assert.deepEqual(next.points, f.points, "the track is never editable through a patch");
  });

  test("a patch cannot replace the points", () => {
    const f = add("Fixed");
    const next = updateFavourite(f.id, {points: [[0, 0], [1, 1]]});
    assert.deepEqual(next.points, f.points);
  });

  test("clearing the speed hands it back to the Ride tab", () => {
    const f = add("Speedy", {speed: 28});
    assert.equal(updateFavourite(f.id, {speed: null}).speed, null);
    assert.equal(loadFavourites()[0].speedFrom, null);
  });

  test("delete removes exactly one", () => {
    const a = add("Keep"), b = add("Go");
    deleteFavourite(b.id);
    assert.deepEqual(loadFavourites().map(f => f.id), [a.id]);
  });

  test("most recently used comes first, then most recently added", () => {
    const list = [
      {id: "a", addedAt: "2026-01-01T00:00:00.000Z", lastRiddenAt: null},
      {id: "b", addedAt: "2026-03-01T00:00:00.000Z", lastRiddenAt: null},
      {id: "c", addedAt: "2026-02-01T00:00:00.000Z", lastRiddenAt: "2026-04-01T00:00:00.000Z"}
    ];
    assert.deepEqual(favouritesInOrder(list).map(f => f.id), ["c", "b", "a"]);
  });

  test("a full browser refuses loudly instead of losing the favourite", () => {
    add("First");
    quota = [...store.values()].reduce((n, v) => n + v.length, 0) + 10;   // no room for more
    assert.throws(() => add("Second"), /no room left/i);
    assert.equal(loadFavourites().length, 1, "and what was there is untouched");
  });
});
