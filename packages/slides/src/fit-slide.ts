import type { Id, Slide, SlideElement, TextElement, Theme } from "@tj/domain/documents";
import { SLIDE_H } from "@tj/domain/documents";
import { explanationReserve, hasExplanationPanel, RESERVED_LINES } from "./explanation-metrics";
import { contains } from "./geometry";
import { BASELINE, SAFE, SPACE, snapY } from "./grid";
import { SAFE_BOTTOM } from "./metrics";
import {
  isFrozen,
  isLayerBelow,
  type Measurer,
  type ReflowResult,
  reflowSlide,
  textPartsOf,
} from "./reflow";
import { measureHeadless } from "./text-measure";
import { resolveTextStyle } from "./text-style";

/*
 * Fit a slide to its text before anything renders it (TEACH-28). A recipe in `layouts.ts` is
 * sized for its placeholder copy; the model's copy is longer, and until now nothing measured it
 * outside the editor, so print, view, present and the thumbnails drew the recipe's boxes with
 * the real words spilling out of them: a four-line title under the class line, a two-line
 * heading through its rule, answer cards over each other, a worked example off its card.
 *
 * This runs the editor's own fitting engine (`./reflow.ts`: fit, push down, step down) with the
 * headless ruler (`./text-measure.ts`), then does the two things that engine leaves to a human
 * because they are recipe knowledge, not geometry:
 *
 * - a card grows with the text laid on it, so the worked example's steps stay on their card;
 * - the title stack is re-centred as one block once its title has grown.
 *
 * What still overruns at the legibility floor is returned, not hidden: splitting a slide is the
 * editor's Tidy (`@tj/editor/layout/tidy.ts`), which runs on first open (TEACH-251).
 */

/** Optical centring bias, as the title recipe uses it (`layouts.ts` `centreY`). */
const OPTICAL_BIAS = 10;
/** The accent rule sits this far above the eyebrow (`layouts.ts` `accentRule`). */
const ACCENT_ABOVE = 29;

export type FitResult = {
  slide: Slide;
  /** Ids still past the safe area at the legibility floor. */
  overflow: Id[];
};

export function fitSlide(slide: Slide, theme: Theme): FitResult {
  const measure = measureHeadless(theme);
  const panel = slide.question && hasExplanationPanel(slide.question) ? slide.question : undefined;
  const lane =
    panel?.type === "true-false" || panel?.type === "multiple-choice"
      ? { fitBottom: SAFE_BOTTOM - explanationReserve(theme, RESERVED_LINES[panel.type]) }
      : {};
  const start = slide.kind === "worked-example" ? raiseCard(slide, theme, measure) : slide;
  const result = reflowSlide(start, theme, measure, { ...lane, keep: stemOf(start) });
  if (start === slide && !changed(slide, result)) return { slide, overflow: overflowOf(slide) };
  let elements = growCards(start.elements, result.elements);
  if (slide.kind === "title") elements = restackTitle(start.elements, elements);
  return { slide: { ...slide, elements }, overflow: overflowOf({ ...slide, elements }) };
}

/** A question slide's stem: the `heading` text its recipe sets across the top. */
function stemOf(slide: Slide): Id[] {
  if (!slide.question) return [];
  const stem = slide.elements.find((el) => el.type === "text" && el.style.preset === "heading");
  return stem ? [stem.id] : [];
}

/** Past the safe area as drawn (the lint's test); the engine's 4% cushion is for its own fit. */
const overflowOf = (slide: Slide): Id[] =>
  slide.elements
    .filter((el) => !isFrozen(el) && el.y + el.h > SAFE_BOTTOM + 0.5)
    .map((el) => el.id);

/**
 * The worked example's question box is drawn for two lines (`layouts.ts` `workedExampleSlide`).
 * A one-line question hands the second line to the working: the card, and everything laid on
 * it, starts that much higher and keeps its foot. The engine itself never pulls anything up (a
 * teacher's gap is theirs), but here the gap is the recipe's, drawn for copy it has not seen.
 */
