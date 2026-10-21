/**
 * Source (TEACH-75 part ab, layout batch C2; rulings 122, 157, 226, 242): a verbatim extract on a
 * plain card with 2-4 short notes in the right margin, each pinned to the row where its phrase
 * ends. Ported from the v12 gold (`northstars-v12/source/NOTES.md`).
 *
 * - **The card** is the theme's card fill with a thin `rule` edge and no shadow. It hugs its
 *   content and sits centred in the room under the optional short title (ruling 242).
 * - **"Where it's from"** is one muted line at the top of the card.
 * - **The extract** is set in the theme's quote face (an A3 `font: "quote"` run) at 1.6 leading.
 *   It starts at the age's size and steps down 1 pt at a time to the age's floor; past the floor
 *   it is flagged (`over`), never clipped. Verse is one text box per line; a long verse line may
 *   borrow `BORROW` points of the notes margin before it wraps.
 * - **Notes:** each note is a bold accent label over a short ink line, its label centred on the
 *   row where its anchor **ends** (A3 `runRects`, the same wrap rule as `lineOfOffset`). Notes that
 *   would collide move down; a column that would overflow moves up as one. One straight join runs
 *   from just past the end of that row to just before the label.
 * - **Dropped in code (S-d4):** an anchor that is not a verbatim substring of the extract (or that
 *   spans a verse line break), an anchor ending on the same row as an earlier note's, and a note
 *   whose label would sit more than half a line off its row (the gold's `slant` rule).
 * - **Build:** click 0 shows the extract alone; each click adds one highlight, its join and its
 *   note, in note order. Hidden items keep their space, so nothing reflows.
 * - **Picture form:** one picture slot under the "from" line; the notes stack from its top with no
 *   joins. Without a picture the "from" words move into the card, centred in the quote face.
 *
 * Sizes are slide points (960 x 540): the gold's px at 1440 x 2/3.
 */
import {
  type LineElement,
  type RichDoc,
  type RunStyleAttrs,
  type ShapeElement,
  styledRun,
  type TextElement,
} from "@tj/domain/documents";
import { uid } from "../factories";
import { type RunRect, runRects } from "../text-lines";
import { countLines } from "../text-measure";
import { resolveFontSize } from "../text-style";
import { MIN_FONT_SIZE } from "../themes";
import { liveTokens, surfaceStyle } from "../themes/surfaces";
import { type Ctx, type FieldReport, kit, mix, type TemplateInput } from "./index";
import { type Age, v2Profile } from "./items-row-deps";
import CAPACITY from "./source-capacity.json" with { type: "json" };

export type SourceForm = "prose" | "verse" | "picture";
/** One note: the exact phrase it points at (none on a picture source), a ≤3-word label, ≤5 words. */
export type SourceNote = { anchor?: string; label: string; text: string };

export const SOURCE_MIN = 2;
export const SOURCE_MAX = 4;
/** Element names the editor binds and the tests read. */
export const SOURCE_NAMES = {
  card: "surface:card",
  from: "Source from",
  extract: "Extract",
  verse: "Extract line",
  highlight: "Highlight",
  join: "Note join",
  label: "Note label",
  text: "Note text",
  picture: "Source picture",
} as const;

/** Gold px x 2/3. */
const pt = (px: number) => Math.round((px * 2) / 3);
const CARD_X = pt(96);
const CARD_R = pt(14);
const CARD_W = pt(964) - CARD_X;
const PAD = pt(40);
const INNER_W = CARD_W - 2 * PAD;
const NOTES_X = pt(1012);
const NOTES_W = pt(1356) - NOTES_X;
const GAP = pt(16);
const BORROW = pt(48);
const LEAD = 1.6;
/** A wrapped verse line's turn hangs this far in (ems of the extract's size). */
const HANG_EM = 1.5;
const NOTE_LH = 1.25;
const TOP = pt(36);
const FOOT = pt(774);
const PIC = { w: pt(752), h: pt(520) };

