import { describe, expect, test } from "bun:test";
import type { RichDoc, TextPreset } from "@tj/domain/documents";
import { FRACTION_TALL_EM, fractionTall, fractionWidthEm, shownSide } from "./fractions";
import { countLines, measureHeadless } from "./text-measure";
import { getTheme } from "./themes";

/*
 * The headless ruler measures a stacked fraction as the renderer sets it (`@tj/editor`
 * `slide.css` `.td-frac`): one piece as wide as its wider side, and in running text a line 1.6em
 * tall wherever one sits, so a fit made here neither overflows nor clips in the browser.
 */

const paper = getTheme("paper");
const doc = (...paras: string[]): RichDoc =>
  ({
    type: "doc",
    content: paras.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  }) as RichDoc;
const height = (d: RichDoc, preset: TextPreset, width = 2000, lineHeight = 1.4, fontSize = 25) =>
  measureHeadless(paper)({
    doc: d,
    width,
    style: { preset, lineHeight, fontSize, fixedSize: true },
    preset,
    inset: 0,
    chrome: 0,
  });

describe("which type sets its fractions tall", () => {
  test("running text is tall; display type (and a worked example's heading-preset maths) is not", () => {
    expect(["body", "small", "caption"].map((p) => fractionTall(p as TextPreset))).toEqual([
      true,
      true,
      true,
    ]);
    expect(["title", "subtitle", "heading"].map((p) => fractionTall(p as TextPreset))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("measureHeadless and stacked fractions", () => {
  test("a body line holding a fraction is 1.6em tall, one without stays at its leading", () => {
    const plain = height(doc("Solve x + 2 = 7"), "body");
    expect(plain).toBeCloseTo(25 * 1.4, 5);
    expect(height(doc("Solve x/3 + 2 = 7"), "body")).toBeCloseTo(25 * FRACTION_TALL_EM, 5);
    // Two fractions on one line still add one line's growth.
    expect(height(doc("1/2 + 1/4 = 3/4"), "body")).toBeCloseTo(25 * FRACTION_TALL_EM, 5);
    // Four question rows, each one paragraph with a fraction: four tall lines and three gaps.
    const four = doc("Solve x/3 + 2 = 7", "Solve x/5 = 4", "Find 3/4 of 20", "Solve (x + 1)/2 = 3");
    expect(height(four, "body")).toBeCloseTo(4 * 25 * FRACTION_TALL_EM + 3 * 0.35 * 25, 5);
  });

  test("a leading already 1.6 or more takes no extra", () => {
    expect(height(doc("Solve x/3 + 2 = 7"), "body", 2000, 1.7)).toBeCloseTo(25 * 1.7, 5);
  });

  test("display type keeps its fraction inside the line: a heading's height does not change", () => {
    expect(height(doc("Solve x/4 + 3 = 8"), "heading", 2000, 1.12, 45)).toBeCloseTo(45 * 1.12, 5);
  });

  test("a date, a unit or prose with a slash measures as before", () => {
    for (const s of ["On 2/9/1666 the fire began", "60 km/h", "and/or", "Open 24/7"]) {
      expect(height(doc(s), "body")).toBeCloseTo(25 * 1.4, 5);
    }
  });

  test("a fraction is measured as wide as its wider side, so it wraps later than its slash text", () => {
    // Long enough to wrap: the stacked fractions take less room than "x/12", "y/12" set flat.
    const flat = "Solve x÷12 + y÷12 + z÷12 + w÷12 + v÷12 = 10 and then check";
    const stacked = "Solve x/12 + y/12 + z/12 + w/12 + v/12 = 10 and then check";
    const w = [200, 260, 320, 380, 440, 500];
    const lines = (s: string) => w.map((x) => countLines(s, "body", paper, x));
    lines(stacked).forEach((n, i) => {
      expect(n).toBeLessThanOrEqual(lines(flat)[i] as number);
    });
    expect(fractionWidthEm(1, 0.5, true)).toBeCloseTo(0.8 + 2 * 0.12 * 0.8 + 0.12, 5);
    expect(shownSide("(x + 2)/3", 0, 7)).toEqual([1, 6]);
    expect(shownSide("x/3", 0, 1)).toEqual([0, 1]);
  });
});
