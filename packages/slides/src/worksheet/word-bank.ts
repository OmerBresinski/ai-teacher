import { fillGapRun, type Id, orderedGaps, type WorksheetBlock } from "@tj/domain/documents";
import { shuffled } from "../templates/activities";

/*
 * A word bank must not give the answers away by its order (the block guide's "in mixed order").
 * The cloze recipe takes its bank and its sentences from the same vocabulary list, and a model can
 * write a bank in gap order too, so a bank whose word sits at the position of the gap it fills is
 * reordered by the activities' seeded shuffle, seeded by the words, so the same bank always prints
 * the same way.
 */

const same = (word: string | undefined, answer: string) =>
  word !== undefined && word.trim().toLowerCase() === answer.trim().toLowerCase();

/** True when any answer sits in the bank at its own gap's position: first gap, first word. */
export function bankGivesAway(words: readonly string[], answers: readonly string[]): boolean {
  return answers.some((answer, i) => same(words[i], answer));
}

/**
 * `words` in a seeded order that keeps every answer off its own gap's position, or `words` itself
 * when it already does. A bank no order can fix (one word filling two neighbouring gaps) comes
 * back in `shuffled`'s fallback order.
 */
export function mixedBank(words: string[], answers: readonly string[]): string[] {
  if (words.length < 2 || !bankGivesAway(words, answers)) return words;
  const wordsIn = (order: number[]) => order.map((i) => words[i] as string);
  return wordsIn(
    shuffled(words.length, words.join("\n"), (order) => bankGivesAway(wordsIn(order), answers)),
  );
}

/**
 * Every word bank checked against the blanks of the fill-gap sentences right after it, and
 * reordered by `mixedBank` when it gives their answers away. With `changed`, only a bank that is in
 * it, or whose sentences are, is checked: a proposal mixes the banks it touched and leaves the
 * teacher's own alone. Returns `blocks` itself when no bank moved.
 */
export function mixWordBanks(
  blocks: WorksheetBlock[],
  changed?: ReadonlySet<Id>,
): WorksheetBlock[] {
  let moved = false;
  const out = blocks.map((block, index) => {
    if (block.type !== "word-bank") return block;
    const run = fillGapRun(blocks, index + 1);
    if (changed && !changed.has(block.id) && !run.some((s) => changed.has(s.id))) return block;
    const answers = run.flatMap((s) => orderedGaps(s).map((gap) => gap.answer));
    const words = mixedBank(block.words, answers);
    if (words === block.words) return block;
    moved = true;
    return { ...block, words };
  });
  return moved ? out : blocks;
}
