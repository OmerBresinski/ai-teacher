/**
 * Text fitting engine — the linter (TeachDeck `lib/layout/lint.ts`, verbatim). Moved from
 * `@tj/editor/layout` so planning, the save gate and Tidy measure with one ruler (`fitsPlanned`,
 * `./fit-check.ts`); the editor re-exports it from its old path.
 *
 * Answers one question for the navigator badge and the Tidy button: does this slide have a problem
 * a teacher would see? Two kinds count.
 *
 * **Overlaps.** Any two element boxes that intersect, excluding backdrops (85%+ of the slide),
 * hairlines (rules ≤ 2pt and any `line`), and deliberate containment on a card/image/icon. Two
 * text boxes are held to the stricter rule: one swallowing the other is a box that grew too tall.
 *
 * **Overflow.** Fixed-height text whose content is taller than its box, plus any box pushed off the
 * printable slide (past the 19pt trim). A picture run flush to the edge is a bleed, not a push.
 *
 * **The panel lane.** On a true-false or multiple-choice slide the foot of the safe area belongs to
 * the "Why?" panel; an element standing in it means the reason has nowhere to go.
 *
 * Pure and node-testable; the overlap half needs no measurement at all.
 */

import {
  type Id,
  type RichDoc,
  type RichNode,
  SLIDE_H,
  SLIDE_W,
  type Slide,
  type SlideElement,
  type TextElement,
  type Theme,
} from "@tj/domain/documents";
import { explanationReserve, owesExplanationLane, RESERVED_LINES } from "./explanation-metrics";
import { contains, intersects, rectOf } from "./geometry";
import { SAFE, TRIM } from "./grid";
import { SAFE_BOTTOM } from "./metrics";
import {
  isBackdrop,
  isFootBand,
  isHairline,
  isLayerBelow,
  type MeasureInput,
  type Measurer,
  textPartsOf,
} from "./reflow";
import { measureHeadless } from "./text-measure";
import { resolveTextStyle } from "./text-style";

/** A pair of ids whose boxes intersect. Always ordered by draw order. */
export type OverlapPair = [Id, Id];

export type SlideLint = {
  overlaps: OverlapPair[];
  overflow: Id[];
  /** Ids standing in the lane the "Why?" panel needs. */
  laneOverflow: Id[];
  /** True when the slide has nothing worth warning about. */
  ok: boolean;
};

/** Sub-point contact is not an overlap. */
const EPS = 1;

/** Excluded from overlap checks outright: it is ground or decoration, not a block. */
export function isDecorative(el: SlideElement): boolean {
  return isBackdrop(el) || isHairline(el);
}

/** Shrink a rect by the tolerance so touching edges do not register. */
const inset = (r: { x: number; y: number; w: number; h: number }) => ({
  x: r.x + EPS / 2,
  y: r.y + EPS / 2,
  w: Math.max(0, r.w - EPS),
  h: Math.max(0, r.h - EPS),
});

/**
 * Pairs of elements whose boxes intersect, ignoring backdrops, hairlines and deliberate
 * containment. Groups are compared as their own box; their children are the group's business.
 */
export function findOverlaps(slide: Slide): OverlapPair[] {
  const candidates = slide.elements.filter((el) => !isDecorative(el) && el.w > EPS && el.h > EPS);
  const out: OverlapPair[] = [...findStruckThrough(slide)];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (!a || !b) continue;
      // A rotated box's real footprint is not its rect; leave it to the eye.
      if (a.rotation || b.rotation) continue;
      const ra = rectOf(a);
      const rb = rectOf(b);
      if (!intersects(inset(ra), inset(rb))) continue;
      // Containment is deliberate layering only when a card, an image or an icon is one half of it.
      if (isLayerBelow(a) || isLayerBelow(b)) {
        if (contains(ra, rb) || contains(rb, ra)) continue;
      }
      out.push([a.id, b.id]);
    }
  }
  return out;
}

