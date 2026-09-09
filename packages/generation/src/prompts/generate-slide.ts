import type { LessonFacts, OutlineEntry } from "@tj/domain/documents";
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
 * Generate — one slide (ADR 0025 §8): the outline entry becomes a per-kind spec; geometry is the
 * recipe's business. The previous slide's text is passed for coherence.
 */

export type GenerateSlideInput = {
  facts: LessonFacts;
  entry: OutlineEntry;
  /** 1-based position and the total, for the model's sense of pacing. */
  position: { index: number; total: number };
  previousSlideText?: string | undefined;
  audience: Audience;
  /** How many vocabulary entries the theme's grid shows (`vocabularySlots`). */
  vocabularySlots: number;
  lessonTitle: string;
};

const SHAPES = {
  title: '{ "kind": "title", "title", "subtitle", "factRefs", "notes"? }',
  objectives: '{ "kind": "objectives", "heading"?, "items": [1–4 strings], "factRefs", "notes"? }',
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
  version: "generate-slide.v3",
  system: [
    "You write one slide of a classroom lesson from the lesson's facts.",
    "The slide's kind is fixed; you supply its text and answers only. A layout recipe places them, so give no positions, sizes or formatting.",
    "",
    "Rules:",
    HOUSE_RULES,
    "Use only the facts given, and put the ids of the facts the slide draws on in `factRefs` (the outline entry's ids at least).",
    "`notes` is a short paragraph of presenter notes for the teacher: what to say, what to ask, what misconception to watch for.",
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
      notes: "Ask for a show of hands before revealing.",
    }),
  ].join("\n"),
  user(input: GenerateSlideInput): string {
    const parts = [
      `Lesson: ${input.lessonTitle}`,
      audienceBlock(input.audience),
      "",
      factsBlock(input.facts),
      "",
      `Slide ${input.position.index} of ${input.position.total}: kind "${input.entry.kind}", ${input.entry.minutes} minutes, covering facts ${input.entry.factRefs.join(", ") || "(none named)"}.`,
    ];
    if (input.entry.kind === "vocabulary") {
      parts.push(`This theme shows at most ${input.vocabularySlots} vocabulary entries.`);
    }
    if (input.previousSlideText) {
      parts.push("", "The previous slide says:", input.previousSlideText);
    }
    parts.push("", `Answer with the JSON for a "${input.entry.kind}" slide.`);
    return parts.join("\n");
  },
} as const;
