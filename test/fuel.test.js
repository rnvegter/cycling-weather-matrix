"use strict";

/* ---------------------------------------------------------------
   Fuel and drink. Ranges from general sports nutrition, so the tests guard
   shape rather than exact grams: nothing jumps, more heat means more to drink,
   longer and harder means more to eat, and the planner's handover is read
   strictly.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

before(() => {
  ["weather.js", "gpx.js", "gear.js", "model.js", "fuel.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});

const W = over => Object.assign({tStart: 12, tMax: 14, tMin: 10}, over);
const plan = (w, opts, f) => fuelPlan(W(w), f || {evap: 0}, Object.assign({hours: 2, pace: "steady"}, opts));

describe("fuelPlan", () => {
  test("drinking rises with heat and never jumps", () => {
    let prev = null;
    for (let t = -5; t <= 38; t += 0.25){
      const p = plan({tMax: t}).perHour[1];
      if (prev !== null){
        assert.ok(p >= prev, `less to drink at ${t}° than just below it`);
        assert.ok(p - prev <= 50, `drink jumped ${prev}→${p} ml/h at ${t}°`);
      }
      prev = p;
    }
  });

  test("eating rises with duration and never jumps", () => {
    let prev = null;
    for (let h = 0.5; h <= 6; h += 0.05){
      const p = plan({}, {hours: h});
      const hi = p.carbs ? p.carbs[1] : 0;
      if (prev !== null){
        assert.ok(hi >= prev, `less to eat at ${h.toFixed(2)} h`);
        // The first rung (nothing → 20 g) is the only allowed step: below that
        // it says "nothing needed" rather than "10 g an hour".
        assert.ok(hi - prev <= 20, `carbs jumped ${prev}→${hi} g/h at ${h.toFixed(2)} h`);
      }
      prev = hi;
    }
  });

  test("an hour easy needs no food; three hours hard does", () => {
    assert.strictEqual(plan({}, {hours: 1, pace: "easy"}).carbs, null);
    const hard = plan({}, {hours: 3, pace: "hard"});
    assert.ok(hard.carbs[1] >= 70 && hard.carbs[1] <= 90, String(hard.carbs));
    assert.ok(hard.gels >= 6);
  });

  test("the planner's effort outranks the pace chips", () => {
    const easy = plan({}, {hours: 1.5, pace: "steady", effort: 1});
    const hard = plan({}, {hours: 1.5, pace: "steady", effort: 5});
    assert.ok(hard.carbs[1] > easy.carbs[1]);
    assert.ok(hard.perHour[1] > easy.perHour[1]);
    assert.ok(hard.fromPlanner && !plan({}, {}).fromPlanner);
  });

  test("muggy air that will not take sweat means more to drink", () => {
    assert.ok(plan({tMax: 24}, {}, {evap: 0.8}).perHour[1] > plan({tMax: 24}, {}, {evap: 0}).perHour[1]);
  });

  test("electrolyte in the heat or on a long ride, not on a cool hour", () => {
    assert.ok(plan({tMax: 26}, {hours: 1}).salt);
    assert.ok(plan({tMax: 18}, {hours: 4}).salt);
    assert.ok(!plan({tMax: 10}, {hours: 1}).salt);
  });

  test("more than two bottles says when to refill", () => {
    const p = plan({tMax: 28}, {hours: 4, pace: "hard"});
    assert.ok(p.bottles >= 3 && p.refillAt > 1 && p.refillAt < 2.5);
    assert.ok(p.notes.some(n => n.includes("refill")));
    assert.strictEqual(plan({tMax: 12}, {hours: 1.5}).refillAt, null);
  });

  test("cold says drink to the clock", () => {
    assert.ok(plan({tMax: 2}, {hours: 2}).notes.some(n => n.includes("Cold blunts thirst")));
  });
});

describe("readHandoff", () => {
  test("reads what Fietscoach sends", () => {
    const h = readHandoff("?date=2026-11-14&time=09:30&hours=2.25&pace=steady&effort=3&name=Lange%20rit%202u15");
    assert.deepStrictEqual(h, {date: "2026-11-14", time: "09:30", hours: 2.25, pace: "steady",
                               effort: 3, name: "Lange rit 2u15"});
  });

  test("drops anything malformed rather than guessing", () => {
    const h = readHandoff("?date=14-11-2026&time=9u&hours=99&pace=fast&effort=7&name=x");
    assert.deepStrictEqual(h, {date: null, time: null, hours: null, pace: null, effort: null, name: "x"});
    assert.strictEqual(readHandoff(""), null);
    assert.strictEqual(readHandoff("?utm_source=foo"), null);
  });

  test("a long name is cut, and the page sets it as text", () => {
    assert.strictEqual(readHandoff("?name=" + "a".repeat(200)).name.length, 80);
    const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
    assert.ok(/el\.textContent = `From Fietscoach/.test(app), "the handover line must be set as text, not HTML");
  });
});
