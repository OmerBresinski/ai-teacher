import type { WorksheetBlock } from "./worksheet";

/**
 * One source per block type for what the block is called, what it does, the instruction line a
 * pupil needs before it, the shape it may take and the guide a generator reads (TEACH-194; block
 * review of 9 Sept 2026, rulings 61 to 63). The editor's Blocks tab and slash menu read `label`
 * and `line`; the insert rule and the recipes read `instruction`; the toolbars and the inline
 * block checks read `shape`; the generation prompt reads `guide`, `good` and `bad` (TEACH-197).
 * Nothing here calls a model.
 */

/** Counts a block may take, low to high inclusive. Only the keys that apply to the type are set. */
export type BlockShape = {
  /** Multiple choice options. */
  options?: [number, number];
  /** Options marked correct. */
  correct?: number;
  /** Matching pairs. */
  pairs?: [number, number];
  /** Every right-hand side of a matching block is different from every other. */
  rightUnique?: boolean;
  /** Fill-gap answers, one per `___`. */
  answers?: [number, number];
  /** Words in a word bank or word search. */
  words?: [number, number];
  /** Ruled lines under a question. */
  answerLines?: [number, number];
  /** Marks on a question. */
  marks?: [number, number];
};

export type BlockGuide = {
  /** The name a teacher sees in the Blocks tab and the slash menu. */
  label: string;
  /** The one-line description under the label. */
  line: string;
  /**
   * The instruction line inserted before the block when none exists since the last heading, or
   * `null` when the block prints its own lead or needs none.
   */
  instruction: string | null;
  shape: BlockShape;
  /** What the block is for and how to write one, for the generator. */
  guide: string;
  good: string;
  bad: string;
};

/** The fill-gap instruction when a word bank sits above the sentences. */
export const FILL_GAP_BANK_INSTRUCTION =
  "Fill each gap with a word from the bank. Each word is used once.";

/** The word bank's own line, for a bank inserted with no fill-gap after it. */
export const WORD_BANK_INSTRUCTION = "Use these words in the sentences below.";

/** The instruction before a two-column sorting table. */
export const SORTING_TABLE_INSTRUCTION = "Write each item in the correct column.";

