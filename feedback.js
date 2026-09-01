"use strict";

/* ---------------------------------------------------------------
   Learning from the ride.

   The rider calibration started as a single hand-set number: +3°C for "runs
   hot", decided once and never revisited. It is the most influential term in
   the whole model and the least evidenced.

   So ask, after the ride: too cold, about right, or too warm? Each answer is a
   correction to that number, and the running mean of the corrections is worth
   more than any one-off self-assessment.

   Which way the sign goes is worth being careful about. Saying "runs hot"
   RAISES the predicted ride-feel, which makes the advice lighter. So a rider
   who came home cold was over-adjusted and the number must come DOWN.
----------------------------------------------------------------*/

/* What each answer implies about the calibration, in degrees. */
const VERDICTS = [
  {id:"cold",      label:"Too cold",     delta:-2},
  {id:"bit-cold",  label:"A bit cold",   delta:-1},
  {id:"right",     label:"About right",  delta: 0},
  {id:"bit-warm",  label:"A bit warm",   delta: 1},
  {id:"warm",      label:"Too warm",     delta: 2}
];
const verdictById = id => VERDICTS.find(v => v.id === id);

/* ---------------------------------------------------------------
   The learned correction.

   Two guards, both there to stop one memorable ride rewriting the model:

     - nothing is applied until MIN_RIDES answers exist, because a single
       "too cold" says more about that day than about the rider;
     - only the most recent WINDOW answers count, so the number can follow a
       change — new jacket, fitter, a different winter — instead of being
       anchored to a season that has passed.

   Wet rides get their own correction once there is enough of them. Plenty of
   riders run hot in the dry and cold in the wet, and a single number cannot
   hold both.
----------------------------------------------------------------*/
const MIN_RIDES = 3;
const WINDOW = 20;
const CAP = 4;

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const clampCorrection = v => Math.max(-CAP, Math.min(CAP, v));

function learnedOffset(history, opts){
  const wet = !!(opts && opts.wet);
  // Only rides that have actually been rated teach anything.
  const recent = ratedRides(history).slice(-WINDOW);
  if (recent.length < MIN_RIDES) return {value: 0, n: recent.length, ready: false, basis: "all"};

  const wetOnes = recent.filter(e => e.wet);
  if (wet && wetOnes.length >= MIN_RIDES){
    return {value: clampCorrection(mean(wetOnes.map(e => e.delta))),
            n: wetOnes.length, ready: true, basis: "wet"};
  }
  return {value: clampCorrection(mean(recent.map(e => e.delta))),
          n: recent.length, ready: true, basis: "all"};
}

/* One line explaining where the number came from, for the effect matrix. */
function learnedLabel(off){
  if (!off.ready) return null;
  const rides = `${off.n} ride${off.n === 1 ? "" : "s"}`;
  return off.basis === "wet"
    ? `Learned from ${rides} in the wet`
    : `Learned from your last ${rides}`;
}
