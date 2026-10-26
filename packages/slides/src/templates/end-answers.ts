/**
 * End-of-deck Answers slides behind a pupil-safe guard (UX rulings 190, 193, 201, 231, 240;
 * TEACH-191 part b). Gold: `ROOT/northstars-v13/answers/NOTES.md`, winner C "the ledger on the
 * paper", r2 (multi-slide, teacher-facing) and r3 (the guard).
 *
 * - The deck builder collects the practice and exit-ticket answers into groups, in deck order, each
 *   numbered 1..n like its source slide. Each group is one row band: a left rail with the group's
 *   red caps kicker (PRACTICE or EXIT TICKET) over the source slide's title, the answers to its
 *   right with the same ink badges, a hairline between groups. No cards, fields or shadows.
 * - Type starts at the age ceiling and steps down, never below the age's comfort body; leftover
 *   height spreads the gaps until the body is about 75% full. Over the max it splits, it never
 *   squeezes: whole groups first, then between answers, never one answer alone; every slide of a
 *   set is "Answers (n of N)" and there is no cap on the count.
 * - The guard slide reads only "Answers on the next slide" and never says who it is for.
 * - Painted parts go through the theme's surface roles (`chip:quiet` pill, `field-b` guard disc,
 *   `badge`, `rule`, `verdict-right` / `verdict-wrong` chips); no literal colours.
 *
 * These slides are built by the deck, never written by the writer, so the id is not a writer
 * `TemplateId` (common acceptance 8: the live pack never names it).
 */
import {
  SHORT_ANSWER_WORDS,
  type Slide,
  type SlideElement,
  splitWorkingLine,
  TEACHER_ONLY_MARK,
  type Theme,
} from "@tj/domain/documents";
import { uid } from "../factories";
import { contrastRatio } from "../look";
import { countLines, lineWidth } from "../text-measure";
import { resolveFontSize, resolveTextStyle } from "../text-style";
import {
  paintSurface,
  type SurfaceRole,
  type SurfaceState,
  surfaceStyle,
  surfacesOf,
} from "../themes/surfaces";
import { type Ctx, G, kit, type Stage, templateScale } from "./index";

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

/**
 * A short answer or a sentence model answer (each with an optional working line in its own
 * column), or a true/false chip.
 */
export type AnswerItem =
  | { n: number; a: string; work?: string }
  | { n: number; s: string; work?: string }
  | { n: number; tf: boolean; why?: string };
export type AnswerGroup = { kind: "practice" | "exit"; title: string; items: AnswerItem[] };
/** One Answers slide: its groups (a carried-over group repeats its heading, numbers continue). */
export type AnswersPage = { groups: AnswerGroup[]; page: number; of: number };

/** The chrome's words, kept together for the locale table (TEACH-75 part an). */
export const ANSWERS_WORDS = {
  title: "Answers",
  page: (n: number, of: number) => `Answers (${n} of ${of})`,
  practice: "Practice",
  exit: "Exit ticket",
  teacherOnly: "Teacher only",
  guardTitle: "Answers on the next slide",
  guardLine: "Get ready to check your work.",
  yes: "True",
  no: "False",
} as const;

export const ANSWERS_NAMES = {
  kicker: "Kicker",
  source: "Source title",
  badge: "Badge",
  answer: "Answer",
  work: "Working",
  sentence: "Model answer",
  chip: "Verdict",
  why: "Correction",
  rule: "Rule",
  guardDisc: "Guard disc",
  guardTick: "Guard tick",
  guardTitle: "Heading",
  guardLine: "Guard line",
  hidden: "Hidden answer",
  cover: "Revealed",
} as const;

/* ------------------------------------------------------------------ */
/* Type: the age ceiling down to comfort (gold px / 1.5 on 960 x 540)  */
/* ------------------------------------------------------------------ */

/** Gold KS1 50 / 35, KS2 44 / 30, KS3 40 / 29 at 1440; comfort never under master's body floor 20. */
export const ANSWER_TYPE: Record<Stage, { top: number; comfort: number }> = {
  ks1: { top: 33, comfort: 23 },
  ks2: { top: 29, comfort: 20 },
  ks3: { top: 27, comfort: 20 },
  ks4: { top: 27, comfort: 20 },
  ks5: { top: 27, comfort: 20 },
};
/** The caption floor for the pill (gold label floor 22, or 26 at KS1). */
const labelSize = (t: Theme, stage: Stage) => px(t, stage === "ks1" ? 17 : 15);
/**
 * The group kicker is a caption, as the gold's red caps label (`answers-r2.html` `--kick-size`: 30px
 * at KS1, 26px over it, at 1440; 20 / 17 here): the theme's caption step at the key stage, caps
 * and tracked by the caption preset. Set as body it snapped up to the body step (28 at KS1), and
 * "EXIT TICKET" wrapped in the rail over the source title (ANSBUG a2).
 */
