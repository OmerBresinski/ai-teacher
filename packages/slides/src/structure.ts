import type {
  LineElement,
  RichDoc,
  RichNode,
  ShapeElement,
  Slide,
  SlideElement,
  TextElement,
  TextPreset,
  TextStyle,
  Theme,
} from "@tj/domain/documents";
import { docFromBullets, docFromText, uid } from "./factories";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE, snapY } from "./grid";
import {
  ACCENT_BAR_NAME,
  accentTint,
  COUNTER_NAME,
  KIND_TAG_NAME,
  PHOTO_NAME,
  PHOTO_TEXT_SHARE,
  type PhotoBrief,
} from "./look";
import { SAFE_BOTTOM, withSafety } from "./metrics";
import { ANSWERS_NAME, HEADING_NAME, isBackdrop } from "./reflow";
import { joinSentences, sentences } from "./sentences";
import { measureHeadless } from "./text-measure";
import { floorBelow, readingLeading, readingSize, resolveFontSize } from "./text-style";

/*
 * Structured components (quality PRD "look", 26 Sept 2026): the shapes the homepage example lessons
 * give their content, drawn in code from data generation already produces. Each is a set of
 * ordinary elements (a card is a shape, its words a text box on it), so every piece stays
 * selectable and editable, and each is measured with the fit engine's own ruler before it is
 * placed: a component that does not fit at the body size or one step below it (UX ruling 91) is
 * not drawn, and the slide keeps the plain text it had.
 *
 *   - options grid: a quiz line's multiple-choice options as lettered cards, true/false as two
 *     chips; the right answer is marked on the reveal (step 1), in place;
 *   - answers panel: the open answers of a set, a card anchored to the foot on the reveal, out of
 *     the flow so it never pushes or shrinks the questions it answers;
 *   - compare cards: two labelled columns for a slide that sets two things side by side;
 *   - steps strip: numbered cards joined by arrows, revealed one step at a time;
 *   - key card: a label over one large statement (a definition, a formula, a word equation);
 *   - key terms: the lesson's vocabulary picked out in running text (bold in the accent, drawn as
 *     a tinted chip by the renderer).
 */

type Ids = () => string;

export const OPTION_CHIP_NAME = "Option";
export const ANSWER_MARK_NAME = "Answer";
export { ANSWERS_NAME };
export const QUESTION_NAME = "Question";
export const COMPARE_NAME = "Compare card";
export const STEP_NAME = "Step card";
export const STEP_ARROW_NAME = "Step arrow";
export const KEY_CARD_NAME = "Key card";
/** A body the structure pass wrote; the look's lead-and-card split leaves a named body alone. */
export const BODY_NAME = "Body";

/* ---------------------------------------------------------------- data */

/** One question of a set. `options` with `correct` makes it multiple choice (or true/false). */
export type QuizLine = {
  stem: string;
  options?: string[];
  /** Index into `options` of the right one. */
  correct?: number;
  /** The answer in words, for the answers panel. */
  answer?: string;
};

export type CompareSide = { label: string; note?: string; points: string[] };

/**
 * What a slide's content is, beyond its words: the optional hints `materialiseSlide` takes. Each
 * is inferred from the words when absent (`inferStructure`), so a stored lesson restyles too.
 */
export type SlideStructure = {
  /**
   * The side a photo or diagram slot takes (look/slides-layout), left when absent. Generation
   * alternates it over a deck's slot slides (`alternateSlotSides` is the same rule for a whole deck).
   */
  slotSide?: SlotSide;
  quiz?: QuizLine[];
  compare?: { left: CompareSide; right: CompareSide };
  keyCard?: { label: string; text: string };
  /** A process or method in order: 2–4 short steps. */
  sequence?: string[];
  /**
   * A content spec's own `points` (shape `list`): the body stays the lead and the points go under
   * it as dots; the key idea never takes the lead to the side panel. Only a key term may fill it.
   */
  points?: string[];
  /** The lesson's vocabulary, picked out in running text. */
  terms?: string[];
  /** The deck is known: the top line carries the slide counter (`withDeckChrome`). */
  deck?: { yearGroup?: string | null; subject?: string | null };
  /**
   * The photograph the plan asked for (a key idea's `photo`, carried on its outline entry as the
   * image brief): an explain or a list keeps the right half for it (`withPhotoSlot`).
   */
  photo?: PhotoBrief;
  /** The vocabulary's definitions: a term a teaching slide uses can fill its side panel. */
  glossary?: { term: string; definition: string }[];
};

/* ---------------------------------------------------------------- text helpers */

const inline = (n: RichNode): string =>
  n.type === "text" ? (n.text ?? "") : (n.content ?? []).map(inline).join("");

/** A doc without its bullet lists: the prose a content body's `points` follow. */
export const proseOf = (doc: RichDoc): RichDoc => ({
  ...doc,
  content: (doc.content ?? []).filter((n) => n.type !== "bulletList"),
});

/** The items of a doc's top-level bullet lists: a content spec's `points`. */
export function pointsOf(doc: RichDoc): string[] {
  return (doc.content ?? [])
    .filter((n) => n.type === "bulletList")
    .flatMap((n) => (n.content ?? []).map((item) => inline(item).trim()))
    .filter(Boolean);
}

/** The lines of a doc: its list items, or its paragraphs. */
export function docLines(doc: RichDoc): string[] {
  const out: string[] = [];
  const walk = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === "bulletList" || n.type === "orderedList") {
        for (const item of n.content ?? []) out.push(inline(item).trim());
      } else if (n.type === "paragraph") {
        const t = inline(n).trim();
        if (t) out.push(t);
      } else walk(n.content);
    }
  };
  walk(doc.content);
  return out.filter(Boolean);
}

const docText = (doc: RichDoc) => docLines(doc).join(" ");

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** One numbered question: a one-item ordered list starting at `n`, so it takes the accent disc. */
function numberedDoc(n: number, text: string): RichDoc {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: n },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
        ],
      },
    ],
  };
}

const bulletDoc = (items: string[]): RichDoc =>
  items.length === 1
    ? docFromText(items[0] as string)
    : {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: items.map((t) => ({
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
            })),
          },
        ],
      };

/* ---------------------------------------------------------------- quiz lines */

const MC_LINE = /^(.*?\S)\s+A (.+?)\s{2,}B (.+?)\s{2,}C (.+?)\s{2,}D (.+)$/;
const TF_LINE = /^True or false\?\s*(.+)$/i;

/**
 * A set line as the code-built sets print it (`coded-slides.ts`): "stem A x  B y  C z  D w" is
 * multiple choice, "True or false? belief." is true/false, anything else an open question.
 * `answer` is that line's answer as the set prints it ("A (Abrasion)", "False. …").
 */
export function parseQuizLine(text: string, answer?: string): QuizLine {
  const line: QuizLine = { stem: text.trim() };
  if (answer) line.answer = answer.trim();
  const mc = text.match(MC_LINE);
  if (mc) {
    const options = mc.slice(2, 6).map((o) => (o as string).trim());
    const at = answer?.trim().match(/^([A-D])\b/)?.[1];
    return {
      ...line,
      stem: (mc[1] as string).trim(),
      options,
      ...(at ? { correct: LETTERS.indexOf(at) } : {}),
    };
  }
  const tf = text.match(TF_LINE);
  if (tf) {
    const verdict = answer
      ?.trim()
      .match(/^(True|False)\b/i)?.[1]
      ?.toLowerCase();
    return {
      ...line,
      stem: (tf[1] as string).trim(),
      options: ["True", "False"],
      ...(verdict ? { correct: verdict === "true" ? 0 : 1 } : {}),
    };
  }
  return line;
}

/** "Answers: 1 x  ·  2 y" (the set's reveal) back into its answers, in order. */
export function parseAnswers(text: string): string[] {
  return text
    .replace(/^\s*Answers:\s*/i, "")
    .split(/\s+·\s+/)
    .map((a) => a.replace(/^\d+[.)]?\s+/, "").trim())
    .filter(Boolean);
}

/* ---------------------------------------------------------------- measuring */

type Measure = ReturnType<typeof measureHeadless>;

function heightOf(
  measure: Measure,
  doc: RichDoc,
  width: number,
  preset: TextPreset,
  fontSize: number,
  pad = 0,
  style: Partial<TextStyle> = {},
): number {
  return Math.ceil(
    measure({
      doc,
      width,
      style: { preset, ...style, fontSize },
      preset,
      fontSize,
      inset: pad * 2,
      chrome: pad * 2,
    }),
  );
}

/** Running text on a teaching slide: the reading size, then the one step below it (UX ruling 91). */
const readingSizes = (t: Theme) => {
  const top = readingSize(t);
  const next = floorBelow(t, "body");
  return next < top ? [top, next] : [top];
};

/** The body size and the one step below it the fit may take (UX ruling 91). */
const sizesFor = (t: Theme, preset: TextPreset) => {
  const top = resolveFontSize(t, preset);
  const next = floorBelow(t, preset);
  return next < top ? [top, next] : [top];
};

const LIST_INDENT_EM = 1.2;
const CHIP_PAD = SPACE[1];
const CARD_PAD = SPACE[2];

function text(
  ids: Ids,
  rect: { x: number; y: number; w: number; h: number },
  doc: RichDoc,
  style: TextStyle,
  extra: Partial<TextElement> = {},
): TextElement {
  return { id: ids(), type: "text", ...rect, doc, style: { autoHeight: true, ...style }, ...extra };
}

function card(
  ids: Ids,
  t: Theme,
  rect: { x: number; y: number; w: number; h: number },
  name: string,
  extra: Partial<ShapeElement> = {},
): ShapeElement {
  return {
    id: ids(),
    type: "shape",
    shape: "rounded",
    ...rect,
    fill: t.colors.surface,
    stroke: t.colors.line,
    strokeWidth: 1.5,
    radius: Math.min(t.radius, 12),
    name,
    ...extra,
  };
}

/* ---------------------------------------------------------------- options grid */

const letterDoc = (letter: string, option: string, t: Theme): RichDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: letter,
          marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: t.colors.accent } }],
        },
        { type: "text", text: `  ${option}` },
      ],
    },
  ],
});

type Placed = { elements: SlideElement[]; bottom: number };

/**
 * One quiz line from `y`: the numbered stem, then its options. Multiple choice lays its options in
 * four, two or one column, whichever keeps each card to one line (two in the single column).
 * True/false puts its two chips at the stem's right. The right option carries an accent copy of
 * itself on reveal step 1, in place.
 */
