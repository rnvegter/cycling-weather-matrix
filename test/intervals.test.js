"use strict";

/* ---------------------------------------------------------------
   intervals.icu: the decisions in intervals.js, and the server's routes
   against an intervals.icu that the test answers for (setIcuTransport), so
   nothing leaves the machine and no key is needed.
----------------------------------------------------------------*/

const {test, describe, before, after, beforeEach} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cwem-icu-test-"));
process.env.STATE_DIR = TMP;
process.env.BACKUP_DIR = path.join(TMP, "backups");
const srv = require("../server.js");
after(() => { try{ fs.rmSync(TMP, {recursive: true, force: true}); }catch(e){} });

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
before(() => {
  ["weather.js", "gpx.js", "history.js", "favourites.js", "feedback.js", "intervals.js"]
    .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});
beforeEach(() => store.clear());

const ride = extra => normaliseRide(Object.assign({startISO: "2026-11-09T08:00", place: "Utrecht", feel: 6, air: 8, extFeel: 3,
                                                   kit: ["Jacket", "Gloves"]}, extra || {}));

/* --- The decisions ------------------------------------------------- */

describe("what to import", () => {
  test("a month back the first time, then from the day of the last import", () => {
    const now = new Date(2026, 10, 9, 20, 0).getTime();
    assert.deepEqual(icuImportWindow(null, now), {oldest: "2026-10-10", newest: "2026-11-09"});
    assert.deepEqual(icuImportWindow("2026-11-07", now), {oldest: "2026-11-07", newest: "2026-11-09"});
  });

  test("new rides with GPS only, oldest first, never one already imported", () => {
    const history = [ride({icuId: "i2"})];
    const list = ridesToImport([
      {id: "i3", start: "2026-11-09T08:00:00", hasGps: true},
      {id: "i2", start: "2026-11-08T08:00:00", hasGps: true},
      {id: "i1", start: "2026-11-07T08:00:00", hasGps: true},
      {id: "i4", start: "2026-11-06T08:00:00", hasGps: false}
    ], history);
    assert.deepEqual(list.map(r => r.id), ["i1", "i3"]);
  });
});

describe("matching a recorded ride to the one planned here", () => {
  test("the nearest planned ride within 90 minutes", () => {
    const h = [ride({startISO: "2026-11-09T07:00"}), ride({startISO: "2026-11-09T08:00", place: "Other"})];
    assert.equal(matchPlanned(h, {start: "2026-11-09T07:50:10"}).startISO, "2026-11-09T08:00");
  });
  test("nothing beyond 90 minutes, nothing already recorded, nothing reconstructed", () => {
    assert.equal(matchPlanned([ride()], {start: "2026-11-09T09:40:00"}), null);
    assert.equal(matchPlanned([ride({actual: {speed: 25, distance: 50}})], {start: "2026-11-09T08:05:00"}), null);
    assert.equal(matchPlanned([ride({reconstructed: true})], {start: "2026-11-09T08:05:00"}), null);
    assert.equal(matchPlanned([ride({icuId: "i9"})], {start: "2026-11-09T08:05:00"}), null);
  });
});

describe("a planned workout on the Ride tab", () => {
  test("date, time unless midnight, hours to the quarter, effort from load per hour", () => {
    assert.deepEqual(plannedToRide({start: "2026-11-10T07:30:00", hours: 2.1, load: 120, name: "Endurance"}),
      {date: "2026-11-10", time: "07:30", hours: 2, effort: 3, pace: "steady", name: "Endurance"});
    const noTime = plannedToRide({start: "2026-11-10T00:00:00", hours: 1, load: 95});
    assert.equal(noTime.time, null);
    assert.equal(noTime.effort, 5);
    assert.equal(noTime.pace, "hard");
    assert.equal(plannedToRide({start: "2026-11-10T00:00:00", hours: 3, load: 60}).effort, 1);
    assert.equal(plannedToRide({start: "2026-11-10T00:00:00"}).effort, null);
  });
});

describe("a route as a favourite", () => {
  test("keeps the path and the route id, with no height", () => {
    const path = Array.from({length: 300}, (_, i) => [52 + i * 0.001, 5 + Math.sin(i / 20) * 0.01]);
    const fav = routeToFavourite({id: "77", name: "Rondje", path});
    assert.equal(fav.name, "Rondje");
    assert.equal(fav.icuRouteId, "77");
    assert.ok(fav.points.length >= 2 && fav.points.every(p => p[2] === null));
    assert.equal(routeToFavourite({id: "1", name: "x", path: [[52, 5]]}), null);
  });
});

