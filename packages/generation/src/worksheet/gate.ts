import {
  type Finding,
  hasLeakedPupilPhrase,
  isPlaceholder,
  normaliseText,
  PLACEHOLDER_QUESTION,
  richDocToPlainText,
  type SlideSheetRecipeId,
  type WorksheetBlock,
} from "@tj/domain/documents";
import { numberQuestions } from "@tj/slides";
import { EXIT_TICKET_MIN_ITEMS, isEarlyYears, isSpokenTask } from "@tj/slides/worksheet/digest";

/*
 * The last gate on a sheet built from the slides (worksheets plan v2 §3a-§3c, ticket T6). Pure.
 * It runs on the finished blocks, after the build, and nothing runs after it (no repair pass,
 * D7), so nothing can bring a fault back. A faulty item is dropped, never rewritten or padded;
 * too few left and the sheet fails `too-few-checked`. Every question that ships carries an
 * answer: a blank, "…" or "No answer recorded" key is a drop, never a placeholder on the sheet.
 *
 * T7 to T9 add their type rules (copy check, numbers re-checked, terms in the lesson) here.
 */

/** The fewest numbered items each type ships with after the gate (§3b "Minimum counts", D9). */
export const SHEET_MIN_ITEMS: Record<SlideSheetRecipeId, number> = {
  "exit-ticket": EXIT_TICKET_MIN_ITEMS,
  practice: 6,
  "exam-style": 3,
  "quick-quiz": 5,
  "key-words": 4,
};

/** Answers that are not answers: the key would print nothing a teacher can mark against. */
const NON_ANSWERS = new Set(
  [
    "…",
    "...",
    "n/a",
    "na",
    "see above",
    "answers will vary",
    "no answer recorded",
    "tbc",
    "todo",
  ].map(normaliseText),
);

export function isNonAnswer(answer: string | undefined): boolean {
  const text = answer?.trim() ?? "";
  if (!text || /^[.…\s-]*$/.test(text)) return true;
  return NON_ANSWERS.has(normaliseText(text));
}

const plain = (block: WorksheetBlock): string =>
  "doc" in block && block.doc ? richDocToPlainText(block.doc).replace(/\s+/g, " ").trim() : "";

const NUMBERED = new Set<WorksheetBlock["type"]>(["question", "multiple-choice"]);

/** Why this block may not ship, or `null` when it may. */
export function blockFault(block: WorksheetBlock, early: boolean): string | null {
  if (isPlaceholder(block)) return "placeholder";
  const text = plain(block);
  if (text && hasLeakedPupilPhrase(text)) return "leaked-text";
  if (block.type === "question") {
    if (!text || text === PLACEHOLDER_QUESTION) return "no-question";
    if (isNonAnswer(block.answer)) return "no-answer";
    if (early && isSpokenTask(text)) return "spoken-task";
  }
  if (block.type === "multiple-choice") {
    if (!text) return "no-question";
    if (block.options.length < 2) return "too-few-options";
    if (block.options.filter((o) => o.correct).length !== 1) return "not-one-keyed";
    if (new Set(block.options.map((o) => normaliseText(o.text))).size !== block.options.length) {
      return "repeated-option";
    }
  }
  return null;
}

export type GateInput = {
  type: SlideSheetRecipeId;
  yearGroup: string;
  blocks: readonly WorksheetBlock[];
};

export type GateResult =
  | { ok: true; blocks: WorksheetBlock[]; findings: Finding[] }
  | { ok: false; code: "too-few-checked"; blocks: WorksheetBlock[]; findings: Finding[] };

/**
 * Drop every block that may not ship, and repeats of an earlier question, then renumber. Each
 * drop is a warning finding on the saved sheet, so a sample shows what was dropped and why.
 */
export function gateSheet(input: GateInput): GateResult {
  const early = isEarlyYears(input.yearGroup);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const kept: WorksheetBlock[] = [];
  for (const block of input.blocks) {
    let fault = blockFault(block, early);
    if (fault === null && NUMBERED.has(block.type)) {
      const key = normaliseText(plain(block));
      if (seen.has(key)) fault = "repeated-question";
      seen.add(key);
    }
    if (fault === null) {
      kept.push(block);
      continue;
    }
    findings.push({
      check: `sheet-gate:${fault}`,
      severity: "warning",
      target: { blockId: block.id },
      message: `Dropped from the sheet: ${fault.replace(/-/g, " ")}.`,
    });
  }
  const blocks = numberQuestions(kept);
  const items = blocks.filter((b) => NUMBERED.has(b.type)).length;
  // Practice in Years 1-2 ships with 4 (schemas.md, D9).
  const min = input.type === "practice" && early ? 4 : SHEET_MIN_ITEMS[input.type];
  if (items < min) {
    return { ok: false, code: "too-few-checked", blocks, findings };
  }
  return { ok: true, blocks, findings };
}