type AgeSpec = { from: number; start: number; floor: number; note: number };
/** The gold's sizes in points; nothing under master's reading floor (`MIN_FONT_SIZE.body`). */
export function SOURCE_AGES(): Record<Age, AgeSpec> {
  const f = MIN_FONT_SIZE.body;
  const at = (from: number, start: number, floor: number, note: number): AgeSpec => ({
    from: Math.max(f, pt(from)),
    start: Math.max(f, pt(start)),
    floor: Math.max(f, pt(floor)),
    note: Math.max(f, pt(note)),
  });
  return {
    early: at(26, 44, 36, 36),
    primary: at(24, 40, 32, 32),
    secondary: at(24, 38, 30, 30),
  };
}

type Caps = Record<
  Age,
  {
    words: number;
    comfortWords: number;
    maxWords: number;
    lines: number;
    comfortLines: number;
    maxLines: number;
  }
>;
/** The caps (`source-capacity.json`): the gold's writer caps beside the renderer's measured ones. */
export const SOURCE_CAPS = CAPACITY as Caps;

const formOf = (input: TemplateInput): SourceForm =>
  input.form === "verse" || input.form === "picture" ? input.form : "prose";

/** The notes as given, each with its words trimmed (a string note reads as its text). */
export function sourceNotes(input: TemplateInput): SourceNote[] {
  return (Array.isArray(input.notes) ? input.notes : []).map((n0: unknown) => {
    const n = (n0 && typeof n0 === "object" ? n0 : { text: String(n0 ?? "") }) as SourceNote;
    return {
      ...(typeof n.anchor === "string" ? { anchor: n.anchor.trim() } : {}),
      label: String(n.label ?? "").trim(),
      text: String(n.text ?? "").trim(),
    };
  });
}

const ageOf = (c: Ctx): Age => v2Profile(c.t).age;
const quoteDoc = (s: string): RichDoc =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: s ? [styledRun(s, { font: "quote" })] : [] }],
  }) as RichDoc;
/** The same words with one phrase marked (highlight slot 1), for measuring where it sits. */
const markedDoc = (s: string, at: number, len: number): RichDoc =>
  ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          ...(at > 0 ? [styledRun(s.slice(0, at), { font: "quote" })] : []),
          styledRun(s.slice(at, at + len), { font: "quote", highlight: 1 }),
          ...(at + len < s.length ? [styledRun(s.slice(at + len), { font: "quote" })] : []),
        ],
      },
    ],
  }) as RichDoc;

/** The extract's style: the quote face at the gold's 500, 1.6 leading. */
const extractStyle = (size: number, color: string) => ({
  preset: "body" as const,
  autoHeight: true,
  fontSize: size,
  lineHeight: LEAD,
  fontWeight: 500,
  padding: 0,
  color,
});

/** `runRects` for an extract box at `size` (the quote face in its own advances, italic included). */
function rects(
  c: Ctx,
  d: RichDoc,
  w: number,
  size: number,
  pick: (a: RunStyleAttrs) => boolean,
): RunRect[] {
  return runRects(d, extractStyle(size, ""), c.t, { w, h: 4000 }, pick, size);
}

/** Where a line's first rendered row ends (its length when it is one row). */
function firstRowEnd(c: Ctx, s: string, w: number, size: number): number {
  const rr = rects(c, quoteDoc(s), w, size, () => true);
  if (!rr.some((r) => r.line > 0)) return s.length;
  // The words of row 0 are the prefix whose measured width the first rect spans: walk the words.
  let end = 0;
  for (const m of s.matchAll(/\S+/g)) {
    const to = (m.index ?? 0) + m[0].length;
    if (linesOf(c, s.slice(0, to), w, size) > 1) break;
    end = to;
  }
  return Math.max(end, 1);
}

const linesOf = (c: Ctx, s: string, w: number, size: number) =>
  s ? rects(c, quoteDoc(s), w, size, () => true).reduce((m, r) => Math.max(m, r.line + 1), 1) : 1;

/** The verse lines (the writer's `\n` breaks; never blank lines). */
const verseLines = (extract: string) =>
  extract
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

