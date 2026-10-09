/**
 * Activity slide templates (TEACH-101 part b): pair, group sort, sequence, choose, odd one out and
 * label, on the same 960x540 grid, type scale and drawing kit as the other templates.
 *
 * Every activity is built from four shared pieces, so a new one (spot the mistake, always /
 * sometimes / never, a word-bank gap fill, a Frayer model, a ranking, a Venn sort) is a short
 * function over them:
 *
 * - **cards** (`cardGrid`, `drawCard`): one word or phrase under one single-subject picture slot,
 *   with an optional letter or number marker. The picture director fills slots one subject at a time.
 * - **groups** (`drawGroups`): labelled boxes beside the cards, each holding one answer gap.
 * - **order** (`shuffled` and the `LEAKS` checks): the question side is a seeded shuffle that is
 *   retried until it gives nothing away (no word under its own picture, no group sitting together,
 *   no sequence in order or reversed).
 * - **reveal**: the answer is always `slide.question`, one of the existing kinds (image-match,
 *   fill-gap, sort, multiple-choice), never an element, so present hides it until the reveal and
 *   the answer drawer and the exports read it the way they read every other question slide.
 *
 * Capacity: a text that does not fit its lines is marked over (`over`), never set smaller, so the
 * measured tables (`activity-capacity.ts`) are the most each slot holds at full size.
 */
import type {
  GapTextElement,
  ImageElement,
  QuestionData,
  RichDoc,
  ShapeElement,
  SlideElement,
  TextElement,
} from "@tj/domain/documents";
import { uid } from "../factories";
import { seededOrder } from "../layouts";
import { MIN_FONT_SIZE } from "../themes";
import { type Ctx, type Figure, G, kit, type Role, rangeBox, type TemplateInput } from "./index";

export const ACTIVITY_IDS = [
  "pair",
  "group-sort",
  "sequence",
  "choose",
  "odd-one-out",
  "label",
] as const;
export type ActivityId = (typeof ACTIVITY_IDS)[number];

/** One card: a word or short phrase and one single-subject picture slot. */
export type ActivityCard = {
  text: string;
  /** A photo (or an open slot, `photo: ""`) of one subject; a drawn diagram is allowed too. */
  figure?: Figure;
  /** Group sort: the index of the card's group in `groups`. */
  group?: number;
};

/** How many of each part a template takes (inclusive). */
export const ACTIVITY_LIMITS: Record<
  ActivityId,
  { cards?: [number, number]; groups?: [number, number]; targets?: [number, number] }
> = {
  pair: { cards: [3, 5] },
  "group-sort": { cards: [6, 8], groups: [2, 3] },
  sequence: { cards: [4, 6] },
  choose: { cards: [2, 4] },
  "odd-one-out": { cards: [3, 5] },
  label: { targets: [3, 6] },
};

type Rect = { x: number; y: number; w: number; h: number };
const GAP = 16;
/** The lowest an activity draws: the band's foot, clear of the theme's footer art. */
const foot = () => G.band.y + G.band.h;
const LETTER = (i: number) => String.fromCharCode(65 + i);

/* ------------------------------------------------------------------ */
/* Order: seeded shuffles that never give the answer away              */
/* ------------------------------------------------------------------ */

/** Each check answers "does this question-side order give the answer away?". */
export const LEAKS = {
  /** A word sits under its own picture (pair): every word must start elsewhere. */
  pair: (order: number[]) => order.some((v, i) => v === i),
  /** The cards are in order, reversed, or any card is already in its place. */
  sequence: (order: number[]) =>
    order.length > 1 &&
    (order.some((v, i) => v === i) || order.every((v, i) => v === order.length - 1 - i)),
  /** The options are in the order written (the writer tends to put the answer first). */
  choose: (order: number[]) => order.length > 1 && order.every((v, i) => v === i),
  /** Any group's cards (two or more) all sit side by side in the shown order. */
  groups: (shownGroups: number[]) => {
    const ids = [...new Set(shownGroups)];
    return ids.some((g) => {
      const at = shownGroups.flatMap((x, i) => (x === g ? [i] : []));
      if (at.length < 2) return false;
      return (at.at(-1) as number) - (at[0] as number) === at.length - 1;
    });
  },
  /** The word bank lists the words in the pointers' order. */
  bank: (bank: string[], answers: string[]) =>
    answers.length > 1 && answers.every((a, i) => bank[i] === a),
} as const;