/**
 * The kicker as measured and as drawn, from one place: its preset (which gives the caps and the
 * tracking to both the measurer and the renderer), weight and line height.
 */
export const KICKER = { preset: "caption", weight: 700, lineHeight: 1.2 } as const;
const kickerSize = (t: Theme) => resolveFontSize(t, KICKER.preset);
/** The kicker's drawn height in the rail: every line it wraps to, never one assumed. */
export function kickerHeight(t: Theme, word: string): number {
  const size = kickerSize(t);
  const lines = countLines(word, KICKER.preset, t, RAIL.w, KICKER.weight, size);
  return Math.ceil(Math.max(1, lines) * size * KICKER.lineHeight);
}

/**
 * The size `size` is drawn at in `t`: a writer lesson's theme is bound to its key stage, and there
 * a body box's size snaps to the stage's steps (KS2 29 or 25, never 22), so every box is measured
 * and placed at the size the slide will show, never at the size asked for (TEACH-191 part d).
 */
const px = (t: Theme, size: number) => resolveFontSize(t, "body", size);

const BODY_TOP = 146;
const FOOT = 512;
const BODY_H = FOOT - BODY_TOP;
const RAIL = { x: G.margin, w: 190 } as const;
const ANS = { x: 301, w: G.right - 301 } as const;
const COL_GAP = 36;
const BADGE_GAP = 16;
const WORK_GAP = 21;
/** Gaps snap to the family's 8px scale at 1440 (about 5 points here). */
const snap = (v: number) => Math.max(4, Math.round(v / 5.33) * 5.33);
/** A short answer's column slack over its measured one-line width (with a third of a letter). */
export const SHORT_SLACK = 0.12;
/** Fill target: leftover height spreads the gaps until the body is about this full. */
const FILL = 0.75;

/* ------------------------------------------------------------------ */
/* Measuring                                                           */
/* ------------------------------------------------------------------ */

const plainItem = (it: AnswerItem): string =>
  "a" in it ? it.a : "s" in it ? it.s : it.tf ? ANSWERS_WORDS.yes : ANSWERS_WORDS.no;

/** One-line width of `text` at `size` and `weight` in the body face. */
function widthAt(t: Theme, text: string, size: number, weight: number): number {
  const r = resolveTextStyle({ preset: "body" }, t);
  return Math.ceil(((lineWidth(text, "body", t, weight) - 2 * r.padding) / r.fontSize) * size);
}

type Sized = { size: number; sub: number; badge: number; rowGap: number; groupGap: number };
const sizedAt = (t: Theme, asked: number, stage: Stage, spread = 1): Sized => {
  const size = px(t, asked);
  return {
    size,
    sub: px(t, Math.max(20, Math.round(size * 0.78))),
    badge: Math.round(size * 1.25),
    rowGap: snap(size * 0.6 * spread),
    groupGap: snap(size * 0.9 * spread) + (stage === "ks1" ? 2 : 0),
  };
};

/**
 * The columns rule (gold "Columns"): short answers up to 4 across, only as many as hold the
 * longest on one line at the age's top size; all on one row when they fit, 2x2 for 4; a row that
 * would leave one answer alone goes 1 per row. Worked answers, sentences and true/false with
 * corrections are 1 per row; bare true/false goes up to 4 across.
 */
export function answerColumns(t: Theme, stage: Stage, items: readonly AnswerItem[]): number {
  const n = items.length;
  if (n <= 1) return 1;
  const short = items.every((it) => ("a" in it && !it.work) || ("tf" in it && !it.why));
  if (!short) return 1;
  const top = sizedAt(t, ANSWER_TYPE[stage].top, stage);
  const widest = Math.max(
    ...items.map((it) =>
      "tf" in it ? chipWidth(t, top.size) : widthAt(t, plainItem(it), top.size, 700),
    ),
  );
  const cell = top.badge + BADGE_GAP + widest;
  let fit = 4;
  while (fit > 1 && fit * cell + (fit - 1) * COL_GAP > ANS.w) fit -= 1;
  if (n <= fit) return n;
  for (let c = fit; c >= 2; c--) if (n % c === 0) return c;
  for (let c = fit; c >= 2; c--) if (n % c !== 1) return c;
  // A short list goes 1 per row rather than leave one alone (KS1 "43 stickers": 1 column, not
  // 2 + 1); a long one keeps its columns.
  return n >= 5 ? fit : 1;
}

