"use strict";

/* ---------------------------------------------------------------
   The scorecard.

   All of it is arithmetic over stored ratings, so all of it runs here. The
   browser files share one global scope rather than being modules, so they are
   evaluated into this one the same way the page would.

   What these are really guarding is the two ways a scorecard can lie: getting
   the sign backwards, so it recommends the opposite of the fix, and letting
   the leave-one-out see the ride it is scoring, so the correction comes out
   looking good by construction.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

before(() => {
  ["weather.js", "gpx.js", "gear.js", "model.js", "history.js", "feedback.js", "scorecard.js"]
    .forEach(f => vm.runInThisContext(
      fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});

/* A rated ride, as recordRide plus rateRide leave one. Only the fields the
   scorecard reads are set; anything absent is absent on purpose, because a
   ride recorded before a field existed is a case this has to handle. */
let seq = 0;
const ride = over => Object.assign({
  id: `r${++seq}`,
  startISO: "2026-01-04T07:00",
  place: "Utrecht",
  air: 8, wet: false, hours: 2, speed: 27, feel: 6,
  verdict: "right", delta: 0
}, over);

const many = (n, over) => Array.from({length: n}, () => ride(over));
const VERDICT_OF = {"-2": "cold", "-1": "bit-cold", "0": "right", "1": "bit-warm", "2": "warm"};
const rated = (n, delta, over) =>
  many(n, Object.assign({delta, verdict: VERDICT_OF[String(delta)]}, over));

/* --- The sign, which is the thing most worth pinning ------------- */

describe("which way the error points", () => {
  test("rides that came home too warm mean the model reads cold", () => {
    // "Too warm" is +2: overdressed, so the model predicted a colder ride than
    // the rider got. A scorecard with this backwards would advise the opposite
    // of the fix.
    const s = summarise(rideErrors(rated(6, 2)));
    assert.ok(s.meanSigned > 0, "mean must be positive");
    assert.equal(s.bias, "reads cold");
  });

  test("rides that came home too cold mean the model reads warm", () => {
    const s = summarise(rideErrors(rated(6, -2)));
    assert.ok(s.meanSigned < 0);
    assert.equal(s.bias, "reads warm");
  });

  test("a model that is right leaves no bias to name", () => {
    const s = summarise(rideErrors(rated(6, 0)));
    assert.equal(s.meanSigned, 0);
    assert.equal(s.hitRate, 1);
    assert.equal(s.biased, false);
    assert.equal(s.bias, null);
  });
});

/* --- What counts as a hit, and what counts as the error ---------- */

describe("hit rate and mean error measure different things", () => {
  test("the hit rate counts verdicts and only verdicts", () => {
    const list = [...rated(3, 0), ...rated(1, 2)];
    const s = summarise(rideErrors(list));
    assert.equal(s.n, 4);
    assert.equal(s.hits, 3);
    assert.equal(s.hitRate, 0.75);
  });

  test("a ride with its real speed attached moves the error, not the hit", () => {
    /* The README's own example: assume 24, ride 30, come home cold. The naive
       reading is "runs cold"; the correct one is that you rode harder and made
       your own extra headwind, so part of that chill was the guess rather than
       the rider. The error the calibration should learn from is therefore
       smaller than the verdict given -- while the verdict itself is still what
       the rider said, so the hit rate must not budge. */
    const plain = ride({delta: -2, verdict: "cold", speed: 24});
    const withActual = ride({delta: -2, verdict: "cold", speed: 24, actual: {speed: 30}});
    const a = summarise(rideErrors([plain]));
    const b = summarise(rideErrors([withActual]));
    assert.equal(a.hits, b.hits, "same verdict, same hit");
    assert.equal(a.meanSigned, -2, "the verdict alone is the whole 2 degrees");
    assert.equal(b.meanSigned, -1, "half of it was the speed guess");
    assert.equal(rideErrors([withActual])[0].corrected, true);
    assert.equal(rideErrors([plain])[0].corrected, false);
  });

  test("and the same the other way: slower than assumed, and too warm", () => {
    // Rode 24 having assumed 30, so less self-made wind than the model
    // charged, which is part of why the ride came home warm.
    const b = summarise(rideErrors([
      ride({delta: 2, verdict: "warm", speed: 30, actual: {speed: 24}})]));
    assert.equal(b.meanSigned, 1);
  });
});

/* --- Refusing to claim what the rides cannot support ------------- */

