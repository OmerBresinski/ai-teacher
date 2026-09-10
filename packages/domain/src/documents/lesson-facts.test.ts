import { describe, expect, test } from "bun:test";
import { generatedLesson, lessonFacts } from "./fixtures.test-helpers";
import { parseLesson } from "./lesson";
import {
  FactIdSchema,
  GENERATABLE_BLOCK_TYPES,
  GENERATABLE_SLIDE_KINDS,
  GeneratableBlockTypeSchema,
  GeneratableSlideKindSchema,
  ImageBriefSchema,
  type LessonFacts,
  LessonFactsSchema,
} from "./lesson-facts";

/** The richer shape (Generation quality §1) on top of the fixture: every new field set once. */
const richFacts = (): LessonFacts => ({
  ...lessonFacts(),
  keyIdeas: [
    {
      id: "k1",
      statement: "Water changes state as it warms and cools",
      explanation: "Heat from the sun turns liquid water into vapour; cooling turns it back.",
      example: "A puddle shrinks on a sunny day.",
      analogy: "Like steam from a kettle turning to drops on a cold window.",
      objectiveRefs: ["o1"],
    },
  ],
  vocabulary: lessonFacts().vocabulary.map((v) => ({ ...v, objectiveRefs: ["o2"] })),
  workedExamples: lessonFacts().workedExamples.map((x) => ({ ...x, misconceptionRef: "m1" })),
  questions: lessonFacts().questions.map((q) => ({
    ...q,
    objectiveRefs: ["o1"],
    distractors: [{ text: "Condensation", misconceptionRef: "m1" }, { text: "Freezing" }],
    use: "slide" as const,
    tier: "core" as const,
  })),
  misconceptions: [
    {
      id: "m1",
      belief: "Clouds are made of water vapour",
      correction: "Clouds are tiny liquid drops; vapour is invisible.",
      objectiveRefs: ["o2"],
    },
  ],
  pitch: { readingAgeTarget: 9, sentenceLengthMax: 14, avoid: ["precipitate"] },
  outline: lessonFacts().outline.map((entry) => ({
    ...entry,
    brief: { adds: "One thing", avoids: "Repeating the definition" },
  })),
});

const issuesOf = (facts: unknown) => {
  const result = LessonFactsSchema.safeParse(facts);
  if (result.success) throw new Error("expected a parse failure");
  return result.error.issues.map((i) => ({ path: i.path, message: i.message }));
};

import { SlideKindSchema } from "./slide";
import { WorksheetBlockSchema } from "./worksheet";

