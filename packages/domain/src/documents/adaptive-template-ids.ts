/*
 * The adaptive layouts registered after TEACH-106 part b, one line per layout, added at the end.
 * `.gitattributes` merges this file with `merge=union`, so two layout PRs that each add a line
 * merge cleanly. Only add lines here; the order carries no meaning. The template's recipe goes in
 * `packages/slides/src/templates/registered.ts` (`adaptive`). The earlier adaptive layouts stay
 * listed in `layout-ref.ts`.
 */
export const REGISTERED_ADAPTIVE_IDS = [
  // Add entries below this line.
] as const;
