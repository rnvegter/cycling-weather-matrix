"use strict";

/* ---------------------------------------------------------------
   Rating hands and feet apart from the core.

   One verdict for the whole body hid the commonest real outcome: core fine,
   fingers frozen. A ride can now carry a hands and a feet verdict beside the
   core one; each zone learns its own correction; the gloves and the shoes
   are picked on the corrected number; and a garment's range follows the
   verdict for its own zone rather than the body's.
----------------------------------------------------------------*/

const {test, describe, before, beforeEach} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

before(() => {
  ["weather.js", "gpx.js", "gear.js", "model.js", "history.js", "feedback.js", "calibrate.js"]
    .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});
beforeEach(() => store.clear());

let n = 0;
const ride = (extra) => normaliseRide(Object.assign({
  startISO: `2026-10-${String(1 + (n++ % 28)).padStart(2, "0")}T08:00`, place: "Utrecht",
  feel: 8, extFeel: 5, air: 9, kit: []
}, extra || {}));
const rated = (core, hands, feet) => ride({verdict: core, delta: verdictById(core).delta, ratedAt: "2026-10-30T10:00:00Z",
                                           zones: Object.assign({}, hands ? {hands} : {}, feet ? {feet} : {})});

describe("a ride's zone verdicts", () => {
  test("survive normalisation, and junk does not", () => {
    const r = ride({zones: {hands: "cold", feet: "nonsense", knees: "warm"}});
    assert.deepEqual(r.zones, {hands: "cold"});
    assert.deepEqual(ride({zones: "cold"}).zones, {});
  });

  test("rateZone sets the zone and moves ratedAt, so the newer copy wins a merge", () => {
    saveHistory([rated("right")]);
    const id = loadHistory()[0].id, before = loadHistory()[0].ratedAt;
    rateZone(id, "hands", "cold");
    const e = loadHistory()[0];
    assert.equal(e.zones.hands, "cold");
    assert.ok(e.ratedAt > before);
    assert.equal(e.verdict, "right", "the core verdict is untouched");
    rateZone(id, "hands", null);
    assert.deepEqual(loadHistory()[0].zones, {});
  });

  test("a zone's delta carries the speed correction, as the core's does", () => {
    const e = rated("right", "cold");
    assert.equal(zoneDelta(e, "hands"), -2);
    assert.equal(zoneDelta(e, "feet"), null);
    const fast = normaliseRide(Object.assign({}, e, {speed: 25, actual: {speed: 32}}));
    assert.equal(zoneDelta(fast, "hands"), effectiveDelta(Object.assign({}, fast, {delta: -2})));
  });
});

describe("learnedExtremities", () => {
  test("needs three answers per zone, then averages them, capped", () => {
    const h = [rated("right", "cold"), rated("right", "cold")];
    assert.equal(learnedExtremities(h).hands.ready, false);
    h.push(rated("right", "bit-cold"));
    const x = learnedExtremities(h);
    assert.equal(x.hands.ready, true);
    assert.ok(Math.abs(x.hands.value - (-5 / 3)) < 1e-9);
    assert.equal(x.feet.ready, false, "feet were never answered");
    const many = Array.from({length: 6}, () => rated("right", null, "warm"));
    assert.equal(learnedExtremities(many).feet.value, 2);
  });

  test("a core verdict alone teaches the hands nothing", () => {
    const h = [rated("cold"), rated("cold"), rated("cold"), rated("cold")];
    assert.equal(learnedExtremities(h).hands.ready, false);
  });
});

describe("the model with a learned hands correction", () => {
  const w = {tStart: 9, tEnd: 9, tMin: 9, tMax: 9, wind: 8, gust: 12, dir: 200, precipTotal: 0, precipPeak: 0,
             prob: 5, cloud: 60, dark: 0, wetHours: 0, hoursCount: 2, rh: 75, dew: 5};
  const opts = {dist: 50, hours: 2, speed: 25, pace: "steady", terrain: "flat", rider: "hot", type: "road"};
  const gloves = [
    {brand: "T", model: "Winter gloves", slot: "hands", tmin: -5, tmax: 4, clo: 0.2},
    {brand: "T", model: "Mid gloves", slot: "hands", tmin: 4, tmax: 10, clo: 0.1},
    {brand: "T", model: "Mitts", slot: "hands", tmin: 10, tmax: 40, clo: 0.02},
    {brand: "T", model: "Jersey", slot: "mid", tmin: -10, tmax: 40, clo: 0.1},
    {brand: "T", model: "Shorts", slot: "legs", tmin: -10, tmax: 40, clo: 0.1, short: true}
  ].map(normaliseItem);

  test("hands are read on the extremity number plus their own correction", () => {
    const f0 = rideFeel(w, opts);
    const f1 = rideFeel(w, Object.assign({}, opts, {learnedExt: {hands: -3, feet: 0}}));
    assert.equal(f1.extFeel, f0.extFeel, "the shared extremity number does not move");
    assert.equal(f1.handsFeel, f0.extFeel - 3);
    assert.equal(f1.feetFeel, f0.extFeel);
  });

  test("colder hands pick warmer gloves; the core kit does not change", () => {
    const f0 = rideFeel(w, opts), f1 = rideFeel(w, Object.assign({}, opts, {learnedExt: {hands: -4, feet: 0}}));
    const pick = f => pickOutfit(f, w, opts, gloves).wear.find(i => i.slot === "hands").model;
    const g0 = pick(f0), g1 = pick(f1);
    assert.notEqual(g0, g1, `${f0.handsFeel}° picks ${g0}, ${f1.handsFeel}° should pick something warmer`);
    assert.ok(gloves.find(i => i.model === g1).clo > gloves.find(i => i.model === g0).clo);
  });

  test("ride-feel stays monotonic in air with a hands correction in play", () => {
    const o = Object.assign({}, opts, {learnedExt: {hands: 2, feet: -2}});
    let prev = -Infinity;
    for (let t = -5; t <= 30; t += 0.5){
      const f = rideFeel(Object.assign({}, w, {tStart: t, tEnd: t, tMin: t, tMax: t}), o);
      assert.ok(f.handsFeel >= prev, `hands feel fell at ${t}°`);
      prev = f.handsFeel;
    }
  });
});

describe("garment ranges with zone verdicts", () => {
  const gloves = normaliseItem({brand: "T", model: "Gloves", slot: "hands", tmin: 0, tmax: 10, clo: 0.1});
  const K = ["T Gloves"];
  test("gloves rated cold by the hands are judged on that, not on the core verdict", () => {
    // Core about right, hands too cold, planned at 1° on the hands: the glove's cold end moves up.
    const h = [rated("right", "cold"), rated("right", "cold"), rated("right", "bit-cold")]
      .map(r => Object.assign(r, {kit: K, extFeel: 1, handsFeel: 1}));
    const s = gearSuggestions([gloves], h);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].edge, s[0].to], ["tmin", 2]);
  });
  test("without a hands verdict the core verdict still counts for the gloves, as before", () => {
    const h = [rated("cold"), rated("cold"), rated("cold")].map(r => Object.assign(r, {kit: K, extFeel: 1}));
    assert.equal(gearSuggestions([gloves], h).length, 1);
  });
  test("a hands verdict of fine protects the gloves from a cold core verdict", () => {
    const h = [rated("cold", "right"), rated("cold", "right"), rated("cold", "right")]
      .map(r => Object.assign(r, {kit: K, extFeel: 1}));
    assert.equal(gearSuggestions([gloves], h).length, 0);
  });
});
