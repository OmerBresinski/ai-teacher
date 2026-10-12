// Live writing P6 (TEACH-202 part f, ADR 0039): the slide the stream is writing, laid out as it
// stands. A draft is cheap and throwaway: the template's recipe filled with the words so far, every
// picture and diagram an open placeholder. No asks, no diagrams, no checks, no table split, no
// repairs: those run once, when the slide closes (`openSlide`), and the closed slide supersedes
// every draft.
import type { Slide } from "@tj/domain/documents";
import { fromWriterActivity, isWriterActivity } from "./activities";
import { slideNoEmDash } from "./checks";
import type { SlideDraft } from "./draft";
import { type MaterialiseCtx, type Materialised, materialise } from "./materialise";
import { nonFatalSync } from "./services";

type S = Record<string, unknown>;
type Laid = Materialised["slide"];
type El = Slide["elements"][number];

/** Each text element's type size on the slide's previous draft, by element id. */
export type DraftSizes = Map<string, number>;

/**
 * A layout mints fresh element ids each time; a draft's ids are its elements' names in order
 * (`d-Heading-0`), so one slide's drafts keep their ids from draft to draft: the renderer updates
 * the same boxes rather than mounting new ones, and the type sizes are held per box. The answer
 * data, which names ids, is left off a draft (nothing on a writing slide reveals answers).
 */
export function stableDraftIds(slide: Laid): Laid {
  const seen = new Map<string, number>();
  const elements = walk(slide.elements, (e) => {
    const name = (e as { name?: string }).name ?? e.type;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return { ...e, id: `d-${name.replace(/[^\w-]/g, "_")}-${n}` } as El;
  });
  const { question: _q, ...rest } = slide;
  return { ...rest, elements };
}

const walk = (els: readonly El[], fn: (e: El) => El): El[] =>
  els.map((e) => {
    const next = fn(e);
    const kids = (next as { children?: El[] }).children;
    return Array.isArray(kids) ? ({ ...next, children: walk(kids, fn) } as El) : next;
  });

/**
 * Type only ever steps down while a slide is written (never back up): a size larger than the
 * slide's last draft gave the same element is held at the last one, so words arriving never make
 * the text above them grow and shrink again. `sizes` is updated to the sizes shown.
 */
export function holdTypeSizes(slide: Laid, sizes: DraftSizes): Laid {
  const elements = walk(slide.elements, (e) => {
    const size = (e as { style?: { fontSize?: number } }).style?.fontSize;
    if (e.type !== "text" || typeof size !== "number") return e;
    const was = sizes.get(e.id);
    const shown = was !== undefined && was < size ? was : size;
    sizes.set(e.id, shown);
    return shown === size ? e : ({ ...e, style: { ...e.style, fontSize: shown } } as El);
  });
  return { ...slide, elements };
}

/**
 * A draft laid out: its template and the fields so far through the slide recipe, with every visual
 * an open placeholder (`pending`). Returns undefined when the draft does not lay out yet (a
 * template the recipes do not know, a field half there): the slide then waits for the next draft.
 */
export function layDraft(
  draft: SlideDraft,
  ctx: Omit<MaterialiseCtx, "visual">,
  sizes: DraftSizes,
  stageKey: Parameters<typeof fromWriterActivity>[1],
): Laid | undefined {
  return nonFatalSync(
    () => {
      const { fit: _fit, ...fields } = draft.fields;
      let s: S = slideNoEmDash({ template: draft.template, ...fields } as S) as S;
      if (isWriterActivity(s.template))
        s = fromWriterActivity(s, stageKey, ctx.brief.subject).slide;
      const m = materialise(s, { ...ctx, visual: () => ({ status: "pending" }) });
      return holdTypeSizes(stableDraftIds(m.slide), sizes);
    },
    () => undefined,
  );
}