/** The verdict chip's label size: a label under the answer, never under the caption floor. */
const chipSize = (t: Theme, size: number) => px(t, Math.max(17, Math.round(size * 0.72)));
/** A chip's width round its own word; corrections line up after the wider "False" chip. */
const chipWidth = (t: Theme, size: number, yes = false) => {
  const k = chipSize(t, size);
  const word = yes ? ANSWERS_WORDS.yes : ANSWERS_WORDS.no;
  return Math.round(k * 0.62 + k * 0.9 + k * 0.38 + widthAt(t, word, k, 700) + k * 0.78);
};

/** Each answer's reveal step (1-based), or none: every answer shown from the start. */
type StepOf = (item: number) => number | undefined;
type Laid = { h: number; draw: (y: number, stepOf?: StepOf) => void };

/** A group's band at `z`: the rail and the answers side by side, drawn from `y`. */
function groupBand(c: Ctx, stage: Stage, g: AnswerGroup, z: Sized): Laid {
  const t = c.t;
  const sub = z.sub;
  const railTitleH = measureAt(c, g.title, RAIL.w, sub, 500, 1.2);
  // The source title stacks under the kicker's measured lines, so a kicker that wraps pushes the
  // title down rather than printing over it.
  const kickH = kickerHeight(t, kickerWord(g));
  const railH = kickH + 6 + railTitleH;
  const cols = answerColumns(t, stage, g.items);
  const line = Math.round(z.size * 1.3);
  const lineH = Math.max(line, z.badge);
  const cellW = Math.floor((ANS.w - (cols - 1) * COL_GAP) / cols);
  const textX = z.badge + BADGE_GAP;
  const textW = cellW - textX;
  const worked = g.items.some((it) => !("tf" in it) && it.work);
  // A worked group's answer column: its widest short answer on one line with room to spare (a
  // measurer a few percent off must never wrap "10 crayons" onto the next row's line), at most
  // 45% of the cell. A sentence with working takes what its working's one line leaves (at least
  // that 45%), so the working keeps its own column beside it; a sentence without working keeps
  // the whole cell.
  const sentenceWorked = g.items.some((it) => "s" in it && it.work);
  const widestWork = Math.max(
    0,
    ...g.items.map((it) => ("tf" in it || !it.work ? 0 : widthAt(t, it.work, sub, 500) + 2)),
  );
  const answerW = !worked
    ? textW
    : sentenceWorked
      ? Math.max(Math.round(textW * 0.45), textW - WORK_GAP - widestWork)
      : Math.min(
          Math.round(textW * 0.45),
          Math.ceil(
            Math.max(...g.items.map((it) => ("a" in it ? widthAt(t, it.a, z.size, 700) : 0))) *
              (1 + SHORT_SLACK),
          ) + Math.round(z.size * 0.3),
        );
  const chipW = chipWidth(t, z.size);
  /** Each item's height in its cell. */
  const heights = g.items.map((it) => {
    if ("s" in it && !it.work) return Math.max(lineH, measureAt(c, it.s, textW, z.size, 500, 1.3));
    if ("tf" in it)
      return it.why
        ? Math.max(lineH, measureAt(c, it.why, textW - chipW - WORK_GAP, sub, 500, 1.25))
        : lineH;
    const sentence = "s" in it;
    const a = measureAt(c, sentence ? it.s : it.a, answerW, z.size, sentence ? 500 : 700, 1.3);
    const w = it.work ? measureAt(c, it.work, textW - answerW - WORK_GAP, sub, 500, 1.25) : 0;
    return Math.max(lineH, a, w);
  });
  const rows: number[] = [];
  for (let i = 0; i < heights.length; i += cols) rows.push(Math.max(...heights.slice(i, i + cols)));
  const ansH = rows.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1) * z.rowGap;
  const h = Math.max(railH, ansH);
  const draw = (y: number, stepOf: StepOf = () => undefined) => {
    kicker(c, kickerWord(g), y, kickH);
    text(c, g.title, { x: RAIL.x, y: y + kickH + 6, w: RAIL.w }, sub, 500, 1.2, {
      color: t.colors.ink,
      name: ANSWERS_NAMES.source,
    });
    let rowY = y;
    g.items.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const k = i % cols;
      if (k === 0 && i > 0) rowY += (rows[r - 1] ?? 0) + z.rowGap;
      const x = ANS.x + k * (cellW + COL_GAP);
      // The badge sits on the answer's first line.
      const by = rowY + Math.round((line - z.badge) / 2);
      badge(c, String(it.n), x, by, z.badge, z.size);
      const tx = x + textX;
      // Hidden until its step: the soft "?" disc on the answer's first line, then the answer over
      // a ground patch that covers the disc. Nothing moves when it appears.
      const step = stepOf(i);
      if (step !== undefined) hiddenDisc(c, tx, by, z.badge, step);
      const from = c.els.length;
      if ("s" in it && !it.work) {
        text(c, it.s, { x: tx, y: rowY, w: textW }, z.size, 500, 1.3, {
          color: t.colors.ink,
          name: ANSWERS_NAMES.sentence,
        });
      } else if ("tf" in it) {
        const ch = Math.round(chipSize(t, z.size) * 1.6);
        const cw = chipWidth(t, z.size, it.tf);
        chip(c, it.tf, { x: tx, y: rowY + Math.round((line - ch) / 2), w: cw, h: ch }, z.size);
        if (it.why)
          text(
            c,
            it.why,
            {
              x: tx + chipW + WORK_GAP,
              y: rowY + Math.round((line - sub * 1.25) / 2),
              w: textW - chipW - WORK_GAP,
            },
            sub,
            500,
            1.25,
            { color: t.colors.muted, name: ANSWERS_NAMES.why },
          );
      } else {
        const sentence = "s" in it;
        text(
          c,
          sentence ? it.s : it.a,
          { x: tx, y: rowY, w: answerW },
          z.size,
          sentence ? 500 : 700,
          1.3,
          {
            color: t.colors.ink,
            name: sentence ? ANSWERS_NAMES.sentence : ANSWERS_NAMES.answer,
          },
        );
        if (it.work)
          text(
            c,
            it.work,
            {
              x: tx + answerW + WORK_GAP,
              y: rowY + Math.round((line - sub * 1.25) / 2),
              w: textW - answerW - WORK_GAP,
            },
            sub,
            500,
            1.25,
            { color: t.colors.muted, name: ANSWERS_NAMES.work },
          );
      }
      if (step !== undefined) for (const e of c.els.slice(from)) e.revealStep = step;
    });
  };
  return { h, draw };
}

