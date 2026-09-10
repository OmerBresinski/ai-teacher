import { SPEC_LIMITS } from "@tj/slides";
import type { PlanSkeleton } from "../specs";
import { briefBlock, type PlanSkeletonInput } from "./plan-skeleton";
import { tierLine } from "./shape";
import { example, HOUSE_RULES, limitsBlock } from "./shared";

/*
 * Plan, second call (ADR 0025 §1, §13; TEACH-138; Generation quality §1, TEACH-211): given the
 * skeleton the first call produced, write the facts every slide and block is built from — key
 * ideas with explanations and examples, misconceptions with corrections, vocabulary, worked
 * examples, at least twelve tiered questions with distractors, and the pitch — and say which
 * outline slide each supports. The question tiers follow the lesson's shape (`tierWeights`,
 * TEACH-229): a Recall lesson for a new class leans easy, a Revisiting one leans stretch. Ordinal
 * references, ids minted after (`assignFactIds`). This call is what the teacher waits on before
 * the slides start; it is the substance of the lesson, so it is allowed to be long. Bump
 * `version` whenever `system` or `user` changes wording (`shape.ts` included).
 */

export type PlanFactsInput = PlanSkeletonInput & {
  skeleton: PlanSkeleton;
};

const O = (index: number) => ({ type: "objective", index });

const EXAMPLE = {
  keyIdeas: [
    {
      statement: "Everything is made of tiny particles that are always moving.",
      explanation:
        "The particles are far too small to see. How closely they are packed and how freely they move decides whether a substance is a solid, a liquid or a gas.",
      example:
        "A drop of ink spreads through still water because the moving water particles jostle it apart.",
      analogy:
        "Pupils standing in rows are a solid; walking round the room, a liquid; running about the playground, a gas.",
      objectiveRefs: [O(0)],
    },
  ],
  misconceptions: [
    {
      belief: "Particles in a solid do not move at all.",
      correction: "They vibrate on the spot; only in a gas do particles move freely.",
      objectiveRefs: [O(0)],
    },
  ],
  vocabulary: [
    {
      term: "Particle",
      definition: "A very small piece of a substance, too small to see.",
      objectiveRefs: [O(0)],
    },
  ],
  workedExamples: [
    {
      problem: "Why does a solid keep its shape?",
      steps: ["Its particles are packed closely.", "They can only vibrate in place."],
      answer: "The particles cannot move past each other, so the shape is fixed.",
      misconceptionRef: { type: "misconception", index: 0 },
    },
  ],
  questions: [
    {
      stem: "In which state are particles furthest apart?",
      answer: "Gas",
      reasoning: "Gas particles move freely with large gaps between them.",
      tier: "easy",
      use: "slide",
      objectiveRefs: [O(0)],
      distractors: [
        { text: "Solid", misconceptionRef: { type: "misconception", index: 0 } },
        { text: "Liquid" },
        { text: "They are the same in every state" },
      ],
    },
  ],
  pitch: { readingAgeTarget: 12, sentenceLengthMax: 16, avoid: ["kinetic"] },
  outlineFactRefs: [
    { index: 2, factRefs: [{ type: "vocabulary", index: 0 }] },
    { index: 3, factRefs: [{ type: "keyIdea", index: 0 }] },
    {
      index: 4,
      factRefs: [
        { type: "question", index: 0 },
        { type: "workedExample", index: 0 },
      ],
    },
  ],
};

export const planFactsPrompt = {
  version: "plan-facts.v6",
  system: [
    "You are an experienced UK teacher completing the plan for one lesson.",
    "You are given the lesson's objectives and its outline of slides, each with a brief saying what it adds. Produce the facts the slides and worksheet will be built from, then say which outline slide each fact supports.",
    "",
    "Rules:",
    HOUSE_RULES,
    'Write the lists in this order, each before anything that refers to it: "keyIdeas", "misconceptions", "vocabulary", "workedExamples", "questions", then "pitch", then "outlineFactRefs".',
    "Key ideas first: the 2–5 things a pupil must understand by the end, each with a plain explanation a pupil could follow, one concrete example and, where it helps, an analogy. A content slide is built from exactly one key idea, so write one per content slide in the outline.",
    "Then misconceptions: 2–4 things pupils at this level typically get wrong, each with the correction. A true-false slide confronts one of these.",
    "Then up to 8 vocabulary terms with pupil-level definitions, and up to 4 worked examples with at most 6 short steps each; where a worked example heads off a misconception, say which.",
    "Every fact is self-contained: a worked-example problem or question stem never says 'a photo shows', 'the diagram', 'pictured above' or 'this animal' — name the thing and its features in words, because no slide is guaranteed a picture. Every vocabulary term is used in at least one key idea's explanation or example, so the lesson teaches it before a question asks about it. \"pitch.avoid\" never lists a vocabulary term.",
    'Then at least 12 questions, split across "easy", "core" and "stretch" in the counts the brief\'s "Question tiers" line gives. Tag each "use": "slide" for a whole-class question, "worksheet" for independent practice, "exit" for the exit ticket, "any" — so no stem is used twice across slides, sheet and exit ticket. Each has the answer and a one-sentence reasoning. For every question that will be a multiple-choice or true-false slide, give three distractors, each the answer a pupil holding a named misconception would give.',
    'Then "pitch": the reading age to write for, the longest sentence in words, and up to 6 words to avoid, all judged from the year group and reading level given.',
    'Every fact names the objectives it serves: "objectiveRefs": [{ "type": "objective", "index": 0-based }]. Every objective is served by at least one key idea and checked by at least one question.',
    'Refer to facts by list and position: { "type": "keyIdea" | "misconception" | "vocabulary" | "workedExample" | "question", "index": 0-based }. In "outlineFactRefs", "index" is the 0-based position of the outline slide; list only slides from position 2 onwards and only the facts that slide draws on. A content slide needs its key idea; a worked-example slide needs its worked example; a question slide needs a question; a vocabulary slide needs vocabulary; a true-false slide names the misconception it confronts.',
    limitsBlock({
      statement: SPEC_LIMITS.item,
      explanation: SPEC_LIMITS.body,
      example: SPEC_LIMITS.body,
      belief: SPEC_LIMITS.item,
      correction: SPEC_LIMITS.body,
      term: SPEC_LIMITS.term,
      definition: SPEC_LIMITS.definition,
      problem: SPEC_LIMITS.body,
      "each step": SPEC_LIMITS.item,
      stem: SPEC_LIMITS.stem,
      answer: SPEC_LIMITS.answer,
      reasoning: SPEC_LIMITS.footnote,
      "each distractor": SPEC_LIMITS.option,
    }),
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: PlanFactsInput): string {
    const parts = briefBlock(input);
    parts.push(tierLine(input.shape), "", "Objectives:");
    input.skeleton.learningObjectives.forEach((o, i) => {
      parts.push(`  ${i}: ${o.text}`);
    });
    parts.push("Outline (position: kind, minutes, phase — what the slide adds):");
    input.skeleton.outline.forEach((entry, i) => {
      const phase = entry.phase ? `, ${entry.phase}` : "";
      const adds = entry.brief ? ` — ${entry.brief.adds}` : "";
      parts.push(`  ${i}: ${entry.kind}, ${entry.minutes} min${phase}${adds}`);
    });
    return parts.join("\n");
  },
} as const;
