import { describe, expect, test } from "bun:test";
import type { SlideCount } from "@tj/domain/documents";
import { type OutlineFacts, outlineFromFacts } from "./outline-from-facts";
import { PlanFlowSchema } from "./prompts/plan-objectives";
import { type LessonFlow, type LessonShape, lessonShapeOf, withFlow } from "./shapes";
import { planSkeletonSchemaFor } from "./specs";

/*
 * l6d: the objectives call's flow shapes the outline (`withFlow`). What stays fixed: the slide
 * count, every objective taught, and a closing check (the flow's form, or the quiz when the facts
 * cannot supply it). Everything else follows the flow.
 */

const obj = (index: number) => ({ type: "objective" as const, index });

/** Per objective: two key ideas, a misconception, two terms, a worked example, slide questions, an open exit question. */
function facts(n: number, { judgement = false } = {}): OutlineFacts {
  const f: OutlineFacts = {
    keyIdeas: [],
    misconceptions: [],
    vocabulary: [],
    workedExamples: [],
    questions: [],
  };
  for (let o = 0; o < n; o++) {
    for (let k = 0; k < 2; k++)
      f.keyIdeas.push({
        statement: `Key idea ${k + 1} of objective ${o + 1}`,
        explanation: "Why it holds.",
        example: "An example.",
        objectiveRefs: [obj(o)],
      });
    f.misconceptions.push({
      belief: `Wrong belief ${o + 1}`,
      correction: "The correction.",
      objectiveRefs: [obj(o)],
    });
    f.vocabulary.push(
      { term: `term ${o + 1}a`, definition: "Meaning a.", objectiveRefs: [obj(o)] },
      { term: `term ${o + 1}b`, definition: "Meaning b.", objectiveRefs: [obj(o)] },
    );
    f.workedExamples.push({
      problem: `Worked problem ${o + 1}?`,
      steps: ["Step one.", "Step two."],
      answer: "Answer",
      objectiveRefs: [obj(o)],
    });
    const wrong = [1, 2, 3].map((d) => ({ text: `Wrong ${d} for ${o + 1}` }));
    for (const tier of ["easy", "core", "stretch"] as const)
      f.questions.push({
        stem: `Slide ${tier} question ${o + 1}?`,
        answer: `Right ${o + 1}`,
        reasoning: "Because.",
        tier,
        use: "slide",
        distractors: wrong,
        objectiveRefs: [obj(o)],
      });
    f.questions.push(
      {
        stem: `Exit choice question ${o + 1}?`,
        answer: `Right ${o + 1}`,
        reasoning: "Because.",
        tier: "core",
        use: "exit",
        distractors: wrong,
        objectiveRefs: [obj(o)],
      },
      {
        stem: `Exit open question ${o + 1}?`,
        answer: `A full answer ${o + 1}`,
        reasoning: "Because.",
        tier: "stretch",
        use: "exit",
        objectiveRefs: [obj(o)],
        ...(judgement && o === 0 ? { demand: "judgement" as const } : {}),
      },
    );
  }
  return f;
}

const FLOW: LessonFlow = {
  opener: "retrieval",
  workedExample: false,
  commonMistake: false,
  vocabulary: false,
  checkAfter: [],
  practice: "questions",
  close: "quiz",
};

const RETRIEVAL = [1, 2, 3].map((i) => ({ question: `Earlier question ${i}?`, answer: `A${i}` }));

function run(flow: Partial<LessonFlow>, n = 3, slideCount: SlideCount = 10, f = facts(n)) {
  const shape: LessonShape = withFlow(
    lessonShapeOf({ objectiveVerb: "Explain", priorConfidence: "Some prior knowledge" }),
    { ...FLOW, ...flow },
    n,
    "ks1",
  );
  const result = outlineFromFacts({
    topic: "Rivers",
    objectives: Array.from({ length: n }, (_, i) => ({ text: `Objective ${i + 1}` })),
    facts: f,
    shape,
    slideCount,
    retrieval: RETRIEVAL,
  });
  return { result, shape, slideCount };
}
const kinds = (r: ReturnType<typeof run>) => r.result.skeleton.outline.map((e) => e.kind);

describe("withFlow", () => {
  test("the flow's kinds replace the verb table's; the counts go to their floor", () => {
    const base = lessonShapeOf({ objectiveVerb: "Explain" });
    expect(base.requiredKinds).toEqual(["worked-example", "open-response"]);
    const shape = withFlow(base, { ...FLOW, vocabulary: true }, 3);
    expect(shape.requiredKinds).toEqual(["vocabulary"]);
    expect(shape.requireVocabulary).toBe(true);
    expect(shape.requireMisconceptionConfronted).toBe(false);
    expect([shape.minContent, shape.minCheckEntries]).toEqual([1, 1]);
    expect([shape.explainMinPercent, shape.practiseMinPercent]).toEqual([0, 0]);
    expect(shape.verb).toBe("Explain");
  });

  test("checkAfter becomes 0-based, deduplicated, and out-of-range numbers are dropped", () => {
    const shape = withFlow(lessonShapeOf({}), { ...FLOW, checkAfter: [3, 1, 1, 0, 7] }, 3);
    expect(shape.checkAfter).toEqual([0, 2]);
  });

  test("discussion or both practice requires an open-response slide", () => {
    for (const practice of ["discussion", "both"] as const)
      expect(withFlow(lessonShapeOf({}), { ...FLOW, practice }, 2).requiredKinds).toContain(
        "open-response",
      );
  });

  test("the flow parses; a wrong enum does not", () => {
    expect(PlanFlowSchema.safeParse(FLOW).success).toBe(true);
    expect(PlanFlowSchema.safeParse({ ...FLOW, close: "essay" }).success).toBe(false);
  });
});