/** The group's red caps kicker, a caption-preset box `h` tall (`kickerHeight`). */
function kicker(c: Ctx, word: string, y: number, h: number) {
  const el = kit.text(
    c,
    word,
    "body",
    { x: RAIL.x, y, w: RAIL.w },
    {
      color: c.t.colors.accent,
      weight: KICKER.weight,
      name: ANSWERS_NAMES.kicker,
    },
  );
  el.h = h;
  el.style = {
    ...el.style,
    preset: KICKER.preset,
    fontSize: kickerSize(c.t),
    lineHeight: KICKER.lineHeight,
  };
  return el;
}

const kickerWord = (g: AnswerGroup) =>
  (g.kind === "exit" ? ANSWERS_WORDS.exit : ANSWERS_WORDS.practice).toUpperCase();

function measureAt(c: Ctx, value: string, w: number, asked: number, weight: number, lh: number) {
  const size = px(c.t, asked);
  const s = c.s;
  c.s = { ...s, body: size };
  const lines = Math.round(kit.measure(c, value, "body", w, weight) / (size * kit.LH.body));
  c.s = s;
  return Math.ceil(Math.max(1, lines) * size * lh);
}

function text(
  c: Ctx,
  value: string,
  rect: { x: number; y: number; w: number },
  asked: number,
  weight: number,
  lh: number,
  extra: { color: string; name: string; align?: "left" | "center" },
) {
  const size = px(c.t, asked);
  const s = c.s;
  c.s = { ...s, body: size };
  const el = kit.text(c, value, "body", rect, {
    color: extra.color,
    weight,
    name: extra.name,
    ...(extra.align ? { align: extra.align } : {}),
  });
  c.s = s;
  el.h = measureAt(c, value, rect.w, size, weight, lh);
  el.style = { ...el.style, lineHeight: lh };
  return el;
}

/** A role painted under its content (`paintSurface`), named for the layers list and the checks. */
function surface(
  c: Ctx,
  role: SurfaceRole,
  box: { x: number; y: number; w: number; h: number },
  state?: SurfaceState,
  name?: string,
) {
  const el = paintSurface({ role, ...(state ? { state } : {}), box, id: uid() }, c.t);
  if (!el) return null;
  if (name) el.name = name;
  c.els.push(el);
  return el;
}

/** The theme's ink that reads best on `fill`. */
function inkOn(t: Theme, fill: string): string {
  const { onAccent, ink, surface: sf, background } = t.colors;
  return [onAccent, ink, sf, background].reduce((a, b) =>
    contrastRatio(b, fill) > contrastRatio(a, fill) ? b : a,
  );
}

