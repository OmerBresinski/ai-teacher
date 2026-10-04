import {
  type CalloutKind,
  type IconElement,
  richDocToPlainText,
  type ShapeElement,
  type Slide,
  type SlideElement,
  type TextElement,
  type Theme,
} from "@tj/domain/documents";
import { uid } from "./factories";
import type { Rect } from "./geometry";
import { BASELINE, SAFE, SPACE, snapY } from "./grid";
import {
  BODY_Y,
  boxH,
  CARD_PAD,
  type ContentVariant,
  centreY,
  FULL,
  IDEA_NAME,
  IMAGE_TEXT_COLUMN,
  type Layout,
  shape,
  text,
} from "./layouts";
import { SAFE_BOTTOM } from "./metrics";
import { shortMisconception } from "./misconception";
import { isBackdrop, isFootBand, stepDownSize } from "./reflow";
import { countLines } from "./text-measure";
import { resolveFontSize } from "./text-style";
import { calloutTone, fontFloor } from "./themes";

/*
 * The slide callout (UX ruling 84, TEACH-75): Chalkie's labelled card under the body, refined to
 * the design system. One rounded card with the theme's radius, tinted per kind with a hairline in
 * the same hue (`CALLOUT_TONES`: a red for a common mistake, a green for an example, an amber for
 * key words, tuned per theme); a drawn lucide icon per kind at the head of the label row, where
 * Chalkie puts an emoji; a `caption` eyebrow as the label ("COMMON MISTAKE", "EXAMPLE", "KEY WORDS"); and the
 * text in `small`, one size down from the body, label and text in the hue's ink as Chalkie sets
 * them. The card sits in the text column under the body, full column width, never over a picture,
 * and is sized to its text as Chalkie's is: the body above gives up room only when the card
 * reaches into its box.
 *
 * `applyCallout` is the only entry: a laid-out recipe in, the same layout plus four named elements
 * out. A spec without a callout never reaches it, so every recipe stays byte-identical.
 */

/**
 * The label each kind carries: frozen strings, uppercase like the "KEY IDEA" eyebrow (ruling 8).
 * The kind id `watch-out` is the domain's (`CALLOUT_KINDS`, shared with the outline); its label
 * says what the card holds, a common mistake (review T75-9), so the id and the label differ.
 */
export const CALLOUT_LABELS: Record<CalloutKind, string> = {
  "watch-out": "COMMON MISTAKE",
  example: "EXAMPLE",
  "key-words": "KEY WORDS",
};

/**
 * The drawn icon each kind carries (lucide names from the editor's icon set), drawn in the kind's
 * colour rather than set as emoji: Chalkie's warning sign for a common mistake; a lightbulb for
 * an example and an open book for key words, where Chalkie has a magnifier and a key (review
 * T75-7: the idea and the vocabulary read faster than the tools).
 */
export const CALLOUT_ICONS: Record<CalloutKind, string> = {
  "watch-out": "triangle-alert",
  example: "lightbulb",
  "key-words": "book-open",
};