function placeLine(
  line: QuizLine,
  n: number,
  y: number,
  t: Theme,
  size: number,
  measure: Measure,
  ids: Ids,
): Placed {
  const els: SlideElement[] = [];
  const chipSize = Math.min(size, resolveFontSize(t, "small"));
  const chipLine = chipSize * t.lineHeights.small;
  const tf = line.options?.length === 2 && /^true$/i.test(line.options[0] ?? "");
  const chipW = (label: string) => Math.ceil(label.length * chipSize * 0.62) + CHIP_PAD * 2 + 8;
  const tfW = tf ? chipW("False") : 0;
  const stemW = tf ? SAFE.w - tfW * 2 - SPACE[1] - SPACE[3] : SAFE.w;
  const stemDoc = numberedDoc(n, line.stem);
  const stemH = heightOf(measure, stemDoc, stemW, "body", size);
  els.push(
    text(
      ids,
      { x: SAFE.x, y, w: stemW, h: stemH },
      stemDoc,
      { preset: "body", fontSize: size },
      {
        name: QUESTION_NAME,
      },
    ),
  );
  const mark = (chip: ShapeElement, label: RichDoc | string): ShapeElement => ({
    ...chip,
    id: ids(),
    name: ANSWER_MARK_NAME,
    fill: t.colors.accent,
    stroke: t.colors.accent,
    doc: typeof label === "string" ? docFromText(label) : recolour(label, t.colors.onAccent),
    textStyle: { ...chip.textStyle, color: t.colors.onAccent, fontWeight: 600 },
    revealStep: 1,
    reveal: "fade",
  });
  if (tf) {
    const opts = line.options as string[];
    const chipH = Math.ceil(chipLine + CHIP_PAD);
    opts.forEach((label, i) => {
      const x = SAFE.x + SAFE.w - tfW * (2 - i) - (i === 0 ? SPACE[1] : 0);
      const chip = card(ids, t, { x, y, w: tfW, h: chipH }, OPTION_CHIP_NAME, {
        shape: "pill",
        stroke: t.colors.accent,
        doc: docFromText(label),
        textStyle: {
          preset: "small",
          fontSize: chipSize,
          align: "center",
          valign: "middle",
          color: t.colors.accent,
          fontWeight: 600,
        },
      });
      els.push(chip);
      if (line.correct === i) els.push(mark(chip, label));
    });
    return { elements: els, bottom: y + Math.max(stemH, chipH) };
  }
  if (!line.options?.length) return { elements: els, bottom: y + stemH };

  const indent = Math.round(LIST_INDENT_EM * size);
  const room = SAFE.w - indent;
  const docs = line.options.map((o, i) => letterDoc(LETTERS[i] as string, o, t));
  let cols = 4;
  let heights: number[] = [];
  for (const c of [4, 2, 1]) {
    cols = c;
    const w = (room - SPACE[2] * (c - 1)) / c;
    heights = docs.map((d) => heightOf(measure, d, w, "small", chipSize, CHIP_PAD));
    const lines = Math.max(...heights.map((h) => Math.round((h - CHIP_PAD * 2) / chipLine)));
    if (lines <= (c === 1 ? 2 : 1)) break;
  }
  const w = Math.floor((room - SPACE[2] * (cols - 1)) / cols);
  let top = y + stemH + SPACE[1];
  for (let r = 0; r * cols < docs.length; r++) {
    const row = docs.slice(r * cols, r * cols + cols);
    const h = Math.max(...heights.slice(r * cols, r * cols + cols));
    row.forEach((doc, j) => {
      const i = r * cols + j;
      const chip = card(
        ids,
        t,
        { x: SAFE.x + indent + j * (w + SPACE[2]), y: top, w, h },
        OPTION_CHIP_NAME,
        {
          doc,
          textStyle: {
            preset: "small",
            fontSize: chipSize,
            align: "left",
            valign: "middle",
            padding: CHIP_PAD,
            color: t.colors.ink,
          },
        },
      );
      els.push(chip);
      if (line.correct === i) els.push(mark(chip, doc));
    });
    top += h + SPACE[1];
  }
  return { elements: els, bottom: top - SPACE[1] };
}

/** Every text run in `doc` set in `color` (the answer mark's letter on the accent). */
function recolour(doc: RichDoc, color: string): RichDoc {
  const walk = (n: RichNode): RichNode =>
    n.type === "text"
      ? {
          ...n,
          marks: (n.marks ?? [])
            .filter((m) => m.type !== "textStyle")
            .concat([{ type: "textStyle", attrs: { color } }]),
        }
      : { ...n, ...(n.content ? { content: n.content.map(walk) } : {}) };
  return walk(doc as RichNode) as RichDoc;
}

/**
 * The answers card: a reveal (step 1) anchored to the foot of the safe area, sized to its words.
 * It is a shape carrying text, which the fit engine treats as a layer: it never takes room in the
 * flow, so a long set of answers can no longer push itself off the slide or step the questions'
 * type down while it is hidden (both seen on the coasts exit ticket, 26 Sept).
 */
export function answersPanel(
  answers: { n: number; text: string }[],
  t: Theme,
  ids: Ids = uid,
): ShapeElement | undefined {
  if (answers.length === 0) return undefined;
  const measure = measureHeadless(t);
  const doc: RichDoc = {
    type: "doc",
    content: answers.map((a) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: `${a.n} `,
          marks: [{ type: "bold" }, { type: "textStyle", attrs: { color: t.colors.accent } }],
        },
        { type: "text", text: a.text },
      ],
    })),
  };
  const pad = SPACE[2];
  let size = resolveFontSize(t, "small");
  let h = heightOf(measure, doc, SAFE.w, "small", size, pad);
  const most = Math.round(SAFE.h * 0.62);
  if (h > most) {
    size = floorBelow(t, "small");
    h = Math.min(most, heightOf(measure, doc, SAFE.w, "small", size, pad));
  }
  return card(ids, t, { x: SAFE.x, y: SAFE_BOTTOM - h, w: SAFE.w, h }, ANSWERS_NAME, {
    stroke: t.colors.accent,
    strokeWidth: 2,
    doc,
    textStyle: {
      preset: "small",
      fontSize: size,
      align: "left",
      valign: "top",
      padding: pad,
      color: t.colors.ink,
    },
    revealStep: 1,
    reveal: "fade",
  });
}

/** Whether a block ending at `bottom` clears the foot with the fit engine's cushion. */
const fits = (bottom: number) => bottom + SPACE[1] <= SAFE_BOTTOM;

/**
 * Lay a set's lines from `top` into pages: at the body size, or one step below it when that keeps
 * the set on one slide; otherwise at the body size across as many pages as it takes (UX ruling
 * 91). Each page lists the answers of its own open and true/false lines.
 */
export function layoutQuiz(
  lines: QuizLine[],
  top: number,
  t: Theme,
  ids: Ids = uid,
  firstNumber = 1,
): SlideElement[][] {
  const measure = measureHeadless(t);
  const sizes = sizesFor(t, "body");
  const paginate = (size: number): SlideElement[][] => {
    const pages: SlideElement[][] = [];
    let page: SlideElement[] = [];
    let answers: { n: number; text: string }[] = [];
    let y = top;
    const close = () => {
      const panel = answersPanel(answers, t, ids);
      pages.push(panel ? [...page, panel] : page);
      page = [];
      answers = [];
      y = top;
    };
    lines.forEach((line, i) => {
      const n = firstNumber + i;
      let placed = placeLine(line, n, y, t, size, measure, ids);
      if (!fits(placed.bottom) && page.length > 0) {
        close();
        placed = placeLine(line, n, y, t, size, measure, ids);
      }
      page.push(...placed.elements);
      const shownInPlace = line.options && line.correct !== undefined && line.options.length > 2;
      if (line.answer && !shownInPlace) answers.push({ n, text: line.answer });
      y = snapY(placed.bottom + SPACE[3]);
    });
    if (page.length) close();
    return pages;
  };
  for (const size of sizes) {
    const pages = paginate(size);
    if (pages.length === 1) return pages;
  }
  return paginate(sizes[0] as number);
}

/* ---------------------------------------------------------------- compare */

/**
 * Two labelled cards side by side, equal in height, from `top`. `undefined` when either side's
 * points do not fit above the foot at the body size or one step below it.
 */
export function compareCards(
  left: CompareSide,
  right: CompareSide,
  top: number,
  bottom: number,
  t: Theme,
  ids: Ids = uid,
): Placed | undefined {
  const measure = measureHeadless(t);
  const gap = SPACE[4];
  const w = Math.floor((SAFE.w - gap) / 2);
  const inner = w - CARD_PAD * 2;
  const capSize = resolveFontSize(t, "caption");
  const capH = heightOf(measure, docFromText("X"), inner, "caption", capSize);
  const leading = readingLeading(t);
  for (const size of readingSizes(t)) {
    const noteSize = resolveFontSize(t, "small");
    const parts = [left, right].map((side) => {
      const note = side.note
        ? heightOf(measure, docFromText(side.note), inner, "small", noteSize)
        : 0;
      const body = heightOf(measure, bulletDoc(side.points), inner, "body", size, 0, {
        lineHeight: leading,
      });
      return { note, body };
    });
    const noteH = Math.max(...parts.map((p) => p.note));
    const bodyH = Math.max(...parts.map((p) => p.body));
    const h = CARD_PAD + capH + SPACE[0] + (noteH ? noteH + SPACE[0] : 0) + bodyH + CARD_PAD;
    if (top + withSafety(h) > bottom) continue;
    const els: SlideElement[] = [];
    [left, right].forEach((side, i) => {
      const x = SAFE.x + i * (w + gap);
      els.push(
        card(ids, t, { x, y: top, w, h }, COMPARE_NAME, i === 0 ? { stroke: t.colors.accent } : {}),
      );
      let y = top + CARD_PAD;
      els.push(
        text(ids, { x: x + CARD_PAD, y, w: inner, h: capH }, docFromText(side.label), {
          preset: "caption",
          color: t.colors.accent,
          fontWeight: 700,
        }),
      );
      y += capH + SPACE[0];
      if (side.note) {
        els.push(
          text(
            ids,
            { x: x + CARD_PAD, y, w: inner, h: parts[i]?.note ?? 0 },
            docFromText(side.note),
            {
              preset: "small",
              color: t.colors.muted,
            },
          ),
        );
      }
      if (noteH) y += noteH + SPACE[0];
      els.push(
        text(
          ids,
          { x: x + CARD_PAD, y, w: inner, h: parts[i]?.body ?? 0 },
          bulletDoc(side.points),
          { preset: "body", fontSize: size, lineHeight: leading },
          { name: BODY_NAME },
        ),
      );
    });
    return { elements: els, bottom: top + h };
  }
  return undefined;
}

/* ---------------------------------------------------------------- steps strip */

/** Whether every word of `text` fits on one line of `width`, so none breaks mid-word. */
function wordsFit(
  measure: Measure,
  text: string,
  width: number,
  preset: TextPreset,
  size: number,
  t: Theme,
): boolean {
  const line = size * t.lineHeights[preset];
  return text
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => heightOf(measure, docFromText(word), width, preset, size) <= line * 1.5);
}

/**
 * A method in order: numbered cards left to right, an arrow between each pair. With `reveal`, step
 * i appears on reveal step i (the worked example's working, one move at a time). `undefined` when
 * the cards do not fit above `bottom` at the small size or one step below it.
 */