function badge(c: Ctx, label: string, x: number, y: number, d: number, size: number) {
  const st = surfaceStyle(c.t, "badge");
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x,
    y: Math.round(y),
    w: d,
    h: d,
    fill: st.fill.slice(0, 7),
    name: "surface:badge",
    doc: kit.doc(label),
    textStyle: {
      preset: "body",
      fontSize: Math.max(14, Math.round(size * 0.55)),
      fontWeight: 700,
      color: st.ink ?? inkOn(c.t, st.fill.slice(0, 7)),
      align: "center",
      valign: "middle",
      padding: 0,
    },
  } as SlideElement);
}

function chip(
  c: Ctx,
  yes: boolean,
  box: { x: number; y: number; w: number; h: number },
  answerSize: number,
) {
  const size = chipSize(c.t, answerSize);
  const role: SurfaceRole = yes ? "verdict-right" : "verdict-wrong";
  const fill = surfaceStyle(c.t, role).fill.slice(0, 7);
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rounded",
    radius: Math.min(c.t.radius ?? 8, Math.round(size * 0.48)),
    ...box,
    fill,
    name: `surface:${role}`,
  } as SlideElement);
  const ink = inkOn(c.t, fill);
  const icon = Math.round(size * 0.9);
  const left = box.x + Math.round(size * 0.62);
  c.els.push({
    id: uid(),
    type: "icon",
    icon: yes ? "check" : "x",
    x: left,
    y: box.y + Math.round((box.h - icon) / 2),
    w: icon,
    h: icon,
    color: ink,
    strokeWidth: 2.5,
    name: ANSWERS_NAMES.chip,
  } as SlideElement);
  const tx = left + icon + Math.round(size * 0.38);
  text(
    c,
    yes ? ANSWERS_WORDS.yes : ANSWERS_WORDS.no,
    { x: tx, y: box.y + Math.round((box.h - size * 1.2) / 2), w: box.x + box.w - tx },
    size,
    700,
    1.2,
    { color: ink, name: ANSWERS_NAMES.chip },
  );
}

/** The approved soft "?" disc (sand on paper) and, at `step`, a ground patch that hides it. */
function hiddenDisc(c: Ctx, x: number, y: number, d: number, step: number) {
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "ellipse",
    x,
    y: Math.round(y),
    w: d,
    h: d,
    fill: surfaceStyle(c.t, "field-b").fill.slice(0, 7),
    name: ANSWERS_NAMES.hidden,
    doc: kit.doc("?"),
    textStyle: {
      preset: "body",
      fontSize: Math.max(14, Math.round(d * 0.56)),
      fontWeight: 700,
      color: c.t.colors.muted,
      align: "center",
      valign: "middle",
      padding: 0,
    },
  } as SlideElement);
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rect",
    x: x - 1,
    y: Math.round(y) - 1,
    w: d + 2,
    h: d + 2,
    fill: surfacesOf(c.t).ground.slice(0, 7),
    name: ANSWERS_NAMES.cover,
    revealStep: step,
  } as SlideElement);
}

/** The "Teacher only" pill on the title line: drawn for the teacher, never projected (r2 marker). */
function teacherPill(c: Ctx, stage: Stage, lineY: number) {
  const size = labelSize(c.t, stage);
  const label = ANSWERS_WORDS.teacherOnly;
  const icon = Math.round(size * 1.1);
  const w =
    Math.round(size * 0.9) * 2 + icon + 8 + Math.ceil(widthAt(c.t, label, size, 700) * 1.15);
  const h = Math.round(size * 1.85);
  const box = { x: G.right - w, y: Math.round(lineY - h / 2), w, h };
  const st = surfaceStyle(c.t, "chip", "quiet");
  surface(c, "chip", box, "quiet", TEACHER_ONLY_MARK);
  const ink = st.ink ?? c.t.colors.muted;
  c.els.push({
    id: uid(),
    type: "icon",
    icon: "eye-off",
    x: box.x + Math.round(size * 0.9),
    y: box.y + Math.round((h - icon) / 2),
    w: icon,
    h: icon,
    color: ink,
    strokeWidth: 2,
    name: TEACHER_ONLY_MARK,
  } as SlideElement);
  text(
    c,
    label,
    {
      x: box.x + Math.round(size * 0.9) + icon + 8,
      y: box.y + Math.round((h - size * 1.2) / 2),
      w: w,
    },
    size,
    700,
    1.2,
    { color: ink, name: TEACHER_ONLY_MARK },
  );
}

/* ------------------------------------------------------------------ */
/* Fit and pagination                                                  */
/* ------------------------------------------------------------------ */

function freshCtx(t: Theme, stage: Stage): Ctx {
  return { t, s: templateScale(t, stage), over: [], els: [] };
}

