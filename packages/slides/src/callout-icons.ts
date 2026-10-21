import type { CalloutKind } from "@tj/domain/documents";

/*
 * Apart from `point-kinds.ts` so the callout code the lesson pages load takes only these names,
 * and the typed-point tables stay with the templates that use them (TEACH-205 part b).
 */

/**
 * The drawn icon each kind carries (lucide names from the editor's icon set), drawn in the kind's
 * colour rather than set as emoji: Chalkie's warning sign for a common mistake; a lightbulb for
 * an example and an open book for key words, where Chalkie has a magnifier and a key (review
 * T75-7: the idea and the vocabulary read faster than the tools).
 */
export const CALLOUT_ICONS: Record<CalloutKind, string> = {
  "watch-out": "triangle-alert",
  example: "lightbulb",
  "key-words": "book-open",
};