export function stepsStrip(
  steps: string[],
  top: number,
  bottom: number,
  t: Theme,
  ids: Ids = uid,
  options: { reveal?: boolean; start?: number } = {},
): Placed | undefined {
  const n = steps.length;
  const start = options.start ?? 1;
  if (n < 2 || n > 4) return undefined;
  const measure = measureHeadless(t);
  const disc = 26;
  // The usual gaps first; a long word ("Precipitation") may take a tighter arrow and inset before
  // the size steps down. A word wider than its card would break mid-word ("Condensatio / n"), so
  // a strip no setting fits is not drawn.
  const sizes = sizesFor(t, "small");
  const usual = Math.floor((SAFE.w - SPACE[5] * (n - 1)) / n) - CARD_PAD * 2;
  const floor = sizes[sizes.length - 1] as number;
  const tight = !steps.every((s) => wordsFit(measure, s, usual, "small", floor, t));
  const settings = [[SPACE[5], CARD_PAD], ...(tight ? [[SPACE[3], SPACE[1]]] : [])].flatMap(
    ([arrow, pad]) => sizes.map((size) => ({ arrow, pad, size })),
  );
  for (const { arrow, pad, size } of settings as { arrow: number; pad: number; size: number }[]) {
    const w = Math.floor((SAFE.w - arrow * (n - 1)) / n);
    const inner = w - pad * 2;
    if (!steps.every((s) => wordsFit(measure, s, inner, "small", size, t))) continue;
    const hs = steps.map((s) => heightOf(measure, docFromText(s), inner, "small", size));
    const h = pad + disc + SPACE[1] + Math.max(...hs) + pad;
    if (top + withSafety(h) > bottom) continue;
    const els: SlideElement[] = [];
    steps.forEach((step, i) => {
      const x = SAFE.x + i * (w + arrow);
      const reveal = options.reveal ? { revealStep: i + 1, reveal: "fade" as const } : {};
      if (i > 0) {
        const line: LineElement = {
          id: ids(),
          type: "line",
          x: x - arrow + 6,
          y: top + Math.round(h / 2) - 8,
          w: arrow - 12,
          h: 16,
          from: { x: 0, y: 0.5 },
          to: { x: 1, y: 0.5 },
          stroke: t.colors.accent,
          strokeWidth: 2.5,
          arrowEnd: true,
          name: STEP_ARROW_NAME,
          ...reveal,
        };
        els.push(line);
      }
      els.push(card(ids, t, { x, y: top, w, h }, STEP_NAME, reveal));
      els.push({
        ...card(
          ids,
          t,
          { x: x + pad, y: top + pad, w: disc, h: disc },
          `Step ${start + i} number`,
          {
            shape: "ellipse",
            fill: t.colors.accent,
            stroke: t.colors.accent,
            doc: docFromText(String(start + i)),
            textStyle: {
              preset: "caption",
              color: t.colors.onAccent,
              align: "center",
              valign: "middle",
              fontWeight: 700,
            },
          },
        ),
        ...reveal,
      });
      els.push(
        text(
          ids,
          { x: x + pad, y: top + pad + disc + SPACE[1], w: inner, h: hs[i] ?? 0 },
          docFromText(step),
          { preset: "small", fontSize: size, color: t.colors.ink },
          { name: `Step ${start + i}`, ...reveal },
        ),
      );
    });
    return { elements: els, bottom: top + h };
  }
  return undefined;
}

/* ---------------------------------------------------------------- key card */

/**
 * A label over one large statement: "WORD EQUATION" over "carbon dioxide + water → glucose +
 * oxygen", "KEY TERM" over a definition. The statement is set in the heading size, a step down
 * when it would run past three lines.
 */
export function keyCard(
  label: string,
  statement: string,
  top: number,
  bottom: number,
  t: Theme,
  ids: Ids = uid,
  compact = false,
): Placed | undefined {
  const measure = measureHeadless(t);
  const pad = SPACE[3];
  const inner = SAFE.w - pad * 2;
  const capSize = resolveFontSize(t, "caption");
  const capH = heightOf(measure, docFromText(label), inner, "caption", capSize);
  const doc = docFromText(statement);
  const presets = [
    ["heading", resolveFontSize(t, "heading")],
    ["body", resolveFontSize(t, "body")],
  ] as const;
  for (const [preset, size] of compact ? presets.slice(1) : presets) {
    const h1 = heightOf(measure, doc, inner, preset, size, 0, { fontWeight: 500 });
    const lines = h1 / (size * t.lineHeights[preset]);
    if (preset === "heading" && lines > 3.2) continue;
    const h = pad + capH + SPACE[1] + h1 + pad;
    if (top + withSafety(h) > bottom) continue;
    return {
      elements: [
        card(ids, t, { x: SAFE.x, y: top, w: SAFE.w, h }, KEY_CARD_NAME),
        text(ids, { x: SAFE.x + pad, y: top + pad, w: inner, h: capH }, docFromText(label), {
          preset: "caption",
          color: t.colors.accent,
          fontWeight: 700,
        }),
        text(ids, { x: SAFE.x + pad, y: top + pad + capH + SPACE[1], w: inner, h: h1 }, doc, {
          preset,
          fontSize: size,
          fontWeight: 500,
          color: t.colors.ink,
        }),
      ],
      bottom: top + h,
    };
  }
  return undefined;
}

/* ---------------------------------------------------------------- key terms */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The first use of each term in `doc` in bold and the accent, which the renderer draws as a tinted
 * chip (`slide.css`). Bold and colour are marks the editor's toolbar already sets and clears, so a
 * teacher can take the highlight off like any other formatting. `seen` carries the terms already
 * marked on the slide, so a term is marked once per slide.
 */
export function markTerms(
  doc: RichDoc,
  terms: string[],
  t: Theme,
  seen = new Set<string>(),
  /** No more marks once `seen` holds this many terms. */
  cap = Number.POSITIVE_INFINITY,
): RichDoc {
  const list = [...new Set(terms.map((x) => x.trim()).filter((x) => x.length > 2))].sort(
    (a, b) => b.length - a.length,
  );
  if (list.length === 0) return doc;
  const marks = [{ type: "bold" }, { type: "textStyle", attrs: { color: t.colors.accent } }];
  const splitText = (node: RichNode): RichNode[] => {
    if (node.type !== "text" || node.marks?.length) return [node];
    const value = node.text ?? "";
    for (const term of list) {
      const key = term.toLowerCase();
      if (seen.has(key) || seen.size >= cap) continue;
      const m = value.match(new RegExp(`\\b${escapeRe(term)}(?:e?s)?\\b`, "i"));
      if (!m || m.index === undefined) continue;
      seen.add(key);
      const before = value.slice(0, m.index);
      const after = value.slice(m.index + m[0].length);
      return [
        ...(before ? splitText({ type: "text", text: before }) : []),
        { type: "text", text: m[0], marks },
        ...(after ? splitText({ type: "text", text: after }) : []),
      ];
    }
    return [node];
  };
  const walk = (node: RichNode): RichNode =>
    node.content
      ? {
          ...node,
          content: node.content.flatMap((c) => (c.type === "text" ? splitText(c) : [walk(c)])),
        }
      : node;
  return walk(doc as RichNode) as RichDoc;
}

/* ---------------------------------------------------------------- inference from words */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A word equation ("a + b → c + d") or a formula in words ("speed = distance ÷ time"). */
const WORD_EQUATION =
  /([A-Za-z][A-Za-z ]*?(?: \+ [A-Za-z][A-Za-z ]*?)+ → [A-Za-z][A-Za-z ]*?(?: \+ [A-Za-z][A-Za-z ]*?)*)(?=[.;,]|$)/;
const WORD_FORMULA =
  /\b([a-z][a-z ]{1,30} = [a-z][a-z ]{1,30} [×÷/] [a-z][a-z ]{1,30})(?=[.;,]|$)/i;

/**
 * The structure a teaching slide's words already carry, for a slide generated before the hints
 * existed (or by a writer that does not give them):
 *
 * - compare: the heading names two kinds of one thing ("Hard and soft engineering …") and two
 *   sentences open with them ("Hard engineering (built structures) uses …");
 * - key card: a word equation or a formula in words; else a first sentence that defines one of
 *   the lesson's terms ("Hydraulic action is …", "Temperature means …").
 *
 * Returns the hint and the words left for the body, or `undefined`.
 */
export function inferStructure(
  heading: string,
  body: string,
  terms: string[] = [],
): { structure: SlideStructure; rest: string; lead?: string } | undefined {
  const all = sentences(body);
  const pair = heading.match(/^(\w+) and (\w+) ([a-z]+)\b/i);
  if (pair) {
    const [, a, b, noun] = pair as unknown as [string, string, string, string];
    const opener = (w: string) =>
      all.findIndex((s) => s.toLowerCase().startsWith(`${w} ${noun}`.toLowerCase()));
    const ia = opener(a);
    const ib = opener(b);
    if (ia >= 0 && ib >= 0 && ia !== ib) {
      const side = (w: string, s: string): CompareSide => {
        let rest = s.slice(`${w} ${noun}`.length).trim();
        const note = rest.match(/^\(([^)]+)\)\s*/);
        if (note) rest = rest.slice(note[0].length);
        return {
          label: `${cap(w)} ${noun}`,
          ...(note ? { note: cap(note[1] as string) } : {}),
          points: [cap(rest)],
        };
      };
      const rest = all.filter((_, i) => i !== ia && i !== ib).join(" ");
      return {
        structure: {
          compare: { left: side(a, all[ia] as string), right: side(b, all[ib] as string) },
        },
        rest,
      };
    }
  }
  const eq = body.match(WORD_EQUATION) ?? body.match(WORD_FORMULA);
  if (eq && eq.index !== undefined) {
    const statement = (eq[1] as string).trim();
    const label = statement.includes("→") ? "Word equation" : "Formula";
    const without =
      `${body.slice(0, eq.index).replace(/[:,]?\s*$/, "")}${body.slice(eq.index + eq[0].length)}`
        .replace(/\s+\./g, ".")
        .trim();
    const left = sentences(without);
    return {
      structure: { keyCard: { label, text: statement } },
      lead: left[0] ?? "",
      rest: left.slice(1).join(" "),
    };
  }
  const first = all[0] ?? "";
  const term = terms.find((x) =>
    new RegExp(
      `^(?:an? |the )?${escapeRe(x)}(?:e?s)?(?: \\([^)]*\\))? (?:is|are|means)\\b`,
      "i",
    ).test(first),
  );
  const means = !term && /^[A-Z][\w -]{2,30} means\b/.test(first);
  if (term || means) {
    return {
      structure: { keyCard: { label: "Key term", text: first } },
      rest: all.slice(1).join(" "),
    };
  }
  return undefined;
}

/* ---------------------------------------------------------------- the pass */

const isText = (e: SlideElement): e is TextElement => e.type === "text";
const LEAD_CARD = "Explanation card";

/**
 * Give one slide its structured components. Runs after the look (`applyLook`) and before the fit,
 * on a fresh slide or a stored one, and returns every page the slide needs: a set too long for one
 * slide at the body size continues on the next (UX ruling 91); every other component is drawn only
 * when it fits, else the slide is returned as it was. `hints` win over what the words suggest.
 */
