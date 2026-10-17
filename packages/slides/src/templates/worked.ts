/**
 * Worked example (TEACH-17 part b, layout batch C1; rulings 91, 151, 223): a problem worked line by
 * line, one row per click. Ported from the v12 gold (`northstars-v12/worked/worked.js`, L1: d2 plain
 * base, d1 split with d2 arrows when a bar-model panel draws).
 *
 * - **Fields only:** `heading` (the problem, at most 8 words), `lines[] {move?, eq, answer?}`,
 *   `check?` (`*n*` marks the substituted value), `vars` (letters set as variables, default x) and
 *   `barPanel?` (the writer's `panel {model: algebra-bar|percent-bar, ...numbers}`). Every position
 *   is computed: the "=" column sits on the widest left side, the move arrows just right of the
 *   widest right side, rows share the height between row 1 and the check strip (at most 83 pt
 *   apart), and the type shrinks only when rows have to get closer.
 * - **Reveal:** row *i* (its badge, rail segment, move, equation and answer plate) is reveal step
 *   *i*; the check is the last step. Every worked example takes one click per row.
 * - **Panel:** a bar model (TEACH-75 part y) at panel size on a sand field; build *i* rides row *i*
 *   (TEACH-205 part c `buildFrom`). Its guard (`barPanelGuard`), or a frame count that is not the
 *   row count, falls back to the text-only base, which stands on its own.
 * - **Maths:** a hyphen used as a minus becomes U+2212, units sit on no-break spaces, `M_r` is
 *   written "Mr" (subscripts are tech debt), variables are set in the theme's quote face.
 *
 * Sizes are slide points (960 x 540): the gold's px at 1440 x 2/3.
 */
import {
  type ImageElement,
  type PathElement,
  type RichDoc,
  type RunStyleAttrs,
  type ShapeElement,
  styledRun,
  type TextElement,
} from "@tj/domain/documents";
import { barPanelFrames, barPanelGuard, barPanelSpec } from "../diagrams/bar-model";
import { withBuilds } from "../diagrams/builds";
import { buildCount, diagramElement, svgDataUrl, svgOfDataUrl } from "../diagrams/index";
import { uid } from "../factories";
import { arrowCubic } from "../paths/arrow";
import { countLines, lineWidth } from "../text-measure";
import { resolveFontSize, resolveTextStyle } from "../text-style";
import { ageProfileOf, v2Colors } from "../theme-v2";
import { notchPoints } from "../themes/marks";
import { markLook, paintSurface, surfaceStyle, surfacesOf } from "../themes/surfaces";
import type { Ctx, FieldReport, Stage, TemplateInput } from "./index";
import { kit } from "./index";
import CAPACITY from "./worked-capacity.json" with { type: "json" };

/** One working line: the move that led to it (none on line 1), the equation, the answer line. */
export type WorkedLine = { move?: string; eq: string; answer?: boolean };
/** The writer's panel: ax + b = c as a bar, or p% of an amount by tenths. */
export type WorkedPanel =
  | { model: "algebra-bar"; a: number; b: number; c: number }
  | { model: "percent-bar"; amount: number; percent: number };

export const WORKED_MIN = 1;
/** Element names the editor binds and the tests read. */
export const WORKED_NAMES = {
  rail: "Rail",
  railFill: "Rail fill",
  ghost: "Badge ghost",
  badge: "Badge",
  /** The ink badge a row keeps once a later row is the newest. */
  done: "Badge done",
  plate: "Answer plate",
  left: "Eq left",
  sign: "Eq sign",
  right: "Eq right",
  arrow: "Move arrow",
  move: "Move",
  strip: "Check strip",
  checkLabel: "Check label",
  check: "Check",
  tick: "Check tick",
  field: "Panel field",
} as const;

type AgeKey = "early" | "primary" | "secondary";
type Caps = Record<AgeKey, { base: number; panel: number; titleWords: number; moveWords: number }>;
/** The measured caps (`worked-capacity.json`, written by `measureWorkedCapacity`). */
export const WORKED_CAPS = CAPACITY as Caps;

const W = 960;
const H = 540;
const pt = (px: number) => (px * 2) / 3;
const X0 = pt(96);
const BADGE = pt(48);
const COL_L = pt(176);
const ROW1 = pt(262);
const FOOT = pt(64);
const PITCH_MAX = pt(124);
const ARROW_W = pt(70);
const PANEL_W = pt(480);
const EQ_LH = 1.2;
const SAY_LH = 1.12;
/** The narrowest move column (two lines of a six-word move). */
const MOVE_MIN_W = pt(200);
/**
 * The gold's sizes per age (ruling 21 A; `northstars-v12/worked/worked.css`: `--eq` 70 px and
 * `--say` 36 px, primary 54 px and 34 px). The gold has no early sizes: KS1 reads primary's.
 */
