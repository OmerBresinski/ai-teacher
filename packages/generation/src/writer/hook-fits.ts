import CAPACITY from "@tj/slides/templates/hook-capacity.json" with { type: "json" };
import type { WriterStage } from "./schema";

/*
 * The hook's fit (UX ruling 203, P5; TEACH-75 part l), from the renderer's measured table
 * (`hook-capacity.json`), never hand-copied: the most characters its words may have. It feeds the
 * fit table (`fitTable`, so `charsOver` repairs an overlong hook) and the strict schema's cap.
 */
const chars = (stage: string): number =>
  (CAPACITY as Record<string, { chars: number }>)[stage]?.chars ?? 0;

/** The hook's layout entry in the fit table at a stage group. */
export function hookFit(stage: string) {
  const n = chars(stage);
  return {
    fields: ["lead"],
    variants: [
      {
        label: "photo",
        counts: {},
        figure: true,
        keyCards: false,
        chars: n,
        ceiling: n,
        limit: { item: n, total: n, shown: n },
      },
    ],
  };
}

/** The schema's cap on the hook's words. */
export const hookCap = (stage: WriterStage): number => Math.max(1, chars(stage));
