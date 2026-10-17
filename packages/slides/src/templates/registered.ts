/*
 * Where a new layout registers (TEACH-106 part b). Each list below takes ONE LINE per layout, and
 * the line names the layout (`myth: mythDef,`, `import { mythDef } from "./myth";`); the def
 * itself lives in the layout's own file. `.gitattributes` merges this file with `merge=union`, so
 * two layout PRs that each add their lines here merge cleanly in either order. Rules that keep the
 * union safe:
 * - One line per entry, naming the layout. A multi-line block is not safe: the union merges away
 *   a line the two blocks share (`  },`, `kind: "content",`) and leaves broken code.
 * - Only add, at the end of each list. Edit or remove a line in a PR of its own.
 * - Nothing here may depend on the order of the lines. Imports are not sorted in this file
 *   (biome.json turns organizeImports off for it), so add yours at the end of the imports.
 * The templates that came before this file stay registered by hand in `index.ts`.
 * `packages/slides/AGENTS.md` ("Adding a layout") has the whole recipe.
 */
import type { SlideKind } from "@tj/domain/documents";
import type { AdaptiveSpec } from "../relayout";
import type { Ctx, TemplateInput } from "./index";

/**
 * Each registered layout's own input fields, keyed by its template id, e.g.
 * `myth: MythFields;` (the type exported by `./myth`). The keys join `TemplateId` and the fields join `TemplateInput`.
 */
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

/** One line per registered layout: `myth: mythDef,` (a `TemplateDef` exported by `./myth`). */
export const REGISTERED: { [K in RegisteredId]: TemplateDef } = {
  // Add entries below this line.
};

/** The registered layouts as `[id, def]` pairs. */
export const registeredDefs = (): [RegisteredId, TemplateDef][] =>
  Object.entries(REGISTERED as Record<string, TemplateDef>) as [RegisteredId, TemplateDef][];

/** The registered layout with this template id, if there is one. */
export const registeredDef = (id: string): TemplateDef | undefined =>
  (REGISTERED as Partial<Record<string, TemplateDef>>)[id];
