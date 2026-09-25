import type {
  Id,
  OptionElement,
  Slide,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { SLIDE_H } from "@tj/domain/documents";
import { explanationReserve, hasExplanationPanel, RESERVED_LINES } from "./explanation-metrics";
import { contains } from "./geometry";
import { BASELINE, SAFE, SPACE, snapY } from "./grid";
import { OPTION, SAFE_BOTTOM } from "./metrics";
import {
  isFrozen,
  isLayerBelow,
  type Measurer,
  type ReflowResult,
  reflowSlide,
  textPartsOf,
} from "./reflow";
import { measureHeadless } from "./text-measure";
import { floorBelow, ladderStops, resolveTextStyle } from "./text-style";
import type { TextRole } from "./themes";

/*
 * Fit a slide to its text before anything renders it (TEACH-28). A recipe in `layouts.ts` is
 * sized for its placeholder copy; the model's copy is longer, and until now nothing measured it
 * outside the editor, so print, view, present and the thumbnails drew the recipe's boxes with
 * the real words spilling out of them: a four-line title under the class line, a two-line
 * heading through its rule, answer cards over each other, a worked example off its card.
 *
 * This runs the editor's own fitting engine (`./reflow.ts`: fit, push down, step down) with the
 * headless ruler (`./text-measure.ts`), then does the things that engine leaves to a human
 * because they are recipe knowledge, not geometry:
 *
 * - a card grows with the text laid on it, so the worked example's steps stay on their card;
 * - the title stack is re-centred as one block once its title has grown;
 * - a multiple choice whose options wrap in the recipe's 2x2 cards is re-laid as one column of
 *   full-width rows (`columnOptions`), where each option has a line two and a half times as long.
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
  let start = slide.kind === "worked-example" ? raiseCard(slide, theme, measure) : slide;
  const options = { ...lane, keep: stemOf(start) };
  let result = reflowSlide(start, theme, measure, options);
  if (slide.kind === "multiple-choice") {
    let column = columnOptions(slide, theme);
    let alt = column ? reflowSlide(column, theme, measure, options) : null;
    // UX ruling 91: when the column still overruns at the floor, the type steps down one size,
    // once — the options first, then the stem — and only what is left after that is reported.
    for (const [ids, role] of [
      [optionIds(column), undefined],
      [stemOf(column ?? slide), "question"],
    ] as const) {
      if (!column || !alt || alt.overflow.length === 0) break;
      column = stepOnce(column, theme, ids, role);
      if (role === undefined) column = pitchRows(column, theme);
      alt = reflowSlide(column, theme, measure, options);
    }
    if (column && alt && preferColumn(slide, result, alt)) {
      start = column;
      result = alt;
    }
  }
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

/** Padding inside a full-width answer row; the 2x2 grid's cards keep the renderer's 24. */
const ROW_PAD = SPACE[1];
/**
 * The least gap between answer rows (the pitch lands on the baseline, so a row's actual gap is
 * this or up to six points more), before the engine's cushion: enough that the rows read as
 * separate cards, as the 2x2 grid's gutter does.
 */
const ROW_GAP = SPACE[2];

/**
 * The multiple-choice recipe's four cards laid as one column of full-width rows
 * (`layouts.ts` `multipleChoiceSlide` draws a 2x2 grid for one-line options). A row gives an
 * option about two and a half times the grid card's line (the card's chrome — chip, tick lane,
 * padding — is spent once per card either way), and a tighter padding, so a phrase that wraps
 * in a card sits on one line. Rows start where the grid started, one line tall at the option
 * floor, on the baseline pitch; the engine then grows any that wrap and pushes the rest down.
 * Null when the slide does not carry the recipe's cards.
 */
function columnOptions(slide: Slide, theme: Theme): Slide | null {
  const cards = slide.elements.filter((el): el is OptionElement => el.type === "option");
  if (cards.length < 2 || cards.some((card) => isFrozen(card) || card.textStyle?.padding)) {
    return null;
  }
  const left = Math.min(...cards.map((card) => card.x));
  const width = Math.max(...cards.map((card) => card.x + card.w)) - left;
  return pitchRows(
    {
      ...slide,
      elements: slide.elements.map((el) =>
        el.type === "option"
          ? { ...el, x: left, w: width, textStyle: { ...el.textStyle, padding: ROW_PAD } }
          : el,
      ),
    },
    theme,
  );
}

/**
 * The column's rows one line tall at the size their cards now carry, from the top row down on
 * the baseline pitch. Run again once the options have stepped down, so the shorter row keeps
 * `ROW_GAP` rather than the taller row's pitch.
 */
function pitchRows(column: Slide, theme: Theme): Slide {
  const cards = column.elements.filter((el): el is OptionElement => el.type === "option");
  const parts = cards[0] ? textPartsOf(cards[0], column) : null;
  if (!parts) return column;
  const top = Math.min(...cards.map((card) => card.y));
  const size = resolveTextStyle(parts.style, theme, parts.preset, parts.role).fontSize;
  const rowH = Math.ceil(size * OPTION.line) + 2 * ROW_PAD + 2 * OPTION.border;
  const pitch = Math.ceil((rowH + ROW_GAP) / BASELINE) * BASELINE;
  const rows = new Map<OptionElement, number>(cards.map((card, i) => [card, top + i * pitch]));
  return {
    ...column,
    elements: column.elements.map((el) => {
      const y = el.type === "option" ? rows.get(el) : undefined;
      return el.type !== "option" || y === undefined ? el : { ...el, y, h: rowH };
    }),
  };
}

const optionIds = (slide: Slide | null): Id[] =>
  slide ? slide.elements.filter((el) => el.type === "option").map((el) => el.id) : [];

/**
 * One stop down the theme's ladder for the named elements, under the role's floor if that is
 * where the next stop is, and never past `floorBelow` (UX ruling 91: one size, once). Written
 * as an explicit size, which `resolveFontSize` honours to that stop and the engine's own
 * step-down (clamped at the floor) will not move again. `role` names what the text is doing where
 * the element cannot (`fit-slide` knows a stem is a question; the engine does not).
 */
function stepOnce(slide: Slide, theme: Theme, ids: readonly Id[], role?: TextRole): Slide {
  return {
    ...slide,
    elements: slide.elements.map((el) => {
      if (!ids.includes(el.id)) return el;
      const parts = textPartsOf(el, slide);
      if (!parts) return el;
      const at = role ?? parts.role;
      const current = resolveTextStyle(parts.style, theme, parts.preset, at).fontSize;
      const next = ladderStops(theme).find((s) => s < current - 0.5);
      if (next === undefined || next < floorBelow(theme, parts.preset, at)) return el;
      if (el.type === "option") return { ...el, textStyle: { ...el.textStyle, fontSize: next } };
      if (el.type === "text" || el.type === "gap-text")
        return { ...el, style: { ...el.style, fontSize: next } };
      return el;
    }),
  };
}

/**
 * The grid is the recipe's design and stays while its cards hold their copy on one line. Once
 * an option wraps in its card the column is the better fit, if it fits; and when neither fits
 * at the option floor, the one that ends higher is the lesser overflow (the last row of a
 * column stays on the slide where a grid's second row runs off it).
 */
function preferColumn(slide: Slide, grid: ReflowResult, column: ReflowResult): boolean {
  const foot = (elements: SlideElement[]) =>
    Math.max(...elements.filter((el) => el.type === "option").map((el) => el.y + el.h));
  const gridFits = grid.overflow.length === 0;
  const columnFits = column.overflow.length === 0;
  const wrapped = grid.elements.some(
    (el, i) => el.type === "option" && el.h > (slide.elements[i]?.h ?? 0) + 0.5,
  );
  if (columnFits) return wrapped || !gridFits;
  return !gridFits && foot(column.elements) < foot(grid.elements);
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
