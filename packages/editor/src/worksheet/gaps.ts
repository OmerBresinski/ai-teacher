import { fillGapRun, type Id, orderedGaps, type WorksheetBlock } from "@tj/domain/documents";

/*
 * How wide a fill-gap blank is drawn. A blank sized to its own answer tells the pupil which bank
 * word goes where (the one long blank takes the one long term), so every blank in a run of
 * consecutive fill-gap blocks is as wide as the run's longest answer: room to write any of them,
 * no clue to which. `buildFlow` stamps it on every flow item and the Word export reads it too, so
 * the sheet, the measuring column, the editor rows and the .docx all draw the same blanks.
 */

/**
 * Each fill-gap block's blank width, in characters of answer: the longest answer in its run. A gap
 * whose token was deleted from the text prints no blank, so it does not count.
 */
export function gapWidths(blocks: readonly WorksheetBlock[]): Map<Id, number> {
  const widths = new Map<Id, number>();
  blocks.forEach((block, index) => {
    if (block.type !== "fill-gap" || blocks[index - 1]?.type === "fill-gap") return;
    const run = fillGapRun(blocks, index);
    const longest = Math.max(
      0,
      ...run.flatMap((sentence) => orderedGaps(sentence).map((gap) => gap.answer.length)),
    );
    for (const sentence of run) widths.set(sentence.id, longest);
  });
  return widths;
}
