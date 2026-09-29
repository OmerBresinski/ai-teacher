import type { Slide } from "@tj/domain/documents";
import {
  fitSlide,
  isCalloutElement,
  materialiseSlide,
  materialiseSlides,
  measureHeadless,
  SAFE_BOTTOM,
  type SlideSpec,
  THEMES,
} from "@tj/slides";

/*
 * The ruler the fit planner's `measure` tool reads (lab fit-5): a draft of a teaching slide's
 * words is materialised on every theme, as Generate would, and fitted with the headless measurer.
 * It fits when, on every theme, it is one page with nothing past the safe area and its callout
 * (when it has one) placed. `linesOver` is the worst theme's text past the safe area, in lines of
 * that text; `calloutPlaced` is false when the callout had no room (see `calloutTheme`).
 */

export type SlideDraft = {
  kind: "content" | "worked-example";
  heading?: string | undefined;
  body?: string | undefined;
  question?: string | undefined;
  steps?: string[] | undefined;
  callout?: { kind: "watch-out" | "key-words" | "example" | "tip"; text: string } | undefined;
};

export type Measure = { fits: boolean; linesOver: number; calloutPlaced: boolean | null };

const META = { promptVersion: "fit", model: "fit", at: "1970-01-01T00:00:00.000Z" };

export function specOfDraft(draft: SlideDraft): SlideSpec {
  const callout = draft.callout?.text ? { callout: draft.callout } : {};
  if (draft.kind === "worked-example") {
    return {
      kind: "worked-example",
      factRefs: [],
      ...(draft.heading ? { heading: draft.heading } : {}),
      question: draft.question ?? "",
      steps: draft.steps && draft.steps.length > 0 ? draft.steps : [""],
      ...callout,
    } as SlideSpec;
  }
  return {
    kind: "content",
    factRefs: [],
    heading: draft.heading ?? "",
    body: draft.body ?? "",
    ...callout,
  } as SlideSpec;
}

function linesPast(slide: Slide): number {
  let worst = 0;
  for (const e of slide.elements) {
    if (e.type !== "text" || isCalloutElement(e)) continue;
    const over = e.y + e.h - SAFE_BOTTOM;
    if (over <= 0) continue;
    const size = (e as { fontSize?: number }).fontSize ?? 24;
    const lh = (e as { lineHeight?: number }).lineHeight ?? 1.25;
    worst = Math.max(worst, Math.ceil(over / (size * lh)));
  }
  return worst;
}

/**
 * `calloutTheme`: the lesson's theme. The words must fit every theme; the callout is secondary
 * (rulings 102, 106: left off, never clipped, when a teacher's retheme leaves no room), so its
 * room is measured on the lesson's own theme, or on every theme when none is given.
 */
export function measureDraft(draft: SlideDraft, calloutTheme?: string): Measure {
  const spec = specOfDraft(draft);
  const wantsCallout = draft.kind === "content" && !!draft.callout?.text;
  let fits = true;
  let linesOver = 0;
  let calloutPlaced = true;
  for (const theme of THEMES) {
    let dropped = false;
    const slide = materialiseSlide(spec, theme.id, META, undefined, undefined, {}, () => {
      dropped = true;
    });
    const fitted = fitSlide(slide, theme);
    const pages = materialiseSlides(spec, theme.id, META).length;
    const over = Math.max(linesPast(fitted.slide), pages > 1 ? 1 : 0);
    if (fitted.overflow.length > 0 || pages > 1 || over > 0) fits = false;
    linesOver = Math.max(linesOver, over);
    if (wantsCallout && dropped && (calloutTheme === undefined || calloutTheme === theme.id))
      calloutPlaced = false;
  }
  void measureHeadless;
  if (wantsCallout && !calloutPlaced) fits = false;
  return { fits, linesOver, calloutPlaced: wantsCallout ? calloutPlaced : null };
}
