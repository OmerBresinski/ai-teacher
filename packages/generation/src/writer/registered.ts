/*
 * The writer side of a layout registered after TEACH-106 part b: how `toInput` reads the writer's
 * slide for it and its lay-draft rules. ONE LINE per layout in `REGISTERED_WRITERS`
 * (`myth: mythWriter,`) and one import line, both naming the layout; the `WriterDef` lives in the
 * layout's own writer file. `.gitattributes` merges this file with `merge=union`, so two layout
 * PRs merge cleanly; a multi-line block is not safe (the union merges away a line two blocks share).
 * Only add, at the end; imports stay unsorted here (biome.json). The order carries no meaning.
 * `packages/slides/AGENTS.md` ("Adding a layout") has the whole recipe.
 */
import type { TemplateInput } from "@tj/slides/templates";
import type { SlideDraft } from "./draft";
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
  /**
   * Draft streaming (`layDraft`): true while the draft must not be laid yet, e.g. a field whose
   * half-written value would lay a different shape (the `source` rule on its `form`).
   */
  holdDraft?: (draft: SlideDraft) => boolean;
  /** Draft streaming: its revealed parts show as they are written (`worked`, `source`). */
  showsRevealsInDraft?: boolean;
  /** Draft streaming: its `items` hold named icons (`iconsFromNames`, as `stages` does). */
  itemIcons?: boolean;
};

/** The registered writer side of a template, if it has one. */
export const registeredWriter = (template: unknown): WriterDef | undefined =>
  typeof template === "string" ? REGISTERED_WRITERS[template] : undefined;

/** One line per registered layout: `myth: mythWriter,` (a `WriterDef` from its own file). */
export const REGISTERED_WRITERS: Readonly<Record<string, WriterDef>> = {
  // Add entries below this line.
};