const SAY_BASE: Record<AgeKey, number> = { early: pt(34), primary: pt(34), secondary: pt(36) };
const EQ_BASE: Record<AgeKey, number> = { early: pt(54), primary: pt(54), secondary: pt(70) };
/** The gold's smallest move (28 px) and check sum (30 px), before the stage's reading floor. */
const SAY_MIN = pt(28);
const CHECK_MIN = pt(30);

const NEG = "−";
const NBSP = " ";
const UNITS =
  "mol/dm³|g/mol|m/s²|m/s|cm³|dm³|km/h|kJ|kg|mg|mol|cm|mm|km|ms|kPa|Pa|°C|N|J|W|V|A|K|g|m|s|%";
/**
 * The writer's maths as it is set (W-d6): a hyphen used as a minus is U+2212, a number and its
 * unit never part, `M_r` is "Mr".
 */
export function mathText(s: string): string {
  return s
    .replace(/M_r/g, "Mr")
    .replace(/ - /g, ` ${NEG} `)
    .replace(/(^|[\s(=×÷+])-(?=[\d\w(.])/g, `$1${NEG}`)
    .replace(new RegExp(`(\\d) (${UNITS})(?![\\w])`, "g"), `$1${NBSP}$2`);
}

type Run = { text: string; marks?: unknown[] };
/** A run in A3's run style (`styledRun`, TEACH-205 part c), bold when asked. */
const styled = (text: string, attrs: RunStyleAttrs, bold = false): Run => {
  const r = styledRun(text, attrs) as Run;
  return bold ? { ...r, marks: [{ type: "bold" }, ...(r.marks ?? [])] } : r;
};
const docOf = (runs: Run[]): RichDoc =>
  ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: runs.filter((r) => r.text).map((r) => ({ type: "text", ...r })),
      },
    ],
  }) as RichDoc;