export function structureSlide(
  slide: Slide,
  t: Theme,
  hints: SlideStructure = {},
  ids: Ids = uid,
  options: { pages?: boolean } = { pages: true },
): Slide[] {
  if (
    slide.elements.some((e) =>
      [OPTION_CHIP_NAME, COMPARE_NAME, STEP_NAME, KEY_CARD_NAME, PANEL_NAME].includes(e.name ?? ""),
    )
  ) {
    // Already structured (a stored slide): only its answers are moved off the questions.
    return answersClear([slide], t, ids, options.pages !== false);
  }
  switch (slide.kind) {
    case "starter":
    case "instructions":
    case "exit-ticket":
      return structureSet(slide, t, hints, ids, options.pages !== false);
    case "worked-example":
      return structureWorked(slide, t, ids, options.pages !== false);
    case "content":
      return structureContent(slide, t, hints, ids, options.pages !== false);
    case "open-response":
      return [structureOpen(slide, t)];
    default:
      return [slide];
  }
}

function headingOf(slide: Slide): TextElement | undefined {
  return slide.elements.find(
    (e): e is TextElement => isText(e) && (e.name === HEADING_NAME || e.style.preset === "heading"),
  );
}

function structureSet(
  slide: Slide,
  t: Theme,
  hints: SlideStructure,
  ids: Ids,
  paginate: boolean,
): Slide[] {
  const list = slide.elements.find(
    (e): e is TextElement => isText(e) && e.style.preset === "body" && !e.name,
  );
  const old = slide.elements.find(
    (e) =>
      e.name === ANSWERS_NAME ||
      (isText(e) && e.style.preset === "small" && /^Answers:/.test(docText(e.doc))),
  );
  if (!list) return [slide];
  const answers = old ? parseAnswers(docText((old as TextElement).doc ?? docFromText(""))) : [];
  const lines = hints.quiz ?? docLines(list.doc).map((line, i) => parseQuizLine(line, answers[i]));
  const rest = slide.elements.filter((e) => e !== list && e !== old);
  const choice = lines.some((l) => (l.options?.length ?? 0) > 0);
  // Open questions only stay one list (one box to edit) while the list fits; a list too long for
  // the slide is laid out line by line like a set with choices, so each page answers its own.
  const listFits = fitSlide({ ...slide, elements: rest.concat(list) }, t).overflow.length === 0;
  const pages = choice || (paginate && !listFits) ? layoutQuiz(lines, list.y, t, ids) : [];
  if (pages.length === 0 || (pages.length > 1 && !paginate)) {
    // Open questions only: the list stays as it is, and its answers move to the panel.
    if (!old) return [slide];
    const panel = answersPanel(
      lines.map((l, i) => ({ n: i + 1, text: l.answer ?? answers[i] ?? "" })).filter((a) => a.text),
      t,
      ids,
    );
    const kept = slide.elements.filter((e) => e !== old);
    return answersClear(
      [{ ...slide, elements: panel ? [...kept, panel] : kept }],
      t,
      ids,
      paginate,
    );
  }
  return answersClear(
    pages.map((page, i) =>
      i === 0 ? { ...slide, elements: [...rest, ...page] } : continued(slide, rest, page, ids),
    ),
    t,
    ids,
    paginate,
  );
}

/**
 * The answers never cover the questions. The panel is a reveal on the questions' own slide only
 * when it clears the foot of the last question; otherwise the answers go on a slide of their own
 * straight after ("… : answers"), which the teacher reaches with the same next press that would
 * have revealed the panel. Without pages (a generated slide is one slide) the panel stays for the
 * editor's Tidy to move.
 */
function answersClear(slides: Slide[], t: Theme, ids: Ids, paginate: boolean): Slide[] {
  if (!paginate) return slides;
  return slides.flatMap((slide) => {
    const panel = slide.elements.find((e) => e.name === ANSWERS_NAME && (e.revealStep ?? 0) > 0);
    if (!panel) return [slide];
    const fitted = fitSlide(slide, t).slide;
    const chrome = new Set(chromeOf(slide).map((e) => e.id));
    const foot = Math.max(
      0,
      ...fitted.elements
        .filter((e) => e.id !== panel.id && !chrome.has(e.id) && !isBackdrop(e) && !e.revealStep)
        .map((e) => e.y + e.h),
    );
    if (panel.y >= foot + SPACE[2]) return [slide];
    const heading = headingOf(slide);
    const top = heading ? snapY(heading.y + heading.h + SPACE[4]) : SAFE.y;
    const { revealStep: _step, reveal: _reveal, ...still } = panel;
    // On its own slide the answers take the room under the heading: re-measured at the small
    // size, a step down when they need it, never cut short by the reveal panel's cap.
    const room = SAFE_BOTTOM - top;
    const measure = measureHeadless(t);
    const ts = (panel as ShapeElement).textStyle ?? {};
    const pad = ts.padding ?? SPACE[2];
    const doc = (panel as ShapeElement).doc ?? docFromText("");
    let size = resolveFontSize(t, "small");
    let need = heightOf(measure, doc, panel.w, "small", size, pad);
    if (need > room) {
      size = floorBelow(t, "small");
      need = heightOf(measure, doc, panel.w, "small", size, pad);
    }
    const answers = {
      ...still,
      id: ids(),
      y: top,
      h: Math.min(room, withSafety(need)),
      textStyle: { ...ts, fontSize: size },
    };
    const next = continued(slide, chromeOf(slide), [answers as SlideElement], ids);
    const named = next.elements.map((e) =>
      heading && e.name === HEADING_NAME && isText(e)
        ? {
            ...e,
            doc: docFromText(`${docText(heading.doc).replace(/ \(continued\)$/, "")}: answers`),
          }
        : e,
    );
    const { question: _question, ...answersSlide } = next;
    return [
      { ...slide, elements: slide.elements.filter((e) => e !== panel) },
      { ...answersSlide, elements: named },
    ];
  });
}

/**
 * The next slide of a component that did not fit on one (UX ruling 91): the slide's chrome (the
 * heading with "(continued)", the kind tag, the accent bar) copied with new ids, then `content`.
 */
function continued(slide: Slide, chrome: SlideElement[], content: SlideElement[], ids: Ids): Slide {
  const heading = headingOf(slide);
  const carried = chrome.map((e) => {
    const copy = { ...e, id: ids() } as SlideElement;
    if (e === heading && isText(copy) && !/continued/i.test(docText(heading.doc))) {
      copy.doc = docFromText(`${docText(heading.doc)} (continued)`);
    }
    return copy;
  });
  const { notes: _notes, ...rest } = slide;
  return { ...rest, id: ids(), elements: [...carried, ...content] };
}

const CHROME = new Set([HEADING_NAME, "Kind tag", "Accent bar"]);
const chromeOf = (slide: Slide) => slide.elements.filter((e) => CHROME.has(e.name ?? ""));

/**
 * An open question's answer space and its "Write your answer" label, set under the stem to the
 * foot of the safe area. A stem that grew in the fit used to push both past the slide (the parity
 * lessons' open-response slides carried the label at y 560 of 540).
 */
function structureOpen(slide: Slide, t: Theme): Slide {
  const space = slide.elements.find((e) => e.name === "Answer space");
  const label = slide.elements.find(
    (e): e is TextElement => isText(e) && e.style.preset === "small",
  );
  const stem = slide.elements.find(
    (e): e is TextElement => isText(e) && e.style.preset === "heading",
  );
  if (!space || !stem) return slide;
  const labelH = label ? Math.ceil(resolveFontSize(t, "small") * t.lineHeights.small) : 0;
  const top = snapY(stem.y + stem.h + SPACE[4]);
  const foot = SAFE_BOTTOM - (label ? labelH + SPACE[1] : 0);
  if (foot - top < SPACE[7]) return slide;
  return {
    ...slide,
    elements: slide.elements.map((e) =>
      e === space
        ? { ...e, y: top, h: foot - top }
        : e === label
          ? { ...e, y: foot + SPACE[1], h: labelH }
          : e,
    ),
  };
}

function structureWorked(slide: Slide, t: Theme, ids: Ids, paginate: boolean): Slide[] {
  const cardEl = slide.elements.find((e) => e.name === "Working card");
  const working = slide.elements.find(
    (e): e is TextElement =>
      isText(e) && e.style.preset === "body" && !!cardEl && e.y >= cardEl.y && e.x >= cardEl.x,
  );
  const label = slide.elements.find(
    (e) =>
      isText(e) &&
      e.style.preset === "caption" &&
      !!cardEl &&
      e.y >= cardEl.y &&
      e.y < cardEl.y + 40,
  );
  const question = slide.elements.find(
    (e): e is TextElement => isText(e) && e.style.preset === "body" && e !== working,
  );
  if (!cardEl || !working || !question) return [slide];
  const top = snapY(question.y + question.h + SPACE[3]);
  const steps = docLines(working.doc);
  const keep = slide.elements.filter((e) => e !== cardEl && e !== working && e !== label);
  const strip = stepsStrip(steps, top, SAFE_BOTTOM, t, ids, { reveal: true });
  if (strip) return [{ ...slide, elements: [...keep, ...strip.elements] }];
  if (!paginate || steps.length < 3) return [slide];
  // Too long for one strip: the first half here, the rest on the next slide under the question
  // again, numbered on (UX ruling 91).
  const half = Math.ceil(steps.length / 2);
  const first = stepsStrip(steps.slice(0, half), top, SAFE_BOTTOM, t, ids, { reveal: true });
  const second = stepsStrip(steps.slice(half), top, SAFE_BOTTOM, t, ids, {
    reveal: true,
    start: half + 1,
  });
  if (!first || !second) return [slide];
  const next = continued(slide, [...chromeOf(slide), question], second.elements, ids);
  return [{ ...slide, elements: [...keep, ...first.elements] }, next];
}

