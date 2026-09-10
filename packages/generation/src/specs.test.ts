import { describe, expect, test } from "bun:test";
import {
  assignFactIds,
  EMPTY_PLAN_FACTS,
  EvaluateOutputSchema,
  PlanSkeletonSchema,
  planFactsSchemaFor,
  planSkeletonSchemaFor,
  verifyOutputSchemaFor,
  WorksheetSpecSchema,
} from "./specs";
import { FIXTURES } from "./testing";

/* The Plan schemas (ADR 0025 §7; Generation quality §1–§2, TEACH-211). */

const O = (index: number) => ({ type: "objective" as const, index });
const RIVER = { subject: "river severn", mustShow: ["river water"], purpose: "observe" as const };
const brief = { adds: "One thing" };

/** A valid 60-minute skeleton: 20 explain minutes of 60, phases in order. */
const outline = (): Record<string, unknown>[] => [
  { kind: "title", minutes: 2, factRefs: [] },
  { kind: "objectives", minutes: 3, factRefs: [O(0)] },
  { kind: "starter", minutes: 5, factRefs: [O(0)], phase: "starter", brief },
  { kind: "content", minutes: 10, factRefs: [O(0)], phase: "explain", brief },
  { kind: "worked-example", minutes: 10, factRefs: [O(0)], phase: "explain", brief },
  { kind: "multiple-choice", minutes: 15, factRefs: [O(0)], phase: "practise", brief },
  { kind: "exit-ticket", minutes: 15, factRefs: [O(0)], phase: "check", brief },
];

const parse = (
  entries: unknown[],
  context: Parameters<typeof planSkeletonSchemaFor>[0] = { durationMin: 60 },
) =>
  planSkeletonSchemaFor(context).safeParse({
    learningObjectives: [{ text: "Describe rivers" }],
    outline: entries,
  });