/**
 * How far inside a text box a rule must sit before it reads as struck through it. A rule along a
 * box's edge is the divider the recipe drew; a rule across its middle is a heading that grew two
 * lines over the divider under it (the Chalkie audit, Sept 2026: every two-line heading on the
 * default theme read as crossed out in the PDF, and the fit migration never tidied it because the
 * rule was excluded here).
 */
const STRIKE_INSET = 4;

/**
 * Hairlines crossing the interior of a text box (or an option card). Decoration never collides
 * with decoration, and a rule at a box's edge is fine; only a rule through the words counts. Draw
 * order is kept in the pair so the engine's push-down sees the same pair it would compute itself.
 */
export function findStruckThrough(slide: Slide): OverlapPair[] {
  const out: OverlapPair[] = [];
  slide.elements.forEach((rule, i) => {
    // Drawn rules only: a `line` element is a teacher's own stroke, wherever it goes.
    if (rule.type !== "shape" || rule.h > 2 || rule.rotation) return;
    const ry = rule.y + rule.h / 2;
    slide.elements.forEach((el, j) => {
      if (i === j || el.rotation || isDecorative(el)) return;
      if (el.type !== "text" && el.type !== "gap-text" && el.type !== "option") return;
      const r = rectOf(el);
      if (ry <= r.y + STRIKE_INSET || ry >= r.y + r.h - STRIKE_INSET) return;
      if (rule.x + rule.w <= r.x + EPS || rule.x >= r.x + r.w - EPS) return;
      out.push(i < j ? [rule.id, el.id] : [el.id, rule.id]);
    });
  });
  return out;
}

/** Is any part of the box outside the printable slide (past the trim margin)? */
export function isOffSlide(el: SlideElement): boolean {
  return (
    el.y + el.h > SLIDE_H - TRIM + EPS ||
    el.x + el.w > SLIDE_W - TRIM + EPS ||
    el.y < TRIM - EPS ||
    el.x < TRIM - EPS
  );
}

/**
 * An element run deliberately to the edge of the slide: flush with at least one edge and inside
 * the slide on every side. A picture down the left, or a band across the foot under a title
 * (TEACH-214), is laid that way on purpose. A box that has been *pushed* off ends outside the
 * slide, which is still reported.
 */
export function isBleed(el: SlideElement): boolean {
  const inside =
    el.x >= -EPS && el.y >= -EPS && el.x + el.w <= SLIDE_W + EPS && el.y + el.h <= SLIDE_H + EPS;
  if (!inside) return false;
  return el.x <= EPS || el.y <= EPS || el.x + el.w >= SLIDE_W - EPS || el.y + el.h >= SLIDE_H - EPS;
}

/**
 * Ids of elements whose text does not fit: a fixed-height box with more content than room, or any
 * box pushed off the slide. Without a `measure` the fixed-height check is skipped.
 */
export function findOverflow(slide: Slide, measure?: Measurer): Id[] {
  const out: Id[] = [];
  for (const el of slide.elements) {
    if (isBackdrop(el) || isBleed(el)) continue;
    if (isOffSlide(el)) {
      out.push(el.id);
      continue;
    }
    if (!measure) continue;
    const parts = textPartsOf(el, slide);
    if (!parts || parts.autoHeight) continue;
    const needed = measure({
      doc: parts.doc,
      width: el.w,
      style: parts.style,
      preset: parts.preset,
      role: parts.role,
      inset: parts.inset,
      chrome: parts.chrome,
    });
    if (needed > el.h + EPS) out.push(el.id);
  }
  return out;
}

/**
 * Ids standing in the lane the "Why?" panel is owed, on a slide that carries one. Nothing to
 * report on any other slide, or without a theme to size the lane with.
 */
export function findLaneOverflow(slide: Slide, theme?: Theme): Id[] {
  if (!theme || !owesExplanationLane(slide)) return [];
  const type = slide.question?.type as keyof typeof RESERVED_LINES;
  const lane = SAFE_BOTTOM - explanationReserve(theme, RESERVED_LINES[type]);
  const right = SAFE.x + SAFE.w;
  return slide.elements
    .filter(
      (el) =>
        !isBackdrop(el) &&
        !isFootBand(el) &&
        el.x < right &&
        el.x + el.w > SAFE.x &&
        el.y + el.h > lane + EPS,
    )
    .map((el) => el.id);
}