describe("what it will not say", () => {
  test("no rides, no numbers, and no crash", () => {
    const s = scoreRides([]);
    assert.equal(s.rated, 0);
    assert.equal(s.overall.hitRate, null);
    assert.equal(s.overall.enough, false);
    assert.equal(s.loo.ready, false);
    assert.equal(s.wetBranch.ready, false);
  });

  test("unrated rides are not evidence", () => {
    const s = scoreRides(many(9, {delta: null, verdict: null}));
    assert.equal(s.total, 9);
    assert.equal(s.rated, 0);
  });

  test("fewer than the calibration's own floor is not enough for a claim", () => {
    assert.equal(summarise(rideErrors(rated(2, 2))).enough, false);
    assert.equal(summarise(rideErrors(rated(3, 2))).enough, true);
  });

  test("one ride has no spread, so it cannot be a bias", () => {
    const s = summarise(rideErrors(rated(1, 2)));
    assert.equal(s.sd, null);
    assert.equal(s.se, null);
    assert.equal(s.biased, false, "a single ride is never a bias");
  });

  test("scatter that averages away is not a bias either", () => {
    // The mean is not zero, but the ratings are all over the place, so it
    // cannot clear its own noise. Naming that a bias is exactly the overclaim
    // to avoid.
    const list = [...rated(2, 2), ...rated(2, -2), ...rated(1, 1)];
    const s = summarise(rideErrors(list));
    assert.ok(Math.abs(s.meanSigned) > 0, "there is a mean");
    assert.equal(s.biased, false, "but it is inside the noise");
    assert.equal(s.bias, null);
  });

  test("the same mean, said consistently, is a bias", () => {
    const s = summarise(rideErrors(rated(8, 1)));
    assert.equal(s.meanSigned, 1);
    assert.equal(s.biased, true);
    assert.equal(s.bias, "reads cold");
  });
});

/* --- Splits ------------------------------------------------------ */

describe("where it is biased", () => {
  const byId = (splits, id) => splits.find(s => s.id === id);

  test("a model wrong only in the wet says so on the rain split", () => {
    const list = [...rated(4, -2, {wet: true}), ...rated(4, 0, {wet: false})];
    const rain = byId(splitScores(list), "wet");
    assert.equal(rain.yes.n, 4);
    assert.equal(rain.no.n, 4);
    assert.equal(rain.yes.meanSigned, -2, "wet rides came home cold");
    assert.equal(rain.no.meanSigned, 0, "dry rides were right");
    assert.equal(rain.gap, -2, "and the gap is the whole point");
  });

  test("a split needs both halves before it will name a gap", () => {
    const list = [...rated(4, -2, {wet: true}), ...rated(2, 0, {wet: false})];
    const rain = byId(splitScores(list), "wet");
    assert.equal(rain.no.n, 2);
    assert.equal(rain.no.enough, false);
    assert.equal(rain.gap, null, "two dry rides cannot anchor a comparison");
  });

  test("air temperature splits on the band edge the model already uses", () => {
    const list = [...rated(3, 0, {air: 5}), ...rated(3, 0, {air: 5.1})];
    const cold = byId(splitScores(list), "cold");
    assert.equal(cold.yes.n, 3, "5.0 counts as the cold side");
    assert.equal(cold.no.n, 3);
  });

  test("length splits at three hours, which is pickOutfit's long ride", () => {
    const list = [...rated(3, 0, {hours: 3}), ...rated(3, 0, {hours: 2.75})];
    const len = byId(splitScores(list), "long");
    assert.equal(len.yes.n, 3);
    assert.equal(len.no.n, 3);
  });

  test("a missing reading is uncovered, not calm", () => {
    /* Rides recorded before the wind was stored carry no wind. Counting them
       as calm would invent evidence and quietly poison the calm half. */
    const list = rated(5, 2);
    const wind = byId(splitScores(list), "wind");
    assert.equal(wind.unknown, 5);
    assert.equal(wind.yes.n, 0);
    assert.equal(wind.no.n, 0);
    assert.equal(wind.gap, null);
  });

  test("wind splits on pickOutfit's test once the reading is there", () => {
    const list = [
      ...rated(2, 0, {wind: 22}),            // at the threshold
      ...rated(1, 0, {wind: 10, gust: 45}),  // calm mean, gusting
      ...rated(3, 0, {wind: 21, gust: 30})
    ];
    const wind = byId(splitScores(list), "wind");
    assert.equal(wind.yes.n, 3, "22 km/h, or a 45 gust, is windy");
    assert.equal(wind.no.n, 3);
    assert.equal(wind.unknown, 0);
  });

  test("provenance is a split too, so the GPX claim can be read off", () => {
    const list = [...rated(3, 0, {reconstructed: true}), ...rated(3, 2)];
    const src = byId(splitScores(list), "source");
    assert.equal(src.yes.n, 3);
    assert.equal(src.no.n, 3);
    assert.equal(src.gap, -2);
  });
});

/* --- Leave one out ----------------------------------------------- */