/** `s` as runs: each variable letter in the quote face, each `*n*` in `hot` (the accent). */
function mathRuns(s: string, vars: readonly string[], hot: string, all?: string): Run[] {
  const out: Run[] = [];
  const plain = (t: string, colour?: string) => {
    if (!t) return;
    if (!vars.length) {
      out.push(colour ? styled(t, { color: colour }) : { text: t });
      return;
    }
    const re = new RegExp(`(?<![A-Za-z])(${vars.map(esc).join("|")})(?![A-Za-z])`, "g");
    let at = 0;
    for (const m of t.matchAll(re)) {
      const i = m.index ?? 0;
      if (i > at)
        out.push(colour ? styled(t.slice(at, i), { color: colour }) : { text: t.slice(at, i) });
      out.push(styled(m[0], { font: "math", ...(colour ? { color: colour } : {}) }));
      at = i + m[0].length;
    }
    if (at < t.length)
      out.push(colour ? styled(t.slice(at), { color: colour }) : { text: t.slice(at) });
  };
  let at = 0;
  for (const m of s.matchAll(/\*([^*]+)\*/g)) {
    const i = m.index ?? 0;
    plain(s.slice(at, i), all);
    plain(m[1] ?? "", hot);
    at = i + m[0].length;
  }
  plain(s.slice(at), all);
  return out;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unstar = (s: string) => s.replace(/\*([^*]+)\*/g, "$1");

/**
 * A move's red words (NOTES "Move-label caps"): the verb, a particle that follows it ("out", "in"),
 * the first number (the move's amount) and "by" just before it.
 */
export function moveHot(move: string): boolean[] {
  const w = move.split(" ");
  const n1 = w.findIndex((x) => /^[\d−-]/.test(x) && /\d/.test(x));
  return w.map(
    (x, i) =>
      i === 0 ||
      (i === 1 && /^(out|in|up|back|off)$/.test(x)) ||
      i === n1 ||
      (x === "by" && i === n1 - 1),
  );
}
/**
 * A move's runs. The box is set in the accent and the red words are bold with no colour of their
 * own; the other words carry the ink. Bold in a colour of its own is the editor's key-term chip
 * (`.td-rt strong > span[style*="color"]`), which the gold's move does not have.
 */
function moveRuns(move: string, vars: readonly string[], ink: string): Run[] {
  const w = move.split(" ");
  const hot = moveHot(move);
  const out: Run[] = [];
  w.forEach((word, i) => {
    const sp = i < w.length - 1 ? " " : "";
    if (hot[i]) out.push({ text: word + sp, marks: [{ type: "bold" }] });
    else out.push(...mathRuns(word + sp, vars, ink, ink));
  });
  return out;
}

const ageOf = (stage: Stage): AgeKey => ageProfileOf(stage) as AgeKey;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The writer's panel as the bar model's panel input, or undefined when there is none. */
export function barPanelOf(p: WorkedPanel | null | undefined) {
  if (!p || typeof p !== "object") return undefined;
  if (p.model === "algebra-bar") return { model: "equation" as const, a: p.a, b: p.b, c: p.c };
  if (p.model === "percent-bar")
    return { model: "percent" as const, amount: p.amount, percent: p.percent };
  return undefined;
}

/** The lines the slide shows: only lines with words, their maths set (`mathText`). */
export function workedLines(input: TemplateInput): WorkedLine[] {
  return (input.lines ?? [])
    .filter((l) => l && typeof l.eq === "string" && l.eq.trim())
    .map((l) => ({
      ...(l.move?.trim() ? { move: mathText(l.move.trim()) } : {}),
      eq: mathText(l.eq.trim()),
      ...(l.answer ? { answer: true } : {}),
    }));
}

/** Whether the panel draws: its guard holds and it has one build per row (lines + check). */
export function panelDraws(input: TemplateInput): boolean {
  const p = barPanelOf(input.barPanel);
  if (!p || !barPanelGuard(p).ok) return false;
  const rows = workedLines(input).length + (input.check?.trim() ? 1 : 0);
  return barPanelFrames(p).length === rows;
}

/** The most rows (lines + check) one slide holds at `stage`; more continue on a second slide. */
export function workedMax(stage: Stage, panel = false): number {
  const cap = WORKED_CAPS[ageOf(stage)];
  return panel ? cap.panel : cap.base;
}

/**
 * Over the rows a slide holds, the working continues on a second slide, "(continued)" (ruling 91):
 * the first slide takes the most lines it holds, the rest (with the check) the next. The panel
 * stays with the first slide's lines only when it still has one build per row there; otherwise the
 * slides are text only.
 */
export function splitWorked(input: TemplateInput, stage: Stage): TemplateInput[] {
  const lines = input.lines ?? [];
  const check = input.check?.trim() ? 1 : 0;
  const max = workedMax(stage, panelDraws(input));
  if (lines.length + check <= max) return [input];
  const out: TemplateInput[] = [];
  const { barPanel: _p, ...plain } = input;
  for (let i = 0; i < lines.length; ) {
    const room = workedMax(stage) - (lines.length - i <= workedMax(stage) - check ? check : 0);
    let n = Math.min(room, lines.length - i);
    // Never leave one line alone on the last slide.
    if (lines.length - i - n === 1 && n > 2) n -= 1;
    const last = i + n >= lines.length;
    out.push({
      ...plain,
      heading: i === 0 ? input.heading : `${input.heading} (continued)`,
      lines: lines.slice(i, i + n),
      ...(last && check ? { check: input.check } : { check: undefined }),
    });
    i += n;
  }
  return out;
}

/**
 * The editor's input paths: the heading and the check. The equations are drawn in parts (left,
 * "=", right) and the moves are bound by their line, so they re-lay from the panel's fields.
 */
export function workedPaths(els: { name?: string }[]): (string | undefined)[] {
  return els.map((e) =>
    e.name === "Heading" ? "heading" : e.name === WORKED_NAMES.check ? "check" : undefined,
  );
}

type Preset = "body" | "heading";
/** The sizes a preset may take at the theme's stage, largest first (the type ladder, ruling 91). */
function ladder(c: Ctx, preset: Preset): number[] {
  const out = new Set<number>();
  for (let s = 16; s <= 72; s++) out.add(resolveFontSize(c.t, preset, s));
  return [...out].sort((a, b) => b - a);
}
/** The largest step on the ladder at or within 2 pt over `target` (else the smallest step). */
function stop(c: Ctx, preset: Preset, target: number): number {
  const l = ladder(c, preset);
  return l.find((s) => s <= target + 2) ?? (l.at(-1) as number);
}
/**
 * The equations' floor (the gold's smallest maths: about 46 px at KS3-5, 50 px at KS1-2) and how
 * much of the row pitch a step up the ladder may take to stay over it (primary rows keep more air).
 */
const EQ_FLOOR: Record<AgeKey, number> = { early: 33, primary: 33, secondary: 30 };
const EQ_SQUEEZE: Record<AgeKey, number> = { early: 0.7, primary: 0.7, secondary: 0.8 };
export const eqFloorOf = (stage: Stage): number => EQ_FLOOR[ageOf(stage)];

/**
 * The equations' size (the gold's `worked.js`): the age's size, at most 0.62 of the row pitch, and
 * 0.92 of that beside the panel. Under the floor, the floor itself when the pitch still has room
 * for it.
 */
function eqSize(pitch: number, age: AgeKey, model: boolean): number {
  const eq = Math.min(EQ_BASE[age], pitch * 0.62) * (model ? 0.92 : 1);
  if (eq >= EQ_FLOOR[age]) return eq;
  return EQ_FLOOR[age] <= pitch * EQ_SQUEEZE[age] ? EQ_FLOOR[age] : eq;
}

/** The smallest move: the gold's 28 px, held at the stage's reading floor (ruling 162). */
// Ruling 162 amended by Greg 18 Oct (item 26 n): gold sizes on cover question and worked steps.
// The step text runs the gold's own ladder down to its 28px, under the stage's reading floor.
const sayFloorOf = (_c: Ctx) => SAY_MIN;

/**
 * A fit ladder: `top` down to `floor` in `step`s, the floor itself last. Largest first. The gold's
 * sizes step by whole px, so they sit between the stage's type steps and are drawn as given
 * (`fixedSize`).
 */
function rungs(top: number, floor: number, step: number): number[] {
  const out: number[] = [];
  for (let s = top; s > floor + 1e-6; s -= step) out.push(s);
  out.push(Math.min(top, floor));
  return out;
}

type Plan = {
  rows: number;
  pitch: number;
  eq: number;
  say: number;
  checkH: number;
  checkTop: number;
  row1: number;
  model: boolean;
  right: number;
};

function plan(
  c: Ctx,
  input: TemplateInput,
  headBottom: number,
  stage: Stage,
  noPanel = false,
): Plan {
  const age = ageOf(stage);
  const nEq = Math.max(1, workedLines(input).length);
  const check = !!input.check?.trim();
  const model = !noPanel && panelDraws(input);
  const row1 = Math.max(ROW1, headBottom + pt(56));
  const checkH = nEq > 3 ? pt(100) : pt(116);
  const checkTop = H - FOOT - checkH;
  const lastY = check ? checkTop - pt(70) : H - FOOT - pt(60);
  const pitch = nEq > 1 ? Math.min(PITCH_MAX, (lastY - row1) / (nEq - 1)) : PITCH_MAX;
  const eq = eqSize(pitch, age, model);
  const say = Math.max(sayFloorOf(c), Math.min(SAY_BASE[age], pitch * 0.42));
  const right = model ? W - PANEL_W - pt(44) : W - X0;
  return {
    rows: nEq + (check ? 1 : 0),
    pitch,
    eq,
    say,
    checkH,
    checkTop,
    row1,
    model,
    right,
  };
}

/** `text`'s width at `size` in the body face (one line, no padding). */
function widthAt(c: Ctx, text: string, size: number, weight = 500): number {
  if (!text) return 0;
  const r = resolveTextStyle({ preset: "body" }, c.t);
  return ((lineWidth(text, "body", c.t, weight) - 2 * r.padding) / r.fontSize) * size;
}

function textEl(
  c: Ctx,
  name: string,
  runs: Run[],
  box: { x: number; y: number; w: number; h: number },
  size: number,
  extra: Partial<TextElement["style"]> = {},
  step?: number,
  preset: Preset = "body",
): TextElement {
  const el: TextElement = {
    id: uid(),
    type: "text",
    name,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    doc: docOf(runs),
    style: {
      preset,
      // The gold's size (ruling 21 A), drawn as given at every stage; maths keeps the body face.
      fontSize: size,
      fixedSize: true,
      ...(preset === "heading" ? { fontFamily: c.t.fonts.body } : {}),
      lineHeight: EQ_LH,
      fontWeight: 500,
      padding: 0,
      autoHeight: false,
      color: c.t.colors.ink,
      ...extra,
    },
    ...(step ? { revealStep: step, reveal: "fade" as const } : {}),
  };
  c.els.push(el);
  return el;
}

/** The theme's offset block (Poster), in a given colour and at most 5pt off a small plate. */
const offsetOf = (c: Ctx, color: string): Pick<ShapeElement, "shadow"> => {
  const o = surfacesOf(c.t).marks.offset;
  return o ? { shadow: { x: Math.min(5, o.d), y: Math.min(5, o.d), color } } : {};
};

function shape(c: Ctx, el: Omit<ShapeElement, "id" | "type">, step?: number): ShapeElement {
  const s = {
    id: uid(),
    type: "shape",
    ...el,
    x: Math.round(el.x),
    y: Math.round(el.y),
    w: Math.round(el.w),
    h: Math.round(el.h),
    ...(step ? { revealStep: step, reveal: "fade" as const } : {}),
  } as ShapeElement;
  c.els.push(s);
  return s;
}

function svgImage(
  c: Ctx,
  name: string,
  svg: string,
  box: { x: number; y: number; w: number; h: number },
  step?: number,
): ImageElement {
  const el: ImageElement = {
    id: uid(),
    type: "image",
    name,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    h: Math.round(box.h),
    src: svgDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(box.w)}" height="${Math.round(box.h)}" viewBox="0 0 ${Math.round(box.w)} ${Math.round(box.h)}" overflow="visible">${svg}</svg>`,
    ),
    alt: "",
    fit: "contain",
    ...(step ? { revealStep: step, reveal: "fade" as const } : {}),
  } as ImageElement;
  c.els.push(el);
  return el;
}

