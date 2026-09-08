import { describe, expect, test } from "bun:test";
import { CreateLessonSchema } from "@tj/domain/documents";
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
