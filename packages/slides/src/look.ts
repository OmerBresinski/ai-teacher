import type { Slide, SlideElement, SlideKind, TextElement, Theme } from "@tj/domain/documents";
import { SLIDE_H, SLIDE_W } from "@tj/domain/documents";
import { docFromText, uid } from "./factories";
import { SAFE, SPACE, snapY } from "./grid";
import { HEADING_NAME, isBackdrop } from "./reflow";
import { docPlainText, joinSentences, sentences } from "./sentences";
import { measureHeadless } from "./text-measure";

/*
 * The lesson look (quality PRD "look" uplift, 26 Sept 2026): the chrome that gives every slide in a
 * deck one voice, drawn from the homepage example lessons. A pure pass over a laid-out slide, so it
 * runs on a freshly materialised slide and, unchanged, on a slide a lesson already stores:
 *
 *   - a cover: the title slide set on the theme's accent, its text in the accent's ink;
 *   - a kind tag: a small tinted pill above the heading that says what the slide is for
 *     (STARTER, TEACH, PRACTISE...), in place of the hairline under the heading;
 *   - the heading at the theme's own size, named so the fit engine never steps it down: the
 *     heading is the slide's focal line, and a long body steps its own type, not the heading's;
 *   - a teaching slide's first sentence as a lead, the rest on a tinted card beneath it;
 *   - the accent bar along the foot of every slide but the cover.
 *
 * Every piece is an ordinary element (a teacher can select, restyle or delete it), and the pass is
 * idempotent: a slide that already carries a kind tag or an accent bar is returned untouched.
 */

/** The version of the look (2: the structured components, `structure.ts`). A stored lesson whose `lookVersion` is behind can be restyled. */
export const LOOK_VERSION = 2;

export const KIND_TAG_NAME = "Kind tag";
export const ACCENT_BAR_NAME = "Accent bar";
/** A slide heading the fit engine keeps at its size (`reflow.ts`). */
export { HEADING_NAME };
export const KEY_IDEA_NAME = "Explanation card";
/** The room a teaching slide keeps for a diagram still to be drawn. Drawn in the editor only. */
export const DIAGRAM_NAME = "Diagram placeholder";

/** What the slide is for, in the words a class sees on the tag. Kinds not listed get no tag. */
export const KIND_TAGS: Partial<Record<SlideKind, string>> = {
  objectives: "OBJECTIVES",
  starter: "STARTER",
  vocabulary: "KEY WORDS",
  content: "TEACH",
  "image-text": "TEACH",
  "worked-example": "WORKED EXAMPLE",
  instructions: "PRACTISE",
  discussion: "TALK",
  "true-false": "PRACTISE",
  "multiple-choice": "PRACTISE",
  matching: "PRACTISE",
  "image-match": "PRACTISE",
  "fill-gap": "PRACTISE",
  sort: "PRACTISE",
  "open-response": "THINK",
  "exit-ticket": "CHECK",
  plenary: "REVIEW",
};

/** Height of the accent bar at the foot of the slide (14 at 1440 in the examples). */
export const ACCENT_BAR_H = 9;
const TAG_PAD_X = SPACE[2];
const TAG_PAD_Y = 3;
const TAG_GAP = SPACE[0];
const CARD_PAD = SPACE[3];

