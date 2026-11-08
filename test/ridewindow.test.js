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

/* --- The end of the forecast ---------------------------------------
   Open-Meteo's 16-day forecast runs dry before its last day ends: measured on
   8 November 2026, precipitation_probability went null from 22 Nov 16:00 and
   every other field from 23 Nov 04:00. The app read that as -Infinity% rain
   and NaN °C felt, with a "colder than anything you own" alarm on top. */

describe("where the forecast runs out", () => {
  // Probability gone from 16:00, everything gone from 20:00.
  const tail = () => {
    const fc = forecast(hr => hr >= 12 && hr < 16 ? {precip: 0.6, prob: 70} : {});
    const h = fc.hourly;
    for (let hr = 16; hr < 24; hr++) h.precipitation_probability[hr] = null;
    for (let hr = 20; hr < 24; hr++)
      for (const k of Object.keys(h)) if (k !== "time" && k !== "precipitation_probability") h[k][hr] = null;
    h.precipitation[17] = 0.4;            // a wet hour while the probability is already gone
    return fc;
  };

  test("a ride past the last hour with data is refused, saying where the data stops", () => {
    assert.throws(() => rideWindow(tail(), DAY, "19:00", 2),
      e => /runs out/.test(e.message) && /19:00/.test(e.message));
    assert.throws(() => rideWindow(tail(), DAY, "21:00", 2), /runs out/);
  });

  test("a ride inside the data never reads as -Infinity or NaN", () => {
    const w = rideWindow(tail(), DAY, "16:00", 3);
    const f = rideFeel(w, opts);
    for (const [k, v] of Object.entries({prob: w.prob, tStart: w.tStart, wind: w.wind, cloud: w.cloud,
                                         feel: f.feel, extFeel: f.extFeel}))
      assert.ok(Number.isFinite(v), `${k} is ${v}`);
  });

  test("with the probability gone, an hour with rain in the forecast still counts as wet", () => {
    assert.equal(rideWindow(tail(), DAY, "17:00", 1).prob, 100);
    assert.equal(rideWindow(tail(), DAY, "18:00", 1).prob, 0);
  });

  test("the hours-ahead strip stops where the data does, with no blank hours", () => {
    const w = rideWindow(tail(), DAY, "17:00", 2);
    assert.ok(w.outlook.length > 0);
    assert.ok(w.outlook.every(h => Number.isFinite(h.t) && Number.isFinite(h.prob)),
      JSON.stringify(w.outlook.map(h => [h.time, h.t, h.prob])));
    assert.equal(w.outlook[w.outlook.length - 1].time, `${DAY}T19:00`);
  });

  test("the best-start scan skips starts it cannot read", () => {
    const scan = bestStarts(tail(), DAY, 2, opts, "17:00", EARLY);
    assert.equal(scan.starts[scan.starts.length - 1].time, "18:00");
    assert.ok(scan.starts.every(s => Number.isFinite(s.cost.total)));
  });
});

/* --- Open-Meteo saying no ----------------------------------------- */