describe("outlineFromFacts with a flow", () => {
  test("the slide count is exact, every objective is taught, and the deck parses, in every close", () => {
    for (const close of ["quiz", "written", "matching"] as const)
      for (const slideCount of [8, 10, 12] as const) {
        const r = run({ close, checkAfter: [1] }, 3, slideCount);
        expect(r.result.skeleton.outline).toHaveLength(slideCount);
        expect(r.result.coverage.every((c) => c.taught.length > 0)).toBe(true);
        const parsed = planSkeletonSchemaFor({
          shape: r.shape,
          slideCount,
          learningCycles: true,
        }).safeParse(r.result.skeleton);
        expect(parsed.error?.issues.filter((i) => i.path[0] !== "photographable") ?? []).toEqual(
          [],
        );
      }
  });

  test("no mid-lesson check: no practise slide before the last cycle", () => {
    const r = run({ checkAfter: [] }, 3, 8);
    const outline = r.result.skeleton.outline;
    const lastTeach = Math.max(
      ...outline.flatMap((e, i) => (e.factRefs.some((ref) => ref.index === 2) ? [i] : [])),
    );
    const earlyPractise = outline.filter((e, i) => e.phase === "practise" && i < lastTeach);
    expect(earlyPractise.filter((e) => e.factRefs.every((ref) => ref.index < 2))).toEqual([]);
  });

  test("a check goes after each chosen cycle", () => {
    const r = run({ checkAfter: [1, 2] }, 3, 10);
    expect(r.result.coverage[0]?.practised.length).toBeGreaterThan(0);
    expect(r.result.coverage[1]?.practised.length).toBeGreaterThan(0);
  });

  test("the flow's worked example and vocabulary slides are placed; without them, not required", () => {
    const withBoth = kinds(run({ workedExample: true, vocabulary: true }));
    expect(withBoth).toContain("worked-example");
    expect(withBoth).toContain("vocabulary");
    expect(run({}, 3, 8).result.gaps.filter((g) => /shape needs/.test(g))).toEqual([]);
  });

  test("openers: retrieval prints the set, a hook asks what pupils think, none has no starter", () => {
    const retrieval = run({ opener: "retrieval" });
    expect(retrieval.result.skeleton.outline[2]?.kind).toBe("starter");
    expect(retrieval.result.skeleton.outline[2]?.brief?.adds).toMatch(/^Retrieval/);
    const hook = run({ opener: "hook" });
    expect(hook.result.skeleton.outline[2]?.brief?.adds).toMatch(/^Hook/);
    expect(hook.result.outlineFactRefs.find((e) => e.index === 2)?.factRefs).toEqual([
      { type: "misconception", index: 0 },
    ]);
    expect(kinds(run({ opener: "none" }))).not.toContain("starter");
  });

  test("l6e: a written close is the exit quiz as short written answers, every objective checked", () => {
    const r = run({ close: "written" }, 3, 10, facts(3, { judgement: true }));
    const last = r.result.skeleton.outline.at(-1);
    expect(last?.kind).toBe("exit-ticket");
    expect(last?.brief?.adds).toMatch(/short written answers/);
    expect((r.result.outlineFactRefs.at(-1)?.factRefs ?? []).length).toBeGreaterThanOrEqual(3);
    expect(r.result.coverage.every((c) => c.checked.length > 0)).toBe(true);
  });

  test("l6e: a flow's mid-lesson check is a set, never its one true/false statement", () => {
    const r = run({ commonMistake: true, checkAfter: [1, 2] }, 3, 10);
    const checks = r.result.skeleton.outline.filter((e) => e.phase === "practise");
    expect(checks.length).toBeGreaterThan(0);
    for (const e of checks) expect(e.kind).not.toBe("true-false");
  });

  test("closes: matching pairs three taught key words, one per objective first", () => {
    const r = run({ close: "matching" }, 3, 10);
    expect(r.result.skeleton.outline.at(-1)?.kind).toBe("matching");
    const refs = r.result.outlineFactRefs.at(-1)?.factRefs ?? [];
    expect(refs.map((x) => x.type)).toEqual(["vocabulary", "vocabulary", "vocabulary"]);
    expect(r.result.coverage.every((c) => c.checked.length > 0)).toBe(true);
  });

  test("l6e: matching is for Year 2 and below; above it (or unknown) the close is the quiz", () => {
    const base = lessonShapeOf({});
    const m = { ...FLOW, close: "matching" as const };
    expect(withFlow(base, m, 3, "ks1").close).toBe("matching");
    expect(withFlow(base, m, 3, "eyfs").close).toBe("matching");
    expect(withFlow(base, m, 3, "ks2").close).toBe("quiz");
    expect(withFlow(base, m, 3).close).toBe("quiz");
    expect(withFlow(base, { ...FLOW, close: "written" }, 3, "ks3").close).toBe("written");
  });

  test("a close the facts cannot supply falls back to the exit quiz, with a gap", () => {
    const f = facts(2);
    f.vocabulary = f.vocabulary.slice(0, 2);
    const matching = run({ close: "matching" }, 2, 8, f);
    expect(matching.result.skeleton.outline.at(-1)?.kind).toBe("exit-ticket");
    expect(matching.result.gaps.some((g) => /matching/.test(g))).toBe(true);
    // l6e: three pairs cannot span four objectives, so the close is the quiz.
    const four = run({ close: "matching" }, 4, 12);
    expect(four.result.skeleton.outline.at(-1)?.kind).toBe("exit-ticket");
    expect(four.result.gaps.some((g) => /span every objective/.test(g))).toBe(true);
  });
});
