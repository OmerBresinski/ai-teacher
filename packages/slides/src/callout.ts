import type {
  CalloutKind,
  IconElement,
  ShapeElement,
  SlideElement,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { uid } from "./factories";
import type { Rect } from "./geometry";
import { BASELINE, SAFE, SPACE } from "./grid";
import {
  BODY_Y,
  boxH,
  CARD_PAD,
  type ContentVariant,
  centreY,
  FULL,
  IMAGE_TEXT_COLUMN,
  type Layout,
  shape,
  text,
} from "./layouts";
import { SAFE_BOTTOM } from "./metrics";
import { resolveFontSize } from "./text-style";
import { calloutTone } from "./themes";

/*
 * The slide callout (UX ruling 84, TEACH-75): Chalkie's labelled card under the body, refined to
 * the design system. One rounded card with the theme's radius, tinted per kind with a hairline in
 * the same hue (`CALLOUT_TONES`: rose for a warning, mint for an example, amber for key words, a
 * light and a dark set); a drawn lucide icon per kind at the head of the label row, where Chalkie
 * puts an emoji; a `caption` eyebrow as the label ("WATCH OUT", "EXAMPLE", "KEY WORDS"); and the
 * text in `small`, one size down from the body, label and text in the hue's ink as Chalkie sets
 * them. The card sits in the text column under the body, full column width, never over a picture,
 * and is sized to its text as Chalkie's is: the body above gives up room only when the card
 * reaches into its box.
 *
 * `applyCallout` is the only entry: a laid-out recipe in, the same layout plus four named elements
 * out. A spec without a callout never reaches it, so every recipe stays byte-identical.
 */

/** The label each kind carries: frozen strings, uppercase like the "KEY IDEA" eyebrow (ruling 8). */
export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  "watch-out": "WATCH OUT",
  example: "EXAMPLE",
  "key-words": "KEY WORDS",
};

/**
 * The drawn icon each kind carries (lucide names from the editor's icon set): Chalkie's warning
 * sign, magnifier and key, drawn in the theme's stroke rather than set as emoji.
 */
export const CALLOUT_ICONS: Record<CalloutKind, string> = {
  "watch-out": "triangle-alert",
  example: "search",
  "key-words": "key",
};

/** The four elements a callout adds, by `name`; the card first so the rest stay above it. */
export const CALLOUT_NAMES = {
  card: "Callout card",
  icon: "Callout icon",
  label: "Callout label",
  text: "Callout text",
} as const;

/**
 * The most lines of `small` a card holds. Measured, not assumed (`callout.test.ts` and the
 * editor's `layout/callout-fit` test hold them over every theme): across the full content width
 * three lines hold the 180-character ceiling of `SPEC_LIMITS.callout`; across the image-text
 * column three lines hold about eighty characters and the column has no fourth to give, because
 * the body above keeps two lines of its own, the least a picture slide's sentence needs. A longer
 * callout there runs past its box and the residual badge reports it (the writer trims, as for
 * every text between its aim and its ceiling). `small` is at or one step above its 24pt floor, so
 * the fit engine cannot step it down instead.
 */
export const CALLOUT_LINES = { full: 3, column: 3 } as const;

/**
 * Average advance the line estimate assumes, in ems: the 0.5 the fit engine's ruler, the "Why?"
 * panel's `reservedLines` and the test ruler all take, so the box holds every line the engine
 * counts. Measured on the TEACH-75 screenshots, Lexend (Chalk) and Inter (Night Lab) set running
 * text at 0.46 to 0.48em at the `small` stop, so a real line holds a little more than the estimate
 * and the card is never short of a line for prose; an unusual string of wide letters that needs
 * one more is what the residual badge reports.
 */
const ADVANCE = 0.5;

/** Gap between the label row and the text, the working card's `capH + 12` tightened one step. */
const LABEL_GAP = 8;

/**
 * The icon's square, in slide points: Chalkie's 24px emoji at 720 wide is 32pt here against a
 * 19pt label; ours stands about 1.7 caption sizes tall, as theirs does, and sets the label row's
 * height, the label centred on it.
 */
export const CALLOUT_ICON = 28;

/** Gap between the icon and the label. */
const ICON_GAP = 8;

/** The card's hairline, in points (non-scaling in the renderer). */
const CARD_STROKE = 1.5;

/** Height of the label row: the icon or the caption box, whichever is taller. */
const labelRowH = (t: Theme): number => Math.max(CALLOUT_ICON, boxH(t, "caption"));

export type CalloutSpec = { kind: CalloutKind; text: string };

