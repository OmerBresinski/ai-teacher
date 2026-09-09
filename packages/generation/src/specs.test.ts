import { describe, expect, test } from "bun:test";
import { assignFactIds, PlanSkeletonSchema } from "./specs";
import { FIXTURES } from "./testing";

const skeletonWith = (outline: unknown[]) =>
  PlanSkeletonSchema.safeParse({
    learningObjectives: [{ text: "Describe rivers" }],
    outline: [
      { kind: "title", minutes: 2, factRefs: [] },
      { kind: "objectives", minutes: 3, factRefs: [{ type: "objective", index: 0 }] },
      ...outline,
    ],
  });

describe("PlanSkeletonSchema imageBrief", () => {
  test("image-text without a brief is an issue; with one it parses", () => {
    const missing = skeletonWith([
      { kind: "image-text", minutes: 6, factRefs: [{ type: "objective", index: 0 }] },
    ]);
    expect(missing.success).toBe(false);
    if (missing.success) return;
    expect(missing.error.issues.map((issue) => issue.path)).toContainEqual([
      "outline",
      2,
      "imageBrief",
    ]);

    const present = skeletonWith([
      {
        kind: "image-text",
        minutes: 6,
        factRefs: [{ type: "objective", index: 0 }],
        imageBrief: { subject: "river severn" },
      },
    ]);
    expect(present.success).toBe(true);
  });

  test("a brief on a content entry is an issue", () => {
    const result = skeletonWith([
      {
        kind: "content",
        minutes: 6,
        factRefs: [{ type: "objective", index: 0 }],
        imageBrief: { subject: "river severn" },
      },
    ]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
      "outline",
      2,
      "imageBrief",
    ]);
  });

  test("assignFactIds passes the brief through onto the outline", () => {
    const facts = assignFactIds(
      {
        learningObjectives: [{ text: "Describe rivers" }],
        outline: [
          { kind: "title", minutes: 2, factRefs: [] },
          { kind: "objectives", minutes: 3, factRefs: [{ type: "objective", index: 0 }] },
          {
            kind: "image-text",
            minutes: 6,
            factRefs: [{ type: "objective", index: 0 }],
            imageBrief: { subject: "river severn" },
          },
        ],
      },
      FIXTURES.planFacts,
      16,
    );
    expect(facts.outline[2]).toMatchObject({
      kind: "image-text",
      imageBrief: { subject: "river severn" },
    });
  });
});