function structureContent(
  slide: Slide,
  t: Theme,
  hints: SlideStructure,
  ids: Ids,
  paginate: boolean,
): Slide[] {
  const plain = [withTerms(slide, t, hints.terms)];
  const heading = headingOf(slide);
  if (heading && slide.elements.some(isSlot)) {
    return structureDiagram(slide, t, hints, ids, paginate);
  }
  if (!heading || slide.elements.some((e) => e.type === "image")) return plain;
  const bodies = slide.elements.filter(
    (e): e is TextElement =>
      isText(e) && e.style.preset === "body" && (!e.name || e.name === LEAD_CARD),
  );
  if (bodies.length === 0) return plain;
  const top = Math.min(...bodies.map((b) => b.y));
  // A content spec's `points` arrive as a bullet list at the end of its body (`bodyWithPoints`):
  // the prose is the words, the list the points.
  const words = joinSentences(bodies.map((b) => docText(proseOf(b.doc))));
  const points = bodies.flatMap((b) => pointsOf(b.doc));
  const explicit = hints.compare || hints.keyCard || hints.sequence;
  // A shape the writer filled (`withShapeHints`) wins over what the words suggest: no inference.
  const listed = !explicit && !!hints.points?.length;
  const inferred =
    explicit || listed ? undefined : inferStructure(docText(heading.doc), words, hints.terms);
  const s: SlideStructure = explicit ? hints : (inferred?.structure ?? {});
  const restWords = explicit ? words : (inferred?.rest ?? words);
  const lead = explicit ? "" : (inferred?.lead ?? "");
  // A written compare or sequence: its lead stays above the component. Its lines also sit in the
  // body as dot points (`shapeFallbackPoints`), which is how the slide reads when the component
  // cannot be placed at the body size or the step below it.
  const shaped = !!(hints.compare || hints.sequence);
  if (!s.compare && !s.sequence) {
    const split = splitContent(
      slide,
      t,
      bodies,
      top,
      words,
      points,
      s,
      hints,
      ids,
      undefined,
      paginate,
    );
    if (split) return [split];
  }
  if (!s.compare && !s.keyCard && !s.sequence) {
    if (!paginate) return plain;
    // A written list too long for one slide stays a list across the full measure (the recipe's
    // body is narrower than the measure: tempest "Prospero's commands and threats" read as a
    // 629-wide paragraph).
    const keep = slide.elements.filter((e) => !bodies.includes(e as TextElement));
    const listed =
      points.length >= 2
        ? greedyPages(
            slide,
            t,
            hints,
            ids,
            keep,
            undefined,
            top,
            SAFE.x,
            SAFE.w,
            joinSentences(bodies.map((b) => docText(proseOf(b.doc)))),
            points,
            true,
          )
        : undefined;
    return (
      listed ??
      (points.length ? splitList(slide, bodies, t, hints, ids) : undefined) ??
      splitParagraph(slide, bodies, t, ids, hints.terms) ??
      plain
    );
  }

  const measure = measureHeadless(t);
  const keep = slide.elements.filter((e) => !bodies.includes(e as TextElement));
  // Three settings, loosest first: the rest at the body size, the rest a step down (UX ruling 91),
  // then a key card's statement at the body size too. The first that fits the slide wins.
  let last: { els: SlideElement[]; restAt: number; size: number } | undefined;
  const leading = readingLeading(t);
  const levels = [
    [readingSize(t), false, false],
    [floorBelow(t, "body"), false, false],
    [floorBelow(t, "body"), true, false],
    // An equation's card after all its words, which then read as one paragraph above it.
    ...(lead ? ([[floorBelow(t, "body"), false, true]] as const) : []),
  ] as const;
  for (const [size, compact, after] of levels) {
    const els: SlideElement[] = [];
    let y = top;
    if (after && s.keyCard) {
      const words = [lead, restWords].filter(Boolean).join(" ");
      const doc = docFromText(words);
      const h = heightOf(measure, doc, SAFE.w, "body", size, 0, { lineHeight: leading });
      els.push(
        text(
          ids,
          { x: SAFE.x, y, w: SAFE.w, h },
          doc,
          { preset: "body", fontSize: size, lineHeight: leading },
          { name: BODY_NAME },
        ),
      );
      const card = keyCard(
        s.keyCard.label,
        s.keyCard.text,
        snapY(y + h + SPACE[3]),
        SAFE_BOTTOM,
        t,
        ids,
      );
      if (card && fits(card.bottom)) {
        return [
          withTerms({ ...slide, elements: [...keep, ...els, ...card.elements] }, t, hints.terms),
        ];
      }
      continue;
    }
    const para = (words: string) => {
      const doc = docFromText(words);
      const h = heightOf(measure, doc, SAFE.w, "body", size, 0, { lineHeight: leading });
      els.push(
        text(
          ids,
          { x: SAFE.x, y, w: SAFE.w, h },
          doc,
          { preset: "body", fontSize: size, lineHeight: leading },
          { name: BODY_NAME },
        ),
      );
      y = snapY(y + h + SPACE[3]);
    };
    let placed: Placed | undefined;
    if (s.compare) {
      if (shaped && restWords) para(restWords);
      placed = compareCards(s.compare.left, s.compare.right, y, SAFE_BOTTOM, t, ids);
    } else if (s.keyCard) {
      if (lead) para(lead);
      placed = keyCard(s.keyCard.label, s.keyCard.text, y, SAFE_BOTTOM, t, ids, compact);
    } else if (s.sequence) {
      if (restWords) para(restWords);
      placed = stepsStrip(s.sequence, y, SAFE_BOTTOM, t, ids);
    }
    if (!placed || !fits(placed.bottom)) continue;
    els.push(...placed.elements);
    y = snapY(placed.bottom + SPACE[3]);
    if (!restWords || s.sequence || shaped)
      return [withTerms({ ...slide, elements: [...keep, ...els] }, t, hints.terms)];
    const h = heightOf(measure, docFromText(restWords), SAFE.w, "body", size, 0, {
      lineHeight: leading,
    });
    if (fits(y + h)) {
      para(restWords);
      return [withTerms({ ...slide, elements: [...keep, ...els] }, t, hints.terms)];
    }
    last ??= { els, restAt: top, size };
  }
  // A written compare or sequence too long for its cards: the lead plus its lines as dot points,
  // beside a key term when there is one; else the plain lead and card, for the fit engine to step
  // down to the floor and no further, and for the editor's Tidy to continue (UX ruling 91).
  if (shaped) {
    const listHints = { ...hints, compare: undefined, sequence: undefined, points };
    const split = splitContent(
      slide,
      t,
      bodies,
      top,
      words,
      points,
      {},
      listHints,
      ids,
      undefined,
      paginate,
    );
    if (split) return [split];
    if (!paginate) return plain;
    // Too long for one slide: the lead and the dots across the full measure, continued as dots.
    const keep = slide.elements.filter((e) => !bodies.includes(e as TextElement));
    const lead = joinSentences(bodies.map((b) => docText(proseOf(b.doc))));
    return (
      greedyPages(slide, t, hints, ids, keep, undefined, top, SAFE.x, SAFE.w, lead, points, true) ??
      splitParagraph(slide, bodies, t, ids, hints.terms) ??
      plain
    );
  }
  // The words left over continue on the next slide; but a component never costs a slide the
  // plain text did not need, so a slide that fitted stays as it was.
  if (!paginate || fitSlide(slide, t).overflow.length === 0) return plain;
  // No component fitted and the plain words overrun: they continue as a paragraph.
  if (!last) return splitParagraph(slide, bodies, t, ids, hints.terms) ?? plain;
  const doc = docFromText(restWords);
  const h = heightOf(measure, doc, SAFE.w, "body", readingSize(t), 0, { lineHeight: leading });
  const next = continued(
    slide,
    chromeOf(slide),
    [
      text(
        ids,
        { x: SAFE.x, y: last.restAt, w: SAFE.w, h },
        doc,
        { preset: "body", fontSize: readingSize(t), lineHeight: leading },
        { name: BODY_NAME },
      ),
    ],
    ids,
  );
  return [
    withTerms({ ...slide, elements: [...keep, ...last.els] }, t, hints.terms),
    withTerms(next, t, hints.terms),
  ];
}

/**
 * A teaching paragraph too long for the slide even a step below the body size, as the slides it
 * needs (UX ruling 91): split at sentence boundaries into the fewest pages that each fit, as even
 * as they can be (sentence counts first, then words), so no page is a stub. `undefined` when it
 * fits, when it is not one plain paragraph, or when no split fits (a sentence longer than a slide).
 */
function splitParagraph(
  slide: Slide,
  bodies: TextElement[],
  t: Theme,
  ids: Ids,
  terms?: string[],
): Slide[] | undefined {
  if (bodies.length !== 1) return undefined;
  const body = bodies[0] as TextElement;
  const all = sentences(docText(body.doc));
  if (all.length < 2) return undefined;
  const keep = slide.elements.filter((e) => e !== body);
  const part = bodyPart(body, t, ids);
  if (fitSlide(slide, t).overflow.length === 0) return undefined;
  // Set again at the reading leading, it may fit after all.
  const whole = { ...slide, elements: [...keep, part(joinSentences(all), body.y)] };
  if (fitsSlide(whole, t)) return [withTerms(whole, t, terms)];
  return balancedPages(all, t, terms, fitsSlide, (groups) =>
    groups.map((g, i) =>
      i === 0
        ? { ...slide, elements: [...keep, part(joinSentences(g), body.y)] }
        : continued(slide, chromeOf(slide), [part(joinSentences(g), body.y)], ids),
    ),
  );
}

/** A body paragraph of `words` at the body size, at `y`, `w` wide (the body's own width). */
function bodyPart(body: TextElement, t: Theme, ids: Ids) {
  const measure = measureHeadless(t);
  const size = readingSize(t);
  const leading = readingLeading(t);
  return (words: string, y: number, w: number = body.w): TextElement => {
    const doc = docFromText(words);
    return {
      ...body,
      id: ids(),
      y,
      w,
      h: heightOf(measure, doc, w, "body", size, 0, { lineHeight: leading }),
      doc,
      name: BODY_NAME,
      style: { ...body.style, fontSize: size, lineHeight: leading },
    };
  };
}

/** Whether a slide fits, a step below the body size at most (the fit engine's floor). */
const fitsSlide = (slide: Slide, t: Theme) => fitSlide(slide, t).overflow.length === 0;

/** Whether a slide fits as it is, its running text kept at the body size. */
function atBodySize(slide: Slide, t: Theme): boolean {
  const fitted = fitSlide(slide, t);
  if (fitted.overflow.length > 0) return false;
  const size = readingSize(t);
  return fitted.slide.elements.every(
    (e) => !isText(e) || e.name !== BODY_NAME || (e.style.fontSize ?? size) >= size,
  );
}

/**
 * The first split of `all` into pages that `build` lays out and `fits` accepts, page by page:
 * the fewest pages, then the most even sentence counts, then the most even word counts, a longer
 * first page before a longer last one.
 */
function balancedPages(
  all: string[],
  t: Theme,
  terms: string[] | undefined,
  fits: (page: Slide, t: Theme, index: number) => boolean,
  build: (groups: string[][]) => Slide[],
): Slide[] | undefined {
  const words = all.map(wordsIn);
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  for (let k = 2; k <= all.length; k++) {
    const candidates = cutsOf(all.length, k).map((cuts) => {
      const bounds = [0, ...cuts, all.length];
      const runs = bounds.slice(1).map((end, i) => [bounds[i] as number, end] as const);
      const groups = runs.map(([a, b]) => all.slice(a, b));
      const sums = runs.map(([a, b]) => words.slice(a, b).reduce((x, y) => x + y, 0));
      const score = [spread(groups.map((g) => g.length)), spread(sums), -(sums[0] ?? 0)];
      return { groups, score };
    });
    candidates.sort((x, y) => {
      for (let i = 0; i < x.score.length; i++) {
        const d = (x.score[i] as number) - (y.score[i] as number);
        if (d !== 0) return d;
      }
      return 0;
    });
    for (const { groups } of candidates) {
      const pages = build(groups);
      if (pages.every((p, i) => fits(p, t, i))) return pages.map((p) => withTerms(p, t, terms));
    }
  }
  return undefined;
}

/** Every way to cut `n` items into `k` non-empty runs, as the k-1 cut positions (at most 2000). */
function cutsOf(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (from: number, left: number, acc: number[]) => {
    if (out.length >= 2000) return;
    if (left === 0) {
      out.push(acc);
      return;
    }
    for (let c = from; c <= n - left; c++) walk(c + 1, left - 1, [...acc, c]);
  };
  walk(1, k - 1, []);
  return out;
}

/**
 * A teaching slide set as one paragraph that still overruns at the floor, as every slide it needs
 * (UX ruling 91): the sentences that fit stay, the rest continue. The slide as it is when it fits,
 * or when it is not one paragraph under a heading.
 */
