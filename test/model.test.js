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

/* --- Humidity ----------------------------------------------------- */

describe("humidity", () => {
  // Percentages only, so a fixture stays true at whatever air temperature the
  // test puts it at. Dew-point feeds get their own test below.
  const MUGGY = {rh: 88};
  const DRY   = {rh: 22};
  const at = (t, over) => W(Object.assign({tStart: t, tMax: t, tMin: t}, over));

  test("a feed with no humidity in it changes nothing at all", () => {
    // The whole of the rest of this suite depends on it: absent means silent.
    for (const t of [-2, 6, 14, 22, 30]){
      const bare = rideFeel(at(t), O());
      assert.equal(bare.humid, 0, `air ${t} invented a humidity term`);
      assert.ok(!bare.rows.some(r => /humidity/i.test(r.label)), "no row either");
      assert.equal(bare.evap, 0);
    }
  });

  test("muggy air rides warmer than dry air at the same temperature", () => {
    const muggy = rideFeel(at(24, MUGGY), O());
    const dry   = rideFeel(at(24, DRY), O());
    assert.ok(muggy.humid > 0, "muggy adds warmth");
    assert.ok(dry.humid < 0, "dry takes some away");
    assert.ok(muggy.feel > dry.feel, `${muggy.feel} should beat ${dry.feel}`);
  });

  test("hot desert air is dry, not muggy", () => {
    // Las Vegas at 37°C and 23% carries more water than a pleasant Dutch
    // morning, and evaporates sweat faster than anywhere else in this model.
    // Charging it a muggy penalty on absolute vapour pressure alone is the
    // exact bug this gate exists to prevent.
    const vegas = rideFeel(at(37.3, {rh: 23}), O());
    assert.ok(vegas.humid < 0, `desert air read as ${vegas.humid}`);
    assert.match(vegas.rows.find(r => /humidity/i.test(r.label)).label, /dry air/i);
    assert.equal(vegas.evap, 0, "and nothing downstream may think you can't sweat");
  });

  test("cold air is left alone, however wet it is", () => {
    // Cold damp air does feel worse, but through wet clothing rather than
    // blocked evaporation — and the rain term already owns that.
    const wet = rideFeel(at(4, {rh: 97}), O());
    const dry = rideFeel(at(4, {rh: 40}), O());
    assert.equal(wet.humid, 0);
    assert.equal(wet.feel, dry.feel);
  });

  test("size comes from the water in the air, not from the percentage", () => {
    // 95% at 18°C is less water than 60% at 30°C. Ranking on the percentage
    // would put them the wrong way round.
    const warmer = rideFeel(at(30, {rh: 60}), O());
    const damper = rideFeel(at(18, {rh: 95}), O());
    assert.ok(warmer.humid > damper.humid,
      `${warmer.humid} at 30°C/60% should beat ${damper.humid} at 18°C/95%`);
  });

  test("a dew point and a percentage describing the same air agree", () => {
    const es = t => 6.112 * Math.exp(17.62 * t / (243.12 + t));
    for (const [t, rh] of [[24, 88], [32.5, 65], [20, 50], [37.3, 23]]){
      const e = es(t) * rh / 100;
      const dew = 243.12 * Math.log(e / 6.112) / (17.62 - Math.log(e / 6.112));
      assert.equal(rideFeel(at(t, {rh}), O()).humid,
                   rideFeel(at(t, {dew}), O()).humid,
                   `${t}°C at ${rh}% disagreed with its own dew point`);
    }
  });

  test("has no cliff, in the temperature or in the percentage", () => {
    // A tenth of a degree of air must not move the term by more than the
    // half degree that would show a threshold through.
    for (const rh of [20, 40, 55, 70, 85, 95]){
      for (let t = 36; t >= 6; t -= 0.1){
        const a = rideFeel(at(t, {rh}), O()).humid, b = rideFeel(at(t - 0.1, {rh}), O()).humid;
        assert.ok(Math.abs(a - b) <= 0.5, `jumped ${Math.abs(a - b)} at ${r1(t)}°C, ${rh}%`);
      }
    }
    for (const t of [12, 16, 20, 24, 28, 32, 36]){
      for (let rh = 100; rh >= 5; rh -= 0.5){
        const a = rideFeel(at(t, {rh}), O()).humid, b = rideFeel(at(t, {rh: rh - 0.5}), O()).humid;
        assert.ok(Math.abs(a - b) <= 0.5, `jumped ${Math.abs(a - b)} at ${t}°C, ${r1(rh)}%`);
      }
    }
  });

  test("stays inside its caps however extreme the air", () => {
    assert.ok(rideFeel(at(34, {rh: 99}), O()).humid <= 3, "past the warm cap");
    assert.ok(rideFeel(at(34, {rh: 5}), O()).humid >= -2, "past the cool cap");
  });

  test("ride-feel is still monotonic in air temperature, wet or dry", () => {
    for (const air of [MUGGY, DRY]){
      let prev = null;
      for (let t = 30; t >= -5; t -= 0.1){
        const f = rideFeel(W(Object.assign({tStart: t, tMax: t + 2, tMin: t - 2}, air)), O()).feel;
        if (prev !== null) assert.ok(f <= prev, `feel rose from ${prev} to ${f} at air ${r1(t)}`);
        prev = f;
      }
    }
  });

  test("the dry-heat requirement is not touched by humidity", () => {
    // Insulation holds heat in; humidity governs getting heat out. Mixing them
    // would have muggy air asking for a thicker jacket.
    assert.equal(rideFeel(at(20, MUGGY), O()).envTemp, rideFeel(at(20, DRY), O()).envTemp);
  });
});