type Box = { text: string; x: number; y: number; w: number; h: number; start: number };

/** The extract's boxes at `size`: one for prose, one per line for verse (borrowing when long). */
function extractBoxes(
  c: Ctx,
  form: SourceForm,
  extract: string,
  size: number,
  x: number,
  y: number,
) {
  const lineH = size * LEAD;
  const out: Box[] = [];
  if (form === "verse") {
    let at = y;
    let start = 0;
    const all = extract.split("\n");
    for (const raw of all) {
      const text = raw.trimEnd();
      const here = start;
      start += raw.length + 1;
      if (!text.trim()) continue;
      // Every verse box may borrow the margin (a line set a hair wider than ruled stays one line);
      // the card widens only for a line the ruler finds past the card's own measure.
      const w = INNER_W + BORROW;
      // Past the borrow a line wraps with a hanging indent (the gold): its first row in one box,
      // the rest indented under it in another, so the turn reads as one verse line.
      const first = firstRowEnd(c, text, w, size);
      if (first < text.length) {
        const head = text.slice(0, first).trimEnd();
        const tail = text.slice(first).trimStart();
        out.push({ text: head, x, y: at, w, h: Math.ceil(lineH), start: here });
        at += Math.ceil(lineH);
        const hang = Math.round(size * HANG_EM);
        const th = Math.ceil(linesOf(c, tail, w - hang, size) * lineH);
        out.push({
          text: tail,
          x: x + hang,
          y: at,
          w: w - hang,
          h: th,
          start: here + text.indexOf(tail, first),
        });
        at += th;
        continue;
      }
      const h = Math.ceil(lineH);
      out.push({ text, x, y: at, w, h, start: here });
      at += h;
    }
    return out;
  }
  const text = extract.replace(/\s*\n\s*/g, " ").trim();
  // No words yet (a draft before the extract streams): no box, so no id to swap for verse lines.
  if (!text) return out;
  out.push({
    text,
    x,
    y,
    w: INNER_W,
    h: Math.ceil(linesOf(c, text, INNER_W, size) * lineH),
    start: 0,
  });
  return out;
}

const heightOf = (boxes: Box[]) => boxes.reduce((s, b) => s + b.h, 0);

/** The note block's height: a label line and the note's own lines, in the margin column. */
function noteHeight(c: Ctx, n: SourceNote, size: number) {
  const label = Math.ceil(size * NOTE_LH);
  const lines = n.text ? countLines(n.text, "body", c.t, NOTES_W, c.t.weights.body, size) : 0;
  return label + Math.ceil(lines * size * NOTE_LH);
}

type Pin = {
  note: SourceNote;
  k: number;
  box: Box;
  at: number;
  rects: { x: number; y: number; w: number; h: number }[];
  rowMid: number;
  rowEnd: number;
};

/**
 * Where each note's anchor sits: the boxes and rects of its phrase, its last row's middle and
 * that row's right end. Notes whose anchor is not verbatim, or that end on an earlier note's row,
 * are dropped (S-d4); `dropped` lists them by their 0-based place in `notes`.
 */
export function pinNotes(
  c: Ctx,
  boxes: Box[],
  notes: SourceNote[],
  size: number,
): { pins: Pin[]; dropped: number[] } {
  const pins: Pin[] = [];
  const dropped: number[] = [];
  notes.forEach((note, k) => {
    const a = note.anchor ?? "";
    const box = a && !a.includes("\n") ? boxes.find((b) => b.text.includes(a)) : undefined;
    if (!box) {
      dropped.push(k);
      return;
    }
    const at = box.text.indexOf(a);
    const rr = rects(c, markedDoc(box.text, at, a.length), box.w, size, (s) => s.highlight === 1);
    const last = rr[rr.length - 1];
    if (!last) {
      dropped.push(k);
      return;
    }
    const rowMid = Math.round(box.y + last.y + last.h / 2);
    if (pins.some((p) => Math.abs(p.rowMid - rowMid) < 2)) {
      dropped.push(k);
      return;
    }
    const row = rects(c, quoteDoc(box.text), box.w, size, () => true).filter(
      (r) => r.line === last.line,
    );
    const rowEnd = box.x + Math.max(...row.map((r) => r.x + r.w));
    pins.push({
      note,
      k,
      box,
      at,
      rects: rr.map((r) => ({ x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h })),
      rowMid,
      rowEnd,
    });
  });
  return { pins, dropped };
}

