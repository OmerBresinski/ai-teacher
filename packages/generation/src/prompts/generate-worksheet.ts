import { GENERATABLE_BLOCK_TYPES, type LessonFacts } from "@tj/domain/documents";
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
 * Generate — the worksheet (ADR 0025 §4, §8): one call for the whole sheet's block specs; the
 * answers become the answer key.
 */

export type GenerateWorksheetInput = {
  facts: LessonFacts;
  audience: Audience;
  lessonTitle: string;
  /** Plain text of the slides already generated, so the sheet practises what was taught. */
  slideTexts: string[];
};

const BLOCK_SHAPES = {
  heading: '{ "type": "heading", "text", "level": 1 | 2, "factRefs" }',
  instructions: '{ "type": "instructions", "text", "factRefs" }',
  paragraph: '{ "type": "paragraph", "text", "factRefs" }',
  question: '{ "type": "question", "text", "answer", "answerLines": 1–6, "marks"?, "factRefs" }',
  "multiple-choice":
    '{ "type": "multiple-choice", "text", "options": [exactly 4 { "text", "correct" }, exactly one correct], "factRefs" }',
  "fill-gap":
    '{ "type": "fill-gap", "sentence" (one ___ per answer), "answers": [1–4 strings], "factRefs" } — no "text" key; put any instruction in an instructions block before it',
  matching:
    '{ "type": "matching", "pairs": [3–5 { "left", "right" }], "factRefs" } — no "text" key',
  "word-bank": '{ "type": "word-bank", "words": [3–10 strings], "factRefs" } — no "text" key',
} as const;

export const generateWorksheetPrompt = {
  version: "generate-worksheet.v3",
  system: [
    "You write the practice worksheet that goes with a classroom lesson, from the lesson's facts.",
    "You supply the blocks' text and answers only; a layout recipe paginates them.",
    "",
    "Rules:",
    HOUSE_RULES,
    `Use only these block types: ${GENERATABLE_BLOCK_TYPES.join(", ")}.`,
    "Give 4–10 blocks, never more. Open with a heading and an instructions block; every objective is practised by at least one question, multiple-choice, fill-gap or matching block; end with one harder question.",
    "The JSON shape per block type — exactly these keys, no others:",
    ...Object.entries(BLOCK_SHAPES).map(([type, shape]) => `- ${type}: ${shape}`),
    'The top level always has all four keys: "title", "subtitle", "criteria", "blocks".',
    "Every question has a full model answer (this is the answer key). Multiple-choice has exactly four options with exactly one correct; fill-gap sentences use one ___ per answer; matching has 3–5 pairs; a word bank lists 3–10 words.",
    "`criteria` are up to four 'I can …' success criteria matching the objectives; `subtitle` is the lesson objective in one line.",
    "Put the ids of the facts each block draws on in its `factRefs`.",
    limitsBlock({
      title: SPEC_LIMITS.title,
      subtitle: SPEC_LIMITS.heading,
      "each criterion": SPEC_LIMITS.item,
      "block text": SPEC_LIMITS.body,
      answer: SPEC_LIMITS.body,
      "option text": SPEC_LIMITS.option,
      "gap answer": SPEC_LIMITS.answer,
      "matching side": SPEC_LIMITS.definition,
      word: SPEC_LIMITS.word,
    }),
    "",
    "Answer as JSON in this shape:",
    example({
      title: "States of matter",
      subtitle: "I can describe solids, liquids and gases in terms of particles",
      criteria: ["Name the three states", "Describe how particles are arranged"],
      blocks: [
        { type: "heading", text: "States of matter", level: 1, factRefs: [] },
        { type: "instructions", text: "Answer every question in full sentences.", factRefs: [] },
        {
          type: "question",
          text: "Why does a solid keep its shape?",
          answer: "Its particles are packed closely and can only vibrate in place.",
          answerLines: 3,
          marks: 2,
          factRefs: ["o1", "x1"],
        },
        {
          type: "multiple-choice",
          text: "In which state are particles furthest apart?",
          options: [
            { text: "Solid", correct: false },
            { text: "Liquid", correct: false },
            { text: "Gas", correct: true },
            { text: "All the same", correct: false },
          ],
          factRefs: ["q1"],
        },
      ],
    }),
  ].join("\n"),
  user(input: GenerateWorksheetInput): string {
    const parts = [
      `Lesson: ${input.lessonTitle}`,
      audienceBlock(input.audience),
      "",
      factsBlock(input.facts),
    ];
    if (input.slideTexts.length > 0) {
      parts.push("", "The slides taught:", ...input.slideTexts.map((t, i) => `[${i + 1}] ${t}`));
    }
    parts.push("", "Answer with the worksheet JSON.");
    return parts.join("\n");
  },
} as const;