const messagesOf = (result: ReturnType<typeof parse>) =>
  result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("planSkeletonSchemaFor", () => {
  test("the fixture skeleton and a well-formed outline parse", () => {
    expect(parse(outline()).success).toBe(true);
    expect(
      planSkeletonSchemaFor({ durationMin: 60 }).safeParse(FIXTURES.planSkeleton).success,
    ).toBe(true);
  });

  test("row 1: explain minutes 8 of 60 is an issue that names the 18 needed", () => {
    const entries = outline();
    entries[3] = { ...entries[3], minutes: 4 };
    entries[4] = { ...entries[4], minutes: 4 };
    entries[5] = { ...entries[5], minutes: 27 };
    const messages = messagesOf(parse(entries));
    expect(messages).toContainEqual(
      expect.stringContaining("explain phase needs at least 18 minutes"),
    );
    expect(messages).toContainEqual(expect.stringContaining("it has 8"));
  });

  test("row 2: practise before explain is an issue naming the position", () => {
    const entries = outline();
    const [practise] = entries.splice(5, 1);
    if (!practise) throw new Error("fixture");
    entries.splice(3, 0, practise);
    const messages = messagesOf(parse(entries));
    expect(messages).toContainEqual(
      'outline.4.phase: Outline position 4 is a "explain" slide but position 3 is already "practise"; phases run starter, explain, practise, check and never go back. Move this slide before the first "practise" slide, or give it the phase "practise".',
    );
  });

  test("a missing brief or phase from position 2 names the position; one on the title is refused", () => {
    const bare = outline();
    bare[3] = { kind: "content", minutes: 10, factRefs: [O(0)] };
    const messages = messagesOf(parse(bare));
    expect(messages).toContainEqual(
      expect.stringContaining("outline.3.brief: Outline position 3 needs a brief"),
    );
    expect(messages).toContainEqual(
      expect.stringContaining("outline.3.phase: Outline position 3 needs a phase"),
    );
    const titled = outline();
    titled[0] = { ...titled[0], phase: "starter" };
    expect(messagesOf(parse(titled))).toContainEqual(
      "outline.0: The title and objectives slides carry no phase or brief.",
    );
  });

  test("a lesson with no check slide is an issue", () => {
    const entries = outline();
    entries[6] = { ...entries[6], phase: "practise" };
    expect(messagesOf(parse(entries))).toContainEqual(
      'outline: The lesson needs at least one "check" slide.',
    );
  });

  test("a class new to the topic needs an explain slide per objective", () => {
    const context = { durationMin: 60, answers: { priorConfidence: "New to it" } };
    const schema = planSkeletonSchemaFor(context);
    const two = schema.safeParse({
      learningObjectives: [{ text: "A" }, { text: "B" }],
      outline: [...outline().slice(0, 2), ...outline().slice(2)],
    });
    expect(two.success).toBe(false);
    if (two.success) return;
    expect(two.error.issues.map((i) => i.message)).toContainEqual(
      "The class is new to this: objective 1 needs a content or worked-example slide that names it.",
    );
    // Any other answer, or none: the rule does not apply.
    expect(
      planSkeletonSchemaFor({
        durationMin: 60,
        answers: { priorConfidence: "Seen it before" },
      }).safeParse({
        learningObjectives: [{ text: "A" }, { text: "B" }],
        outline: outline(),
      }).success,
    ).toBe(true);
  });

  test("image-text needs a list-form picture brief; a brief on a content entry is refused", () => {
    const missing = outline();
    missing[3] = {
      kind: "image-text",
      minutes: 10,
      factRefs: [O(0)],
      phase: "explain",
      brief,
    };
    expect(messagesOf(parse(missing))).toContainEqual(
      "outline.3.imageBrief: image-text entries carry an imageBrief",
    );
    const stringForm = outline();
    stringForm[3] = {
      ...missing[3],
      imageBrief: { subject: "river severn", mustShow: "river water", purpose: "observe" },
    };
    expect(parse(stringForm).success).toBe(false);
    const present = outline();
    present[3] = { ...missing[3], imageBrief: RIVER };
    expect(parse(present).success).toBe(true);
    const misplaced = outline();
    misplaced[3] = { ...misplaced[3], imageBrief: RIVER };
    expect(messagesOf(parse(misplaced))).toContainEqual(
      "outline.3.imageBrief: imageBrief is only allowed on image-text entries",
    );
  });

  test("PlanSkeletonSchema (no brief context) applies the structural rules only", () => {
    expect(
      PlanSkeletonSchema.safeParse({ learningObjectives: [{ text: "A" }], outline: outline() })
        .success,
    ).toBe(true);
  });
  test("a vocabulary slide tagged explain is refused and does not count towards the explain share", () => {
    const entries = outline();
    entries[3] = { kind: "vocabulary", minutes: 10, factRefs: [O(0)], phase: "explain", brief };
    const messages = messagesOf(parse(entries));
    expect(messages).toContainEqual(
      expect.stringContaining(
        "outline.3.phase: Outline position 3 is a vocabulary slide in the explain phase",
      ),
    );
    expect(messages).toContainEqual(
      expect.stringContaining("explain phase needs at least 18 minutes"),
    );
  });
});

