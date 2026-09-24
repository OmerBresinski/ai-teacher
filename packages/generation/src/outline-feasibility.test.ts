import { describe, expect, test } from "bun:test";
import { SLIDE_COUNTS, type SlideCount } from "@tj/domain/documents";
import macbeth from "./fixtures/objective-facts.ks4-english-literature-macbeth.json";
import elasticity from "./fixtures/objective-facts.post16-economics-elasticity.json";
import romans from "./fixtures/objective-facts.y4-history-romans.json";
import ratio from "./fixtures/objective-facts.y6-maths-ratio.json";
import evolution from "./fixtures/objective-facts.y6-science-evolution.json";
import { outlineFeasibility } from "./outline-feasibility";
import {
  type OutlineFacts,
  type OutlineFromFactsInput,
  outlineFromFacts,
} from "./outline-from-facts";
import { lessonShapeOf } from "./shapes";
import { planSkeletonSchemaFor } from "./specs";

/*
 * The exhaustive search beside the greedy fill, over the twenty fixture outlines: where the greedy
 * outline fails the shape's rules, the search says whether any allocation could have passed. A
 * greedy miss (feasible, yet the fill failed) is a defect in `outlineFromFacts`; an infeasible
 * case is the facts' or the deck's, and the gap sentences are the right answer.
 */

const FIXTURES = { romans, ratio, evolution, macbeth, elasticity } as const;

function inputFor(fixture: (typeof FIXTURES)[keyof typeof FIXTURES], slideCount: SlideCount) {
  const facts = fixture.facts as unknown as OutlineFacts;
  const shape = lessonShapeOf(fixture.answers, { yearGroup: fixture.yearGroup });
  const input: OutlineFromFactsInput = {
    topic: fixture.topic,
    objectives: fixture.objectives,
    facts,
    shape,
    slideCount,
  };
  return { input, facts, shape };
}

/** The shape issues the greedy outline has, less the picture question. */
function shapeIssues(input: OutlineFromFactsInput) {
  const result = outlineFromFacts(input);
  const parsed = planSkeletonSchemaFor({
    shape: input.shape,
    slideCount: input.slideCount,
    learningCycles: true,
  }).safeParse(result.skeleton);
  return parsed.success
    ? []
    : parsed.error.issues.filter((i) => i.path[0] !== "photographable").map((i) => i.message);
}

describe("outlineFeasibility over the five lab briefs", () => {
  const table: string[] = [];
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    for (const slideCount of SLIDE_COUNTS) {
      test(`${name} at ${slideCount}: a greedy failure is never a feasible allocation missed`, () => {
        const { input } = inputFor(fixture, slideCount);
        const issues = shapeIssues(input);
        const search = outlineFeasibility(input);
        expect(search.examined).toBeGreaterThan(0);
        expect(search.slots).toBe(slideCount - 3);
        table.push(
          `${name}@${slideCount}: greedy ${issues.length === 0 ? "pass" : `${issues.length} issue(s)`}; search ${search.feasible ? "feasible" : `infeasible (${search.unmet.join(", ")})`}; ${search.examined} allocations`,
        );
        // r1 (lab structure): the starter and a check per cycle are kept before the shape's
        // slide shares and optional kinds, and a set puts 2-4 questions on one practise slide, so a
        // share or kind the search could still meet is a deliberate trade, not a greedy miss.
        const r1Trade = (m: string) =>
          /practise phase|needs (?:a|an|at least)|slides after the title|this lesson needs one/.test(
            m,
          );
        if (issues.some((m) => !r1Trade(m))) expect(search.feasible).toBe(false);
      });
    }
  }
  test("the per-fixture verdicts (printed for the report)", () => {
    // One line per fixture outline; the assertions above are the test, this is the record.
    console.log(`\n${table.join("\n")}\n`);
    expect(table).toHaveLength(20);
  });
});