/** Every check in one pass, for the navigator badge and the canvas footer. */
export function lintSlide(slide: Slide, measure?: Measurer, theme?: Theme): SlideLint {
  const overlaps = findOverlaps(slide);
  const overflow = findOverflow(slide, measure);
  const laneOverflow = findLaneOverflow(slide, theme);
  return {
    overlaps,
    overflow,
    laneOverflow,
    ok: overlaps.length === 0 && overflow.length === 0 && laneOverflow.length === 0,
  };
}

/**
 * The auto-height text boxes on a slide, with the ruler input each one needs. Option cards count:
 * the engine treats them as auto-height (`textPartsOf`) and grows them at render time like a text
 * box, so a deck whose only stale slide is a question with overlong answers must be flagged too.
 */
const growable = (slide: Slide) =>
  slide.elements.flatMap((el) => {
    const parts = textPartsOf(el, slide);
    if (!parts?.autoHeight) return [];
    return [
      {
        el,
        input: {
          doc: parts.doc,
          width: el.w,
          style: parts.style,
          preset: parts.preset,
          role: parts.role,
          inset: parts.inset,
          chrome: parts.chrome,
        } satisfies MeasureInput,
      },
    ];
  });

/** Every measurement `renderedHeights` will ask for on this slide, for one warm-up batch. */
export const measureInputsOf = (slide: Slide): MeasureInput[] =>
  growable(slide).map((g) => g.input);

/**
 * The slide as the renderer will draw it: every auto-height text box at the height its own content
 * needs, and nothing moved. Only *growth* is modelled — a floor is a minimum, so a floor change can
 * only make stored text bigger. (Moved from the editor's `layout/fit-plan.ts`.)
 */
export function renderedHeights(slide: Slide, measure: Measurer): Slide {
  const grown = new Map(growable(slide).map((g) => [g.el.id, measure(g.input)]));
  if (grown.size === 0) return slide;
  const elements = slide.elements.map((el) => {
    const h = grown.get(el.id);
    return h !== undefined && h > el.h ? { ...el, h } : el;
  });
  return { ...slide, elements };
}

/** The slide as drawn, linted: `renderedHeights` then `lintSlide`, the first-open migration's test. */
export const lintAsDrawn = (slide: Slide, measure: Measurer, theme: Theme): SlideLint =>
  lintSlide(renderedHeights(slide, measure), measure, theme);

/** `ANSWERS_NAMES.hidden` / `.cover` (templates/end-answers.ts), named here to keep lint template-free. */
const ANSWER_DISC = "Hidden answer";
const ANSWER_COVER = "Revealed";
/**
 * The ledger's words (`ANSWERS_NAMES` kicker, source, answer, sentence, working, correction): the
 * rows that stack. The heading's full-width box under the "Teacher only" pill is by design.
 */
const LEDGER_TEXT = new Set([
  "Kicker",
  "Source title",
  "Answer",
  "Model answer",
  "Working",
  "Correction",
]);

/**
 * The layout faults on a guard or Answers slide, as the renderer draws it, in the ship gate's
 * words (`clipped:` / `overlap:`); empty for any other slide. `lintSlide` cannot judge one: the
 * template lays each answer over its hidden "?" disc and the disc's cover on purpose, so every
 * clean Answers slide has overlaps, and the deck's checks skipped these slides. That hid a disc
 * left behind its moved cover over the answer above ("?.dding Lane") and an answer pushed past
 * the slide's foot (TEACH-247 part ai, Great Fire Y2 s15/s16). The rules here are the template's
 * own: each disc sits under its cover, on its answer's first line, no words run into other words,
 * and nothing runs off the slide.
 */
