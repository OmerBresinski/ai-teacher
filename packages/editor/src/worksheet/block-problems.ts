import type { WorksheetBlock } from "@tj/domain/documents";
import { BLOCK_GUIDES } from "@tj/domain/documents";
import { PLACEHOLDER_QUESTION } from "../model/worksheet-recipes";
import { docToPlainText } from "../text/static";
import { wordSearchProblems } from "./word-search";

/*
 * What is wrong with one block, in the teacher's words (TEACH-194, ruling 61). Pure: reads the
 * block and `BLOCK_GUIDES.shape`, nothing else. `BlockShell` shows the lines through the same
 * inline hint as the oversize warning, on the selected block only, so a teacher sees the fault
 * where it is and the sheet never prints a block a pupil cannot act on.
 */

const quote = (text: string) => `“${text}”`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * A stem the teacher has not written yet: empty (a fresh insert, `blankStem`) or a recipe's
 * placeholder question. The answer rules wait until there is a question to answer, so a block the
 * teacher is still typing into does not carry a hint about the key.
 */
function unwritten(doc: Parameters<typeof docToPlainText>[0]): boolean {
  const text = docToPlainText(doc).trim();
  return text === "" || text === PLACEHOLDER_QUESTION;
}

export function blockProblems(block: WorksheetBlock): string[] {
  const problems: string[] = [];
  switch (block.type) {
    case "question": {
      if (unwritten(block.doc)) break;
      if (!block.answer?.trim()) problems.push("No answer for the key. Add one in the toolbar.");
      break;
    }
    case "multiple-choice": {
      const [min, max] = BLOCK_GUIDES["multiple-choice"].shape.options ?? [2, 4];
      const correct = block.options.filter((option) => option.correct).length;
      if (correct === 0 && unwritten(block.doc)) {
        // Nothing to mark yet.
      } else if (correct === 0)
        problems.push("No option is marked correct. Tick one on the sheet.");
      else if (correct > 1) {
        problems.push(`${correct} options are marked correct. Only one should be.`);
      }
      if (block.options.length < min) {
        problems.push(`Multiple choice needs at least ${min} options.`);
      } else if (block.options.length > max) {
        problems.push(`Multiple choice takes at most ${max} options.`);
      }
      break;
    }
    case "matching": {
      const [min] = BLOCK_GUIDES.matching.shape.pairs ?? [3, 6];
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const pair of block.pairs) {
        const right = pair.right.trim().toLowerCase();
        if (!right) continue;
        if (seen.has(right)) duplicates.add(pair.right.trim());
        seen.add(right);
      }
      for (const right of duplicates) {
        problems.push(
          `${quote(right)} appears twice on the right. Every right-hand item must be different.`,
        );
      }
      if (block.pairs.length < min) problems.push(`Matching needs at least ${min} pairs.`);
      break;
    }
    case "fill-gap": {
      const blank = block.gaps.filter((gap) => !gap.answer.trim()).length;
      if (blank > 0) {
        problems.push(
          `${blank} ${plural(blank, "gap has", "gaps have")} no answer. Add ${plural(blank, "it", "them")} under Gaps in the toolbar.`,
        );
      }
      break;
    }
    case "word-search": {
      const { overlong, unplaced } = wordSearchProblems(block);
      for (const word of overlong) {
        problems.push(
          `${quote(word)} is longer than the grid. Make the grid bigger or the word shorter.`,
        );
      }
      for (const word of unplaced) {
        problems.push(`${quote(word)} could not be placed. Shuffle or make the grid bigger.`);
      }
      break;
    }
    default:
      break;
  }
  return problems;
}
