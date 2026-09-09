"use strict";

/* ---------------------------------------------------------------
   Does the model work?

   Everything else here argues with the model's inputs: the effect matrix shows
   every adjustment as its own line so a number can be checked against your own
   experience. The one thing the app never asked was about itself. It collected
   a verdict after every ride and then collapsed the lot into a single mean --
   the learned offset -- which is the least interesting thing that can be done
   with them.

   The ratings are a record of when the model was wrong, and in which
   direction. Read whole, they say WHERE it is biased rather than only by how
   much on average, and whether the correction it draws from them is worth
   anything at all.

   Nothing in here is a new model. It reads the rides that have been rated and
   reuses the same learnedOffset the app applies, because a scorecard that
   measures its own reimplementation of the estimator measures nothing.
----------------------------------------------------------------*/

/* Which way the sign points, and it is worth being careful about.

   A verdict of "too warm" is +2: the rider was overdressed, so the model
   predicted a colder ride than they got, so the calibration must come UP. That
   makes a POSITIVE mean error mean the model READS COLD -- it under-states
   ride-feel and over-dresses you. Getting this backwards would have the
   scorecard recommend the opposite of the fix. */
const READS_COLD = "reads cold", READS_WARM = "reads warm";
const biasWord = v => (v > 0 ? READS_COLD : READS_WARM);

/* Three rides is the floor the calibration itself uses before it will apply a
   correction, and the same floor applies to saying anything about a split of
   them: one cold morning is a story about that morning. */
const SCORE_MIN = MIN_RIDES;

/* "Called it right" is the rider saying about right, which is a delta of zero.
   For a residual -- a number the model produces rather than a verdict someone
   gave -- the equivalent is landing inside the half degree that would have
   rounded to that verdict. */
const RIGHT_BAND = 0.5;

/* mean() comes from feedback.js. These files share one global scope, and the
   scorecard reading the same average the calibration uses is the point rather
   than an accident.

   Standard deviation and the standard error of the mean. Not decoration: a
   mean error of +1.2 over four rides and the same figure over forty are
   different claims, and without the spread the page would present them as the
   same sentence. Anything inside two standard errors of zero is not evidence
   of a bias, and this says so rather than letting the reader assume. */
function spread(xs){
  if (xs.length < 2) return {sd: null, se: null};
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  return {sd, se: sd / Math.sqrt(xs.length)};
}

/* ---------------------------------------------------------------
   One ride's error.

   Two numbers, and they answer different questions. The VERDICT is what the
   rider said, and it is the only observation here; the hit rate is counted
   from it and nothing else. The EFFECTIVE delta is that verdict with the speed
   guess taken out of it -- see effectiveDelta -- and it is what the
   calibration learns from, so it is what the bias and the leave-one-out are
   measured on. Mixing the two would have the page count a speed error as a
   physiology error in one column and not in the other.
----------------------------------------------------------------*/
function rideErrors(list){
  return ratedRides(list).map(e => ({
    entry: e,
    verdict: e.delta,
    eff: effectiveDelta(e),
    // A ride with its real speed attached has one less thing wrong with it.
    corrected: !!(e.actual && e.actual.speed)
  }));
}

function summarise(errs){
  if (!errs.length) return {n: 0, hits: 0, hitRate: null, meanSigned: null, meanAbs: null,
                            sd: null, se: null, enough: false, biased: false, bias: null};
  const hits = errs.filter(x => x.verdict === 0).length;
  const effs = errs.map(x => x.eff);
  const m = mean(effs);
  const {sd, se} = spread(effs);
  // A bias worth naming has to clear its own noise.
  const biased = se != null && Math.abs(m) > 2 * se;
  return {
    n: errs.length, hits, hitRate: hits / errs.length,
    meanSigned: m, meanAbs: mean(effs.map(Math.abs)), sd, se,
    enough: errs.length >= SCORE_MIN,
    biased, bias: biased ? biasWord(m) : null
  };
}

/* ---------------------------------------------------------------
   Where it is biased.

   A single mean says the model is half a degree out; it cannot say that it is
   two degrees out in the wet and spot on in the dry, which is a different
   problem with a different fix. So the same summary runs over each half of the
   splits the model itself already treats as different cases.

   The thresholds are the model's own, deliberately. Windy is what pickOutfit
   calls windy and long is what it calls a long ride: inventing new ones here
   would measure a model nobody is running.

   A split can also say "don't know", which is not the same as false. Rides
   recorded before this scorecard existed carry no wind reading, and counting
   those as calm would invent evidence, so they are reported as uncovered
   rather than quietly binned.
----------------------------------------------------------------*/
const SPLITS = [
  {id: "wet", label: "Rain", yes: "Wet", no: "Dry",
   of: e => !!e.wet},

  {id: "cold", label: "Air temperature", yes: "5°C and below", no: "Above 5°C",
   of: e => (e.air == null ? null : e.air <= 5)},

  {id: "wind", label: "Wind", yes: "Windy", no: "Calm",
   // pickOutfit's own test, so the split matches the code it is judging.
   of: e => (e.wind == null ? null : (e.wind >= 22 || (e.gust || 0) >= 45))},

  {id: "long", label: "Length", yes: "3 h or more", no: "Under 3 h",
   of: e => (e.hours == null ? null : e.hours >= 3)},

  {id: "source", label: "Where the ride came from", yes: "Reconstructed", no: "Forecast",
   /* Not a condition -- a provenance check. The README claims a ride rebuilt
      from a recorded GPX is better evidence than a forecast one, because it
      uses measured weather and measured speed. This is where that claim can
      be read off instead of asserted. */
   of: e => !!e.reconstructed}
];

