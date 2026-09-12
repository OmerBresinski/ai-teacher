import {
  type FactQuestion,
  GENERATABLE_BLOCK_TYPES,
  type KeyIdea,
  type Misconception,
  type Pitch,
} from "@tj/domain/documents";
import { SPEC_LIMITS } from "@tj/slides";
import {
  type Audience,
  audienceBlock,
  example,
  HOUSE_RULES,
  limitsBlock,
  verbBlock,
  type WritingShape,
} from "./shared";

/*
 * Generate — the worksheet (ADR 0025 §4, §8; Generation quality §3, TEACH-213): one call for the
 * whole sheet's block specs; the answers become the answer key. The sheet is written from its own
 * question pool — the plan's `use: worksheet | any` questions, in three tiers — concurrently with
 * the slides, with the stems the slides took as an exclusion list, so it practises rather than
 * repeats. Since TEACH-230 it is told the objective verb too (`verbBlock`): what the practice is
 * for — stating, explaining, working a method or judging.
 */

export type GenerateWorksheetInput = {
  /** The objectives, by id, so each block can name the ones it practises. */
  objectives: { id: string; text: string }[];
  /** The lesson's objective verb and the class's prior confidence (`lessonShapeOf`, TEACH-230). */
  shape: WritingShape;
  keyIdeas: KeyIdea[];
  misconceptions: Misconception[];
  /** The questions the plan set aside for the sheet (`use: worksheet | any`). */
  pool: FactQuestion[];
  /** Stems the slides and the exit ticket use; never on the sheet. */
  reservedStems: string[];
  pitch?: Pitch | undefined;
  audience: Audience;
  lessonTitle: string;
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
  version: "generate-worksheet.v7",
  system: [
    "You write the practice worksheet that goes with a classroom lesson, from the lesson's facts.",
    "You supply the blocks' text and answers only; a layout recipe paginates them.",
    "",
    "Rules:",
    HOUSE_RULES,
    "You are told the lesson's objective verb and what practice is for under it; every block practises that.",
    `Use only these block types: ${GENERATABLE_BLOCK_TYPES.join(", ")}.`,
    "Give 4–12 blocks, never more. Open with a heading and an instructions block. Then three tiers in order — two or three easy blocks, three or four core, one or two stretch — built from the questions in the pool: use a pool question's stem, answer and distractors as given; write a new stem only when the pool for a tier is empty, and never one from the reserved list. Every objective is practised by at least one block.",
    "Each block's `factRefs` names the question it uses and the objectives it practises (the question's own objective ids).",
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
      verbBlock(input.shape),
      "",
      "Objectives:",
    ];
    for (const o of input.objectives) parts.push(`  ${o.id}: ${o.text}`);
    if (input.keyIdeas.length > 0) {
      parts.push("Key ideas taught:");
      for (const k of input.keyIdeas) {
        parts.push(`  ${k.id}: ${k.statement} [${k.objectiveRefs.join(", ")}]`);
      }
    }
    if (input.misconceptions.length > 0) {
      parts.push("Misconceptions to practise against:");
      for (const m of input.misconceptions) {
        parts.push(`  ${m.id}: believes ${m.belief}; correct: ${m.correction}`);
      }
    }
    parts.push("", "Question pool for the sheet (tier, use) [objectives]:");
    for (const q of input.pool) {
      const tags = [q.tier, q.use].filter(Boolean).join(", ");
      const objectives = q.objectiveRefs ? ` [${q.objectiveRefs.join(", ")}]` : "";
      parts.push(`  ${q.id}: ${q.stem}${tags ? ` (${tags})` : ""}${objectives}`);
      parts.push(`    Answer: ${q.answer} (${q.reasoning})`);
      if (q.distractors && q.distractors.length > 0) {
        parts.push(`    Distractors: ${q.distractors.map((d) => d.text).join("; ")}`);
      }
    }
    if (input.pitch) {
      const avoid = input.pitch.avoid.length > 0 ? `; avoid: ${input.pitch.avoid.join(", ")}` : "";
      parts.push(
        "",
        `Pitch: reading age ${input.pitch.readingAgeTarget}, sentences of at most ${input.pitch.sentenceLengthMax} words${avoid}.`,
      );
    }
    if (input.reservedStems.length > 0) {
      parts.push("", "Used on the slides and exit ticket — do not use these stems:");
      for (const stem of input.reservedStems) parts.push(`  - ${stem}`);
    }
    parts.push("", "Answer with the worksheet JSON.");
    return parts.join("\n");
  },
} as const;
