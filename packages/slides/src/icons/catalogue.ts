// Every concept the matcher knows: the pilot's generated list (concepts.ts) and the layout sets'
// hand-written list (concepts-layouts.ts, TEACH-310 part c).
import { ICON_CONCEPTS as PILOT_CONCEPTS } from "./concepts";
import { LAYOUT_CONCEPTS } from "./concepts-layouts";
import type { IconConcept } from "./types";

/*
 * Pilot synonyms a layout concept now owns (#527 review): the stages set has its own "scroll", so
 * the word draws the scroll, not papyrus ("papyrus" and "papyrus scroll" still draw papyrus).
 */
export const HANDED_OVER: Readonly<Record<string, readonly string[]>> = { papyrus: ["scroll"] };

export const ICON_CONCEPTS: readonly IconConcept[] = [
  ...PILOT_CONCEPTS.map((c) =>
    HANDED_OVER[c.id]
      ? { ...c, synonyms: c.synonyms.filter((s) => !HANDED_OVER[c.id]?.includes(s)) }
      : c,
  ),
  ...LAYOUT_CONCEPTS,
];
