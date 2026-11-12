import { describe, expect, test } from "bun:test";
import type { RichDoc } from "@tj/domain/documents";
import { docFromText } from "../model/factories";
import { findFractions } from "./fractions";
import { serializeDoc } from "./serialize";
import { docToPlainText, renderDocHTML } from "./static";

/** The fractions `findFractions` stacks, as the text they cover. */
const stacked = (s: string) => findFractions(s).map((f) => s.slice(f.start, f.end));

describe("findFractions: maths fractions are found", () => {
  test.each([
    ["Solve x/4 + 3 = 8", ["x/4"]],
    ["x/4 + 6 = 17", ["x/4"]],
    ["Solve x/3 + 2 = 7", ["x/3"]],
    ["x/4 = 5", ["x/4"]],
    ["x/4", ["x/4"]],
    ["3x/5 − 1 = 8", ["3x/5"]],
    ["(x + 2)/3 = 5", ["(x + 2)/3"]],
    ["Solve (x + 2)/3 = 4.", ["(x + 2)/3"]],
    ["x = 20/4", ["20/4"]],
    ["1/2 + 1/4 = 3/4", ["1/2", "1/4", "3/4"]],
    ["Find 3/4 of 20", ["3/4"]],
    ["What is 2/5 of x?", ["2/5"]],
    ["v = d/t", ["d/t"]],
    ["y/(x + 1) = 2", ["y/(x + 1)"]],
    ["x²/4 = 9", ["x²/4"]],
    ["−x/4 = 2", ["x/4"]],
    ["x/4 - 3 = 2", ["x/4"]],
    ["Multiply both sides by 4: x/4 × 4 = 5 × 4", ["x/4"]],
  ])("%p stacks %p", (text, want) => {
    expect(stacked(text)).toEqual(want);
  });
});

describe("findFractions: anything not certainly maths stays a slash", () => {
  test.each([
    ["The Great Fire began on 2/9/1666"],
    ["12/09/1666 = the date"],
    ["Use and/or in your answer"],
    ["Open https://example.com/3 + more"],
    ["see bbc.co.uk/4 = news"],
    ["Mix in the ratio 3:4"],
    ["The car travels at 60 km/h"],
    ["Speed = 5 m/s + 2 m/s"],
    ["Density in g/cm³ = mass ÷ volume"],
    ["The shop is open 24/7"],
    ["A 50/50 chance"],
    ["9/11 changed air travel"],
    ["Run an A/B test"],
    ["Half price: 1/2-price sale"],
    ["Divide x/4 by two"],
    ["Use the w/o form"],
  ])("%p", (text) => {
    expect(stacked(text)).toEqual([]);
  });
});

describe("findFractions: a mixed number stacks its fraction (answers, sheets, worked rows)", () => {
  test.each([
    ["10 1/2", ["1/2"]],
    ["6 4/5 m", ["4/5"]],
    ["14 ÷ 4 × 3 = 10 1/2", ["1/2"]],
    ["13 − 13 ÷ 5 × 2 − 1 = 6 4/5 m", ["4/5"]],
    ["Each part is 2 1/2.", ["1/2"]],
    ["She ran 3 3/4 km.", ["3/4"]],
    ["2 1/2 and 1 3/4", ["1/2", "3/4"]],
    ["10\u00A01/2", ["1/2"]],
    ["(7 1/2)", ["1/2"]],
  ])("%p stacks %p", (text, want) => {
    expect(stacked(text)).toEqual(want);
  });

  test.each([
    ["The shop is open 24/7"],
    ["Open 7 24/7"],
    ["A 50/50 chance"],
    ["In 2001 9/11 changed air travel"],
    ["Speed: 5 m/s"],
    ["It moved at 3 km/h"],
    ["Score 3 4/4"],
    ["Version 2.5 1/2"],
    ["Pages 1,000 1/2"],
    ["Date 12/3 1/2"],
  ])("%p stays a slash", (text) => {
    expect(stacked(text)).toEqual([]);
  });
});

/** The fractions found in a maths box (a worked equation cell, the equation slide's formula). */
const stackedMaths = (s: string) =>
  findFractions(s, { maths: true }).map((f) => s.slice(f.start, f.end));

describe("findFractions: a word side stacks only in a maths box (NOTATION-PLAN ticket 1)", () => {
  test.each([
    ["Use and/or in your answer"],
    ["and/or"],
    ["The answer = yes/no"],
    ["colour = red/blue"],
    ["speed = distance/time"],
    ["density = mass/volume"],
    ["Mark each one true/false"],
    ["Input/output = data"],
    ["speed = km/h"],
    ["Density in g/cm³ = mass ÷ volume"],
    ["Visit bbc.co.uk/bitesize = revision"],
    ["https://example.com/speed = fast"],
    ["distance/time"],
    ["150/3"],
    ["24/7"],
  ])("%p outside a maths box stays a slash", (text) => {
    expect(stacked(text)).toEqual([]);
  });

  test.each([
    ["distance/time", ["distance/time"]],
    ["150/3", ["150/3"]],
    ["speed = distance/time", ["distance/time"]],
    ["Speed = distance/time.", ["distance/time"]],
    ["density = mass/volume", ["mass/volume"]],
    ["pressure = force/area", ["force/area"]],
    ["n = m/Mr", ["m/Mr"]],
    ["efficiency = useful/total × 100", ["useful/total"]],
    ["speed =\u00A0distance/time", ["distance/time"]],
    ["x/4 + 3 = 8", ["x/4"]],
    ["speed = (distance travelled)/(time taken)", ["(distance travelled)/(time taken)"]],
  ])("%p in a maths box stacks %p", (text, want) => {
    expect(stackedMaths(text)).toEqual(want);
  });

  test.each([
    ["km/h"],
    ["50 km/h"],
    ["speed = 50 km/h"],
    ["g/cm³"],
    ["J/kg"],
    ["and/or"],
    ["true/false"],
    ["On 2/9/1666"],
    ["bbc.co.uk/bitesize"],
  ])("%p in a maths box still stays a slash (unit, prose pair, date, address)", (text) => {
    expect(stackedMaths(text)).toEqual([]);
  });
});

