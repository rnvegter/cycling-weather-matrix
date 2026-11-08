"use strict";

/* ---------------------------------------------------------------
   UI checks in a real browser.  npm run test:ui

   The unit tests cover what can run in Node. What they cannot see is how the
   pieces meet in the page: the order the Go handler sets things up in, a card
   that renders NaN, a service worker that does not take over. Each of those
   has been a real bug in this project, found by hand in a browser; this file
   keeps them found.

   Optional by design. The project has no dependencies, and this needs
   Playwright with a Chromium. Where it is not installed this says so and
   exits 0, and `npm test` never runs it. Open-Meteo is never called: a fixed
   forecast is served instead, so the checks give the same answer every day
   and cost nothing against the service's limit. A server is started on a
   spare port with a temporary STATE_DIR, and both are removed afterwards.
----------------------------------------------------------------*/

const fs = require("fs");
const os = require("os");
const path = require("path");

let chromium;
try{ ({chromium} = require("playwright")); }
catch(e){
  console.log("Playwright is not installed, so the UI checks are skipped. (npm test does not need it.)");
  process.exit(0);
}

const ROOT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cwem-ui-"));
process.env.STATE_DIR = TMP;
process.env.BACKUP_DIR = path.join(TMP, "backups");
const {server} = require(path.join(ROOT, "server.js"));

/* A fixed forecast: 2° at dawn rising to 14° mid-afternoon, light wind, dry,
   from 6 to 23 November 2026. `tailNulls` blanks the last day after 04:00, as
   Open-Meteo does at the end of its range. */
function forecast(tailNulls){
  const h = {time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], cloud_cover: [],
    wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], is_day: [], weather_code: [],
    apparent_temperature: [], freezing_level_height: [], relative_humidity_2m: [], dew_point_2m: []};
  const daily = {time: [], sunrise: [], sunset: []};
  for (let d = 0; d < 18; d++){
    const day = new Date(Date.UTC(2026, 10, 6 + d)).toISOString().slice(0, 10);
    daily.time.push(day); daily.sunrise.push(`${day}T07:45`); daily.sunset.push(`${day}T16:55`);
    for (let hr = 0; hr < 24; hr++){
      const t = 2 + 12 * Math.max(0, Math.sin((hr - 6) / 14 * Math.PI));
      const gone = tailNulls && d === 17 && hr >= 4;
      const v = x => gone ? null : x;
      h.time.push(`${day}T${String(hr).padStart(2, "0")}:00`);
      h.temperature_2m.push(v(+t.toFixed(1))); h.apparent_temperature.push(v(+(t - 2).toFixed(1)));
      h.precipitation_probability.push(v(5)); h.precipitation.push(v(0)); h.cloud_cover.push(v(70));
      h.wind_speed_10m.push(v(10)); h.wind_direction_10m.push(v(240)); h.wind_gusts_10m.push(v(20));
      h.is_day.push(v(hr >= 8 && hr <= 16 ? 1 : 0)); h.weather_code.push(v(3));
      h.freezing_level_height.push(v(1500)); h.relative_humidity_2m.push(v(75)); h.dew_point_2m.push(v(+(t - 4).toFixed(1)));
    }
  }
  return {latitude: 52.09, longitude: 5.12, elevation: 5, timezone: "Europe/Amsterdam", hourly: h, daily};
}
const GEO = {results: [{name: "Utrecht", admin1: "Utrecht", country: "Netherlands", latitude: 52.09, longitude: 5.12}]};

function gpxLine(){
  let s = `<?xml version="1.0"?><gpx version="1.1" creator="ui-test"><trk><name>Flat line</name><trkseg>\n`;
  for (let i = 0; i <= 200; i++) s += `<trkpt lat="${(52.09 + 0.3 * i / 200).toFixed(6)}" lon="5.120000"><ele>5</ele></trkpt>\n`;
  const f = path.join(TMP, "line.gpx");
  fs.writeFileSync(f, s + "</trkseg></trk></gpx>\n");
  return f;
}

/* --- Harness ------------------------------------------------------ */

let base, browser;
const results = [];

