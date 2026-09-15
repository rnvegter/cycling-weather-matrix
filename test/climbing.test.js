"use strict";

/* ---------------------------------------------------------------
   Climbing and descending, measured against roads whose real climb is known.

   The old count added up every step between consecutive points that rose by
   more than a metre. That fails in both directions on a real recording:
   a device logging every second on a steady climb moves a fraction of a metre
   per point, so a clean track reads 0 m; and GPS elevation noise swings by
   more than a metre between points, so a noisy one reads double or more.
   Each road below is ridden by the kinds of track the app actually receives,
   and the count has to land near the truth for all of them.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

before(() => {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "gpx.js"), "utf8"),
    {filename: "gpx.js"});
});

/* --- Roads: elevation as a function of distance in metres ---------- */

const ROADS = {
  // 3 km at 5%, then back down: 150 m each way.
  "a steady col": {length: 6000, h: x => x < 3000 ? 100 + 0.05 * x : 250 - 0.05 * (x - 3000)},
  // 10 km at 8%: a real mountain.
  "a mountain climb": {length: 10000, h: x => 400 + 0.08 * x},
  // 1% for 10 km — the climb a strict per-point threshold never sees at all.
  "a long gentle drag": {length: 10000, h: x => 5 + 0.01 * x},
  // Eight hills, 20 m each, over 16 km.
  "rolling country": {length: 16000, h: x => 30 + 10 * Math.sin(x / 2000 * 2 * Math.PI - Math.PI / 2)},
  // Dutch: dead flat but for six 8 m bridges with 150 m ramps.
  "polder with bridges": {length: 18000, h: x => {
    const k = x % 3000, peak = 1500;
    return 2 + Math.max(0, 8 - Math.abs(k - peak) / 150 * 8);
  }},
  "a flat road": {length: 20000, h: () => 3}
};

/* The truth is what the track itself can express: the road sampled wherever
   this device samples it, without noise or rounding. For a recording every
   few metres that is the road. For a planned route with a point every 400 m
   that falls either side of a summit, the summit is genuinely not in the file
   and no calculation can put it back — judging it against the road would be
   marking the file, not the count. Uses ride(), below. */
function trackTruth(road, dev){
  const clean = ride(road, Object.assign({}, dev, {noise: 0, quantum: 0}));
  let up = 0, down = 0;
  for (let i = 1; i < clean.length; i++){
    const d = clean[i].ele - clean[i - 1].ele;
    if (d > 0) up += d; else down -= d;
  }
  return {up, down};
}

/* --- Devices: how a track records that road ------------------------- */

