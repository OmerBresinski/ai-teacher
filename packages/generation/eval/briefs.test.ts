import { describe, expect, test } from "bun:test";
import { CreateLessonSchema } from "@tj/domain/documents";
import { lessonShapeOf, OBJECTIVE_VERBS, PRIOR_CONFIDENCES } from "../src/shapes";
import { evalBriefs } from "./briefs";

describe("eval briefs", () => {
  test("eight briefs across key stages, each a valid POST /lessons body with a unique id", () => {
    const briefs = evalBriefs();
    expect(briefs).toHaveLength(8);
    expect(new Set(briefs.map((b) => b.id)).size).toBe(8);
    for (const brief of briefs) {
      expect(CreateLessonSchema.safeParse(brief.input).success).toBe(true);
      expect(brief.input.subject).toBeString();
      expect(brief.input.yearGroup).toBeString();
    }
    // Some carry a class context, so the audience block is exercised both ways.
    expect(briefs.filter((b) => b.input.brief.classContext).length).toBeGreaterThanOrEqual(3);
  });
});

describe("eval briefs carry the two clarifying answers (TEACH-228)", () => {
  test("every objective verb and every prior confidence appears at least once across the eight", () => {
    const verbs = new Set<string>();
    const confidences = new Set<string>();
    for (const b of evalBriefs()) {
      const shape = lessonShapeOf(b.input.brief.answers, { yearGroup: b.input.yearGroup });
      expect(b.input.brief.answers?.objectiveVerb).toBeDefined();
      verbs.add(shape.verb);
      confidences.add(shape.confidence);
    }
    expect([...verbs].sort()).toEqual([...OBJECTIVE_VERBS].sort());
    expect([...confidences].sort()).toEqual([...PRIOR_CONFIDENCES].sort());
  });
});
