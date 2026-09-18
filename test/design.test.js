"use strict";

/* ---------------------------------------------------------------
   The parts of the interface a test can hold to account: that the scale
   under the ride-feel figure is labelled where its values actually are,
   that glove mode reaches every piece of text, and that secondary text is
   readable in both themes. Read from the stylesheet and the model as text,
   because the browser is not here.
----------------------------------------------------------------*/

const {test, describe, before} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

before(() => {
  ["weather.js", "gpx.js", "gear.js", "model.js"].forEach(f =>
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), {filename: f}));
});

/* --- 1. The scale ------------------------------------------------- */

describe("the scale under the ride-feel figure", () => {
  test("every label sits at the position of its own value", () => {
    const html = scaleMarkup();
    const labels = [...html.matchAll(/left:\s*([\d.]+)%[^>]*>(−?\d+)/g)];
    assert.ok(labels.length >= 4, `found ${labels.length} positioned labels`);
    for (const [, left, text] of labels){
      const v = +text.replace("−", "-");
      assert.ok(Math.abs(+left - rampPos(v)) < 0.1,
        `${v}° is drawn at ${left}% but the marker for ${v}° lands at ${rampPos(v).toFixed(1)}%`);
    }
  });

  test("a reading of 25° lines up with the 25° label", () => {
    const m = scaleMarkup().match(/left:\s*([\d.]+)%[^>]*>25/);
    assert.ok(m, "there is a 25° label");
    assert.ok(Math.abs(+m[1] - rampPos(25)) < 0.1);
  });
});

/* --- 2. Glove mode ------------------------------------------------ */

describe("glove mode reaches every piece of text", () => {
  test("no text is sized in fixed small units that glove mode cannot enlarge", () => {
    // Fixed sizes under the smallest token are the ones glove mode used to miss.
    const fixed = [...CSS.matchAll(/font-size:\s*(\.?\d*\.?\d+)rem/g)]
      .map(m => +m[1]).filter(v => v < 0.78);
    assert.deepEqual(fixed, [],
      `${fixed.length} sizes are fixed in rem and will not grow in glove mode`);
  });

  test("glove mode enlarges the small type tokens", () => {
    const glove = CSS.match(/\[data-touch="gloves"\]\s*\{([^}]*)\}/);
    assert.ok(glove, "a glove-mode token block exists");
    for (const t of ["--step--2", "--step--3"]){
      const base = CSS.match(new RegExp(`:root\\s*\\{[^}]*${t}:\\s*([\\d.]+)rem`));
      assert.ok(base, `${t} is defined as a token`);
      const big = glove[1].match(new RegExp(`${t}:\\s*([\\d.]+)rem`));
      assert.ok(big, `glove mode sets ${t}`);
      assert.ok(+big[1] > +base[1], `${t} grows in glove mode (${base[1]} → ${big[1]})`);
    }
  });
});

/* --- 3. Contrast -------------------------------------------------- */

function luminance(hex){
  const c = hex.replace("#", "").match(/../g).map(h => parseInt(h, 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function tokens(block){
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) out[m[1]] = m[2];
  return out;
}

describe("secondary text is readable", () => {
  const blocks = {
    "light, chosen": CSS.match(/\[data-theme="light"\]\s*\{([^}]*)\}/)[1],
    "light, from the system": CSS.match(/@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/)[1],
    "dark": CSS.match(/:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/)[1]
  };
  for (const [name, block] of Object.entries(blocks)){
    test(`${name}: dim text passes 4.5:1 on every surface it sits on`, () => {
      const t = tokens(block);
      for (const ground of ["--bg", "--surface", "--surface-2"]){
        const r = contrast(t["--text-dim"], t[ground]);
        assert.ok(r >= 4.5, `${t["--text-dim"]} on ${ground} ${t[ground]} is ${r.toFixed(2)}:1`);
      }
    });
  }

  test("the two light definitions agree", () => {
    assert.deepEqual(tokens(blocks["light, chosen"]), tokens(blocks["light, from the system"]));
  });
});

/* --- Temperature colour as text ----------------------------------

   The ramp was drawn for a dark background. On the light one, cool, mild,
   warm and hot measured 2.0-2.6:1 -- the ride-feel figure for almost every
   ride. Text now uses an "ink" of each band, darkened in light mode and
   lightened where needed in dark, while bars and edges keep the ramp itself. */

const BANDS = ["frozen", "cold", "cool", "mild", "warm", "hot", "baking"];
const themeBlocks = () => ({
  dark: CSS.match(/:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/)[1],
  light: CSS.match(/\[data-theme="light"\]\s*\{([^}]*)\}/)[1]
});

// OKLab, for "do these two colours look different" rather than contrast.
function oklab(hex){
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hex.replace("#", "").match(/../g).map(h => lin(parseInt(h, 16)));
  const l = Math.cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  const m = Math.cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  const s = Math.cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return [.2104542553*l + .793617785*m - .0040720468*s,
          1.9779984951*l - 2.428592205*m + .4505937099*s,
          .0259040371*l + .7827717662*m - .808675766*s];
}
const dE = (a, b) => { const p = oklab(a), q = oklab(b);
  return 100 * Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]); };