/**
 * Lines of `small` a callout's text takes across a card `width` wide, one to `max`. A pure
 * estimate from the character count at the preset's resolved size (the recipes cannot measure);
 * the editor's ruler then fits the real text into the box the estimate sized.
 */
export function calloutLines(t: Theme, text: string, width: number, max: number): number {
  const size = resolveFontSize(t, "small");
  const perLine = Math.max(1, Math.floor((width - 2 * CARD_PAD) / (size * ADVANCE)));
  return Math.min(max, Math.max(1, Math.ceil(text.trim().length / perLine)));
}

/** Height of a callout card holding `lines` lines of `small` under its label. */
export function calloutHeight(t: Theme, lines: number): number {
  return CARD_PAD + labelRowH(t) + LABEL_GAP + boxH(t, "small", lines) + CARD_PAD;
}

/** Where every card's bottom edge sits: short of the safe edge by the working card's margin. */
const CARD_BOTTOM = SAFE_BOTTOM - SPACE[1];

/** The card's top for a bottom-anchored card of height `h`, on the rhythm. */
const bottomAnchoredY = (h: number): number => Math.floor((CARD_BOTTOM - h) / BASELINE) * BASELINE;

/**
 * The four for a card at `rect`: the tinted card, the icon and the label on one row at the inset,
 * the text beneath. Ungrouped, as the working card is, so each is selectable and deletable on its
 * own.
 */
export function calloutElements(
  t: Theme,
  callout: CalloutSpec,
  rect: Rect,
): [ShapeElement, IconElement, TextElement, TextElement] {
  const tone = calloutTone(t, callout.kind);
  const capH = boxH(t, "caption");
  const rowH = labelRowH(t);
  const inner = rect.w - 2 * CARD_PAD;
  const rowY = rect.y + CARD_PAD;
  const labelX = rect.x + CARD_PAD + CALLOUT_ICON + ICON_GAP;
  const textY = rowY + rowH + LABEL_GAP;
  const icon: IconElement = {
    id: uid(),
    type: "icon",
    x: rect.x + CARD_PAD,
    y: rowY + (rowH - CALLOUT_ICON) / 2,
    w: CALLOUT_ICON,
    h: CALLOUT_ICON,
    icon: CALLOUT_ICONS[callout.kind],
    color: tone.icon,
    strokeWidth: 2.25,
    name: CALLOUT_NAMES.icon,
  };
  return [
    shape("rounded", rect, {
      fill: tone.fill,
      stroke: tone.line,
      strokeWidth: CARD_STROKE,
      radius: t.radius,
      name: CALLOUT_NAMES.card,
    }),
    icon,
    text(
      "caption",
      CALLOUT_LABELS[callout.kind],
      { x: labelX, y: rowY + (rowH - capH) / 2, w: rect.x + rect.w - CARD_PAD - labelX, h: capH },
      { color: tone.ink },
      { name: CALLOUT_NAMES.label },
    ),
    text(
      "small",
      callout.text,
      { x: rect.x + CARD_PAD, y: textY, w: inner, h: rect.y + rect.h - CARD_PAD - textY },
      { color: tone.ink },
      { name: CALLOUT_NAMES.text },
    ),
  ];
}

/** The kinds whose spec may carry a callout (ruling 84). */
export type CalloutHost = "content" | "image-text" | "worked-example";

/**
 * Lay the callout into a filled recipe: append the four and shrink the box that gives up the room.
 *
 * - Content `headed` and `two-column`: the card across `FULL`, bottom-anchored like the working
 *   card, sized to its text; a body box (both columns) that reaches within `SPACE[2]` of the card
 *   is cut to end there, a shorter one is left as the recipe laid it.
 * - Image-text: the card in the text column under the body, sized to its text; the column's stack
 *   is re-centred with the card counted, and the body keeps what is left above the cards' common
 *   bottom edge.
 * - Worked example: unchanged, the callout dropped. The working card already runs to the foot and
 *   four one-line steps fill it on every theme (TEACH-247); `workedExampleCalloutRoom` measures
 *   what a card would leave the working, and even a one-line card leaves less than two body lines
 *   everywhere (32 to 63pt against 163 to 193 for four steps), so the callout goes without and the
 *   steps keep their room, the fallback TEACH-75 names for exactly this measurement. The spec
 *   keeps the field because the outline (`lab-plan-pipeline`, `outlineFromFacts`) assigns a
 *   "watch-out" to a worked example whose example carries a misconception; until a recipe change
 *   frees the room, that callout is written and not shown, which the outline or a ruling has to
 *   settle, not this function.
 *
 * The two refusals differ on purpose. A content `statement` has no column to hold a card and
 * `chooseVariant` never picks it for a spec with a callout, so reaching it here is a caller's bug
 * and throws. A worked example with a callout is a valid spec the recipe cannot hold, a content
 * condition like a fifth step (TEACH-245), so it is dropped rather than crashing a generation.
 */
