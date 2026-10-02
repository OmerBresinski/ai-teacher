import { describe, expect, test } from "bun:test";
import { parsePlan } from "../prompts/plan-lesson";
import { checkPlan } from "./check";
import {
  chunkExtras,
  chunkOf,
  chunkPrompt,
  crossChunkCheck,
  rowsFrom,
  type Spine,
  spinePrompt,
  spineSchema,
} from "./lab-chunks";
import { decideStructure, stubEvaluator } from "./lab-structure";
import { planMenu } from "./menu";

const spine = (k: number): Spine => ({
  objectives: Array.from({ length: k }, (_, i) => `Explain idea ${i + 1}`),
  cycles: Array.from({ length: k }, (_, i) => ({ covers: `idea ${i + 1} and its case` })),
  misconception:
    "Hyperinflation was caused only by printing money; reparations and the Ruhr mattered.",
  runningExample: "A loaf of bread in Berlin, 1923",
  keyTerms: [
    { term: "hyperinflation", definition: "prices rising extremely fast as money loses its value" },
    { term: "reparations", definition: "payments Germany had to make for war damage" },
  ],
  titlePicture: { subject: "1923 banknote", named: null, mustShow: [] },
});

describe("lab chunks (TEACH-179 round 2)", () => {
  test("rows from Jev's slots parse as a full plan whose tests follow teaching", async () => {
    const menu = planMenu("History");
    const forms = [...new Set(menu.map((m) => m.form))];
    for (const rows of [7, 9]) {
      const run = await decideStructure(
        { topic: "Weimar", subject: "History", yearGroup: "Year 9", rows, forms },
        stubEvaluator(),
        "stub",
      );
      const sp = spine(run.structure.objectives);
      const wire = { ...sp, slides: rowsFrom(run.structure, sp, menu) };
      const { plan, unreadable } = parsePlan(wire);
      expect(unreadable).toEqual([]);
      const c = checkPlan(plan, { slideCount: rows + 2, menu });
      expect(c.problems.filter((p) => p.rule === "count")).toEqual([]);
      for (const s of plan.slides.slice(2))
        expect(chunkOf(s)).toBeLessThanOrEqual(sp.objectives.length);
    }
  });

  test("spine schema holds the count; prompts name the chunk and the spine", () => {
    expect(spineSchema(2).safeParse(spine(3)).success).toBe(false);
    expect(spineSchema(3).safeParse(spine(3)).success).toBe(true);
    expect(
      spinePrompt({ topic: "Weimar", audience: { yearGroup: "Year 9" }, cycles: 3 }).user,
    ).toContain("Learning cycles: 3");
    const menu = planMenu("History");
    const p = chunkPrompt({
      topic: "Weimar",
      audience: { yearGroup: "Year 9", subject: "History" },
      spine: spine(2),
      chunk: 2,
      ranges: [
        { chunk: 1, from: 3, to: 5 },
        { chunk: 2, from: 6, to: 9 },
      ],
      slides: [
        {
          n: 6,
          row: {
            role: "teach",
            objectives: [2],
            tests: [],
            teaches: ["o2-1"],
            purpose: "",
            parts: 3,
            form: "photo",
            layout: "default",
            imageBrief: null,
            figureBrief: null,
          },
        },
      ],
      menu,
      extras: ["A check or practise slide's task line says how pupils answer: in their books."],
    });
    expect(p.user).toContain("Cycle 2 (slides 6 to 9): idea 2 and its case  <- yours");
    expect(p.user).toContain("- hyperinflation: prices rising");
    expect(p.user).toContain("Slide 6: teach");
    expect(
      chunkExtras({ examStyle: true, marks: 4, responseMode: "books" } as never, 10)[0],
    ).toContain("[4 marks]");
  });

  test("cross-chunk check finds a repeat, an unused term and a drifted term", () => {
    const sp = spine(2);
    const body = "Prices in Berlin doubled every few days during late 1923 as money lost value";
    const r = crossChunkCheck(
      [
        { n: 4, chunk: 1, out: { heading: "Prices rose fast", body } },
        { n: 7, chunk: 2, out: { heading: "Prices rose fast", body } },
        {
          n: 8,
          chunk: 2,
          out: { heading: "Reparations", body: "Reparations were a type of bond traded abroad." },
        },
      ],
      sp,
    );
    expect(r.repeats).toHaveLength(1);
    expect(r.sameHeading).toHaveLength(1);
    expect(r.termsUnused).toEqual(["hyperinflation"]);
    expect(r.termsDrift.map((d) => d.term)).toEqual(["reparations"]);
  });
});