/* ---------------------------------------------------------------- colour */

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** `a` mixed into `b` by `amount` (0 = b, 1 = a), as a hex colour. */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) =>
    Math.round(x * amount + y * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`.toUpperCase();
}

/** The theme's accent tint: the panel and pill colour. */
export const accentTint = (t: Theme) =>
  mix(t.colors.accent, t.colors.background, t.dark ? 0.2 : 0.12);

/* ---------------------------------------------------------------- pieces */

type Ids = () => string;

const plain = (el: TextElement): string => docPlainText(el.doc);

function tagHeight(t: Theme): number {
  return Math.ceil(t.sizes.caption * t.lineHeights.caption) + TAG_PAD_Y * 2;
}

function kindTag(ids: Ids, t: Theme, label: string): TextElement {
  // Caption is uppercase and tracked: about 0.78em a letter, plus the pill's inset.
  const w = Math.ceil(label.length * t.sizes.caption * 0.78) + TAG_PAD_X * 2;
  return {
    id: ids(),
    type: "text",
    x: SAFE.x,
    y: SAFE.y,
    w,
    h: tagHeight(t),
    name: KIND_TAG_NAME,
    doc: docFromText(label),
    style: {
      preset: "caption",
      color: t.colors.accent,
      fontWeight: 700,
      background: accentTint(t),
      radius: 99,
      padding: TAG_PAD_Y,
      align: "center",
      autoHeight: false,
    },
  };
}

/** The bar runs from the edge of any picture that bleeds to the foot of the slide, never over it. */
function accentBar(ids: Ids, t: Theme, els: SlideElement[]): SlideElement {
  const bleeds = els.filter((e) => e.type === "image" && e.y + e.h >= SLIDE_H - ACCENT_BAR_H);
  const x = Math.max(0, ...bleeds.filter((e) => e.x <= 0).map((e) => e.x + e.w));
  const right = Math.min(SLIDE_W, ...bleeds.filter((e) => e.x > 0).map((e) => e.x));
  return {
    id: ids(),
    type: "shape",
    shape: "rect",
    x,
    y: SLIDE_H - ACCENT_BAR_H,
    w: Math.max(0, right - x),
    h: ACCENT_BAR_H,
    fill: t.colors.accent,
    name: ACCENT_BAR_NAME,
    locked: true,
  };
}

/* ---------------------------------------------------------------- slides */

function cover(slide: Slide, t: Theme): Slide {
  // A title set beside a photograph keeps its own composition; the cover is the typographic one.
  if (slide.elements.some((e) => e.type === "image")) return slide;
  const ink = t.colors.onAccent;
  const soft = mix(ink, t.colors.accent, 0.8);
  const elements = slide.elements.map((el): SlideElement => {
    if (el.type === "shape") return el.name === "Accent rule" ? { ...el, fill: ink } : el;
    if (el.type !== "text") return el;
    const quiet = el.style.preset === "caption" || el.style.preset === "subtitle";
    return { ...el, style: { ...el.style, color: quiet ? soft : ink } };
  });
  return { ...slide, background: { ...slide.background, color: t.colors.accent }, elements };
}

/**
 * A teaching slide that is a heading and one paragraph: the first sentence becomes the lead, set a
 * step up and in the heading weight, and the rest sits on a tinted card under it. The card is a
 * text box with a fill, so it grows with its words and the fit engine moves and steps it like any
 * other body.
 */
function leadAndCard(els: SlideElement[], t: Theme, ids: Ids): SlideElement[] {
  const bodies = els.filter(
    (e): e is TextElement => e.type === "text" && e.style.preset === "body" && !e.name,
  );
  if (bodies.length !== 1 || els.some((e) => e.type === "image" || e.type === "option")) return els;
  const body = bodies[0] as TextElement;
  const words = plain(body);
  const all = sentences(words);
  if (all.length < 2) return els;
  const lead = all[0] as string;
  const rest = joinSentences(all.slice(1));
  const measure = measureHeadless(t);
  // Beside a diagram slot the text keeps its half; otherwise it takes the full measure.
  const w = els.some((e) => e.name === DIAGRAM_NAME) ? body.w : SAFE.w;
  // The lead a step above the body, in a medium weight: the examples' 34 over 29 at 1440.
  // A stored slide keeps the size its fit gave the body; the card takes that size, the lead a step up.
  const size = body.style.fontSize ?? t.sizes.body;
  const leadStyle = { ...body.style, fontSize: Math.round(size * 1.15), fontWeight: 500 };
  const leadDoc = docFromText(lead);
  const leadH = Math.ceil(
    measure({ doc: leadDoc, width: w, style: leadStyle, preset: "body", inset: 0, chrome: 0 }),
  );
  const cardY = snapY(body.y + leadH + SPACE[3]);
  const cardDoc = docFromText(rest);
  const cardStyle = {
    preset: "body" as const,
    ...(body.style.fontSize ? { fontSize: body.style.fontSize } : {}),
    color: t.colors.ink,
    background: accentTint(t),
    radius: t.radius,
    padding: CARD_PAD,
    autoHeight: true,
  };
  const cardH = Math.ceil(
    measure({
      doc: cardDoc,
      width: w,
      style: cardStyle,
      preset: "body",
      inset: CARD_PAD * 2,
      chrome: CARD_PAD * 2,
    }),
  );
  // Lead and card must both fit above the accent bar; a paragraph too long for that stays one
  // paragraph, for the fit engine to step down or carry to a continuation slide (UX ruling 91).
  if (cardY + cardH > SAFE.y + SAFE.h) return els;
  const leadEl: TextElement = { ...body, doc: leadDoc, w, h: leadH, style: leadStyle };
  const card: TextElement = {
    ...body,
    id: ids(),
    doc: cardDoc,
    y: cardY,
    w,
    h: cardH,
    name: KEY_IDEA_NAME,
    style: cardStyle,
  };
  return els.flatMap((e) => (e === body ? [leadEl, card] : [e]));
}

/**
 * Keep the right half of a teaching slide for a diagram and say what it should show. The body
 * narrows to the left half; the slot is a card in the accent's outline carrying the instruction,
 * named so the renderer draws it in the editor and leaves it out of present, export and print
 * (`SlideView`): a class never sees a box that says "diagram goes here".
 */
export function withDiagramSlot(
  slide: Slide,
  t: Theme,
  instruction: string,
  ids: Ids = uid,
): Slide {
  const body = slide.elements.find(
    (e): e is TextElement => e.type === "text" && e.style.preset === "body" && !e.name,
  );
  if (!body || slide.elements.some((e) => e.name === DIAGRAM_NAME)) return slide;
  const half = Math.floor((SAFE.w - SPACE[5]) / 2);
  const x = SAFE.x + half + SPACE[5];
  const slot: SlideElement = {
    id: ids(),
    type: "shape",
    shape: "rounded",
    x,
    y: body.y,
    w: SAFE.x + SAFE.w - x,
    h: SAFE.y + SAFE.h - body.y,
    fill: t.colors.surface,
    stroke: t.colors.accent,
    strokeWidth: 2,
    radius: t.radius,
    name: DIAGRAM_NAME,
    doc: docFromText(`Diagram to add: ${instruction}`),
    textStyle: {
      preset: "small",
      color: t.colors.muted,
      align: "center",
      valign: "middle",
      padding: SPACE[4],
    },
  };
  return {
    ...slide,
    elements: slide.elements.flatMap((e) => (e === body ? [{ ...body, w: half }, slot] : [e])),
  };
}

/**
 * A short heading is set as a display line, as in the examples ("Limiting factors" at about twice
 * the body): a third above the theme's heading size and tighter leading, when it still takes one
 * line of the full measure. A longer heading keeps the theme's size, on tighter leading.
 */
export const HEADING_DISPLAY = 1.33;
function headingDisplay(heading: TextElement, t: Theme): { fontSize?: number; lineHeight: number } {
  const size = Math.round(t.sizes.heading * HEADING_DISPLAY);
  const words = plain(heading).trim();
  const measure = measureHeadless(t);
  const style = { ...heading.style, fontSize: size, lineHeight: 1.08 };
  const h = measure({
    doc: heading.doc,
    width: SAFE.w,
    style,
    preset: "heading",
    inset: 0,
    chrome: 0,
  });
  const oneLine = h <= size * 1.08 * 1.5;
  return words.split(/\s+/).length <= 7 && oneLine
    ? { fontSize: size, lineHeight: 1.08 }
    : { lineHeight: 1.12 };
}

/* ---------------------------------------------------------------- deck chrome */

export const EYEBROW_NAME = "Eyebrow";
export const COUNTER_NAME = "Slide counter";

/** What the eyebrow says: the year and the subject, as the examples set them ("YEAR 10 · BIOLOGY"). */
export type DeckContext = { yearGroup?: string | null; subject?: string | null };

const captionWidth = (label: string, t: Theme) => Math.ceil(label.length * t.sizes.caption * 0.78);

/**
 * The examples' top line, across a deck: the year and subject in the accent, the kind tag after
 * them on the same line, and a quiet "7 / 12" at the right. Only a slide with a kind tag takes it
 * (its lane is free); the cover and the question slides keep their compositions. Re-run after
 * slides are added, removed or moved: it replaces what it set before, so the counter stays true.
 */
export function withDeckChrome(
  slides: Slide[],
  t: Theme,
  deck: DeckContext,
  ids: Ids = uid,
): Slide[] {
  const eyebrow = [deck.yearGroup, deck.subject].filter(Boolean).join(" · ").toUpperCase();
  const total = slides.length;
  return slides.map((slide, i) => {
    const tag = slide.elements.find((e) => e.name === KIND_TAG_NAME);
    const els = slide.elements.filter((e) => e.name !== EYEBROW_NAME && e.name !== COUNTER_NAME);
    if (!tag) return els.length === slide.elements.length ? slide : { ...slide, elements: els };
    const lane = { y: tag.y, h: tag.h };
    const added: SlideElement[] = [];
    let tagX = SAFE.x;
    if (eyebrow) {
      const w = captionWidth(eyebrow, t);
      added.push({
        id: ids(),
        type: "text",
        x: SAFE.x,
        ...lane,
        w,
        name: EYEBROW_NAME,
        doc: docFromText(eyebrow),
        style: {
          preset: "caption",
          color: t.colors.accent,
          fontWeight: 700,
          padding: TAG_PAD_Y,
          autoHeight: false,
        },
      });
      tagX = SAFE.x + w + SPACE[2];
    }
    const counter = `${i + 1} / ${total}`;
    const cw = captionWidth(counter, t);
    added.push({
      id: ids(),
      type: "text",
      x: SAFE.x + SAFE.w - cw,
      ...lane,
      w: cw,
      name: COUNTER_NAME,
      doc: docFromText(counter),
      style: {
        preset: "caption",
        color: t.colors.muted,
        align: "right",
        padding: TAG_PAD_Y,
        autoHeight: false,
      },
    });
    return {
      ...slide,
      elements: [...els.map((e) => (e === tag ? { ...e, x: tagX } : e)), ...added],
    };
  });
}

/**
 * A stored slide without the look's chrome (kind tag, accent bar, eyebrow, counter), for a newer
 * look to be applied in its place. The named heading stays and marks the slide as headed.
 */
export function stripLook(slide: Slide): Slide {
  const chrome = new Set([KIND_TAG_NAME, ACCENT_BAR_NAME, EYEBROW_NAME, COUNTER_NAME]);
  if (!slide.elements.some((e) => chrome.has(e.name ?? ""))) return slide;
  return { ...slide, elements: slide.elements.filter((e) => !chrome.has(e.name ?? "")) };
}

/** Tint the worked-example card and colour its label, the examples' "worked" panel. */
function workedCard(els: SlideElement[], t: Theme): SlideElement[] {
  return els.map((e) => {
    if (e.type === "shape" && e.name === "Working card") return { ...e, fill: accentTint(t) };
    if (e.type === "text" && e.style.preset === "caption")
      return { ...e, style: { ...e.style, color: t.colors.accent, fontWeight: 700 } };
    return e;
  });
}

/** Apply the look to one slide. Idempotent; kinds without a tag get only what fits them. */
export type LookOptions = {
  /** Split a teaching paragraph into a lead and a card (default). Off when that would not fit. */
  lead?: boolean;
};

export function applyLook(
  slide: Slide,
  t: Theme,
  ids: Ids = uid,
  options: LookOptions = {},
): Slide {
  if (slide.elements.some((e) => e.name === KIND_TAG_NAME || e.name === ACCENT_BAR_NAME)) {
    return slide;
  }
  if (slide.kind === "title") return cover(slide, t);
  const label = KIND_TAGS[slide.kind];
  if (!label) return slide;

  // The hairline under the heading: the topmost full-width rule. A vocabulary grid's rules between
  // entries are half width and stay.
  const headRule = slide.elements
    .filter((e) => e.type === "shape" && e.name === "Rule" && e.w >= SAFE.w - 1)
    .sort((a, b) => a.y - b.y)[0];
  const hadRule = !!headRule;
  let els = slide.elements.filter((e) => e !== headRule);
  const flow = els.filter((e) => !isBackdrop(e));
  if (flow.length === 0) return { ...slide, elements: [...els, accentBar(ids, t, els)] };
  const top = Math.min(...flow.map((e) => e.y));
  const want = snapY(SAFE.y + tagHeight(t) + TAG_GAP);

  // The heading: the first heading-preset text at the top of a slide that is not a question.
  const heading = slide.question
    ? undefined
    : els.find(
        (e): e is TextElement =>
          e.type === "text" && e.style.preset === "heading" && Math.abs(e.y - top) < 2,
      );

  // Only a headed slide takes the tag: its hairline's lane pays for it. A question slide's stem and
  // a statement already open at the top of the safe area, and pushing them down would take room
  // their cards need, so they keep their composition and take the accent bar alone.
  if (!heading || !(hadRule || heading.name === HEADING_NAME)) {
    return { ...slide, elements: [...els, accentBar(ids, t, els)] };
  }
  {
    // The heading drops into the freed lane under the tag. Whatever sat under the rule moves only
    // if the heading's new foot would reach it.
    const style = { ...heading.style };
    delete style.fontSize;
    delete style.lineHeight;
    const display = headingDisplay(heading, t);
    if (display) Object.assign(style, display);
    const next: TextElement = { ...heading, y: want, name: HEADING_NAME, style };
    const foot = next.y + next.h + SPACE[3];
    const below = els.filter(
      (e) => e !== heading && !isBackdrop(e) && e.y >= heading.y + heading.h,
    );
    const firstBelow = Math.min(...below.map((e) => e.y), Number.POSITIVE_INFINITY);
    const push = Number.isFinite(firstBelow) ? Math.max(0, foot - firstBelow) : 0;
    els = els.map((e) => (e === heading ? next : below.includes(e) ? { ...e, y: e.y + push } : e));
  }

  if (slide.kind === "content" && options.lead !== false) els = leadAndCard(els, t, ids);
  if (slide.kind === "worked-example") els = workedCard(els, t);

  return { ...slide, elements: [...els, kindTag(ids, t, label), accentBar(ids, t, els)] };
}