describe("planFactsSchemaFor", () => {
  const schema = () => planFactsSchemaFor(FIXTURES.planSkeleton);
  const facts = () => structuredClone(FIXTURES.planFacts);

  test("the fixture facts parse", () => {
    expect(schema().safeParse(facts()).success).toBe(true);
  });

  test("one key idea is enough (a narrow lesson has one); none is not", () => {
    const f = facts();
    f.keyIdeas = f.keyIdeas.slice(0, 1);
    const only = f.keyIdeas[0];
    if (!only) throw new Error("fixture");
    only.objectiveRefs = [O(0), O(1), O(2)];
    f.outlineFactRefs = f.outlineFactRefs.map((e) =>
      e.index === 4 ? { ...e, factRefs: [{ type: "keyIdea" as const, index: 0 }] } : e,
    );
    expect(schema().safeParse(f).success).toBe(true);
    f.keyIdeas = [];
    expect(schema().safeParse(f).success).toBe(false);
  });

  test("row 4: nine questions is an issue naming twelve", () => {
    const f = facts();
    f.questions = f.questions.slice(0, 9);
    const result = schema().safeParse(f);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toContainEqual(
      expect.stringContaining("at least 12 questions"),
    );
  });

  test("row 5: a content entry that receives no keyIdea ref is an issue naming its position", () => {
    const f = facts();
    f.outlineFactRefs = f.outlineFactRefs.filter((e) => e.index !== 4);
    const result = schema().safeParse(f);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toContainEqual(
      "Outline position 4 is a content slide and needs at least one keyIdea reference in outlineFactRefs.",
    );
  });

  test("a fact's own objectiveRefs must land in the skeleton's objectives; a misconceptionRef in this call's list", () => {
    const f = facts();
    const objectives = FIXTURES.planSkeleton.learningObjectives.length;
    const k = f.keyIdeas[0];
    if (!k) throw new Error("fixture");
    k.objectiveRefs = [O(objectives)];
    const x = f.workedExamples[0];
    if (!x) throw new Error("fixture");
    x.misconceptionRef = { type: "misconception", index: 4 };
    const result = schema().safeParse(f);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path);
    expect(paths).toContainEqual(["keyIdeas", 0, "objectiveRefs", 0, "index"]);
    expect(paths).toContainEqual(["workedExamples", 0, "misconceptionRef", "index"]);
  });

  test("the outline may reference key ideas and misconceptions by ordinal", () => {
    const f = facts();
    f.outlineFactRefs.push({
      index: 3,
      factRefs: [
        { type: "keyIdea", index: 0 },
        { type: "misconception", index: 0 },
      ],
    });
    expect(schema().safeParse(f).success).toBe(true);
    const ids = assignFactIds(FIXTURES.planSkeleton, f, 60);
    expect(ids.outline[3]?.factRefs).toEqual(expect.arrayContaining(["k1", "m1"]));
  });
  test("every objective is served by a key idea and checked by a question; tiers have their minimums", () => {
    const f = facts();
    for (const k of f.keyIdeas) k.objectiveRefs = [O(0)];
    for (const q of f.questions) q.objectiveRefs = [O(0)];
    const r = schema().safeParse(f);
    expect(r.success).toBe(false);
    if (r.success) return;
    const messages = r.error.issues.map((i) => i.message);
    expect(messages).toContainEqual(
      expect.stringContaining("Objective 1 is served by no key idea"),
    );
    expect(messages).toContainEqual(
      expect.stringContaining("Objective 2 is checked by no question"),
    );
    const flat = facts();
    for (const q of flat.questions) q.tier = "core";
    const t = schema().safeParse(flat);
    expect(t.success).toBe(false);
    if (t.success) return;
    expect(t.error.issues.map((i) => i.message)).toContainEqual(
      'Only 0 "easy" questions; give at least 3 (the target is four easy, five core, three stretch).',
    );
  });
});

describe("assignFactIds", () => {
  test("row 6: the fixtures merge into valid LessonFacts with k/m ids, briefs, phases and pitch", () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
    expect(facts.keyIdeas?.map((k) => k.id)).toEqual(["k1", "k2"]);
    expect(facts.keyIdeas?.[0]?.objectiveRefs).toEqual(["o1"]);
    expect(facts.misconceptions.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(facts.questions).toHaveLength(FIXTURES.planFacts.questions.length);
    expect(facts.questions[2]).toMatchObject({
      id: "q3",
      objectiveRefs: ["o1"],
      distractors: [{ text: "True", misconceptionRef: "m1" }],
      use: "slide",
      tier: "easy",
    });
    expect(facts.workedExamples[0]?.misconceptionRef).toBe("m1");
    expect(facts.pitch).toEqual(FIXTURES.planFacts.pitch);
    for (const [i, entry] of facts.outline.entries()) {
      if (i < 2) {
        expect("brief" in entry).toBe(false);
        expect("phase" in entry).toBe(false);
      } else {
        expect(entry.brief?.adds.length).toBeGreaterThan(0);
        expect(entry.phase).toBeDefined();
      }
    }
    // A question without distractors has no `distractors` key (jsonb round-trip).
    const plain = facts.questions[1];
    expect(plain && "distractors" in plain).toBe(false);
    expect(JSON.parse(JSON.stringify(facts))).toEqual(facts);
  });

  test("passes the picture brief through onto the outline", () => {
    const facts = assignFactIds(
      {
        learningObjectives: [{ text: "Describe rivers" }],
        outline: [
          { kind: "title", minutes: 2, factRefs: [] },
          { kind: "objectives", minutes: 3, factRefs: [O(0)] },
          { kind: "image-text", minutes: 6, factRefs: [O(0)], imageBrief: RIVER },
        ],
      },
      EMPTY_PLAN_FACTS,
      16,
    );
    expect(facts.outline[2]).toMatchObject({ kind: "image-text", imageBrief: RIVER });
  });

  test("with the empty plan facts: no key ideas, no pitch, an empty misconceptions list", () => {
    const facts = assignFactIds(FIXTURES.planSkeleton, EMPTY_PLAN_FACTS, 60);
    expect("keyIdeas" in facts).toBe(false);
    expect("pitch" in facts).toBe(false);
    expect(facts.misconceptions).toEqual([]);
  });
});