/** A seeded order of 0..n-1 that passes `leak`; the seed is the slide's own words, so it is stable. */
export function shuffled(n: number, seed: string, leak: (order: number[]) => boolean): number[] {
  for (let k = 0; k < 64; k++) {
    const order = seededOrder(n, `${seed}#${k}`, false);
    if (!leak(order)) return order;
  }
  // Rotations pass every check above for n of 3 or more.
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

/** The caption role for a dense card: the scale's small step, never under the body floor. */
const denseRole = (c: Ctx): Role => (c.s.small >= MIN_FONT_SIZE.body ? "small" : "body");
const lineH = (c: Ctx, role: Role) => Math.ceil(c.s[role] * kit.LH[role]);

/** `n` equal cells in `cols` columns inside `r`, the last row centred. */
export function cardGrid(n: number, r: Rect, cols: number, gap = 12): Rect[] {
  const rows = Math.ceil(n / cols);
  const w = Math.floor((r.w - gap * (cols - 1)) / cols);
  const h = Math.floor((r.h - gap * (rows - 1)) / rows);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const x0 = r.x + Math.round((r.w - (inRow * w + (inRow - 1) * gap)) / 2);
    return { x: x0 + (i % cols) * (w + gap), y: r.y + row * (h + gap), w, h };
  });
}

/**
 * A card picture's shape range (#420 slot ranges, option A): the slot takes the photo's own shape
 * inside it, so the whole picture shows or it is trimmed round the judge's subject boxes, never cut
 * to a thin strip. An open slot takes the card's shape clamped to the range.
 */
export const CARD_RANGE = [0.75, 1.5] as const;

/**
 * The picture slot: a photo (shaped by `CARD_RANGE`), a drawn diagram (contained), or an open slot
 * the picture director fills later. Returns the element the slot drew.
 */
function picture(c: Ctx, item: ActivityCard, r: Rect): SlideElement | undefined {
  const f = item.figure;
  const before = c.els.length;
  if (f && "drawn" in f) {
    c.els.push({
      id: uid(),
      type: "image",
      name: "Diagram",
      ...r,
      src: f.drawn.src,
      alt: f.drawn.alt ?? item.text,
      fit: "contain",
    } as ImageElement);
  } else if (f && "diagram" in f) kit.figurePanel(c, f, r);
  else {
    const p = f && "photo" in f ? f : undefined;
    const box = rangeBox(r, p?.aspect ?? r.w / r.h, CARD_RANGE);
    kit.photoBox(
      c,
      {
        photo: p?.photo ?? "",
        alt: p?.alt ?? item.text,
        ...(p?.aspect ? { aspect: p.aspect } : {}),
        request: p?.request ?? item.text,
        ...(p?.subjects ? { subjects: p.subjects } : {}),
        ...(p?.source ? { source: p.source } : {}),
      },
      box,
      true,
    );
  }
  return c.els.slice(before).at(-1);
}

export type CardParts = {
  frame: ShapeElement;
  picture?: SlideElement;
  word?: TextElement;
  marker?: ShapeElement;
};

/** The card's marker disc: a little taller than one caption line, never over the picture. */
const stripDisc = (c: Ctx, role: Role) =>
  Math.min(kit.markerDisc(c), Math.round(lineH(c, role) * 1.1));

/** Draws a marker disc and returns it, named after its card so answer lists can quote it. */
function marker(c: Ctx, label: string, x: number, y: number, d: number, word: string) {
  kit.disc(c, label, x, y, d);
  const el = c.els.at(-1) as ShapeElement;
  if (word) el.name = `Marker: ${word}`;
  return el;
}

/**
 * A word-only card, the fallback when a card's picture could not be found or made: the same frame
 * and place, the word set large and centred, so the activity still works without a picture.
 */
