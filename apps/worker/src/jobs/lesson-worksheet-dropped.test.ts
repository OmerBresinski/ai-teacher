import { describe, expect, test } from "bun:test";
import { WorksheetGenerationSchema } from "@tj/domain/documents";
import { droppedItems } from "./lesson-worksheet";

/* R5 D: a sheet that ships keeps each dropped item in full in its generation record. */
describe("droppedItems", () => {
  const verdict = (where: string, faults: string[]) => ({
    where,
    question: `${where}: Pepys saw people escaping by boat. What could his diary tell us?`,
    working: null,
    answer: "It could tell us that people escaped by boat.",
    faults,
  });
  test("only the dropped items, with their full text and every reason", () => {
    const built = {
      verdicts: [
        verdict("core 1", []),
        verdict("core 2", ["its question already gives the answer"]),
      ],
    };
    expect(droppedItems(built)).toEqual([
      verdict("core 2", ["its question already gives the answer"]),
    ]);
  });
  test("a slide-built sheet has none; the record parses with and without them", () => {
    expect(droppedItems({})).toEqual([]);
    const base = {
      jobId: "j",
      stage: "checked" as const,
      startedAt: "2026-11-12T10:00:00.000Z",
      promptVersions: {},
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      findings: [],
      recipeId: "practice",
      practiceMinutes: 15,
    };
    const dropped = [verdict("core 2", ["takes the same step (35÷5) as core 1"])];
    expect(WorksheetGenerationSchema.safeParse({ ...base, dropped }).success).toBe(true);
    expect(WorksheetGenerationSchema.safeParse(base).success).toBe(true);
  });
});
