import { describe, expect, test } from "bun:test";
import { type ContextV3, readR1V3, skeletonV3 } from "./lab-structure-v6";

const ctx = (rows: number, k: number): ContextV3 => ({
  topic: "Particles",
  subject: "Science",
  yearGroup: "Year 7",
  minutes: 60,
  objectives: Array.from({ length: k }, (_, i) => ({
    text: `Objective ${i + 1}`,
    keyIdeas: [`idea ${i + 1}a`, `idea ${i + 1}b`],
  })),
  misconception: "",
  priorKnowledge: [],
  rows,
});

describe("structure-questions.v6 guards", () => {
  for (const [rows, k] of [
    [3, 3],
    [4, 3],
    [7, 3],
    [7, 2],
    [10, 4],
  ] as const)
    test(`${rows} rows, ${k} objectives: count and coverage hold`, () => {
      const c = ctx(rows, k);
      const r1 = readR1V3({}, c);
      const slots = skeletonV3(c, r1);
      expect(slots.length).toBeLessThanOrEqual(rows);
      for (let o = 1; o <= k; o++)
        expect(slots.some((s) => s.role === "teach" && s.objective === o)).toBe(true);
      if (rows >= 2 * k + 1) expect(slots.length).toBe(rows);
    });
  test("a short lesson logs each guard fire", () => {
    const c = ctx(3, 3);
    const r1 = readR1V3({}, c);
    skeletonV3(c, r1);
    expect(r1.guards.length).toBeGreaterThan(0);
  });
});
