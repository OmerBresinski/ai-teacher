import type { ImagePurpose, LessonFacts, LessonPhase, OutlineEntry } from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import {
  type Audience,
  audienceBlock,
  example,
  factsBlock,
  HOUSE_RULES,
  limitsBlock,
} from "./shared";

/*
 * Generate — one slide (ADR 0025 §8; Generation quality §3, TEACH-213): the outline entry becomes
 * a per-kind spec; geometry is the recipe's business. Coherence comes from the plan, not from the
 * previous slide's text: the slide is given its own brief (what it adds, what it must not repeat),
 * its neighbours' briefs, the facts it references in full, every misconception, and the stems
 * reserved for other slides and the worksheet — so slides can be written in parallel.
 */

export type GenerateSlideInput = {
  /**
   * The facts this slide draws on: only those its entry's `factRefs` name, plus every
   * misconception and the pitch (`factsBlock` renders it). Never the whole lesson.
   */
  referenced: LessonFacts;
  entry: OutlineEntry;
  /** 1-based position and the total, for the model's sense of pacing. */
  position: { index: number; total: number };
  /** The `adds` line of the neighbouring entries, so this slide does not repeat them. */
  neighbours: { previous?: string | undefined; next?: string | undefined };
  /** Stems assigned to other slides or to the worksheet; never used here. */
  reservedStems: string[];
  phase?: LessonPhase | undefined;
  /**
   * For an `image-text` entry (TEACH-220): what the chosen photograph shows, so the text is written
   * to it — or `"none"` when no photograph passed the gate, so the text mentions no picture.
   */
  photo?: SlidePhoto | "none" | undefined;
  audience: Audience;
  /** How many vocabulary entries the theme's grid shows (`vocabularySlots`). */
  vocabularySlots: number;
  lessonTitle: string;
};

export type SlidePhoto = {
  alt: string;
  /** The brief's `mustShow` items the judge could see in the photo. */
  visible: string[];
  /** The brief's `mustShow` items it could not. */
  notVisible: string[];
  count: "one" | "several";
  purpose: ImagePurpose;
};

/** The evidence block an `image-text` slide's writer (Generate or Repair) is given. */
export function photoBlock(photo: SlidePhoto | "none"): string[] {
  if (photo === "none") {
    return ["There is no photograph on this slide: write it as plain content."];
  }
  return [
    `The photograph on this slide shows: ${photo.alt || "(no caption)"} (${photo.count === "one" ? "one" : "several"}).`,
    `Visible: ${photo.visible.length > 0 ? photo.visible.join("; ") : "(none of the required items)"}`,
    `Not visible: ${photo.notVisible.length > 0 ? photo.notVisible.join("; ") : "(nothing missing)"}`,
    `Purpose: ${photo.purpose}`,
  ];
}

/** The rule the writer follows for an `image-text` slide; shared with Repair. */
export const IMAGE_TEXT_RULE =
  "An `image-text` slide is written to its photograph. Say 'the photograph' (singular when there is one). A task — spot, find, count, point to, look for, identify, circle, label — may name only items listed as visible. Describe only what the caption and the visible list say is there; never name a kind of animal, plant, object or place the caption does not name. If the purpose is identify-parts and something required is not visible, describe what is there and tell the teacher in `notes` what the picture cannot show. If there is no photograph, do not mention a picture at all.";

const SHAPES = {
  title: '{ "kind": "title", "title", "subtitle", "factRefs", "notes"? }',
  objectives: '{ "kind": "objectives", "items": [1–4 strings], "factRefs", "notes"? }',
  starter:
    '{ "kind": "starter", "heading"?, "items": [1–3 strings], "footnote"?, "factRefs", "notes"? }',
  vocabulary:
    '{ "kind": "vocabulary", "entries": [{ "term", "definition" }] (1–slots), "factRefs", "notes"? }',
  content: '{ "kind": "content", "heading", "body" (≤ 40 words), "factRefs", "notes"? }',
  "image-text": '{ "kind": "image-text", "heading", "body" (≤ 40 words), "factRefs", "notes"? }',
  "worked-example":
    '{ "kind": "worked-example", "heading"?, "question", "steps": [1–4 strings], "factRefs", "notes"? }',
  instructions:
    '{ "kind": "instructions", "heading"?, "steps": [1–4 strings], "footnote"?, "factRefs", "notes"? }',
  discussion: '{ "kind": "discussion", "prompt", "footnote"?, "factRefs", "notes"? }',
  "true-false":
    '{ "kind": "true-false", "statement", "correct": boolean, "explanation"?, "factRefs", "notes"? }',
  "multiple-choice":
    '{ "kind": "multiple-choice", "stem", "options": [exactly 4 { "text", "correct" }, exactly one correct], "explanation"?, "factRefs", "notes"? }',
  matching:
    '{ "kind": "matching", "stem", "pairs": [exactly 3 { "left", "right" }], "factRefs", "notes"? }',
  "fill-gap":
    '{ "kind": "fill-gap", "stem", "sentence" (with one ___ per answer), "answers": [1–3 strings], "factRefs", "notes"? }',
  sort: '{ "kind": "sort", "stem", "steps": [exactly 4 strings in the correct order], "factRefs", "notes"? }',
  "open-response": '{ "kind": "open-response", "stem", "modelAnswer"?, "factRefs", "notes"? }',
  "exit-ticket":
    '{ "kind": "exit-ticket", "heading"?, "items": [exactly 3 strings], "footnote"?, "factRefs", "notes"? }',
  plenary: '{ "kind": "plenary", "heading"?, "items": [1–3 strings], "factRefs", "notes"? }',
} as const;

