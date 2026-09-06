import { GENERATABLE_SLIDE_KINDS } from "@tj/domain/documents";
import { type Audience, audienceBlock, example, HOUSE_RULES } from "./shared";

/*
 * Plan (ADR 0025 §1, §13): the Brief becomes `LessonFacts` in one `standard` call. The model
 * gives ordered lists and refers to them by position in the outline; ids are minted afterwards
 * (`assignFactIds`). Bump `version` whenever `system` or `user` changes wording.
 */

export type PlanInput = {
  topic: string;
  durationMin: number;
  /** The teacher's answers to the clarifying questions, when any. */
  answers?: Record<string, string> | undefined;
  audience: Audience;
  /** Extracted Source passages (F03); empty until then. */
  sourceTexts: { sourceId: string; text: string }[];
};

const EXAMPLE = {
  objectives: [{ text: "Describe the three states of matter in terms of particles" }],
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
  outline: [
    { kind: "title", minutes: 2, factRefs: [] },
    { kind: "objectives", minutes: 3, factRefs: [{ type: "objective", index: 0 }] },
    { kind: "vocabulary", minutes: 8, factRefs: [{ type: "vocabulary", index: 0 }] },
    {
      kind: "multiple-choice",
      minutes: 7,
      factRefs: [
        { type: "question", index: 0 },
        { type: "objective", index: 0 },
      ],
    },
  ],
};

export const planPrompt = {
  version: "plan.v1",
  system: [
    "You are an experienced UK teacher planning one lesson from a brief.",
    "Produce the facts every slide and worksheet question will be built from: objectives, key vocabulary, worked examples, questions with answers and reasoning, and an outline of slides with the minutes each takes.",
    "",
    "Rules:",
    HOUSE_RULES,
    `The outline uses only these slide kinds: ${GENERATABLE_SLIDE_KINDS.join(", ")}.`,
    'The outline starts with a "title" slide and then an "objectives" slide; the remaining slides teach, practise and check the objectives in a sensible order and end with an "exit-ticket" or "plenary".',
    "Outline minutes add up to the lesson length within ten per cent.",
    'Refer to facts from the outline by list and position: { "type": "objective" | "vocabulary" | "workedExample" | "question", "index": 0-based }. Every outline slide after the first two names at least one fact.',
    "Give 1–4 objectives, up to 8 vocabulary terms, up to 3 worked examples and up to 8 questions; a question slide in the outline needs a question to draw on.",
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: PlanInput): string {
    const parts = [
      `Topic or objective: ${input.topic}`,
      `Lesson length: ${input.durationMin} minutes`,
      audienceBlock(input.audience),
    ];
    if (input.answers && Object.keys(input.answers).length > 0) {
      parts.push("The teacher also said:");
      for (const [q, a] of Object.entries(input.answers)) parts.push(`  ${q}: ${a}`);
    }
    if (input.sourceTexts.length > 0) {
      parts.push("Ground the facts in these source passages where they apply:");
      for (const s of input.sourceTexts) parts.push(`[${s.sourceId}] ${s.text}`);
    }
    return parts.join("\n");
  },
} as const;