/** Each note block's top: centred on its row, pushed down past the one above, the column kept in. */
function stack(mids: number[], heights: number[], labelH: number, top: number, foot: number) {
  const tops: number[] = [];
  mids.forEach((m, i) => {
    const want = Math.round(m - labelH / 2);
    const prev = i > 0 ? (tops[i - 1] as number) + (heights[i - 1] as number) + GAP : top;
    tops.push(Math.max(want, prev, top));
  });
  const n = tops.length;
  const over = n ? (tops[n - 1] as number) + (heights[n - 1] as number) - foot : 0;
  if (over > 0) {
    const room = Math.max(0, (tops[0] as number) - top);
    const up = Math.min(over, room);
    for (let i = 0; i < n; i++) tops[i] = (tops[i] as number) - up;
  }
  return tops;
}

/** Lays the source into `c`: the optional title, the card, the extract, the notes and joins. */
export function layoutSource(c: Ctx, input: TemplateInput) {
  const form = formOf(input);
  const age = ageOf(c);
  const a0 = SOURCE_AGES()[age];
  const a = {
    ...a0,
    from: resolveFontSize(c.t, "body", a0.from),
    note: resolveFontSize(c.t, "body", a0.note),
  };
  const all = sourceNotes(input);
  if (all.length > SOURCE_MAX) c.over.push(`source notes ${all.length}/${SOURCE_MAX}`);
  if (all.length < SOURCE_MIN) c.over.push(`source notes ${all.length}/${SOURCE_MIN}`);
  const notes = all.slice(0, SOURCE_MAX);
  const ink = surfaceStyle(c.t, "card").ink ?? c.t.colors.ink;
  const cardFill = surfaceStyle(c.t, "card").fill;
  const fill = /^#[0-9a-f]{6}$/i.test(cardFill) ? cardFill : c.t.colors.surface;

  let top = TOP;
  const title = input.heading?.trim();
  if (title) {
    const el = kit.heading(c, title);
    top = el.y + el.h + pt(36);
  }
  c.bodyFromHeading = true;
  const room = FOOT - top;
  const fromText = (input.from ?? "").trim();
  const fromH = fromText
    ? Math.ceil(countLines(fromText, "body", c.t, INNER_W, 500, a.from) * a.from * NOTE_LH)
    : 0;
  const head = fromH ? fromH + GAP : 0;

  if (form === "picture") {
    pictureSource(c, input, notes, a, { top, room, fromText, fromH, head, ink, fill });
    c.fields = fieldsOf(input, notes, age, form);
    return;
  }

  // The extract steps down 1 pt at a time from the age's start size to its floor.
  const extract = input.extract ?? "";
  // Stored sizes are the stage's own steps (ruling 91, `resolveFontSize`): the gold's 1 pt steps
  // land on the body step and the one step under it, which is the floor here (never under 20).
  const steps = [
    ...new Set(
      Array.from({ length: a.start - MIN_FONT_SIZE.body + 1 }, (_, i) =>
        resolveFontSize(c.t, "body", a.start - i),
      ),
    ),
  ].sort((x, y) => y - x);
  const fits = (s: number) =>
    head + heightOf(extractBoxes(c, form, extract, s, 0, 0)) + 2 * PAD <= room;
  const size = steps.find(fits) ?? (steps[steps.length - 1] as number);
  if (!fits(size)) c.over.push(`source extract at the ${age} floor`);
  c.tight = size < (steps[0] as number);

  const probe = extractBoxes(c, form, extract, size, 0, 0);
  const cardH = 2 * PAD + head + heightOf(probe);
  const cardY = Math.round(top + Math.max(0, (room - cardH) / 2));
  const wide =
    form === "verse" &&
    probe.some((b) => b.h > size * LEAD || linesOf(c, b.text, INNER_W - pt(8), size) > 1);
  card(c, { x: CARD_X, y: cardY, w: CARD_W + (wide ? BORROW : 0), h: cardH }, fill);
  if (fromText)
    fromLine(c, fromText, { x: CARD_X + PAD, y: cardY + PAD, w: INNER_W }, a.from, false);
  const boxes = extractBoxes(c, form, extract, size, CARD_X + PAD, cardY + PAD + head);

  // Notes: pinned to their rows, then the slant rule drops the last until every label sits on
  // its row (the gold's `slant > 0.5 x line height`).
  let { pins } = pinNotes(c, boxes, notes, size);
  const labelH = Math.ceil(a.note * NOTE_LH);
  let tops: number[] = [];
  for (;;) {
    const heights = pins.map((p) => noteHeight(c, p.note, a.note));
    tops = stack(
      pins.map((p) => p.rowMid),
      heights,
      labelH,
      top,
      FOOT,
    );
    const slant = pins.findLastIndex(
      (p, i) => Math.abs((tops[i] as number) + labelH / 2 - p.rowMid) > (size * LEAD) / 2,
    );
    if (slant < 0) break;
    pins = pins.filter((_, i) => i !== pins.length - 1);
  }

  // Highlights first (behind the words), each from its own click.
  pins.forEach((p, i) => {
    for (const r of p.rects) highlight(c, r, size, i + 1);
  });
  const extractIds = boxes.map((b) => {
    const el: TextElement = {
      id: uid(),
      type: "text",
      name: form === "verse" ? SOURCE_NAMES.verse : SOURCE_NAMES.extract,
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.round(b.w),
      h: b.h,
      doc: quoteDoc(b.text),
      style: extractStyle(size, ink),
    };
    c.els.push(el);
    return el.id;
  });
  void extractIds;
  const joinColour = mix(c.t.colors.accent, fill, 0.6);
  pins.forEach((p, i) => {
    const labelMid = (tops[i] as number) + labelH / 2;
    join(
      c,
      { x: p.rowEnd + GAP, y: p.rowMid },
      { x: NOTES_X - GAP, y: labelMid },
      joinColour,
      i + 1,
    );
    noteBlock(c, p.note, tops[i] as number, a.note, ink, i + 1);
  });
  c.fields = fieldsOf(input, notes, age, form);
}