/** The four elements a callout adds, by `name`; the card first so the rest stay above it. */
export const CALLOUT_NAMES = {
  card: "Callout card",
  icon: "Callout icon",
  label: "Callout label",
  text: "Callout text",
} as const;

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
 * Lines of `small` a callout's text takes across a card `width` wide, measured with the headless
 * ruler (`countLines`, the fit engine's own), at `size` when the text has been stepped down. The
 * card hugs this count, so it is never a line taller than its text on any theme.
 */
export function calloutLines(t: Theme, text: string, width: number, size?: number): number {
  return countLines(text.trim(), "small", t, width - 2 * CARD_PAD, undefined, size);
}

/** Height of the callout's text box: `lines` lines of `small`, at `size` when stepped down. */
const calloutTextH = (t: Theme, lines: number, size?: number): number =>
  size === undefined ? boxH(t, "small", lines) : Math.ceil(size * t.lineHeights.small * lines);

/** Height of a callout card holding `lines` lines of `small` under its label. */
export function calloutHeight(t: Theme, lines: number, size?: number): number {
  return CARD_PAD + labelRowH(t) + LABEL_GAP + calloutTextH(t, lines, size) + CARD_PAD;
}

/** How a callout's text is set in its card: lines, card height and, when stepped, the size. */
export type CalloutFit = { lines: number; height: number; size?: number };

/**
 * The card for `text` across `width`, no taller than `room` (UX rulings 91 and 102): at the
 * theme's `small` if it fits, else one stop down (`stepDownSize`, never below the 24pt floor),
 * else nothing, and the caller drops the callout rather than clip it.
 */
export function fitCallout(
  t: Theme,
  text: string,
  width: number,
  room: number,
): CalloutFit | undefined {
  const full = resolveFontSize(t, "small");
  const lines = calloutLines(t, text, width);
  const height = calloutHeight(t, lines);
  if (height <= room) return { lines, height };
  const size = stepDownSize(t, "small", full);
  if (size >= full) return undefined;
  const stepped = calloutLines(t, text, width, size);
  const steppedH = calloutHeight(t, stepped, size);
  return steppedH <= room ? { lines: stepped, height: steppedH, size } : undefined;
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
  size?: number,
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
      size === undefined ? { color: tone.ink } : { color: tone.ink, fontSize: size },
      { name: CALLOUT_NAMES.text },
    ),
  ];
}

/** The kinds whose spec may carry a callout (ruling 84). */
export type CalloutHost = "content" | "image-text" | "worked-example";

/**
 * Lay the callout into a filled recipe: append the four and shrink the box that gives up the room.
 *
 * - Content `headed`, `two-column` and `callout-row`: the card across `FULL`, bottom-anchored like
 *   the working card, sized to its text; a body box (both columns) that reaches within `SPACE[2]`
 *   of the card is cut to end there, a shorter one is left as the recipe laid it. `callout-row` is
 *   the composition built for it: one sentence hugged by its box, so the row has the rest.
 * - Image-text: the card in the text column under the body, sized to its text; the column's stack
 *   is re-centred with the card counted, and the body keeps what is left above the cards' common
 *   bottom edge.
 * - Either host: the card grows to hold every line the ruler measures, down to two lines of body
 *   above it; past that the text steps down one stop (`fitCallout`); past that the callout is
 *   left off and the layout returned unchanged, never clipped (rulings 91 and 102).
 *   `materialiseSlide` reports the drop to its caller, which logs it.
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
  const placed = calloutOnce(laid, t, kind, variant, callout);
  // TEACH-87: a composed COMMON MISTAKE card that has no room whole falls back to the belief
  // alone (the correction is in the notes); never a shortened sentence.
  const short = callout.kind === "watch-out" ? shortMisconception(callout.text) : undefined;
  if (placed !== laid || short === undefined) return placed;
  return calloutOnce(laid, t, kind, variant, { ...callout, text: short });
}

function calloutOnce(
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
  const bodies = texts(laid, (el) =>
    variant === "two-column"
      ? el.name === "Body left" || el.name === "Body right"
      : el.style.preset === "body",
  );
  // The body keeps two lines of its own; the card may take everything under them.
  const bodyTop = Math.max(...bodies.map((body) => body.y));
  const room = CARD_BOTTOM - (bodyTop + boxH(t, "body", 2) + SPACE[2]);
  const fit = fitCallout(t, callout.text, FULL, room);
  if (!fit) return laid;
  const y = Math.max(bottomAnchoredY(fit.height), CARD_BOTTOM - room);
  const rect = { x: SAFE.x, y, w: FULL, h: CARD_BOTTOM - y };
  for (const body of bodies) body.h = Math.min(body.h, y - SPACE[2] - body.y);
  return { ...laid, elements: [...laid.elements, ...calloutElements(t, callout, rect, fit.size)] };
}

function applyToImageText(laid: Layout, t: Theme, callout: CalloutSpec): Layout {
  const [caption] = texts(laid, (el) => el.style.preset === "caption");
  const [heading] = texts(laid, (el) => el.style.preset === "heading");
  const [body] = texts(laid, (el) => el.style.preset === "body");
  if (!caption || !heading || !body) throw new Error("image-text recipe is missing a text slot");
  // The recipe's stack: caption, 12, heading, 19, body. The heading's box is the recipe's two
  // lines; it takes the lines its text measures (as the fit would), so the column's room is real.
  // The card joins after `SPACE[2]`. The body keeps every line it measures at the body floor,
  // the size the fit steps it to when the column is full, so the fit never has to push the card
  // off the slide (rulings 91 and 102); the card may take the rest.
  heading.h = Math.min(heading.h, boxH(t, "heading", measured(t, heading)));
  const above = caption.h + 12 + heading.h + 19;
  const floor = fontFloor("body");
  const bodyLines = countLines(richDocToPlainText(body.doc), "body", t, body.w, undefined, floor);
  const bodyFloor = Math.ceil(floor * t.lineHeights.body * bodyLines);
  const room = CARD_BOTTOM - SAFE.y - above - bodyFloor - SPACE[2];
  const fit = fitCallout(t, callout.text, IMAGE_TEXT_COLUMN.w, room);
  if (!fit) return laid;
  const cardH = fit.height;
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
  return { ...laid, elements: [...laid.elements, ...calloutElements(t, callout, rect, fit.size)] };
}

/**
 * The height, in slide points, the worked example's working text would keep if a full-width
 * callout card of `lines` lines took the foot of the slide: the working card's recipe
 * (`workedExampleSlide`: `BODY_Y`, a two-line question, `SPACE[2]`, the inset, the caption and its
 * 12) against the card's bottom-anchored top less `SPACE[2]`. Negative when the card would reach
 * up past the working's first line. This is the measurement behind the worked example going
 * without a callout; `callout.test.ts` holds it, so a recipe change that frees the room shows up.
 */
