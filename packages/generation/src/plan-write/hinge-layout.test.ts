import { describe, expect, test } from "bun:test";
import { adapt } from "./simple";

/*
 * Ruling 161 (Greg, 5 Oct 2026): code, not the planner, sets a hinge out. Short options sit in a
 * 2×2 grid at body size; options too long for half the width (two lines at body size) take a
 * single column.
 */
const hinge = (items: string[]) =>
  adapt({
    form: "hinge",
    heading: "Check",
    body: [],
    items,
    questions: [
      { question: "Which explanation best links printing money to hyperinflation?", answer: "B" },
    ],
    picture: null,
    notes: "",
  });

describe("the hinge's layout comes from its options' measured length (ruling 161)", () => {
  test("short options: the 2×2 grid", () => {
    expect(hinge(["Coal", "More money", "Fewer goods", "Lower tax"]).layout).toBe("default");
  });
  test("long options: one column", () => {
    const long =
      "Printing more money while output fell meant more marks chased fewer goods, so prices rose";
    expect(hinge([long, long, long, long]).layout).toBe("stacked");
  });
});
