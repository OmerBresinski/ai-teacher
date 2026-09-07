import type { PlanSkeleton } from "../specs";
import { briefBlock, type PlanSkeletonInput } from "./plan-skeleton";
import { example, HOUSE_RULES } from "./shared";

/*
 * Plan, second call (ADR 0025 §1, §13; TEACH-138): given the skeleton the first call produced,
 * write the remaining facts — vocabulary, worked examples, questions with answers and a short
 * reasoning — and say which outline slide each supports. Ordinal references, ids minted after
 * (`assignFactIds`). Kept lean on purpose: this call is what the teacher waits on before the
 * slides start. Bump `version` whenever `system` or `user` changes wording.
 */

export type PlanFactsInput = PlanSkeletonInput & {
  skeleton: PlanSkeleton;
};

const EXAMPLE = {
  vocabulary: [{ term: "Particle", definition: "A very small piece of a substance." }],
  workedExamples: [
    {
      problem: "Why does a solid keep its shape?",
      steps: ["Its particles are packed closely.", "They can only vibrate in place."],
      answer: "The particles cannot move past each other, so the shape is fixed.",
    },
  ],
  questions: [
    {
      stem: "In which state are particles furthest apart?",
      answer: "Gas",
      reasoning: "Gas particles move freely with large gaps between them.",
    },
  ],
  outlineFactRefs: [
    { index: 2, factRefs: [{ type: "vocabulary", index: 0 }] },
    {
      index: 3,
      factRefs: [
        { type: "question", index: 0 },
        { type: "workedExample", index: 0 },
      ],
    },
  ],
};

export const planFactsPrompt = {
  version: "plan-facts.v1",
  system: [
    "You are an experienced UK teacher completing the plan for one lesson.",
    "You are given the lesson's objectives and its outline of slides. Produce the facts the slides and worksheet will be built from: key vocabulary, worked examples, and questions with answers and a one-line reasoning. Then say which outline slide each fact supports.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Give up to 6 vocabulary terms, up to 3 worked examples with at most 4 short steps each, and up to 8 questions. Keep every reasoning to one sentence.",
    'Write the three lists first, in the order vocabulary, workedExamples, questions, and only then "outlineFactRefs", so every position you refer to exists. Refer to facts by list and position: { "type": "vocabulary" | "workedExample" | "question", "index": 0-based }. In "outlineFactRefs", "index" is the 0-based position of the outline slide; list only slides from position 2 onwards and only the facts that slide draws on. A question slide needs a question; a vocabulary slide needs vocabulary; a worked-example slide needs a worked example.',
    "Every question and worked example must serve at least one objective, and every objective must be checked by at least one question.",
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: PlanFactsInput): string {
    const parts = briefBlock(input);
    parts.push("", "Objectives:");
    input.skeleton.learningObjectives.forEach((o, i) => {
      parts.push(`  ${i}: ${o.text}`);
    });
    parts.push("Outline (position: kind, minutes):");
    input.skeleton.outline.forEach((entry, i) => {
      parts.push(`  ${i}: ${entry.kind}, ${entry.minutes} min`);
    });
    return parts.join("\n");
  },
} as const;
