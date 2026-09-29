import { describe, expect, test } from "bun:test";
import { contentProjection, fitsPlanned, workedExampleProjection } from "./slide-capacity";

// The plants lesson (29 Sep diagnosis): its worked example overran every theme with four steps,
// two of them wrapping, and fitted with three.
const problem = "Suppose a dandelion grows beside a path. How could its seeds reach a new place?";
describe("fitsPlanned", () => {
  test("a worked example with steps that wrap does not fit; one-line steps do", () => {
    const long = [
      "The dandelion makes lightweight seeds with feathery parts.",
      "Wind catches the feathery parts and carries the seeds away from the parent plant.",
      "A seed may land on soil in a new place, where it could grow if conditions are suitable.",
      "The new plant grows away from its parent, with more light and water for itself.",
    ];
    expect(fitsPlanned(workedExampleProjection(problem, long))).toBe(false);
    const short = [
      "Seeds have feathery parts.",
      "Wind carries them away.",
      "They land on new soil.",
    ];
    expect(fitsPlanned(workedExampleProjection(problem, short))).toBe(true);
  });
  test("more than four steps never fit", () => {
    expect(fitsPlanned(workedExampleProjection("2 + 2?", ["a", "b", "c", "d", "e"]))).toBe(false);
  });
  test("a short idea fits with a callout; a long pair has no room for one", () => {
    const idea = {
      statement: "Roots hold a plant in the ground.",
      explanation: "Roots take in water and minerals from the soil.",
    };
    expect(
      fitsPlanned(
        contentProjection([idea], { kind: "watch-out", text: "Some think roots eat soil." }),
      ),
    ).toBe(true);
    const long = { statement: "A long idea.", explanation: "x ".repeat(190).trim() };
    expect(
      fitsPlanned(contentProjection([long, long], { kind: "watch-out", text: "Some think so." })),
    ).toBe(false);
  });
});
