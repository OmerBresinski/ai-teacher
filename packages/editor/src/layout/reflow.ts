/**
 * Text fitting engine — the pure half.
 *
 * Wave 3, judge ship-blocker 2 (`docs/JUDGE.md`), research/04 §4 rule 1
 * ("fit, then step down") and SPEC §7's legibility floor. Nothing here touches
 * the DOM: measurement arrives as an injected `Measurer`, so the whole algorithm
 * runs in node tests with a fake ruler. The DOM ruler lives in `./measure.ts`.
 *
 * ## The algorithm
 *
 * `reflowSlide(slide, theme, measure)` runs four stages. Stages 1 and 2 are one
 * *pass*; stage 3 re-runs the pass at a smaller size, up to `MAX_STEPS` times.
 *
 * 1. **Fit.** Every auto-height text, gap-text and option element is measured at
 *    its own width (minus the chrome its renderer draws inside the box: padding,
 *    an option's letter chip, its tick lane, its border) and its height set to
 *    exactly that. *Exactly* matters: in edit mode `use-auto-height.ts` owns the
 *    stored height of an auto-height box and rewrites it to the measured content
 *    on the next frame. An engine that stored a padded height would have it
 *    silently reverted, and every subsequent tidy would read the reverted value,
 *    re-pad it, and walk the slide down the page a little further each click.
 *    So the 4% `SAFETY` margin is spent as *clearance*, in stages 2 and 3, not
 *    baked into the box. Option cards in the same row are then equalised to the
 *    tallest of the row, so growing one card cannot leave a ragged edge.
 *
 * 2. **Push down.** Elements are visited in reading order (top edge, then draw
 *    order). An element collides when an earlier element it overlaps
 *    horizontally now ends below the gap the author left it. Only then does it
 *    move, and it moves to `bottom + 4% + the original gap`, landed on the 7pt
 *    baseline (`BASELINE`) — the rhythm of the slide is the author's, not ours,
 *    and the 4% is the cushion for the browser we did not measure in, which will
 *    break a line one word earlier than we did. An element that is already clear
 *    is left at the exact point the author put it, which is what makes tidying a
 *    tidy slide a genuine no-op. Pairs that already overlapped before the reflow
 *    are skipped: a label on a shape, a caption on an image and a card behind
 *    text are deliberate layering, and "fixing" them would destroy the design.
 *    Images, locked elements, rotated elements and full-bleed backdrops never
 *    move; they still act as obstacles for everything below them.
 *
 * 3. **Step down.** If the content, plus its 4% cushion, runs past the bottom of
 *    the safe area,
 *    every `heading`, `body` and `small` text on the slide steps down one stop
 *    on the theme's own type ladder (title → subtitle → heading → body → small)
 *    and the pass runs again. `title`, `subtitle` and `caption` never step:
 *    the title is the slide's one focal element, and `caption` is a 1–3 word
 *    eyebrow that is already at its own floor. Nothing ever goes below
 *    `fontFloor(preset, role)` — the projector minimum for the role the text
 *    plays: title 48, question 38, option 31, heading 26, body 26, footnote 24
 *    (SPEC §7).
 *
 * 4. **Split.** If it still does not fit, the engine stops shrinking and reports
 *    `splitAt`: the index in `slide.elements` of the first element that runs
 *    past the safe area. The caller (`./tidy.ts`) turns that into a continuation
 *    slide of the same kind, using `splitDocToFit` / `splitListElement` to carry
 *    the remaining list items across. Shrinking further would break the floor;
 *    a second slide is free.
 *
 * Known limit, recorded rather than hidden: a movable element pushed down may
 * land on a *frozen* element that sits below it (a locked image, say). The
 * engine will not move the image, so `lint.ts` reports the overlap instead of
 * the engine silently producing one.
 */

import type {
  Id,
  RichDoc,
  RichNode,
  Slide,
  SlideElement,
  TextPreset,
  TextStyle,
  Theme,
} from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import {
  BASELINE,
  contains,
  fontFloor,
  OPTION,
  type Rect,
  resolveTextStyle,
  SAFE_BOTTOM,
  SAFETY,
  type TextRole,
  withSafety,
} from "@tj/slides";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/**
 * `SAFETY`, `withSafety`, `SAFE_BOTTOM` and `OPTION` live in `@tj/slides` (ADR 0025 §9) so the
 * recipes size cards from the numbers the engine measures with; re-exported for the callers here.
 */