type PicCtx = {
  top: number;
  room: number;
  fromText: string;
  fromH: number;
  head: number;
  ink: string;
  fill: string;
};

/** A picture source: the picture under the "from" line, the notes stacked from its top. */
function pictureSource(c: Ctx, input: TemplateInput, notes: SourceNote[], a: AgeSpec, p: PicCtx) {
  const picH = Math.min(PIC.h, p.room - 2 * PAD - p.head);
  const picW = Math.min(INNER_W, Math.round((picH * PIC.w) / PIC.h));
  const cardH = 2 * PAD + p.head + picH;
  const cardY = Math.round(p.top + Math.max(0, (p.room - cardH) / 2));
  card(c, { x: CARD_X, y: cardY, w: CARD_W, h: cardH }, p.fill);
  const pic = {
    x: CARD_X + PAD + Math.round((INNER_W - picW) / 2),
    y: cardY + PAD + p.head,
    w: picW,
    h: picH,
  };
  const shown = input.figure ? kit.figurePanel(c, input.figure, pic) : false;
  if (shown) {
    const el = c.els[c.els.length - 1];
    if (el && el.type === "image") el.name = SOURCE_NAMES.picture;
    if (p.fromText)
      fromLine(c, p.fromText, { x: CARD_X + PAD, y: cardY + PAD, w: INNER_W }, a.from, false);
  } else if (p.fromText) {
    // Fallback: the "from" words in the card, centred in the quote face.
    const size = a.start;
    const h = Math.ceil(linesOf(c, p.fromText, INNER_W, size) * size * LEAD);
    c.els.push({
      id: uid(),
      type: "text",
      name: SOURCE_NAMES.from,
      x: CARD_X + PAD,
      y: Math.round(cardY + (cardH - h) / 2),
      w: INNER_W,
      h,
      doc: quoteDoc(p.fromText),
      style: { ...extractStyle(size, p.ink), align: "center" },
    } as TextElement);
  }
  // No anchors: the notes stack from the picture's top, with no joins.
  let y = pic.y;
  notes.forEach((n, i) => {
    noteBlock(c, n, y, a.note, p.ink, i + 1);
    y += noteHeight(c, n, a.note) + GAP;
  });
  if (y - GAP > FOOT) c.over.push("source notes past the foot");
}