describe("verifyOutputSchemaFor (TEACH-212)", () => {
  const facts = () => assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
  const messages = (corrections: unknown[]) => {
    const r = verifyOutputSchemaFor(facts()).safeParse({ corrections });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };
  const ok = { factId: "v1", field: "term", value: "Clan", reason: "wrong-term" };

  test("a valid correction and an empty list parse", () => {
    expect(messages([])).toEqual([]);
    expect(messages([ok])).toEqual([]);
    expect(
      messages([{ factId: "x1", field: "steps", index: 0, value: "Step", reason: "arithmetic" }]),
    ).toEqual([]);
  });

  test("row 2: an unknown fact id names the id; an objective is refused the same way", () => {
    expect(messages([{ ...ok, factId: "v9" }])).toEqual([
      expect.stringContaining("corrections.0.factId: unknown fact id v9"),
    ]);
    expect(messages([{ ...ok, factId: "o1" }])[0]).toContain("unknown fact id o1");
  });

  test("a field the kind lacks names both; a steps index out of range or missing is refused; index elsewhere is refused", () => {
    expect(messages([{ ...ok, field: "stem" }])).toEqual([
      'corrections.0.field: v1 has no field "stem"; its fields are term, definition',
    ]);
    expect(
      messages([{ factId: "x1", field: "steps", index: 7, value: "S", reason: "arithmetic" }])[0],
    ).toContain("x1 has 3 steps; index 7 does not exist");
    expect(
      messages([{ factId: "x1", field: "steps", value: "S", reason: "arithmetic" }])[0],
    ).toContain("needs an index");
    expect(messages([{ ...ok, index: 0 }])[0]).toContain("index is only for steps");
  });

  test("a value over the field's own limit is refused even though it fits the body cap", () => {
    expect(messages([{ ...ok, value: "x".repeat(61) }])[0]).toContain("at most 60 characters");
  });
});

describe("EvaluateOutputSchema (TEACH-216)", () => {
  const finding = (over: Record<string, unknown>) => ({
    check: "pitch",
    severity: "warning",
    target: { slideId: "s1" },
    evidence: "the quoted span",
    message: "Too hard.",
    ...over,
  });
  const messages = (findings: unknown[]) => {
    const r = EvaluateOutputSchema.safeParse({ findings });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  test("a warning with evidence parses; an error is allowed for the two correctness checks", () => {
    expect(messages([finding({})])).toEqual([]);
    expect(messages([finding({ check: "answer-correctness", severity: "error" })])).toEqual([]);
    expect(
      messages([
        finding({
          check: "fact-consistency",
          severity: "error",
          target: { slideId: "s1", factId: "v1" },
        }),
      ]),
    ).toEqual([]);
  });

  test("row 1: an error on any other check names the rule", () => {
    expect(messages([finding({ severity: "error" })])).toEqual([
      'findings.0.severity: pitch findings are warnings: only answer-correctness and fact-consistency may be errors. Set severity to "warning".',
    ]);
  });

  test("row 3: a check outside the set is refused; so is a finding without evidence", () => {
    expect(messages([finding({ check: "terminology" })])[0]).toContain("findings.0.check");
    expect(messages([finding({ evidence: "" })])[0]).toContain("findings.0.evidence");
    const { evidence: _dropped, ...noEvidence } = finding({});
    expect(messages([noEvidence])[0]).toContain("findings.0.evidence");
  });
});

describe("WorksheetSpecSchema (TEACH-223)", () => {
  test("a block that refers to a picture is refused on initial generation, naming the block and field", () => {
    const sheet = {
      title: "The Rodent Family",
      criteria: [],
      blocks: [
        { type: "heading", text: "Rodents", level: 1, factRefs: ["o1"] },
        { type: "paragraph", text: "Rodents gnaw.", factRefs: ["o1"] },
        { type: "paragraph", text: "Rodents have incisors.", factRefs: ["o1"] },
        {
          type: "question",
          text: "Look at the photo. Is it a rodent?",
          answer: "Yes.",
          answerLines: 1,
          marks: 1,
          factRefs: ["o1"],
        },
      ],
    };
    const result = WorksheetSpecSchema.safeParse(sheet);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path.join("."))).toEqual(["blocks.3.text"]);
    }
  });
});
