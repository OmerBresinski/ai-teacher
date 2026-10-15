// Every concept the matcher knows: the pilot's generated list (concepts.ts) and the layout sets'
// hand-written list (concepts-layouts.ts, TEACH-310 part c).
import { ICON_CONCEPTS as PILOT_CONCEPTS } from "./concepts";
import { LAYOUT_CONCEPTS } from "./concepts-layouts";
import type { IconConcept } from "./types";

export const ICON_CONCEPTS: readonly IconConcept[] = [...PILOT_CONCEPTS, ...LAYOUT_CONCEPTS];
