// libfix2: a fill that makes a model leave out what it asked for is refused, a mixed-shape fractions
// intent is refused, and the label size a crop shows at in its slot.
import { describe, expect, test } from "bun:test";
import { capabilityRefusals, checkParams } from "./lib";
import { shownPt } from "./librender";

const y2s3 = {
  operation: "show",
  representation: "rectangle",
  fractions: [{ value: "1/2" }, { value: "1/4" }],
  words: true,
};

describe("libfix2", () => {
  test("fractions 'show' with two fractions draws only one: refused in the model's words", async () => {
    const c = await checkParams("fractions", y2s3);
    expect(c.params).toBeUndefined();
    expect(c.refusals.map((r) => r.reason).join(" ")).toContain("only the first one is shown");
  });
  test("'compare' with the same two fractions draws both: passes", async () => {
    const c = await checkParams("fractions", { ...y2s3, operation: "compare" });
    expect(c.params).toBeDefined();
  });
  test("a square and a circle in one fractions picture is a capability refusal", () => {
    expect(
      capabilityRefusals("fractions", "Show square A cut in two, and circle B cut into four."),
    ).toHaveLength(1);
    expect(
      capabilityRefusals(
        "fractions",
        "Show two identical rectangles, one in halves, one in quarters.",
      ),
    ).toHaveLength(0);
  });
  test("shown label size: contain fit of the crop in the slot", () => {
    expect(shownPt({ w: 1108, h: 474, minFs: 40 }, { w: 348, h: 284 })).toBeCloseTo(12.56, 1);
    expect(shownPt({ w: 400, h: 400, minFs: 30 }, { w: 348, h: 284 })).toBeCloseTo(21.3, 1);
  });
});
