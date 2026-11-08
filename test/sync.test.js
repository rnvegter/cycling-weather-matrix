"use strict";

/* ---------------------------------------------------------------
   Sync of the gear list (and favourites, which follow the same rule).

   Both are whole-list, newest-stamp-wins. The stamp is set when a list is
   saved in a browser running sync.js; a list that was never saved that way
   carries none. The rule this file guards is that a MISSING stamp is older
   than any stamp, on both ends:

   - in the browser, a list held only as the built-in seed must not stand
     against the server's list just because neither carries a stamp;
   - on the server, a write carrying an older stamp, or none, must not replace
     a list that carries a newer one. That is the tab left open since
     yesterday, pushing its ride history and its day-old gear with it.

   The browser half loads gear.js, history.js, favourites.js and sync.js in
   index.html order, with an in-memory localStorage and no server (fetch
   refuses), and calls mergeIncoming directly. The server half talks to a real
   server on a spare port, with a temporary STATE_DIR.
----------------------------------------------------------------*/

const {test, describe, before, after, beforeEach} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cwem-sync-test-"));
process.env.STATE_DIR = TMP;
process.env.BACKUP_DIR = path.join(TMP, "backups");
const srv = require("../server.js");
after(() => { try{ fs.rmSync(TMP, {recursive: true, force: true}); }catch(e){} });

/* --- Browser side ------------------------------------------------ */

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
globalThis.location = {href: "http://localhost:8765/index.html", search: ""};
globalThis.window = {addEventListener(){}};
globalThis.document = {getElementById: () => null};

before(() => {
  const realFetch = globalThis.fetch, realInterval = globalThis.setInterval;
  globalThis.fetch = () => Promise.reject(new Error("no server in this test"));
  globalThis.setInterval = () => 0;
  ["gpx.js", "history.js", "favourites.js", "gear.js", "sync.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
  globalThis.setInterval = realInterval;
  // The pull at load time has failed by now or will; either way it changes nothing.
  globalThis._restoreFetch = realFetch;
});
beforeEach(() => { store.clear(); globalThis.gear = undefined; });

const riderList = () => [{brand: "Rider", model: "Own jacket", slot: "shell", tmin: 0, tmax: 12}];

describe("gear merge in the browser", () => {
  test("a browser holding only the seed adopts the server's unstamped list", () => {
    // Nothing stored: loadGear() answers with the seed, and there is no stamp.
    mergeIncoming({gear: riderList(), gearUpdatedAt: ""});
    assert.equal(loadGear()[0].model, "Own jacket",
      "the server's list must not lose to a seed nobody chose");
  });

  test("a stamped server list still wins over an unstamped local one", () => {
    localStorage.setItem(GEAR_KEY, JSON.stringify([{brand: "Old", model: "List", slot: "mid"}]));
    mergeIncoming({gear: riderList(), gearUpdatedAt: "2026-10-01T08:00:00.000Z"});
    assert.equal(loadGear()[0].model, "Own jacket");
  });

  test("a list this browser saved is kept against an unstamped one from the server", () => {
    localStorage.setItem(GEAR_KEY, JSON.stringify([{brand: "Mine", model: "Edited", slot: "mid"}]));
    localStorage.setItem(GEAR_STAMP_KEY, "2026-10-01T08:00:00.000Z");
    mergeIncoming({gear: riderList(), gearUpdatedAt: ""});
    assert.equal(loadGear()[0].model, "Edited");
  });

  test("an older stamped list does not replace a newer one", () => {
    localStorage.setItem(GEAR_KEY, JSON.stringify([{brand: "Mine", model: "Newer", slot: "mid"}]));
    localStorage.setItem(GEAR_STAMP_KEY, "2026-10-02T08:00:00.000Z");
    mergeIncoming({gear: riderList(), gearUpdatedAt: "2026-10-01T08:00:00.000Z"});
    assert.equal(loadGear()[0].model, "Newer");
  });
});

/* --- Server side ------------------------------------------------- */

describe("writes to /api/state", () => {
  let base;
  before(async () => {
    await new Promise(r => srv.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${srv.server.address().port}/api/state`;
  });
  after(() => new Promise(r => srv.server.close(r)));

  const realFetch = () => globalThis._restoreFetch;
  const put = doc => realFetch()(base, {method: "PUT", headers: {"content-type": "application/json"},
                                        body: JSON.stringify(doc)});
  const read = async () => (await realFetch()(base)).json();
  const T1 = "2026-10-01T08:00:00.000Z", T2 = "2026-10-02T08:00:00.000Z";
  const list = name => [{brand: "", model: name, slot: "mid"}];

  beforeEach(() => { try{ fs.rmSync(path.join(TMP, "state.json")); }catch(e){} });

  test("an older gear stamp does not overwrite a newer list", async () => {
    await put({gear: list("newer"), gearUpdatedAt: T2, history: []});
    await put({gear: list("stale tab"), gearUpdatedAt: T1, history: [{id: "r1"}]});
    const doc = await read();
    assert.equal(doc.gear[0].model, "newer");
    assert.equal(doc.gearUpdatedAt, T2);
    assert.deepEqual(doc.history, [{id: "r1"}], "the rest of the write still lands");
  });

  test("a missing gear stamp counts as older than any stamp", async () => {
    await put({gear: list("stamped"), gearUpdatedAt: T1});
    await put({gear: list("unstamped"), gearUpdatedAt: ""});
    assert.equal((await read()).gear[0].model, "stamped");
  });

  test("a newer stamp replaces the list, as before", async () => {
    await put({gear: list("old"), gearUpdatedAt: T1});
    await put({gear: list("new"), gearUpdatedAt: T2});
    assert.equal((await read()).gear[0].model, "new");
  });

  test("favourites follow the same rule, and an empty newer list still counts", async () => {
    await put({favourites: [{id: "f1"}], favouritesUpdatedAt: T2});
    await put({favourites: [], favouritesUpdatedAt: T1});
    assert.deepEqual((await read()).favourites, [{id: "f1"}]);
    await put({favourites: [], favouritesUpdatedAt: "2026-10-03T08:00:00.000Z"});
    assert.deepEqual((await read()).favourites, [], "deleting the last favourite propagates");
  });
});