describe("LessonFactsSchema", () => {
  test("round-trips the fixture through JSON unchanged", () => {
    const input = lessonFacts();
    expect(LessonFactsSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  test("B1: the richer shape round-trips through JSON unchanged, and so does the pre-rich generated lesson", () => {
    const input = richFacts();
    expect(LessonFactsSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
    const lesson = generatedLesson();
    expect(parseLesson(JSON.parse(JSON.stringify(lesson)))).toEqual(lesson);
  });

  test("B2: a key idea's objectiveRefs must name an existing objective, at its path", () => {
    const facts = richFacts();
    const k1 = facts.keyIdeas?.[0];
    if (!k1) throw new Error("fixture");
    k1.objectiveRefs = ["o9"];
    expect(issuesOf(facts)).toContainEqual({
      path: ["keyIdeas", 0, "objectiveRefs", 0],
      message: 'references missing an objective "o9"',
    });
  });

  test("B2b: an objectiveRefs entry that exists but is not an objective is the wrong kind", () => {
    const facts = richFacts();
    const m1 = facts.misconceptions[0];
    if (!m1) throw new Error("fixture");
    m1.objectiveRefs = ["q1"];
    expect(issuesOf(facts)).toContainEqual({
      path: ["misconceptions", 0, "objectiveRefs", 0],
      message: '"q1" is not an objective id',
    });
  });

  test("B3: a misconceptionRef pointing at a question is the wrong kind; at a missing id, missing", () => {
    const facts = richFacts();
    const x1 = facts.workedExamples[0];
    if (!x1) throw new Error("fixture");
    x1.misconceptionRef = "q1";
    expect(issuesOf(facts)).toContainEqual({
      path: ["workedExamples", 0, "misconceptionRef"],
      message: '"q1" is not a misconception id',
    });
    const again = richFacts();
    const q = again.questions[0];
    if (!q?.distractors?.[0]) throw new Error("fixture");
    q.distractors[0].misconceptionRef = "m7";
    expect(issuesOf(again)).toContainEqual({
      path: ["questions", 0, "distractors", 0, "misconceptionRef"],
      message: 'references missing a misconception "m7"',
    });
  });

  test("B4: k1 beside q1 is fine; k1 twice is a duplicate at the second's path", () => {
    const facts = richFacts();
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
    const k1 = facts.keyIdeas?.[0];
    if (!k1) throw new Error("fixture");
    facts.keyIdeas = [k1, { ...k1 }];
    expect(issuesOf(facts)).toContainEqual({
      path: ["keyIdeas", 1, "id"],
      message: 'duplicate fact id "k1"',
    });
  });

  test("row 3 (TEACH-211): a string mustShow is coerced to a one-item list and purpose defaults to context; the list form parses as is", () => {
    const old = ImageBriefSchema.parse({ subject: "river flooding", mustShow: "water" });
    expect(old).toEqual({ subject: "river flooding", mustShow: ["water"], purpose: "context" });
    expect(ImageBriefSchema.parse({ subject: "river" })).toEqual({
      subject: "river",
      mustShow: [],
      purpose: "context",
    });
    const rich = {
      subject: "buttercup flower close-up",
      mustShow: ["open flower head", "petals", "stamens"],
      purpose: "identify-parts" as const,
      avoid: ["bee"],
    };
    expect(ImageBriefSchema.parse(rich)).toEqual(rich);
    expect(
      ImageBriefSchema.safeParse({ ...rich, mustShow: ["a", "b", "c", "d", "e"] }).success,
    ).toBe(false);
    // A stored lesson with the string form still parses through the lesson parser.
    const lesson = generatedLesson() as unknown as { facts: { outline: unknown[] } };
    lesson.facts.outline.push({
      id: "s9",
      kind: "image-text",
      minutes: 5,
      factRefs: [],
      imageBrief: { subject: "river flooding", mustShow: "water over the banks" },
    });
    const parsed = parseLesson(lesson);
    expect(parsed.facts?.outline.at(-1)?.imageBrief).toEqual({
      subject: "river flooding",
      mustShow: ["water over the banks"],
      purpose: "context",
    });
  });

  test("an outline factRef may point at a key idea or a misconception", () => {
    const facts = richFacts();
    facts.outline[2] = {
      ...(facts.outline[2] as (typeof facts.outline)[number]),
      factRefs: ["k1", "m1"],
    };
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);
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

  test("an outline entry of a non-generatable kind fails (image-match still waits)", () => {
    const facts = lessonFacts();
    facts.outline.push({ id: "s9", kind: "image-match" as never, minutes: 5, factRefs: [] });
    const result = LessonFactsSchema.safeParse(facts);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["outline", lessonFacts().outline.length, "kind"]);
  });

  test("an image-text entry parses with a brief; a brief elsewhere is refused", () => {
    const facts = lessonFacts();
    facts.outline.push({
      id: "s9",
      kind: "image-text",
      minutes: 5,
      factRefs: [],
      imageBrief: { subject: "Roman road", mustShow: ["paving stones"], purpose: "observe" },
    });
    expect(LessonFactsSchema.safeParse(facts).success).toBe(true);

    const unbriefed = lessonFacts();
    unbriefed.outline.push({ id: "s9", kind: "image-text", minutes: 5, factRefs: [] });
    const missing = LessonFactsSchema.safeParse(unbriefed);
    expect(missing.success).toBe(false);
    if (missing.success) return;
    expect(missing.error.issues.map((issue) => issue.path)).toContainEqual([
      "outline",
      lessonFacts().outline.length,
      "imageBrief",
    ]);

    const misplaced = lessonFacts();
    misplaced.outline[0] = {
      ...(misplaced.outline[0] as (typeof misplaced.outline)[number]),
      imageBrief: { subject: "Roman road", mustShow: [], purpose: "context" },
    };
    const result = LessonFactsSchema.safeParse(misplaced);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual([
      "outline",
      0,
      "imageBrief",
    ]);
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
  test("every generatable slide kind is a SlideKind, and image-match/timer/blank are excluded", () => {
    expect(GENERATABLE_SLIDE_KINDS).toContain("image-text");
    for (const kind of GENERATABLE_SLIDE_KINDS) {
      expect(SlideKindSchema.safeParse(kind).success).toBe(true);
    }
    for (const excluded of ["image-match", "timer", "blank"]) {
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
