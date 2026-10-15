/**
 * Practice (TEACH-230 part b, layout batch B2; rulings 108, 117, 141, 231): a calm "work alone"
 * slide, ported from the v13 gold (`northstars-v13/practice-exit`, signed off 15 Oct). 2-6 tasks
 * as an open grid on the paper, no card and no field: each task an ink badge under a hairline,
 * read across the rows. 2-3 tasks make one row of columns with the badge above the words; 4 make
 * a 2 x 2 grid; 5-6 go 3 across when every task is a bare calculation, else 2 across. With a
 * picture or figure, a white card on the left holds it and the tasks stack on the right.
 *
 * - No answers and no working space are drawn (ruling 231): the answers stay on `slide.question`
 *   for the end-of-deck Answers slides (TEACH-191 part b). `kind: "tf"` draws no answers either.
 * - The `where` line (the input's `instruction`) is kept in the data and never drawn (Greg, 15 Oct).
 * - Fit: the tasks start at the stage's body step (the age ceiling) and may take the one step under
 *   it (bodySmall), never lower; past that the slide is over. The body step is comfortable, the
 *   step under it `tight`. More than 6 tasks (4 with a visual) draws at the floor, over;
 *   `splitPractice` carries the extras onto a second practice slide.
 * - A picture that could not be made (`tile`), or a figure that draws nothing, shows a 4:3 card
 *   with the caption in the quote voice.
 *
 * Every size is in slide points (960 x 540): the gold's px at 1440 x 2/3.
 */
import type { ShapeElement, SlideElement } from "@tj/domain/documents";
import { uid } from "../factories";
import { resolveFontSize } from "../text-style";
import { v2Profile } from "../theme-v2";
import { keyStageOf, MIN_FONT_SIZE } from "../themes";
import { paintSurface, surfaceStyle } from "../themes/surfaces";
import {
  type Ctx,
  type FieldReport,
  type Figure,
  G,
  kit,
  listAnswers,
  type Stage,
  type TemplateInput,
} from "./index";
import CAPACITY from "./practice-capacity.json" with { type: "json" };

export type Age = "early" | "primary" | "secondary";
export const AGES: Record<Age, Stage> = { early: "ks1", primary: "ks2", secondary: "ks3" };
export const ageOf = (stage: Stage): Age =>
  stage === "ks1" ? "early" : stage === "ks2" ? "primary" : "secondary";

export const PRACTICE_MAX = 6;
export const PRACTICE_VISUAL_MAX = 4;
export const PRACTICE_MIN = 2;

/** The gold's geometry, px at 1440 x 2/3. */
export const WA = {
  foot: 497,
  practiceGap: 43,
  exitGap: 37,
  colGap: 48,
  badgeGap: 16,
  rowAfter: 21,
  visGap: 43,
  visPad: 15,
  visW: { early: 360, other: 373, min: 293 },
  rule: 1.5,
  /** The renderer's body line height (`LH.body`; a literal, as index imports this module). */
  measureLH: 1.4,
  /** At most 4 lines a task (6 when the badge sits above it). */
  lines: 4,
  linesOneRow: 6,
} as const;

/** Element names: the editor's layer list and the tests read them. */
export const WA_NAMES = {
  task: "Task",
  badge: "surface:badge",
  rule: "surface:rule",
  card: "surface:card",
  caption: "Caption",
  kicker: "Kicker",
  floor: "surface:field-b",
} as const;

/** `{a/b}` is written inline as a/b in this batch (the stacked form is Tech debt, as in B1). */
export const plainTask = (s: string) => s.replace(/\{(\d+)\/(\d+)\}/g, "$1/$2").trim();
/** A bare calculation (digits and operators only) stays on one line. */
export const isCalc = (s: string) => /\d/.test(s) && /^[\d,.\s+−×÷=\-?/()]+$/.test(plainTask(s));

/**
 * Comfortable, as the gold defines it: the task type stays at or above the age's comfortable body
 * size (v2 `comfort.body`, 30 px at KS2). Every step the repo's type scale allows sits above it,
 * so a slide that fits is comfortable; `tight` marks one drawn only past it.
 */
