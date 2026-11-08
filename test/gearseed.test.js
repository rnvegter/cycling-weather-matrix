"use strict";

/* ---------------------------------------------------------------
   Seed versions for the gear list.

   A stored list is the rider's and wins over the seed. These tests guard the
   way a correction to the seed still reaches it: added garments arrive once,
   a changed number moves only while it still holds the old seed value, and
   nothing the rider touched — an edited number, a renamed garment, a garment
   removed after the upgrade — is put back.

   The changes are pushed into GEAR_SEED_CHANGES here, because the shipped
   list is empty until the seed is next corrected.
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
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "gear.js"), "utf8"), {filename: "gear.js"});
});

const SEED_KEY = "cwem-gear-seed-version";
const STAMP_KEY = "cwem-gear-updated";       // sync.js's stamp: an upgrade must not move it

const v2 = {version: 2, note: "Added the winter cap.",
  add: [{brand: "Test", model: "Winter cap", slot: "head", tmin: -5, tmax: 5, clo: 0.05}]};
const v3 = {version: 3, note: "Knee warmers start a degree colder.",
  update: [{brand: "Test", model: "Knee warmers", from: {tmin: 11, clo: 0.06}, to: {tmin: 10, clo: 0.07}}]};

const storedList = extra => [
  {brand: "Test", model: "Knee warmers", slot: "legextra", tmin: 11, tmax: 16, clo: 0.06},
  {brand: "Test", model: "Jersey", slot: "mid", tmin: 14, tmax: 30},
  ...(extra || [])
];
const put = list => localStorage.setItem(GEAR_KEY, JSON.stringify(list));
const find = (list, model) => list.find(i => i.model === model);

beforeEach(() => {
  store.clear();
  GEAR_SEED_CHANGES.length = 0;
});

describe("seed versions", () => {
  test("with no changes the version is 1 and a stored list is returned as it is", () => {
    put(storedList());
    assert.equal(gearSeedVersion(), 1);
    assert.equal(loadGear().length, 2);
  });

  test("a fresh install gets the seed and is marked current", () => {
    GEAR_SEED_CHANGES.push(v2);
    assert.equal(loadGear().length, GEAR_SEED.length);
    assert.equal(localStorage.getItem(SEED_KEY), "2");
  });

  test("a garment the seed gained reaches a stored list, once", () => {
    put(storedList());
    localStorage.setItem(STAMP_KEY, "2026-10-01T08:00:00.000Z");
    GEAR_SEED_CHANGES.push(v2);
    const g = loadGear();
    assert.ok(find(g, "Winter cap"), "added");
    assert.equal(loadGear().filter(i => i.model === "Winter cap").length, 1, "not added twice");
    assert.equal(localStorage.getItem(SEED_KEY), "2");
    assert.equal(localStorage.getItem(STAMP_KEY), "2026-10-01T08:00:00.000Z",
      "an upgrade is not an edit, so the sync stamp stays where it was");
    assert.equal(takeGearUpgradeNote(), "Added the winter cap.");
    assert.equal(takeGearUpgradeNote(), "", "said once");
  });

  test("an added garment the rider already has under the same name is not doubled", () => {
    put(storedList([{brand: "test", model: "winter cap", slot: "head", tmin: -2, tmax: 6}]));
    GEAR_SEED_CHANGES.push(v2);
    const caps = loadGear().filter(i => i.model.toLowerCase() === "winter cap");
    assert.equal(caps.length, 1);
    assert.equal(caps[0].tmin, -2, "the rider's own range stands");
    assert.equal(takeGearUpgradeNote(), "", "nothing changed, so nothing is said");
  });

  test("a corrected number moves only while it still holds the old seed value", () => {
    GEAR_SEED_CHANGES.push(v3);
    put(storedList());
    let k = find(loadGear(), "Knee warmers");
    assert.equal(k.tmin, 10);
    assert.equal(k.clo, 0.07);

    // Same change, but the rider had already set their own tmin.
    store.clear();
    const edited = storedList(); edited[0].tmin = 12;
    put(edited);
    k = find(loadGear(), "Knee warmers");
    assert.equal(k.tmin, 12, "the rider's number is theirs");
    assert.equal(k.clo, 0.07, "the field they did not touch still moves");
  });

  test("a renamed garment is left alone", () => {
    GEAR_SEED_CHANGES.push(v3);
    const renamed = storedList(); renamed[0].model = "My knee warmers";
    put(renamed);
    assert.equal(find(loadGear(), "My knee warmers").tmin, 11);
  });

  test("a garment removed after the upgrade does not come back", () => {
    put(storedList());
    GEAR_SEED_CHANGES.push(v2);
    const g = loadGear().filter(i => i.model !== "Winter cap");
    saveGear(g);
    assert.equal(find(loadGear(), "Winter cap"), undefined);
  });

  test("changes apply in order across several versions", () => {
    put(storedList());
    GEAR_SEED_CHANGES.push(v3, v2);           // listed out of order on purpose
    const g = loadGear();
    assert.ok(find(g, "Winter cap"));
    assert.equal(find(g, "Knee warmers").tmin, 10);
    assert.equal(localStorage.getItem(SEED_KEY), "3");
    assert.equal(takeGearUpgradeNote(), "Added the winter cap. Knee warmers start a degree colder.");
  });

  test("a list already at version 2 only takes version 3", () => {
    put(storedList());
    localStorage.setItem(SEED_KEY, "2");
    GEAR_SEED_CHANGES.push(v2, v3);
    const g = loadGear();
    assert.equal(find(g, "Winter cap"), undefined, "version 2 is not replayed");
    assert.equal(find(g, "Knee warmers").tmin, 10);
  });

  test("Reset marks the list current", () => {
    put(storedList());
    GEAR_SEED_CHANGES.push(v2);
    resetGear();
    assert.equal(localStorage.getItem(SEED_KEY), "2");
  });
});