async function page(opts){
  const o = opts || {};
  const ctx = await browser.newContext({viewport: {width: o.width || 900, height: 1200},
                                        timezoneId: "Europe/Amsterdam", locale: "en-GB"});
  const state = {offline: false, errors: []};
  await ctx.route(/open-meteo\.com/, r => {
    if (state.offline) return r.abort("internetdisconnected");
    const u = new URL(r.request().url());
    if (u.host.startsWith("geocoding")) return r.fulfill({contentType: "application/json", body: JSON.stringify(GEO)});
    if (u.pathname === "/v1/forecast"){
      const n = u.searchParams.get("latitude").split(",").length;
      const fc = forecast(o.tailNulls);
      return r.fulfill({contentType: "application/json", body: JSON.stringify(n > 1 ? Array(n).fill(fc) : fc)});
    }
    return r.fulfill({status: 503, body: ""});            // ensemble, air quality: optional feeds
  });
  await ctx.route(/tile\.openstreetmap|fonts\.(googleapis|gstatic)/, r => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", e => state.errors.push(e.message));
  await p.goto(`${base}/index.html#${o.screen || "ride"}`);
  return {p, ctx, state};
}

async function read(p, f){
  // The place is remembered between visits; offline it cannot be searched for.
  if (!f.keepPlace){ await p.fill("#loc", "Utrecht"); await p.click("#search"); await p.click("#geo button:not([disabled])"); }
  await p.fill("#date", f.date || "2026-11-10"); await p.fill("#time", f.time || "08:00");
  await p.fill("#dist", f.dist == null ? "" : String(f.dist)); await p.fill("#dur", f.hours == null ? "" : String(f.hours));
  await p.fill("#speed", String(f.speed || 25));
  // Only where the page has the field, so the checks can also be run against
  // an older version to see which of them it fails.
  if (await p.$("#back")) await p.fill("#back", f.back || "");
  if (f.gpx){ await p.setInputFiles("#gpx", f.gpx); await p.waitForTimeout(200); }
  await p.click("#go");
  await p.waitForFunction(() => !document.querySelector("#go").disabled, null, {timeout: 20000});
  await p.waitForTimeout(200);
  return {
    status: await p.$eval("#status", el => el.textContent),
    text: (await p.$eval("#out", el => el.innerText)).replace(/\s+/g, " "),
    headline: await p.$eval(".wx-readout__value", el => +el.textContent).catch(() => null),
    legs: await p.$$eval(".wx-leg .wx-leg__feel", els => els.map(e => parseInt(e.textContent, 10)))
  };
}

/* Every check starts from an empty server, so rides one check saves cannot
   meet another's by id through sync and change its outcome. */
async function check(name, fn){
  for (const f of ["state.json", "state.prev.json"]) fs.rmSync(path.join(TMP, f), {force: true});
  try{ await fn(); results.push([name, null]); console.log(`ok   ${name}`); }
  catch(e){ results.push([name, e]); console.log(`FAIL ${name}\n     ${e.message}`); }
}
function expect(cond, msg){ if (!cond) throw new Error(msg); }
const settle = () => new Promise(r => setTimeout(r, 1700));      // past sync's 1.2 s push debounce

/* --- The checks --------------------------------------------------- */

async function main(){
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  const line = gpxLine();

  await check("a reading renders whole, with no NaN, Infinity or undefined", async () => {
    const {p, ctx, state} = await page();
    const r = await read(p, {dist: 50});
    expect(r.headline != null, `no headline; status: ${r.status}`);
    const bad = r.text.match(/.{0,30}\b(NaN|Infinity|undefined)\b.{0,20}/);
    expect(!bad, `found "${bad && bad[0]}"`);
    for (const card of ["WEAR", "FUEL AND DRINK", "THE NEXT HOURS", "AIR → RIDE-FEEL"])
      expect(r.text.includes(card), `no ${card} card`);
    expect(!state.errors.length, `page errors: ${state.errors.join("; ")}`);
    await ctx.close();
  });

  await check("a ride past the end of the forecast is refused in words", async () => {
    const {p, ctx} = await page({tailNulls: true});
    const r = await read(p, {date: "2026-11-23", time: "10:00", dist: 40});
    expect(/runs out at/.test(r.status), `status: "${r.status}"`);
    await ctx.close();
  });

  await check("route legs carry the learned correction, as the headline does", async () => {
    const {p, ctx} = await page();
    const plain = await read(p, {dist: null, hours: 2, gpx: line});
    await p.evaluate(() => {
      [1, 2, 3, 4].forEach(i => recordRide({startISO: `2026-10-0${i}T08:00`, place: "Utrecht", feel: 6, extFeel: 3, air: 7, speed: 25, kit: []}));
      loadHistory().forEach(e => rateRide(e.id, "cold"));
    });
    const learned = await read(p, {dist: null, hours: 2, gpx: line});
    const dh = plain.headline - learned.headline, dl = plain.legs[0] - learned.legs[0];
    expect(dh === 2, `headline moved ${dh}, expected 2`);
    expect(dl === dh, `first leg moved ${dl} while the headline moved ${dh}`);
    await ctx.close();
  });

  await check("a long ride without a route gets a plan through the hours", async () => {
    const {p, ctx} = await page();
    const r = await read(p, {time: "07:00", dist: null, hours: 5});
    expect(r.text.includes("THROUGH THE RIDE"), "no Through the ride card");
    expect(/ON NOW .*leg warmers/i.test(r.text), "leg warmers are not on from the start on a warming ride");
    await ctx.close();
  });

  await check("the way back lists what goes in the bag", async () => {
    const {p, ctx} = await page();
    const r = await read(p, {time: "07:00", dist: 15, speed: 22, back: "16:00"});
    expect(r.text.includes("THE WAY BACK"), "no way back card");
    expect(/IN THE BAG/.test(r.text) && /STOW/.test(r.text), "no bag lists on a 9° swing");
    await ctx.close();
  });

  await check("garment suggestions appear from rated rides", async () => {
    const {p, ctx} = await page({screen: "gear"});
    await p.evaluate(() => {
      const name = loadGear().find(g => /Perfetto/.test(g.model)).name;
      saveHistory([[11, "warm"], [12, "warm"], [10, "bit-warm"]].map(([feel, verdict], i) => normaliseRide({
        startISO: `2026-10-0${i + 1}T08:00`, place: "Utrecht", feel, extFeel: feel - 3, air: feel + 2,
        kit: [name], verdict, delta: verdictById(verdict).delta, ratedAt: "2026-10-09T10:00:00Z"})));
      renderGear();
    });
    const text = await p.$eval("#gearsuggest", el => el.innerText);
    expect(/Perfetto/.test(text) && /warm end down/.test(text), `suggestions: "${text.slice(0, 120)}"`);
    await ctx.close();
  });

  await check("a stale tab cannot drop a ride another device added", async () => {
    const A = await page({screen: "history"}), B = await page({screen: "history"});
    const add = (x, n) => x.p.evaluate(n => recordRide({startISO: `2026-09-${n}T08:00`, place: "Sync", feel: 5, kit: []}), n);
    await add(A, "01"); await settle();
    await B.p.reload(); await B.p.waitForTimeout(500);
    await add(B, "02"); await settle();
    await add(A, "03"); await settle();
    const C = await page({screen: "history"}); await C.p.waitForTimeout(500);
    const ids = await C.p.evaluate(() => loadHistory().filter(e => e.place === "Sync").map(e => e.startISO.slice(5, 10)).sort().join(","));
    expect(ids === "09-01,09-02,09-03", `server holds ${ids}`);
    for (const x of [A, B, C]) await x.ctx.close();
  });

  await check("the app opens and reads offline, and says the forecast is a kept one", async () => {
    const {p, ctx, state} = await page();
    await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, {timeout: 5000}).catch(() => {});
    await p.reload(); await p.waitForTimeout(300);
    await read(p, {dist: 50});
    state.offline = true; await ctx.setOffline(true);
    await p.reload(); await p.waitForTimeout(500);
    const r = await read(p, {dist: 50, keepPlace: true});
    expect(r.headline != null, `nothing rendered offline; status: ${r.status}`);
    expect(/No connection/.test(r.status), `status: "${r.status}"`);
    await ctx.close();
  });

  await check("the page fits a phone: no sideways scroll at 390 px", async () => {
    const {p, ctx} = await page({width: 390});
    await read(p, {time: "07:00", dist: null, hours: 5, back: "16:00"});
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(w <= 390, `page is ${w} px wide`);
    await ctx.close();
  });
}

main().catch(e => { results.push(["harness", e]); console.error(e); })
  .finally(async () => {
    try{ if (browser) await browser.close(); }catch(e){}
    await new Promise(r => server.close(r));
    fs.rmSync(TMP, {recursive: true, force: true});
    const failed = results.filter(r => r[1]);
    console.log(`\n${results.length - failed.length} of ${results.length} UI checks passed.`);
    process.exit(failed.length ? 1 : 0);
  });