export function workedExampleCalloutRoom(t: Theme, lines = 3): number {
  const cardTop = bottomAnchoredY(calloutHeight(t, lines));
  const questionH = boxH(t, "body", 2);
  const workingCardY = Math.round((BODY_Y + questionH + SPACE[2]) / BASELINE) * BASELINE;
  const workingY = workingCardY + CARD_PAD + boxH(t, "caption") + 12;
  return cardTop - SPACE[2] - CARD_PAD - workingY;
}

/** Lines a filled text box's own words take at its preset, by the headless ruler. */
const measured = (t: Theme, el: TextElement): number =>
  countLines(richDocToPlainText(el.doc), el.style.preset, t, el.w);

function texts(laid: Layout, where: (el: TextElement) => boolean): TextElement[] {
  return laid.elements.filter((el): el is TextElement => el.type === "text" && where(el));
}

/** Whether an element is one of a callout's four, for a filter or a test. */
export const isCalloutElement = (el: SlideElement): boolean =>
  el.name === CALLOUT_NAMES.card ||
  el.name === CALLOUT_NAMES.icon ||
  el.name === CALLOUT_NAMES.label ||
  el.name === CALLOUT_NAMES.text;

/* ---------------------------------------------------------- with the look */

/** A content slide's callout, taken off before the look and put back after it. */
export type DetachedCallout = { spec: CalloutSpec; kept: SlideElement[] };

/**
 * Take a content slide's callout off (TEACH-19 with TEACH-75): the look (`applyLook`) and the
 * structure pass (`structureSlide`) re-lay the words from the top of the slide and know nothing
 * of a card at its foot, so they would run the words, a side panel or a photo slot over it.
 * The words are laid out without it and `placeCallout` puts it back in the room they leave. A
 * slide without a whole callout (a teacher deleted its text or card) comes back as it is.
 */
