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
import { docFromText, uid } from "./factories";
import { fitSlide } from "./fit-slide";
import { SAFE, SPACE, snapY } from "./grid";
import { SAFE_BOTTOM, withSafety } from "./metrics";
import { ANSWERS_NAME, HEADING_NAME, isBackdrop } from "./reflow";
import { joinSentences, sentences } from "./sentences";
import { measureHeadless } from "./text-measure";
import { floorBelow, resolveFontSize } from "./text-style";

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
  quiz?: QuizLine[];
  compare?: { left: CompareSide; right: CompareSide };
  keyCard?: { label: string; text: string };
  /** A process or method in order: 2–4 short steps. */
  sequence?: string[];
  /** The lesson's vocabulary, picked out in running text. */
  terms?: string[];
};

/* ---------------------------------------------------------------- text helpers */

const inline = (n: RichNode): string =>
  n.type === "text" ? (n.text ?? "") : (n.content ?? []).map(inline).join("");

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
  for (const size of sizesFor(t, "body")) {
    const noteSize = resolveFontSize(t, "small");
    const parts = [left, right].map((side) => {
      const note = side.note
        ? heightOf(measure, docFromText(side.note), inner, "small", noteSize)
        : 0;
      const body = heightOf(measure, bulletDoc(side.points), inner, "body", size);
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
          {
            preset: "body",
            fontSize: size,
          },
          { name: BODY_NAME },
        ),
      );
    });
    return { elements: els, bottom: top + h };
  }
  return undefined;
}

