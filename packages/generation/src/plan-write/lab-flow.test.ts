import { describe, expect, test } from "bun:test";
import { allocateBeats, budgets, planF2, planF3, rowsFor, rulingFaults } from "./lab-flow";
import { stubEvaluator } from "./lab-structure";
import type { ContextV3 } from "./lab-structure-v6";

const ctx = (
  slideCount: number,
  k: number,
  subject = "Science",
  yearGroup = "Year 7",
): ContextV3 => ({
  topic: "Particles",
  subject,
  yearGroup,
  minutes: 60,
  objectives: Array.from({ length: k }, (_, i) => ({
    text: `Objective ${i + 1}`,
    keyIdeas: [`idea ${i + 1}a`, `idea ${i + 1}b`],
  })),
  misconception: "",
  priorKnowledge: ["earlier"],
  rows: rowsFor(slideCount),
});

describe("flow-base.v7", () => {
  test("the requested count holds title, objectives and the planned rows; the exit ticket is outside", () => {
    // B's stored decks: slideCount 10 -> title + objectives + 8 rows (+ exit ticket when on slides).
    expect(rowsFor(10)).toBe(8);
    expect(rowsFor(6)).toBe(4);
  });
  for (const [n, k] of [
    [6, 3],
    [8, 2],
    [10, 2],
    [10, 3],
    [12, 4],
    [5, 3],
  ] as const)
    test(`${n} slides, ${k} objectives: budgets fill the rows exactly, each objective at least one`, () => {
      const rows = rowsFor(n);
      for (const needs of [
        Array(k).fill(1),
        Array.from({ length: k }, (_, i) => i),
        Array(k).fill(3),
      ]) {
        const b = budgets(rows, needs);
        expect(b.opening + b.per.reduce((a, x) => a + x, 0)).toBe(rows);
        expect(Math.min(...b.per)).toBeGreaterThanOrEqual(1);
      }
    });
  test("F2 and F3 plans are exact and teach every objective", async () => {
    for (const [n, k] of [
      [10, 2],
      [10, 3],
      [6, 3],
      [12, 4],
    ] as const) {
      const c = ctx(n, k);
      const b = budgets(c.rows, Array(k).fill(1.5));
      for (const p of [await planF2(c, stubEvaluator(), b), await planF3(c, stubEvaluator(), b)])
        expect(rulingFaults(c, p.slots)).toEqual([]);
    }
  });
  test("arc beats are given exactly the budget, even when the arc writes too many", () => {
    const c = ctx(10, 2);
    const b = budgets(c.rows, [2, 1]);
    const beat = (kind: "teach" | "model" | "check" | "apply", weight = 1) => ({
      kind,
      subObjective: kind,
      purpose: "",
      weight,
    });
    const arc = {
      opening: { kind: "retrieve" as const, subObjective: "recall", purpose: "" },
      objectives: [
        {
          objective: 1,
          beats: [
            beat("teach", 2),
            beat("model", 3),
            beat("check"),
            beat("teach"),
            beat("check"),
            beat("teach"),
            beat("check"),
          ],
        },
        { objective: 2, beats: [beat("check"), beat("apply")] },
      ],
    };
    const { slots, log } = allocateBeats(c, b, arc);
    expect(rulingFaults(c, slots)).toEqual([]);
    expect(log.length).toBeGreaterThan(0);
  });
  test("the closing apply beat is kept when an objective has more beats than slides", () => {
    const c = ctx(10, 2);
    const b = budgets(c.rows, [1, 1]);
    const beat = (kind: "teach" | "model" | "check" | "apply", weight = 1) => ({
      kind,
      subObjective: kind,
      purpose: "",
      weight,
    });
    const arc = {
      opening: { kind: "hook" as const, subObjective: "q", purpose: "" },
      objectives: [
        { objective: 1, beats: [beat("teach"), beat("check")] },
        {
          objective: 2,
          beats: [
            beat("teach", 3),
            beat("model", 3),
            beat("check", 2),
            beat("teach", 2),
            beat("apply", 1),
          ],
        },
      ],
    };
    const { slots } = allocateBeats(c, b, arc);
    expect(slots.at(-1)?.role).toBe("practise");
    expect(rulingFaults(c, slots)).toEqual([]);
  });
});
