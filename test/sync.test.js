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
  ["gpx.js", "history.js", "favourites.js", "feedback.js", "gear.js", "sync.js"].forEach(f =>
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

describe("history merge in the browser", () => {
  const r = (id, extra) => Object.assign({startISO: `2026-10-0${id}T08:00`, place: "Utrecht",
                                          savedAt: `2026-10-0${id}T07:00:00.000Z`}, extra || {});

  test("a ride deleted here does not come back from the server", () => {
    saveHistory([r(1), r(2)].map(normaliseRide));
    const gone = loadHistory()[0].id;
    deleteRide(gone);
    mergeIncoming({history: [r(1), r(2)]});
    assert.deepEqual(loadHistory().map(e => e.id).includes(gone), false);
    assert.equal(loadHistory().length, 1);
  });

  test("a ride deleted on another device is deleted here, and stays deleted", () => {
    saveHistory([r(1), r(2)].map(normaliseRide));
    const gone = loadHistory()[1].id;
    mergeIncoming({history: [r(1)], deletedRides: {[gone]: "2026-10-05T10:00:00.000Z"}});
    assert.equal(loadHistory().length, 1);
    assert.ok(localDocument().deletedRides[gone], "the deletion is carried on to the next push");
  });

  test("planning the same ride again after deleting it brings it back", () => {
    saveHistory([r(1)].map(normaliseRide));
    const id = loadHistory()[0].id;
    deleteRide(id);
    recordRide(r(1, {feel: 5}));
    assert.equal(loadHistory().length, 1);
    assert.equal(localDocument().deletedRides[id], undefined);
  });

  test("clearing the history deletes every ride everywhere, not only here", () => {
    saveHistory([r(1), r(2)].map(normaliseRide));
    clearHistory();
    assert.equal(Object.keys(localDocument().deletedRides).length, 2);
    mergeIncoming({history: [r(1), r(2)]});
    assert.equal(loadHistory().length, 0);
  });

  test("a restore made on another device replaces this one's history on the next pull", () => {
    saveHistory([r(1), r(2)].map(normaliseRide));
    mergeIncoming({history: [r(1)], deletedRides: {}, historyReplacedAt: "2026-10-09T10:00:00.000Z"});
    assert.deepEqual(loadHistory().map(e => e.startISO), ["2026-10-01T08:00"]);
    assert.equal(historyReplacedAt(), "2026-10-09T10:00:00.000Z", "and it adopts the stamp, so it is not done twice");
  });

  test("a recorded ride attached elsewhere reaches this browser", () => {
    saveHistory([r(1)].map(normaliseRide));
    mergeIncoming({history: [r(1, {actual: {speed: 31, distance: 60}, actualFrom: "x.gpx"})]});
    assert.equal(loadHistory()[0].actual.speed, 31);
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

  const ride = (n, extra) => Object.assign({id: `2026-10-0${n}T08:00|Utrecht`, startISO: `2026-10-0${n}T08:00`, place: "Utrecht"}, extra || {});

  test("a stale tab's history does not drop rides another device added", async () => {
    await put({history: [ride(1), ride(2), ride(3)]});
    await put({history: [ride(1)]});                       // open since before 2 and 3 existed
    const ids = (await read()).history.map(e => e.id);
    assert.deepEqual(ids.sort(), [ride(1).id, ride(2).id, ride(3).id].sort());
  });

  test("a rating beats no rating, and a newer rating beats an older one", async () => {
    await put({history: [ride(1, {verdict: "cold", delta: -2, ratedAt: T2})]});
    await put({history: [ride(1)]});
    assert.equal((await read()).history[0].verdict, "cold", "unrated does not undo a rating");
    await put({history: [ride(1, {verdict: "warm", delta: 2, ratedAt: T1})]});
    assert.equal((await read()).history[0].verdict, "cold", "an older rating does not replace a newer one");
    await put({history: [ride(1, {verdict: "right", delta: 0, ratedAt: "2026-10-03T08:00:00.000Z"})]});
    assert.equal((await read()).history[0].verdict, "right");
  });

  test("a deletion is kept and applied, and is carried to other devices", async () => {
    await put({history: [ride(1), ride(2)]});
    await put({history: [ride(1)], deletedRides: {[ride(2).id]: T2}});
    let doc = await read();
    assert.deepEqual(doc.history.map(e => e.id), [ride(1).id]);
    assert.equal(doc.deletedRides[ride(2).id], T2);
    await put({history: [ride(1), ride(2)]});              // a device that still has it
    doc = await read();
    assert.deepEqual(doc.history.map(e => e.id), [ride(1).id], "the deletion stands");
  });

  test("a restore replaces the history outright, deletions included", async () => {
    await put({history: [ride(1), ride(2)], deletedRides: {[ride(3).id]: T1}});
    await put({history: [ride(3)], deletedRides: {}, historyReplacedAt: T2});
    const doc = await read();
    assert.deepEqual(doc.history.map(e => e.id), [ride(3).id]);
    assert.deepEqual(doc.deletedRides, {});
    await put({history: [ride(1)], historyReplacedAt: T1});   // an older restore, from a stale tab
    assert.deepEqual((await read()).history.map(e => e.id), [ride(3).id],
      "not replaced, and the stale tab's ride from before the restore does not come back");
  });

  test("after a restore, a device that has not seen it cannot merge the undone rides back", async () => {
    const old = (n, savedAt) => ride(n, {savedAt});
    await put({history: [old(1, T1), old(2, T1)]});
    await put({history: [old(1, T1)], deletedRides: {}, historyReplacedAt: T2});        // restore on device A
    // Device B never saw the restore: it still has 2, and has added 3 since.
    await put({history: [old(1, T1), old(2, T1), old(3, "2026-10-03T08:00:00.000Z")], historyReplacedAt: ""});
    const ids = (await read()).history.map(e => e.id).sort();
    assert.deepEqual(ids, [ride(1).id, ride(3).id].sort(), "2 stays undone; 3, added after the restore, lands");
  });

  test("the server's merge rule is the browser's", () => {
    const cases = [
      [{}, {}], [{verdict: "right", delta: 0, ratedAt: T1}, {}], [{}, {verdict: "right", delta: 0, ratedAt: T1}],
      [{verdict: "right", delta: 0, ratedAt: T2}, {verdict: "right", delta: 0, ratedAt: T1}],
      [{verdict: "right", delta: 0, ratedAt: T1}, {verdict: "right", delta: 0, ratedAt: T2}],
      [{verdict: "right", delta: 0, ratedAt: T1}, {verdict: "right", delta: 0, ratedAt: T1}],
      [{actual: {speed: 30}}, {}], [{}, {actual: {speed: 30}}], [{actual: {speed: 30}}, {actual: {speed: 28}}]
    ];
    for (const [inc, ex] of cases){
      assert.equal(srv.rideWins(ride(1, inc), ride(1, ex)), rideWins(normaliseRide(ride(1, inc)), normaliseRide(ride(1, ex))),
        `incoming ${JSON.stringify(inc)} vs existing ${JSON.stringify(ex)}`);
    }
  });

  test("favourites follow the same rule, and an empty newer list still counts", async () => {
    await put({favourites: [{id: "f1"}], favouritesUpdatedAt: T2});
    await put({favourites: [], favouritesUpdatedAt: T1});
    assert.deepEqual((await read()).favourites, [{id: "f1"}]);
    await put({favourites: [], favouritesUpdatedAt: "2026-10-03T08:00:00.000Z"});
    assert.deepEqual((await read()).favourites, [], "deleting the last favourite propagates");
  });
});

/* --- The document's shape ------------------------------------------ */

describe("schema version", () => {
  test("browser and server agree on the current version", () => {
    assert.equal(STATE_SCHEMA, srv.STATE_SCHEMA);
  });

  test("the browser says which version it writes", () => {
    assert.equal(localDocument().schema, STATE_SCHEMA);
  });

  test("a document from a newer version is not read, and nothing is pushed over it", () => {
    saveHistory([]);
    mergeIncoming({schema: STATE_SCHEMA + 1, history: [{startISO: "2026-10-01T08:00", place: "X"}]});
    assert.equal(loadHistory().length, 0);
    assert.match(lastError, /newer version/);
  });

  test("the server refuses a newer shape, and an older one over a newer store", () => {
    assert.match(srv.schemaRefusal(null, {schema: srv.STATE_SCHEMA + 1}), /Update the server/);
    assert.match(srv.schemaRefusal({schema: srv.STATE_SCHEMA + 1}, {}), /Reload/);
    assert.equal(srv.schemaRefusal({}, {}), null, "no number is version 1 on both sides");
    assert.equal(srv.schemaRefusal(null, {schema: srv.STATE_SCHEMA}), null);
  });
});