export function continueParagraph(
  slide: Slide,
  t: Theme,
  ids: Ids = uid,
  terms?: string[],
): Slide[] {
  const bodies = slide.elements.filter(
    (e): e is TextElement =>
      isText(e) &&
      e.style.preset === "body" &&
      (!e.name || e.name === LEAD_CARD || e.name === BODY_NAME),
  );
  if (slide.kind !== "content" || !headingOf(slide)) return [slide];
  return splitParagraph(slide, bodies, t, ids, terms) ?? [slide];
}

/**
 * A written list too long for the slide at the floor, kept a list (UX ruling 91): the lead and the
 * first points that fit stay, the remaining points continue on the next slide as a list of their
 * own. `undefined` when no split keeps both slides within the safe area.
 */
function splitList(
  slide: Slide,
  bodies: TextElement[],
  t: Theme,
  hints: SlideStructure,
  ids: Ids,
): Slide[] | undefined {
  if (bodies.length !== 1 || fitSlide(slide, t).overflow.length === 0) return undefined;
  const body = bodies[0] as TextElement;
  const points = pointsOf(body.doc);
  if (points.length < 3) return undefined;
  const lead = docText(proseOf(body.doc));
  const withList = (s: Slide, from: TextElement, words: string, items: string[]): Slide => ({
    ...s,
    elements: s.elements.map((e) =>
      e.id === from.id ? { ...from, doc: listDoc(words, items), name: undefined } : e,
    ),
  });
  const clear = (pages: Slide[]) =>
    pages.length === 1 && fitSlide(pages[0] as Slide, t).overflow.length === 0;
  // The most points the first slide keeps, and never fewer than two on either slide.
  for (let k = points.length - 2; k >= 2; k--) {
    const head = structureContent(
      withList(slide, body, lead, points.slice(0, k)),
      t,
      { ...hints, points: points.slice(0, k) },
      ids,
      false,
    );
    if (!clear(head)) continue;
    const carried: TextElement = { ...body, id: ids() };
    const next = continued(slide, chromeOf(slide), [carried], ids);
    const tail = structureContent(
      withList(next, carried, "", points.slice(k)),
      t,
      { ...hints, points: points.slice(k) },
      ids,
      false,
    );
    if (!clear(tail)) continue;
    return [...head, ...tail];
  }
  return undefined;
}

/** A lead paragraph (when there is one) and its points as one bullet list. */
function listDoc(lead: string, items: string[]): RichDoc {
  const prose = lead.trim() ? (docFromText(lead).content ?? []) : [];
  return { type: "doc", content: [...prose, ...(docFromBullets(items).content ?? [])] };
}

const DIAGRAM_SLOT = "Diagram placeholder";
/** The right-hand room a teaching slide keeps: a diagram slot or a photo slot (look/image-slot). */
const isSlot = (e: SlideElement) => e.name === DIAGRAM_SLOT || e.name === PHOTO_NAME;

/**
 * A teaching slide with a diagram or photo slot: the words keep the left column and the slot the right,
 * from the column's top to the foot of the safe area, so neither runs over the other or past the
 * slide. Words too long for the column are set as one paragraph at the body size, then a step
 * down; still too long, the sentences that fit stay beside the diagram and the rest continue on
 * the next slide at the body size, across the full measure (UX ruling 91). Without pages (a
 * generated slide is one slide) the paragraph stays a step down for the editor's Tidy to carry.
 */
function structureDiagram(
  slide: Slide,
  t: Theme,
  hints: SlideStructure,
  ids: Ids,
  paginate: boolean,
): Slide[] {
  return composeBesideSlot(slotSide(slide, "right"), t, hints, ids, paginate).map((page) =>
    slotSide(page, hints.slotSide ?? "left"),
  );
}

/** The side of a teaching slide a photo or diagram slot takes; the words take the other. */
export type SlotSide = "left" | "right";

/** Which side a slide's slot is on, or `undefined` for a slide without one. */
export function slotSideOf(slide: Slide): SlotSide | undefined {
  const slot = slide.elements.find(isSlot);
  if (!slot) return undefined;
  return slot.x < SAFE.x + SAFE.w / 2 - slot.w / 2 ? "left" : "right";
}

/**
 * A deck's slot slides alternating sides (look/slides-layout): the first slide with a slot keeps
 * it at the left, as a diagram slide draws its figure, the next at the right, and so on, so two
 * slot slides running do not repeat one composition. Deterministic: the same deck always comes
 * back the same, and a slide with no slot (a continuation among them) does not count. The words
 * keep their widths on either side (`slotSide`), so the fit and the budgets are the same.
 */
export function alternateSlotSides(slides: readonly Slide[]): Slide[] {
  let k = 0;
  return slides.map((slide) => {
    if (slotSideOf(slide) === undefined) return slide;
    const side: SlotSide = k % 2 === 0 ? "left" : "right";
    k += 1;
    return slotSide(slide, side);
  });
}

/** The slide with its slot on the other side, for the editor's swap button. */
export function swapSlotSide(slide: Slide): Slide {
  const side = slotSideOf(slide);
  return side === undefined ? slide : slotSide(slide, side === "left" ? "right" : "left");
}

/**
 * A slot's page with the slot moved to one side and the words beside it to the other (look/slides-pr).
 * The slot is drawn at the left, as a diagram slide's figure and an image-text slide's photograph
 * are (`layouts.ts` `FIGURE_RECT`, ADR 0032); the composition below measures with it at the right,
 * and the move keeps every width, so the fit and the continuation are the same either way. The
 * words are the elements beside the slot (level with it, clear of it); the heading, the top line and
 * a continuation's full-measure words are not, and stay. A page without a slot, or with it already
 * on that side, comes back as it is (same object), so a stored slide can be restructured.
 */
export function slotSide(slide: Slide, side: SlotSide): Slide {
  const slot = slide.elements.find(isSlot);
  if (!slot) return slide;
  const atLeft = slotSideOf(slide) === "left";
  if (atLeft === (side === "left")) return slide;
  const shift = slot.w + SPACE[5];
  const beside = (e: SlideElement) =>
    e !== slot &&
    !isBackdrop(e) &&
    e.name !== ACCENT_BAR_NAME &&
    e.name !== COUNTER_NAME &&
    e.name !== KIND_TAG_NAME &&
    e.w < SAFE.w - 1 &&
    e.y < slot.y + slot.h &&
    e.y + e.h > slot.y &&
    (atLeft ? e.x >= slot.x + slot.w : e.x + e.w <= slot.x);
  return {
    ...slide,
    elements: slide.elements.map((e) => {
      if (e === slot) return { ...e, x: atLeft ? SAFE.x + SAFE.w - slot.w : SAFE.x };
      return beside(e) ? { ...e, x: e.x + (atLeft ? -shift : shift) } : e;
    }),
  };
}

function composeBesideSlot(
  slide: Slide,
  t: Theme,
  hints: SlideStructure,
  ids: Ids,
  paginate: boolean,
): Slide[] {
  const slot = slide.elements.find(isSlot) as SlideElement;
  const bodies = slide.elements
    .filter(
      (e): e is TextElement =>
        isText(e) &&
        e.style.preset === "body" &&
        (!e.name || e.name === LEAD_CARD || e.name === BODY_NAME),
    )
    .sort((a, b) => a.y - b.y);
  const first = bodies[0];
  if (!first) return [withTerms(slide, t, hints.terms)];
  // The slot is the right panel of the two-column composition, the words the left column.
  const prose = joinSentences(bodies.map((b) => docText(proseOf(b.doc))));
  const asPanel = splitContent(
    slide,
    t,
    bodies,
    first.y,
    prose,
    bodies.flatMap((b) => pointsOf(b.doc)),
    {},
    hints,
    ids,
    slot,
    paginate,
  );
  if (asPanel) return [asPanel];
  const top = first.y;
  const x = first.x;
  const w = Math.max(SPACE[7], Math.min(first.w, slot.x - SPACE[5] - x));
  const placedSlot = slotPanel(slot, top, slot.x, slot.w, t);
  // With pages the words fill the column beside the slot at the body size, as many points or
  // sentences as fit, and only the rest continues (look/image-slot): a list stays a list.
  const points = hints.points?.length ? hints.points : bodies.flatMap((b) => pointsOf(b.doc));
  if (paginate) {
    const keep = slide.elements.filter((e) => e !== slot && !bodies.includes(e as TextElement));
    const listed = points.length >= 2;
    const lead = listed ? joinSentences(bodies.map((b) => docText(proseOf(b.doc)))) : "";
    const items = listed ? points : sentences(bodies.map((b) => docText(b.doc)).join(" "));
    const paged = greedyPages(
      slide,
      t,
      hints,
      ids,
      keep,
      placedSlot,
      top,
      x,
      w,
      lead,
      items,
      listed,
    );
    if (paged) return paged;
  }
  const asIs: Slide = {
    ...slide,
    elements: slide.elements.map((e) => (e === slot ? placedSlot : e)),
  };
  const columnFoot = (s: Slide) =>
    Math.max(
      ...fitSlide(s, t)
        .slide.elements.filter((e) => bodies.some((b) => b.id === e.id))
        .map((e) => e.y + e.h),
    );
  // With pages the words are never stepped down beside the drawing: that is for the loop below.
  if (!paginate && fitSlide(asIs, t).overflow.length === 0 && columnFoot(asIs) <= SAFE_BOTTOM) {
    return [withTerms(asIs, t, hints.terms)];
  }
  const measure = measureHeadless(t);
  const leading = readingLeading(t);
  const words = bodies.map((b) => docText(b.doc)).join(" ");
  const keep = slide.elements.filter((e) => e !== slot && !bodies.includes(e as TextElement));
  const para = (words: string, size: number, width: number): TextElement => {
    const doc = docFromText(words);
    return text(
      ids,
      {
        x,
        y: top,
        w: width,
        h: heightOf(measure, doc, width, "body", size, 0, { lineHeight: leading }),
      },
      doc,
      { preset: "body", fontSize: size, lineHeight: leading },
      { name: BODY_NAME },
    );
  };
  const body = readingSize(t);
  const floor = floorBelow(t, "body");
  for (const size of paginate ? [body] : [body, floor]) {
    const p = para(words, size, w);
    if (top + withSafety(p.h) <= SAFE_BOTTOM) {
      return [withTerms({ ...slide, elements: [...keep, p, placedSlot] }, t, hints.terms)];
    }
  }
  if (!paginate) {
    return [
      withTerms(
        { ...slide, elements: [...keep, para(words, floor, w), placedSlot] },
        t,
        hints.terms,
      ),
    ];
  }
  // With pages: the drawing keeps its space on the first slide and the words beside it stay at the
  // body size; they continue across the full measure, split evenly (`balancedPages`, UX ruling 91).
  const all = sentences(words);
  const oneStepDown = [
    withTerms({ ...slide, elements: [...keep, para(words, floor, w), placedSlot] }, t, hints.terms),
  ];
  if (all.length < 2) return oneStepDown;
  return (
    balancedPages(
      all,
      t,
      hints.terms,
      (p, _t, i) => (i === 0 ? atBodySize(p, t) : fitsSlide(p, t)),
      (groups) =>
        groups.map((g, i) =>
          i === 0
            ? { ...slide, elements: [...keep, para(joinSentences(g), body, w), placedSlot] }
            : continued(slide, chromeOf(slide), [para(joinSentences(g), body, SAFE.w)], ids),
        ),
    ) ?? oneStepDown
  );
}