/** The page's body height at `z`: the bands plus a hairline gap between each two. */
function pageHeight(c: Ctx, stage: Stage, groups: readonly AnswerGroup[], z: Sized): number {
  const bands = groups.map((g) => groupBand(c, stage, g, z).h);
  return bands.reduce((a, b) => a + b, 0) + Math.max(0, bands.length - 1) * (2 * z.groupGap + 1);
}

/** The largest size from the ceiling down to comfort at which `groups` fit; undefined if none. */
export function answersSize(
  t: Theme,
  stage: Stage,
  groups: readonly AnswerGroup[],
): number | undefined {
  const c = freshCtx(t, stage);
  const { top, comfort } = ANSWER_TYPE[stage];
  let last: number | undefined;
  for (let asked = top; asked >= comfort; asked--) {
    const size = px(t, asked);
    if (size === last) continue;
    last = size;
    if (pageHeight(c, stage, groups, sizedAt(t, size, stage)) <= BODY_H) return size;
  }
  return undefined;
}

/** Under comfort: the largest size, down to 70% of it, at which a fixed page's groups fit. */
function squeezedSize(
  c: Ctx,
  t: Theme,
  stage: Stage,
  groups: readonly AnswerGroup[],
): number | undefined {
  const { comfort } = ANSWER_TYPE[stage];
  for (let asked = comfort - 1; asked >= Math.floor(comfort * 0.7); asked--) {
    const size = px(t, asked);
    if (size >= px(t, comfort)) continue;
    if (pageHeight(c, stage, groups, sizedAt(t, size, stage)) <= BODY_H) return size;
  }
  return undefined;
}

const fits = (t: Theme, stage: Stage, groups: readonly AnswerGroup[]) =>
  answersSize(t, stage, groups) !== undefined;

/**
 * Greedy pagination (gold r2 "Multi-slide"): whole groups first; a group that cannot share the
 * slide starts the next; a group too big for a slide alone splits between answers, never leaving
 * one answer alone on either side. Numbers carry on; the heading repeats on the continuation.
 */
export function paginateAnswers(
  t: Theme,
  stage: Stage,
  groups: readonly AnswerGroup[],
): AnswersPage[] {
  const pages: AnswerGroup[][] = [];
  let cur: AnswerGroup[] = [];
  const flush = () => {
    if (cur.length) pages.push(cur);
    cur = [];
  };
  for (const whole of groups) {
    let g: AnswerGroup = whole;
    while (g.items.length) {
      if (fits(t, stage, [...cur, g])) {
        cur.push(g);
        break;
      }
      // Whole groups first: a group that fits a slide alone moves on whole.
      if (cur.length && fits(t, stage, [g])) {
        flush();
        continue;
      }
      // Split inside the group: the most answers that fit here, leaving at least two behind.
      let k = g.items.length - 2;
      while (k >= 2 && !fits(t, stage, [...cur, { ...g, items: g.items.slice(0, k) }])) k--;
      if (k < 2) {
        if (cur.length) {
          flush();
          continue;
        }
        // Even two answers overflow an empty slide: keep it whole and let the page mark it over.
        cur.push(g);
        break;
      }
      cur.push({ ...g, items: g.items.slice(0, k) });
      flush();
      g = { ...g, items: g.items.slice(k) };
    }
  }
  flush();
  return pages.map((p, i) => ({ groups: p, page: i + 1, of: pages.length }));
}

/* ------------------------------------------------------------------ */
/* Slides                                                              */
/* ------------------------------------------------------------------ */

/** How an Answers slide reveals in present: all at once, a group per click, or an answer per click. */
export type AnswersReveal = "all" | "group" | "answer";
export type AnswersLayout = { slide: Slide; over: string[]; fill: number; size: number };

