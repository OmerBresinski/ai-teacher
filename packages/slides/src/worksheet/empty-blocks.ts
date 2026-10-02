import type { LessonFacts, WorksheetBlock } from "@tj/domain/documents";
import { richDocToPlainText } from "@tj/domain/documents";
import {
  isPlaceholder,
  LESSON_RECIPE,
  PLACEHOLDER_QUESTION,
  type WorksheetRecipe,
} from "./recipes";

/*
 * What a teacher cannot photocopy (TEACH-86 FR 6): a block whose text is empty, a word bank or a
 * matching block with fewer than three entries, a word search with no terms, and the
 * `PLACEHOLDER_QUESTION` copy. The worksheet check turns each into an `error` finding for its one
 * repair; a recipe whose frame would print one falls back to `LESSON_RECIPE`.
 */

/** The fewest entries a word bank or a matching block may print with. */
export const MIN_LIST_ENTRIES = 3;

export type EmptyBlock = { blockId: string; reason: string };

const docText = (block: WorksheetBlock): string | undefined =>
  "doc" in block && block.doc ? richDocToPlainText(block.doc).trim() : undefined;

/** Why a block would print empty or as placeholder copy, or `undefined` when it is fine. */
export function emptyBlockReason(block: WorksheetBlock): string | undefined {
  if (isPlaceholder(block)) return undefined;
  const text = docText(block);
  if (text?.includes(PLACEHOLDER_QUESTION)) {
    return `It still says "${PLACEHOLDER_QUESTION}".`;
  }
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "instructions":
    case "question":
    case "multiple-choice":
    case "fill-gap":
      if (!text) return "It has no text.";
      if (block.type === "multiple-choice" && block.options.length < 2) {
        return "It has fewer than two options.";
      }
      if (block.type === "fill-gap" && block.gaps.length === 0) return "It has no gaps.";
      return undefined;
    case "word-bank":
      return block.words.filter((w) => w.trim()).length < MIN_LIST_ENTRIES
        ? `The word bank has fewer than ${MIN_LIST_ENTRIES} words.`
        : undefined;
    case "matching":
      return block.pairs.filter((p) => p.left.trim() && p.right.trim()).length < MIN_LIST_ENTRIES
        ? `The matching task has fewer than ${MIN_LIST_ENTRIES} pairs.`
        : undefined;
    case "word-search":
      return block.words.filter((w) => w.trim()).length === 0
        ? "The word search has no words to find."
        : undefined;
    default:
      return undefined;
  }
}

/** Every block on the sheet that would print empty or as placeholder copy. */
export function emptyBlocks(blocks: readonly WorksheetBlock[]): EmptyBlock[] {
  return blocks.flatMap((block) => {
    const reason = emptyBlockReason(block);
    return reason === undefined ? [] : [{ blockId: block.id, reason }];
  });
}

export type RecipeChoice = {
  recipe: WorksheetRecipe;
  /** Set when the requested recipe was swapped for `LESSON_RECIPE`: why, for the job log. */
  fellBackFrom?: { recipeId: WorksheetRecipe["id"]; reasons: string[] };
};

/**
 * The recipe the job builds: the one requested, unless its frame from these facts would print an
 * empty block (thin facts: no vocabulary, too few questions), in which case "Follows the lesson".
 */
export function recipeForFacts(recipe: WorksheetRecipe, facts: LessonFacts): RecipeChoice {
  if (recipe.id === LESSON_RECIPE.id) return { recipe };
  const empty = emptyBlocks(recipe.build(facts));
  if (empty.length === 0) return { recipe };
  return {
    recipe: LESSON_RECIPE,
    fellBackFrom: {
      recipeId: recipe.id,
      reasons: Array.from(new Set(empty.map((e) => e.reason))),
    },
  };
}