describe("temperature colour used as text", () => {
  for (const [theme, block] of Object.entries(themeBlocks())){
    test(`${theme}: every band's ink reads at 4.5:1 on every surface`, () => {
      const t = tokens(block);
      for (const band of BANDS){
        const ink = t[`--t-${band}-ink`];
        assert.ok(ink, `--t-${band}-ink is defined for ${theme}`);
        for (const ground of ["--bg", "--surface", "--surface-2"]){
          const r = contrast(ink, t[ground]);
          assert.ok(r >= 4.5, `${band} ink ${ink} on ${ground} is ${r.toFixed(2)}:1`);
        }
      }
    });
  }

  test("text is never coloured with the raw ramp", () => {
    // border-color, accent-color and the like are not text, hence the lookbehind.
    const raw = CSS.match(/(?<![-\w])color:\s*var\(--temp\)/g) || [];
    assert.equal(raw.length, 0, `${raw.length} text rules still use var(--temp)`);
  });

  test("every temperature class sets its ink alongside its colour", () => {
    for (const band of BANDS){
      const rule = CSS.match(new RegExp(`\\.t-${band}\\s*\\{([^}]*)\\}`));
      assert.ok(rule && rule[1].includes(`--temp-ink: var(--t-${band}-ink)`), `.t-${band} sets --temp-ink`);
    }
  });
});

/* --- Warnings ----------------------------------------------------- */

describe("the warning colour", () => {
  for (const [theme, block] of Object.entries(themeBlocks())){
    test(`${theme}: readable, and clearly not a temperature`, () => {
      const t = tokens(block);
      assert.ok(t["--signal"], `--signal is defined for ${theme}`);
      for (const ground of ["--bg", "--surface", "--surface-2"])
        assert.ok(contrast(t["--signal"], t[ground]) >= 4.5,
          `${t["--signal"]} on ${ground} is ${contrast(t["--signal"], t[ground]).toFixed(2)}:1`);
      // The old red sat 4 units from "baking": a warning on a hot day read as
      // part of the scale.
      for (const band of ["baking", "hot"])
        assert.ok(dE(t["--signal"], t[`--t-${band}-ink`]) >= 10,
          `signal is only ${dE(t["--signal"], t[`--t-${band}-ink`]).toFixed(1)} from ${band}`);
    });
  }
});

/* --- Controls ----------------------------------------------------- */

describe("controls do not borrow a temperature", () => {
  // With no reading, --temp defaults to "mild", which painted every primary
  // button, selected choice and tab underline khaki: a temperature the app
  // was not reporting.
  const rule = sel => {
    const m = CSS.match(new RegExp(sel.replace(/[.[\]"=()]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
    assert.ok(m, `rule ${sel} exists`);
    return m[1];
  };
  for (const sel of [".wx-btn--primary", ".wx-btn--primary:hover",
                     '.wx-choice .wx-chip[aria-pressed="true"]', '.wx-tab[aria-pressed="true"]']){
    test(`${sel} is neutral`, () => {
      assert.ok(!/var\(--temp/.test(rule(sel)), `${sel} still uses the temperature colour`);
    });
  }
});

/* --- The mark ----------------------------------------------------- */

describe("the logo", () => {
  before(() => {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "logo.js"), "utf8"),
      {filename: "logo.js"});
  });

  test("seven arcs, in ramp order, sweeping a dial that is open at the bottom", () => {
    const arcs = logoArcs();
    assert.deepEqual(arcs.map(a => a.band), BANDS);
    assert.equal(arcs[0].from, -135, "starts at the bottom left");
    assert.equal(arcs[arcs.length - 1].to, 135, "ends at the bottom right");
    for (let i = 1; i < arcs.length; i++)
      assert.ok(arcs[i].from >= arcs[i - 1].to, "arcs run clockwise without overlapping");
  });

  test("the header mark follows the theme; the favicon carries the same colours as hex", () => {
    const header = logoMarkup("header"), icon = logoMarkup("favicon");
    for (const band of BANDS) assert.ok(header.includes(`var(--t-${band})`), `header uses --t-${band}`);
    assert.ok(!/var\(/.test(icon), "a favicon cannot resolve CSS variables");
    const root = CSS.match(/:root\s*\{([^}]*)\}/)[1];
    const order = BANDS.map(b => root.match(new RegExp(`--t-${b}:\\s*(#[0-9A-Fa-f]{6})`))[1].toUpperCase());
    const inIcon = [...icon.matchAll(/stroke="(#[0-9A-Fa-f]{6})"/g)].map(m => m[1].toUpperCase())
      .filter(h => order.includes(h));
    assert.deepEqual(inIcon, order, "favicon arcs are the stylesheet's ramp, in order");
  });

  test("both marks are drawn by one function, so they cannot drift apart", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    assert.ok(!/<circle[^>]*stroke-dasharray/.test(html), "no hand-drawn copy left in the page");
    assert.ok(!/rel="icon"\s+href=['"]data:image\/svg/.test(html), "no hand-drawn favicon left");
  });
});