export function applyCallout(
  laid: Layout,
  t: Theme,
  kind: CalloutHost,
  variant: string,
  callout: CalloutSpec,
): Layout {
  switch (kind) {
    case "content":
      return applyToContent(laid, t, variant as ContentVariant, callout);
    case "image-text":
      return applyToImageText(laid, t, callout);
    case "worked-example":
      return laid;
  }
}

function applyToContent(
  laid: Layout,
  t: Theme,
  variant: ContentVariant,
  callout: CalloutSpec,
): Layout {
  if (variant === "statement") {
    throw new Error("a content statement has no column for a callout; choose headed or two-column");
  }
  const lines = calloutLines(t, callout.text, FULL, CALLOUT_LINES.full);
  const y = bottomAnchoredY(calloutHeight(t, lines));
  const rect = { x: SAFE.x, y, w: FULL, h: CARD_BOTTOM - y };
  const bodies = texts(laid, (el) =>
    variant === "two-column"
      ? el.name === "Body left" || el.name === "Body right"
      : el.style.preset === "body",
  );
  for (const body of bodies) body.h = Math.min(body.h, y - SPACE[2] - body.y);
  return { ...laid, elements: [...laid.elements, ...calloutElements(t, callout, rect)] };
}

function applyToImageText(laid: Layout, t: Theme, callout: CalloutSpec): Layout {
  const [caption] = texts(laid, (el) => el.style.preset === "caption");
  const [heading] = texts(laid, (el) => el.style.preset === "heading");
  const [body] = texts(laid, (el) => el.style.preset === "body");
  if (!caption || !heading || !body) throw new Error("image-text recipe is missing a text slot");
  const lines = calloutLines(t, callout.text, IMAGE_TEXT_COLUMN.w, CALLOUT_LINES.column);
  const cardH = calloutHeight(t, lines);
  // The recipe's stack: caption, 12, heading, 19, body. The card joins it after `SPACE[2]`; the
  // body keeps what the column has left above the cards' common bottom edge.
  const above = caption.h + 12 + heading.h + 19;
  const bodyH = Math.min(body.h, CARD_BOTTOM - SAFE.y - above - SPACE[2] - cardH);
  const top = Math.max(SAFE.y, centreY(above + bodyH + SPACE[2] + cardH));
  caption.y = top;
  heading.y = top + caption.h + 12;
  body.y = heading.y + heading.h + 19;
  body.h = bodyH;
  const rect = {
    x: IMAGE_TEXT_COLUMN.x,
    y: body.y + bodyH + SPACE[2],
    w: IMAGE_TEXT_COLUMN.w,
    h: cardH,
  };
  return { ...laid, elements: [...laid.elements, ...calloutElements(t, callout, rect)] };
}

/**
 * The height, in slide points, the worked example's working text would keep if a full-width
 * callout card of `lines` lines took the foot of the slide: the working card's recipe
 * (`workedExampleSlide`: `BODY_Y`, a two-line question, `SPACE[2]`, the inset, the caption and its
 * 12) against the card's bottom-anchored top less `SPACE[2]`. Negative when the card would reach
 * up past the working's first line. This is the measurement behind the worked example going
 * without a callout; `callout.test.ts` holds it, so a recipe change that frees the room shows up.
 */
export function workedExampleCalloutRoom(t: Theme, lines: number = CALLOUT_LINES.full): number {
  const cardTop = bottomAnchoredY(calloutHeight(t, lines));
  const questionH = boxH(t, "body", 2);
  const workingCardY = Math.round((BODY_Y + questionH + SPACE[2]) / BASELINE) * BASELINE;
  const workingY = workingCardY + CARD_PAD + boxH(t, "caption") + 12;
  return cardTop - SPACE[2] - CARD_PAD - workingY;
}

function texts(laid: Layout, where: (el: TextElement) => boolean): TextElement[] {
  return laid.elements.filter((el): el is TextElement => el.type === "text" && where(el));
}

/** Whether an element is one of a callout's four, for a filter or a test. */
export const isCalloutElement = (el: SlideElement): boolean =>
  el.name === CALLOUT_NAMES.card ||
  el.name === CALLOUT_NAMES.icon ||
  el.name === CALLOUT_NAMES.label ||
  el.name === CALLOUT_NAMES.text;