export function layoutWorked(c: Ctx, input: TemplateInput, stage: Stage) {
  const age = ageOf(stage);
  const caps = WORKED_CAPS[age];
  const vars = (input.vars ?? ["x"]).filter((v) => /^[A-Za-z]$/.test(v));
  const col = v2Colors(c.t);
  const ink = c.t.colors.ink;
  const accent = c.t.colors.accent;

  // The title: the problem, its variables in the quote face.
  const title = mathText(input.heading.trim());
  let headBottom = 46;
  if (title) {
    const el = kit.heading(c, unstar(title));
    el.doc = docOf(mathRuns(unstar(title), vars, accent));
    headBottom = el.y + el.h;
  }
  c.bodyFromHeading = true;
  const lines = workedLines(input);
  let p = plan(c, input, headBottom, stage);
  if (!lines.length) return;
  const floor = eqFloorOf(stage);
  const hasMoves = lines.some((l, i) => i > 0 && l.move);
  // The geometry at an equation size: the "=" column on the widest left side, the moves just right
  // of the widest right side.
  const geom = (eq: number, model: boolean) => {
    const g = eq * 0.26;
    const signW = widthAt(c, "=", eq);
    const parts = lines.map((l) => {
      const at = l.eq.indexOf(" = ");
      const lhs = at < 0 ? l.eq : l.eq.slice(0, at);
      const rhs = at < 0 ? "" : l.eq.slice(at + 3);
      return { lhs, rhs, sign: at >= 0, lw: widthAt(c, lhs, eq), rw: widthAt(c, rhs, eq) };
    });
    const maxL = Math.max(...parts.map((r) => r.lw));
    const maxR = Math.max(...parts.map((r) => r.rw));
    const eqx = COL_L + (model ? pt(22) : pt(64)) + maxL + g + signW / 2;
    const moveX = eqx + signW / 2 + g + maxR + pt(34);
    const right = model ? W - PANEL_W - pt(44) : W - X0;
    return { g, signW, parts, eqx, moveX, sayW: right - moveX - ARROW_W };
  };
  // Moves need a column: the equations step down the ladder (not under the floor) to make one;
  // a panel that still leaves none goes, and the text-only base stands on its own.
  const sayMin = sayFloorOf(c);
  const roomy = (eq: number, model: boolean) => {
    if (!hasMoves) return true;
    const w = geom(eq, model).sayW;
    return (
      w >= MOVE_MIN_W &&
      lines.every((l) => !l.move || countLines(l.move, "body", c.t, w, 600, sayMin) <= 2)
    );
  };
  const down = (model: boolean) =>
    rungs(p.eq, floor, pt(1)).find((s) => s >= floor && roomy(s, model));
  if (!roomy(p.eq, p.model)) {
    const eq = down(p.model);
    if (eq !== undefined) p = { ...p, eq };
    else if (p.model) {
      p = plan(c, input, headBottom, stage, true);
      const base = roomy(p.eq, false) ? p.eq : down(false);
      if (base !== undefined) p = { ...p, eq: base };
    }
  }
  const max = workedMax(stage, p.model);
  if (p.rows > max) c.over.push(`worked rows ${p.rows}/${max}`);
  if (p.eq < floor) c.over.push(`worked equations ${p.eq}pt under ${floor}pt`);

  const yOf = (i: number) => p.row1 + i * p.pitch;
  const { g, signW, parts, eqx, moveX } = geom(p.eq, p.model);
  const sayL = moveX + ARROW_W;
  const sayW = Math.max(60, p.right - sayL);
  if (hasMoves && sayW < MOVE_MIN_W) c.over.push("worked moves have no room");
  const eqH = p.eq * EQ_LH;
  // A move takes one line if it fits, else two; type steps down only when two will not fit the pitch.
  const moveLines = (m: string, size: number) => countLines(m, "body", c.t, sayW, 600, size);
  const roomFor = (size: number) => Math.min(2, Math.floor((p.pitch + 4) / (size * SAY_LH)));
  for (const s of rungs(p.say, sayMin, pt(1)).slice(1))
    if (lines.some((l) => l.move && moveLines(l.move, p.say) > roomFor(p.say))) p.say = s;

  // The rail of badges: ghosts from the start, each row's badge and rail segment on its step.
  const badgeY = lines.map((_, i) => yOf(i));
  if (input.check?.trim()) badgeY.push(p.checkTop + p.checkH / 2);
  const railX = X0 + BADGE / 2 - 1.5;
  const first = badgeY[0] ?? p.row1;
  const last = badgeY.at(-1) ?? first;
  // A theme with dashed or dotted rules (Scrapbook, Geometric) draws its rail the same way.
  const railDash = surfacesOf(c.t).roles.rule.dash;
  const railPart = (name: string, y0: number, y1: number, fill: string, step?: number) => {
    if (!railDash) {
      shape(c, { shape: "rect", name, x: railX, y: y0, w: 3, h: y1 - y0, fill }, step);
      return;
    }
    const el: PathElement = {
      id: uid(),
      type: "path",
      name,
      x: railX,
      y: y0,
      w: 3,
      h: y1 - y0,
      points: [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
      stroke: fill,
      strokeWidth: 2.5,
      dash: railDash,
      dashGap: railDash === "dotted" ? 1.8 : 1.4,
      ...(step ? { revealStep: step } : {}),
    };
    c.els.push(el);
  };
  // The rail still to come: the theme's own colour when it sets one (Geometric), else the rule.
  const ahead = surfacesOf(c.t).marks.railAhead ?? col.rule;
  if (badgeY.length > 1) railPart(WORKED_NAMES.rail, first, last, ahead);
  badgeY.forEach((y, i) => {
    if (i > 0) railPart(WORKED_NAMES.railFill, badgeY[i - 1] as number, y, ink, i + 1);
  });
  const ghostLook = markLook(c.t, "badge", BADGE, c.t.colors.background, col.rule);
  for (const y of badgeY)
    shape(c, {
      shape:
        ghostLook.shape === "rounded" || ghostLook.shape === "notch"
          ? ghostLook.shape
          : ghostLook.shape === "hexagon"
            ? "hexagon"
            : "ellipse",
      ...(ghostLook.radius != null ? { radius: ghostLook.radius } : {}),
      name: WORKED_NAMES.ghost,
      x: X0,
      y: y - BADGE / 2,
      w: BADGE,
      h: BADGE,
      fill: c.t.colors.background,
      stroke: col.rule,
      strokeWidth: 2,
    });
  const badgeSize = stop(c, "body", BADGE * 0.46);
  // The newest row's badge is the accent (gold: `.lb.now`); the next click lays the ink badge over
  // it, so only the latest row is red. The last row's badge stays red.
  const badge = (i: number, y: number, name: string, fill: string, ink2: string, step: number) => {
    // The theme's badge family (hex, rounded square, outline ring ...); the now badge stays solid.
    const look = markLook(c.t, "badge", BADGE, fill, ink2);
    const solid = look.fill === "transparent" && name === WORKED_NAMES.badge;
    return shape(
      c,
      {
        shape: look.shape,
        ...(look.radius != null ? { radius: look.radius } : {}),
        ...(look.stroke && !solid ? { stroke: look.stroke, strokeWidth: look.strokeWidth } : {}),
        name,
        x: X0,
        y: y - BADGE / 2,
        w: BADGE,
        h: BADGE,
        // An outline family's done badge is a ring on the ground (the rail shows through no hole).
        fill: solid ? fill : look.fill === "transparent" ? c.t.colors.background : look.fill,
        doc: kit.doc(String(i + 1)),
        textStyle: {
          preset: "body",
          fontSize: resolveFontSize(c.t, "body", badgeSize),
          fontWeight: 700,
          color: solid ? ink2 : look.ink,
          align: "center",
          valign: "middle",
          padding: 0,
        },
      },
      step,
    );
  };
  const onAccent = c.t.colors.onAccent ?? c.t.colors.background;
  for (const [i, y] of badgeY.entries()) badge(i, y, WORKED_NAMES.badge, accent, onAccent, i + 1);
  for (const [i, y] of badgeY.entries())
    if (i < badgeY.length - 1) badge(i, y, WORKED_NAMES.done, ink, c.t.colors.background, i + 2);

  // The rows: the answer plate, then left side, "=", right side on the "=" column.
  lines.forEach((l, i) => {
    const R = i + 1;
    const y = yOf(i);
    const r = parts[i] as (typeof parts)[number];
    const lx = eqx - signW / 2 - g - r.lw;
    if (l.answer && surfacesOf(c.t).marks.field === "notch") {
      // Geometric's plate (round 2 `--plate-notch: 6px`, `--plate-fill: #FFFFFF`): white, a thin
      // accent line, all four corners cut, as path geometry so it mirrors (RTL-DESIGN.md).
      const pad = pt(26);
      const box = {
        x: Math.round(lx - pad),
        y: Math.round(y - (p.eq * 1.5) / 2),
        w: Math.round(r.lw + r.rw + signW + 2 * g + 2 * pad),
        h: Math.round(p.eq * 1.5),
      };
      c.els.push({
        id: uid(),
        type: "path",
        name: WORKED_NAMES.plate,
        ...box,
        points: notchPoints(box.w, box.h, 4, "all"),
        closed: true,
        fill: surfaceStyle(c.t, "plate").fill,
        stroke: accent,
        strokeWidth: 1.33,
        revealStep: R,
        reveal: "fade",
      } as PathElement);
    } else if (l.answer) {
      const pad = pt(26);
      shape(
        c,
        {
          shape: "rounded",
          name: WORKED_NAMES.plate,
          x: lx - pad,
          y: y - (p.eq * 1.5) / 2,
          w: r.lw + r.rw + signW + 2 * g + 2 * pad,
          h: p.eq * 1.5,
          radius: 6,
          fill: col.wash,
          stroke: accent,
          strokeWidth: 3,
          ...offsetOf(c, accent),
        },
        R,
      );
    }
    const slack = 8;
    textEl(
      c,
      WORKED_NAMES.left,
      mathRuns(r.lhs, vars, accent),
      { x: lx - slack, y: y - eqH / 2, w: r.lw + slack, h: eqH },
      p.eq,
      { align: "right" },
      R,
      "heading",
    );
    if (r.sign)
      textEl(
        c,
        WORKED_NAMES.sign,
        [{ text: "=" }],
        { x: eqx - signW / 2 - 2, y: y - eqH / 2, w: signW + 4, h: eqH },
        p.eq,
        { align: "center" },
        R,
        "heading",
      );
    if (r.rhs)
      textEl(
        c,
        WORKED_NAMES.right,
        mathRuns(r.rhs, vars, accent, l.answer ? accent : undefined),
        { x: eqx + signW / 2 + g, y: y - eqH / 2, w: r.rw + slack, h: eqH },
        p.eq,
        {},
        R,
        "heading",
      );
  });

  // The moves: a red bracket arrow from the line above to this one, the instruction beside it.
  lines.forEach((l, i) => {
    if (!l.move || i === 0) return;
    const R = i + 1;
    const top = yOf(i - 1);
    const h = p.pitch;
    const t = h * 0.12;
    const arrow = arrowCubic(
      [pt(8), t],
      [pt(58), t + pt(8)],
      [pt(58), h - t - pt(8)],
      [pt(8), h - t],
      { ink: accent, sw: pt(6) },
    );
    svgImage(c, WORKED_NAMES.arrow, arrow.svg, { x: moveX, y: top, w: ARROW_W, h }, R);
    textEl(
      c,
      WORKED_NAMES.move,
      moveRuns(l.move, vars, ink),
      { x: sayL, y: top, w: sayW, h },
      p.say,
      { lineHeight: SAY_LH, valign: "middle", color: accent },
      R,
    );
    if (wordCount(l.move) > caps.moveWords) c.tight = true;
    if (moveLines(l.move, p.say) > roomFor(p.say)) c.over.push(`worked move ${R} past 2 lines`);
  });

  // The check: its own sand strip (a card beside the panel), "Check:", the sum and a tick.
  if (input.check?.trim()) {
    const R = badgeY.length;
    const checkText = mathText(input.check.trim());
    const label = "Check:";
    // The gold's check sum: 0.8 of the equations (54 px at most), 1 px smaller until it fits.
    const ceMin = Math.max(CHECK_MIN, c.s.small);
    const steps = rungs(Math.max(ceMin, Math.min(pt(54), p.eq * 0.8)), ceMin, pt(1));
    let ce = steps[0] as number;
    const labW = pt(170);
    const room = p.right - COL_L - pt(36) - labW - pt(32) - pt(60) - pt(28) - pt(36);
    for (const s of steps.filter((s) => s < ce))
      if (widthAt(c, unstar(checkText), ce) > room) ce = s;
    const cw = widthAt(c, unstar(checkText), ce);
    if (cw > room) c.over.push("worked check too wide");
    const ex = COL_L + pt(36) + labW;
    const tx = ex + cw + pt(30);
    const stripW = tx + pt(60) + pt(36) - COL_L;
    const box = { x: COL_L, y: p.checkTop, w: stripW, h: p.checkH };
    const strip = paintSurface(
      {
        id: uid(),
        // An outline-card theme (Geometric's gold) sets the check on an outlined card on white.
        role: p.model || surfacesOf(c.t).marks.card === "outline" ? "card" : "field-b",
        box,
        own: [10, 10, 10, 10],
      },
      c.t,
    );
    if (strip)
      c.els.push({
        ...strip,
        name: WORKED_NAMES.strip,
        revealStep: R,
        reveal: "fade",
      } as ShapeElement);
    // The gold's "Check:" is 40 px, held at the stage's reading floor, in the display face, 800
    // (worked.html `.ck b`) on an outline-card theme.
    const labFace = surfacesOf(c.t).marks.card === "outline" ? "heading" : "body";
    const labSize = Math.max(pt(40), c.s.small);
    textEl(
      c,
      WORKED_NAMES.checkLabel,
      [styled(label, {}, true)],
      { x: COL_L + pt(36), y: p.checkTop, w: labW, h: p.checkH },
      labSize,
      { valign: "middle", fontWeight: 800 },
      R,
      ...(labFace === "heading" ? (["heading"] as const) : []),
    );
    textEl(
      c,
      WORKED_NAMES.check,
      mathRuns(checkText, vars, accent),
      { x: ex, y: p.checkTop, w: cw + 8, h: p.checkH },
      ce,
      { valign: "middle" },
      R,
      "heading",
    );
    const d = pt(60);
    const tick = `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${accent}"/><path d="M${d * 0.28} ${d * 0.52} L${d * 0.44} ${d * 0.67} L${d * 0.73} ${d * 0.34}" fill="none" stroke="${c.t.colors.background}" stroke-width="${d * 0.11}" stroke-linecap="round" stroke-linejoin="round"/>`;
    svgImage(
      c,
      WORKED_NAMES.tick,
      tick,
      { x: tx, y: p.checkTop + (p.checkH - d) / 2, w: d, h: d },
      R,
    );
  }

  // The panel: a sand field, the bar model at panel size, build i with row i.
  if (p.model) {
    const bp = barPanelOf(input.barPanel);
    const made = bp ? barPanelSpec(bp, "Bar model of the working") : undefined;
    const field = paintSurface(
      { id: uid(), role: "field-b", box: { x: W - PANEL_W, y: 0, w: PANEL_W, h: H } },
      c.t,
    );
    if (made?.ok) {
      // The gold (v12 worked.js): the bars centre 8px under the middle of the equation rows.
      const cy =
        (first + (input.check?.trim() ? (badgeY[lines.length - 1] ?? last) : last)) / 2 + pt(8);
      const ph = Math.min(pt(560), H - 2 * pt(48));
      const box = {
        x: W - PANEL_W + pt(16),
        y: Math.max(pt(24), Math.min(H - ph - pt(24), cy - ph / 2)),
        w: PANEL_W - 2 * pt(16),
        h: ph,
      };
      const img = withBuilds(() => diagramElement(made.spec, c.t, box));
      if (img) {
        if (field) c.els.splice(0, 0, { ...field, name: WORKED_NAMES.field } as ShapeElement);
        // The opening frame is build 0: the panel shows with row 1, then build i with row i + 1.
        const builds = buildCount(svgOfDataUrl(img.src) ?? "");
        c.els.push({ ...img, revealStep: 1, reveal: "fade", buildFrom: 2, builds } as ImageElement);
      } else c.fails?.push("worked panel did not draw");
    } else if (made && !made.ok) c.fails?.push(made.reason);
  }

  c.fields = fieldsOf(input, lines, age, sayW, p.say);
  if (wordCount(unstar(title)) > caps.titleWords) c.tight = true;
}

function fieldsOf(
  input: TemplateInput,
  lines: WorkedLine[],
  age: AgeKey,
  sayW: number,
  say: number,
): FieldReport[] {
  const caps = WORKED_CAPS[age];
  const perLine = Math.max(8, Math.floor(sayW / (say * 0.55)));
  const out: FieldReport[] = [];
  const title = input.heading.trim();
  // About six characters a word.
  out.push(report("Title", "heading", title.length, caps.titleWords * 6, caps.titleWords * 8));
  lines.forEach((l, i) => {
    if (!l.move) return;
    out.push(
      report(
        `Move ${i + 1}`,
        `lines.${i}.move`,
        l.move.length,
        perLine,
        Math.min(2 * perLine, caps.moveWords * 8),
      ),
    );
  });
  return out;
}

const report = (field: string, path: string, chars: number, cap: number, hardMax: number) => ({
  field,
  path,
  chars,
  cap,
  hardMax,
  tight: chars > cap,
  over: chars > hardMax,
});