describe("writing the rating back", () => {
  test("says the verdicts and the numbers the kit was chosen on", () => {
    const t = icuComment(ride({verdict: "bit-cold", zones: {hands: "cold"}}));
    assert.match(t, /^Weather Effect: kit a bit cold \(hands too cold\)\./);
    assert.match(t, /Planned at 6° ride-feel, 8° air, hands and feet 3°\./);
    assert.match(t, /Wore: Jacket, Gloves\./);
    assert.equal(icuComment(ride()), null, "nothing to say before a rating");
  });

  test("due once the rating has stood 20 seconds; again only when it changed", () => {
    const at = Date.parse("2026-11-09T12:00:00Z");
    const r = ride({icuId: "i5", verdict: "right", ratedAt: "2026-11-09T12:00:00.000Z"});
    assert.equal(icuCommentsDue([r], at + 10000).length, 0);
    assert.equal(icuCommentsDue([r], at + 20000).length, 1);
    const sent = Object.assign({}, r, {icuSentAt: "2026-11-09T12:00:30.000Z"});
    assert.equal(icuCommentsDue([sent], at + 60000).length, 0);
    const changed = Object.assign({}, sent, {ratedAt: "2026-11-09T12:05:00.000Z"});
    assert.equal(icuCommentsDue([changed], at + 6 * 60000).length, 1);
    assert.equal(icuCommentsDue([ride({verdict: "right", ratedAt: "2026-11-09T12:00:00.000Z"})], at + 60000).length, 0,
      "a ride not from intervals.icu is never sent");
  });

  test("the intervals.icu fields survive normalisation, and junk does not", () => {
    assert.equal(ride({icuId: "i123", icuSentAt: "2026-11-09T12:00:00Z"}).icuId, "i123");
    assert.equal(ride({icuId: "../etc"}).icuId, null);
    assert.equal(normaliseFavourite({name: "x", points: [[52, 5, null], [52.1, 5.1, null]], icuRouteId: "12"}).icuRouteId, "12");
    assert.equal(normaliseFavourite({name: "x", points: [[52, 5, null], [52.1, 5.1, null]], icuRouteId: "x"}).icuRouteId, null);
  });
});

/* --- The server's routes ------------------------------------------- */