export function answersFaults(slide: Slide, measure?: Measurer): string[] {
  if (!slide.answersRole) return [];
  const drawn = measure ? renderedHeights(slide, measure) : slide;
  const out: string[] = [];
  const covers = drawn.elements.filter((e) => e.name === ANSWER_COVER);
  const answers = drawn.elements.filter(
    (e) => e.revealStep !== undefined && e.name !== ANSWER_COVER,
  );
  for (const disc of drawn.elements.filter((e) => e.name === ANSWER_DISC)) {
    const r = rectOf(disc);
    if (!covers.some((c) => contains(rectOf(c), r)))
      out.push(`overlap: hidden answer ${disc.id} is not under its cover`);
    const line = (a: SlideElement) =>
      Math.abs(a.x - disc.x) <= 1 && a.y <= disc.y + 1 && disc.y < a.y + Math.max(a.h, disc.h);
    if (!answers.some(line)) out.push(`overlap: hidden answer ${disc.id} is off its answer's line`);
  }
  // Words on words (TEACH-247 part am): each text box at the height its words take as drawn. An
  // answer measured in one theme's faces and drawn in a wider one wraps a line more and its last
  // line lands on the next answer (Great Fire Y2 verify4 s15: "easily." over answer 2). The disc
  // rules above never look at two texts.
  const texts = drawn.elements.filter(
    (e) => e.type === "text" && LEDGER_TEXT.has(e.name ?? "") && e.w > EPS && e.h > EPS,
  );
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i] as SlideElement;
      const b = texts[j] as SlideElement;
      if (intersects(inset(rectOf(a)), inset(rectOf(b))))
        out.push(`overlap: ${a.id} runs into ${b.id}`);
    }
  for (const el of drawn.elements) {
    if (isBackdrop(el) || isBleed(el)) continue;
    if (el.y + el.h > SLIDE_H + EPS) out.push(`clipped: ${el.id} runs past the slide's foot`);
  }
  return out;
}

/**
 * Words on words, measured in the theme the slide is drawn in (TEACH-247 part ap). For every text
 * box: a word wider than the box (the browser breaks it inside, "Firebreak/s"), and a box whose
 * words take more lines than its height holds where the next text box below it starts (a
 * question's second line running into the next question). The boxes are trusted for position;
 * lines are counted by the headless ruler (`measureHeadless`), the theme's real font advances with
 * each box's own style. Answers slides have their own rules (`answersFaults`) and are skipped.
 */
export function textFaults(slide: Slide, theme: Theme): string[] {
  if (slide.answersRole) return [];
  const measure = measureHeadless(theme);
  const texts = slide.elements.filter(
    (e): e is TextElement => e.type === "text" && e.w > EPS && e.h > EPS,
  );
  const out: string[] = [];
  const para = (text: string): RichDoc => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  for (const e of texts) {
    const words: string[] = [];
    const walk = (n: RichNode) => {
      if (n.type === "text") words.push(n.text ?? "");
      for (const c of n.content ?? []) walk(c);
    };
    for (const c of e.doc.content ?? []) walk(c);
    const text = words.join(" ");
    if (!text.trim()) continue;
    const preset = e.style.preset ?? "body";
    const r = resolveTextStyle(e.style, theme, preset);
    const inset = 2 * r.padding;
    const at = (doc: RichDoc) =>
      measure({ doc, width: e.w, style: e.style, preset, inset, chrome: 0 });
    const one = r.fontSize * r.lineHeight;
    const wide = [...new Set(text.split(/\s+/))].find((w) => w && at(para(w)) > one + 0.5);
    if (wide) out.push(`clipped: "${wide}" is wider than its box ${e.id}`);
    const h = at(e.doc) + inset;
    const below = texts
      .filter((o) => o !== e && o.y >= e.y + e.h - EPS && o.x < e.x + e.w && o.x + o.w > e.x)
      .sort((a, b) => a.y - b.y)[0];
    if (below && e.y + h > below.y + 1) out.push(`overlap: ${e.id} runs into ${below.id}`);
  }
  return out;
}
