import { describe, expect, it } from "bun:test";
import { BriefSchema } from "@tj/domain/documents";
import {
  CONFIDENCE_QUESTION,
  confidenceOptions,
  OBJECTIVE_QUESTION,
  objectiveOptions,
  shouldAskQuestions,
  wordCount,
} from "./brief-questions";

describe("brief questions", () => {
  it("appear once the topic has three words", () => {
    expect(wordCount("  Fractions  ")).toBe(1);
    expect(shouldAskQuestions("Fractions")).toBe(false);
    expect(shouldAskQuestions("Fractions of amounts")).toBe(true);
    expect(shouldAskQuestions("  The   water cycle ")).toBe(true);
  });

  it("build the objective options from the topic, verbs first, one per line", () => {
    const options = objectiveOptions("Fractions of amounts.");
    expect(options.map((o) => o.label)).toEqual([
      "Recall fractions of amounts",
      "Explain fractions of amounts",
      "Apply fractions of amounts",
      "Evaluate fractions of amounts",
    ]);
    // The value is the label: the Plan stage reads what the teacher saw.
    expect(options.every((o) => o.value === o.label)).toBe(true);
    const long = objectiveOptions("A".repeat(120));
    expect(long[0]?.label.length).toBeLessThan(80);
    expect(long[0]?.label.endsWith("…")).toBe(true);
  });

  it("offers three confidence levels, the plainest first", () => {
    expect(confidenceOptions().map((o) => o.label)).toEqual([
      "New to it",
      "Some prior knowledge",
      "Revisiting",
    ]);
  });

  it("answers fit the brief schema under the question ids", () => {
    const answers = {
      [OBJECTIVE_QUESTION.id]: objectiveOptions("The water cycle")[0]?.value ?? "",
      [CONFIDENCE_QUESTION.id]: confidenceOptions()[0]?.value ?? "",
    };
    expect(
      BriefSchema.safeParse({ topic: "The water cycle", durationMin: 60, answers }).success,
    ).toBe(true);
  });
});
