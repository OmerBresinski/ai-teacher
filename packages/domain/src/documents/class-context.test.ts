import { describe, expect, test } from "bun:test";
import {
  type ClassContext,
  ClassContextSchema,
  NEED_CATEGORIES,
  SIZE_BANDS,
} from "./class-context";
import { GUARD_MESSAGE } from "./identifier-guard";

describe("ClassContextSchema", () => {
  test("accepts an empty object: generation proceeds when nothing is known", () => {
    expect(ClassContextSchema.safeParse({}).success).toBe(true);
  });

  test("accepts a full context and round-trips it through JSON", () => {
    const input: ClassContext = {
      sizeBand: "25to30",
      needs: { send: 3, eal: 5, higherAttaining: 6 },
      priorKnowledge: "The class can find a half and a quarter of a shape.",
      notes: "Mixed ability; two adults in the room.",
    };
    const parsed = ClassContextSchema.parse(JSON.parse(JSON.stringify(input)));
    expect(parsed).toEqual(input);
  });

  test("every size band and need category is accepted", () => {
    for (const sizeBand of SIZE_BANDS) {
      expect(ClassContextSchema.safeParse({ sizeBand }).success).toBe(true);
    }
    const needs = Object.fromEntries(NEED_CATEGORIES.map((c) => [c, 1]));
    expect(ClassContextSchema.safeParse({ needs }).success).toBe(true);
  });

  test.each([
    ["a roster key", { roster: ["Amir", "Priya"] }],
    ["a names key", { names: "Amir, Priya" }],
  ])("rejects %s (strict object)", (_label, input) => {
    const result = ClassContextSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  test.each([
    ["an unknown size band", { sizeBand: "huge" }, "sizeBand"],
    ["an unknown need category", { needs: { dyslexia: 2 } }, "needs"],
    ["a negative count", { needs: { send: -1 } }, "needs"],
    ["a fractional count", { needs: { send: 1.5 } }, "needs"],
    ["notes over 1000 chars", { notes: "a".repeat(1001) }, "notes"],
  ])("rejects %s", (_label, input, field) => {
    const result = ClassContextSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => String(i.path[0]) === field)).toBe(true);
  });

  test.each([
    ["notes", { notes: "contact j.smith@school.org" }],
    ["priorKnowledge", { priorKnowledge: "only Amir Khan knows this" }],
  ])("rejects an identifier in %s with GUARD_MESSAGE", (field, input) => {
    const result = ClassContextSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: [field], message: GUARD_MESSAGE }),
    ]);
  });
});
