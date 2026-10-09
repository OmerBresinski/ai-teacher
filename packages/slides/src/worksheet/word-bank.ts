import type { WorksheetBlock } from "@tj/domain/documents";
import { prng } from "./word-search";

/*
 * A word bank must not give the answers away by its order (the block guide's "in mixed order").
 * The cloze recipe takes its bank and its sentences from the same vocabulary list, and a model can
 * write a bank in gap order too, so a bank whose word sits at the position of the gap it fills is
 * reordered: a shuffle seeded by the words, so the same bank always prints the same way.
 */

const same = (word: string | undefined, answer: string) =>
  word !== undefined && word.trim().toLowerCase() === answer.trim().toLowerCase();

/** True when any answer sits in the bank at its own gap's position: first gap, first word. */
export function bankGivesAway(words: readonly string[], answers: readonly string[]): boolean {
  return answers.some((answer, i) => same(words[i], answer));
}

/** FNV-1a over the words, so the order depends on what the bank holds and nothing else. */
function seedOf(words: readonly string[]): number {
  let h = 2166136261;
  const text = words.join("\n");
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * `words` in a seeded order that keeps every answer off its own gap's position, or `words` itself
 * when it already does. A bank no order can fix (one word filling two neighbouring gaps) is left
 * as it is.
 */
export function mixedBank(words: string[], answers: readonly string[]): string[] {
  if (words.length < 2 || !bankGivesAway(words, answers)) return words;
  const random = prng(seedOf(words));
  for (let tries = 0; tries < 64; tries++) {
    const order = [...words];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j] as string, order[i] as string];
    }
    if (!bankGivesAway(order, answers)) return order;
  }
  return words;
}

/**
 * Every word bank checked against the run of fill-gap sentences right after it, and reordered by
 * `mixedBank` when it gives their answers away. Returns `blocks` itself when no bank moved.
 */
export function mixWordBanks(blocks: WorksheetBlock[]): WorksheetBlock[] {
  let moved = false;
  const out = blocks.map((block, index) => {
    if (block.type !== "word-bank") return block;
    const answers: string[] = [];
    for (const next of blocks.slice(index + 1)) {
      if (next.type !== "fill-gap") break;
      answers.push(...next.gaps.map((gap) => gap.answer));
    }
    const words = mixedBank(block.words, answers);
    if (words === block.words) return block;
    moved = true;
    return { ...block, words };
  });
  return moved ? out : blocks;
}
