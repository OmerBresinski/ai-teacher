import { GENERATABLE_SLIDE_KINDS } from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import { EXPLAIN_SHARE_MIN_PERCENT } from "../specs";
import { type Audience, audienceBlock, example, HOUSE_RULES, limitsBlock } from "./shared";

/*
 * Plan, first call (ADR 0025 §1, §7, §13; TEACH-138; Generation quality §2, TEACH-211): the Brief
 * becomes the lesson's skeleton — objectives and the outline of slides — in one short `standard`
 * call, so the objectives slide is on screen while the rest of the facts are still being written
 * (`plan-facts`). The outline is a lesson shape that teaches before it tests: four phases in
 * order, a brief per slide saying what it adds, kinds chosen for what they are good at. The model
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
    { text: "Name the parts of a flower and say what each is for" },
    { text: "Explain how pollination leads to seeds" },
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
    {
      kind: "starter",
      minutes: 5,
      phase: "starter",
      factRefs: [{ type: "objective", index: 0 }],
      brief: { adds: "Pupils list what they think a flower is for before being told." },
    },
    {
      kind: "image-text",
      minutes: 8,
      phase: "explain",
      factRefs: [{ type: "objective", index: 0 }],
      imageBrief: {
        subject: "buttercup flower close-up",
        mustShow: ["open flower head", "petals", "stamens"],
        purpose: "identify-parts",
      },
      brief: {
        adds: "Pupils find and name petal, stamen and carpel on a real flower.",
        avoids: "Do not explain pollination yet.",
      },
    },
    {
      kind: "content",
      minutes: 10,
      phase: "explain",
      factRefs: [{ type: "objective", index: 1 }],
      brief: {
        adds: "Explains pollination: pollen from a stamen reaches a carpel, which then makes seeds.",
        avoids: "Do not repeat the part names from the picture slide.",
      },
    },
    {
      kind: "multiple-choice",
      minutes: 7,
      phase: "practise",
      factRefs: [{ type: "objective", index: 1 }],
      brief: { adds: "Confronts the idea that petals make the seeds." },
    },
    {
      kind: "exit-ticket",
      minutes: 5,
      phase: "check",
      factRefs: [
        { type: "objective", index: 0 },
        { type: "objective", index: 1 },
      ],
      brief: { adds: "Three questions, one per objective and one stretch." },
    },
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
  version: "plan-skeleton.v6",
  system: [
    "You are an experienced UK teacher planning one lesson from a brief.",
    "Produce only the lesson's skeleton: the learning objectives and an outline of slides with the minutes each takes. The key ideas, vocabulary, worked examples and questions come in a later step, so do not write them here.",
    "",
    "Rules:",
    HOUSE_RULES,
    `The outline uses only these slide kinds: ${GENERATABLE_SLIDE_KINDS.join(", ")}.`,
    'The outline starts with a "title" slide and then an "objectives" slide. Those two carry no "phase" or "brief". Every slide after them carries both.',
    'Phases, in this order and never going back: "starter" (one short slide that surfaces what pupils already think), "explain" (the teaching — this is most of the lesson), "practise" (pupils answer, with the misconceptions confronted), "check" (an exit-ticket or plenary that covers every objective). A lesson has at least one explain, one practise and one check slide.',
    `Explain slides ("content", "worked-example", "image-text") take at least ${EXPLAIN_SHARE_MIN_PERCENT}% of the lesson's minutes. Outline minutes add up to the lesson length within ten per cent. When the teacher has said the class is new to the topic, every objective gets its own content or worked-example slide.`,
    'Kind fit: a "content" slide explains exactly one key idea; a "worked-example" slide works through one example step by step; "sort" is only for a genuine sequence (steps that happen in an order), never for classifying; "matching" only when the three right-hand sides are three different things; "true-false" only to confront a misconception; "multiple-choice" for a question with plausible wrong answers; "image-text" only for a real thing a photograph can show — a part must be visible from the outside.',
    '"brief": { "adds": what this slide contributes that no other slide does, in one sentence; "avoids"?: what it must not repeat from a neighbouring slide }. Two slides never add the same thing.',
    'Refer to objectives from the outline by position: { "type": "objective", "index": 0-based }. Only objectives can be referenced here. Every outline slide after the first two names at least one objective.',
    "Give 1–4 objectives and 8–12 outline slides for an hour-long lesson (fewer for a shorter one).",
    'An "image-text" slide shows one photograph of a real thing beside the text. Give it "imageBrief": { "subject": the exact query you would type into a stock-photo search engine that knows nothing about this lesson — two to four plain words, British English, no adjectives of mood, carrying the lesson\'s own context from the brief so it stands alone (the topic decides what an ambiguous word means: "rodent incisors", never "teeth"; a part or property alone is never enough), "mustShow": one to four concrete things a pupil must be able to see for the slide\'s task to be possible — nouns a camera captures, never a process or an internal part, "purpose": "identify-parts" | "observe" | "compare" | "context", "avoid"?: things the photograph must not show }. Use it for places, objects, organisms, materials, weather, artefacts and everyday scenes — not for diagrams, maps, charts or anything abstract. At most three image-text slides in a lesson.',
    limitsBlock({ "each objective": SPEC_LIMITS.item }),
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: PlanSkeletonInput): string {
    return briefBlock(input).join("\n");
  },
} as const;
