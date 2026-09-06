/**
 * Geometry for the "Why?" explanation panel on true-false and multiple-choice
 * slides (Chalkie inventory line 10, `docs/reference/chalkie/11-...png`).
 *
 * Pure, and deliberately measurement-free: the panel is drawn in slide space, so
 * the editor, the viewer, present mode, capture and the print route all have to
 * agree on the same box before a font has loaded. The ruler is the same ~0.5em
 * average advance the fitting engine's own tests run against, and the sizes come
 * off the theme's ladder through `resolveFontSize` / `stepDownSize`, so the panel
 * shrinks by the engine's rules and stops at the engine's floors.
 *
 * The one invariant: the panel is anchored to the foot of the safe area and grows
 * upward, and its top never rises above the lowest thing already standing in its
 * lane plus `above`. It can therefore be short, and say so (`overflowing`), but it
 * can never sit on the answer cards, nor on a note, nor on anything else the
 * teacher has put under them.
 */

import type { Slide, SlideElement, Theme } from "@tj/domain/documents";
import {
  EXPLANATION_HEADING,
  EXPLANATION_PLACEHOLDER,
  explanationReserve,
  fontFloor,
  hasExplanationPanel,
  PANEL,
  type PanelType,
  panelHeight,
  panelType,
  RESERVED_LINES,
  resolveTextStyle,
  SAFE,
  SAFE_BOTTOM,
} from "@tj/slides";
import { docToPlainText } from "../text/static";
import { isBackdrop, type Measurer, stepDownSize, textPartsOf } from "./reflow";

/**
 * The measurement-free half — `PANEL`, the heading and placeholder copy, `hasExplanationPanel`,
 * `panelType`, `panelHeight`, `explanationReserve`, `RESERVED_LINES` — lives in `@tj/slides`
 * (ADR 0025 §9) because the recipes lay out against it. Re-exported here; what follows needs a
 * `Measurer` and stays in the editor.
 */
export {
  EXPLANATION_HEADING,
  EXPLANATION_PLACEHOLDER,
  explanationReserve,
  hasExplanationPanel,
  PANEL,
  type PanelType,
  panelHeight,
  panelType,
  RESERVED_LINES,
};

/**
 * Lines of body copy the lane on *this* slide keeps room for. The rule, recorded
 * here rather than spread over the callers:
 *
 * - **True or false** asks for two. Two cards and a stem leave the room for them,
 *   and a reason worth writing takes two lines.
 * - **Multiple choice** asks for two when the stem sets on one line *and* the
 *   cards leave room for two, and for one otherwise. Four legible cards under a
 *   stem that wraps already own the slide; a stem that fits on one line hands
 *   back a line, and the panel is what it goes to. The ask is capped by the room
 *   that is actually there, because asking for a line the slide cannot give would
 *   only make Tidy shrink type to buy room nothing can use.
 *
 * The stem is measured, never guessed: the DOM ruler where the caller has one
 * (`./measure.ts`), and the engine's own ~0.5em estimate over 90% of the width
 * where it does not, so an estimate a character or two out reads as two lines
 * rather than one.
 */
export function reservedLines(slide: Slide, theme: Theme, measure?: Measurer): number {
  const type = slide.question?.type;
  if (type !== "true-false" && type !== "multiple-choice") return 0;
  const floor = RESERVED_LINES[type];
  if (type === "true-false") return floor;
  if (!stemFitsOneLine(slide, theme, measure)) return floor;
  const lane = SAFE_BOTTOM - lowestBottom(slide) - PANEL.above;
  return lane >= panelHeight(theme, 2) ? 2 : floor;
}

/** The question stem: the `heading` text a question recipe puts across the top. */
function stemOf(slide: Slide): SlideElement | undefined {
  return slide.elements.find((el) => el.type === "text" && el.style.preset === "heading");
}

/** Does the stem set on a single line, and so hand a line back to the panel? */
function stemFitsOneLine(slide: Slide, theme: Theme, measure?: Measurer): boolean {
  const el = stemOf(slide);
  const parts = el ? textPartsOf(el, slide) : null;
  if (!el || !parts) return false;
  // The stem's type as it is actually set, step-downs and overrides included.
  const type = resolveTextStyle(parts.style, theme, parts.preset, "question");
  const size = type.fontSize;
  const line = Math.ceil(size * type.lineHeight);
  if (measure) {
    const height = measure({
      doc: parts.doc,
      width: el.w,
      style: parts.style,
      preset: parts.preset,
      role: "question",
      fontSize: size,
      inset: parts.inset,
      chrome: parts.chrome,
    });
    return height - parts.chrome <= line + 1;
  }
  // No ruler: the estimate, over nine tenths of the width, so a near miss counts
  // as two lines rather than promising a line the browser will not give.
  return linesAt(docToPlainText(parts.doc), size, (el.w - parts.inset) * 0.9) <= 1;
}