export function wordCard(c: Ctx, value: string, r: Rect, what: string, label?: string): CardParts {
  const frame = kit.box(c, r, kit.wash(c.t), {
    stroke: c.t.colors.line,
    strokeWidth: 1,
    radius: Math.min(c.t.radius, 16),
    name: "Card",
  });
  const d = label ? stripDisc(c, "body") : 0;
  const w = r.w - 24;
  const role: Role = kit.measure(c, value, "lead", w, 700) <= r.h - 36 - d ? "lead" : "body";
  const h = kit.measure(c, value, role, w, 700);
  if (h > r.h - 24 - d) c.over.push(`${what} word ${Math.round(h / lineH(c, role))} lines`);
  if (!kit.wordsFit(c, value, role, w, c.s[role], 700)) c.over.push(`${what} word too wide`);
  const word = kit.text(
    c,
    value,
    role,
    { x: r.x + 12, y: r.y + Math.max(12, (r.h - d - h) / 2), w },
    { color: c.t.colors.ink, weight: 700, align: "center", name: "Card word" },
  );
  const m = label ? marker(c, label, r.x + (r.w - d) / 2, r.y + r.h - d - 8, d, value) : undefined;
  return { frame, word, ...(m ? { marker: m } : {}) };
}

/** The width `text` takes on one line in the lead face (step 4pt): the narrowest box it fits. */
function textWidth(c: Ctx, text: string): number {
  for (let w = 40; w < 800; w += 4)
    if (kit.measure(c, text, "lead", w, 700) <= lineH(c, "lead")) return w;
  return 800;
}

/** The most lines any of `words` takes at `role` in `w`. */
const rawLines = (c: Ctx, words: string[], role: Role, w: number) =>
  Math.round(Math.max(0, ...words.map((t) => kit.measure(c, t, role, w, 600))) / lineH(c, role));

/** The caption lines a row of cards needs (1 or 2); more than 2 is marked over by `drawCard`. */
export function captionLines(c: Ctx, words: string[], role: Role, w: number): number {
  return Math.min(2, Math.max(1, rawLines(c, words, role, w)));
}

/**
 * The caption role for a set of cards: `role` when every word fits two lines beside its marker,
 * else the scale's small step (never under the floor). Words longer still are marked over.
 */
function fitRole(c: Ctx, words: string[], role: Role, w: number): Role {
  const dense = denseRole(c);
  if (role === dense) return role;
  return rawLines(c, words, role, stripTextW(c, w, role, true)) <= 2 ? role : dense;
}

/** The caption strip's height: `lines` of the role, or the marker alone when there are no words. */
const stripH = (c: Ctx, role: Role, lines: number, withMarker: boolean) =>
  Math.max(lineH(c, role) * lines, withMarker ? stripDisc(c, role) : 0) + 16;

/** The words' width on a card strip with a marker at its left. */
const stripTextW = (c: Ctx, w: number, role: Role, withMarker: boolean) =>
  w - 16 - (withMarker ? stripDisc(c, role) + 6 : 0);

/**
 * A card: a framed picture slot over a label strip. The marker (a letter or number) sits at the
 * strip's left, never on the picture; with no words it sits in the strip's middle. The words get
 * `capLines` lines at `role`; more is marked over.
 */
