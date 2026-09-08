"use strict";

/* ---------------------------------------------------------------
   The pure input-to-output logic: ride-feel, the GPX reader, and the
   two bearing helpers that have each been wrong once already.

   The browser files are plain scripts sharing a global scope rather than
   modules, so they are evaluated into this one the same way a page would.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

before(() => {
  // Order matters exactly as in index.html: helpers before the things using them.
  ["weather.js", "gpx.js", "gear.js", "model.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});

const W = over => Object.assign({
  tStart: 12, tMax: 14, tMin: 10, wind: 14, gust: 24, dir: 225, cloud: 40,
  precipTotal: 0, precipPeak: 0, prob: 5, dark: 0, hourly: []
}, over);
const O = over => Object.assign({speed: 27, terrain: "rolling", hours: 2, pace: "steady"}, over);

/* --- Ride feel ---------------------------------------------------- */

describe("rideFeel", () => {
  test("is monotonic in air temperature", () => {
    let prev = null;
    for (let t = 30; t >= -5; t -= 0.1){
      const f = rideFeel(W({tStart: t, tMax: t + 2, tMin: t - 2}), O()).feel;
      if (prev !== null) assert.ok(f <= prev, `feel rose from ${prev} to ${f} as air fell to ${t}`);
      prev = f;
    }
  });

  test("has no cliff: the self-wind term ramps rather than steps", () => {
    // It used to switch from -1 to -3 at exactly 15C, moving ride-feel two
    // degrees for a tenth of a degree of air.
    for (let t = 20; t >= 8; t -= 0.1){
      const a = selfWindTerm(t, 27), b = selfWindTerm(t - 0.1, 27);
      assert.ok(Math.abs(a - b) <= 0.5,
        `self-wind jumped ${Math.abs(a - b)} between air ${t} and ${t - 0.1}`);
    }
  });

  test("endpoints of the self-wind ramp are unchanged", () => {
    assert.equal(selfWindTerm(5, 27), -3, "well below the ramp");
    assert.equal(selfWindTerm(25, 27), -1, "well above the ramp");
  });

  test("riding faster chills you more, and speed is its only route in", () => {
    assert.ok(selfWindTerm(10, 35) < selfWindTerm(10, 20));
    // The calibration's speed correction depends on the air part cancelling.
    for (const air of [2, 8, 12, 15, 18, 25]){
      const viaDiff = selfWindTerm(air, 30) - selfWindTerm(air, 24);
      const feelDiff = rideFeel(W({tStart: air}), O({speed: 30})).feel
                     - rideFeel(W({tStart: air}), O({speed: 24})).feel;
      assert.ok(Math.abs(viaDiff - feelDiff) < 1e-9,
        `at ${air}C speed moved feel by ${feelDiff}, not the ${viaDiff} the correction assumes`);
    }
  });

  test("rain and darkness only ever make it colder", () => {
    const dry = rideFeel(W(), O()).feel;
    assert.ok(rideFeel(W({precipTotal: 3, precipPeak: 1.2, prob: 95}), O()).feel < dry);
    assert.ok(rideFeel(W({dark: 1}), O()).feel <= dry);
  });
});

/* --- Bearings ----------------------------------------------------- */

describe("bearing helpers", () => {
  test("angleGap is zero for identical bearings and 180 for opposite", () => {
    // This was once inverted, which fired the "wind veers" note on every ride.
    assert.equal(angleGap(90, 90), 0);
    assert.equal(angleGap(0, 0), 0);
    assert.equal(angleGap(0, 180), 180);
    assert.equal(angleGap(350, 10), 20, "must wrap across north");
    assert.equal(angleGap(10, 350), 20, "and wrap the other way");
  });

  test("headwind is worst into the wind and helps with it behind", () => {
    assert.ok(headwindComponent(30, 0, 0) > 0, "riding into it");
    assert.ok(headwindComponent(30, 0, 180) < 0, "with it behind");
    assert.ok(Math.abs(headwindComponent(30, 0, 90)) < 1e-9, "pure crosswind is neither");
  });
});

/* --- GPX ---------------------------------------------------------- */

/* parseGPX itself needs a DOM — it goes through DOMParser, which Node has no
   equivalent of — so it is exercised in the browser rather than here. What
   runs on its output is pure and is what these cover. Points are
   {lat, lon, ele, t}, with t in epoch milliseconds or null for a planned
   route. */
describe("route and activity statistics", () => {
  const T0 = Date.parse("2026-08-01T06:00:00Z");
  const points = (n, {timed = true, climbEvery = 1} = {}) =>
    Array.from({length: n}, (_, i) => ({
      lat: 52 + i * 0.001, lon: 5 + i * 0.001,
      ele: 10 + Math.floor(i / climbEvery) * 2,
      t: timed ? T0 + i * 30000 : null
    }));

  test("distance and climbing come out positive and ordered", () => {
    const s = routeStats(points(20));
    assert.ok(s.distance > 0, "distance");
    assert.ok(s.hasElevation, "elevation detected");
    assert.ok(s.ascent > 0, "ascent");
    assert.ok(s.maxEle > s.minEle, "range");
    assert.ok(routeStats(points(40)).distance > s.distance, "more points, further");
  });

  test("a track with no elevation says so rather than inventing one", () => {
    const flat = points(10).map(p => Object.assign({}, p, {ele: null}));
    const s = routeStats(flat);
    assert.equal(s.hasElevation, false);
    assert.equal(s.minEle, null);
    assert.equal(s.maxEle, null);
  });

  test("small elevation noise does not accumulate into a fictional mountain", () => {
    // A metre of jitter per point across thousands of points used to add up.
    const noisy = Array.from({length: 2000}, (_, i) => ({
      lat: 52 + i * 0.0001, lon: 5, ele: 10 + (i % 2 ? 0.4 : -0.4), t: T0 + i * 1000
    }));
    assert.ok(routeStats(noisy).ascent < 50,
      "sub-metre wobble must not read as climbing");
  });

  test("activityStats agrees with the timestamps it was given", () => {
    const s = activityStats(points(120));
    // Reported to three decimals, so compare at that resolution.
    assert.ok(Math.abs(s.elapsedH - (119 * 30) / 3600) < 0.001, "119 gaps of 30 s");
    assert.ok(Math.abs(s.speed - s.distance / s.elapsedH) < 0.1, "speed is distance over time");
    assert.equal(new Date(s.start).toISOString(), "2026-08-01T06:00:00.000Z");
    assert.equal(new Date(s.end).toISOString(), "2026-08-01T06:59:30.000Z");
  });

  test("an untimed route yields no activity statistics", () => {
    assert.ok(!activityStats(points(20, {timed: false})),
      "a planned route is not a recorded ride");
  });
});
