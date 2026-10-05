/**
 * Figure labels (ADR 0032): `small` text in a box measured with the headless ruler, wrapped inside
 * a capped width and cut with an ellipsis past three lines, so a long label never pushes a drawing
 * out of its box; the figure's alt text still carries the whole label. Shared by the templates,
 * which never import one another. Labels are Unicode text, bold when a template asks, with no
 * maths engine (ADR 0034 decision 2): `unicodeLabel` turns the ASCII shorthands a model may still
 * write into the characters a label draws.
 *
 * Load it through a template (so through `./index`), not first on its own: it reads `boxH` from
 * `../layouts`, which is in the layouts ↔ figures import cycle (see `./right-triangle`).
 */

import type { RichDoc, TextElement, Theme } from "@tj/domain/documents";
import { WEIGHT } from "../diagrams/style";
import { docFromText, newText } from "../factories";
import { boxH } from "../layouts";
import { countLines, lineWidth } from "../text-measure";

// Its own module, with no imports, so `./measure` can use it without joining the import cycle.
export { unicodeLabel } from "./unicode";

/** A label's box is this much wider than its text, so a line that fits the ruler never wraps. */
const LABEL_SLACK = 16;
const LABEL_MIN_W = 40;
/** Past this many lines a label is cut with an ellipsis; the alt text still carries all of it. */
const LABEL_MAX_LINES = 3;
/** Between the figure's box and its "Not drawn to scale" caption. */
const CAPTION_INSET = 4;
const NOT_TO_SCALE = "Not drawn to scale";
/** A bold label is measured at this weight, the bold the theme fonts ship. */
const BOLD_WEIGHT = 700;

type Box = { x: number; y: number; w: number; h: number };

/** A label as drawn: its text, wrapped in a box at most `maxW` wide, that box's size, its lines. */
export type FittedLabel = { text: string; w: number; h: number; lines: number };

/**
 * How wide a label's box may grow, and how much wider than its text it is (`slack`, never under
 * `minW`); a label squeezed beside a line takes a smaller slack than the default. Past `maxLines`
 * (three unless a template needs the room) the label is cut with an ellipsis. A `bold` label is
 * measured at the bold weight; draw it with `labelText`'s `bold` too.
 */
export type LabelFit = {
  maxW: number;
  slack?: number;
  minW?: number;
  maxLines?: number;
  bold?: boolean;
};

const labelWidth = (t: Theme, text: string, slack: number, minW: number, weight?: number) =>
  Math.max(minW, Math.ceil(lineWidth(text, "small", t, weight)) + slack);

export function fitLabel(
  t: Theme,
  text: string,
  {
    maxW,
    slack = LABEL_SLACK,
    minW = LABEL_MIN_W,
    maxLines = LABEL_MAX_LINES,
    bold = false,
  }: LabelFit,
): FittedLabel {
  // Left out, the ruler measures at the preset's own weight, as it always has.
  const weight = bold ? BOLD_WEIGHT : undefined;
  // At least a point of room inside the slack, or the ruler has nothing to wrap into.
  const w = Math.max(slack + 1, Math.min(maxW, labelWidth(t, text, slack, minW, weight)));
  const lines = (s: string) => countLines(s, "small", t, w - slack, weight);
  let shown = text;
  if (lines(text) > maxLines) {
    // The longest start of the label that still fits, with the ellipsis.
    const cut = (n: number) => `${text.slice(0, n).trimEnd()}…`;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lines(cut(mid)) <= maxLines) lo = mid;
      else hi = mid - 1;
    }
    shown = cut(lo);
  }
  const count = lines(shown);
  return { text: shown, w, h: boxH(t, "small", count), lines: count };
}

/** Every text node in a doc carries the `bold` mark. */
function boldDoc(doc: RichDoc): RichDoc {
  return {
    ...doc,
    content: doc.content?.map((paragraph) => ({
      ...paragraph,
      content: paragraph.content?.map((node) => ({ ...node, marks: [{ type: "bold" }] })),
    })),
  };
}

/**
 * A label's text element: `small`, no padding, centred vertically, in ink unless `color` says;
 * with `bold`, its text carries the `bold` mark (measure it with `fitLabel`'s `bold`).
 */
export function labelText(
  t: Theme,
  text: string,
  box: Box,
  align: "left" | "center" | "right",
  color = t.colors.ink,
  { bold = false, italic = false }: { bold?: boolean; italic?: boolean } = {},
): TextElement {
  const doc = bold ? boldDoc(docFromText(text)) : undefined;
  const marked =
    doc && italic
      ? {
          ...doc,
          content: doc.content?.map((p) => ({
            ...p,
            content: p.content?.map((nd) => ({
              ...nd,
              marks: [{ type: "bold" }, { type: "italic" }],
            })),
          })),
        }
      : doc;
  const el = newText("small", (marked as RichDoc | undefined) ?? text, box);
  // DIAGRAM-AUDIT look: figure labels sit on the diagrams' weight ladder (500), not regular.
  el.style = {
    ...el.style,
    align,
    valign: "middle",
    color,
    padding: 0,
    ...(bold ? {} : { fontWeight: WEIGHT.label }),
  };
  return el;
}

/** The muted "Not drawn to scale" caption, one line at the bottom left of a `size` box. */
export function notToScaleCaption(t: Theme, size: { w: number; h: number }): TextElement {
  const h = boxH(t, "small");
  const w = Math.min(
    labelWidth(t, NOT_TO_SCALE, LABEL_SLACK, LABEL_MIN_W),
    size.w - 2 * CAPTION_INSET,
  );
  const box = { x: CAPTION_INSET, y: size.h - CAPTION_INSET - h, w, h };
  return labelText(t, NOT_TO_SCALE, box, "left", t.colors.muted);
}
