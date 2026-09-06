import type { Id, Worksheet, WorksheetBlock } from "@tj/domain/documents";
import { MAX_CRITERIA } from "@tj/domain/documents";
import { docFromText, now, uid } from "./factories";
import { PLACEHOLDER_IMAGE } from "./layouts";

/** Default word-search grid side in cells (TeachDeck `lib/worksheet/word-search.ts:15`). */
export const WORD_SEARCH_DEFAULT_SIZE = 12;

/**
 * Worksheet document factories. Defaults follow docs/research/02 §2:
 * Name / Date / Class header, marks in brackets, and answer-line count derived
 * from the marks rather than set by hand (decision 16).
 */

export type WorksheetBlockType = WorksheetBlock["type"];

// `MAX_CRITERIA` lives in `@tj/domain/documents` (ADR 0021); re-exported for callers of this module.
export { MAX_CRITERIA };

/** AQA convention: the number of lines is a guide to how much to write. */
export function answerLinesForMarks(marks: number | undefined): number {
  if (!marks || marks <= 1) return 2;
  if (marks === 2) return 4;
  return 6;
}

export function newWorksheet(title = "Untitled worksheet", themeId = "chalk"): Worksheet {
  const ts = now();
  return {
    version: 1,
    id: uid(),
    title,
    themeId,
    createdAt: ts,
    updatedAt: ts,
    header: { showName: true, showDate: true, showClass: true, title },
    blocks: [],
    includeAnswerKey: false,
    pageSize: "A4",
  };
}

/** A block of the given type with usable teacher-voice defaults. */
export function newBlock(type: WorksheetBlockType): WorksheetBlock {
  const id: Id = uid();
  switch (type) {
    case "heading":
      return { id, type: "heading", doc: docFromText("Section heading"), level: 1 };
    case "paragraph":
      return {
        id,
        type: "paragraph",
        doc: docFromText("Write the text pupils need to read here."),
      };
    case "instructions":
      return {
        id,
        type: "instructions",
        doc: docFromText("Answer all of the questions in the spaces provided."),
      };
    case "question":
      return {
        id,
        type: "question",
        doc: docFromText("Write your question here."),
        answerLines: answerLinesForMarks(1),
        marks: 1,
      };
    case "multiple-choice":
      return {
        id,
        type: "multiple-choice",
        doc: docFromText("Which of these is correct?"),
        options: [
          { id: uid(), text: "Option A", correct: true },
          { id: uid(), text: "Option B", correct: false },
          { id: uid(), text: "Option C", correct: false },
          { id: uid(), text: "Option D", correct: false },
        ],
      };
    case "fill-gap": {
      const gapA = uid();
      const gapB = uid();
      return {
        id,
        type: "fill-gap",
        doc: docFromText(
          `Complete the sentence: water [[gap:${gapA}]] when it is heated and [[gap:${gapB}]] when it cools.`,
        ),
        gaps: [
          { id: gapA, answer: "evaporates" },
          { id: gapB, answer: "condenses" },
        ],
      };
    }
    case "matching":
      return {
        id,
        type: "matching",
        pairs: [
          { id: uid(), left: "Term one", right: "Definition in one sentence" },
          { id: uid(), left: "Term two", right: "Definition in one sentence" },
          { id: uid(), left: "Term three", right: "Definition in one sentence" },
        ],
      };
    case "word-search":
      return {
        id,
        type: "word-search",
        words: ["water", "cloud", "river", "rain", "ocean", "vapour"],
        size: WORD_SEARCH_DEFAULT_SIZE,
        directions: "across-down",
        // A fixed starting seed, so a new block looks the same every time and
        // "Shuffle" is the only thing that changes the grid.
        seed: 1,
        showWordBank: true,
      };
    case "word-bank":
      return { id, type: "word-bank", words: ["word", "word", "word", "word"] };
    case "answer-box":
      return { id, type: "answer-box", heightPt: 120, label: "Show your working" };
    case "lines":
      return { id, type: "lines", count: 4 };
    case "image":
      return {
        id,
        type: "image",
        src: PLACEHOLDER_IMAGE,
        alt: "Describe this image for pupils using a screen reader",
        widthPct: 60,
        caption: "Figure 1",
      };
    case "table":
      return {
        id,
        type: "table",
        rows: [
          ["Heading", "Heading"],
          ["", ""],
          ["", ""],
        ],
        header: true,
      };
    case "divider":
      return { id, type: "divider" };
    case "page-break":
      return { id, type: "page-break" };
  }
}

/** Blocks that carry a question number, in document order. */
export function isNumbered(block: WorksheetBlock): boolean {
  return (
    block.type === "question" ||
    block.type === "multiple-choice" ||
    block.type === "fill-gap" ||
    block.type === "matching" ||
    block.type === "word-search"
  );
}

/** Recompute automatic question numbering (SPEC §9). Returns a new array. */
export function numberQuestions(blocks: WorksheetBlock[]): WorksheetBlock[] {
  let n = 0;
  return blocks.map((b) => (isNumbered(b) ? { ...b, number: ++n } : b));
}

/**
 * The seed used by "New worksheet": a header, an instruction line and a short
 * mixed set, so a teacher lands on something printable rather than a blank page.
 */
export function starterWorksheet(title = "Untitled worksheet", themeId = "chalk"): Worksheet {
  const sheet = newWorksheet(title, themeId);
  const question = (prompt: string, marks: number): WorksheetBlock => ({
    id: uid(),
    type: "question",
    doc: docFromText(prompt),
    answerLines: answerLinesForMarks(marks),
    marks,
  });
  sheet.blocks = numberQuestions([
    {
      id: uid(),
      type: "instructions",
      doc: docFromText("Answer all of the questions in the spaces provided."),
    },
    question("Write your first question here.", 1),
    question("Write a question that needs an explanation.", 2),
    newBlock("multiple-choice"),
    question("Write a longer question worth three marks.", 3),
  ]);
  return sheet;
}
