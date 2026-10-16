/*
 * The writer side of a layout registered after TEACH-106 part b: how `toInput` reads the writer's
 * slide for it, one block per layout, added at the end of `REGISTERED_WRITERS`. `.gitattributes`
 * merges this file with `merge=union`, so two layout PRs that each add a block merge cleanly. Only
 * add here, keep each block on consecutive lines ending in a comma, and add imports at the end of
 * the imports (biome.json leaves them unsorted in this file). The order carries no meaning.
 * `packages/slides/AGENTS.md` ("Adding a layout") has the whole recipe.
 */
import type { TemplateInput } from "@tj/slides/templates";
import type { MaterialiseCtx } from "./materialise";

/** What `toInput` has read before it reaches a registered layout. */
export type ToInputArgs = {
  /** The writer's slide, normalised. */
  s: Record<string, unknown>;
  ctx: MaterialiseCtx;
  mark: boolean;
  heading: string;
  lead: string | undefined;
};

export type WriterDef = {
  /** The template input for the writer's slide (`toInput`'s case for the layout). */
  toInput: (a: ToInputArgs) => TemplateInput;
  /** Kept as a re-layable group (`materialise`'s `ADAPTIVE`, `STABLE_ID_TEMPLATES`). */
  adaptive?: boolean;
};

/** One entry per registered layout: `myth: { toInput: ({ s, heading }) => ({ ... }) },`. */
export const REGISTERED_WRITERS: Readonly<Record<string, WriterDef>> = {
  // Add entries below this line.
};
