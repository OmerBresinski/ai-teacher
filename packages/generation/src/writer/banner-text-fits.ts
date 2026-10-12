import CAPACITY from "@tj/slides/templates/banner-text-capacity.json" with { type: "json" };
import type { WriterStage } from "./schema";

/*
 * The banner's fit (UX ruling 203, P4; TEACH-75 part k), from the renderer's measured table
 * (`banner-text-capacity.json`), never hand-copied: per bullet count, the most characters the lead
 * and each bullet may have at once, and the bullet label's characters. It feeds the fit table
 * (`fitTable`, so `charsOver` repairs an overflowing banner) and the strict schema's caps.
 */
type Cell = { points: number; chars: number; label: number };
const cells = (stage: string): Cell[] => (CAPACITY as Record<string, Cell[]>)[stage] ?? [];

/** The banner's layout entry in the fit table at a stage group. */
export function bannerFit(stage: string) {
  return {
    fields: ["lead", "points"],
    variants: cells(stage).map((c) => ({
      label: `${c.points} bullets`,
      counts: { points: c.points },
      figure: true,
      keyCards: false,
      chars: c.chars,
      ceiling: c.chars,
      keyLabel: c.label,
      limit: {
        item: c.chars,
        total: c.chars * (c.points + 1) + c.label * c.points,
        shown: c.chars * (c.points + 1) + c.label * c.points,
      },
    })),
  };
}

/** The schema's caps: the longest lead, bullet and label any bullet count allows. */
export function bannerCaps(stage: WriterStage): { lead: number; point: number; label: number } {
  const c = cells(stage);
  return {
    lead: Math.max(1, ...c.map((x) => x.chars)),
    point: Math.max(1, ...c.filter((x) => x.points > 0).map((x) => x.chars)),
    label: Math.max(1, ...c.map((x) => x.label)),
  };
}
