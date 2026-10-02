import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { owesExplanationLane } from "./explanation-metrics";

const text = (authoredBy?: "ai" | "teacher") =>
  ({ id: "t", type: "text", ...(authoredBy ? { authoredBy } : {}) }) as Slide["elements"][number];
const mc = (explanation: string | undefined, authoredBy?: "ai" | "teacher") => ({
  question: {
    type: "multiple-choice",
    options: [],
    ...(explanation !== undefined ? { explanation } : {}),
  } as unknown as Slide["question"],
  elements: [text(authoredBy)],
});

describe("owesExplanationLane", () => {
  test("a written reason owes the lane, generated or not", () => {
    expect(owesExplanationLane(mc("Because the marks buy less.", "ai"))).toBe(true);
    expect(owesExplanationLane(mc("Because.", "teacher"))).toBe(true);
  });

  test("a generated slide whose reason went to the notes gives the lane to its options", () => {
    expect(owesExplanationLane(mc(undefined, "ai"))).toBe(false);
    expect(owesExplanationLane(mc("  ", "ai"))).toBe(false);
  });

  test("a slide the teacher touched keeps the lane for the panel they type in", () => {
    expect(owesExplanationLane(mc(undefined, "teacher"))).toBe(true);
    expect(owesExplanationLane(mc(undefined))).toBe(true);
  });

  test("no panel, no lane", () => {
    expect(owesExplanationLane({ elements: [text("ai")] })).toBe(false);
  });
});