describe("the heat balance under blocked evaporation", () => {
  // A base layer under a jersey on a warm day: in surplus, but only mildly, so
  // the ratio lands between the two tolerances and the change of verdict is
  // the tolerance moving rather than the fixture being extreme.
  const outfit = [
    {slot: "base", clo: 0.3, wind: 0.1},
    {slot: "mid",  clo: 0.5, wind: 0.3}
  ];
  const f = evap => ({envTemp: 21, air: 21, evap});
  const w = W({tStart: 21, wind: 10});
  // Slow enough that the work rate does not make the requirement vanish.
  const o = O({speed: 15});

  test("a surplus layer that is harmless in dry air is flagged in muggy air", () => {
    const dry = heatBalance(f(0), w, o, outfit);
    const wet = heatBalance(f(1), w, o, outfit);
    assert.equal(dry.ratio, wet.ratio, "the same clo either way — only the tolerance moves");
    assert.ok(wet.overTol < dry.overTol, "the warm-side tolerance must close");
    assert.ok(dry.ratio > wet.overTol && dry.ratio < dry.overTol,
      "this fixture has to sit between the two, or it proves nothing");
    assert.equal(dry.verdict, "about right");
    assert.equal(wet.verdict, "warm for the conditions");
    assert.match(wet.detail, /sweat/i, "and say why");
  });

  test("the cold side is untouched — needing insulation is a dry question", () => {
    const cold = t => heatBalance({envTemp: 2, air: 2, evap: t}, W({tStart: 2}), O(), [outfit[0]]);
    assert.equal(cold(0).verdict, cold(1).verdict);
    assert.equal(cold(0).verdict, "light for the conditions");
  });
});

describe("wetThroughLegs", () => {
  // Legs as analyseRoute leaves them: the flags and the ride-feel, which is
  // all this reads.
  const leg = (over) => Object.assign({
    fromKm: 0, hours: 0.4, climbing: false, descending: false,
    f: {feel: 20, evap: 0.6, rh: 88}
  }, over);
  const climb = over => leg(Object.assign({climbing: true}, over));
  const descent = over => leg(Object.assign({descending: true, f: {feel: 12, evap: 0.6, rh: 88}}, over));

  test("a wet climb followed by a cold descent is worth saying", () => {
    const hit = wetThroughLegs([climb({fromKm: 4}), descent({fromKm: 9})]);
    assert.ok(hit, "should fire");
    assert.equal(hit.climb.fromKm, 4);
    assert.equal(hit.descent.fromKm, 9);
    assert.equal(hit.drop, 8);
  });

  test("a climb in air that will take the sweat is not the same problem", () => {
    assert.equal(wetThroughLegs([
      climb({f: {feel: 20, evap: 0.05, rh: 35}}), descent({})
    ]), null);
  });

  test("a climb with nothing but flat road after it dries out", () => {
    assert.equal(wetThroughLegs([climb({}), leg({fromKm: 9})]), null);
  });

  test("a descent before the climb is not caused by it", () => {
    assert.equal(wetThroughLegs([descent({fromKm: 0}), climb({fromKm: 5})]), null);
  });

  test("a short ramp is not a climb you sweat through", () => {
    assert.equal(wetThroughLegs([climb({hours: 0.05}), descent({})]), null);
  });

  test("the worst pair wins when a route has several", () => {
    const hit = wetThroughLegs([
      climb({fromKm: 0}), descent({fromKm: 3, f: {feel: 14, evap: 0.6, rh: 88}}),
      climb({fromKm: 10}), descent({fromKm: 14, f: {feel: 8, evap: 0.6, rh: 88}})
    ]);
    assert.equal(hit.climb.fromKm, 10, "the 12-degree pair, not the 6-degree one");
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
