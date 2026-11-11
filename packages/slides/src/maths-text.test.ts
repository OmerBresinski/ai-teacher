import { describe, expect, test } from "bun:test";
import { findFractions } from "./fractions";
import { formulaText, mathText } from "./maths-text";
import { layoutTemplate } from "./templates/index";
import { getTheme } from "./themes";

const NB = " ";
const stacked = (s: string) => findFractions(s).map((f) => s.slice(f.start, f.end));

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