export const BLOCK_GUIDES: Record<WorksheetBlock["type"], BlockGuide> = {
  heading: {
    label: "Heading",
    line: "A section title on the sheet",
    instruction: null,
    shape: {},
    guide:
      "A heading names a section of the sheet. Use one level-1 heading at the top with the sheet's topic, and a level-2 heading when the sheet changes task (for example 'Now try'). Never use a heading to ask a question or give an instruction.",
    good: "'Rodents'.",
    bad: "'Answer these questions about rodents'.",
  },
  paragraph: {
    label: "Paragraph",
    line: "Text for pupils to read",
    instruction: null,
    shape: {},
    guide:
      "A paragraph is text the pupil reads: a short passage, a worked example, or context for the questions that follow. Pitch it at the reading level. Put an instructions block before a passage that questions depend on. Never use a paragraph for an instruction, a question or a list of words.",
    good: "Three sentences about how rodents' teeth grow.",
    bad: "'In this section you will answer questions about rodents.'",
  },
  instructions: {
    label: "Instructions",
    line: "How to do the task, in one line",
    instruction: null,
    shape: {},
    guide:
      "An instructions block tells the pupil what to do with the blocks that follow, in one or two plain sentences addressed to them. Open the sheet with one, and put one before any matching, fill-gap, word bank or multiple choice section so the pupil knows how to answer.",
    good: "'Tick one box for each question.'",
    bad: "'This worksheet covers the objectives of the lesson.'",
  },
  question: {
    label: "Question",
    line: "Numbered, with marks and ruled lines",
    instruction: null,
    shape: { answerLines: [1, 6], marks: [1, 6] },
    guide:
      "A question asks for a written answer and gives ruled lines for it. Choose it for recall, explanation and reasoning. Give marks (1 for recall, 2 for an explanation, 3 or more for reasoning) and let the lines follow the marks: 2 lines for 1 mark, 4 for 2, 6 for 3 or more. The answer is the full model answer a teacher would mark against, not a hint. Do not ask a question whose answer appears in a later block.",
    good: "'Explain why a rodent's front teeth never stop growing.' (2 marks, 4 lines).",
    bad: "'Rodents are mammals. True or false?' with 6 lines.",
  },
  "multiple-choice": {
    label: "Multiple choice",
    line: "Lettered options with a box to tick",
    instruction: "Tick one box for each question.",
    shape: { options: [2, 4], correct: 1 },
    guide:
      "A multiple choice question gives 2 to 4 options with exactly one correct. Choose it to check one fact quickly, or to surface a misconception: make the wrong options the mistakes pupils actually make, not nonsense. For true or false, write the statement as the stem and give exactly two options, 'True' and 'False'. Keep options the same length and shape so the odd one out is not the answer.",
    good: "'Which of these is a rodent?' A Rabbit, B Squirrel, C Hedgehog, D Bat (B correct).",
    bad: "'True or false: all rodents are small.' with four options.",
  },
  "fill-gap": {
    label: "Fill the gap",
    line: "A sentence with blanks to complete",
    instruction: "Fill each gap with the missing word.",
    shape: { answers: [1, 4] },
    guide:
      "A fill-gap sentence has one ___ per missing word and one answer per ___, in order. Choose it to practise vocabulary or a key sentence. Gap the term, not a function word. One to four gaps; one sentence. If the sheet has a word bank, every answer must be in it and the bank must hold every answer.",
    good: "'A ___ is a mammal with front teeth that never stop growing.' answers ['rodent'].",
    bad: "'Rodents ___ ___ ___.'",
  },
  matching: {
    label: "Matching",
    line: "Two columns to match up by letter",
    instruction: "Match each item on the left to one on the right. Write the letter in the box.",
    shape: { pairs: [3, 6], rightUnique: true },
    guide:
      "A matching block pairs 3 to 6 items on the left with their partners on the right: term to definition, cause to effect, example to category name. Every right-hand item must be different from every other, because the right column is shuffled and lettered. If several left items share one answer (rodent or not a rodent, true or false), that is a sorting task, not matching: use a table with two columns or one two-option multiple choice per item instead.",
    good: "'Incisor' to 'A front tooth for gnawing', 'Nocturnal' to 'Active at night'.",
    bad: "'Rat' to 'Rodent', 'Mouse' to 'Rodent', 'Rabbit' to 'Non-rodent'.",
  },
  "word-search": {
    label: "Word search",
    line: "A letter grid with the words to find",
    // The block prints its own lead ("Find every word. They run across and down.").
    instruction: null,
    shape: { words: [4, 10] },
    guide:
      "A word search hides 4 to 10 vocabulary terms in a letter grid. Choose it for a starter or for spelling practice, never to assess understanding. Each word is letters only, at most the grid side long, and no word may contain another. The block prints its own instruction; do not add one.",
    good: "rodent, incisor, burrow, nocturnal, gnaw.",
    bad: "'front teeth', 'ratsandmice'.",
  },
  "word-bank": {
    label: "Word bank",
    line: "Words to use in the fill-the-gap sentences below it",
    // The fill-gap line covers a bank above its sentences; a bank on its own gets
    // `WORD_BANK_INSTRUCTION`.
    instruction: null,
    shape: { words: [3, 10] },
    guide:
      "A word bank lists the words a pupil chooses from for the fill-gap sentences that follow it. Put it directly after the instruction and before the sentences, once per section. It must contain every gap answer, in mixed order, and at most one extra word. Do not use it as a vocabulary list on its own; that is a paragraph or a table.",
    good: "Bank [burrow, incisor, nocturnal] before three gap sentences with those answers.",
    bad: "A bank of ten words with no fill-gap block on the sheet.",
  },
  "answer-box": {
    label: "Answer box",
    line: "A blank box with a label, for working or a drawing",
    // The label is the instruction; the factory's default label is "Show your working".
    instruction: null,
    shape: {},
    guide:
      "An answer box is blank space with a short label saying what goes in it: working, a drawing, a sentence of reflection. Always give the label. Choose it after a question that needs working or a diagram, or at the end for 'One thing I learned'.",
    good: "Label 'Draw and label a rodent's skull'.",
    bad: "An unlabelled box after a multiple choice question.",
  },
  lines: {
    label: "Lines",
    line: "Extra ruled lines under a paragraph or instruction",
    instruction: null,
    shape: {},
    guide:
      "Lines are extra writing space under a paragraph or instruction that asks for writing but is not a numbered question (a plan, a summary). Prefer a question block, which brings its own lines and a number.",
    good: "'Write a summary of the passage in three sentences.' then 4 lines.",
    bad: "6 lines with nothing above them.",
  },
  image: {
    label: "Image",
    line: "A picture with an optional caption",
    instruction: null,
    shape: {},
    guide:
      "An image shows something the questions refer to. Give a caption a pupil reads and alt text a screen reader reads. Ask about it in a question block after it.",
    good: "A labelled diagram of an incisor with the caption 'Figure 1: a rodent's incisor'.",
    bad: "A decorative picture with no caption.",
  },
  table: {
    label: "Table",
    line: "A table to read or complete",
    instruction: "Complete the table.",
    shape: {},
    guide:
      "A table is either reference (all cells filled) or a task (some cells blank for the pupil). Say which with an instruction before it. Use a two-column task table for sorting: headings are the categories, the items to sort are listed in the instruction, cells are blank. Give the completed table as the answer.",
    good: "Headings 'Rodent' and 'Not a rodent', instruction 'Sort these animals: rat, rabbit, squirrel, hedgehog.'",
    bad: "A matching block whose right column is 'Rodent' and 'Non-rodent'.",
  },
  divider: {
    label: "Divider",
    line: "A hairline between sections",
    instruction: null,
    shape: {},
    guide:
      "A divider is a hairline between two sections; use it only where a heading would be too much. Never end a sheet with one.",
    good: "One rule between the starter and the main task.",
    bad: "A divider as the last block on the sheet.",
  },
  "page-break": {
    label: "Page break",
    line: "Start the next page here",
    instruction: null,
    shape: {},
    guide:
      "A page break starts the next page; use it before an exam-style section or a passage that must sit with its questions. Never break inside a question's lines.",
    good: "A page break before 'Exam style questions'.",
    bad: "A page break between a question and its answer lines.",
  },
};

/**
 * Block types a pupil acts on that never print without an instruction line (ruling 61). Every
 * one has a non-null `instruction` in `BLOCK_GUIDES`, except the word bank, whose line belongs to
 * the fill-gap sentences it feeds (`WORD_BANK_INSTRUCTION` covers a bank on its own). A table is a
 * task only when its cells are blank (the editor's Sorting table entry), so it is not listed; its
 * guide keeps "Complete the table." for the generator.
 */
export const TASK_BLOCK_TYPES: WorksheetBlock["type"][] = [
  "multiple-choice",
  "fill-gap",
  "matching",
  "word-bank",
];

/** The default instruction a task block of this type needs before it, or `null`. */
export function defaultInstruction(type: WorksheetBlock["type"]): string | null {
  if (type === "word-bank") return WORD_BANK_INSTRUCTION;
  return BLOCK_GUIDES[type].instruction;
}