describe("renderDocHTML in a maths box", () => {
  test("a bare 150/3 stacks only when the box is maths; the plain render is unchanged", () => {
    const d = docFromText("150/3");
    expect(renderDocHTML(d)).toBe("<p>150/3</p>");
    expect(renderDocHTML(d, { maths: true })).toContain('<span class="td-frac">');
    expect(renderDocHTML(d)).toBe("<p>150/3</p>");
  });
});

const p = (...content: unknown[]) => ({ type: "paragraph", content });
const t = (text: string, marks?: unknown[]) => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const math = (color?: string) => ({
  type: "textStyle",
  attrs: { font: "math", ...(color ? { color } : {}) },
});
const doc = (...content: unknown[]) => ({ type: "doc", content }) as RichDoc;

describe("renderDocHTML sets a maths fraction stacked", () => {
  test("a heading's fraction is numerator over denominator, the slash kept for reading", () => {
    expect(renderDocHTML(docFromText("Solve x/4 + 3 = 8"))).toBe(
      '<p>Solve <span class="td-frac"><span class="td-frac-num">x</span>' +
        '<span class="td-frac-sr">/</span><span class="td-frac-den">4</span></span>' +
        " + 3 = 8</p>",
    );
  });

  test("a mixed number keeps its whole part inline and stacks its fraction (an answer, a sheet key)", () => {
    expect(renderDocHTML(doc(p(t("6 4/5 m"))))).toBe(
      '<p>6 <span class="td-frac"><span class="td-frac-num">4</span>' +
        '<span class="td-frac-sr">/</span><span class="td-frac-den">5</span></span> m</p>',
    );
  });

  test("a math-marked variable keeps its face inside the numerator (a worked heading's runs)", () => {
    const html = renderDocHTML(doc(p(t("Solve "), t("x", [math()]), t("/4 + 3 = 8"))));
    expect(html).toContain(
      '<span class="td-frac-num"><span data-font="math">x</span></span>' +
        '<span class="td-frac-sr">/</span><span class="td-frac-den">4</span>',
    );
  });

  test("a fraction all in one colour draws its bar in that colour", () => {
    const red = "#c0392b";
    const html = renderDocHTML(
      doc(p(t("x", [math(red)]), t("/4", [{ type: "textStyle", attrs: { color: red } }]))),
    );
    expect(html).toStartWith(`<p><span class="td-frac" style="color: ${red};">`);
  });

  test("marks close before the fraction and reopen in each part", () => {
    const html = renderDocHTML(doc(p(t("Solve 3/4 of 20", [{ type: "bold" }]))));
    expect(html).toBe(
      '<p><strong>Solve </strong><span class="td-frac"><span class="td-frac-num">' +
        '<strong>3</strong></span><span class="td-frac-sr">/</span>' +
        '<span class="td-frac-den"><strong>4</strong></span></span><strong> of 20</strong></p>',
    );
  });

  test("the text is unchanged: plain text and the stored doc still read x/4", () => {
    const d = docFromText("Solve x/4 + 3 = 8");
    renderDocHTML(d);
    expect(docToPlainText(d)).toBe("Solve x/4 + 3 = 8");
    const el = document.createElement("div");
    el.innerHTML = renderDocHTML(d);
    expect(el.textContent).toBe("Solve x/4 + 3 = 8");
  });

  test("a date, a unit and prose render as before, byte for byte", () => {
    for (const s of ["On 2/9/1666 the fire began", "60 km/h", "and/or", "Open 24/7"]) {
      expect(renderDocHTML(docFromText(s))).toBe(serializeDoc(docFromText(s)));
    }
  });

  test("a bracketed numerator drops its brackets from view and keeps them for reading", () => {
    const html = renderDocHTML(docFromText("(x + 2)/3 = 4"));
    expect(html).toContain(
      '<span class="td-frac-num"><span class="td-frac-sr">(</span>x + 2' +
        '<span class="td-frac-sr">)</span></span>',
    );
    const el = document.createElement("div");
    el.innerHTML = html;
    expect(el.textContent).toBe("(x + 2)/3 = 4");
  });

  test("the Tiptap parity path (no option) never stacks", () => {
    expect(serializeDoc(docFromText("x/4 = 5"))).toBe("<p>x/4 = 5</p>");
  });

  test("lists and hard breaks: each paragraph is read on its own", () => {
    const html = renderDocHTML(
      doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("x/2 = 3"))] }] }),
    );
    expect(html).toContain('<li><p><span class="td-frac">');
    const br = renderDocHTML(doc(p(t("x/4"), { type: "hardBreak" }, t("= 5"))));
    expect(br).toContain('<span class="td-frac-den">4</span></span><br>= 5');
  });
});