/** One Answers slide: the ledger at the largest size that fits, gaps spread to about 75% full. */
export function layoutAnswersPage(
  page: AnswersPage,
  t: Theme,
  stage: Stage,
  opts: {
    teacherOnly?: boolean;
    /** Gold `&reveal=`: answers start hidden and show a group or an answer per click; `all` shows them. */
    reveal?: AnswersReveal;
    /**
     * A page whose split is fixed (a stored page re-laid in another theme, TEACH-247 part am) that
     * does not fit at the comfort size steps on down until it does, rather than running off the
     * slide. The deck builder never passes it: it splits instead.
     */
    squeeze?: boolean;
  } = {},
): AnswersLayout {
  const reveal = opts.reveal ?? "group";
  let shown = 0;
  const c = freshCtx(t, stage);
  const title = page.of > 1 ? ANSWERS_WORDS.page(page.page, page.of) : ANSWERS_WORDS.title;
  const head = kit.heading(c, title);
  if (opts.teacherOnly !== false)
    teacherPill(c, stage, head.y + Math.round((c.s.heading * kit.LH.heading) / 2));
  const { comfort } = ANSWER_TYPE[stage];
  const size =
    answersSize(t, stage, page.groups) ??
    (opts.squeeze ? squeezedSize(c, t, stage, page.groups) : undefined) ??
    px(t, comfort);
  let z = sizedAt(t, size, stage);
  let h = pageHeight(c, stage, page.groups, z);
  if (h > BODY_H) c.over.push(`answers ${h}/${BODY_H}pt`);
  // Leftover height spreads the gaps (never past three times the plain gap) toward the fill target.
  for (let spread = 1.1; spread <= 3.001 && h < BODY_H * FILL; spread += 0.1) {
    const wider = sizedAt(t, size, stage, spread);
    const wh = pageHeight(c, stage, page.groups, wider);
    if (wh > BODY_H * FILL) break;
    z = wider;
    h = wh;
  }
  let y = BODY_TOP;
  page.groups.forEach((g, i) => {
    if (i > 0) {
      y += z.groupGap;
      surface(
        c,
        "rule",
        { x: G.margin, y: Math.round(y), w: G.width, h: 1 },
        undefined,
        ANSWERS_NAMES.rule,
      );
      y += 1 + z.groupGap;
    }
    const band = groupBand(c, stage, g, z);
    const base = shown;
    band.draw(
      Math.round(y),
      reveal === "all" ? undefined : reveal === "group" ? () => i + 1 : (k) => base + k + 1,
    );
    shown += g.items.length;
    y += band.h;
  });
  return {
    slide: { id: uid(), kind: "plenary", elements: c.els, answersRole: "answers" },
    over: c.over,
    fill: h / BODY_H,
    size,
  };
}

/** The guard (gold r3): a sand disc with a green tick, "Answers on the next slide", one muted line. */
export function layoutAnswersGuard(t: Theme, stage: Stage): AnswersLayout {
  const c = freshCtx(t, stage);
  const d = 133;
  const discY = 142;
  surface(
    c,
    "field-b",
    { x: 480 - d / 2, y: discY, w: d, h: d },
    undefined,
    ANSWERS_NAMES.guardDisc,
  );
  // A field-b with the theme's own corner is a square; the guard disc is always round.
  const disc = c.els[c.els.length - 1];
  if (disc && disc.type === "shape") {
    disc.shape = "ellipse";
    delete disc.radius;
  } else if (disc) {
    c.els[c.els.length - 1] = {
      id: disc.id,
      type: "shape",
      shape: "ellipse",
      x: disc.x,
      y: disc.y,
      w: d,
      h: d,
      fill: surfaceStyle(t, "field-b").fill.slice(0, 7),
      name: ANSWERS_NAMES.guardDisc,
      locked: true,
    } as SlideElement;
  }
  const tick = Math.round(d * 0.42);
  c.els.push({
    id: uid(),
    type: "icon",
    icon: "check",
    x: Math.round(480 - tick / 2),
    y: Math.round(discY + (d - tick) / 2),
    w: tick,
    h: tick,
    color: surfaceStyle(t, "verdict-right").fill.slice(0, 7),
    strokeWidth: 6,
    name: ANSWERS_NAMES.guardTick,
  } as SlideElement);
  const titleY = discY + d + 34;
  const s = c.s;
  const head = kit.text(
    c,
    ANSWERS_WORDS.guardTitle,
    "heading",
    { x: G.margin, y: titleY, w: G.width },
    { align: "center", name: ANSWERS_NAMES.guardTitle },
  );
  c.s = s;
  text(
    c,
    ANSWERS_WORDS.guardLine,
    { x: G.margin, y: head.y + head.h + 8, w: G.width },
    Math.max(20, Math.round(c.s.body * 0.95)),
    t.weights.body,
    1.3,
    { color: t.colors.muted, name: ANSWERS_NAMES.guardLine, align: "center" },
  );
  if (head.h > c.s.heading * kit.LH.heading * 1.5) c.over.push("guard title wraps");
  return {
    slide: { id: uid(), kind: "plenary", elements: c.els, answersRole: "guard" },
    over: c.over,
    fill: 1,
    size: c.s.heading,
  };
}

/* ------------------------------------------------------------------ */
/* Deck                                                                */
/* ------------------------------------------------------------------ */

/**
 * Whether the deck carries the guard and Answers slides: there must be answers to show (ruling
 * 231 keeps them off the practice and exit slides). A worksheet with its own answer key keeps them
 * too (ruling 260); the teacher turns them off in the editor.
 */
export function answersWanted(groups: readonly AnswerGroup[]) {
  return groups.some((g) => g.items.length > 0);
}

/**
 * The end of the deck: the guard, then every Answers slide (`answersRole` set), or nothing. A
 * group with a missing answer is dropped by the builder, never drawn as an empty row.
 */
