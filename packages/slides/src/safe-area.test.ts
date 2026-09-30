import { describe, expect, test } from "bun:test";
import { fitSlide } from "./fit-slide";
import { materialiseSlide } from "./materialise";
import { SAFE_BOTTOM } from "./metrics";
import { THEMES } from "./themes";

const meta = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };

describe("safe area (layout audit round 2)", () => {
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

  const mcq = (options: string[]) => ({
    kind: "multiple-choice" as const,
    factRefs: [],
    stem: "Which statement explains why solid lead bromide does not conduct?",
    options: options.map((text, i) => ({ text, correct: i === 0 })),
  });
  test("short options keep the 2x2 grid; options that wrap in it switch to full-width rows that fit", () => {
    const short = mcq(["Cu²⁺", "SO₄²⁻", "OH⁻", "Cl⁻"]);
    const long = mcq([
      "Its ions are fixed and cannot move freely",
      "It has no ions because it is covalent",
      "Its electrons are blocked by bromide ions",
      "The electrodes cannot touch a solid",
    ]);
    for (const t of THEMES) {
      const grid = materialiseSlide(short, t.id, meta).elements.filter((e) => e.type === "option");
      expect(new Set(grid.map((o) => o.x)).size, `${t.id} grid columns`).toBe(2);
      const slide = materialiseSlide(long, t.id, meta);
      const rows = slide.elements.filter((e) => e.type === "option");
      expect(new Set(rows.map((o) => o.x)).size, `${t.id} one column`).toBe(1);
      expect(fitSlide(slide, t).overflow, `${t.id} overflow`).toEqual([]);
      for (const r of rows)
        expect(r.y + r.h, `${t.id} row bottom`).toBeLessThanOrEqual(SAFE_BOTTOM);
    }
  });
});
