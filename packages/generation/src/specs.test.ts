import { describe, expect, test } from "bun:test";
import { assignFactIds, EMPTY_PLAN_FACTS, PlanSkeletonSchema, planFactsSchemaFor } from "./specs";
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

  test("B5: assignFactIds mints k<n> and m<n>, resolves objectiveRefs and misconceptionRef ordinals to ids", () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
    expect(facts.keyIdeas?.map((k) => k.id)).toEqual(["k1"]);
    expect(facts.keyIdeas?.[0]?.objectiveRefs).toEqual(["o1"]);
    expect(facts.misconceptions.map((m) => m.id)).toEqual(["m1"]);
    expect(facts.misconceptions[0]).toMatchObject({ objectiveRefs: ["o1"] });
    const tagged = facts.questions[2];
    expect(tagged).toMatchObject({
      id: "q3",
      objectiveRefs: ["o1"],
      distractors: [{ text: "True", misconceptionRef: "m1" }],
      use: "slide",
      tier: "easy",
    });
    // Fields the facts call did not write are absent, not `undefined` or empty (jsonb round-trip).
    const plain = facts.questions[0];
    expect(plain && "objectiveRefs" in plain).toBe(false);
    expect("pitch" in facts).toBe(false);
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });

  test("assignFactIds with the empty plan facts writes no key ideas and an empty misconceptions list", () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, EMPTY_PLAN_FACTS, 60);
    expect("keyIdeas" in facts).toBe(false);
    expect(facts.misconceptions).toEqual([]);
  });

  test("planFactsSchemaFor: a fact's own objectiveRefs must land in the skeleton's objectives; a misconceptionRef in this call's list", () => {
    const schema = planFactsSchemaFor(FIXTURES.planSkeleton);
    const objectives = FIXTURES.planSkeleton.learningObjectives.length;
    const bad = {
      ...FIXTURES.planFacts,
      keyIdeas: [
        {
          ...(FIXTURES.planFacts.keyIdeas?.[0] as NonNullable<
            typeof FIXTURES.planFacts.keyIdeas
          >[number]),
          objectiveRefs: [{ type: "objective" as const, index: objectives }],
        },
      ],
      workedExamples: FIXTURES.planFacts.workedExamples.map((x) => ({
        ...x,
        misconceptionRef: { type: "misconception" as const, index: 4 },
      })),
    };
    const result = schema.safeParse(bad);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths).toContainEqual(["keyIdeas", 0, "objectiveRefs", 0, "index"]);
    expect(paths).toContainEqual(["workedExamples", 0, "misconceptionRef", "index"]);
  });

  test("planFactsSchemaFor: the outline may reference key ideas and misconceptions by ordinal", () => {
    const schema = planFactsSchemaFor(FIXTURES.planSkeleton);
    const facts = {
      ...FIXTURES.planFacts,
      outlineFactRefs: [
        ...FIXTURES.planFacts.outlineFactRefs,
        {
          index: 3,
          factRefs: [
            { type: "keyIdea" as const, index: 0 },
            { type: "misconception" as const, index: 0 },
          ],
        },
      ],
    };
    expect(schema.safeParse(facts).success).toBe(true);
    const ids = assignFactIds(FIXTURES.planSkeleton, facts, 60);
    expect(ids.outline[3]?.factRefs).toEqual(expect.arrayContaining(["k1", "m1"]));
  });
});