describe("/api/intervals", () => {
  let base, calls;
  const answers = {};
  before(async () => {
    await new Promise(r => srv.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${srv.server.address().port}/api/intervals`;
    srv.setIcuTransport(async (method, url, headers, body) => {
      calls.push({method, url, headers, body});
      const u = new URL(url);
      const a = answers[`${method} ${u.pathname}`];
      if (!a) return {status: 404, headers: {}, body: ""};
      return typeof a === "function" ? a(u, body) : a;
    });
  });
  after(() => { srv.setIcuTransport(null); delete process.env.INTERVALS_API_KEY; return new Promise(r => srv.server.close(r)); });
  beforeEach(() => { calls = []; process.env.INTERVALS_API_KEY = "test-key"; srv.ICU_RATE.hits.clear(); });

  const json = obj => ({status: 200, headers: {"content-type": "application/json"}, body: JSON.stringify(obj)});
  const get = p => fetch(base + p).then(async r => ({status: r.status, body: await r.text()}));

  test("status says whether a key is set, and never what it is", async () => {
    let r = await get("/status");
    assert.deepEqual(JSON.parse(r.body), {configured: true});
    assert.doesNotMatch(r.body, /test-key/);
    delete process.env.INTERVALS_API_KEY;
    r = await get("/status");
    assert.deepEqual(JSON.parse(r.body), {configured: false});
    r = await get("/rides?oldest=2026-11-01");
    assert.equal(r.status, 503);
    assert.equal(calls.length, 0, "nothing is asked of intervals.icu without a key");
  });

  test("rides: outdoor rides only, the app's own fields, Basic auth with the key and a browser user agent", async () => {
    answers["GET /api/v1/athlete/0/activities"] = json([
      {id: "i1", type: "Ride", name: "Morning", start_date_local: "2026-11-09T07:58:12", distance: 50123, moving_time: 7200,
       average_speed: 6.96, stream_types: ["time", "latlng", "altitude"], route_id: 42, icu_ftp: 260, average_watts: 180},
      {id: "i2", type: "VirtualRide", name: "Zwift"}, {id: "i3", type: "Ride", trainer: true}, {id: "i4", type: "Run"}
    ]);
    const r = await get("/rides?oldest=2026-11-01&newest=2026-11-09");
    const list = JSON.parse(r.body);
    assert.deepEqual(list, [{id: "i1", name: "Morning", start: "2026-11-09T07:58:12", distanceKm: 50.12, movingH: 2,
                             speedKmh: 25.1, hasGps: true, routeId: "42"}]);
    const c = calls[0];
    assert.equal(c.headers.authorization, "Basic " + Buffer.from("API_KEY:test-key").toString("base64"));
    assert.match(c.headers["user-agent"], /Mozilla/);
    assert.equal(new URL(c.url).searchParams.get("oldest"), "2026-11-01");
  });

  test("bad dates and ids are refused before anything is asked", async () => {
    assert.equal((await get("/rides?oldest=yesterday")).status, 400);
    assert.equal((await get("/ride-gpx?id=../../athlete/0")).status, 400);
    assert.equal((await get("/route?id=1;2")).status, 400);
    assert.equal(calls.length, 0);
  });

  test("a ride's GPX comes back as GPX; anything else is refused", async () => {
    answers["GET /api/v1/activity/i1/gpx-file"] = {status: 200, headers: {"content-type": "application/gpx+xml"}, body: "<gpx version=\"1.1\"><trk/></gpx>"};
    let r = await get("/ride-gpx?id=i1");
    assert.equal(r.status, 200);
    assert.match(r.body, /^<gpx/);
    answers["GET /api/v1/activity/i2/gpx-file"] = {status: 200, headers: {"content-type": "text/html"}, body: "<html>challenge</html>"};
    assert.equal((await get("/ride-gpx?id=i2")).status, 502);
  });

  test("planned rides and routes come back in the app's shape", async () => {
    answers["GET /api/v1/athlete/0/events.json"] = u => {
      assert.equal(u.searchParams.get("category"), "WORKOUT");
      return json([{id: 7, type: "Ride", name: "Tempo", start_date_local: "2026-11-10T00:00:00", moving_time: 5400, icu_training_load: 90},
                   {id: 8, type: "Run", name: "Jog"}]);
    };
    assert.deepEqual(JSON.parse((await get("/planned?oldest=2026-11-09&newest=2026-11-16")).body),
      [{id: "7", name: "Tempo", start: "2026-11-10T00:00:00", hours: 1.5, distanceKm: null, load: 90}]);
    answers["GET /api/v1/athlete/0/routes"] = json([{route_id: 5, name: "Commute", distance: 15000, activity_count: 40, commute: true},
                                                     {route_id: 6, name: "Old", replaced_by_route_id: 5}]);
    assert.deepEqual(JSON.parse((await get("/routes")).body), [{id: "5", name: "Commute", distanceKm: 15, rides: 40, commute: true}]);
    answers["GET /api/v1/athlete/0/routes/5"] = u => {
      assert.equal(u.searchParams.get("includePath"), "true");
      return json({route_id: 5, name: "Commute", latlngs: [[52.1, 5.1], [52.2, "x"], [52.3, 5.3]]});
    };
    assert.deepEqual(JSON.parse((await get("/route?id=5")).body), {id: "5", name: "Commute", path: [[52.1, 5.1], [52.3, 5.3]]});
  });

  test("a comment is posted as the rider's message, from this app only", async () => {
    answers["POST /api/v1/activity/i1/messages"] = json({id: 1});
    const post = (body, origin) => fetch(base + "/comment", {method: "POST", body: JSON.stringify(body),
      headers: Object.assign({"content-type": "application/json"}, origin ? {origin} : {})});
    let r = await post({id: "i1", text: "Weather Effect: kit about right."});
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(calls[0].body), {content: "Weather Effect: kit about right."});
    r = await post({id: "i1", text: "x"}, "https://evil.example");
    assert.equal(r.status, 403);
    assert.equal((await post({id: "i1", text: "  "})).status, 400);
  });

  test("intervals.icu's refusals reach the page in words", async () => {
    answers["GET /api/v1/athlete/0/routes"] = {status: 401, headers: {}, body: ""};
    let r = await get("/routes");
    assert.match(JSON.parse(r.body).error, /refused the API key/);
    answers["GET /api/v1/athlete/0/routes"] = {status: 429, headers: {"retry-after": "370"}, body: ""};
    r = await get("/routes");
    assert.equal(r.status, 429);
    assert.match(JSON.parse(r.body).error, /limit is used up; try again in 7 minutes/);
  });
});
