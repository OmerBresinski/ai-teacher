import { describe, expect, test } from "bun:test";
import type { SlideCount } from "@tj/domain/documents";
import { type OutlineFacts, outlineFromFacts } from "./outline-from-facts";

import { type LessonFlow, type LessonShape, lessonShapeOf, withFlow } from "./shapes";

/*
 * l6f: the objectives call's flow chooses the teaching extras only (`withFlow`): the opener, the
 * worked example, the common mistake and the vocabulary slide. Rounds D and E lost on practice when
 * the flow could reach the checks, so here every flow must leave the checks after each cycle and the
 * exit ticket exactly as round B's shape places them, and an extra that does not fit is dropped.
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

const RETRIEVAL = [1, 2, 3].map((i) => ({ question: `Earlier question ${i}?`, answer: `A${i}` }));
const BOOLS = [false, true] as const;
const FLOWS: LessonFlow[] = (["hook", "retrieval"] as const).flatMap((opener) =>
  BOOLS.flatMap((workedExample) =>
    BOOLS.flatMap((commonMistake) =>
      BOOLS.map((vocabulary) => ({ opener, workedExample, commonMistake, vocabulary })),
    ),
  ),
);

function run(shape: LessonShape, n: number, slideCount: SlideCount) {
  return outlineFromFacts({
    topic: "Rivers",
    objectives: Array.from({ length: n }, (_, i) => ({ text: `Objective ${i + 1}` })),
    facts: facts(n),
    shape,
    slideCount,
    retrieval: RETRIEVAL,
  });
}
type Result = ReturnType<typeof run>;
const kinds = (r: Result) => r.skeleton.outline.map((e) => e.kind);
const exit = (r: Result) => r.skeleton.outline.find((e) => e.kind === "exit-ticket");
/** The objectives each check-phase slide between cycles answers, in order. */
const practisedEach = (r: Result) => r.coverage.map((c) => c.practised.length > 0);

describe("withFlow (l6f)", () => {
  test("toggles only the worked example and vocabulary kinds; floors and checks are the table's", () => {
    for (const verb of ["Recall", "Explain", "Apply", "Evaluate"]) {
      const base = lessonShapeOf({ objectiveVerb: verb });
      for (const flow of FLOWS) {
        const shape = withFlow(base, flow);
        expect(shape.requiredKinds.includes("worked-example")).toBe(flow.workedExample);
        expect(shape.requiredKinds.includes("vocabulary")).toBe(flow.vocabulary);
        expect(shape.requireVocabulary).toBe(flow.vocabulary);
        const rest = (s: LessonShape) => ({
          ...s,
          requiredKinds: s.requiredKinds.filter(
            (k) => k !== "worked-example" && k !== "vocabulary",
          ),
          requireVocabulary: undefined,
          flow: undefined,
        });
        expect(rest(shape)).toEqual(rest(base));
        expect(shape.flow).toEqual(flow);
      }
    }
  });
});

describe("outline under a flow (l6f)", () => {
  const cases = (["Explain", "Apply", "Recall"] as const).flatMap((verb) =>
    [2, 3, 4].flatMap((n) => ([8, 10, 12] as SlideCount[]).map((c) => [verb, n, c] as const)),
  );

  test("no flow leaves round B's outline unchanged", () => {
    const shape = lessonShapeOf({ objectiveVerb: "Explain" });
    expect(run({ ...shape, flow: undefined }, 3, 10)).toEqual(run(shape, 3, 10));
  });

  test("every flow keeps each cycle's check and the exit ticket B's shape places", () => {
    for (const [verb, n, slideCount] of cases) {
      const base = lessonShapeOf({ objectiveVerb: verb });
      const b = run(base, n, slideCount);
      for (const flow of FLOWS) {
        const f = run(withFlow(base, flow), n, slideCount);
        expect(exit(f)).toEqual(exit(b));
        const was = practisedEach(b);
        practisedEach(f).forEach((p, o) => {
          if (was[o]) expect(p).toBe(true);
        });
      }
    }
  });

  test("the opener: retrieval prints the set, a hook asks on the first misconception", () => {
    const base = lessonShapeOf({ objectiveVerb: "Explain" });
    const on = FLOWS.find((f) => f.opener === "hook") as LessonFlow;
    const starter = (flow: LessonFlow) => {
      const r = run(withFlow(base, flow), 3, 10);
      const at = r.skeleton.outline.findIndex((e) => e.kind === "starter");
      return {
        brief: r.skeleton.outline[at]?.brief?.adds,
        refs: r.outlineFactRefs.find((x) => x.index === at)?.factRefs,
      };
    };
    const hook = starter(on);
    expect(hook.brief).toStartWith("Hook:");
    expect(hook.refs).toContainEqual({ type: "misconception", index: 0 });
    expect(starter({ ...on, opener: "retrieval" }).brief).toStartWith("Retrieval:");
  });

  test("extras follow the flow where there is room", () => {
    const base = lessonShapeOf({ objectiveVerb: "Explain" });
    const none: LessonFlow = {
      opener: "retrieval",
      workedExample: false,
      commonMistake: false,
      vocabulary: false,
    };
    const bare = kinds(run(withFlow(base, none), 3, 12));
    expect(bare).not.toContain("vocabulary");
    expect(bare).not.toContain("discussion");
    expect(bare).not.toContain("worked-example");
    const all = kinds(
      run(
        withFlow(base, { ...none, workedExample: true, commonMistake: true, vocabulary: true }),
        3,
        12,
      ),
    );
    expect(all).toContain("vocabulary");
    expect(all).toContain("discussion");
    expect(all).toContain("worked-example");
  });

  test("an extra that does not fit is dropped with a gap, not a check", () => {
    const base = lessonShapeOf({ objectiveVerb: "Explain" });
    const every: LessonFlow = {
      opener: "hook",
      workedExample: true,
      commonMistake: true,
      vocabulary: true,
    };
    const r = run(withFlow(base, every), 4, 8);
    const b = run(base, 4, 8);
    expect(exit(r)).toEqual(exit(b));
    expect(
      r.gaps.some((g) => /no room for a (common mistake|vocabulary|worked-example)/.test(g)),
    ).toBe(true);
  });
});
