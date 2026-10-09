/**
 * Where reveal chrome goes so it never covers words (TEACH-101 part d): the answer line under an
 * open question, and the tick on a right card. Pure geometry in slide space, so the renderer, the
 * tests and any capture agree without measuring the DOM.
 */
import type { Slide, SlideElement } from "@tj/domain/documents";
import { SLIDE_H } from "@tj/domain/documents";
import { HEADING_NAME, isBackdrop } from "@tj/slides";
import { SAFE } from "../model/grid";

export type Box = { x: number; y: number; w: number; h: number };

export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** An element that draws words: a text box, a gap text, an option, or a shape with a label. */
export function hasText(el: SlideElement): boolean {
  if (el.type === "text" || el.type === "gap-text" || el.type === "option") return true;
  if (el.type === "shape" && "doc" in el && el.doc) {
    const walk = (n: { text?: string; content?: unknown[] }): boolean =>
      !!n.text?.trim() || (n.content ?? []).some((c) => walk(c as typeof n));
    return walk(el.doc as { content?: unknown[] });
  }
  return false;
}

/** The instruction line a template prints under its questions ("Point and say."). */
export const INSTRUCTION_NAME = "Instruction";

/** Gap between the answer lane and whatever sits above it, and the rule beside the answer. */
export const LANE_GAP = 12;
export const RULE_W = 3;
export const RULE_GAP = 19;
const MIN_LANE_W = 200;
const MIN_LANE_H = 30;

export type AnswerLane = Box & {
  /** Font size to draw the answer at; the whole answer fits the lane at this size. */
  size: number;
  /**
   * `lane`: a free stretch of the slide, clear of every box. `stage`: no free stretch holds the
   * whole answer even at the floor, so the reveal washes the body back and shows the answer large
   * over it, under the heading.
   */
  mode: "lane" | "stage";
  /** An element the answer replaces while it is shown (the instruction line), if any. */
  replaces?: string;
};

/** Average advance as a share of the size: a little wide of the body faces, so the estimate errs tall. */
const ADVANCE = 0.56;

/**
 * Estimated height of `text` at `size` in a column `width` wide: words packed greedily into lines
 * of `width / (size * ADVANCE)` characters, explicit line breaks kept. Deterministic in every mode
 * (no measurement, so capture and SSR agree with the editor).
 */
export function answerHeight(text: string, width: number, size: number, lineHeight: number) {
  const perLine = Math.max(1, Math.floor(width / (size * ADVANCE)));
  let lines = 0;
  for (const para of text.split(/\n/)) {
    let used = 0;
    lines++;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const need = used === 0 ? word.length : used + 1 + word.length;
      if (need <= perLine) used = need;
      else {
        lines +=
          used === 0 ? Math.ceil(word.length / perLine) - 1 : Math.ceil(word.length / perLine);
        used = word.length % perLine || perLine;
      }
    }
  }
  return Math.ceil(lines * size * lineHeight);
}

/** Every box the answer must stay clear of: everything drawn but the full-slide backdrop. */
function obstaclesOf(slide: Slide, hidden?: string): Box[] {
  return slide.elements.filter((e) => e.id !== hidden && !isBackdrop(e));
}

/**
 * The widest stretch of `[SAFE.x, SAFE right]` that no obstacle meeting the band `[top, bottom]`
 * covers.
 */
function widestFree(obstacles: Box[], top: number, bottom: number): { x: number; w: number } {
  const right = SAFE.x + SAFE.w;
  const blocks = obstacles
    .filter((o) => o.y < bottom && o.y + o.h > top)
    .map((o) => [Math.max(SAFE.x, o.x), Math.min(right, o.x + o.w)] as const)
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let best: { x: number; w: number } = { x: SAFE.x, w: 0 };
  let cursor: number = SAFE.x;
  for (const [a, b] of blocks) {
    if (a - cursor > best.w) best = { x: cursor, w: a - cursor };
    cursor = Math.max(cursor, b);
  }
  if (right - cursor > best.w) best = { x: cursor, w: right - cursor };
  return best;
}

