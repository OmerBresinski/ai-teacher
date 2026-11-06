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