/**
 * A teaching slide's words as the fewest slides, the first filled first (look/image-slot): the
 * lead and as many items (dot points, or sentences as one paragraph) as fit the first column at
 * the body size, beside `slot` when there is one; the rest across the full measure on
 * "(continued)" slides, each as full as fits. A continuation does not hold one item alone: the
 * first slide takes it a step down (never below the floor), else gives it one of its own while
 * it keeps at least one; a first slide with room for only one item keeps it (one each).
 * `undefined` when an item does not fit a slide on its own.
 */
function greedyPages(
  slide: Slide,
  t: Theme,
  hints: SlideStructure,
  ids: Ids,
  keep: SlideElement[],
  slot: SlideElement | undefined,
  top: number,
  x: number,
  w: number,
  lead: string,
  items: string[],
  dots: boolean,
): Slide[] | undefined {
  const body = readingSize(t);
  const floor = floorBelow(t, "body");
  const column = (
    from: string[],
    y: number,
    cx: number,
    cw: number,
    size: number,
    withLead: boolean,
  ) =>
    dots
      ? dotsColumn(withLead ? lead : "", from, y, cx, cw, t, ids, size)
      : from.length === 0
        ? []
        : paragraphColumn(joinSentences(from), y, cx, cw, t, ids, size);
  const first = (k: number, size = body) => column(items.slice(0, k), top, x, w, size, true);
  let k = items.length;
  while (k > 0 && !first(k)) k -= 1;
  const n = items.length;
  const page = (els: SlideElement[]) =>
    withTerms({ ...slide, elements: [...keep, ...els, ...(slot ? [slot] : [])] }, t, hints.terms);
  if (k === n) {
    const els = first(n);
    return els ? [page(els)] : undefined;
  }
  if (n - k === 1) {
    const down = first(n, floor);
    if (down) return [page(down)];
    // Else the first slide gives one of its own, while it keeps at least one beside the lead.
    if (k >= 2) k -= 1;
  }
  if (k === 0 && !lead) return undefined;
  const firstEls = first(k);
  if (!firstEls) return undefined;
  const shell = fitSlide(continued(slide, chromeOf(slide), [], ids), t).slide;
  const head = headingOf(shell);
  const top2 = Math.max(top, head ? snapY(head.y + head.h + SPACE[4]) : top);
  const groups: { items: string[]; size: number }[] = [];
  let rest = items.slice(k);
  while (rest.length) {
    let m = rest.length;
    while (m > 0 && !column(rest.slice(0, m), top2, SAFE.x, SAFE.w, body, false)) m -= 1;
    if (m === 0) return undefined;
    // Never one item alone on the last slide: this slide takes it a step down, else gives it one.
    if (rest.length - m === 1 && column(rest, top2, SAFE.x, SAFE.w, floor, false)) {
      groups.push({ items: rest, size: floor });
      break;
    }
    if (rest.length - m === 1 && m >= 3) m -= 1;
    groups.push({ items: rest.slice(0, m), size: body });
    rest = rest.slice(m);
  }
  return [
    page(firstEls),
    ...groups.map((g, i) =>
      withTerms(
        {
          ...shell,
          id: i === 0 ? shell.id : ids(),
          elements: [
            ...shell.elements.map((e) => (i === 0 ? e : { ...e, id: ids() })),
            ...(column(g.items, top2, SAFE.x, SAFE.w, g.size, false) as SlideElement[]),
          ],
        },
        t,
        hints.terms,
      ),
    ),
  ];
}

/** Sentences as one paragraph down a column at `size`, or `undefined` past the safe area. */
function paragraphColumn(
  words: string,
  top: number,
  x: number,
  width: number,
  t: Theme,
  ids: Ids,
  size: number,
): SlideElement[] | undefined {
  const measure = measureHeadless(t);
  const leading = readingLeading(t);
  const doc = docFromText(words);
  const h = heightOf(measure, doc, width, "body", size, 0, { lineHeight: leading });
  if (!fits(top + h)) return undefined;
  return [
    text(
      ids,
      { x, y: top, w: width, h },
      doc,
      { preset: "body", fontSize: size, lineHeight: leading },
      { name: BODY_NAME },
    ),
  ];
}

/**
 * A lead and dot points set down a column at the body size, as `splitContent` sets them; the
 * elements, or `undefined` when they run past the foot of the safe area.
 */
function dotsColumn(
  lead: string,
  items: string[],
  top: number,
  x: number,
  width: number,
  t: Theme,
  ids: Ids,
  size = readingSize(t),
): SlideElement[] | undefined {
  const measure = measureHeadless(t);
  const leading = readingLeading(t);
  const els: SlideElement[] = [];
  let y = top;
  if (lead) {
    const doc = docFromText(lead);
    const style = { preset: "body" as const, fontSize: size, fontWeight: 600, lineHeight: leading };
    const h = heightOf(measure, doc, width, "body", size, 0, style);
    els.push(text(ids, { x, y, w: width, h }, doc, style, { name: LEAD_NAME }));
    y = snapY(y + h + SPACE[3]);
  }
  const dot = Math.round(size * 0.42);
  const indent = Math.round(size * 1.3);
  for (const item of items) {
    const doc = docFromText(item);
    const h = heightOf(measure, doc, width - indent, "body", size, 0, { lineHeight: leading });
    els.push({
      id: ids(),
      type: "shape",
      shape: "ellipse",
      x: x + Math.round((indent - dot) / 3),
      y: Math.round(y + (size * leading) / 2 - dot / 2),
      w: dot,
      h: dot,
      fill: t.colors.accent,
      name: BULLET_NAME,
    });
    els.push(
      text(
        ids,
        { x: x + indent, y, w: width - indent, h },
        doc,
        { preset: "body", fontSize: size, lineHeight: leading },
        { name: ITEM_NAME },
      ),
    );
    y = snapY(y + h + SPACE[2]);
  }
  return fits(y - SPACE[2]) ? els : undefined;
}

/** Key terms on a teaching slide's running text (never its heading, and never a question). */
export function withTerms(slide: Slide, t: Theme, terms: string[] | undefined): Slide {
  if (!terms?.length) return slide;
  const seen = new Set<string>();
  const running = (e: SlideElement): e is TextElement =>
    isText(e) &&
    e.style.preset === "body" &&
    e.name !== QUESTION_NAME &&
    e.name !== PANEL_TEXT_NAME;
  // Restraint, as in the examples: the first use of a term on the slide, in reading order, and at
  // most two terms a slide. Marks from an earlier pass are cleared first, so a slide styled twice
  // (generated, then restyled) never carries a term twice.
  const order = slide.elements
    .filter(running)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => e.id);
  const marked = new Map<string, RichDoc>();
  for (const id of order) {
    const e = slide.elements.find((x) => x.id === id) as TextElement;
    const clean = unmarkTerms(e.doc, t);
    marked.set(id, markTerms(clean, terms, t, seen, MAX_TERMS));
  }
  return {
    ...slide,
    elements: slide.elements.map((e) => {
      const doc = marked.get(e.id);
      return doc && isText(e) ? { ...e, doc } : e;
    }),
  };
}

/** Key terms picked out on one slide, at most. */
export const MAX_TERMS = 2;

/** A doc without the key-term chips `markTerms` set (bold together with the accent colour). */
export function unmarkTerms(doc: RichDoc, t: Theme): RichDoc {
  const chip = (n: RichNode) =>
    n.type === "text" &&
    n.marks?.length === 2 &&
    n.marks.some((m) => m.type === "bold") &&
    n.marks.some((m) => m.type === "textStyle" && m.attrs?.color === t.colors.accent);
  const walk = (node: RichNode): RichNode => {
    if (!node.content) return node;
    const content: RichNode[] = [];
    for (const c of node.content) {
      const plainNode = chip(c) ? { type: "text", text: c.text ?? "" } : walk(c);
      const prev = content[content.length - 1];
      if (plainNode.type === "text" && !plainNode.marks && prev?.type === "text" && !prev.marks) {
        content[content.length - 1] = {
          type: "text",
          text: `${prev.text ?? ""}${plainNode.text ?? ""}`,
        };
      } else content.push(plainNode as RichNode);
    }
    return { ...node, content };
  };
  return walk(doc as RichNode) as RichDoc;
}

/* ---------------------------------------------------------------- split composition */

export const PANEL_NAME = "Side panel";
export const PANEL_LABEL_NAME = "Side panel label";
export const PANEL_TEXT_NAME = "Side panel text";
/** A side panel's text taken from the lesson's glossary, not from the slide's own words. */
export const PANEL_DEFINITION_NAME = "Side panel definition";
export const LEAD_NAME = "Lead";
export const BULLET_NAME = "Bullet";
export const ITEM_NAME = "Point";
/** A sentence longer than this reads as a paragraph, not a bullet. */
const ITEM_MAX_WORDS = 22;

const wordsIn = (x: string) => x.split(/\s+/).filter(Boolean).length;

/**
 * A teaching slide in two columns, as the examples set them: the words down the left (a lead,
 * then its points as accent-dot bullets, or the rest as a paragraph) and a tinted panel on the
 * right holding what the slide is about: its key card (a word equation, a formula, a defined
 * term), else the lesson's definition of a term the words use, else the key idea itself. No
 * right half is left empty. A body of one sentence with none of these is the key idea on its own,
 * set as a card across the measure. `undefined` when the words do not fit the column even a step down, or
 * there is nothing to set beside them: the full-width paragraph and its continuation (UX ruling
 * 91) take over.
 */