export { OPTION, SAFE_BOTTOM, SAFETY, withSafety };

/** Sub-point noise from rounding is not an overflow. */
const EPS = 0.5;

/** How many times the type may step down before we split instead. */
const MAX_STEPS = 3;

/** Presets the step-down touches. Never `title`/`subtitle` (focal), never `caption` (a label). */
export const STEPPABLE: readonly TextPreset[] = ["heading", "body", "small"];

/** The theme's own type ladder, largest first, used as the step-down stops. */
const LADDER: readonly TextPreset[] = ["title", "subtitle", "heading", "body", "small"];

/* ------------------------------------------------------------------ */
/* Measurement contract                                                */
/* ------------------------------------------------------------------ */

export type MeasureInput = {
  doc: RichDoc;
  /** Width of the whole element box in slide points. */
  width: number;
  /** Style as authored. The measurer resolves it against the theme. */
  style?: Partial<TextStyle>;
  preset: TextPreset;
  /** What the text is doing, where the preset cannot say it (an option card). */
  role?: TextRole;
  /** Explicit size, already clamped to the role's floor. Beats `style.fontSize`. */
  fontSize?: number;
  /** Horizontal chrome inside the box: padding, chips, tick lanes, borders. */
  inset: number;
  /** Vertical chrome inside the box. */
  chrome: number;
};

/** Height in slide points the box needs, chrome included. */
export type Measurer = (input: MeasureInput) => number;

export type ReflowResult = {
  /** The slide's elements, with new heights, positions and stepped sizes. */
  elements: SlideElement[];
  /** Ids still running past the safe area after everything the engine can do. */
  overflow: Id[];
  /**
   * Ids still standing in the lane a caller reserved with `fitBottom` — today the
   * "Why?" panel's. They are not overflows: the slide is legal and nothing is off
   * it, but the reason has nowhere to go, so the Tidy toast and the navigator
   * badge report them rather than letting an opaque panel land in a sliver.
   * Empty when no lane was reserved.
   */
  laneOverflow: Id[];
  /** Index in `elements` of the first element that does not fit, if any. */
  splitAt?: number;
  /** Ids whose y changed. */
  moved: Id[];
  /** Ids whose font size stepped down. */
  stepped: Id[];
};

/* ------------------------------------------------------------------ */
/* Element classification                                              */
/* ------------------------------------------------------------------ */

/** A full-bleed shape or image: the slide's backdrop, not a box in the flow. */
export function isBackdrop(el: SlideElement): boolean {
  if (el.type !== "shape" && el.type !== "image") return false;
  const area = (el.w * el.h) / (SLIDE_W * SLIDE_H);
  return area >= 0.85;
}

/** A rule, not a block: a hairline divider is decoration and never collides. */
export function isHairline(el: SlideElement): boolean {
  if (el.type === "line") return true;
  if (el.type !== "shape") return false;
  return el.h <= 2 || el.w <= 2;
}

/**
 * Something a block is allowed to sit *on*: a card, an image, an icon. An element
 * overlapping one of these was laid out that way on purpose, and moving it would take
 * the label off its card. A hairline is not one of these — a rule is part of the
 * vertical flow and travels with the blocks it separates.
 */
export function isLayerBelow(el: SlideElement): boolean {
  if (el.type !== "shape" && el.type !== "image" && el.type !== "icon") return false;
  return !isHairline(el);
}

/** Never repositioned by the engine (SPEC: images and locked elements stay put). */
export function isFrozen(el: SlideElement): boolean {
  return !!el.locked || el.type === "image" || !!el.rotation || isBackdrop(el);
}

