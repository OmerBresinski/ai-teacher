import CAPACITY from "@tj/slides/templates/cards-grid-capacity.json" with { type: "json" };
import type { WriterStage } from "./schema";

/*
 * The cards grid's fit (UX ruling 203, P3; TEACH-75 part j), from the renderer's measured table
 * (`cards-grid-capacity.json`), never hand-copied: per card count, the most characters (and words)
 * a body holds and the label's characters, under a heading at its limit. It feeds the fit table
 * (`fitTable`, so `charsOver` repairs an overflowing grid), the strict schema's caps and the menu's
 * `Fits:` clause (`{fits.cards-grid}`, the separate prompt change).
 */
type Cell = { cards: number; heading: boolean; words: number; chars: number; label: number };
const cells = (stage: string): Cell[] =>
  ((CAPACITY as Record<string, Cell[]>)[stage] ?? []).filter((c) => c.heading);

/** The grid's layout entry in the fit table at a stage group. */
export function gridFit(stage: string) {
  return {
    fields: ["card text"],
    variants: cells(stage).map((c) => ({
      label: `${c.cards} cards`,
      counts: { grid: c.cards },
      figure: false,
      keyCards: false,
      chars: c.chars,
      ceiling: c.chars,
      columnLabel: c.label,
      limit: {
        item: c.chars,
        total: (c.chars + c.label) * c.cards,
        shown: (c.chars + c.label) * c.cards,
      },
    })),
  };
}

/** The schema's caps: the longest body and label any count allows (each count's own is the fit table's). */
export function gridCaps(stage: WriterStage): { text: number; label: number } {
  const c = cells(stage);
  return {
    text: Math.max(1, ...c.map((x) => x.chars)),
    label: Math.max(1, ...c.map((x) => x.label)),
  };
}

/** The `Fits:` clause: per count, a body's characters (and about how many words). */
export function gridFitsLine(stage: WriterStage): string {
  return cells(stage)
    .map((c, k) =>
      k === 0
        ? `${c.cards} cards, bodies up to ${c.chars} characters (about ${c.words} words), labels up to ${c.label}`
        : `${c.cards} cards, ${c.chars} (${c.words} words), labels ${c.label}`,
    )
    .join("; ");
}