function splitScores(list){
  const errs = rideErrors(list);
  return SPLITS.map(sp => {
    const yes = [], no = [], unknown = [];
    errs.forEach(x => {
      const v = sp.of(x.entry);
      (v === null ? unknown : v ? yes : no).push(x);
    });
    return {
      id: sp.id, label: sp.label,
      yes: Object.assign({label: sp.yes}, summarise(yes)),
      no:  Object.assign({label: sp.no},  summarise(no)),
      unknown: unknown.length,
      /* The gap only means anything when both halves can support a number, and
         it is the thing actually worth reading: a model two degrees out in the
         wet and right in the dry wants a wet correction, not a bigger global
         one. */
      gap: (yes.length >= SCORE_MIN && no.length >= SCORE_MIN)
        ? mean(yes.map(x => x.eff)) - mean(no.map(x => x.eff)) : null
    };
  });
}

/* ---------------------------------------------------------------
   Leave one out: does the learned correction earn its place?

   The offset is a mean of the ratings, so scoring it against those same
   ratings is circular -- it would do well by construction. Leaving a ride out
   is the cheap honest version: work the correction out from every OTHER rated
   ride, then ask what it would have done to the one it never saw.

   Against a baseline of doing nothing, which is the question that matters. The
   correction is only worth carrying if it beats zero, and it is perfectly
   possible for a mean of five scattered ratings to be worse than no correction
   at all.

   Two things this is NOT. It is not a replay of history: it does not take the
   ratings in the order they arrived, so it says whether the estimator
   generalises rather than whether it would have helped on any particular
   morning. And rides where the correction would not have applied at all --
   fewer than MIN_RIDES others to learn from -- are left out of the comparison
   rather than scored as ties, because a tie on both sides would dilute the
   answer with rides that tested nothing.
----------------------------------------------------------------*/
function leaveOneOut(list){
  const rated = ratedRides(list);
  const scored = [], skipped = [];

  rated.forEach(e => {
    const others = list.filter(x => x !== e);
    // Ask for exactly what the app would have applied to THIS ride, wet branch
    // and all, so the wet correction is under test here too.
    const off = learnedOffset(others, {wet: !!e.wet});
    if (!off.ready){ skipped.push(e); return; }
    const eff = effectiveDelta(e);
    scored.push({entry: e, eff, off: off.value, basis: off.basis,
                 withLearning: eff - off.value, without: eff});
  });

  if (!scored.length){
    return {n: 0, skipped: skipped.length, ready: false,
            need: Math.max(0, SCORE_MIN + 1 - rated.length)};
  }

  const stat = key => {
    const rs = scored.map(s => s[key]);
    return {
      mae: mean(rs.map(Math.abs)),
      rmse: Math.sqrt(mean(rs.map(r => r * r))),
      right: rs.filter(r => Math.abs(r) < RIGHT_BAND).length / rs.length
    };
  };
  const withL = stat("withLearning"), without = stat("without");
  return {
    n: scored.length, skipped: skipped.length, ready: true,
    with: withL, without,
    // Positive means the correction took error off rides it had never seen.
    gain: without.mae - withL.mae,
    helps: withL.mae < without.mae,
    rides: scored
  };
}

/* ---------------------------------------------------------------
   And does the WET correction earn its own place?

   learnedOffset keeps a second mean for rides in the rain once there are
   enough of them, on the argument that plenty of riders run hot in the dry and
   cold in the wet and one number cannot hold both. That is a claim, and it
   checks the same way: for each wet ride, is the wet-only mean of the others
   closer to it than the pooled mean of the others?
----------------------------------------------------------------*/
function wetBranchScore(list){
  const wet = ratedRides(list).filter(e => e.wet);
  const scored = [];
  wet.forEach(e => {
    const others = list.filter(x => x !== e);
    const wetOff = learnedOffset(others, {wet: true});
    const allOff = learnedOffset(others, {wet: false});
    // Only rides where the branch actually diverges are testing anything.
    if (!wetOff.ready || !allOff.ready || wetOff.basis !== "wet") return;
    const eff = effectiveDelta(e);
    scored.push({wet: Math.abs(eff - wetOff.value), pooled: Math.abs(eff - allOff.value)});
  });
  if (!scored.length) return {n: 0, ready: false};
  const wetMae = mean(scored.map(s => s.wet)), pooledMae = mean(scored.map(s => s.pooled));
  return {n: scored.length, ready: true, wetMae, pooledMae,
          gain: pooledMae - wetMae, helps: wetMae < pooledMae};
}

/* How the verdicts fell. The shape matters as much as the mean: five "about
   right" and nothing else is a different model from two "too cold" and three
   "too warm" averaging to the same zero. */
function verdictSpread(list){
  const rated = ratedRides(list);
  return VERDICTS.map(v => ({
    id: v.id, label: v.label, delta: v.delta,
    n: rated.filter(e => e.verdict === v.id).length
  }));
}

/* The whole card, in one call. */
function scoreRides(list){
  const errs = rideErrors(list);
  return {
    overall: summarise(errs),
    rated: errs.length,
    total: list.length,
    // How much of the evidence has had its speed guess taken out of it.
    corrected: errs.filter(x => x.corrected).length,
    splits: splitScores(list),
    loo: leaveOneOut(list),
    wetBranch: wetBranchScore(list),
    verdicts: verdictSpread(list),
    offset: learnedOffset(list, {wet: false}),
    wetOffset: learnedOffset(list, {wet: true})
  };
}
