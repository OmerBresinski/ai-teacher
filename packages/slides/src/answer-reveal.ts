import type { Slide, SlideElement, Theme } from "@tj/domain/documents";
import { SAFE } from "./grid";
import { SAFE_BOTTOM } from "./metrics";
import { isBackdrop } from "./reflow";
import { countLines } from "./text-measure";
import { resolveFontSize } from "./text-style";
import { fontFloor } from "./themes";

/*
 * Where a revealed model answer sits on an open-response slide (a question list's numbered
 * answers, TEACH-75 part k). Pure and measured with the headless font metrics, so present,
 * capture, print and the editor draw the same box before a font has loaded.
 *
 * The answer always gets a box of its own that holds every line:
 *
 * - **under**: the lane under the slide's content, when the answer fits there at or above the
 *   small floor. The question list's `Instruction` line ("Answer independently...") is not
 *   content once the answers show, so the lane may start over it; the box is opaque and covers it.
 * - **sheet**: otherwise the answer takes the body region under the heading, an opaque sheet over
 *   the questions, its type stepped from body size down to the small floor until it fits.
 *
 * Before this the box was clamped 48 points above the safe foot whatever stood there, so it
 * printed over the instruction and clipped every line after the first (and the answer's own line
 * breaks were collapsed into one run-on line).
 */

/** Gap between content and the answer, and the width of the accent rule beside it. */
export const ANSWER_GAP = 19;
export const ANSWER_RULE_W = 3;

export type AnswerRevealBox = {
  mode: "under" | "sheet";
  x: number;
  y: number;
  w: number;
  /** The box's full height, from `y` to the foot of the safe area. */
  h: number;
  fontSize: number;
  lineHeight: number;
  /** Lines the answer takes at `fontSize`. */
  lines: number;
  /** Still taller than the box at the floor: the editor flags it; the box clips on whole lines. */
  overflowing: boolean;
};

const isInstruction = (el: SlideElement) => el.name === "Instruction";
const isHeading = (el: SlideElement) => el.type === "text" && el.style.preset === "heading";

/** Elements standing in the safe area's width (backdrops are ground, not boxes). */
function inLane(el: SlideElement): boolean {
  return !isBackdrop(el) && el.x < SAFE.x + SAFE.w && el.x + el.w > SAFE.x;
}

/** The largest size, from `start` down to `floor`, at which `text` sets within `room`. */
function fit(
  text: string,
  theme: Theme,
  width: number,
  room: number,
  start: number,
  floor: number,
): { size: number; lines: number; fits: boolean } {
  const lh = theme.lineHeights.small;
  for (let size = start; size >= floor; size--) {
    const lines = countLines(text, "small", theme, width, undefined, size);
    if (Math.ceil(lines * size * lh) <= room) return { size, lines, fits: true };
  }
  const lines = countLines(text, "small", theme, width, undefined, floor);
  return { size: floor, lines, fits: false };
}

export function answerRevealLayout(
  slide: Pick<Slide, "elements">,
  theme: Theme,
  text: string,
): AnswerRevealBox {
  const els = slide.elements.filter(inLane);
  const width = SAFE.w - ANSWER_RULE_W - ANSWER_GAP;
  const lineHeight = theme.lineHeights.small;
  const small = resolveFontSize(theme, "small");
  const floor = fontFloor("small");

  const content = els.filter((el) => !isInstruction(el));
  const below = content.reduce<number>((m, el) => Math.max(m, el.y + el.h), SAFE.y);
  const underY = below + ANSWER_GAP;
  const under = fit(text, theme, width, SAFE_BOTTOM - underY, small, floor);
  if (under.fits)
    return {
      mode: "under",
      x: SAFE.x,
      y: underY,
      w: SAFE.w,
      h: SAFE_BOTTOM - underY,
      fontSize: under.size,
      lineHeight,
      lines: under.lines,
      overflowing: false,
    };

  const head = els.filter(isHeading).reduce<number>((m, el) => Math.max(m, el.y + el.h), SAFE.y);
  const sheetY = Math.min(head + ANSWER_GAP, SAFE_BOTTOM);
  const room = SAFE_BOTTOM - sheetY;
  const sheet = fit(
    text,
    theme,
    width,
    room,
    Math.max(small, resolveFontSize(theme, "body")),
    floor,
  );
  return {
    mode: "sheet",
    x: SAFE.x,
    y: sheetY,
    w: SAFE.w,
    h: room,
    fontSize: sheet.size,
    lineHeight,
    lines: sheet.lines,
    overflowing: !sheet.fits,
  };
}
