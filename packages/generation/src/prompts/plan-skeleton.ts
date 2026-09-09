import { GENERATABLE_SLIDE_KINDS } from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import { type Audience, audienceBlock, example, HOUSE_RULES, limitsBlock } from "./shared";

/*
 * Plan, first call (ADR 0025 §1, §7, §13; TEACH-138): the Brief becomes the lesson's skeleton —
 * objectives and the outline of slides — in one short `standard` call, so the objectives slide
 * is on screen while the rest of the facts are still being written (`plan-facts`). The model
 * refers to objectives by position; ids are minted afterwards (`assignFactIds`). Bump `version`
 * whenever `system` or `user` changes wording.
 */

export type PlanSkeletonInput = {
  topic: string;
  durationMin: number;
  /** The teacher's answers to the clarifying questions, when any. */
  answers?: Record<string, string> | undefined;
  audience: Audience;
  /** Extracted Source passages (F03); empty until then. */
  sourceTexts: { sourceId: string; text: string }[];
};

const EXAMPLE = {
  learningObjectives: [
    { text: "Describe the three states of matter in terms of particles" },
    { text: "Explain melting and boiling as changes of state" },
  ],
  outline: [
    { kind: "title", minutes: 2, factRefs: [] },
    {
      kind: "objectives",
      minutes: 3,
      factRefs: [
        { type: "objective", index: 0 },
        { type: "objective", index: 1 },
      ],
    },
    { kind: "vocabulary", minutes: 8, factRefs: [{ type: "objective", index: 0 }] },
    {
      kind: "image-text",
      minutes: 6,
      factRefs: [{ type: "objective", index: 0 }],
      imageBrief: { subject: "flooding river", mustShow: "water over the banks" },
    },
    { kind: "multiple-choice", minutes: 7, factRefs: [{ type: "objective", index: 1 }] },
    { kind: "exit-ticket", minutes: 5, factRefs: [{ type: "objective", index: 0 }] },
  ],
};

/** The brief as the user turn, shared with `plan-facts` so both calls see the same lesson. */
export function briefBlock(input: PlanSkeletonInput): string[] {
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
    parts.push("Ground the lesson in these source passages where they apply:");
    for (const s of input.sourceTexts) parts.push(`[${s.sourceId}] ${s.text}`);
  }
  return parts;
}

export const planSkeletonPrompt = {
  version: "plan-skeleton.v4",
  system: [
    "You are an experienced UK teacher planning one lesson from a brief.",
    "Produce only the lesson's skeleton: the learning objectives and an outline of slides with the minutes each takes. The vocabulary, worked examples and questions come in a later step, so do not write them here.",
    "",
    "Rules:",
    HOUSE_RULES,
    `The outline uses only these slide kinds: ${GENERATABLE_SLIDE_KINDS.join(", ")}.`,
    'The outline starts with a "title" slide and then an "objectives" slide; the remaining slides teach, practise and check the objectives in a sensible order and end with an "exit-ticket" or "plenary".',
    "Outline minutes add up to the lesson length within ten per cent.",
    'Refer to objectives from the outline by position: { "type": "objective", "index": 0-based }. Only objectives can be referenced here. Every outline slide after the first two names at least one objective.',
    "Give 1–4 objectives and 8–10 outline slides for an hour-long lesson (fewer for a shorter one); include at least two slides pupils answer (true-false, multiple-choice, matching, fill-gap, sort or open-response) and one vocabulary slide.",
    'An "image-text" slide shows one photograph of a real thing beside the text. Give it "imageBrief": { "subject": the exact query you would type into a stock-photo search engine that knows nothing about this lesson — two to four plain words, British English, no adjectives of mood, carrying the lesson\'s own context from the brief so it stands alone (the topic decides what an ambiguous word means: "rodent incisors", never "teeth"; a part or property alone is never enough), "mustShow"?: what has to be visible }. Use it for places, objects, organisms, materials, weather, artefacts and everyday scenes — not for diagrams, maps, charts or anything abstract. At most three image-text slides in a lesson.',
    limitsBlock({ "each objective": SPEC_LIMITS.item }),
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: PlanSkeletonInput): string {
    return briefBlock(input).join("\n");
  },
} as const;