/* ------------------------------------------------------------------ */
/* The box                                                             */
/* ------------------------------------------------------------------ */

/**
 * The whole lane the panel may occupy: from the clearance below the lowest thing
 * standing in it to the foot of the safe area. Stable while the panel itself
 * grows and shrinks, which is what the editor's pointer hole needs.
 */
export function explanationLane(slide: Slide): { x: number; y: number; w: number; h: number } {
  const y = lowestBottom(slide) + PANEL.above;
  return { x: SAFE.x, y, w: SAFE.w, h: Math.max(0, SAFE_BOTTOM - y) };
}

export type ExplanationBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Width available to the copy inside the padding. */
  textWidth: number;
  headingSize: number;
  bodySize: number;
  bodyLine: number;
  /** Lines the copy needs at `bodySize`. */
  lines: number;
  /** Height of the whole lane, which is the panel's ceiling as it is rendered. */
  lane: number;
  /** The copy needs more room than the lane has. */
  overflowing: boolean;
  /** The lane is too short to draw a panel at all. */
  collapsed: boolean;
};

/**
 * The lowest bottom edge among the elements standing in the panel's lane.
 *
 * Every element that overlaps the lane horizontally counts, not just the answer
 * cards: the panel is an opaque card, so anchoring it to the options alone would
 * let it cover a note, a diagram or a footnote the teacher put under them, with
 * nothing on screen to say so. A full-bleed backdrop is the slide's ground rather
 * than a box in the lane, and is the one thing excluded.
 */
function lowestBottom(slide: Slide): number {
  const right = SAFE.x + SAFE.w;
  return slide.elements.reduce<number>((m, el) => {
    if (isBackdrop(el)) return m;
    if (el.x >= right || el.x + el.w <= SAFE.x) return m;
    return Math.max(m, el.y + el.h);
  }, SAFE.y);
}

/** Lines `text` takes at `size` in `width`, on the engine's ~0.5em ruler. */
function linesAt(text: string, size: number, width: number): number {
  const perLine = Math.max(1, Math.floor(width / (size * 0.5)));
  return text
    .split("\n")
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.trim().length / perLine)), 0);
}

/**
 * Where the panel sits and how its copy is set. `text` is the reason as written;
 * pass the placeholder when the editor is showing an empty panel, so the empty
 * state is the same shape as the filled one.
 */
export function explanationLayout({
  slide,
  theme,
  text,
}: {
  slide: Slide;
  theme: Theme;
  text: string;
}): ExplanationBox {
  const t = panelType(theme);
  const textWidth = SAFE.w - PANEL.padX * 2;
  const chrome = PANEL.padY * 2 + t.headingLine + PANEL.gap;

  const ceiling = lowestBottom(slide) + PANEL.above;
  const lane = SAFE_BOTTOM - ceiling;

  // Fit, then step down: the body drops one stop at a time, by the engine's own
  // ladder, and stops at the `body` role's projector floor.
  const floor = fontFloor("body");
  let bodySize = t.bodySize;
  let bodyLine = t.bodyLine;
  let lines = linesAt(text, bodySize, textWidth);
  while (chrome + bodyLine * lines > lane && bodySize > floor) {
    const next = stepDownSize(theme, "body", bodySize);
    if (next >= bodySize) break;
    bodySize = next;
    bodyLine = Math.ceil(bodySize * theme.lineHeights.body);
    lines = linesAt(text, bodySize, textWidth);
  }

  const needed = chrome + bodyLine * lines;
  const h = Math.min(needed, Math.max(0, lane));

  return {
    x: SAFE.x,
    y: SAFE_BOTTOM - h,
    w: SAFE.w,
    h,
    textWidth,
    headingSize: t.headingSize,
    bodySize,
    bodyLine,
    lines,
    lane: Math.max(0, lane),
    overflowing: needed > h,
    // A panel with no room for its heading is not a panel; the editor shows the
    // overflow warning instead of a sliver of a card.
    collapsed: h < chrome,
  };
}
