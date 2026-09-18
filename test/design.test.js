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
