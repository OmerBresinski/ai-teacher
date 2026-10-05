import type {
  RichDoc,
  Slide,
  SlideElement,
  SlideKind,
  TextElement,
  Theme,
} from "@tj/domain/documents";
import { type DiagramSpecInput, diagramElement } from "./diagrams";
import { docFromText, isChunked, uid } from "./factories";
import { SAFE, SPACE, snapY } from "./grid";
import { AGENDA_STEM, PLACEHOLDER_IMAGE } from "./layouts";
import { HEADING_NAME, isBackdrop } from "./reflow";
import { docPlainText, joinSentences, sentences } from "./sentences";
import { measureHeadless } from "./text-measure";
import { readingLeading, readingSize } from "./text-style";

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
/**
 * Headed kinds that take the look without a kind tag: the heading takes the tag's lane at the top
 * of the safe area and the words move up with it, so no empty band is left.
 */
export const UNTAGGED_HEADED: ReadonlySet<SlideKind> = new Set<SlideKind>([
  "objectives",
  "content",
  "image-text",
]);
/** A slide heading the fit engine keeps at its size (`reflow.ts`). */
export { HEADING_NAME };
export const KEY_IDEA_NAME = "Explanation card";
/** The room a teaching slide keeps for a diagram still to be drawn. Drawn in the editor only. */
export const DIAGRAM_NAME = "Diagram placeholder";
/** The diagram slot a stored slide keeps (before undrawn diagrams stopped shaping the text). */
export const isDiagramMark = (el: { name?: string }): boolean => el.name === DIAGRAM_NAME;
/**
 * The photograph a teaching slide keeps room for (look/image-slot): an image element at the right
 * of the words. Until `illustrate` places a photograph its `src` is `PLACEHOLDER_IMAGE` and its
 * `alt` says what it should show; the editor draws that as a placeholder, and present and export
 * lay the words out across the slide instead (`withoutDiagramSlot`), so a class never sees an
 * empty box.
 */
export const PHOTO_NAME = "Photo slot";
/**
 * The text column's share beside a photograph (the photo takes the rest, about 43% of the safe
 * width): wide enough for "Label: sentence" points of 11 words at the body size
 * (`COMPOSITION_BUDGETS.list.panel`), the photo a picture a class can read from the back (Greg,
 * 27 Sept 2026: "the pic could be a bit larger"; it was 38% at 0.62). A diagram keeps the half.
 */
export const PHOTO_TEXT_SHARE = 0.55;
/** What a slide's photograph should be: `ImageBrief`'s subject and the things it must show. */
export type PhotoBrief = { subject: string; mustShow?: readonly string[] | undefined };
/** The brief as one line, the placeholder's words: "Roman legionaries — shields, armour". */
export const photoLabel = (brief: PhotoBrief): string =>
  brief.mustShow?.length ? `${brief.subject} — ${brief.mustShow.join(", ")}` : brief.subject;
/** A photo slot no photograph has filled yet. */
export const isOpenPhotoSlot = (el: SlideElement): boolean =>
  el.type === "image" && el.name === PHOTO_NAME && el.src === PLACEHOLDER_IMAGE;

/**
 * What the slide is for, in the words a class sees on the tag. Only an activity, or a slide with a
 * specific job, takes one (Greg, 26 Sept 2026: "it should only be there if it's an exercise or
 * something specific"); teaching slides and the objectives go untagged (`UNTAGGED_HEADED`).
 */