export function drawCard(
  c: Ctx,
  item: ActivityCard,
  r: Rect,
  o: { marker?: string; role: Role; capLines: number; what: string },
): CardParts {
  if (!item.figure) return wordCard(c, item.text, r, o.what, o.marker);
  const pad = 8;
  const inset = 6;
  const hasWords = !!item.text.trim();
  const d = o.marker ? stripDisc(c, o.role) : 0;
  const capH = stripH(c, o.role, hasWords ? o.capLines : 0, !!o.marker);
  const frame = kit.box(c, r, c.t.colors.surface, {
    stroke: c.t.colors.line,
    strokeWidth: 1,
    radius: Math.min(c.t.radius, 16),
    name: "Card",
  });
  const pic = { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - capH - inset };
  if (pic.h < 60) c.over.push(`${o.what} picture ${Math.round(pic.h)}pt`);
  const drawn = picture(c, item, pic);
  const y0 = r.y + r.h - capH;
  const m = o.marker
    ? marker(
        c,
        o.marker,
        hasWords ? r.x + pad : r.x + (r.w - d) / 2,
        y0 + (capH - d) / 2,
        d,
        item.text,
      )
    : undefined;
  if (!hasWords)
    return { frame, ...(drawn ? { picture: drawn } : {}), ...(m ? { marker: m } : {}) };
  const x = r.x + pad + (d ? d + 6 : 0);
  const w = stripTextW(c, r.w, o.role, !!o.marker);
  const h = kit.measure(c, item.text, o.role, w, 600);
  if (h > lineH(c, o.role) * o.capLines + 1)
    c.over.push(`${o.what} word ${Math.round(h / lineH(c, o.role))} lines`);
  if (!kit.wordsFit(c, item.text, o.role, w, c.s[o.role], 600))
    c.over.push(`${o.what} word too wide`);
  const word = kit.text(
    c,
    item.text,
    o.role,
    { x, y: y0 + Math.max(pad, (capH - h) / 2), w },
    { color: c.t.colors.ink, weight: 600, align: "center", name: "Card word" },
  );
  return { frame, ...(drawn ? { picture: drawn } : {}), word, ...(m ? { marker: m } : {}) };
}

/** One row of `n` cards across `r`: a 4:3-ish picture over its strip, centred in the band. */
function cardRow(c: Ctx, n: number, r: Rect, capH: number): Rect[] {
  const w = Math.floor((r.w - GAP * (n - 1)) / n);
  const h = Math.min(r.h, Math.round((w - 12) / 1.25) + capH + 6);
  const y = r.y + Math.round((r.h - h) / 2);
  return Array.from({ length: n }, (_, i) => ({ x: r.x + i * (w + GAP), y, w, h }));
}