// Seeded, so a failure reproduces exactly.
function rng(seed){
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}
function gaussian(r){
  const u = Math.max(1e-12, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DEVICES = {
  // Barometric altimeter, one point a second at 20 km/h, 0.2 m resolution.
  "barometric, every second": {spacing: 5.56, noise: 0.05, quantum: 0.2},
  // Whole-metre elevation, as many exports give it.
  "whole metres, every second": {spacing: 5.56, noise: 0, quantum: 1},
  // Phone GPS: no barometer, elevation noise of a metre and a half.
  "GPS, ±1.5 m noise": {spacing: 5.56, noise: 1.5, quantum: 0},
  // Poor GPS reception.
  "GPS, ±3 m noise": {spacing: 5.56, noise: 3, quantum: 0},
  // A route planner's export: sparse points, elevation from a terrain model.
  "planned route, every 100 m": {spacing: 100, noise: 0, quantum: 0.1},
  "planned route, every 400 m": {spacing: 400, noise: 0, quantum: 0.1}
};

function ride(road, dev, seed = 11){
  const r = rng(seed), pts = [];
  for (let x = 0; x <= road.length; x += dev.spacing){
    let e = road.h(x) + (dev.noise ? gaussian(r) * dev.noise : 0);
    if (dev.quantum) e = Math.round(e / dev.quantum) * dev.quantum;
    pts.push({lat: 52 + x / 111320, lon: 5, ele: e, t: null});
  }
  // Always finish exactly at the end of the road.
  const last = road.h(road.length);
  if (pts.length && Math.abs((pts.length - 1) * dev.spacing - road.length) > 1e-6)
    pts.push({lat: 52 + road.length / 111320, lon: 5, ele: last, t: null});
  return pts;
}

/* How close is close enough. Clean data should be nearly exact. Noise costs
   some accuracy, and bridges are small enough that the smoothing needed to
   beat noise takes a visible bite out of them. */
function tolerance(roadName, dev, trueUp){
  if (roadName === "a flat road") return dev.noise >= 3 ? 30 : dev.noise ? 15 : 3;
  const frac = dev.noise >= 3 ? 0.20 : dev.noise ? 0.12 : 0.06;
  const floor = roadName === "polder with bridges" ? 0.25 * trueUp : 5;
  return Math.max(floor, frac * trueUp);
}

/* --- The matrix ----------------------------------------------------- */

describe("climbing, measured against the real road", () => {
  for (const [roadName, road] of Object.entries(ROADS)){
    for (const [devName, dev] of Object.entries(DEVICES)){
      test(`${roadName}, ${devName}`, () => {
        const want = trackTruth(road, dev);
        const got = routeStats(ride(road, dev));

        /* The one case with a deliberate trade-off. Eight-metre bridges
           inside ±3 m of elevation noise cannot be both seen in full and told
           apart from noise; the smoothing that stops a flat road growing 90 m
           of invented climbing also takes the tops off them. It reads them
           short — 26 to 34 m of the true 48 across ten noise draws — and the
           claim held here is the one that matters: it never reads MORE than
           the road climbed, and it still sees them. */
        if (roadName === "polder with bridges" && dev.noise >= 3){
          for (const [what, v, t] of [["climbed", got.ascent, want.up], ["descended", got.descent, want.down]]){
            assert.ok(v <= t + 5, `${what} ${v.toFixed(0)} m, more than the true ${t.toFixed(0)} m`);
            assert.ok(v >= 0.45 * t, `${what} ${v.toFixed(0)} m of ${t.toFixed(0)} — the bridges have gone`);
          }
          return;
        }

        const tol = tolerance(roadName, dev, want.up);
        assert.ok(Math.abs(got.ascent - want.up) <= tol,
          `climbed ${got.ascent.toFixed(0)} m, truly ${want.up.toFixed(0)} m (±${tol.toFixed(0)})`);
        assert.ok(Math.abs(got.descent - want.down) <= tolerance(roadName, dev, want.down),
          `descended ${got.descent.toFixed(0)} m, truly ${want.down.toFixed(0)} m`);
      });
    }
  }
});

describe("the same road, however it arrives", () => {
  test("a favourite's thinned track agrees with the recording it came from", () => {
    for (const roadName of ["a steady col", "rolling country", "a mountain climb"]){
      for (const devName of ["barometric, every second", "GPS, ±1.5 m noise"]){
        const raw = ride(ROADS[roadName], DEVICES[devName]);
        const a = routeStats(raw).ascent, b = routeStats(simplifyTrack(raw)).ascent;
        assert.ok(Math.abs(a - b) <= Math.max(10, 0.10 * a),
          `${roadName}, ${devName}: recording ${a.toFixed(0)} m, favourite ${b.toFixed(0)} m`);
      }
    }
  });

  test("noise does not depend on luck: five different noise draws all land close", () => {
    const road = ROADS["a steady col"], dev = DEVICES["GPS, ±1.5 m noise"];
    for (const seed of [3, 17, 101, 4242, 99991]){
      const got = routeStats(ride(road, dev, seed)).ascent;
      assert.ok(Math.abs(got - 150) <= 18, `seed ${seed}: ${got.toFixed(0)} m`);
    }
  });
});

describe("what else routeStats reports is unchanged", () => {
  test("distance, the highest and lowest points, and loop detection", () => {
    const pts = ride(ROADS["a steady col"], DEVICES["barometric, every second"]);
    const s = routeStats(pts);
    assert.ok(Math.abs(s.distance - 6) < 0.01, `distance ${s.distance}`);
    assert.equal(s.maxEle, Math.max(...pts.map(p => p.ele)), "highest point is the raw highest");
    assert.equal(s.minEle, Math.min(...pts.map(p => p.ele)));
    assert.equal(s.cum.length, pts.length, "one cumulative distance per point");
    assert.equal(s.loop, false);
  });

  test("a track with no elevation climbs nothing and says so", () => {
    const pts = ride(ROADS["a steady col"], DEVICES["barometric, every second"])
      .map(p => Object.assign({}, p, {ele: null}));
    const s = routeStats(pts);
    assert.equal(s.hasElevation, false);
    assert.equal(s.ascent, 0);
    assert.equal(s.descent, 0);
  });

  test("elevation on only some points still counts what is there", () => {
    const pts = ride(ROADS["a steady col"], DEVICES["planned route, every 100 m"])
      .map((p, i) => i % 3 ? Object.assign({}, p, {ele: null}) : p);
    const s = routeStats(pts);
    assert.ok(Math.abs(s.ascent - 150) <= 10, `${s.ascent.toFixed(0)} m`);
  });

  test("two points, or a single elevation, do not break it", () => {
    const two = [{lat: 52, lon: 5, ele: 10}, {lat: 52.01, lon: 5, ele: 30}];
    assert.ok(Math.abs(routeStats(two).ascent - 20) < 0.5);
    const one = [{lat: 52, lon: 5, ele: 10}, {lat: 52.01, lon: 5, ele: null}];
    assert.equal(routeStats(one).ascent, 0);
  });
});
