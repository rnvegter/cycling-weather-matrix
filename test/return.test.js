"use strict";

/* ---------------------------------------------------------------
   The way back: what to bring and what stays in the bag, given the
   morning's outfit and the way home's own.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

globalThis.localStorage = {getItem: () => null, setItem(){}, removeItem(){}};
before(() => {
  ["weather.js", "gpx.js", "gear.js", "model.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});

const it = (model, slot, tmin, tmax, extra) => normaliseItem(Object.assign({brand: "T", model, slot, tmin, tmax}, extra || {}));
const f = (feel, ext) => ({feel, extFeel: ext == null ? feel - 3 : ext, handsFeel: ext == null ? feel - 3 : ext, feetFeel: ext == null ? feel - 3 : ext});
const names = list => list.map(i => i.model).sort();

describe("returnPlan", () => {
  const jersey = it("LS jersey", "mid", 6, 14), jersey2 = it("Other LS jersey", "mid", 5, 13);
  const gloves = it("Winter gloves", "hands", -5, 5), mitts = it("Mitts", "hands", 10, 40);
  const vest = it("Gilet", "vest", 4, 12, {pack: true}), shorts = it("Shorts", "legs", 14, 40, {short: true});
  const tights = it("Tights", "legs", -5, 13), cap = it("Brimmed cap", "head", -10, 40, {rainOnly: true});

  test("a garment that still covers the way back is worn both ways, even if a fresh pick differs", () => {
    const p = returnPlan({wear: [jersey]}, {wear: [jersey2]}, f(10));
    assert.deepEqual(names(p.both), ["LS jersey"]);
    assert.deepEqual(p.bring, []);
    assert.deepEqual(p.stow, []);
  });

  test("a colder way home brings what the morning did not need", () => {
    const p = returnPlan({wear: [jersey, mitts]}, {wear: [jersey, gloves, vest]}, f(5, 2));
    assert.deepEqual(names(p.both), ["LS jersey"]);
    assert.deepEqual(names(p.bring), ["Gilet", "Winter gloves"]);
    assert.deepEqual(names(p.stow), ["Mitts"]);
  });

  test("a warmer way home stows what it no longer wants", () => {
    const p = returnPlan({wear: [jersey, gloves, vest, tights]}, {wear: [jersey, mitts, shorts]}, f(16, 13));
    assert.deepEqual(names(p.stow).sort(), ["Gilet", "Tights", "Winter gloves"]);
    assert.deepEqual(names(p.bring).sort(), ["Mitts", "Shorts"]);
  });

  test("rain kit for the way back is brought even when the slot is covered", () => {
    const warmHat = it("Thermal cap", "head", -5, 8);
    const p = returnPlan({wear: [warmHat]}, {wear: [warmHat, cap]}, f(6, 4));
    assert.deepEqual(names(p.both), ["Thermal cap"]);
    assert.deepEqual(names(p.bring), ["Brimmed cap"]);
  });

  test("eyewear follows the light: sunglasses this morning do not cover the dark", () => {
    const sun = it("Sunglasses", "eyes", -10, 45), clear = it("Clear lenses", "eyes", -10, 45, {rainOnly: true});
    const p = returnPlan({wear: [sun]}, {wear: [clear]}, f(6));
    assert.deepEqual(names(p.stow), ["Sunglasses"]);
    assert.deepEqual(names(p.bring), ["Clear lenses"]);
    const same = returnPlan({wear: [sun]}, {wear: [sun]}, f(6));
    assert.deepEqual(names(same.both), ["Sunglasses"]);
  });

  test("generic outfits compare by name, zone by zone", () => {
    const there = {wear: [{_label: "Core", name: "SS jersey"}, {_label: "Legs", name: "Bib shorts"}]};
    const back = {wear: [{_label: "Core", name: "LS thermal jersey"}, {_label: "Legs", name: "Bib shorts"}]};
    const p = returnPlan(there, back, f(8));
    assert.deepEqual(p.both.map(i => i.name), ["Bib shorts"]);
    assert.deepEqual(p.bring.map(i => i.name), ["LS thermal jersey"]);
    assert.deepEqual(p.stow.map(i => i.name), ["SS jersey"]);
  });
});
