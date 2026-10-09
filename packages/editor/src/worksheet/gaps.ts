import type { Id, WorksheetBlock } from "@tj/domain/documents";
import type { FillGapBlock } from "./answers";

/*
 * How wide a fill-gap blank is drawn. A blank sized to its own answer tells the pupil which bank
 * word goes where (the one long blank takes the one long term), so every blank in a run of
 * consecutive fill-gap blocks is as wide as the run's longest answer: room to write any of them,
 * no clue to which. The sheet, the measuring column and the Word export all read this, so the
 * page breaks the teacher sees stay the ones the printer makes.
 */

/** The block's longest answer, in characters; 0 for a block with no gaps yet. */
export const longestAnswer = (block: FillGapBlock): number =>
  Math.max(0, ...block.gaps.map((gap) => gap.answer.length));

function runLengths(blocks: readonly WorksheetBlock[]): Map<Id, number> {
  const lengths = new Map<Id, number>();
  let run: FillGapBlock[] = [];
  const close = () => {
    const longest = Math.max(0, ...run.map(longestAnswer));
    for (const block of run) lengths.set(block.id, longest);
    run = [];
  };
  for (const block of blocks) {
    if (block.type === "fill-gap") run.push(block);
    else close();
  }
  close();
  return lengths;
}

/** Block lists are immutable (the reducers return a new array), so one pass serves every row. */
const cache = new WeakMap<readonly WorksheetBlock[], Map<Id, number>>();

/**
 * The answer length, in characters, every blank of block `id` is drawn for: the longest answer in
 * its run of fill-gap blocks. `undefined` when `id` is not a fill-gap block in `blocks`.
 */
export function gapCharsIn(blocks: readonly WorksheetBlock[], id: Id): number | undefined {
  let lengths = cache.get(blocks);
  if (!lengths) {
    lengths = runLengths(blocks);
    cache.set(blocks, lengths);
  }
  return lengths.get(id);
}