export const generateSlidePrompt = {
  version: "generate-slide.v9",
  system: [
    "You write one slide of a classroom lesson from the lesson's facts.",
    "The slide's kind is fixed; you supply its text and answers only. A layout recipe places them, so give no positions, sizes or formatting.",
    "",
    "Rules:",
    HOUSE_RULES,
    "You are given what this slide must add and what its neighbours add; do not repeat a neighbour. Use the facts listed and no others, and put the ids of the facts the slide draws on in `factRefs` (the outline entry's ids at least).",
    "A `content` slide explains one key idea: its statement as the heading, the explanation in plain words and its example in the body; if an analogy is given, use it. A question slide uses one of the questions given, its answer and — for multiple-choice and true-false — its distractors verbatim as the wrong options. Never use a stem from the reserved list.",
    "A `worked-example` slide shows every step of its worked example: when there are more steps than the slide holds, merge neighbouring steps so the last step — the conclusion — is always on the slide; never drop it.",
    "`notes` is a short paragraph of presenter notes for the teacher: what to say, the misconception to watch for (in its own words, never by id), and one question to ask the class whose answer is not already on the slide.",
    IMAGE_TEXT_RULE,
    "Keep text short enough to read from the back of a classroom: one idea per slide, no paragraph over forty words.",
    "Answers must be correct and unambiguous; a multiple-choice has exactly one correct option and three plausible distractors.",
    limitsBlock({
      title: SPEC_LIMITS.title,
      "heading/subtitle": SPEC_LIMITS.heading,
      "each item/step": SPEC_LIMITS.item,
      body: SPEC_LIMITS.body,
      stem: SPEC_LIMITS.stem,
      option: SPEC_LIMITS.option,
      term: SPEC_LIMITS.term,
      definition: SPEC_LIMITS.definition,
      footnote: SPEC_LIMITS.footnote,
      answer: SPEC_LIMITS.answer,
      notes: SPEC_LIMITS.notes,
    }),
    "",
    "The JSON shape per kind:",
    ...Object.entries(SHAPES).map(([kind, shape]) => `- ${kind}: ${shape}`),
    "",
    "Example for a true-false slide:",
    example({
      kind: "true-false",
      statement: "Particles in a gas are close together.",
      correct: false,
      explanation: "Gas particles are far apart and move freely.",
      factRefs: ["q1", "o1"],
      notes:
        "Ask for a show of hands before revealing. Watch for pupils who picture a gas as a crowd of particles pressed together. Ask: What would happen to the balloon if the particles inside were as close as in a liquid?",
    }),
  ].join("\n"),
  user(input: GenerateSlideInput): string {
    const parts = [
      `Lesson: ${input.lessonTitle}`,
      audienceBlock(input.audience),
      "",
      factsBlock(input.referenced),
      "",
      `Slide ${input.position.index} of ${input.position.total}: kind "${input.entry.kind}", ${input.entry.minutes} minutes${input.phase ? `, ${input.phase} phase` : ""}, covering facts ${input.entry.factRefs.join(", ") || "(none named)"}.`,
    ];
    if (input.entry.brief) {
      parts.push(`This slide adds: ${input.entry.brief.adds}`);
      if (input.entry.brief.avoids) parts.push(`It must not: ${input.entry.brief.avoids}`);
    }
    if (input.neighbours.previous)
      parts.push(`The slide before adds: ${input.neighbours.previous}`);
    if (input.neighbours.next) parts.push(`The slide after adds: ${input.neighbours.next}`);
    if (input.photo !== undefined) parts.push(...photoBlock(input.photo));
    if (input.entry.kind === "vocabulary") {
      parts.push(
        `This theme shows at most ${input.vocabularySlots} vocabulary entries. When there are more terms than that, keep every term another shown definition uses, then the terms the objectives name; put the rest in \`notes\` with their definitions.`,
      );
    }
    if (input.reservedStems.length > 0) {
      parts.push("", "Reserved for other slides or the worksheet — do not use these stems:");
      for (const stem of input.reservedStems) parts.push(`  - ${stem}`);
    }
    parts.push("", `Answer with the JSON for a "${input.entry.kind}" slide.`);
    return parts.join("\n");
  },
} as const;