/** The row geometry for `cards`: the role, the caption lines, the strip height, the rects. */
function rowOf(c: Ctx, cards: ActivityCard[], area: Rect, preferred: Role) {
  const n = cards.length;
  const w = Math.floor((area.w - GAP * (n - 1)) / n);
  const words = cards.map((x) => x.text);
  const role = fitRole(c, words, preferred, w);
  const lines = captionLines(c, words, role, stripTextW(c, w, role, true));
  const rects = cardRow(c, n, area, stripH(c, role, lines, true));
  return { role, lines, rects };
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

/** Short group markers: the names' initials when they differ, else A, B, C. */
export function groupMarkers(names: string[]): string[] {
  const initials = names.map((n) => n.trim().charAt(0).toUpperCase());
  return new Set(initials).size === initials.length && initials.every(Boolean)
    ? initials
    : names.map((_, i) => LETTER(i));
}

/** A gap-text line: `label` in bold, then the gap; the answer stays in `question`. */
function gapLine(
  c: Ctx,
  label: string,
  gapId: string,
  r: { x: number; y: number; w: number },
  role: Role,
): GapTextElement {
  const runs = [
    ...(label ? [{ type: "text", text: label, marks: [{ type: "bold" }] }] : []),
    { type: "text", text: `${label ? "  " : ""}[[gap:${gapId}]]` },
  ];
  const el = {
    id: uid(),
    type: "gap-text",
    x: r.x,
    y: Math.round(r.y),
    w: r.w,
    h: lineH(c, role),
    name: "Answer gap",
    doc: { type: "doc", content: [{ type: "paragraph", content: runs }] } as RichDoc,
    style: {
      preset: "body",
      autoHeight: true,
      fontSize: c.s[role],
      lineHeight: kit.LH[role],
      fontWeight: c.t.weights.body,
      padding: 0,
      color: c.t.colors.ink,
    },
  } as GapTextElement;
  c.els.push(el);
  return el;
}

/** Labelled group boxes stacked in `r`, each with one gap; returns the gap ids in group order. */
export function drawGroups(c: Ctx, names: string[], r: Rect): string[] {
  const k = names.length;
  const h = Math.floor((r.h - 12 * (k - 1)) / k);
  const marks = groupMarkers(names);
  const head = lineH(c, "lead");
  const d = Math.min(kit.markerDisc(c), head);
  return names.map((name, g) => {
    const y = r.y + g * (h + 12);
    kit.box(c, { x: r.x, y, w: r.w, h }, kit.wash(c.t), {
      stroke: c.t.colors.line,
      strokeWidth: 1,
      radius: Math.min(c.t.radius, 16),
      name: "Group",
    });
    kit.disc(c, marks[g] ?? LETTER(g), r.x + 12, y + 6 + (head - d) / 2, d);
    const lw = r.w - d - 36;
    const lh = kit.measure(c, name, "lead", lw, 700);
    if (lh > lineH(c, "lead") + 1) c.over.push("group name 2 lines");
    kit.text(
      c,
      name,
      "lead",
      { x: r.x + d + 24, y: y + 6, w: lw },
      { weight: 700, color: c.t.colors.ink, name: "Group name" },
    );
    if (6 + head + 2 + lineH(c, "body") + 6 > h) c.over.push(`group box ${h}pt`);
    const id = uid();
    gapLine(c, "", id, { x: r.x + 16, y: y + 6 + head + 2, w: r.w - 32 }, "body");
    return id;
  });
}

/* ------------------------------------------------------------------ */
/* The templates                                                       */
/* ------------------------------------------------------------------ */

/** Heading, then the optional instruction line; returns the top of the activity's area. */
function intro(c: Ctx, input: TemplateInput): number {
  const h = kit.heading(c, input.heading);
  const lead = input.lead?.trim();
  if (!lead) return G.band.y;
  const el = kit.text(
    c,
    lead,
    "body",
    { x: G.margin, y: h.y + h.h + 6, w: G.width },
    { color: c.t.colors.muted, name: "Instruction" },
  );
  if (el.h > lineH(c, "body") + 1) c.over.push("instruction 2 lines");
  return Math.max(G.band.y, el.y + el.h + 18);
}

function counted(c: Ctx, what: string, n: number, range?: [number, number]) {
  if (range && (n < range[0] || n > range[1]))
    c.over.push(`${what} ${n}, takes ${range[0]}-${range[1]}`);
}

const seedOf = (input: TemplateInput) =>
  [input.heading, ...(input.cards ?? []).map((x) => x.text)].join("|");

function pair(c: Ctx, input: TemplateInput, area: Rect): QuestionData | undefined {
  const cards = input.cards ?? [];
  const n = cards.length;
  if (n === 0) return undefined;
  // order[slot] = the card whose word sits in that slot: never its own picture's slot.
  const order = shuffled(n, seedOf(input), LEAKS.pair);
  const w = Math.floor((area.w - GAP * (n - 1)) / n);
  const tw = w - 40;
  const wordAt = (slot: number, k: number) => `**${slot + 1}**  ${cards[k]?.text ?? ""}`;
  const tallest = Math.max(
    ...order.map((k, slot) => kit.measure(c, wordAt(slot, k), "body", tw, 600)),
  );
  const lines = Math.min(2, Math.max(1, Math.round(tallest / lineH(c, "body"))));
  if (tallest > lineH(c, "body") * 2 + 1)
    c.over.push(`pair word ${Math.round(tallest / lineH(c, "body"))} lines`);
  const wordH = lineH(c, "body") * lines + 24;
  // A card whose picture failed: every picture becomes its word on a lettered card, and the
  // answer is a matching question (word to word), so no slot is ever left asking for a picture.
  const wordsOnly = cards.some((x) => !x.figure);
  const picH = Math.min(
    Math.round((w - 12) / 1.25) + stripH(c, "body", 0, true) + 6,
    area.h - wordH - GAP,
  );
  const y0 = area.y + Math.round((area.h - (picH + GAP + wordH)) / 2);
  const pictures: SlideElement[] = [];
  cards.forEach((card, i) => {
    const r = { x: area.x + i * (w + GAP), y: y0, w, h: picH };
    // The letter sits on the card's strip under the picture, never on the picture itself.
    const parts = wordsOnly
      ? wordCard(c, card.text, r, "card", LETTER(i))
      : drawCard(c, { ...card, text: "" }, r, {
          marker: LETTER(i),
          role: "body",
          capLines: 0,
          what: "pair",
        });
    const el = wordsOnly ? parts.word : parts.picture;
    if (el) pictures[i] = el;
  });
  const words: TextElement[] = [];
  order.forEach((k, slot) => {
    const card = cards[k];
    if (!card) return;
    const x = area.x + slot * (w + GAP);
    const y = y0 + picH + GAP;
    kit.box(c, { x: x + 6, y, w: w - 12, h: wordH }, c.t.colors.surface, {
      stroke: c.t.colors.line,
      strokeWidth: 1.5,
      radius: Math.min(Math.round(wordH / 2), 28),
      name: "Word card",
    });
    const value = wordAt(slot, k);
    const h = kit.measure(c, value, "body", tw, 600);
    if (!kit.wordsFit(c, value, "body", tw, c.s.body, 600)) c.over.push("pair word too wide");
    const el = kit.text(
      c,
      value,
      "body",
      { x: x + 20, y: y + (wordH - h) / 2, w: tw },
      { color: c.t.colors.ink, weight: 600, align: "center", name: "Word" },
    );
    // The word box is the whole pill, its words centred: the reveal's answer card covers it all.
    el.x = x + 6;
    el.w = w - 12;
    el.y = Math.round(y + 2);
    el.h = Math.round(wordH - 4);
    el.style = { ...el.style, autoHeight: false, valign: "middle" };
    words[k] = el;
  });
  if (wordsOnly)
    return {
      type: "matching",
      pairs: cards.map((_, i) => ({
        id: uid(),
        leftElementId: (pictures[i] as SlideElement).id,
        rightElementId: (words[i] as TextElement).id,
      })),
    };
  if (pictures.some((p) => p?.type !== "image") || pictures.length < n) {
    c.over.push("pair pictures must be photos or drawn pictures");
    return undefined;
  }
  return {
    type: "image-match",
    pairs: cards.map((_, i) => ({
      id: uid(),
      imageId: (pictures[i] as SlideElement).id,
      labelId: (words[i] as TextElement).id,
    })),
  };
}

function groupSort(c: Ctx, input: TemplateInput, area: Rect): QuestionData | undefined {
  const cards = input.cards ?? [];
  const names = (input.groups ?? []).map((g) => g.trim()).filter(Boolean);
  counted(c, "groups", names.length, ACTIVITY_LIMITS["group-sort"].groups);
  if (!cards.length || !names.length) return undefined;
  if (cards.some((x) => !Number.isInteger(x.group) || (x.group as number) >= names.length))
    c.over.push("group sort card without a group");
  const order = shuffled(cards.length, seedOf(input), (o) =>
    LEAKS.groups(o.map((k) => cards[k]?.group ?? -1)),
  );
  // The group column is as wide as its longest name needs (one line), within 200-260.
  const nameW = Math.max(...names.map((n) => textWidth(c, n)));
  const colW = Math.min(260, Math.max(200, nameW + stripDisc(c, "lead") + 44));
  const grid = { x: area.x, y: area.y, w: area.w - colW - 16, h: area.h };
  const cols = cards.length <= 6 ? 3 : 4;
  const role = denseRole(c);
  const rects = cardGrid(cards.length, grid, cols, 10);
  const cw = rects[0]?.w ?? grid.w;
  const lines = captionLines(
    c,
    cards.map((x) => x.text),
    role,
    stripTextW(c, cw, role, true),
  );
  order.forEach((k, j) => {
    const r = rects[j];
    const card = cards[k];
    if (r && card)
      drawCard(c, card, r, { marker: String(j + 1), role, capLines: lines, what: "card" });
  });
  const gapIds = drawGroups(c, names, { x: area.x + area.w - colW, y: area.y, w: colW, h: area.h });
  return {
    type: "fill-gap",
    gaps: names.map((_, g) => ({
      id: gapIds[g] as string,
      answer: order
        .flatMap((k, j) => (cards[k]?.group === g ? [j + 1] : []))
        .sort((a, b) => a - b)
        .join(", "),
    })),
  };
}

function sequence(c: Ctx, input: TemplateInput, area: Rect): QuestionData | undefined {
  const cards = input.cards ?? [];
  if (!cards.length) return undefined;
  const order = shuffled(cards.length, seedOf(input), LEAKS.sequence);
  const role: Role = cards.length <= 4 ? "body" : denseRole(c);
  const { role: rowRole, lines, rects } = rowOf(c, cards, area, role);
  const targets: SlideElement[] = [];
  order.forEach((k, j) => {
    const r = rects[j];
    const card = cards[k];
    if (!r || !card) return;
    const parts = drawCard(c, card, r, {
      marker: LETTER(j),
      role: rowRole,
      capLines: lines,
      what: "sequence",
    });
    targets[k] = parts.marker ?? parts.frame;
  });
  // The right order, as the cards' marker ids: on the reveal each letter becomes its number.
  return { type: "sort", order: cards.map((_, k) => (targets[k] as SlideElement).id) };
}

function choose(c: Ctx, input: TemplateInput, area: Rect): QuestionData | undefined {
  const cards = input.cards ?? [];
  if (!cards.length) return undefined;
  const right = Number(input.correct);
  const ok = Number.isInteger(right) && right >= 1 && right <= cards.length;
  if (!ok) c.over.push(`${input.template}: no correct card`);
  const order = shuffled(cards.length, seedOf(input), LEAKS.choose);
  const role: Role = cards.length <= 4 ? "body" : denseRole(c);
  const { role: rowRole, lines, rects } = rowOf(c, cards, area, role);
  const options = order.flatMap((k, j) => {
    const r = rects[j];
    const card = cards[k];
    if (!r || !card) return [];
    const parts = drawCard(c, card, r, {
      marker: LETTER(j),
      role: rowRole,
      capLines: lines,
      what: "option",
    });
    return [{ id: parts.frame.id, correct: k === right - 1 }];
  });
  if (!ok) return undefined;
  return {
    type: "multiple-choice",
    options,
    ...(input.explanation?.trim() ? { explanation: input.explanation.trim() } : {}),
  };
}

/** Reading order: top to bottom in rows of about a tenth of the drawing, then left to right. */
const readingOrder = (ts: { x: number; y: number }[]) =>
  ts
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Math.round(a.t.y * 10) - Math.round(b.t.y * 10) || a.t.x - b.t.x)
    .map(({ i }) => i);