export const comfortAt = (c: Pick<Ctx, "t">, q: number) => q >= v2Profile(c.t).comfort.body;

/** A figure's caption: the gold's label size is under the floor; the smallest drawn step over it. */
const captionSize = (c: Pick<Ctx, "t">) => resolveFontSize(c.t, "body", MIN_FONT_SIZE.body);

/** The two sizes a task may take at the theme's stage: the body step, then bodySmall. */
export function taskSteps(c: Pick<Ctx, "t" | "s">): number[] {
  const top = resolveFontSize(c.t, "body", Math.max(c.s.body, MIN_FONT_SIZE.body));
  const low = Math.max(MIN_FONT_SIZE.body, resolveFontSize(c.t, "body", 1));
  return [...new Set([top, low])].sort((a, b) => b - a);
}

/** The badge's diameter: the age's badge, never smaller than its number's line. */
export function badgeSize(c: Ctx): number {
  const glyph = Math.max(c.s.small, MIN_FONT_SIZE.body);
  return Math.max(Math.round(v2Profile(c.t).badge), Math.ceil(glyph * 1.25));
}

/** The task's line height: the age profile's body leading (1.25 / 1.3), the gold's 1.26. */
export const taskLH = (c: Pick<Ctx, "t">) => v2Profile(c.t).lineHeights.body;
const linesAt = (c: Ctx, s: string, q: number, w: number) =>
  Math.round(
    kit.measure({ ...c, s: { ...c.s, body: q } }, plainTask(s), "body", w, 500) /
      (q * WA.measureLH),
  );
export const measureTask = (c: Ctx, s: string, q: number, w: number) =>
  Math.ceil(linesAt(c, s, q, w) * q * taskLH(c));
const taskOk = (c: Ctx, s: string, q: number, w: number, max: number) => {
  if (isCalc(s)) return linesAt(c, s, q, w) <= 1;
  return kit.wordsFit(c, plainTask(s), "body", w, q, 500) && linesAt(c, s, q, w) <= max;
};

/** Draws one task's words at size `q`. */
export function drawTask(c: Ctx, s: string, q: number, rect: { x: number; y: number; w: number }) {
  const saved = c.s;
  c.s = { ...saved, body: q };
  const el = kit.text(c, plainTask(s), "body", rect, { weight: 500, name: WA_NAMES.task });
  c.s = saved;
  el.style = { ...el.style, lineHeight: taskLH(c) };
  el.h = measureTask(c, s, q, rect.w);
  return el;
}

/** An ink badge with the task's number: the theme's `badge` role. */
export function drawBadge(c: Ctx, i: number, x: number, y: number, d: number) {
  const el = paintSurface(
    { role: "badge", box: { x, y: Math.round(y), w: d, h: d }, id: uid() },
    c.t,
  );
  if (!el) return;
  const ink = surfaceStyle(c.t, "badge").ink ?? c.t.colors.onAccent;
  const size = Math.max(c.s.small, MIN_FONT_SIZE.body);
  Object.assign(el, {
    locked: false,
    doc: kit.doc(String(i + 1)),
    textStyle: {
      preset: "body",
      fontSize: size,
      fontWeight: 700,
      color: ink,
      align: "center",
      valign: "middle",
      padding: 0,
    },
  } satisfies Partial<ShapeElement>);
  c.els.push(el);
}

