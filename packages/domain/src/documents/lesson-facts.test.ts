import { describe, expect, test } from "bun:test";
import { lessonFacts } from "./fixtures.test-helpers";
import {
  FactIdSchema,
  GENERATABLE_BLOCK_TYPES,
  GENERATABLE_SLIDE_KINDS,
  GeneratableBlockTypeSchema,
  GeneratableSlideKindSchema,
  LessonFactsSchema,
} from "./lesson-facts";
import { SlideKindSchema } from "./slide";
import { WorksheetBlockSchema } from "./worksheet";

describe("LessonFactsSchema", () => {
  test("round-trips the fixture through JSON unchanged", () => {
    const input = lessonFacts();
    expect(LessonFactsSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  test("a duplicate id across objectives and vocabulary fails with a custom issue naming it", () => {
    const facts = lessonFacts();
    facts.vocabulary[0] = {
      ...(facts.vocabulary[0] as (typeof facts.vocabulary)[number]),
      id: "o1",
    };
    const result = LessonFactsSchema.safeParse(facts);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "custom",
        path: ["vocabulary", 0, "id"],
        message: 'duplicate fact id "o1"',
      }),
    );
  });

  test("an outline entry referencing an unknown fact fails at its path", () => {
    const facts = lessonFacts();
    facts.outline[1] = {
      ...(facts.outline[1] as (typeof facts.outline)[number]),
      factRefs: ["o1", "z9"],
    };
    const result = LessonFactsSchema.safeParse(facts);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      expect.objectContaining({
        path: ["outline", 1, "factRefs", 1],
        message: 'outline references missing fact "z9"',
      }),
    ]);
    // A ref that is not even a fact id fails the pattern too (the ticket's `zz9`).
    facts.outline[1] = {
      ...(facts.outline[1] as (typeof facts.outline)[number]),
      factRefs: ["zz9"],
    };
    expect(LessonFactsSchema.safeParse(facts).success).toBe(false);
  });

  test("an outline entry of a non-generatable kind fails (image-text needs an image source)", () => {
    const facts = lessonFacts();
    facts.outline.push({ id: "s9", kind: "image-text" as never, minutes: 5, factRefs: [] });
    const result = LessonFactsSchema.safeParse(facts);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["outline", 4, "kind"]);
  });

  test("an outline entry id is unique too, but factRefs may not point at an outline entry", () => {
    const facts = lessonFacts();
    facts.outline[0] = { ...(facts.outline[0] as (typeof facts.outline)[number]), id: "o1" };
    let result = LessonFactsSchema.safeParse(facts);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ["outline", 0, "id"], message: 'duplicate fact id "o1"' }),
    );
    const structural = lessonFacts();
    structural.outline[1] = {
      ...(structural.outline[1] as (typeof structural.outline)[number]),
      factRefs: ["s1"],
    };
    result = LessonFactsSchema.safeParse(structural);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["outline", 1, "factRefs", 0],
        message: 'outline references missing fact "s1"',
      }),
    ]);
  });

  test("minutes must be a whole number of at least one; durationMin likewise", () => {
    const facts = lessonFacts();
    facts.outline[0] = { ...(facts.outline[0] as (typeof facts.outline)[number]), minutes: 0 };
    expect(LessonFactsSchema.safeParse(facts).success).toBe(false);
    expect(LessonFactsSchema.safeParse({ ...lessonFacts(), durationMin: 2.5 }).success).toBe(false);
  });

  test("rejects unknown keys (strict) and a missing array", () => {
    expect(LessonFactsSchema.safeParse({ ...lessonFacts(), extra: 1 }).success).toBe(false);
    const { misconceptions: _m, ...rest } = lessonFacts();
    expect(LessonFactsSchema.safeParse(rest).success).toBe(false);
  });

  test("curriculumRef is optional and strict", () => {
    const facts = lessonFacts();
    facts.objectives[0] = {
      ...(facts.objectives[0] as (typeof facts.objectives)[number]),
      curriculumRef: { scheme: "NC2014", code: "Sc4/4.1", version: "2014", status: "inferred" },
    };
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    facts.objectives[0] = {
      ...(facts.objectives[0] as (typeof facts.objectives)[number]),
      curriculumRef: { scheme: "NC2014", code: "x", version: "1", status: "guessed" as never },
    };
    expect(LessonFactsSchema.safeParse(facts).success).toBe(false);
  });
});

describe("FactIdSchema", () => {
  test.each(["o1", "v3", "q2", "x1", "s4", "m12"])("accepts %s", (id) => {
    expect(FactIdSchema.safeParse(id).success).toBe(true);
  });

  test.each(["O1", "1o", "o", "obj-1", "", "o1 "])("rejects %p", (id) => {
    expect(FactIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("generatable kinds (ADR 0025 §8)", () => {
  test("every generatable slide kind is a SlideKind, and the image/timer/blank kinds are excluded", () => {
    for (const kind of GENERATABLE_SLIDE_KINDS) {
      expect(SlideKindSchema.safeParse(kind).success).toBe(true);
    }
    for (const excluded of ["image-text", "image-match", "timer", "blank"]) {
      expect(GeneratableSlideKindSchema.safeParse(excluded).success).toBe(false);
    }
    expect(GeneratableSlideKindSchema.options).toEqual([...GENERATABLE_SLIDE_KINDS]);
  });

  test("every generatable block type is a WorksheetBlock type", () => {
    const blockTypes = (
      WorksheetBlockSchema as unknown as { options: { shape: { type: { value: string } } }[] }
    ).options.map((option) => option.shape.type.value);
    for (const type of GENERATABLE_BLOCK_TYPES) {
      expect(blockTypes).toContain(type);
    }
    expect(GeneratableBlockTypeSchema.safeParse("word-search").success).toBe(false);
    expect(GeneratableBlockTypeSchema.safeParse("image").success).toBe(false);
  });
});
