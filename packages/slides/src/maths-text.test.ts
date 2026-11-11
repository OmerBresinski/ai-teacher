import { describe, expect, test } from "bun:test";
import type { RichDoc } from "@tj/domain/documents";
import { findFractions } from "./fractions";
import { WORKED_MATHS_NAMES } from "./maths-names";
import { EQUATION_NAMES, formulaText, mathsElement, mathText } from "./maths-text";
import { layoutTemplate } from "./templates/index";
import { WORKED_NAMES } from "./templates/worked";
import { measureHeadless } from "./text-measure";
import { getTheme } from "./themes";

const NB = " ";
const stacked = (s: string) =>
  findFractions(s, { maths: true }).map((f) => s.slice(f.start, f.end));

describe("formulaText: a formula line set as maths (NOTATION-PLAN ticket 2)", () => {
  test("each operator keeps the term after it, so a line breaks before an operator only", () => {
    expect(formulaText("speed = distance ÷ time")).toBe(`speed =${NB}distance ÷${NB}time`);
    expect(formulaText("F = m × a")).toBe(`F =${NB}m ×${NB}a`);
  });
  test("it takes the worked example's fixes: a true minus, a unit kept with its number", () => {
    expect(formulaText("x = 7 - 2")).toBe(`x =${NB}7 −${NB}2`);
    expect(formulaText("speed = 50 km/h")).toBe(`speed =${NB}50${NB}km/h`);
    expect(mathText("M_r = 18")).toBe("Mr = 18");
  });
  test("a word formula still stacks once glued, and a unit still does not", () => {
    expect(stacked(formulaText("speed = distance/time"))).toEqual(["distance/time"]);
    expect(stacked(formulaText("density = mass/volume"))).toEqual(["mass/volume"]);
    expect(stacked(formulaText("speed = 150/3"))).toEqual(["150/3"]);
    expect(stacked(formulaText("speed = 50 km/h"))).toEqual([]);
    expect(stacked(formulaText("x/4 - 3 = 2"))).toEqual(["x/4"]);
  });
});

describe("equation hero sets its formula and steps with formulaText", () => {
  const t = getTheme("studio");
  const input = {
    template: "equation-hero" as const,
    heading: "How fast is the car going?",
    lead: "A car travels 150 km in 3 hours.",
    formula: "speed = distance/time",
    points: ["speed = 150/3", "speed = 50 km/h"],
  };
  const texts = (r: ReturnType<typeof layoutTemplate>, name: string) =>
    (r.slide.elements as { name?: string }[])
      .filter((e) => e.name === name)
      .map((e) => JSON.stringify(e));
  test("the formula carries the glued, stackable text and fits", () => {
    const r = layoutTemplate(input, t, "ks3");
    expect(r.over).toEqual([]);
    expect(texts(r, "Formula")[0]).toContain(`speed =${NB}distance/time`);
    const steps = texts(r, "Step");
    expect(steps[0]).toContain(`speed =${NB}150/3`);
    expect(steps[1]).toContain(`speed =${NB}50${NB}km/h`);
  });
  test("the formula panel is measured with its fraction stacked: one line, not two", () => {
    const r = layoutTemplate(input, t, "ks3");
    const els = r.slide.elements as { name?: string; h: number }[];
    const f = els.find((e) => e.name === EQUATION_NAMES.formula);
    const slash = layoutTemplate({ ...input, formula: "x = 5" }, t, "ks3");
    const g = (slash.slide.elements as { name?: string; h: number }[]).find(
      (e) => e.name === EQUATION_NAMES.formula,
    );
    expect(f?.h).toBe(g?.h as number);
  });
  test("a step holding a stacked fraction is given the fraction's 1.6 em line", () => {
    const r = layoutTemplate(input, t, "ks3");
    const [frac, plain] = (r.slide.elements as { name?: string; h: number }[]).filter(
      (e) => e.name === EQUATION_NAMES.step,
    );
    expect((frac?.h ?? 0) - (plain?.h ?? 0)).toBeGreaterThan(0);
  });
  test("a minus written as a hyphen is set as a true minus in the formula and steps", () => {
    const r = layoutTemplate(
      { ...input, formula: "v = u - at", points: ["v = 20 - 3 × 4"] },
      t,
      "ks4",
    );
    expect(texts(r, "Formula")[0]).toContain(`v =${NB}u −${NB}at`);
    expect(texts(r, "Step")[0]).toContain(`v =${NB}20 −${NB}3 ×${NB}4`);
  });
});

describe("mathsElement: which boxes hold maths, by name", () => {
  test("a worked example's equation cells and the equation slide's formula and steps", () => {
    expect(mathsElement(WORKED_NAMES.left)).toBe(true);
    expect(mathsElement(WORKED_NAMES.right)).toBe(true);
    expect(mathsElement(EQUATION_NAMES.formula)).toBe(true);
    expect(mathsElement(EQUATION_NAMES.step)).toBe(true);
    for (const n of [
      undefined,
      "Heading",
      "Lead",
      "Point",
      WORKED_NAMES.move,
      WORKED_NAMES.check,
    ]) {
      expect(mathsElement(n)).toBe(false);
    }
  });
  test("a worked row's right cell is a maths box, and its bare fractions are found there", () => {
    const r = layoutTemplate(
      {
        template: "worked",
        heading: "Find the speed",
        vars: [],
        lines: [
          { eq: "speed = distance/time" },
          { move: "Put in the numbers", eq: "speed = 150/3" },
        ],
      },
      getTheme("studio"),
      "ks3",
    );
    const rights = (r.slide.elements as { name?: string }[]).filter((e) => mathsElement(e.name));
    expect(rights.length).toBeGreaterThanOrEqual(2);
    const all = JSON.stringify(rights);
    expect(all).toContain("distance/time");
    expect(all).toContain("150/3");
  });
  test("the ruler finds a maths box's fractions: a stacked fraction measures narrower than its slash", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "speed = distance/time" }] }],
    } as RichDoc;
    const m = measureHeadless(getTheme("paper"));
    const style = { preset: "heading" as const, fontSize: 40, fixedSize: true };
    const at = (width: number, maths: boolean) =>
      m({ doc, width, style, preset: "heading", inset: 0, chrome: 0, maths });
    const widths = Array.from({ length: 60 }, (_, i) => 150 + i * 10);
    // Never taller in a maths box, and shorter somewhere: "distance/time" stacked is one piece
    // the width of "distance", narrower than the slash text.
    for (const w of widths) expect(at(w, true)).toBeLessThanOrEqual(at(w, false));
    expect(widths.some((w) => at(w, true) < at(w, false))).toBe(true);
  });
});

test("the editor's maths names are the worked gold's own (no template import on the editor path)", () => {
  expect(WORKED_MATHS_NAMES).toEqual({ left: WORKED_NAMES.left, right: WORKED_NAMES.right });
});
