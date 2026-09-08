import { describe, expect, it } from "bun:test";
import { BriefSchema } from "@tj/domain/documents";
import {
  CONFIDENCE_QUESTION,
  confidenceOptions,
  OBJECTIVE_QUESTION,
  objectiveOptions,
  shouldAskQuestions,
  suggestedObjectiveIndex,
  wordCount,
} from "./brief-questions";

describe("brief questions", () => {
  it("appear once the topic has three words", () => {
    expect(wordCount("  Fractions  ")).toBe(1);
    expect(shouldAskQuestions("Fractions")).toBe(false);
    expect(shouldAskQuestions("Fractions of amounts")).toBe(true);
    expect(shouldAskQuestions("  The   water cycle ")).toBe(true);
  });

  it("build the objective options from the topic: the verb on screen, the sentence in the answer", () => {
    const options = objectiveOptions("Fractions of amounts.");
    expect(options.map((o) => o.value)).toEqual([
      "Recall fractions of amounts",
      "Explain fractions of amounts",
      "Apply fractions of amounts",
      "Evaluate fractions of amounts",
    ]);
    expect(options.map((o) => o.label)).toEqual(["Recall", "Explain", "Apply", "Evaluate"]);
    expect(options.every((o) => o.gloss.length > 0)).toBe(true);
    const long = objectiveOptions("A".repeat(120));
    expect(long[0]?.value.length).toBeLessThan(80);
    expect(long[0]?.value.endsWith("…")).toBe(true);
  });

  it("suggests Explain for a noun phrase, Apply for a skill, Recall for facts, Evaluate for a judgement", () => {
    const verb = (topic: string) => objectiveOptions(topic)[suggestedObjectiveIndex(topic)]?.label;
    expect(verb("The water cycle")).toBe("Explain");
    expect(verb("Fractions of amounts")).toBe("Explain");
    expect(verb("Finding fractions of amounts using bar models")).toBe("Apply");
    expect(verb("The 7 times table")).toBe("Recall");
    expect(verb("Was the Roman invasion good for Britain?")).toBe("Explain");
    expect(verb("Compare the Roman and Viking invasions")).toBe("Evaluate");
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
