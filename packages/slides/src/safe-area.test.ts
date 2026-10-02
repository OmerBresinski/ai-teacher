import { describe, expect, test } from "bun:test";
import { materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { THEMES } from "./themes";

const meta = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };

describe("safe area", () => {
  test("every sort card sits inside the safe area, above the bottom bar, on every theme", () => {
    const spec = {
      kind: "sort" as const,
      factRefs: [],
      stem: "Put these four parts of a persuasive speech in the order a speaker would use them.",
      steps: [
        "Opening position that states the view",
        "Arguments with evidence and support",
        "Counterargument and rebuttal",
        "Conclusion and a call to action",
      ],
    };
    for (const t of THEMES) {
      const slide = materialiseSlide(spec, t.id, meta);
      const cards = slide.elements.filter((e) => e.type === "option");
      expect(cards).toHaveLength(4);
      for (const c of cards)
        expect(c.y + c.h, `${t.id} card bottom`).toBeLessThanOrEqual(SAFE_BOTTOM);
    }
  });
});
