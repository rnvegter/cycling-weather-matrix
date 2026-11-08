"use strict";

/* ---------------------------------------------------------------
   Garment ranges following the evidence.

   The rule under test: a garment's edge moves only on rated rides planned
   near that edge, only when enough of them point the same way, only by a
   step, and never by itself. The histories are built by hand so each test
   turns one knob.
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

const jacket = {brand: "Test", model: "Jacket", slot: "shell", tmin: 4, tmax: 12, clo: 0.3};
const gloves = {brand: "Test", model: "Gloves", slot: "hands", tmin: 0, tmax: 10, clo: 0.1};
const gear = () => [jacket, gloves].map(normaliseItem);

let n = 0;
/* A rated ride planned at `feel` wearing `kit`, with a verdict id. */
const ride = (feel, verdict, kit, extra) => normaliseRide(Object.assign({
  startISO: `2026-10-${String(1 + (n++ % 28)).padStart(2, "0")}T08:00`, place: "Utrecht",
  feel, extFeel: feel - 3, air: feel + 2, kit, verdict
}, extra || {}));
const J = ["Test Jacket"], G = ["Test Gloves"];

describe("gearSuggestions", () => {
  test("too warm three times near the top moves the warm end down, past the coldest of them", () => {
    const h = [ride(11, "warm", J), ride(10, "bit-warm", J), ride(12, "warm", J)];
    const s = gearSuggestions(gear(), h);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].name, s[0].edge, s[0].from, s[0].to, s[0].rides], ["Test Jacket", "tmax", 12, 9, 3]);
  });

  test("too cold three times near the bottom moves the cold end up", () => {
    const h = [ride(4, "cold", J), ride(5, "bit-cold", J), ride(6, "cold", J)];
    const s = gearSuggestions(gear(), h);
    assert.deepEqual([s[0].edge, s[0].from, s[0].to], ["tmin", 4, 7]);
  });

  test("the same verdicts in the middle of the range say nothing about the garment", () => {
    const h = [ride(8, "warm", J), ride(7, "warm", J), ride(8, "warm", J)];
    assert.equal(gearSuggestions(gear(), h).length, 0);
  });

  test("two rides are not enough; a third is", () => {
    const h = [ride(11, "warm", J), ride(11, "warm", J)];
    assert.equal(gearSuggestions(gear(), h).length, 0);
    h.push(ride(11, "warm", J));
    assert.equal(gearSuggestions(gear(), h).length, 1);
  });

  test("rides that disagree hold it back", () => {
    const h = [ride(11, "warm", J), ride(11, "warm", J), ride(11, "warm", J),
               ride(11, "right", J), ride(12, "right", J)];
    assert.equal(gearSuggestions(gear(), h).length, 0, "3 for, 2 against is not a case");
    h.push(ride(10, "bit-warm", J));
    assert.equal(gearSuggestions(gear(), h).length, 1, "4 for, 2 against is");
    assert.equal(gearSuggestions(gear(), h)[0].against, 2);
  });

  test("a range moves at most three degrees at a time, and never closes up", () => {
    const h = [ride(12, "warm", J), ride(10, "warm", J), ride(9, "warm", J)];
    assert.equal(gearSuggestions(gear(), h)[0].to, 9, "9 - 1 = 8 is capped at 12 - 3");
    const narrow = [normaliseItem(Object.assign({}, jacket, {tmin: 8, tmax: 10}))];
    const h2 = [ride(10, "warm", J), ride(9, "warm", J), ride(8, "warm", J)];
    assert.equal(gearSuggestions(narrow, h2).length, 0, "10 → 7 would cross tmin + 2, and 10 is where it stops");
  });

  test("rides the garment was not worn on do not count", () => {
    const h = [ride(11, "warm", ["Other thing"]), ride(11, "warm", J), ride(11, "warm", J)];
    assert.equal(gearSuggestions(gear(), h).length, 0);
  });

  test("hands are judged on the extremity number", () => {
    // extFeel is feel - 3 here: planned at 13 core is 10 on the hands, the gloves' top.
    const h = [ride(13, "warm", G), ride(12, "warm", G), ride(13, "bit-warm", G)];
    const s = gearSuggestions(gear(), h);
    assert.equal(s.length, 1);
    assert.deepEqual([s[0].name, s[0].edge, s[0].to], ["Test Gloves", "tmax", 8]);
  });

  test("the speed correction is applied before a ride counts", () => {
    // Verdict "a bit warm" (+1), but the rider rode 32 instead of the assumed 25 km/h at 11°
    // air... the self-wind term grows with speed, so the model would have read colder and the
    // effective delta is above +1 still? Check the direction with the app's own function.
    const fast = ride(11, "bit-warm", J, {speed: 25, actual: {speed: 32}});
    const eff = effectiveDelta(fast);
    const h = [fast, ride(11, "bit-warm", J), ride(11, "bit-warm", J)];
    assert.equal(gearSuggestions(gear(), h).length, eff >= 1 ? 1 : 0,
      `effective delta ${eff} decides whether the fast ride counts`);
  });

  test("applying the suggestion makes it go away", () => {
    const h = [ride(11, "warm", J), ride(10, "bit-warm", J), ride(12, "warm", J)];
    const g = gear();
    const s = gearSuggestions(g, h)[0];
    g[s.index][s.edge] = s.to;
    assert.equal(gearSuggestions(g, h).length, 0);
  });

  test("a dismissed suggestion stays away until the evidence changes", () => {
    const h = [ride(12, "warm", J), ride(12, "bit-warm", J), ride(12, "warm", J)];
    const s = gearSuggestions(gear(), h)[0];
    assert.equal(s.to, 11);
    dismissSuggestion(s.key);
    assert.equal(gearSuggestions(gear(), h, dismissedSuggestions()).length, 0);
    h.push(ride(10, "warm", J));           // a colder ride moves the proposal to 9°, so it is new
    const again = gearSuggestions(gear(), h, dismissedSuggestions());
    assert.equal(again.length, 1);
    assert.equal(again[0].to, 9);
  });

  test("the sentence says what happened and what would change", () => {
    const h = [ride(11, "warm", J), ride(10, "bit-warm", J), ride(12, "warm", J), ride(11, "right", J)];
    const t = suggestionText(gearSuggestions(gear(), h)[0]);
    assert.match(t, /3 rated rides were too warm near the top of its range \(12°\), 1 said otherwise/);
    assert.match(t, /down to 9°\?/);
  });
});