export function detachCallout(slide: Slide): { slide: Slide; callout?: DetachedCallout } {
  const kept = slide.elements.filter(isCalloutElement);
  const card = kept.find((el) => el.name === CALLOUT_NAMES.card);
  const body = kept.find((el) => el.name === CALLOUT_NAMES.text);
  if (!card || body?.type !== "text") return { slide };
  const icon = kept.find((el): el is IconElement => el.type === "icon");
  const kind =
    (Object.keys(CALLOUT_ICONS) as CalloutKind[]).find((k) => CALLOUT_ICONS[k] === icon?.icon) ??
    "watch-out";
  return {
    slide: { ...slide, elements: slide.elements.filter((el) => !isCalloutElement(el)) },
    callout: { spec: { kind, text: richDocToPlainText(body.doc) }, kept },
  };
}

/**
 * The column a teaching slide's callout takes: the safe width less whatever stands at the foot
 * beside the words (a photo or diagram slot on either side, the key idea's side panel, each a
 * box narrower than the measure that reaches the foot), with the slot gutter kept.
 */
export function calloutColumn(slide: Slide): { x: number; w: number; beside: SlideElement[] } {
  const beside = slide.elements.filter(
    (el) =>
      !isBackdrop(el) &&
      !isFootBand(el) &&
      !isCalloutElement(el) &&
      el.y + el.h >= CARD_BOTTOM - 1 &&
      el.w < SAFE.w - 1,
  );
  let x: number = SAFE.x;
  let right: number = SAFE.x + SAFE.w;
  for (const el of beside) {
    const leftRoom = el.x - SPACE[5] - x;
    const rightRoom = right - (el.x + el.w + SPACE[5]);
    if (leftRoom >= rightRoom) right = Math.min(right, el.x - SPACE[5]);
    else x = Math.max(x, el.x + el.w + SPACE[5]);
  }
  return { x, w: right - x, beside };
}

/**
 * Put a callout back on a laid-out, fitted slide: across the text column, under the lowest
 * thing in it, bottom-anchored as `applyCallout` sets it. The text column is the safe width less
 * whatever stands at the foot beside the words (a photo or diagram slot on either side, the key
 * idea's side panel). The card is sized to its text, a stop down when it needs it; when even that
 * does not fit the room, `undefined`: the caller leaves the callout off and reports it, never
 * clipped and never over the words or the slot (rulings 91 and 102). Ids and provenance of a
 * stored callout are kept.
 */
export function placeCallout(
  slide: Slide,
  t: Theme,
  callout: DetachedCallout,
  ids: () => string = uid,
): Slide | undefined {
  const { x, w, beside } = calloutColumn(slide);
  if (w <= 2 * CARD_PAD) return undefined;
  const right = x + w;
  const flow = slide.elements.filter((el) => !isBackdrop(el) && !isFootBand(el));
  const inColumn = flow.filter((el) => !beside.includes(el) && el.x < right && el.x + el.w > x);
  const foot = Math.max(SAFE.y, ...inColumn.map((el) => el.y + el.h));
  const room = CARD_BOTTOM - (foot + SPACE[2]);
  const fit = fitCallout(t, callout.spec.text, w, room);
  if (!fit) return undefined;
  const anchored = Math.max(bottomAnchoredY(fit.height), CARD_BOTTOM - room);
  // The callout-row composition reads as one unit: its row sits a heading gap under the idea
  // rather than at the foot, so a short sentence does not leave a hole between them.
  const row = inColumn.some((el) => el.name === IDEA_NAME);
  const y = row ? Math.min(anchored, snapY(foot + SPACE[4])) : anchored;
  const h = row ? fit.height : CARD_BOTTOM - y;
  const fresh = calloutElements(t, callout.spec, { x, y, w, h }, fit.size);
  const placed = fresh.map((el): SlideElement => {
    const old = callout.kept.find((k) => k.name === el.name);
    return old ? ({ ...old, ...el, id: old.id } as SlideElement) : { ...el, id: ids() };
  });
  return { ...slide, elements: [...slide.elements, ...placed] };
}
