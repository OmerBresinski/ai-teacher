import { describe, expect, test } from "bun:test";
import {
  LessonObjectivesOutputSchema,
  lessonObjectivesPrompt,
  objectiveCount,
} from "./lesson-objectives";

const audience = {
  subject: "History",
  yearGroup: "Year 9",
  ageBand: "ks3",
  readingLevel: "Year 9",
  language: "en-GB",
} as never;

describe("lesson-objectives", () => {
  test("count follows the slide count", () => {
    expect(objectiveCount(6)).toBe("one or two");
    expect(objectiveCount(10)).toBe("two or three");
    expect(objectiveCount(14)).toBe("three or four");
  });
  test("user turn carries T3's context, the count, and no verb reach", () => {
    const u = lessonObjectivesPrompt.user({ topic: "Weimar", audience, slideCount: 10 });
    expect(u).toStartWith("Topic: Weimar\n");
    expect(u).toContain("10-slide lesson");
    expect(u).toContain("two or three");
    expect(u).not.toContain("Explain lesson");
  });
  test("no word limit on an objective; 1 to 4 of them", () => {
    const long = "Explain ".repeat(40);
    expect(LessonObjectivesOutputSchema.safeParse({ objectives: [long] }).success).toBe(true);
    expect(LessonObjectivesOutputSchema.safeParse({ objectives: [] }).success).toBe(false);
  });
});
