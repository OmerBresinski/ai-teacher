import { describe, expect, test } from "bun:test";
import { diagramDisagreements, diagramWords, ratiosIn } from "./diagram-agree";

// Neutral fixtures: a two-colour counter bag drawn as a bar model.
const bag = {
  kind: "bar-model",
  alt: "Alpha has two parts and beta three, 30 counters in all.",
  title: "Alpha : beta = 2 : 3",
  bars: [
    { label: "Alpha", parts: [{ value: 1 }, { value: 1 }] },
    { label: "Beta", parts: [{ value: 1 }, { value: 1 }, { value: 1 }] },
  ],
  combined: "30 counters",
};

describe("diagram agrees with its text (round R)", () => {
  test("reads drawn words, not alt text", () => {
    expect(diagramWords(bag)).toContain("30 counters");
    expect(diagramWords(bag).join(" ")).not.toContain("in all");
  });

  test("ratios in text", () => {
    expect(ratiosIn("Alpha : beta = 1 : 4 and 2:3:5")).toEqual([
      [1, 4],
      [2, 3, 5],
    ]);
  });

  test("a diagram from another example under different questions is flagged", () => {
    const text = "Alpha : beta = 1 : 4; what fraction is alpha? Share 35 counters in 1 : 4.";
    const off = diagramDisagreements(bag, text);
    expect(off.some((p) => p.includes("ratio 2 : 3"))).toBe(true);
    expect(off.some((p) => p.includes("appear nowhere"))).toBe(true);
  });

  test("the same example, or a scaled ratio, agrees", () => {
    expect(diagramDisagreements(bag, "Alpha : beta is 2 : 3, with 30 counters.")).toEqual([]);
    expect(diagramDisagreements(bag, "Alpha : beta is 4 : 6 and 3 parts make 18.")).toEqual([]);
  });

  test("a derived value not in the text is fine when others are", () => {
    const spec = {
      kind: "bar-model",
      alt: "",
      bars: [
        { label: "Alpha", parts: [{ value: 5 }, { value: 5 }], total: "10" },
        { label: "Beta", parts: [{ value: 5 }, { value: 5 }, { value: 5 }], total: "15" },
      ],
    };
    expect(diagramDisagreements(spec, "Alpha : beta is 2 : 3 with 15 beta, so 5 a part.")).toEqual(
      [],
    );
  });

  test("silent when the text states no ratio and the diagram has under two numbers", () => {
    const spec = { kind: "cycle", alt: "", stages: [{ label: "Step 1" }, { label: "Melt" }] };
    expect(diagramDisagreements(spec, "Ice melts when warmed.")).toEqual([]);
  });

  test("unequal parts are not read as a ratio", () => {
    const spec = {
      kind: "bar-model",
      alt: "",
      bars: [
        { label: "A", parts: [{ value: 4 }, { value: 2 }] },
        { label: "B", parts: [{ value: 3 }] },
      ],
    };
    expect(diagramDisagreements(spec, "A : B = 2 : 1").some((p) => p.includes("ratio"))).toBe(
      false,
    );
  });
});