function label(c: Ctx, input: TemplateInput, area: Rect): QuestionData | undefined {
  const targets = (input.targets ?? []).filter((t) => t.text.trim());
  counted(c, "pointers", targets.length, ACTIVITY_LIMITS.label.targets);
  const f = input.figure;
  // A label activity is drawn diagrams only: a photo's parts cannot be pointed at reliably.
  const drawable = f && !("photo" in f) ? f : undefined;
  if (!drawable)
    c.over.push(
      f && "photo" in f ? "label: a photo, not a drawn diagram" : "label: no drawn diagram",
    );
  const panel = { x: area.x, y: area.y, w: 460, h: area.h };
  const before = c.els.length;
  const drew = drawable ? kit.figurePanel(c, drawable, panel) : false;
  const last = drew ? c.els.slice(before).at(-1) : undefined;
  const dr = last ?? { x: panel.x + 22, y: panel.y + 22, w: panel.w - 44, h: panel.h - 44 };
  const d = kit.markerDisc(c);
  const cx = dr.x + dr.w / 2;
  const cy = dr.y + dr.h / 2;
  const seq = readingOrder(targets);
  seq.forEach((ti, n) => {
    const t = targets[ti];
    if (!t) return;
    const px = dr.x + Math.min(1, Math.max(0, t.x)) * dr.w;
    const py = dr.y + Math.min(1, Math.max(0, t.y)) * dr.h;
    // Sideways to the nearer edge, a little up or down: a pointer never lands on another part.
    const vx = px <= cx ? -1 : 1;
    const vy = Math.abs(py - cy) < 4 ? 0 : 0.35 * Math.sign(py - cy);
    const k = Math.hypot(vx, vy);
    const reach = 46;
    const clampX = (x: number) =>
      Math.min(panel.x + panel.w - d / 2 - 4, Math.max(panel.x + d / 2 + 4, x));
    const clampY = (y: number) =>
      Math.min(panel.y + panel.h - d / 2 - 4, Math.max(panel.y + d / 2 + 4, y));
    const dx = clampX(px + (vx / k) * reach);
    const dy = clampY(py + (vy / k) * reach);
    c.els.push({
      id: uid(),
      type: "line",
      name: "Pointer",
      x: Math.round(Math.min(px, dx)),
      y: Math.round(Math.min(py, dy)),
      w: Math.max(1, Math.round(Math.abs(dx - px))),
      h: Math.max(1, Math.round(Math.abs(dy - py))),
      from: { x: px <= dx ? 0 : 1, y: py <= dy ? 0 : 1 },
      to: { x: px <= dx ? 1 : 0, y: py <= dy ? 1 : 0 },
      stroke: c.t.colors.ink,
      strokeWidth: 2,
    } as SlideElement);
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "ellipse",
      name: "Pointer dot",
      x: Math.round(px - 5),
      y: Math.round(py - 5),
      w: 10,
      h: 10,
      fill: c.t.colors.ink,
    } as ShapeElement);
    kit.disc(c, String(n + 1), dx - d / 2, dy - d / 2, d);
  });
  // The word bank: every wanted word and the extras, alphabetical (never the pointers' order).
  const answers = seq.map((i) => targets[i]?.text.trim() ?? "");
  let bank = [...answers, ...(input.extra ?? []).map((x) => x.trim()).filter(Boolean)].sort(
    (a, b) => a.localeCompare(b, "en", { sensitivity: "base" }),
  );
  if (LEAKS.bank(bank, answers)) bank = [...bank.slice(1), bank[0] as string];
  const x = panel.x + panel.w + 24;
  const w = G.right - x;
  const role = denseRole(c);
  const bankText = bank.join("   ·   ");
  const bankH = kit.measure(c, bankText, role, w - 32);
  kit.box(c, { x, y: area.y, w, h: bankH + 28 }, kit.wash(c.t), {
    stroke: c.t.colors.line,
    strokeWidth: 1,
    radius: Math.min(c.t.radius, 16),
    name: "Word bank",
  });
  kit.text(
    c,
    bankText,
    role,
    { x: x + 16, y: area.y + 14, w: w - 32 },
    { color: c.t.colors.ink, name: "Word bank words" },
  );
  let y = area.y + bankH + 28 + 18;
  const gaps = answers.map((answer, n) => {
    const id = uid();
    gapLine(c, String(n + 1), id, { x: x + 4, y, w: w - 4 }, role);
    y += lineH(c, role) + 6;
    return { id, answer };
  });
  if (y - 6 > foot()) c.over.push(`label column ${Math.round(y - 6 - area.y)}/${area.h}pt`);
  return gaps.length ? { type: "fill-gap", gaps } : undefined;
}

/** Lays an activity out into `c` and sets `c.question` to its answer. */
export function layoutActivity(c: Ctx, input: TemplateInput & { template: ActivityId }) {
  const top = intro(c, input);
  const area = { x: G.margin, y: top, w: G.width, h: foot() - top };
  const lim = ACTIVITY_LIMITS[input.template];
  if (lim.cards) counted(c, "cards", input.cards?.length ?? 0, lim.cards);
  const q =
    input.template === "pair"
      ? pair(c, input, area)
      : input.template === "group-sort"
        ? groupSort(c, input, area)
        : input.template === "sequence"
          ? sequence(c, input, area)
          : input.template === "label"
            ? label(c, input, area)
            : choose(c, input, area);
  if (q) c.question = q;
}