describe("leave one out", () => {
  test("it cannot run until there are others to learn from", () => {
    // The correction needs MIN_RIDES rides, and leaving one out means one more.
    const s = leaveOneOut(rated(3, 2));
    assert.equal(s.ready, false);
    assert.equal(s.skipped, 3);
    assert.equal(s.need, 1);
    assert.equal(leaveOneOut(rated(4, 2)).ready, true);
  });

  test("a consistent bias is exactly what the correction is for", () => {
    const s = leaveOneOut(rated(6, 2));
    assert.equal(s.n, 6);
    assert.equal(s.without.mae, 2, "doing nothing leaves the whole 2 degrees");
    assert.ok(s.with.mae < 0.001, `learning should remove it, left ${s.with.mae}`);
    assert.equal(s.helps, true);
    assert.ok(s.gain > 1.9);
    assert.equal(s.with.right, 1, "every ride would have been called right");
    assert.equal(s.without.right, 0);
  });

  test("scatter makes the correction worse, and it says so", () => {
    /* Four ratings averaging zero. Held out one at a time, the mean of the
       others always points the wrong way, so the correction adds error instead
       of removing it. A scorecard that could not report this would be useless:
       this is the case where the honest answer is "carry nothing". */
    const list = [...rated(1, 2), ...rated(1, 1), ...rated(1, -1), ...rated(1, -2)];
    const s = leaveOneOut(list);
    assert.equal(s.n, 4);
    assert.ok(Math.abs(s.without.mae - 1.5) < 1e-9, "doing nothing averages 1.5");
    assert.ok(Math.abs(s.with.mae - 2) < 1e-9, `learning averages 2, got ${s.with.mae}`);
    assert.equal(s.helps, false);
    assert.ok(s.gain < 0, "a negative gain is a real answer");
  });

  test("the held-out ride is genuinely held out", () => {
    /* The guard against the circular version. Three rides at +2 and one at -2:
       for the odd one out, the others say +2, so the correction pushes it from
       2 degrees of error to 4. Any implementation that peeked at the ride it
       was scoring would show a much smaller error here. */
    const list = [...rated(3, 2), ...rated(1, -2)];
    const s = leaveOneOut(list);
    const odd = s.rides.find(r => r.eff === -2);
    assert.equal(odd.off, 2, "learned from the three it did not include");
    assert.equal(odd.withLearning, -4, "so it made that ride worse, and that is the truth");
    assert.ok(s.with.mae >= s.without.mae);
  });

  test("unrated rides are not scored, and not counted as skipped either", () => {
    const s = leaveOneOut([...rated(6, 2), ...many(4, {delta: null, verdict: null})]);
    assert.equal(s.n, 6);
    assert.equal(s.skipped, 0);
  });
});

/* --- The wet branch --------------------------------------------- */

describe("the wet correction", () => {
  test("earns its place when the wet rides really are different", () => {
    /* Four wet rides consistently too cold, three dry ones consistently too
       warm. Pooled, the two cancel to nothing and every ride is left wrong;
       kept apart, each is corrected properly. This is the claim feedback.js
       makes -- that one number cannot hold both -- under test. */
    const list = [...rated(4, -2, {wet: true}), ...rated(3, 2, {wet: false})];
    const s = wetBranchScore(list);
    assert.equal(s.ready, true);
    assert.equal(s.n, 4, "scored on the wet rides");
    assert.ok(s.wetMae < s.pooledMae, `${s.wetMae} should beat ${s.pooledMae}`);
    assert.equal(s.helps, true);
  });

  test("it says nothing until the branch would actually have split", () => {
    // Two wet rides: leave one out and only one is left, which is under the
    // floor, so the app would use the pooled number and there is nothing here
    // to compare.
    const s = wetBranchScore([...rated(2, -2, {wet: true}), ...rated(4, 2)]);
    assert.equal(s.ready, false);
    assert.equal(s.n, 0);
  });
});

/* --- The card as a whole ---------------------------------------- */

describe("scoreRides", () => {
  test("the verdict spread accounts for every rated ride and no others", () => {
    const list = [...rated(2, 0), ...rated(3, -1), ...rated(1, 2),
                  ...many(4, {delta: null, verdict: null})];
    const s = scoreRides(list);
    assert.equal(s.verdicts.reduce((a, v) => a + v.n, 0), 6);
    assert.equal(s.verdicts.find(v => v.id === "right").n, 2);
    assert.equal(s.verdicts.find(v => v.id === "bit-cold").n, 3);
    assert.equal(s.verdicts.find(v => v.id === "warm").n, 1);
  });

  test("it reports the same offset the app would apply, not its own", () => {
    // The whole point of reusing learnedOffset: a scorecard grading a copy of
    // the estimator grades the wrong thing.
    const list = rated(6, 2);
    const s = scoreRides(list);
    assert.deepEqual(s.offset, learnedOffset(list, {wet: false}));
  });

  test("it counts how much of the evidence has had the speed guess removed", () => {
    const list = [...rated(2, 2, {actual: {speed: 30}}), ...rated(3, 2)];
    assert.equal(scoreRides(list).corrected, 2);
  });
});
