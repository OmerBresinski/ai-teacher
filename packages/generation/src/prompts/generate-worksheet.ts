import { GENERATABLE_BLOCK_TYPES, type LessonFacts } from "@tj/domain/documents";
import { type Audience, audienceBlock, example, factsBlock, HOUSE_RULES } from "./shared";

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

export const generateWorksheetPrompt = {
  version: "generate-worksheet.v1",
  system: [
    "You write the practice worksheet that goes with a classroom lesson, from the lesson's facts.",
    "You supply the blocks' text and answers only; a layout recipe paginates them.",
    "",
    "Rules:",
    HOUSE_RULES,
    `Use only these block types: ${GENERATABLE_BLOCK_TYPES.join(", ")}.`,
    "Give 4–10 blocks. Open with a heading and an instructions block; every objective is practised by at least one question, multiple-choice, fill-gap or matching block; end with one harder question.",
    "Every question has a full model answer (this is the answer key). Multiple-choice has exactly four options with exactly one correct; fill-gap sentences use one ___ per answer; matching has 3–5 pairs; a word bank lists 3–10 words.",
    "`criteria` are up to four 'I can …' success criteria matching the objectives; `subtitle` is the lesson objective in one line.",
    "Put the ids of the facts each block draws on in its `factRefs`.",
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