/* ---------------------------------------------------------------- steps strip */

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
  const arrow = SPACE[5];
  const w = Math.floor((SAFE.w - arrow * (n - 1)) / n);
  const inner = w - CARD_PAD * 2;
  const disc = 26;
  for (const size of sizesFor(t, "small")) {
    const hs = steps.map((s) => heightOf(measure, docFromText(s), inner, "small", size));
    const h = CARD_PAD + disc + SPACE[1] + Math.max(...hs) + CARD_PAD;
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
          { x: x + CARD_PAD, y: top + CARD_PAD, w: disc, h: disc },
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
          { x: x + CARD_PAD, y: top + CARD_PAD + disc + SPACE[1], w: inner, h: hs[i] ?? 0 },
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
      if (seen.has(key)) continue;
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
      [OPTION_CHIP_NAME, COMPARE_NAME, STEP_NAME, KEY_CARD_NAME].includes(e.name ?? ""),
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
  if (heading && slide.elements.some((e) => e.name === DIAGRAM_SLOT)) {
    return structureDiagram(slide, t, hints, ids, paginate);
  }
  if (!heading || slide.elements.some((e) => e.type === "image")) return plain;
  const bodies = slide.elements.filter(
    (e): e is TextElement =>
      isText(e) && e.style.preset === "body" && (!e.name || e.name === LEAD_CARD),
  );
  if (bodies.length === 0) return plain;
  const top = Math.min(...bodies.map((b) => b.y));
  const words = bodies.map((b) => docText(b.doc)).join(" ");
  const explicit = hints.compare || hints.keyCard || hints.sequence;
  const inferred = explicit ? undefined : inferStructure(docText(heading.doc), words, hints.terms);
  const s: SlideStructure = explicit ? hints : (inferred?.structure ?? {});
  const restWords = explicit ? words : (inferred?.rest ?? words);
  const lead = explicit ? "" : (inferred?.lead ?? "");
  if (!s.compare && !s.keyCard && !s.sequence) {
    return paginate ? (splitParagraph(slide, bodies, t, ids, hints.terms) ?? plain) : plain;
  }

  const measure = measureHeadless(t);
  const keep = slide.elements.filter((e) => !bodies.includes(e as TextElement));
  // Three settings, loosest first: the rest at the body size, the rest a step down (UX ruling 91),
  // then a key card's statement at the body size too. The first that fits the slide wins.
  let last: { els: SlideElement[]; restAt: number; size: number } | undefined;
  const levels = [
    [resolveFontSize(t, "body"), false, false],
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
      const h = heightOf(measure, doc, SAFE.w, "body", size);
      els.push(
        text(
          ids,
          { x: SAFE.x, y, w: SAFE.w, h },
          doc,
          { preset: "body", fontSize: size },
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
      const h = heightOf(measure, doc, SAFE.w, "body", size);
      els.push(
        text(
          ids,
          { x: SAFE.x, y, w: SAFE.w, h },
          doc,
          { preset: "body", fontSize: size },
          { name: BODY_NAME },
        ),
      );
      y = snapY(y + h + SPACE[3]);
    };
    let placed: Placed | undefined;
    if (s.compare) {
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
    if (!restWords || s.sequence)
      return [withTerms({ ...slide, elements: [...keep, ...els] }, t, hints.terms)];
    const h = heightOf(measure, docFromText(restWords), SAFE.w, "body", size);
    if (fits(y + h)) {
      para(restWords);
      return [withTerms({ ...slide, elements: [...keep, ...els] }, t, hints.terms)];
    }
    last ??= { els, restAt: top, size };
  }
  // The words left over continue on the next slide; but a component never costs a slide the
  // plain text did not need, so a slide that fitted stays as it was.
  if (!last || !paginate || fitSlide(slide, t).overflow.length === 0) return plain;
  const doc = docFromText(restWords);
  const h = heightOf(measure, doc, SAFE.w, "body", resolveFontSize(t, "body"));
  const next = continued(
    slide,
    chromeOf(slide),
    [
      text(
        ids,
        { x: SAFE.x, y: last.restAt, w: SAFE.w, h },
        doc,
        { preset: "body" },
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
 * A teaching paragraph too long for the slide even a step below the body size: the sentences that
 * fit stay, the rest continue on the next slide at the body size (UX ruling 91). `undefined` when
 * it fits, or when it is not one plain paragraph.
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
  const measure = measureHeadless(t);
  const size = resolveFontSize(t, "body");
  // The size the fit engine reached: the split is for what it could not fit.
  const reached = body.style.fontSize ?? size;
  const h = (words: string) => heightOf(measure, docFromText(words), body.w, "body", reached);
  const all = sentences(docText(body.doc));
  if (all.length < 2 || fitSlide(slide, t).overflow.length === 0) return undefined;
  let n = all.length - 1;
  while (n > 1 && body.y + withSafety(h(joinSentences(all.slice(0, n)))) > SAFE_BOTTOM) n--;
  const part = (words: string, y: number): TextElement => {
    const doc = docFromText(words);
    return {
      ...body,
      id: ids(),
      y,
      h: heightOf(measure, doc, body.w, "body", size),
      doc,
      name: BODY_NAME,
      style: { ...body.style, fontSize: size },
    };
  };
  const keep = slide.elements.filter((e) => e !== body);
  const next = continued(slide, chromeOf(slide), [part(joinSentences(all.slice(n)), body.y)], ids);
  return [
    withTerms(
      { ...slide, elements: [...keep, part(joinSentences(all.slice(0, n)), body.y)] },
      t,
      terms,
    ),
    withTerms(next, t, terms),
  ];
}

const DIAGRAM_SLOT = "Diagram placeholder";

/**
 * A teaching slide with a diagram slot: the words keep the left column and the slot the right,
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
  const slot = slide.elements.find((e) => e.name === DIAGRAM_SLOT) as SlideElement;
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
  const top = first.y;
  const x = first.x;
  const w = Math.max(SPACE[7], Math.min(first.w, slot.x - SPACE[5] - x));
  const placedSlot = { ...slot, y: top, h: SAFE_BOTTOM - top } as SlideElement;
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
  if (fitSlide(asIs, t).overflow.length === 0 && columnFoot(asIs) <= SAFE_BOTTOM) {
    return [withTerms(asIs, t, hints.terms)];
  }
  const measure = measureHeadless(t);
  const words = bodies.map((b) => docText(b.doc)).join(" ");
  const keep = slide.elements.filter((e) => e !== slot && !bodies.includes(e as TextElement));
  const para = (words: string, size: number, width: number): TextElement => {
    const doc = docFromText(words);
    return text(
      ids,
      { x, y: top, w: width, h: heightOf(measure, doc, width, "body", size) },
      doc,
      { preset: "body", fontSize: size },
      { name: BODY_NAME },
    );
  };
  const body = resolveFontSize(t, "body");
  const floor = floorBelow(t, "body");
  for (const size of [body, floor]) {
    const p = para(words, size, w);
    if (top + withSafety(p.h) <= SAFE_BOTTOM) {
      return [withTerms({ ...slide, elements: [...keep, p, placedSlot] }, t, hints.terms)];
    }
  }
  const all = sentences(words);
  if (!paginate || all.length < 2) {
    return [
      withTerms(
        { ...slide, elements: [...keep, para(words, floor, w), placedSlot] },
        t,
        hints.terms,
      ),
    ];
  }
  let n = all.length - 1;
  while (
    n > 1 &&
    top + withSafety(para(joinSentences(all.slice(0, n)), floor, w).h) > SAFE_BOTTOM
  ) {
    n--;
  }
  const beside = para(joinSentences(all.slice(0, n)), floor, w);
  const next = continued(
    slide,
    chromeOf(slide),
    [para(joinSentences(all.slice(n)), body, SAFE.w)],
    ids,
  );
  return [
    withTerms({ ...slide, elements: [...keep, beside, placedSlot] }, t, hints.terms),
    withTerms(next, t, hints.terms),
  ];
}

/** Key terms on a teaching slide's running text (never its heading, and never a question). */
export function withTerms(slide: Slide, t: Theme, terms: string[] | undefined): Slide {
  if (!terms?.length) return slide;
  const seen = new Set<string>();
  const running = (e: SlideElement): e is TextElement =>
    isText(e) && e.style.preset === "body" && e.name !== QUESTION_NAME;
  return {
    ...slide,
    elements: slide.elements.map((e) =>
      running(e) ? { ...e, doc: markTerms(e.doc, terms, t, seen) } : e,
    ),
  };
}