function raiseCard(slide: Slide, theme: Theme, measure: Measurer): Slide {
  const card = slide.elements.find(
    (el) => el.type === "shape" && isLayerBelow(el) && !isFrozen(el),
  );
  if (!card) return slide;
  const question = slide.elements.find(
    (el): el is TextElement =>
      el.type === "text" && el.style.preset === "body" && el.y + el.h <= card.y,
  );
  const parts = question ? textPartsOf(question, slide) : null;
  if (!question || !parts) return slide;
  const size = resolveTextStyle(parts.style, theme, parts.preset).fontSize;
  const h = Math.ceil(measure({ ...parts, width: question.w, fontSize: size }));
  const lift = Math.floor((question.h - h) / BASELINE) * BASELINE;
  if (lift <= 0) return slide;
  const riders = new Set(slide.elements.filter((el) => el !== card && contains(card, el)));
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      if (el === question) return { ...el, h };
      if (el === card) return { ...el, y: el.y - lift, h: el.h + lift };
      return riders.has(el) ? { ...el, y: el.y - lift } : el;
    }),
  };
}

/**
 * Did the copy change the slide? A box grew, something moved or stepped down — or, on a title,
 * any box changed at all, since the stack re-centres on its measured height.
 */
function changed(slide: Slide, result: ReflowResult): boolean {
  if (result.moved.length > 0 || result.stepped.length > 0) return true;
  return result.elements.some((el, i) => {
    const h0 = slide.elements[i]?.h ?? 0;
    return slide.kind === "title" ? Math.abs(el.h - h0) > 0.5 : el.h > h0 + 0.5;
  });
}

/**
 * A card (a shape the reflow treats as a layer) keeps the padding it had under every text laid
 * on it: when the text grows, the card grows by the same amount.
 */
function growCards(before: SlideElement[], after: SlideElement[]): SlideElement[] {
  return after.map((card, i) => {
    const card0 = before[i];
    if (!card0 || card.type !== "shape" || !isLayerBelow(card) || isFrozen(card)) return card;
    let bottom = card.y + card.h;
    before.forEach((el0, j) => {
      const el = after[j];
      if (j === i || !el || el0.type === "shape" || !contains(card0, el0)) return;
      const padding = card0.y + card0.h - (el0.y + el0.h);
      bottom = Math.max(bottom, el.y + el.h + Math.max(0, padding));
    });
    // A card never grows past the foot the recipe gives it (`SAFE_BOTTOM` less one spacing stop):
    // text that still does not fit is an overflow the editor's Tidy splits, and a card it cannot
    // shrink back would stay in the way.
    bottom = Math.min(bottom, Math.max(card0.y + card0.h, SAFE_BOTTOM - SPACE[1]));
    return bottom > card.y + card.h ? { ...card, h: Math.ceil(bottom - card.y) } : card;
  });
}

/**
 * The title stack (`layouts.ts` `titleStack`: eyebrow, title, class line) is one block, optically
 * centred: once its texts are measured it is re-stacked at the recipe's own gaps, so a short title
 * pulls the class line up as surely as a long one pushes it down, and centred again. Skipped when
 * a picture shares the stack's column (the photo-band variant sets the stack on its picture).
 */
function restackTitle(before: SlideElement[], after: SlideElement[]): SlideElement[] {
  const texts = after
    .map((el, i) => ({ el, el0: before[i] as SlideElement }))
    .filter(({ el }) => el.type === "text")
    .sort((a, b) => a.el0.y - b.el0.y);
  const first = texts[0];
  if (!first) return after;
  const left = Math.min(...texts.map(({ el }) => el.x));
  const right = Math.max(...texts.map(({ el }) => el.x + el.w));
  const pictured = after.some(
    (el) => el.type === "image" && el.x < right && el.x + el.w > left && el.w * el.h > 0,
  );
  if (pictured) return after;

  const ys = new Map<SlideElement, number>();
  let y = 0;
  texts.forEach(({ el, el0 }, i) => {
    const prev = texts[i - 1];
    if (prev) y += prev.el.h + Math.max(0, el0.y - (prev.el0.y + prev.el0.h));
    ys.set(el, y);
  });
  const last = texts[texts.length - 1] as (typeof texts)[number];
  const height = (ys.get(last.el) ?? 0) + last.el.h;
  // Never so high that the accent rule above the eyebrow leaves the safe area.
  const top = Math.max(
    snapY(Math.round((SLIDE_H - height) / 2 - OPTICAL_BIAS)),
    Math.ceil((SAFE.y + ACCENT_ABOVE) / BASELINE) * BASELINE,
  );
  const dy = top - first.el0.y;
  return after.map((el) => {
    const at = ys.get(el);
    if (at !== undefined) return { ...el, y: top + at };
    // The accent rule, and anything else not a text or a picture, travels with the eyebrow.
    if (el.type === "image" || isFrozen(el)) return el;
    const el0 = before[after.indexOf(el)] as SlideElement;
    return { ...el, y: el0.y + dy };
  });
}
