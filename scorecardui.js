"use strict";

/* ---------------------------------------------------------------
   The model screen.

   Reads the scorecard and says what it supports, which is often less than a
   reader would like. Every figure carries the number of rides behind it, and
   every claim that cannot be made yet says so in words rather than showing a
   confident-looking zero.

   No temperature ramp in here, deliberately. Colour is data in this app and it
   means temperature; an error of +0.8° is a difference between two
   temperatures rather than a temperature, and painting it warm would say
   something untrue at a glance.
----------------------------------------------------------------*/

const pct = x => `${Math.round(x * 100)}%`;

/* Magnitudes and signed errors need different formatters, and using one for
   both was wrong in two ways at once. An average miss cannot be negative, so a
   "+" in front of it reads as a direction that does not exist. And rounding a
   signed number with Math.round is asymmetric about zero -- it takes -1.75 to
   -1.7 and +1.75 to +1.8 -- which showed the two halves of a split rounded
   opposite ways. So the magnitude is rounded first and the sign put back
   afterwards. */
const mag = v => `${Math.round(Math.abs(v) * 10) / 10}°`;
/* Signed, with the same minus sign the effect matrix uses so the two pages do
   not disagree typographically. */
const deg = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${mag(v)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* One of the three headline figures. */
const figure = (value, label, note) => `
  <div class="wx-score__cell">
    <div class="wx-score__value wx-num">${value}</div>
    <div class="wx-score__label">${label}</div>
    ${note ? `<div class="wx-score__note">${note}</div>` : ""}
  </div>`;

/* What the overall mean error is allowed to claim. Three cases, and the middle
   one is the one most pages skip: a number that exists but does not mean
   anything yet. */
function biasSentence(o){
  if (!o.enough)
    return `${plural(o.n, "rated ride")} so far. ${SCORE_MIN} is the fewest that can say
            anything at all, which is the same floor the correction itself waits for.`;
  if (!o.biased)
    return `Mean error ${deg(o.meanSigned)}, and the ride-to-ride spread is ${mag(o.sd)} —
            so this sits inside its own noise. There is no bias here worth correcting yet,
            only a number that will settle as more rides land.`;
  return `Mean error ${deg(o.meanSigned)} across ${plural(o.n, "ride")}, which clears its own
          noise (± ${mag(2 * o.se)} at two standard errors). The model
          <b>${o.bias}</b>: ${o.meanSigned > 0
            ? "it under-states ride-feel, so it dresses you warmer than the day needs"
            : "it over-states ride-feel, so it sends you out lighter than the day needs"}.`;
}

/* A split's half: a figure, or the reason there isn't one. */
function halfCell(h){
  if (!h.n) return `<td class="wx-right wx-dim">—</td>`;
  const body = h.enough
    ? `<b class="wx-num">${deg(h.meanSigned)}</b>`
    : `<span class="wx-dim wx-num">${deg(h.meanSigned)}</span>`;
  return `<td class="wx-right">${body}
    <span class="wx-score__n">${h.n}${h.enough ? "" : " — too few"}</span></td>`;
}

function splitRow(sp){
  /* The gap is the row's point, so it is said in words where it is readable
     and left alone where it is not: a number in that column with three rides
     under it would be read as a finding. */
  let verdict = `<span class="wx-dim">Not enough rides on both sides yet</span>`;
  if (sp.gap != null){
    /* The gap is the first side's mean minus the second's, so its SIGN says
       which way the model leans on the first side and not which side is worse.
       Reading it as "more error over there" got the sides the wrong way round:
       a gap of −2 on the rain row is the model reading WARM in the wet --
       sending you out too light -- not the dry rides being further out. */
    verdict = Math.abs(sp.gap) < 0.5
      ? `<span class="wx-dim">No real difference (${deg(sp.gap)})</span>`
      : `<b>${mag(sp.gap)}</b> apart — it ${sp.gap > 0 ? READS_COLD : READS_WARM}
         on ${sp.yes.label.toLowerCase()} rides
         <span class="wx-score__n">${sp.gap > 0
           ? "under-states ride-feel there, so it overdresses you"
           : "over-states ride-feel there, so it sends you out light"}</span>`;
  }
  return `
  <tr>
    <td>${sp.label}
      ${sp.unknown ? `<span class="wx-score__n">${sp.unknown} without a reading</span>` : ""}</td>
    <td class="wx-right wx-dim">${sp.yes.label}</td>${halfCell(sp.yes)}
    <td class="wx-right wx-dim">${sp.no.label}</td>${halfCell(sp.no)}
    <td>${verdict}</td>
  </tr>`;
}

/* The leave-one-out block: the only part of this page that can tell you the
   app's own correction is not worth carrying, so it says so plainly when it
   is. */
function looBlock(loo){
  if (!loo.ready){
    return `<p class="wx-note">Leaving a ride out needs one more rated ride than the
      correction itself does, so ${loo.need > 0
        ? plural(loo.need, "more rating") + " and this can run"
        : "this cannot run yet"}.
      ${loo.skipped ? `${plural(loo.skipped, "ride")} had too few others to learn from.` : ""}</p>`;
  }
  /* Two columns and they can disagree, which is worth saying out loud rather
     than picking whichever one flatters the feature. A global correction
     shifts EVERY ride, so it can shave the average miss down while knocking
     rides that were already spot on off their mark -- fewer called right, less
     error overall. Reporting only the average would hide the trade. */
  const maeBetter = loo.with.mae < loo.without.mae;
  const rightBetter = loo.with.right > loo.without.right;
  const rightWorse = loo.with.right < loo.without.right;
  const better = maeBetter && !rightWorse;
  const mixed = maeBetter && rightWorse;
  return `
  <div class="wx-scroll"><table class="wx-table">
    <thead><tr><th>On ${plural(loo.n, "ride")} it had not seen</th>
      <th class="wx-right">Average miss</th><th class="wx-right">Big misses weighted</th>
      <th class="wx-right">Would have been called right</th></tr></thead>
    <tbody>
      <tr><td>With the learned correction</td>
        <td class="wx-right wx-num">${mag(loo.with.mae)}</td>
        <td class="wx-right wx-num">${mag(loo.with.rmse)}</td>
        <td class="wx-right wx-num">${pct(loo.with.right)}</td></tr>
      <tr><td>Doing nothing at all</td>
        <td class="wx-right wx-num">${mag(loo.without.mae)}</td>
        <td class="wx-right wx-num">${mag(loo.without.rmse)}</td>
        <td class="wx-right wx-num">${pct(loo.without.right)}</td></tr>
    </tbody>
  </table></div>
  <p class="wx-note">The average miss treats every degree the same. The weighted column is
    the root-mean-square, which counts one 3° miss for more than three 1° ones — worth
    reading alongside, because a correction can lower the average while leaving the
    occasional badly wrong ride exactly where it was.</p>
  <p class="${better ? "wx-note" : "wx-alert"}">
    <b>${better ? "The correction earns its place."
        : mixed ? "The correction trades one for the other."
        : "The correction does not earn its place."}</b>
    ${better
      ? `On rides it had never seen it took ${mag(loo.gain)} off the average miss${
          rightBetter ? ` and called ${pct(loo.with.right - loo.without.right)} more of them right`
                      : ", and called the same share of them right"}.`
      : mixed
      ? `On rides it had never seen it took ${mag(loo.gain)} off the average miss, but it
         called <b>fewer</b> of them right — ${pct(loo.with.right)} against
         ${pct(loo.without.right)}. Both are true: shifting every ride by one number pulls
         the far misses in and pushes the rides that were already spot on off their mark.
         Whether that is worth it depends on which you mind more, and the honest answer is
         that on ${plural(loo.n, "ride")} there is not enough here to be sure either way.`
      : `On rides it had never seen it <b>added</b> ${mag(loo.gain)} to the average miss — so
         on this evidence the honest thing is to carry no correction at all. A mean of
         scattered ratings is worse than nothing, and what fixes that is consistency rather
         than quantity.`}
    ${loo.skipped ? `${plural(loo.skipped, "ride")} left out: too few others to learn from.` : ""}
  </p>`;
}

function wetBlock(w){
  if (!w.ready)
    return `<p class="wx-note">The separate wet correction cannot be tested yet: it needs
      enough rides in the rain that leaving one out still leaves ${SCORE_MIN}.</p>`;
  return `<p class="${w.helps ? "wx-note" : "wx-alert"}">
    <b>${w.helps ? "The wet correction earns its own place."
                 : "The wet correction is not pulling its weight."}</b>
    Across ${plural(w.n, "wet ride")}, keeping a separate number for the rain
    ${w.helps ? `beat the pooled one by ${mag(w.gain)} of average miss`
              : `came out ${mag(w.gain)} worse than the pooled one`}.</p>`;
}

function renderScorecard(){
  const list = loadHistory();
  const s = scoreRides(list);
  const o = s.overall;

  document.getElementById("scorecount").textContent =
    `${s.rated} of ${plural(s.total, "ride")} rated`;

  if (!s.rated){
    document.getElementById("scorebody").innerHTML = `
      <p class="wx-note">Nothing to score yet. Rate a ride on the History tab and this starts
      filling in: how often the model was called right, which conditions it is biased in, and
      whether the correction it learns from your ratings does any good on rides it had not
      seen.</p>`;
    return;
  }

  const maxVerdict = Math.max(...s.verdicts.map(v => v.n), 1);

  document.getElementById("scorebody").innerHTML = `
  <div class="wx-score">
    ${figure(o.hitRate == null ? "—" : pct(o.hitRate), "Called it right",
             `${o.hits} of ${o.n} rides, your verdict alone`)}
    ${figure(deg(o.meanSigned), "Mean error",
             o.biased ? o.bias : "inside the noise so far")}
    ${figure(mag(o.meanAbs), "Typical miss",
             "size of the error, direction ignored")}
  </div>

  <p class="wx-note">${biasSentence(o)}</p>

  <h3 class="wx-label" style="margin-top:var(--sp-5)">How the verdicts fell</h3>
  <div class="wx-vbars">
    ${s.verdicts.map(v => `
      <div class="wx-vbar">
        <div class="wx-vbar__label">${v.label}</div>
        <div class="wx-vbar__track">
          <span class="wx-vbar__fill${v.delta === 0 ? " is-hit" : ""}"
                style="width:${(v.n / maxVerdict) * 100}%"></span>
        </div>
        <div class="wx-vbar__n wx-num">${v.n}</div>
      </div>`).join("")}
  </div>
  <p class="wx-note">The shape matters as much as the mean. Five "about right" and nothing
    else is a different model from two too cold and three too warm, and both average to the
    same nothing.</p>

  <h3 class="wx-label" style="margin-top:var(--sp-5)">Where it is biased</h3>
  <div class="wx-scroll"><table class="wx-table">
    <!-- Plain columns rather than two colspan groups: grouped, the headings
         ran together and "The other" plus "Read" read as one phrase. -->
    <thead><tr><th>Split</th>
      <th class="wx-right">Side</th><th class="wx-right">Mean error</th>
      <th class="wx-right">Side</th><th class="wx-right">Mean error</th>
      <th>What that says</th></tr></thead>
    <tbody>${s.splits.map(splitRow).join("")}</tbody>
  </table></div>
  <p class="wx-note">Mean error per side, on the model's own thresholds — windy is what the
    outfit picker calls windy, three hours is what it calls a long ride. One number saying
    half a degree out cannot tell you it is two degrees out in the wet and right in the dry,
    which is a different problem with a different fix.</p>

  <h3 class="wx-label" style="margin-top:var(--sp-5)">Does the learned correction earn its place?</h3>
  <p class="wx-note">The correction is a mean of your ratings, so scoring it against those
    same ratings would flatter it. Instead each rated ride is set aside, the correction is
    worked out from every other one, and then applied to the ride it never saw — against the
    only baseline that matters, which is doing nothing.</p>
  ${looBlock(s.loo)}
  ${wetBlock(s.wetBranch)}

  <details class="wx-more" style="margin-top:var(--sp-5)">
    <summary>What this cannot tell you</summary>
    <p class="wx-note">Leaving one out is not a replay of your season: it does not take the
      ratings in the order they arrived, so it says whether the correction generalises, not
      whether it would have helped on any particular morning.</p>
    <p class="wx-note">Every figure rests on one rider's memory of how a ride felt, recorded
      afterwards. That is the only evidence there is for this, and it is the right evidence,
      but it is not a measurement.</p>
    <p class="wx-note">${s.corrected} of ${plural(s.rated, "rated ride")} have a recorded file
      attached, so the rest still carry whatever the speed guess got wrong inside their
      verdict. Dropping a GPX onto a ride in History moves that error out of the way.</p>
    <p class="wx-note">A side with three or four rides on it is shown greyed and labelled
      rather than hidden — but it is a hint about where to look next, not a finding.</p>
  </details>`;
}