/** A 2 px hairline in the theme's `rule` role. */
export function drawRule(c: Ctx, x: number, y: number, w: number) {
  const el = paintSurface(
    { role: "rule", box: { x, y: Math.round(y), w, h: WA.rule }, id: uid() },
    c.t,
  );
  if (el) c.els.push(el);
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

type Visual = { figure: Figure; failed: boolean; caption: string };
export type PracticePlan = {
  q: number;
  cols: number;
  visW: number;
  /** Fits at the body step. */
  comfortable: boolean;
  /** Fits at all (at the step under it). */
  fits: boolean;
  height: number;
};

const captionOf = (f: Figure | undefined): string => {
  if (!f) return "";
  if ("photo" in f) return (f.caption ?? f.alt ?? f.request ?? "").trim();
  if ("drawn" in f) return (f.drawn.alt ?? "").trim();
  const d = f.diagram as { title?: unknown; caption?: unknown } | null;
  return String(d?.caption ?? d?.title ?? "").trim();
};

function visualOf(c: Ctx, input: TemplateInput): Visual | null {
  const f = input.figure;
  if (!f) return null;
  let failed = Boolean(input.tile);
  // A figure that draws nothing (its data missing or unreadable) is a caption card, never lost:
  // tried once off the slide at the card's picture size, its reasons kept for the caller.
  if (!failed && !("photo" in f)) {
    const probe: Ctx = { ...c, els: [], fails: [] };
    failed = !kit.figurePanel(probe, f, { x: 0, y: 0, w: 343, h: 257 }, true);
    if (failed) c.fails?.push(...(probe.fails ?? []));
  }
  return { figure: f, failed, caption: captionOf(f) };
}

/** The column options the gold tries, in order. */
export function colOptions(items: string[]): number[] {
  const n = items.length;
  if (n <= 1) return [1];
  if (n <= 3) return [n, 1];
  if (n === 4) return [2];
  return items.every(isCalc) ? [3, 2] : [2, 3];
}

/** The grid's height at size `q` in `cols` columns, or null when a task breaks its line limit. */
function gridHeight(c: Ctx, items: string[], q: number, cols: number): number | null {
  const n = items.length;
  const oneRow = cols === n && n > 1;
  const b = badgeSize(c);
  const cellW = (G.width - (cols - 1) * WA.colGap) / cols;
  const textW = oneRow ? cellW : cellW - b - WA.badgeGap;
  const pad = Math.round(q * 0.7);
  const rowGap = Math.round(q * (n <= 3 ? 1.2 : 1.1));
  let h = 0;
  for (let r = 0; r * cols < n; r++) {
    let row = 0;
    for (const s of items.slice(r * cols, r * cols + cols)) {
      if (!taskOk(c, s, q, textW, oneRow ? WA.linesOneRow : WA.lines)) return null;
      const t = measureTask(c, s, q, textW);
      row = Math.max(row, oneRow ? b + WA.badgeGap + t : Math.max(b, t));
    }
    h += (r ? rowGap : 0) + WA.rule + pad + row;
  }
  return h + WA.rowAfter;
}

/** The stack's height beside a visual of width `visW`, or null when a task breaks its limit. */
function stackHeight(c: Ctx, items: string[], q: number, visW: number): number | null {
  const n = items.length;
  const b = badgeSize(c);
  const w = G.width - visW - WA.visGap - b - WA.badgeGap;
  const pad = Math.round(q * (n <= 3 ? 0.8 : 0.6));
  let h = 0;
  items.forEach((s, i) => {
    if (h < 0) return;
    if (!taskOk(c, s, q, w, WA.lines)) {
      h = -1;
      return;
    }
    h += (i ? WA.rule + pad : 0) + Math.max(b, measureTask(c, s, q, w)) + (i < n - 1 ? pad : 0);
  });
  return h < 0 ? null : h;
}

/** The visual card's height at width `visW` (a 4:3 picture, the figure's caption above it). */
function cardHeight(c: Ctx, v: Visual, visW: number): number {
  const inner = visW - 2 * WA.visPad;
  if (v.failed) return Math.round(visW * 0.75);
  const cap = "photo" in v.figure || !v.caption ? 0 : captionH(c, v.caption, inner) + 9;
  return Math.round(2 * WA.visPad + cap + inner * 0.75);
}
const captionH = (c: Ctx, s: string, w: number) =>
  kit.measure({ ...c, s: { ...c.s, body: captionSize(c) } }, s, "body", w, 500);

/**
 * The practice plan for the tasks under a stage starting at `stageTop`: the first column (and
 * card width) option that fits at the body step, else the best that fits at the step under it.
 */
export function planPractice(c: Ctx, input: TemplateInput, stageTop: number): PracticePlan {
  const items = (input.questions ?? []).filter(
    (s): s is string => typeof s === "string" && !!s.trim(),
  );
  const v = visualOf(c, input);
  const room = WA.foot - stageTop;
  const steps = taskSteps(c);
  const age = ageOf((keyStageOf(c.t) ?? "ks2") as Stage);
  const cols = v ? [1] : colOptions(items);
  const vis = v ? [age === "early" ? WA.visW.early : WA.visW.other, WA.visW.min] : [0];
  const tooMany = items.length > (v ? PRACTICE_VISUAL_MAX : PRACTICE_MAX);
  let best: PracticePlan | null = null;
  for (const col of cols)
    for (const visW of vis) {
      for (const q of steps) {
        const h = v ? stackHeight(c, items, q, visW) : gridHeight(c, items, q, col);
        const card = v ? cardHeight(c, v, visW) : 0;
        if (h === null || h > room || card > room) continue;
        const comfortable = comfortAt(c, q);
        if (!best || (!best.comfortable && q > best.q))
          best = { q, cols: col, visW, comfortable, fits: true, height: Math.max(h, card) };
        break;
      }
      if (best?.comfortable) break;
    }
  if (best && !tooMany) return best;
  const q = steps[steps.length - 1] as number;
  const col = cols[cols.length - 1] as number;
  const visW = vis[vis.length - 1] as number;
  const h = v
    ? (stackHeight(c, items, q, visW) ?? room + 1)
    : (gridHeight(c, items, q, col) ?? room + 1);
  return { q, cols: col, visW, comfortable: false, fits: false, height: h };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Draws the heading (left, or centred for the exit ticket) and returns its foot. */
export function workHeading(c: Ctx, input: TemplateInput, centre = false): number {
  const head = input.heading.trim();
  if (!head) return G.headY;
  const el = kit.heading(c, head);
  if (centre) el.style = { ...el.style, align: "center" };
  c.bodyFromHeading = true;
  return el.y + el.h;
}

export function layoutPractice(c: Ctx, input: TemplateInput) {
  const top = workHeading(c, input);
  const items = (input.questions ?? []).filter(
    (s): s is string => typeof s === "string" && !!s.trim(),
  );
  const v = visualOf(c, input);
  const stageTop = Math.round(top + WA.practiceGap);
  const plan = planPractice(c, input, stageTop);
  c.tight = !plan.comfortable;
  c.fields = practiceFields(input, ageOf((keyStageOf(c.t) ?? "ks2") as Stage), items, Boolean(v));
  const max = v ? PRACTICE_VISUAL_MAX : PRACTICE_MAX;
  if (items.length > max) c.over.push(`practice ${items.length}/${max} tasks`);
  else if (items.length && !plan.fits)
    c.over.push(`practice ${plan.height}/${WA.foot - stageTop}pt`);
  const q = plan.q;
  const b = badgeSize(c);
  if (v) {
    drawCard(c, v, { x: G.margin, y: stageTop, w: plan.visW });
    const x = G.margin + plan.visW + WA.visGap;
    const w = G.right - x;
    const pad = Math.round(q * (items.length <= 3 ? 0.8 : 0.6));
    let y = stageTop;
    items.forEach((s, i) => {
      if (i) {
        drawRule(c, x, y, w);
        y += WA.rule + pad;
      }
      const tw = w - b - WA.badgeGap;
      const th = measureTask(c, s, q, tw);
      drawBadge(c, i, x, y + Math.max(0, (q * taskLH(c) - b) / 2), b);
      drawTask(c, s, q, { x: x + b + WA.badgeGap, y, w: tw });
      y += Math.max(b, th) + pad;
    });
  } else {
    const n = items.length;
    const cols = plan.cols;
    const oneRow = cols === n && n > 1;
    const cellW = (G.width - (cols - 1) * WA.colGap) / cols;
    const pad = Math.round(q * 0.7);
    const rowGap = Math.round(q * (n <= 3 ? 1.2 : 1.1));
    let y = stageTop;
    for (let r = 0; r * cols < n; r++) {
      const row = items.slice(r * cols, r * cols + cols);
      let rowH = 0;
      row.forEach((s, k) => {
        const x = Math.round(G.margin + k * (cellW + WA.colGap));
        const i = r * cols + k;
        drawRule(c, x, y, Math.round(cellW));
        const ty = y + WA.rule + pad;
        if (oneRow) {
          drawBadge(c, i, x, ty, b);
          const el = drawTask(c, s, q, { x, y: ty + b + WA.badgeGap, w: Math.round(cellW) });
          rowH = Math.max(rowH, b + WA.badgeGap + el.h);
        } else {
          const tw = Math.round(cellW - b - WA.badgeGap);
          drawBadge(c, i, x, ty + Math.max(0, (q * taskLH(c) - b) / 2), b);
          const el = drawTask(c, s, q, { x: x + b + WA.badgeGap, y: ty, w: tw });
          rowH = Math.max(rowH, b, el.h);
        }
      });
      y += WA.rule + pad + rowH + rowGap;
    }
  }
  c.question = listAnswers(items, input.answers);
  if (!c.question) delete c.question;
}

/** The picture or figure in its white card; a failed one is a 4:3 caption card in the quote voice. */
function drawCard(c: Ctx, v: Visual, at: { x: number; y: number; w: number }) {
  const h = cardHeight(c, v, at.w);
  const rect = { ...at, h };
  const card = paintSurface({ role: "card", box: rect, own: cornersOf(c), id: uid() }, c.t);
  const inner = { x: at.x + WA.visPad, w: at.w - 2 * WA.visPad };
  const failedCard = () => {
    if (card) c.els.push(card);
    quoteCaption(c, v.caption || "Picture", rect);
  };
  if (v.failed) return failedCard();
  const mark = c.els.length;
  if (card) c.els.push(card);
  let y = at.y + WA.visPad;
  const f = v.figure;
  if (!("photo" in f) && v.caption) {
    const saved = c.s;
    c.s = { ...saved, body: captionSize(c) };
    const el = kit.text(
      c,
      v.caption,
      "body",
      { x: inner.x, y, w: inner.w },
      {
        weight: 500,
        color: c.t.colors.muted,
        name: WA_NAMES.caption,
      },
    );
    c.s = saved;
    y = el.y + el.h + 9;
  }
  const box = { x: inner.x, y, w: inner.w, h: Math.round(inner.w * 0.75) };
  if ("photo" in f) {
    kit.photoBox(c, f, box, true);
    return;
  }
  if (!kit.figurePanel(c, f, box, true)) {
    c.els.length = mark;
    // A figure whose data is missing draws nothing: the same caption card as a failed picture.
    const r = { ...at, h: Math.round(at.w * 0.75) };
    const k = paintSurface({ role: "card", box: r, own: cornersOf(c), id: uid() }, c.t);
    if (k) c.els.push(k);
    quoteCaption(c, v.caption || "Figure", r);
  }
}

const cornersOf = (c: Ctx) => {
  const r = Math.round(v2Profile(c.t).radius.bubble);
  return [r, r, r, r] as const;
};

/** The caption centred in the card, in the quote voice, a little over the body size. */
function quoteCaption(c: Ctx, words: string, rect: { x: number; y: number; w: number; h: number }) {
  const prof = v2Profile(c.t);
  const pad = 27;
  const w = rect.w - 2 * pad;
  const size = resolveFontSize(c.t, "body", Math.max(c.s.body, MIN_FONT_SIZE.body));
  const quoteCtx: Ctx = { ...c, t: { ...c.t, fonts: { ...c.t.fonts, body: prof.fonts.quote } } };
  const h = kit.measure({ ...quoteCtx, s: { ...c.s, body: size } }, words, "body", w, 500);
  const el = kit.text(
    { ...quoteCtx, s: { ...c.s, body: size } },
    words,
    "body",
    { x: rect.x + pad, y: rect.y + Math.max(pad, (rect.h - h) / 2), w },
    { weight: 500, align: "center", name: WA_NAMES.caption },
  );
  el.style = { ...el.style, fontFamily: prof.fonts.quote };
  if (prof.quoteStyle === "italic")
    el.doc = JSON.parse(
      JSON.stringify(el.doc).replace(
        /"type":"text",/g,
        '"type":"text","marks":[{"type":"italic"}],',
      ),
    );
}

/**
 * Which input path each element shows, in draw order (the editor's layout ref, TEACH-205 part b):
 * the heading and each task's words; badges, hairlines, cards and the kicker are not editable.
 */
export function workPaths(els: SlideElement[]): (string | undefined)[] {
  let k = 0;
  return els.map((e) =>
    e.name === "Heading" ? "heading" : e.name === WA_NAMES.task ? `questions.${k++}` : undefined,
  );
}

/* ------------------------------------------------------------------ */
/* Split and caps                                                      */
/* ------------------------------------------------------------------ */

/**
 * More than 6 tasks (4 with a picture or figure) carry over onto a second practice slide, never
 * squeezed onto one (rulings 141, 231). The visual stays with the first slide; the answers follow
 * their tasks. Returns the input alone when it fits the count.
 */
export function splitPractice(input: TemplateInput): TemplateInput[] {
  const qs = input.questions ?? [];
  const max = input.figure ? PRACTICE_VISUAL_MAX : PRACTICE_MAX;
  if (input.template !== "practice" || qs.length <= max) return [input];
  const out: TemplateInput[] = [];
  for (let i = 0, first = true; i < qs.length; first = false) {
    const take = first ? max : PRACTICE_MAX;
    // Never leave one task alone on the last slide: balance the last two.
    let n = Math.min(take, qs.length - i);
    const left = qs.length - i - n;
    if (left === 1 && n > PRACTICE_MIN) n -= 1;
    const part: TemplateInput = {
      ...input,
      questions: qs.slice(i, i + n),
      ...(input.answers ? { answers: input.answers.slice(i, i + n) } : {}),
    };
    if (!first) {
      delete part.figure;
      delete part.tile;
    }
    out.push(part);
    i += n;
  }
  return out;
}

/** One measured cap cell (`practice-capacity.json`): characters and words a task. */
export type WorkCap = { n: number; cap: number; hardMax: number; words: number; hardWords: number };
export type WorkVariant = "practice" | "practice+picture" | "practice+figure" | "exit";
let TABLE = CAPACITY as unknown as Record<Age, Partial<Record<WorkVariant, WorkCap[]>>>;
/** Lays out with no caps table, so the capacity script measures geometry alone. */
export function withoutCaps<T>(f: () => T): T {
  const kept = TABLE;
  TABLE = {} as typeof TABLE;
  try {
    return f();
  } finally {
    TABLE = kept;
  }
}
export function capOf(age: Age, variant: WorkVariant, n: number): WorkCap | undefined {
  return TABLE[age]?.[variant]?.find((c) => c.n === n);
}

/** Each task's counter against the measured caps (`questions.2`). */
export function workFields(
  age: Age,
  variant: WorkVariant,
  items: string[],
): FieldReport[] | undefined {
  const cap = capOf(age, variant, items.length);
  if (!cap) return undefined;
  return items.map((s, i) => {
    const chars = plainTask(s).length;
    return {
      field: `questions[${i}]`,
      path: `questions.${i}`,
      chars,
      cap: cap.cap,
      hardMax: cap.hardMax,
      tight: chars > cap.cap,
      over: chars > cap.hardMax,
    };
  });
}

function practiceFields(input: TemplateInput, age: Age, items: string[], visual: boolean) {
  const variant: WorkVariant = !visual
    ? "practice"
    : input.figure && "photo" in input.figure
      ? "practice+picture"
      : "practice+figure";
  return workFields(age, variant, items);
}