/** The text carried by an element, plus the chrome its renderer draws around it. */
export function textPartsOf(
  el: SlideElement,
  slide?: Pick<Slide, "question">,
): {
  doc: RichDoc;
  style?: Partial<TextStyle>;
  preset: TextPreset;
  role?: TextRole;
  inset: number;
  chrome: number;
  autoHeight: boolean;
} | null {
  if (el.type === "text" || el.type === "gap-text") {
    const pad = el.style.padding ?? 0;
    return {
      doc: el.doc,
      style: el.style,
      preset: el.style.preset,
      inset: pad * 2,
      chrome: pad * 2,
      autoHeight: el.style.autoHeight !== false,
    };
  }
  if (el.type === "option") {
    const q = slide?.question?.type;
    const scorable = q === "multiple-choice" || q === "true-false";
    // The chip is dropped when it only repeats the card's own words; assume it is
    // drawn when a label exists, which is the conservative (wider) reading.
    const hasChip = !!el.label?.trim();
    const inset =
      OPTION.pad * 2 +
      OPTION.border * 2 +
      (scorable ? OPTION.tickLane : 0) +
      (hasChip ? OPTION.chip + OPTION.chipGap : 0);
    return {
      doc: el.doc,
      style: { preset: "small", valign: "middle", lineHeight: OPTION.line, ...el.textStyle },
      preset: el.textStyle?.preset ?? "small",
      // An answer card sits on the 31pt option floor whichever stop it is set in.
      role: "option",
      inset,
      chrome: OPTION.pad * 2 + OPTION.border * 2,
      autoHeight: el.textStyle?.autoHeight !== false,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Type ladder                                                         */
/* ------------------------------------------------------------------ */

/** The distinct sizes of the theme's ladder, largest first. */
function stops(theme: Theme): number[] {
  return Array.from(new Set(LADDER.map((p) => theme.sizes[p]))).sort((a, b) => b - a);
}

/**
 * One stop down the theme ladder, clamped to the role's legibility floor.
 * Returns the same size when it is already at the floor, so callers can detect
 * "nothing left to give".
 */
export function stepDownSize(
  theme: Theme,
  preset: TextPreset,
  size: number,
  role?: TextRole,
): number {
  const floor = fontFloor(preset, role);
  if (size <= floor) return floor;
  const next = stops(theme).find((s) => s < size - EPS);
  // Below the smallest stop there is still room above the floor: give up 10%.
  const target = next ?? Math.round(size * 0.9);
  return Math.max(floor, Math.round(target));
}

/** Resolved size of an element's text, honouring an in-flight step-down override. */
function sizeOf(
  theme: Theme,
  parts: NonNullable<ReturnType<typeof textPartsOf>>,
  override?: number,
): number {
  if (override !== undefined) return override;
  return resolveTextStyle(parts.style, theme, parts.preset, parts.role).fontSize;
}

/* ------------------------------------------------------------------ */
/* The pass                                                            */
/* ------------------------------------------------------------------ */

type Slot = {
  el: SlideElement;
  index: number;
  y: number;
  h: number;
  frozen: boolean;
  /** Original geometry, for gap preservation and change detection. */
  y0: number;
  h0: number;
};

const snapDown = (v: number) => Math.ceil(v / BASELINE) * BASELINE;

/** Do two boxes share any horizontal extent? */
const overlapsX = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && a.x + a.w - EPS > b.x;

const rect = (s: Slot): Rect => ({ x: s.el.x, y: s.y, w: s.el.w, h: s.h });
const rect0 = (s: Slot): Rect => ({ x: s.el.x, y: s.y0, w: s.el.w, h: s.h0 });

function layoutPass(slide: Slide, theme: Theme, measure: Measurer, sizes: Map<Id, number>): Slot[] {
  const slots: Slot[] = slide.elements.map((el, index) => ({
    el,
    index,
    y: el.y,
    h: el.h,
    y0: el.y,
    h0: el.h,
    frozen: isFrozen(el),
  }));

  /* --- 1. Fit ---------------------------------------------------- */
  for (const slot of slots) {
    if (slot.frozen) continue;
    const parts = textPartsOf(slot.el, slide);
    if (!parts?.autoHeight) continue;
    const measured = measure({
      doc: parts.doc,
      width: slot.el.w,
      style: parts.style,
      preset: parts.preset,
      role: parts.role,
      fontSize: sizeOf(theme, parts, sizes.get(slot.el.id)),
      inset: parts.inset,
      chrome: parts.chrome,
    });
    slot.h = Math.max(1, Math.round(measured));
  }

  /* Option cards in the same row share the tallest height, or the row goes ragged. */
  const options = slots.filter((s) => s.el.type === "option" && !s.frozen);
  const rows: Slot[][] = [];
  for (const slot of options) {
    const row = rows.find((r) =>
      r.some((o) => o.y0 < slot.y0 + slot.h0 - EPS && o.y0 + o.h0 - EPS > slot.y0),
    );
    if (row) row.push(slot);
    else rows.push([slot]);
  }
  for (const row of rows) {
    const tallest = Math.max(...row.map((s) => s.h));
    for (const s of row) s.h = tallest;
  }

  /* --- 2. Push down ---------------------------------------------- */
  const order = [...slots].sort((a, b) => a.y0 - b.y0 || a.index - b.index);
  const placed: Slot[] = [];
  for (const slot of order) {
    if (slot.frozen) {
      placed.push(slot);
      continue;
    }
    let top = slot.y0;
    for (const other of placed) {
      if (isHairline(slot.el) && isHairline(other.el)) continue;
      if (!overlapsX(rect(slot), rect(other))) continue;
      // Anything involving a card, an image or an icon was stacked on purpose.
      const layered = isLayerBelow(other.el) || isLayerBelow(slot.el);
      if (layered && (contains(rect0(other), rect0(slot)) || contains(rect0(slot), rect0(other))))
        continue;
      let gap = slot.y0 - (other.y0 + other.h0);
      if (gap < -EPS) {
        // They already overlap. If the lower one is sitting on a card, an image or an
        // icon, that is deliberate layering and the design stays as drawn. Two blocks
        // in the same column overlapping is the defect this engine exists to fix — and
        // it is the state a slide arrives in, because the renderer's auto-height grows
        // a box into whatever is beneath it. There is no authored gap left to preserve,
        // so they are separated with none, and the baseline snap does the rest.
        if (layered) continue;
        gap = 0;
      }
      // Already clear at the authored gap? Then nothing to do — and the slide does
      // not creep down the page on a second tidy.
      if (other.y + other.h + gap <= slot.y0 + EPS) continue;
      const want = other.y + withSafety(other.h) + gap;
      if (want > top) top = want;
    }
    // Only a moved element is re-snapped; a settled slide must tidy to itself.
    slot.y = top > slot.y0 + EPS ? snapDown(top) : slot.y0;
    placed.push(slot);
  }

  return slots;
}

/* ------------------------------------------------------------------ */
/* reflowSlide                                                         */
/* ------------------------------------------------------------------ */

/** Where the box ends once its cushion is counted — what the fit test uses. */
const safeBottomOf = (s: Slot) => s.y + withSafety(s.h);
const overflowing = (slots: Slot[], bottom: number) =>
  slots.some((s) => safeBottomOf(s) > bottom + EPS);

export type ReflowOptions = {
  /**
   * A raised floor for the *fit* test only, for slides that owe room to something
   * the engine does not lay out — today, the "Why?" panel on a true-false or
   * multiple-choice slide (`./explanation.ts`). Content that runs into that lane
   * makes the type step down; it never counts as an overflow, because a reason a
   * teacher has not written yet must not split their slide in two.
   */
  fitBottom?: number;
};

/**
 * Fit every text box on a slide, push what collides down the 7pt rhythm, step the
 * type down if the slide still overruns, and report where to split if it still
 * does. Pure: the only measurement is the injected `measure`.
 */
export function reflowSlide(
  slide: Slide,
  theme: Theme,
  measure: Measurer,
  options: ReflowOptions = {},
): ReflowResult {
  const fitBottom = Math.min(options.fitBottom ?? SAFE_BOTTOM, SAFE_BOTTOM);
  const sizes = new Map<Id, number>();
  let slots = layoutPass(slide, theme, measure, sizes);

  for (let round = 0; round < MAX_STEPS && overflowing(slots, fitBottom); round++) {
    let anyStepped = false;
    for (const el of slide.elements) {
      const parts = textPartsOf(el, slide);
      if (!parts || !STEPPABLE.includes(parts.preset)) continue;
      const current = sizeOf(theme, parts, sizes.get(el.id));
      const next = stepDownSize(theme, parts.preset, current, parts.role);
      if (next < current - EPS) {
        sizes.set(el.id, next);
        anyStepped = true;
      }
    }
    if (!anyStepped) break;
    slots = layoutPass(slide, theme, measure, sizes);
  }

  const overflow = slots.filter((s) => safeBottomOf(s) > SAFE_BOTTOM + EPS);
  const firstBad = [...overflow].sort((a, b) => a.y - b.y || a.index - b.index)[0];
  // Only worth reporting when a lane was actually asked for: with no `fitBottom`
  // this is the overflow list again, and saying the same thing twice helps nobody.
  const laneOverflow =
    fitBottom < SAFE_BOTTOM - EPS ? slots.filter((s) => safeBottomOf(s) > fitBottom + EPS) : [];

  const elements = slots.map((slot) => applySlot(slot, sizes.get(slot.el.id)));

  return {
    elements,
    overflow: overflow.map((s) => s.el.id),
    laneOverflow: laneOverflow.map((s) => s.el.id),
    splitAt: firstBad ? firstBad.index : undefined,
    moved: slots.filter((s) => Math.abs(s.y - s.y0) > EPS).map((s) => s.el.id),
    stepped: [...sizes.keys()],
  };
}

/** A slot back into an element, without mutating the input. */
function applySlot(slot: Slot, size: number | undefined): SlideElement {
  const el = slot.el;
  const geom = { y: slot.y, h: slot.h };
  if (size === undefined) return { ...el, ...geom };
  if (el.type === "text" || el.type === "gap-text") {
    return { ...el, ...geom, style: { ...el.style, fontSize: size } };
  }
  if (el.type === "option") {
    return { ...el, ...geom, textStyle: { ...el.textStyle, fontSize: size } };
  }
  return { ...el, ...geom };
}

/* ------------------------------------------------------------------ */
/* Splitting                                                           */
/* ------------------------------------------------------------------ */

/** The top-level list node of a bullet / numbered doc, if that is all the doc is. */
function soleList(doc: RichDoc): RichNode | null {
  const content = doc.content ?? [];
  if (content.length !== 1) return null;
  const node = content[0];
  if (!node || (node.type !== "bulletList" && node.type !== "orderedList")) return null;
  return node;
}

/** Number of splittable lines in a doc: list items if it is a list, blocks otherwise. */
export function docLineCount(doc: RichDoc): number {
  const list = soleList(doc);
  return (list ? list.content : doc.content)?.length ?? 0;
}

/**
 * Split a doc at `atLine` for a continuation slide. Bullet and numbered lists split
 * on their list items and the tail keeps counting from where the head stopped, so a
 * numbered objectives list continues at 4 rather than restarting at 1. Anything else
 * splits on top-level blocks. `tail` is null when there is nothing to carry over.
 */
export function splitListElement(
  doc: RichDoc,
  atLine: number,
): { head: RichDoc; tail: RichDoc | null } {
  const list = soleList(doc);
  const items = (list ? list.content : doc.content) ?? [];
  if (atLine <= 0 || atLine >= items.length) return { head: doc, tail: null };

  const headItems = items.slice(0, atLine);
  const tailItems = items.slice(atLine);

  if (!list)
    return { head: { type: "doc", content: headItems }, tail: { type: "doc", content: tailItems } };

  const start = typeof list.attrs?.start === "number" ? list.attrs.start : 1;
  return {
    head: { type: "doc", content: [{ ...list, content: headItems }] },
    tail: {
      type: "doc",
      content: [
        {
          ...list,
          attrs:
            list.type === "orderedList" ? { ...list.attrs, start: start + atLine } : list.attrs,
          content: tailItems,
        },
      ],
    },
  };
}

/**
 * The largest prefix of `doc` that fits in `available` points at the given metrics.
 * Used to build a continuation slide: the head keeps everything that fits, the tail
 * carries the rest. Returns `tail: null` when the whole doc fits.
 */
export function splitDocToFit(
  doc: RichDoc,
  base: Omit<MeasureInput, "doc">,
  available: number,
  measure: Measurer,
): { head: RichDoc; tail: RichDoc | null; lines: number } {
  const total = docLineCount(doc);
  if (total <= 1) return { head: doc, tail: null, lines: total };
  if (measure({ ...base, doc }) <= available + EPS) return { head: doc, tail: null, lines: total };

  let fits = 0;
  for (let n = 1; n < total; n++) {
    const { head } = splitListElement(doc, n);
    if (measure({ ...base, doc: head }) > available + EPS) break;
    fits = n;
  }
  // Never produce an empty head: one line stays even if it technically overruns.
  const at = Math.max(1, fits);
  const { head, tail } = splitListElement(doc, at);
  return { head, tail, lines: at };
}