describe("Open-Meteo's refusals, in words", () => {
  test("a 429 says it is the request limit, and quotes Open-Meteo's reason", () => {
    const m = openMeteoMessage(429, {error: true, reason: "Daily API request limit exceeded. Please try again tomorrow."},
                               "The weather archive");
    assert.match(m, /limit/i);
    assert.match(m, /Daily API request limit exceeded/);
    assert.doesNotMatch(m, /couldn't reach/i, "the archive was reached; it said no");
  });

  test("another refusal names the service, the status and the reason", () => {
    const m = openMeteoMessage(400, {error: true, reason: "Parameter 'start_date' is out of allowed range"}, "The forecast");
    assert.match(m, /^The forecast/);
    assert.match(m, /400/);
    assert.match(m, /out of allowed range/);
  });

  test("a body that is not Open-Meteo's JSON still gives a sentence", () => {
    assert.match(openMeteoMessage(502, null, "The forecast"), /The forecast.*502/);
    assert.match(openMeteoMessage(429, "<html>", "The forecast"), /limit/i);
  });

  test("a reason is cut short rather than pasted whole", () => {
    assert.ok(openMeteoMessage(500, {reason: "x".repeat(5000)}, "The forecast").length < 400);
  });
});

/* --- The quarter-hour memory --------------------------------------- */

describe("openMeteoJSON", () => {
  let calls;
  const ok = body => async url => { calls.push(url); return {ok: true, status: 200, json: async () => body}; };
  const refuse = async url => { calls.push(url); return {ok: false, status: 429, json: async () => ({reason: "limit"})}; };
  const U = n => `https://api.open-meteo.com/test/${n}`;

  test("a second reading within 15 minutes asks nothing", async () => {
    calls = [];
    await openMeteoJSON(U(1), "The forecast", ok({a: 1}), 0);
    const b = await openMeteoJSON(U(1), "The forecast", ok({a: 2}), 14 * 60 * 1000);
    assert.equal(calls.length, 1);
    assert.equal(b.a, 1);
  });

  test("after 15 minutes it asks again", async () => {
    calls = [];
    await openMeteoJSON(U(2), "The forecast", ok({a: 1}), 0);
    const b = await openMeteoJSON(U(2), "The forecast", ok({a: 2}), 15 * 60 * 1000);
    assert.equal(calls.length, 2);
    assert.equal(b.a, 2);
  });

  test("a refusal is not kept: the next reading asks again", async () => {
    calls = [];
    await assert.rejects(openMeteoJSON(U(3), "The forecast", refuse, 0), /limit/);
    const b = await openMeteoJSON(U(3), "The forecast", ok({a: 3}), 1000);
    assert.equal(calls.length, 2);
    assert.equal(b.a, 3);
  });

  test("two readings at once share one request", async () => {
    calls = [];
    let release;
    const slow = async url => { calls.push(url); await new Promise(r => { release = r; });
                                return {ok: true, status: 200, json: async () => ({a: 4})}; };
    const p1 = openMeteoJSON(U(4), "The forecast", slow, 0), p2 = openMeteoJSON(U(4), "The forecast", slow, 10);
    await new Promise(r => setImmediate(r)); release();
    assert.deepEqual([(await p1).a, (await p2).a], [4, 4]);
    assert.equal(calls.length, 1);
  });

  test("each caller gets its own copy", async () => {
    const a = await openMeteoJSON(U(5), "The forecast", ok({hourly: {x: [1]}}), 0);
    a.hourly.x.push(99);
    const b = await openMeteoJSON(U(5), "The forecast", ok({}), 1000);
    assert.deepEqual(b.hourly.x, [1]);
  });
});

describe("the last forecast, offline", () => {
  const store = new Map();
  before(() => { globalThis.localStorage = {getItem: k => store.has(k) ? store.get(k) : null,
                                            setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)}; });
  const ok = body => async () => ({ok: true, status: 200, json: async () => body});
  const down = async () => { throw new TypeError("Failed to fetch"); };
  const refuse = async () => ({ok: false, status: 429, json: async () => ({reason: "limit"})});
  const H = 3600 * 1000;

  test("with no connection, the forecast kept last night is used and says when it is from", async () => {
    await openMeteoJSON("https://api.open-meteo.com/k/1", "The forecast", ok({a: 1}), 0, {keep: true});
    const b = await openMeteoJSON("https://api.open-meteo.com/k/1", "The forecast", down, 10 * H, {keep: true});
    assert.equal(b.a, 1);
    assert.equal(b.offlineFrom, 0);
  });

  test("the stand-in is not remembered: the next reading tries the network again", async () => {
    await openMeteoJSON("https://api.open-meteo.com/k/2", "The forecast", ok({a: 1}), 0, {keep: true});
    await openMeteoJSON("https://api.open-meteo.com/k/2", "The forecast", down, 20 * H, {keep: true});
    const c = await openMeteoJSON("https://api.open-meteo.com/k/2", "The forecast", ok({a: 2}), 20 * H + 1000, {keep: true});
    assert.equal(c.a, 2);
    assert.equal(c.offlineFrom, undefined);
  });

  test("older than 36 hours is too old; a refusal is said, not papered over", async () => {
    await openMeteoJSON("https://api.open-meteo.com/k/3", "The forecast", ok({a: 1}), 0, {keep: true});
    await assert.rejects(openMeteoJSON("https://api.open-meteo.com/k/3", "The forecast", down, 37 * H, {keep: true}), /no connection/);
    await openMeteoJSON("https://api.open-meteo.com/k/4", "The forecast", ok({a: 1}), 0, {keep: true});
    await assert.rejects(openMeteoJSON("https://api.open-meteo.com/k/4", "The forecast", refuse, 20 * H, {keep: true}), /limit/);
  });

  test("only the last two places are kept, and only when asked", async () => {
    store.clear();
    for (const n of [5, 6, 7]) await openMeteoJSON(`https://api.open-meteo.com/k/${n}`, "The forecast", ok({n}), 0, {keep: true});
    await openMeteoJSON("https://api.open-meteo.com/k/8", "The ensemble", ok({n: 8}), 0);
    assert.deepEqual(JSON.parse(store.get("cwem-last-forecast")).map(x => x.data.n), [7, 6]);
  });
});