function card(c: Ctx, box: { x: number; y: number; w: number; h: number }, fill: string) {
  // The gold's plain card: no shadow, a thin `rule` edge.
  const rule = liveTokens(c.t)?.rule ?? c.t.colors.line;
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rounded",
    name: SOURCE_NAMES.card,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    radius: CARD_R,
    fill,
    stroke: rule,
    strokeWidth: 1,
    locked: true,
  } as ShapeElement);
}

function fromLine(
  c: Ctx,
  value: string,
  rect: { x: number; y: number; w: number },
  size: number,
  _quote: boolean,
) {
  const lines = countLines(value, "body", c.t, rect.w, 500, size);
  c.els.push({
    id: uid(),
    type: "text",
    name: SOURCE_NAMES.from,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.ceil(lines * size * NOTE_LH),
    doc: kit.doc(value),
    style: {
      preset: "body",
      autoHeight: true,
      fontSize: size,
      lineHeight: NOTE_LH,
      fontWeight: 500,
      padding: 0,
      color: c.t.colors.muted,
    },
  } as TextElement);
}

/** The wash behind one line of a phrase: full line height, even, the theme's highlight slot. */
function highlight(
  c: Ctx,
  r: { x: number; y: number; w: number; h: number },
  size: number,
  step: number,
) {
  const fill = liveTokens(c.t)?.["hl-a"] ?? mix(c.t.colors.accent, c.t.colors.surface, 0.25);
  const h = Math.round(size * 1.3);
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rounded",
    name: SOURCE_NAMES.highlight,
    x: Math.round(r.x - pt(6)),
    y: Math.round(r.y + (r.h - h) / 2),
    w: Math.round(r.w + pt(12)),
    h,
    radius: pt(5),
    fill,
    revealStep: step,
  } as ShapeElement);
}

function join(
  c: Ctx,
  a: { x: number; y: number },
  b: { x: number; y: number },
  stroke: string,
  step: number,
) {
  if (b.x - a.x < pt(16)) return;
  const dy = b.y - a.y;
  const h = Math.max(2, Math.abs(dy));
  const y = Math.min(a.y, b.y) - (Math.abs(dy) < 2 ? 1 : 0);
  const fy = (v: number) => (h === 0 ? 0.5 : (v - y) / h);
  c.els.push({
    id: uid(),
    type: "line",
    name: SOURCE_NAMES.join,
    x: Math.round(a.x),
    y: Math.round(y),
    w: Math.round(b.x - a.x),
    h: Math.round(h),
    from: { x: 0, y: fy(a.y) },
    to: { x: 1, y: fy(b.y) },
    stroke,
    strokeWidth: 1.7,
    revealStep: step,
  } as LineElement);
}