export function endAnswerSlides(groups: readonly AnswerGroup[], t: Theme, stage: Stage): Slide[] {
  const kept = groups.filter((g) => g.items.length && g.items.every(answered));
  if (!answersWanted(kept)) return [];
  return [
    layoutAnswersGuard(t, stage).slide,
    ...paginateAnswers(t, stage, kept).map((p) => layoutAnswersPage(p, t, stage).slide),
  ];
}

const answered = (it: AnswerItem) =>
  "tf" in it ? typeof it.tf === "boolean" : "a" in it ? it.a.trim() !== "" : it.s.trim() !== "";

/**
 * One answer as the ledger's item: "True" / "False" (with an optional correction after a dash or
 * colon) as a chip, a short answer of at most four words bold, anything longer as a sentence model
 * answer; either keeps its working (the question's own `working` field) for its own column.
 * Lessons saved before the working had its own field join it after " — ": a short answer splits it
 * back off, and so does a sentence when what follows the dash is a calculation.
 */
/** A short answer (bold, with optional working) is at most this many words; longer is a sentence. */
export { SHORT_ANSWER_WORDS };
export function answerItem(n: number, raw: string, working?: string): AnswerItem {
  const v = raw.trim();
  const tf = /^(true|false)\b[\s.:,;–—-]*(.*)$/i.exec(v);
  if (tf) {
    const why = (tf[2] ?? "").trim();
    return { n, tf: (tf[1] as string).toLowerCase() === "true", ...(why ? { why } : {}) };
  }
  // The question's own working, or (a lesson saved with the two joined) the answer drawer's reading.
  const split = working?.trim() ? { answer: v, working } : splitWorkingLine(v);
  const a = split.answer.trim();
  const work = split.working?.trim();
  const short = words(a) <= SHORT_ANSWER_WORDS;
  if (work) return short ? { n, a, work } : { n, s: a, work };
  return short ? { n, a } : { n, s: a };
}
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * The groups as the ledger drew them before a sentence's working had its own column: the sentence
 * and its working on one line after " — ". The same groups when no sentence carries working. A
 * theme switch reads Answers slides built then as untouched, so it still rebuilds them.
 */
export function joinedAsBefore(groups: readonly AnswerGroup[]): readonly AnswerGroup[] {
  if (!groups.some((g) => g.items.some((it) => "s" in it && it.work))) return groups;
  return groups.map((g) => ({
    ...g,
    items: g.items.map((it) =>
      "s" in it && it.work ? { n: it.n, s: `${it.s} — ${it.work}` } : it,
    ),
  }));
}

/** The source slide's title: its heading element's words. */
function slideTitle(slide: Slide): string {
  const el = slide.elements.find((e) => e.type === "text" && e.name === "Heading");
  if (el?.type !== "text") return "";
  const walk = (n: unknown): string =>
    !n || typeof n !== "object"
      ? ""
      : "text" in n && typeof n.text === "string"
        ? n.text
        : "content" in n && Array.isArray(n.content)
          ? n.content.map(walk).join("")
          : "";
  return walk(el.doc).trim();
}

/**
 * The practice and exit-ticket answers of a deck, in deck order, as ledger groups: each slide whose
 * answer reveal is a numbered model answer (`listAnswers`). Answer slides already at the end are
 * skipped, so a rebuild never answers itself.
 */
export function answerGroupsOf(slides: readonly Slide[]): AnswerGroup[] {
  const out: AnswerGroup[] = [];
  for (const slide of slides) {
    if (slide.answersRole) continue;
    if (slide.kind !== "open-response" && slide.kind !== "exit-ticket") continue;
    const q = slide.question;
    if (q?.type !== "open-response" || !q.modelAnswer?.trim()) continue;
    // `working[i]` belongs to line i of the model answer, blank lines included (`listAnswers`).
    const lines = q.modelAnswer
      .split("\n")
      .map((l, i) => ({ l, w: q.working?.[i] }))
      .filter(({ l }) => l.trim());
    const items = lines.map(({ l, w }, i) => {
      const m = /^\s*(\d+)[.)]\s*(.*)$/.exec(l);
      return answerItem(m ? Number(m[1]) : i + 1, m ? (m[2] as string) : l, w);
    });
    if (items.some((it) => "a" in it && (it.a === "…" || it.a === ""))) continue;
    out.push({
      kind: slide.kind === "exit-ticket" ? "exit" : "practice",
      title: slideTitle(slide),
      items,
    });
  }
  return out;
}

/** One home for the projector view of a slide: `@tj/domain` (TEACH-191 part b). */
export { projected } from "@tj/domain/documents";