describe("outlineFeasibility on small facts", () => {
  const obj = (index: number) => ({ type: "objective" as const, index });
  const base = (): OutlineFacts => ({
    keyIdeas: [
      { statement: "k1", explanation: "e", example: "x", objectiveRefs: [obj(0)] },
      { statement: "k2", explanation: "e", example: "x", objectiveRefs: [obj(1)] },
    ],
    misconceptions: [],
    vocabulary: [{ term: "t", definition: "d", objectiveRefs: [obj(0)] }],
    workedExamples: [{ problem: "p", steps: ["s"], answer: "a", objectiveRefs: [obj(1)] }],
    questions: [
      {
        stem: "q1?",
        answer: "a",
        reasoning: "r",
        tier: "core",
        use: "slide",
        objectiveRefs: [obj(0)],
      },
      {
        stem: "q2?",
        answer: "a",
        reasoning: "r",
        tier: "core",
        use: "slide",
        distractors: [{ text: "w" }, { text: "w" }, { text: "w" }],
        objectiveRefs: [obj(1)],
      },
    ],
  });
  const objectives = [{ text: "Objective 1" }, { text: "Objective 2" }];

  test("Apply at 8 slides with a key idea, a worked example and a question per objective is feasible", () => {
    const r = outlineFeasibility({
      topic: "t",
      objectives,
      facts: base(),
      shape: lessonShapeOf({ objectiveVerb: "Apply", priorConfidence: "Some prior knowledge" }),
      slideCount: 8,
    });
    expect(r.feasible).toBe(true);
    expect(r.unmet).toEqual([]);
  });

  test("Apply at 6 slides with two objectives: three slots cannot teach both key ideas, give the worked example and practise", () => {
    const r = outlineFeasibility({
      topic: "t",
      objectives,
      facts: base(),
      shape: lessonShapeOf({ objectiveVerb: "Apply", priorConfidence: "Some prior knowledge" }),
      slideCount: 6,
    });
    // The 40 % floor of 4 counted slides is 1 practise slide. The worked example no longer
    // stands in for objective 2's content slide (np1 RC1: its key idea went untaught), so two
    // content slides, the worked example and a practise slide need four slots: one floor is missed.
    expect(r.feasible).toBe(false);
    expect(r.unmet).toHaveLength(1);
  });

  test("Apply at 6 slides with three objectives: three slots teach three objectives and leave no practise slide", () => {
    const facts = base();
    facts.keyIdeas.push({
      statement: "k3",
      explanation: "e",
      example: "x",
      objectiveRefs: [obj(2)],
    });
    facts.questions.push({
      stem: "q3?",
      answer: "a",
      reasoning: "r",
      tier: "core",
      use: "slide",
      objectiveRefs: [obj(2)],
    });
    const r = outlineFeasibility({
      topic: "t",
      objectives: [...objectives, { text: "Objective 3" }],
      facts,
      shape: lessonShapeOf({ objectiveVerb: "Apply", priorConfidence: "Some prior knowledge" }),
      slideCount: 6,
    });
    expect(r.feasible).toBe(false);
    expect(r.unmet.length).toBeGreaterThan(0);
    // Whatever is given up, it is never possible to meet every floor: the best allocation still
    // misses at least one of teaching, practise share or answering slides.
    expect(
      r.unmet.every((u) =>
        [
          "every objective taught",
          "every key idea taught",
          "practise share",
          "slides where pupils answer",
        ].includes(u),
      ),
    ).toBe(true);
  });

  test("an open-response floor is infeasible when no question is declared askable openly", () => {
    const facts = base();
    facts.questions = facts.questions.map((q) => ({
      ...q,
      distractors: [{ text: "w" }, { text: "w" }, { text: "w" }],
    }));
    const r = outlineFeasibility({
      topic: "t",
      objectives,
      facts,
      shape: lessonShapeOf({ objectiveVerb: "Explain", priorConfidence: "Some prior knowledge" }),
      slideCount: 12,
    });
    expect(r.feasible).toBe(false);
    expect(r.unmet).toContain("open-response slide");
    facts.questions[0] = {
      ...(facts.questions[0] as NonNullable<(typeof facts.questions)[0]>),
      forms: ["open-response"],
    };
    expect(
      outlineFeasibility({
        topic: "t",
        objectives,
        facts,
        shape: lessonShapeOf({ objectiveVerb: "Explain", priorConfidence: "Some prior knowledge" }),
        slideCount: 12,
      }).unmet,
    ).not.toContain("open-response slide");
  });

  test("an unowned worked example does not count towards the worked-example floor", () => {
    const facts = base();
    facts.workedExamples = [{ problem: "p", steps: ["s"], answer: "a" }];
    const r = outlineFeasibility({
      topic: "t",
      objectives,
      facts,
      shape: lessonShapeOf({ objectiveVerb: "Apply", priorConfidence: "Some prior knowledge" }),
      slideCount: 10,
    });
    expect(r.unmet).toContain("worked-example slide");
  });
});
