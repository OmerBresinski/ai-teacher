/*
 * Where a new layout registers (TEACH-106 part b). Every list below takes one block per layout,
 * added at the end of the list. `.gitattributes` merges this file with `merge=union`, so two
 * layout PRs that each add a block here merge cleanly in either order. Rules that keep the union
 * safe:
 * - Only add. Edit or remove an existing block in a PR of its own, never beside a new layout.
 * - Keep each block on consecutive lines, and end each entry with a comma.
 * - Nothing here may depend on the order of the blocks. Imports are not sorted in this file
 *   (biome.json turns organizeImports off for it), so add yours at the end of the imports.
 * The templates that came before this file stay registered by hand in `index.ts`.
 * `packages/slides/AGENTS.md` ("Adding a layout") has the whole recipe.
 */
import type { SlideKind } from "@tj/domain/documents";
import type { AdaptiveSpec } from "../relayout";
import type { Ctx, TemplateInput } from "./index";

/**
 * Each registered layout's own input fields, keyed by its template id, e.g.
 * `myth: { myth?: MythInput };`. The keys join `TemplateId` and the fields join `TemplateInput`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: new layouts add their entries here.
export interface RegisteredInputs {
  // Add entries below this line.
}

export type RegisteredId = keyof RegisteredInputs;

export type TemplateDef = {
  /** The slide kind a slide laid out from the template carries. */
  kind: SlideKind;
  /** Draws the template into the context (`layoutOnce` calls it after the heading cap is set). */
  layout: (c: Ctx, input: TemplateInput) => void;
  /** Its samples, appended to `templateSamples()` (the every-theme test and contact sheets). */
  samples?: (photo: (label: string) => string) => TemplateInput[];
  /** Set when the layout is adaptive; its id is then also in `adaptive-template-ids.ts`. */
  adaptive?: AdaptiveSpec;
};

/** One entry per registered layout: `myth: { kind: "content", layout: layoutMyth, ... },`. */
export const REGISTERED: { [K in RegisteredId]: TemplateDef } = {
  // Add entries below this line.
};

/** The registered layouts as `[id, def]` pairs. */
export const registeredDefs = (): [RegisteredId, TemplateDef][] =>
  Object.entries(REGISTERED as Record<string, TemplateDef>) as [RegisteredId, TemplateDef][];

/** The registered layout with this template id, if there is one. */
export const registeredDef = (id: string): TemplateDef | undefined =>
  (REGISTERED as Partial<Record<string, TemplateDef>>)[id];