/** Width the answer's words get in a lane: the lane less the accent rule and its gap. */
export const answerTextWidth = (lane: Box) => lane.w - RULE_W - RULE_GAP;

/**
 * The lane for an answer revealed on the slide, always holding the whole answer (TEACH-101 part d):
 * the lowest free lane under or beside the words, at the theme's size, then one stop down, then the
 * floor; a lane that keeps the instruction line before one that takes its place. When no free lane
 * holds it even at the floor, the reveal becomes its own state (`stage`): the body is washed back
 * and the answer is set as large as fits under the heading. Never clipped, never over a word.
 */
export function answerLane(
  slide: Slide,
  text: string,
  sizes: { base: number; stepped: number; floor: number },
  lineHeight: number,
): AnswerLane {
  const bottom = SLIDE_H - SAFE.y;
  const instruction = slide.elements.find(
    (e) => e.name === INSTRUCTION_NAME && (e.type === "text" || e.type === "gap-text"),
  );
  const tried: (Box & { replaces?: string })[] = [];
  for (const replaces of instruction ? [undefined, instruction.id] : [undefined]) {
    const obstacles = obstaclesOf(slide, replaces);
    const tops = [SAFE.y, ...obstacles.map((o) => o.y + o.h + LANE_GAP)]
      .filter((t) => t <= bottom - MIN_LANE_H)
      .sort((a, b) => b - a);
    for (const top of tops) {
      const { x, w } = widestFree(obstacles, top, bottom);
      if (w >= MIN_LANE_W) tried.push({ x, y: top, w, h: bottom - top, replaces });
    }
  }
  const fits = (lane: Box, size: number) =>
    answerHeight(text, answerTextWidth(lane), size, lineHeight) <= lane.h;
  const ladder = [...new Set([sizes.base, sizes.stepped, sizes.floor])].filter(
    (n) => n >= sizes.floor,
  );
  for (const size of ladder) {
    for (const keep of [true, false]) {
      const lane = tried.find((l) => (l.replaces === undefined) === keep && fits(l, size));
      if (lane) return { ...lane, size, mode: "lane" };
    }
  }
  // Its own state: under the heading, the whole body width, as large as fits (down to the floor).
  const heading = slide.elements.find((e) => e.name === HEADING_NAME);
  const top = heading ? Math.min(heading.y + heading.h + LANE_GAP * 2, bottom - 120) : SAFE.y;
  const stage = { x: SAFE.x, y: top, w: SAFE.w, h: bottom - top };
  let size = Math.round(sizes.base * 1.5);
  while (size > sizes.floor && !fits(stage, size)) size -= 1;
  return { ...stage, size: Math.max(size, sizes.floor), mode: "stage" };
}

/** The tick's diameter and its inset inside a card. */
export const TICK_D = 36;
const TICK_INSET = 10;

/**
 * Where the tick on a right card goes, relative to the card: the top-right corner inside the card
 * when no words are there, else straddling that corner, which sits in the card's own padding (a
 * template keeps its words at least 20 px inside the edge), else the top-left equivalents. The
 * first spot clear of every box with words on the slide wins.
 */
export function tickSpot(slide: Slide, card: Box & { id?: string }): { left: number; top: number } {
  const half = TICK_D / 2;
  const spots = [
    { left: card.w - TICK_INSET - TICK_D, top: TICK_INSET },
    { left: card.w - half, top: -half },
    { left: TICK_INSET, top: TICK_INSET },
    { left: -half, top: -half },
  ];
  const words = slide.elements.filter((e) => e.id !== card.id && hasText(e));
  const clear = spots.find(
    (s) =>
      !words.some((w) =>
        intersects({ x: card.x + s.left, y: card.y + s.top, w: TICK_D, h: TICK_D }, w),
      ),
  );
  return clear ?? (spots[1] as { left: number; top: number });
}
