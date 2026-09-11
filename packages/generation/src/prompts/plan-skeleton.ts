import { GENERATABLE_SLIDE_KINDS } from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import type { LessonShape } from "../shapes";
import { shapeBlock } from "./shape";
import { type Audience, audienceBlock, example, HOUSE_RULES, limitsBlock } from "./shared";

/*
 * Plan, first call (ADR 0025 §1, §7, §13; TEACH-138; Generation quality §2, TEACH-211; Lesson
 * shape, TEACH-229): the Brief becomes the lesson's skeleton — objectives and the outline of
 * slides — in one short `standard` call, so the objectives slide is on screen while the rest of
 * the facts are still being written (`plan-facts`). The outline is written to the lesson's shape
 * (`lessonShapeOf`: what a Recall / Explain / Apply / Evaluate lesson for this class must contain),
 * rendered as a Shape block of plain sentences, each of which `planSkeletonSchemaFor` also checks.
 * Four phases in order, a brief per slide saying what it adds, kinds chosen for what they are good
 * at. The model refers to objectives by position; ids are minted afterwards (`assignFactIds`).
 * Bump `version` whenever `system` or `user` changes wording (`shape.ts` included).
 */

export type PlanSkeletonInput = {
  topic: string;
  durationMin: number;
  /** The lesson's shape, from the brief's answers and the class (`lessonShapeOf`). */
  shape: LessonShape;
  audience: Audience;
  /** Extracted Source passages (F03); empty until then. */
  sourceTexts: { sourceId: string; text: string }[];
};