export const KIND_TAGS: Partial<Record<SlideKind, string>> = {
  starter: "STARTER",
  vocabulary: "KEY WORDS",
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
const TAG_PAD_Y = 3;
/** Between the kind tag and the heading under it. */
const TAG_GAP = SPACE[2];
/**
 * Between a teaching slide's heading and its first words, on the first page and a continuation
 * alike (Greg, 27 Sept 2026: "the padding below the title should be a bit more").
 */
export const HEADING_GAP = SPACE[4];
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

/** The theme's accent tint: the panel and pill colour. Accent text on it keeps 4.5:1. */
export function accentTint(t: Theme): string {
  for (let amount = t.dark ? 0.2 : 0.12; amount > 0; amount -= 0.01) {
    const tint = mix(t.colors.accent, t.colors.background, amount);
    if (contrastRatio(t.colors.accent, tint) >= 4.5) return tint;
  }
  return t.colors.background;
}

/** The fill of the look's panels: the theme's own `panel`, or the accent tint. */
export const panelFill = (t: Theme) => t.colors.panel ?? accentTint(t);

/* ---------------------------------------------------------------- pieces */

type Ids = () => string;

const plain = (el: TextElement): string => docPlainText(el.doc);

function tagHeight(t: Theme): number {
  return Math.ceil(t.sizes.caption * t.lineHeights.caption) + TAG_PAD_Y * 2;
}

/* ---------------------------------------------------------------- slides */

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The cover (ruling 162, Greg 5 Oct 2026): the title on the theme's own ground under its title
 * art. No "LESSON" eyebrow, no year line and no accent rule over them; `fitSlide` centres what is
 * left. An agenda cover keeps its objectives column.
 */
function cover(slide: Slide, _t: Theme): Slide {
  const dropped = (el: SlideElement) =>
    (el.type === "shape" && el.name === "Accent rule") ||
    (el.type === "text" &&
      el.name !== AGENDA_STEM &&
      (el.style.preset === "caption" || el.style.preset === "subtitle" || el.name === "Subtitle"));
  return { ...slide, elements: slide.elements.filter((el) => !dropped(el)) };
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
  // A body with `points` (materialise `bodyWithPoints`) ends in a bullet list: the lead is taken
  // from the paragraphs before it, and the list goes under the lead with whatever follows it.
  const nodes = body.doc.content ?? [];
  // A body in labelled chunks (`docFromChunks`) is already set out in parts: it keeps them.
  if (isChunked(body.doc)) return els;
  const listAt = nodes.findIndex((n) => n.type === "bulletList");
  const list = listAt < 0 ? [] : nodes.slice(listAt);
  const words =
    listAt < 0
      ? plain(body)
      : plain({ ...body, doc: { type: "doc", content: nodes.slice(0, listAt) } });
  const all = sentences(words);
  if (all.length < 2 && list.length === 0) return els;
  const lead = all[0] ?? "";
  const rest = joinSentences(all.slice(1));
  if (!lead) return els;
  const measure = measureHeadless(t);
  // Beside a diagram slot the text keeps its half; otherwise it takes the full measure.
  const w = els.some((e) => e.name === DIAGRAM_NAME) ? body.w : SAFE.w;
  // The lead in a heavier weight at the reading size, the card under it at the same size, as the
  // examples set them (`readingSize`). A stored slide the fit stepped down keeps its smaller size.
  const size = Math.min(body.style.fontSize ?? readingSize(t), readingSize(t));
  const leading = readingLeading(t);
  const leadStyle = { ...body.style, fontSize: size, fontWeight: 600, lineHeight: leading };
  const leadDoc = docFromText(lead);
  const leadH = Math.ceil(
    measure({ doc: leadDoc, width: w, style: leadStyle, preset: "body", inset: 0, chrome: 0 }),
  );
  const cardY = snapY(body.y + leadH + SPACE[3]);
  const cardDoc: RichDoc =
    list.length === 0
      ? docFromText(rest)
      : { type: "doc", content: [...(rest ? (docFromText(rest).content ?? []) : []), ...list] };
  const cardStyle = {
    preset: "body" as const,
    fontSize: size,
    lineHeight: leading,
    color: t.colors.ink,
    background: panelFill(t),
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
  /** What the diagram should show, or a diagram spec (`./diagrams`) to draw in the slot. */
  instruction: string | DiagramSpecInput,
  ids: Ids = uid,
  /** The slot's words; the demo placeholder (`withSlotsShown`) says "Diagram: …". */
  label = typeof instruction === "string" ? `Diagram to add: ${instruction}` : "",
): Slide {
  const body = slide.elements.find(
    (e): e is TextElement => e.type === "text" && e.style.preset === "body" && !e.name,
  );
  if (!body || slide.elements.some((e) => e.name === DIAGRAM_NAME)) return slide;
  const half = Math.floor((SAFE.w - SPACE[5]) / 2);
  const x = SAFE.x + half + SPACE[5];
  // A spec draws in the slot; one that does not draw leaves the slide as it was, never a box.
  if (typeof instruction !== "string") {
    const rect = { x, y: body.y, w: SAFE.x + SAFE.w - x, h: SAFE.y + SAFE.h - body.y };
    const drawn = diagramElement(instruction, t, rect, ids);
    if (!drawn) return slide;
    return {
      ...slide,
      elements: slide.elements.flatMap((e) => (e === body ? [{ ...body, w: half }, drawn] : [e])),
    };
  }
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
    doc: docFromText(label),
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
 * Keep the right of a teaching slide for a photograph (look/image-slot): the body narrows to
 * `PHOTO_TEXT_SHARE` of the measure and an image slot, rounded and cover-cropped, takes the rest, from the body's top
 * to the foot of the safe area. The structure pass (`structure.ts` `structureDiagram`) fits the
 * words beside it at the body size, continuing them on the next slide rather than shrinking the
 * slot. The slot holds `PLACEHOLDER_IMAGE` until `illustrate` finds the photograph.
 */
export function withPhotoSlot(slide: Slide, t: Theme, brief: PhotoBrief, ids: Ids = uid): Slide {
  const body = slide.elements.find(
    (e): e is TextElement => e.type === "text" && e.style.preset === "body" && !e.name,
  );
  if (!body || slide.elements.some((e) => e.name === PHOTO_NAME)) return slide;
  const half = Math.floor((SAFE.w - SPACE[5]) * PHOTO_TEXT_SHARE);
  const x = SAFE.x + half + SPACE[5];
  const slot: SlideElement = {
    id: ids(),
    type: "image",
    x,
    y: body.y,
    w: SAFE.x + SAFE.w - x,
    h: SAFE.y + SAFE.h - body.y,
    src: PLACEHOLDER_IMAGE,
    alt: photoLabel(brief),
    fit: "cover",
    radius: t.radius,
    name: PHOTO_NAME,
  };
  return {
    ...slide,
    elements: slide.elements.flatMap((e) => (e === body ? [{ ...body, w: half }, slot] : [e])),
  };
}

/**
 * A heading is set as a display line: a step above the theme's heading size, on tighter leading
 * (chalk 41 on a 540 slide, 7.6% of its height; Chalkie's headings measure 6.7–7.9%). A third
 * above (48) wrapped a typical heading at 1440 (Greg, 27 Sept 2026: "title seems too large").
 * One size across the deck: a heading too long for one line wraps to two at the same size
 * rather than shrinking, balanced by the renderer.
 */
export const HEADING_DISPLAY = 1.15;
function headingDisplay(
  _heading: TextElement,
  t: Theme,
): { fontSize?: number; lineHeight: number } {
  return { fontSize: Math.round(t.sizes.heading * HEADING_DISPLAY), lineHeight: 1.08 };
}

/**
 * A stored slide without the look's chrome (kind tag, accent bar), for a newer look to be applied
 * in its place. The named heading stays and marks the slide as headed.
 */
export function stripLook(slide: Slide): Slide {
  const chrome = new Set([KIND_TAG_NAME, ACCENT_BAR_NAME]);
  if (!slide.elements.some((e) => chrome.has(e.name ?? ""))) return slide;
  return { ...slide, elements: slide.elements.filter((e) => !chrome.has(e.name ?? "")) };
}

/**
 * The leading of an activity's numbered list: each question or task on its own line with air
 * around it, so a class reads them as separate items from the back (Greg, 27 Sept 2026: the
 * numbered items sat "line on line"). The theme's body leading is 1.45–1.55.
 */
export const ACTIVITY_LIST_LEADING = 1.75;

/** A numbered list on an activity slide, set on `ACTIVITY_LIST_LEADING`. */
function roomyList(e: SlideElement, t: Theme): SlideElement {
  if (e.type !== "text" || e.style.preset !== "body") return e;
  if (!e.doc.content?.some((n) => n.type === "orderedList")) return e;
  const leading = Math.max(e.style.lineHeight ?? t.lineHeights.body, ACTIVITY_LIST_LEADING);
  return { ...e, style: { ...e.style, lineHeight: leading } };
}

/** Tint the worked-example card and colour its label, the examples' "worked" panel. */
function workedCard(els: SlideElement[], t: Theme): SlideElement[] {
  return els.map((e) => {
    if (e.type === "shape" && e.name === "Working card") return { ...e, fill: panelFill(t) };
    if (e.type === "text" && e.style.preset === "caption")
      return { ...e, style: { ...e.style, color: t.colors.accent, fontWeight: 700 } };
    return e;
  });
}

/** Apply the look to one slide. Idempotent; kinds without a tag get only what fits them. */
export type LookOptions = {
  /** Split a teaching paragraph into a lead and a card (default). Off when that would not fit. */
  lead?: boolean;
  /** A kind tag in place of the kind's own (`SlideStructure.tag`). */
  tag?: string;
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
  const label = options.tag ?? KIND_TAGS[slide.kind];
  if (!label && !UNTAGGED_HEADED.has(slide.kind)) return slide;

  // The hairline under the heading: the topmost full-width rule. A vocabulary grid's rules between
  // entries are half width and stay.
  const headRule = slide.elements
    .filter((e) => e.type === "shape" && e.name === "Rule" && e.w >= SAFE.w - 1)
    .sort((a, b) => a.y - b.y)[0];
  const hadRule = !!headRule;
  let els = slide.elements.filter((e) => e !== headRule);
  const flow = els.filter((e) => !isBackdrop(e));
  if (flow.length === 0) return { ...slide, elements: els };
  const top = Math.min(...flow.map((e) => e.y));
  // An activity is composed as it was under its tag, then the whole block moves up the tag's lane:
  // no kind tag (Greg, 5 Oct 2026: "simple is best"), so every heading opens the safe area.
  const want = label ? snapY(SAFE.y + tagHeight(t) + TAG_GAP) : SAFE.y;
  const lift = want - SAFE.y;

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
    return { ...slide, elements: els };
  }
  // Already looked: the heading opens the safe area with no hairline, which only this pass leaves.
  if (!hadRule && heading.name === HEADING_NAME && heading.y === SAFE.y) return slide;
  {
    // The heading drops into the freed lane under the tag. Whatever sat under the rule moves only
    // if the heading's new foot would reach it.
    const style = { ...heading.style };
    delete style.fontSize;
    delete style.lineHeight;
    // Every headed slide shares one display size (Greg, 27 Sept 2026: heading sizes differed
    // across the deck). An activity takes it, set solid, only where it stays one line and clear of
    // what the recipe put under it, so its cards keep their room (a two-line display heading
    // pushed a worked example's card off); otherwise it keeps the theme's size.
    const measureHeading = (s: TextElement["style"]) =>
      measureHeadless(t)({
        doc: heading.doc,
        width: heading.w,
        style: s,
        preset: "heading",
        inset: 0,
        chrome: 0,
      });
    const below = els.filter(
      (e) => e !== heading && !isBackdrop(e) && e.y >= heading.y + heading.h,
    );
    const firstBelow = Math.min(...below.map((e) => e.y), Number.POSITIVE_INFINITY);
    const shown = headingDisplay(heading, t);
    const solid = { ...shown, lineHeight: 1 };
    const solidH = label ? measureHeading({ ...style, ...solid }) : 0;
    const display = !label
      ? shown
      : solidH <= (solid.fontSize ?? t.sizes.heading) * 1.5 &&
          want + solidH + SPACE[2] <= firstBelow
        ? solid
        : { lineHeight: 1.12 };
    Object.assign(style, display);
    // The heading's height at its new size, measured: the words are placed from its last line.
    const h = Math.ceil(measureHeading(style));
    const next: TextElement = { ...heading, y: want, h, name: HEADING_NAME, style };
    let shift = 0;
    if (label) {
      // An activity: whatever sat under the rule moves only if the heading's new foot reaches it,
      // so its cards keep the room the recipe gave them.
      const foot = next.y + h + SPACE[2];
      shift = Number.isFinite(firstBelow) ? Math.max(0, foot - firstBelow) : 0;
    } else if (Number.isFinite(firstBelow)) {
      // A teaching slide: the words start one gap under the heading's last line, however many
      // lines it takes, so no empty band is left under a one-line heading (Greg, 27 Sept 2026:
      // "the content seems too far to bottom").
      shift = snapY(next.y + h + HEADING_GAP) - firstBelow;
    }
    els = els.map((e) => (e === heading ? next : below.includes(e) ? { ...e, y: e.y + shift } : e));
  }

  if (slide.kind === "content" && options.lead !== false) els = leadAndCard(els, t, ids);
  if (slide.kind === "worked-example") els = workedCard(els, t);
  // A worked example's working keeps its card's leading: the card is sized for it. An exit ticket
  // keeps the theme's body leading so its three questions and their answers fit one slide (UX
  // ruling 108, TEACH-172).
  if (label && slide.kind !== "worked-example" && slide.kind !== "exit-ticket")
    els = els.map((e) => roomyList(e, t));

  // No kind tag and no foot bar (Greg, 5 Oct 2026): a slide is its heading and its content. An
  // activity's block takes the lane the tag held; anything already above it (a backdrop) stays.
  if (lift > 0) els = els.map((e) => (isBackdrop(e) || e.y < want ? e : { ...e, y: e.y - lift }));
  return { ...slide, elements: els };
}
