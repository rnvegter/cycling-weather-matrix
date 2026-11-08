"use strict";

/* ---------------------------------------------------------------
   The ride window and the best start across the day.

   rideWindow moved out of app.js so it could be tested here; bestStarts runs
   it, with the real rideFeel, for every start in the day. The forecasts are
   built by hand so each test changes one thing: a wet morning, a cold
   morning, a dark evening, a windy noon.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

before(() => {
  ["weather.js", "gpx.js", "gear.js", "model.js", "fuel.js", "ridewindow.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});

const DAY = "2026-11-09";
const pad = n => String(n).padStart(2, "0");

/* One day of hourly forecast. `at(hour)` returns overrides for that hour. */
function forecast(at = () => ({})){
  const h = {time: [], temperature_2m: [], precipitation_probability: [], precipitation: [],
    cloud_cover: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], is_day: [],
    weather_code: [], freezing_level_height: [], relative_humidity_2m: [], dew_point_2m: []};
  for (let hr = 0; hr < 24; hr++){
    const o = Object.assign({t: 10, prob: 5, precip: 0, wind: 10, gust: 20}, at(hr));
    h.time.push(`${DAY}T${pad(hr)}:00`);
    h.temperature_2m.push(o.t);
    h.precipitation_probability.push(o.prob);
    h.precipitation.push(o.precip);
    h.cloud_cover.push(o.precip ? 100 : 60);
    h.wind_speed_10m.push(o.wind);
    h.wind_direction_10m.push(240);
    h.wind_gusts_10m.push(o.gust);
    h.is_day.push(hr >= 8 && hr < 17 ? 1 : 0);
    h.weather_code.push(o.precip ? 61 : 3);
    h.freezing_level_height.push(1500);
    h.relative_humidity_2m.push(80);
    h.dew_point_2m.push(o.t - 3);
  }
  return {hourly: h, daily: {time: [DAY], sunrise: [`${DAY}T07:45`], sunset: [`${DAY}T16:55`]}};
}

const opts = {dist: 50, hours: 2, speed: 25, pace: "steady", terrain: "flat", rider: "normal", type: "road"};
const EARLY = new Date(`${DAY}T00:00`).getTime() - 86400000;   // "now" the day before

describe("rideWindow, moved", () => {
  test("still reads the hours you ride", () => {
    const w = rideWindow(forecast(hr => ({t: hr})), DAY, "09:00", 3);
    assert.equal(w.tStart, 9);
    assert.equal(w.tEnd, 11);
    assert.equal(w.hoursCount, 3);
  });
});

describe("bestStarts", () => {
  test("moves a ride out of a wet morning, and says why", () => {
    const fc = forecast(hr => hr >= 8 && hr <= 11 ? {precip: 1.5, prob: 90} : {});
    const scan = bestStarts(fc, DAY, 2, opts, "08:00", EARLY);
    assert.ok(scan.better, "a dry start exists, so it should be offered");
    assert.ok(scan.best.w.precipTotal < 0.1, `best start ${scan.best.time} should be dry`);
    assert.ok(startGains(scan.best, scan.chosen).includes("dry instead of wet"));
  });

  test("leaves a start alone that is already as good as the day gets", () => {
    const scan = bestStarts(forecast(), DAY, 2, opts, "10:00", EARLY);
    assert.equal(scan.better, false);
  });

  test("in a cold, dry day, prefers the warm middle and the daylight", () => {
    const fc = forecast(hr => ({t: 2 + 8 * Math.max(0, Math.sin((hr - 6) / 12 * Math.PI))}));
    const scan = bestStarts(fc, DAY, 2, opts, "06:00", EARLY);
    assert.ok(scan.better);
    const h = +scan.best.time.slice(0, 2);
    assert.ok(h >= 10 && h <= 13, `best start ${scan.best.time} should be around midday`);
    assert.ok(scan.best.f.feel > scan.chosen.f.feel);
  });

  test("a windy hour counts against a start, by how windy", () => {
    const fc = forecast(hr => hr >= 9 && hr <= 12 ? {wind: 38, gust: 65} : {});
    const scan = bestStarts(fc, DAY, 2, opts, "10:00", EARLY);
    assert.ok(scan.better);
    assert.ok(scan.best.w.wind < 20);
  });

  test("starts already gone today are not offered", () => {
    const now = new Date(`${DAY}T12:30`).getTime();
    const scan = bestStarts(forecast(), DAY, 2, opts, "14:00", now);
    assert.ok(scan.starts.every(s => s.time >= "13:00"), scan.starts.map(s => s.time).join(","));
  });

  test("every start is home by 22:00, and a ride too long to move gives no scan", () => {
    const scan = bestStarts(forecast(), DAY, 3, opts, "09:00", EARLY);
    assert.equal(scan.starts[scan.starts.length - 1].time, "19:00");
    assert.equal(scan.starts[0].time, "05:00");
    assert.equal(bestStarts(forecast(), DAY, 17, opts, "05:00", EARLY), null);
  });

  test("the cost ramps rather than steps", () => {
    const base = rideWindow(forecast(), DAY, "10:00", 2);
    const f = rideFeel(base, opts);
    const cost = (patch, fp) => startCost(Object.assign({}, base, patch), Object.assign({}, f, fp)).total;
    // Each pair is two neighbouring inputs; their costs must be neighbours too.
    const pairs = [
      [{precipTotal: 0.29}, {precipTotal: 0.31}, {}, {}],
      [{}, {}, {feel: 11.9}, {feel: 12.1}],
      [{wind: 14.9}, {wind: 15.1}, {}, {}],
      [{dark: 0.49}, {dark: 0.51}, {}, {}],
      [{prob: 79}, {prob: 81}, {}, {}]
    ];
    for (const [wa, wb, fa, fb] of pairs){
      const d = Math.abs(cost(wa, fa) - cost(wb, fb));
      assert.ok(d < 0.1, `${JSON.stringify([wa, wb, fa, fb])} moved the cost by ${d}`);
    }
  });
});