const EXAMPLE = {
  learningObjectives: [
    { text: "Name the parts of a flower and say what each is for" },
    { text: "Explain how pollination leads to seeds" },
  ],
  photographable: { yes: true, why: "A buttercup is a real thing a camera captures." },
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
      minutes: 4,
      phase: "starter",
      factRefs: [{ type: "objective", index: 0 }],
      brief: { adds: "Pupils list what they think a flower is for before being told." },
    },
    {
      kind: "content",
      minutes: 7,
      phase: "explain",
      factRefs: [{ type: "objective", index: 0 }],
      brief: {
        adds: "Defines a flower as the part of a plant that makes seeds and names three examples.",
        avoids: "Do not name the parts yet.",
      },
    },
    {
      kind: "image-text",
      minutes: 7,
      phase: "explain",
      factRefs: [{ type: "objective", index: 0 }],
      imageBrief: {
        subject: "buttercup flower",
        mustShow: ["open flower head", "petals", "stem"],
        purpose: "identify-parts",
        avoid: ["hands", "vase"],
      },
      brief: {
        adds: "Pupils find and name petal, stamen and carpel on a real flower.",
        avoids: "Do not explain pollination yet.",
      },
    },
    {
      kind: "content",
      minutes: 8,
      phase: "explain",
      factRefs: [{ type: "objective", index: 1 }],
      brief: {
        adds: "Explains pollination: pollen from a stamen reaches a carpel, which then makes seeds.",
        avoids: "Do not repeat the part names from the picture slide.",
      },
    },
    {
      kind: "worked-example",
      minutes: 6,
      phase: "explain",
      factRefs: [{ type: "objective", index: 1 }],
      brief: { adds: "Reasons step by step why a flower with no stamens sets no seed." },
    },
    {
      kind: "multiple-choice",
      minutes: 5,
      phase: "practise",
      factRefs: [{ type: "objective", index: 1 }],
      brief: { adds: "Confronts the idea that petals make the seeds." },
    },
    {
      kind: "open-response",
      minutes: 6,
      phase: "practise",
      factRefs: [{ type: "objective", index: 1 }],
      brief: { adds: "Pupils explain why bees matter to a fruit grower." },
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

/**
 * The brief as the user turn, shared with `plan-facts` so both calls see the same lesson: topic,
 * length, audience, then the Shape block (what this verb and class require), then any sources.
 */
export function briefBlock(input: PlanSkeletonInput): string[] {
  const parts = [
    `Topic or objective: ${input.topic}`,
    `Lesson length: ${input.durationMin} minutes`,
    audienceBlock(input.audience),
    "Shape:",
    ...shapeBlock(input.shape).map((line) => `  ${line}`),
  ];
  if (input.sourceTexts.length > 0) {
    parts.push("Ground the lesson in these source passages where they apply:");
    for (const s of input.sourceTexts) parts.push(`[${s.sourceId}] ${s.text}`);
  }
  return parts;
}

export const planSkeletonPrompt = {
  version: "plan-skeleton.v14",
  system: [
    "You are an experienced UK teacher planning one lesson from a brief.",
    "Produce only the lesson's skeleton: the learning objectives and an outline of slides with the minutes each takes. The key ideas, vocabulary, worked examples and questions come in a later step, so do not write them here.",
    "",
    "Rules:",
    HOUSE_RULES,
    `The outline uses only these slide kinds: ${GENERATABLE_SLIDE_KINDS.join(", ")}.`,
    'The outline starts with a "title" slide and then an "objectives" slide. Those two carry no "phase" or "brief". Every slide after them carries both.',
    'Phases, in this order and never going back: "starter" (one short slide that surfaces what pupils already think), "explain" (the teaching — this is most of the lesson), "practise" (pupils answer, with the misconceptions confronted), "check" (an exit-ticket or plenary that covers every objective). A lesson has at least one explain, one practise and one check slide.',
    'The brief\'s "Shape" block says what a lesson of this kind, for this class, must contain: which slide kinds to include or leave out, what the first explain slide is, the share of the minutes the explain and practise phases take. Every sentence in it is checked, so the outline meets every one. Explain slides are "content", "worked-example", "image-text" and "vocabulary"; only they count towards the explain share. Outline minutes add up to the lesson length within ten per cent. When the class is new to the topic, every objective gets its own content or worked-example slide.',
    'Kind fit: a "content" slide explains exactly one key idea; a "worked-example" slide works through one example step by step; "sort" is only for a genuine sequence (steps that happen in an order), never for classifying; "matching" only when the three right-hand sides are three different things; "true-false" only to confront a misconception; "multiple-choice" for a question with plausible wrong answers; "image-text" only for a real thing a photograph can show — a part must be visible from the outside.',
    '"brief": { "adds": what this slide contributes that no other slide does, in one sentence; "avoids"?: what it must not repeat from a neighbouring slide }. Two slides never add the same thing.',
    'Refer to objectives from the outline by position: { "type": "objective", "index": 0-based }. Only objectives can be referenced here. Every outline slide after the first two names at least one objective.',
    "Give 1–4 objectives and 8–12 outline slides for an hour-long lesson (fewer for a shorter one).",
    'Say whether the topic can be photographed — "photographable": { "yes", "why": one sentence } — by this test: a real place, object, organism, material, weather, artefact or everyday scene is; a diagram, map, chart, process or abstract idea is not. When it is, one explain slide is an "image-text" slide. An "image-text" slide shows one photograph of a real thing beside the text. Give it "imageBrief": { "subject": the exact query you would type into a stock-photo search engine that knows nothing about this lesson — two to four plain words, British English, no adjectives of mood, carrying the lesson\'s own context from the brief so it stands alone (the topic decides what an ambiguous word means: "oak leaf", never "leaf"; a part or property alone is never enough), "mustShow": two or three concrete things a pupil could see for the slide\'s task, each a different external feature so that an ordinary photograph of the whole subject, as a stranger would take it, is likely to show at least one of them — nouns a camera captures ("bushy tail", "small ears", "whiskers"; "open flower", "petals", "stem"; "river bank", "flowing water"); the slide\'s text is written to whichever are actually visible; a part seen only in a close-up or when the subject is doing something (teeth, tongue, roots, the inside of anything) is not a "mustShow" item — the slide\'s text names it instead; never a process, or the kind of thing itself ("rodent", "flower", "river" belong in "subject"); "purpose": "identify-parts" | "observe" | "compare" | "context"; "avoid": what would spoil the picture for pupils — for a living subject usually a cage, fence, bars, glass or hands in front of it }. Use it for places, objects, organisms, materials, weather, artefacts and everyday scenes — not for diagrams, maps, charts or anything abstract. At most three image-text slides in a lesson.',
    limitsBlock({ "each objective": SPEC_LIMITS.item }),
    "",
    "Answer as JSON in exactly this shape:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: PlanSkeletonInput): string {
    return briefBlock(input).join("\n");
  },
} as const;