function noteBlock(c: Ctx, n: SourceNote, top: number, size: number, ink: string, step: number) {
  const labelH = Math.ceil(size * NOTE_LH);
  const base = {
    preset: "body" as const,
    autoHeight: true,
    fontSize: size,
    lineHeight: NOTE_LH,
    padding: 0,
  };
  c.els.push({
    id: uid(),
    type: "text",
    name: SOURCE_NAMES.label,
    x: NOTES_X,
    y: Math.round(top),
    w: NOTES_W,
    h: labelH,
    doc: kit.doc(n.label),
    style: { ...base, fontWeight: 700, color: c.t.colors.accent },
    revealStep: step,
  } as TextElement);
  if (!n.text) return;
  const lines = countLines(n.text, "body", c.t, NOTES_W, c.t.weights.body, size);
  c.els.push({
    id: uid(),
    type: "text",
    name: SOURCE_NAMES.text,
    x: NOTES_X,
    y: Math.round(top + labelH),
    w: NOTES_W,
    h: Math.ceil(lines * size * NOTE_LH),
    doc: kit.doc(n.text),
    style: { ...base, color: ink },
    revealStep: step,
  } as TextElement);
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The live counters: "from", the extract (words; verse lines), and each note's label and text. */
function fieldsOf(
  input: TemplateInput,
  notes: SourceNote[],
  age: Age,
  form: SourceForm,
): FieldReport[] {
  const cap = SOURCE_CAPS[age];
  const f = (field: string, path: string, n: number, c0: number, max: number): FieldReport => ({
    field,
    path,
    chars: n,
    cap: c0,
    hardMax: max,
    tight: n > c0,
    over: n > max,
  });
  const out: FieldReport[] = [f("From", "from", words(input.from ?? ""), 12, 12)];
  if (form === "verse")
    out.push(
      f("Extract", "extract", verseLines(input.extract ?? "").length, cap.lines, cap.maxLines),
    );
  else if (form === "prose")
    out.push(f("Extract", "extract", words(input.extract ?? ""), cap.words, cap.maxWords));
  notes.forEach((n, k) => {
    out.push(f(`Note ${k + 1} label`, `notes.${k}.label`, words(n.label), 3, 3));
    out.push(f(`Note ${k + 1}`, `notes.${k}.text`, words(n.text), 5, 6));
  });
  return out;
}

/**
 * Which input path each laid element shows (the editor's LayoutRef): the title, "from", the
 * extract (prose), and each note's label and text in order.
 */
export function sourcePaths(els: { name?: string }[]): (string | undefined)[] {
  let label = -1;
  let text = -1;
  return els.map((el) => {
    if (el.name === "Heading") return "heading";
    if (el.name === SOURCE_NAMES.from) return "from";
    if (el.name === SOURCE_NAMES.extract) return "extract";
    if (el.name === SOURCE_NAMES.label) return `notes.${++label}.label`;
    if (el.name === SOURCE_NAMES.text) {
      text = label;
      return `notes.${text}.text`;
    }
    return undefined;
  });
}

/**
 * Over the cap: two slides split at a sentence (prose) or stanza (verse) boundary near the middle.
 * Each repeats `from` and carries only the notes whose anchor falls in its own part.
 */
export function splitSource(input: TemplateInput): [TemplateInput, TemplateInput] | null {
  const ex = input.extract ?? "";
  const form = formOf(input);
  if (form === "picture") return null;
  const cuts: number[] = [];
  if (form === "verse") {
    for (const m of ex.matchAll(/\n\s*\n/g)) cuts.push((m.index ?? 0) + m[0].length);
    if (!cuts.length) {
      let at = 0;
      for (const l of ex.split("\n")) {
        at += l.length + 1;
        cuts.push(at);
      }
      cuts.pop();
    }
  } else for (const m of ex.matchAll(/[.!?]["”’)]?\s+/g)) cuts.push((m.index ?? 0) + m[0].length);
  if (!cuts.length) return null;
  const mid = ex.length / 2;
  const cut = cuts.reduce((b, x) => (Math.abs(x - mid) < Math.abs(b - mid) ? x : b));
  const parts = [ex.slice(0, cut).trim(), ex.slice(cut).trim()];
  const notes = sourceNotes(input);
  const of = (p: string) => notes.filter((n) => n.anchor && p.includes(n.anchor));
  return parts.map((p) => ({ ...input, extract: p, notes: of(p) })) as [
    TemplateInput,
    TemplateInput,
  ];
}

export { verseLines };
