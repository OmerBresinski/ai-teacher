import { describe, expect, test } from "bun:test";
import { CreateLessonSchema } from "@tj/domain/documents";
import { lessonShapeOf, OBJECTIVE_VERBS, PRIOR_CONFIDENCES } from "../src/shapes";
import { evalBriefs, isSecondaryBrief } from "./briefs";

describe("eval briefs", () => {
  test("twelve briefs across key stages, each a valid POST /lessons body with a unique id; nine are secondary", () => {
    const briefs = evalBriefs();
    expect(briefs).toHaveLength(12);
    expect(new Set(briefs.map((b) => b.id)).size).toBe(12);
    expect(briefs.filter(isSecondaryBrief)).toHaveLength(9);
    expect(briefs.filter((b) => !isSecondaryBrief(b)).map((b) => b.id)).toEqual([
      "y3-maths-fractions",
      "eyfs-phonics-sh",
      "ks2-re-diwali",
    ]);
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
  test("every objective verb and every prior confidence appears at least once across the twelve", () => {
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