function splitContent(
  slide: Slide,
  t: Theme,
  bodies: TextElement[],
  top: number,
  words: string,
  points: string[],
  s: SlideStructure,
  hints: SlideStructure,
  ids: Ids,
  /** A diagram slot: it becomes the panel, and every sentence stays in the left column. */
  slot?: SlideElement,
  /** With pages: a panel is never kept by stepping the words down beside it. */
  floorless = false,
): Slide | undefined {
  if (top > SAFE.y + SAFE.h * 0.45) return undefined;
  // A sentence that only repeats the heading is not said twice on the slide.
  const bare = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const said = bare(docText(headingOf(slide)?.doc ?? docFromText("")));
  const all = sentences(words).filter((x) => bare(x) !== said);
  let label: string;
  let statement: RichDoc;
  let weight = 600;
  let textName = PANEL_TEXT_NAME;
  let left: string[];
  const glossary = hints.glossary?.find((g) =>
    new RegExp(`\\b${escapeRe(g.term)}`, "i").test(words),
  );
  if (slot) {
    label = "Diagram";
    statement = docFromText("");
    left = all;
  } else if (s.keyCard) {
    label = s.keyCard.label;
    statement = docFromText(s.keyCard.text);
    left = sentences(words.replace(s.keyCard.text, "").replace(/\s+\./g, ".")).filter(
      (x) => x.replace(/[^A-Za-z]/g, "").length > 0,
    );
    if (left.length === 0) left = all;
  } else if (hints.points?.length) {
    // The writer's own list: its lead stays the lead, and the lead and its dots take the full
    // measure, key term or not (a key term is still picked out in the words). Only a diagram
    // takes a list's right half, which the writer knows when it writes, so its word budget can
    // follow (`content-shapes.ts`).
    label = "";
    statement = docFromText("");
    left = all;
  } else if (glossary) {
    label = "Key term";
    weight = 400;
    textName = PANEL_DEFINITION_NAME;
    statement = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: glossary.term, marks: [{ type: "bold" }] }],
        },
        { type: "paragraph", content: [{ type: "text", text: glossary.definition }] },
      ],
    };
    // The panel carries the definition, so the words do not say it again: an aside that
    // restates it ("Chlorophyll, the green substance in plant cells, absorbs …") is cut, and a
    // sentence that is only the definition goes, while something is left to read.
    left = withoutDefinition(all, glossary.term, glossary.definition);
  } else if (all.length >= 2 || (all.length === 1 && points.length >= 2)) {
    label = "Key idea";
    statement = docFromText(all[0] as string);
    left = all.slice(1);
  } else if (all.length === 1) {
    // One sentence and nothing to set beside it (no key card, glossary term or points). A panel
    // would hold the sentence and leave the left column empty, and one line across the full
    // measure leaves most of the slide bare. The sentence is the slide's key idea, so it is set
    // as one: a "Key idea" card across the measure at the display size, every word once. This
    // keeps the explain contract (the key idea is what the slide stands on) at the writer's
    // panel budget, whose body always fits the card (`content-shapes.test.ts`).
    const card = keyCard("Key idea", all[0] as string, top, SAFE_BOTTOM, t, ids);
    if (!card) return undefined;
    // The sentence is the slide's running text, so its key terms are picked out in the card.
    const said = card.elements.map((e, i) =>
      i === card.elements.length - 1 && isText(e) && hints.terms?.length
        ? { ...e, doc: markTerms(e.doc, hints.terms, t, new Set<string>(), MAX_TERMS) }
        : e,
    );
    const keep = slide.elements.filter((e) => !bodies.includes(e as TextElement));
    const next: Slide = { ...slide, elements: [...keep, ...said] };
    if (fitSlide(next, t).overflow.length > 0) return undefined;
    return next;
  } else return undefined;
  // The points: the writer's own items, else the sentences after the lead when each is short.
  // When the key idea itself went to the panel, every sentence left is a point.
  const short = (xs: string[]) =>
    xs.length >= 2 && xs.length <= 4 && xs.every((x) => wordsIn(x) <= ITEM_MAX_WORDS);
  const ideaInPanel = label === "Key idea";
  const items =
    points.length >= 2
      ? points.slice(0, 4)
      : ideaInPanel && short(left)
        ? left
        : !ideaInPanel && short(left.slice(1))
          ? left.slice(1)
          : [];
  const lead =
    points.length >= 2
      ? joinSentences(left)
      : items.length && !ideaInPanel
        ? (left[0] as string)
        : "";
  const rest = items.length ? "" : joinSentences(left);

  const measure = measureHeadless(t);
  const leading = readingLeading(t);
  const sizes = readingSizes(t);
  const keep = slide.elements.filter((e) => !bodies.includes(e as TextElement) && e !== slot);
  // Half and half first, as in the examples; a longer text takes up to two thirds before it gives up
  // the panel for the full-width paragraph.
  // A diagram keeps its half: a drawing squeezed to a third is no use.
  const across = label === "";
  // Every share at the body size first. With pages nothing steps down beside a panel: the panel
  // gives way to the full-width paragraph (a step down there, then a continuation, UX ruling 91).
  const shares = across
    ? [1]
    : slot
      ? [slot.type === "image" ? PHOTO_TEXT_SHARE : 0.5]
      : [0.5, 0.6, 0.66];
  const settings = sizes.flatMap((size) => shares.map((share) => ({ share, size })));
  for (const { share, size } of settings) {
    if (size !== sizes[0] && floorless && !across) break;
    const half = across ? SAFE.w : Math.floor((SAFE.w - SPACE[5]) * share);
    const panelX = SAFE.x + half + SPACE[5];
    const panelW = SAFE.x + SAFE.w - panelX;
    const els: SlideElement[] = [];
    let y = top;
    const lh = leading;
    if (lead) {
      const doc = docFromText(lead);
      const style = {
        preset: "body" as const,
        fontSize: size,
        fontWeight: 600,
        lineHeight: leading,
      };
      const h = heightOf(measure, doc, half, "body", size, 0, style);
      els.push(text(ids, { x: SAFE.x, y, w: half, h }, doc, style, { name: LEAD_NAME }));
      y = snapY(y + h + SPACE[3]);
    }
    const dot = Math.round(size * 0.42);
    const indent = Math.round(size * 1.3);
    for (const item of items) {
      const doc = docFromText(item);
      const h = heightOf(measure, doc, half - indent, "body", size, 0, { lineHeight: leading });
      els.push({
        id: ids(),
        type: "shape",
        shape: "ellipse",
        x: SAFE.x + Math.round((indent - dot) / 3),
        y: Math.round(y + (size * lh) / 2 - dot / 2),
        w: dot,
        h: dot,
        fill: t.colors.accent,
        name: BULLET_NAME,
      });
      els.push(
        text(
          ids,
          { x: SAFE.x + indent, y, w: half - indent, h },
          doc,
          { preset: "body", fontSize: size, lineHeight: leading },
          { name: ITEM_NAME },
        ),
      );
      y = snapY(y + h + SPACE[2]);
    }
    if (rest) {
      const doc = docFromText(rest);
      const h = heightOf(measure, doc, half, "body", size, 0, { lineHeight: leading });
      els.push(
        text(
          ids,
          { x: SAFE.x, y, w: half, h },
          doc,
          { preset: "body", fontSize: size, lineHeight: leading },
          { name: BODY_NAME },
        ),
      );
      y = snapY(y + h + SPACE[3]);
    }
    if (!fits(y - SPACE[2])) continue;
    const panel = across
      ? []
      : slot
        ? [slotPanel(slot, top, panelX, panelW, t)]
        : sidePanel(label, statement, top, panelX, panelW, t, ids, weight, textName);
    if (!panel) continue;
    const next: Slide = { ...slide, elements: [...keep, ...els, ...panel] };
    if (fitSlide(next, t).overflow.length > 0) continue;
    return withTerms(next, t, hints.terms);
  }
  return undefined;
}

/**
 * A slot set as the right panel, from the column's top to the foot of the safe area. A photo slot
 * is the image itself, rounded and cover-cropped; a diagram slot is `diagramPanel`.
 */
function slotPanel(slot: SlideElement, top: number, x: number, w: number, t: Theme): SlideElement {
  if (slot.type === "image") {
    return { ...slot, x, y: top, w, h: SAFE_BOTTOM - top, fit: "cover", radius: t.radius };
  }
  return diagramPanel(slot, top, x, w, t);
}

/**
 * A diagram slot set as the right panel: the same tinted card as the key-term panel, carrying its
 * instruction in small muted type. Still named `Diagram placeholder`, so the renderer draws it in
 * the editor only (`withDiagramSlot`): a class never sees "Diagram to add".
 */
function diagramPanel(
  slot: SlideElement,
  top: number,
  x: number,
  w: number,
  t: Theme,
): SlideElement {
  return {
    ...(slot as ShapeElement),
    x,
    y: top,
    w,
    h: SAFE_BOTTOM - top,
    fill: accentTint(t),
    stroke: accentTint(t),
    strokeWidth: 0,
    radius: t.radius,
    textStyle: {
      // A note to the teacher, not slide copy: caption size, so a 25-word instruction fits.
      preset: "small",
      fontSize: t.sizes.caption,
      color: t.colors.muted,
      align: "center",
      valign: "middle",
      padding: SPACE[4],
    },
  } as SlideElement;
}

const STOP = new Set(
  "a an the of in on to and or for is are that which by with its it as at from".split(" "),
);
const contentWords = (x: string) =>
  x
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
/** The share of `part`'s content words that `whole` also uses. */
const overlap = (part: string, whole: string) => {
  const p = contentWords(part);
  const w = new Set(contentWords(whole));
  return p.length === 0 ? 0 : p.filter((x) => w.has(x)).length / p.length;
};

/**
 * The sentences without the definition a side panel already shows: an aside after the term that
 * restates it is cut ("Chlorophyll, the green substance in plant cells, absorbs light" →
 * "Chlorophyll absorbs light"); a sentence that says little but the definition is dropped, unless
 * it is the only one.
 */
export function withoutDefinition(all: string[], term: string, definition: string): string[] {
  const aside = new RegExp(
    `^(.*?\\b${escapeRe(term)}\\b)\\s*(?:,\\s*([^,]+?),|\\(([^)]+)\\))\\s*`,
    "i",
  );
  const cut = all.map((x) => {
    const m = x.match(aside);
    const said = m ? (m[2] ?? m[3] ?? "") : "";
    return m && overlap(said, definition) >= 0.5 ? `${m[1]} ${x.slice(m[0].length)}` : x;
  });
  const kept = cut.filter((x) => overlap(definition, x) < 0.6);
  return kept.length > 0 ? kept : cut;
}

/**
 * The right-hand panel: a tinted card from the column's top to the foot of the safe area, its
 * label in the accent's small capitals and its statement set large, centred in the card.
 */
function sidePanel(
  label: string,
  statement: RichDoc,
  top: number,
  x: number,
  w: number,
  t: Theme,
  ids: Ids,
  weight = 600,
  textName = PANEL_TEXT_NAME,
): SlideElement[] | undefined {
  const measure = measureHeadless(t);
  const pad = w < 360 ? SPACE[3] : SPACE[5];
  const inner = w - pad * 2;
  const labelH = Math.ceil(t.sizes.caption * t.lineHeights.caption);
  const h = SAFE_BOTTOM - top;
  for (const size of [
    Math.round(t.sizes.heading * 0.9),
    resolveFontSize(t, "body"),
    floorBelow(t, "body"),
  ]) {
    const style = { preset: "body" as const, fontSize: size, fontWeight: weight, lineHeight: 1.3 };
    const sh = heightOf(measure, statement, inner, "body", size, 0, style);
    const block = labelH + SPACE[2] + sh;
    if (block > h - pad * 2) continue;
    const y0 = snapY(top + (h - block) / 2);
    return [
      {
        id: ids(),
        type: "shape",
        shape: "rounded",
        x,
        y: top,
        w,
        h,
        fill: accentTint(t),
        radius: t.radius,
        name: PANEL_NAME,
      },
      text(
        ids,
        { x: x + pad, y: y0, w: inner, h: labelH },
        docFromText(label.toUpperCase()),
        { preset: "caption", color: t.colors.accent, fontWeight: 700, autoHeight: false },
        { name: PANEL_LABEL_NAME },
      ),
      text(
        ids,
        { x: x + pad, y: y0 + labelH + SPACE[2], w: inner, h: sh },
        statement,
        { ...style, color: t.colors.ink },
        { name: textName },
      ),
    ];
  }
  return undefined;
}
