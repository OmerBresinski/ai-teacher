import { BLOCK_GUIDES } from "@tj/domain/documents";
import type { BlockSpec } from "@tj/slides";
import { SPEC_LIMITS } from "@tj/slides";
import { BLOCK_SHAPES, type GenerateWorksheetInput, worksheetBrief } from "./generate-worksheet";
import { example, HOUSE_RULES, limitsBlock } from "./shared";

/*
 * Worksheet fill (ADR 0030 item 3; TDD §7; TEACH-14): the worksheet job frames the sheet from a
 * recipe with no model call — headings, instructions, derived blocks and placeholder slots — and
 * asks one `small` call at low effort for the placeholder slots only. This prompt carries what
 * `generate-worksheet` carried (pool stems and answers only, reserved stems never, every
 * objective practised, tiers in order) and adds the slots: each says which block types it allows
 * and how many blocks it takes, which `worksheetFillSchemaFor` checks as shape rules. The block
 * shapes are `BLOCK_SHAPES`, the per-type guides `BLOCK_GUIDES`. Bump `version` whenever the
 * wording changes.
 */

/** The block types a slot may be filled with: exactly the ones a block spec can describe. */
export type FillBlockType = keyof typeof BLOCK_SHAPES;

export type WorksheetFillSlot = {
  /** Position of the placeholder in the framed sheet's block list. */
  index: number;
  allowedTypes: FillBlockType[];
  /** Blocks the slot takes, low to high inclusive. */
  count: [number, number];
};

export type WorksheetFillRecipe = {
  id: string;
  /** The recipe's job in the teacher's words (starter, practise, homework, …). */
  job: string;
  fillSlots: WorksheetFillSlot[];
  /** Minutes of pupil time the filled blocks should take together. */
  minutesBudget: number;
};

export type GenerateWorksheetFillInput = GenerateWorksheetInput & { recipe: WorksheetFillRecipe };

/** What the fill call returns: the blocks for each slot, by the slot's index. */
export type WorksheetFill = { slots: { index: number; blocks: BlockSpec[] }[] };

const EXAMPLE: WorksheetFill = {
  slots: [
    {
      index: 3,
      blocks: [
        {
          type: "multiple-choice",
          text: "In which state are particles furthest apart?",
          options: [
            { text: "Solid", correct: false },
            { text: "Liquid", correct: false },
            { text: "Gas", correct: true },
            { text: "All the same", correct: false },
          ],
          factRefs: ["q1", "o1"],
        },
        {
          type: "question",
          text: "Why does a solid keep its shape?",
          answer: "Its particles are packed closely and can only vibrate in place.",
          answerLines: 4,
          marks: 2,
          factRefs: ["q3", "o1"],
        },
      ],
    },
  ],
};

/** "exactly 1 block", "2–3 blocks". */
const countOf = ([low, high]: [number, number]) =>
  `${low === high ? `exactly ${low}` : `${low}–${high}`} ${high === 1 ? "block" : "blocks"}`;

export const generateWorksheetFillPrompt = {
  version: "generate-worksheet-fill.v1",
  system: [
    "You write the practice blocks of a worksheet that a layout recipe has already framed, from the lesson's facts.",
    "The recipe wrote the headings, instructions and any blocks it derives itself. You fill only the numbered slots the brief lists; you never rewrite, move or add to the frame.",
    "",
    "Rules:",
    HOUSE_RULES,
    "You are told the lesson's objective verb and what practice is for under it; every block practises that.",
    "Each slot says which block types it allows and how many blocks it takes. Use only those types, within that count.",
    "Build the blocks from the questions in the pool: use a pool question's stem, answer and distractors as given. Write a new stem only when the pool has none left for the tier, and never one from the reserved list.",
    'Within a slot, order the questions by tier: "easy", then "core", then "stretch". Across the sheet, every objective is practised by at least one block.',
    "Each block's `factRefs` names the question it uses and the objectives it practises (the question's own objective ids).",
    "Every question has a full model answer for the answer key.",
    "The brief gives the JSON shape of each allowed block type and a guide to writing it — exactly those keys, no others. Where the guide's counts differ from the shape's, the shape wins: it is what the sheet accepts.",
    "The blocks together take about the minutes the brief gives: fewer, shorter blocks for a small budget.",
    limitsBlock({
      "block text": SPEC_LIMITS.body,
      answer: SPEC_LIMITS.body,
      "option text": SPEC_LIMITS.option,
      "gap answer": SPEC_LIMITS.answer,
      "matching side": SPEC_LIMITS.definition,
      word: SPEC_LIMITS.word,
    }),
    "",
    "Answer as JSON in this shape, one entry per slot in the brief:",
    example(EXAMPLE),
  ].join("\n"),
  user(input: GenerateWorksheetFillInput): string {
    const { recipe } = input;
    const parts = worksheetBrief(input);
    parts.push(
      "",
      `Recipe: ${recipe.id} (${recipe.job}). The filled blocks take about ${recipe.minutesBudget} minutes.`,
      "Slots to fill:",
    );
    for (const slot of recipe.fillSlots) {
      parts.push(
        `  slot ${slot.index}: ${countOf(slot.count)}; types: ${slot.allowedTypes.join(", ")}`,
      );
    }
    const types = Array.from(new Set(recipe.fillSlots.flatMap((slot) => slot.allowedTypes)));
    parts.push("Block types you may use:");
    for (const type of types) {
      const guide = BLOCK_GUIDES[type];
      parts.push(
        `- ${type}: ${BLOCK_SHAPES[type]}`,
        `  ${guide.guide}`,
        `  Good: ${guide.good}`,
        `  Bad: ${guide.bad}`,
      );
    }
    parts.push("", "Answer with the fill JSON.");
    return parts.join("\n");
  },
} as const;
