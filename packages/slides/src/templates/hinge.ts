/**
 * Hinge (TEACH-256 part b, layout batch B3; rulings 136, 161, 230, 241): one question with 2-4
 * lettered answer cards and exactly one right answer. Ported from the v13 gold
 * (`northstars-v13/hinge/hinge.html`, direction C "answer cards on a sand stage").
 *
 * - **The question is the title** (the stem when there is one, else the heading), its one accent
 *   word in the title accent. Under it a full-bleed sand stage (`field-b`) holds white answer cards
 *   (`card`), each with a rounded-square letter key (`key`), never the quick check's round badge.
 * - **The look is chosen by code (ruling 161), never by the writer:** every option has a library
 *   icon and there is no figure -> picture tiles; every option fits one line in its grid cell at the
 *   age's grid size or above -> a grid (2x2 for 4, one row for 2-3); otherwise full-width rows, at
 *   most 2 lines each, every card as tall as the tallest. Roomy cards first, compact ones only below
 *   the age's comfort size.
 * - **Reveal:** the answer stays question data on the cards (`multiple-choice`, counted from 1 as
 *   in TEACH-110 part u), so every renderer hides it until the reveal; the editor rings the right
 *   card in `verdict-right`, turns its key to `key:right`, ticks it and fades the others
 *   (`SlideView` `ChoiceMarks`).
 * - **Why lines** (241): each wrong option's `why` goes to the speaker notes, never the slide.
 * - **Fallbacks:** one tile icon that the library cannot match drops every tile to word cards in
 *   the same letter order (a lone word tile would hint at the answer). A 5th option is dropped and
 *   flagged; type below the age's floor is never used, the slide is flagged instead.
 *
 * Sizes are slide points (960 x 540): the gold's px at 1440 x 2/3.
 */
import type { ShapeElement, SlideElement, TextElement } from "@tj/domain/documents";
import { contrastRatio } from "../colour-contrast";
import { uid } from "../factories";
import { optionTones } from "../option-tones";
import { countLines } from "../text-measure";
import { MIN_FONT_SIZE } from "../themes";
import { type Corners, markLook, paintSurface, surfaceStyle, surfacesOf } from "../themes/surfaces";
import CAPACITY from "./hinge-capacity.json" with { type: "json" };
import { type Ctx, type FieldReport, kit, type TemplateInput } from "./index";
import { type Age, iconImage, resolveIcons, v2Colors, v2Profile } from "./items-row-deps";

/** One answer option: its words, an optional library icon label, and why a pupil might pick it. */
export type HingeChoice = { text: string; icon?: string; why?: string };
/** The letters' script (ruling 239): Latin, Hebrew or Arabic. */
export type HingeLetters = "latin" | "hebrew" | "arabic";
export type HingeLook = "tiles" | "grid" | "rows";

export const HINGE_MIN = 2;
export const HINGE_MAX = 4;
export const HINGE_LETTERS: Record<HingeLetters, readonly string[]> = {
  latin: ["A", "B", "C", "D"],
  hebrew: ["א", "ב", "ג", "ד"],
  arabic: ["أ", "ب", "ج", "د"],
};
/** Element names the editor's reveal reads (`ChoiceMarks`). */
export const HINGE_NAMES = {
  stage: "surface:field-b",
  card: "Option",
  key: "Hinge key",
  text: "Option text",
  icon: "Option icon",
  bar: "Fraction bar",
} as const;

const W = 960;
const H = 540;
const X0 = 64;
const X1 = 896;
/** Gold px x 2/3, rounded: geometry. */
const pt = (px: number) => Math.round((px * 2) / 3);
/** Gold px x 2/3, exact: type sizes (ruling 21 A, drawn as given with `fixedSize`). */
const ex = (px: number) => (px * 2) / 3;
const GAP = pt(20);
const FOOT = pt(64);
const FIELD_ABOVE = pt(40);
const CARD_R = pt(20);
const LINE_H = 1.24;
const FIG_GAP = pt(48);

type AgeSpec = {
  key: number;
  /** The gold's comfort size: the roomy rows' smallest type (`floor + 4` px). */
  comfort: number;
  floor: number;
  ceil: number;
  grid: number;
  gridFloor: number;
  cellMax: number;
  tileMax: number;
  tileLabel: number;
  iconMax: number;
};
/**
 * The gold's `AGE` table and fit ladders (hinge.html: `AGE`, `tryGrid`'s start size, `tryTiles`'
 * label size) in points: geometry rounded, type exact. Floors never under master's body floor;
 * `plan` then holds every type size at the stage's reading floor (ruling 162).
 */
function AGES(): Record<Age, AgeSpec> {
  const raw = {
    early: [72, 34, 48, 56, 44, 200, 470, 48, 280],
    primary: [64, 28, 40, 50, 34, 170, 420, 40, 250],
    secondary: [58, 28, 36, 46, 32, 170, 420, 36, 250],
  } as const;
  const out = {} as Record<Age, AgeSpec>;
  for (const [age, v] of Object.entries(raw) as [Age, readonly number[]][]) {
    const [key, floor, ceil, grid, gridFloor, cellMax, tileMax, tileLabel, iconMax] = v as number[];
    const f = MIN_FONT_SIZE.body;
    out[age] = {
      key: pt(key as number),
      comfort: Math.max(f, ex((floor as number) + 4)),
      floor: Math.max(f, ex(floor as number)),
      ceil: Math.max(f, ex(ceil as number)),
      grid: Math.max(f, ex(grid as number)),
      gridFloor: Math.max(f, ex(gridFloor as number)),
      cellMax: pt(cellMax as number),
      tileMax: pt(tileMax as number),
      tileLabel: Math.max(f, ex(tileLabel as number)),
      iconMax: pt(iconMax as number),
    };
  }
  return out;
}

/**
 * A fit ladder: `top` down to `floor` in `step`s, the floor itself last (the gold steps whole px,
 * so its floor is reached only when it is a whole px). Largest first.
 */
function rungs(top: number, floor: number, step: number): number[] {
  const out: number[] = [];
  for (let s = top; s > floor + 1e-6; s -= step) out.push(s);
  out.push(floor);
  return out;
}

/** "2/5" set as a stacked fraction. */
const FRACTION = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
/**
 * Maths options: digits, operators and one-letter variables only ("3x - 2", "-5"). A word of two
 * letters or more ("12-year-old") is prose, and its hyphens stay hyphens.
 */
const mathy = (s: string) =>
  /^[\d\s.+\-−×÷=()/a-z]+$/i.test(s) && /\d/.test(s) && !/[a-z]{2,}/i.test(s);
/** A true minus in a maths option (never a hyphen). */
export const optionText = (s: string): string => (mathy(s) ? s.replace(/-/g, "−") : s);

/**
 * The options the slide shows, at most `HINGE_MAX`, and the right one's place among them. Past the
 * cap the last options are dropped (the slide is flagged), but never the right answer: when it is
 * one of the dropped, the last wrong option kept goes instead, so the question is never lost.
 */
export function keptHinge(input: TemplateInput): { choices: HingeChoice[]; correct: number } {
  const all = hingeChoices(input);
  const right = Number(input.correct);
  const r = Number.isInteger(right) && right >= 1 && right <= all.length ? right - 1 : -1;
  const keep = all.map((_, k) => k);
  for (let k = keep.length - 1; keep.length > HINGE_MAX && k >= 0; k--)
    if (k !== r) keep.splice(k, 1);
  return { choices: keep.map((k) => all[k] as HingeChoice), correct: keep.indexOf(r) + 1 };
}

/** The options as choices: `choices` when given, else the plain `options`. */
export function hingeChoices(input: TemplateInput): HingeChoice[] {
  // An option is a string; anything else a caller passes reads as its `text` (never a crash).
  const opts = input.options?.map((o: unknown) =>
    typeof o === "string" ? o : String((o as { text?: unknown } | null)?.text ?? ""),
  );
  const ch = input.choices;
  if (!ch?.length) return (opts ?? []).map((text) => ({ text }));
  // An edited option list (the editor's relayout writes `options`) wins over the writer's
  // choices when it no longer lines up with them; matching lists keep each choice's icon and why.
  if (!opts?.length) return ch;
  if (opts.length !== ch.length) return opts.map((text) => ({ text }));
  return ch.map((c, k) => ({ ...c, text: opts[k] ?? c.text }));
}

/**
 * Which input path each element shows, in draw order (the editor's layout ref binding): the
 * question (`stem` when there is one, else `heading`) and each card's words. A stacked fraction's
 * two numbers are not bound one by one (the option is edited whole in the side panel).
 */
export function hingePaths(els: SlideElement[]): (string | undefined)[] {
  const cards = els.filter((e) => e.name === HINGE_NAMES.card);
  const fraction = new Set(
    cards
      .filter((c) => els.some((e) => e.name === HINGE_NAMES.bar && within(e, c)))
      .map((c) => c.id),
  );
  return els.map((el) => {
    if (el.name === "Heading") return "heading";
    if (el.name === "Stem") return "stem";
    if (el.name !== HINGE_NAMES.text) return undefined;
    const k = cards.findIndex((c) => within(el, c));
    return k < 0 || fraction.has((cards[k] as SlideElement).id) ? undefined : `options.${k}`;
  });
}
const within = (e: SlideElement, c: SlideElement) =>
  e.x >= c.x && e.y >= c.y && e.x + e.w <= c.x + c.w + 0.5 && e.y + e.h <= c.y + c.h + 0.5;

/**
 * Which look the options take (ruling 161): tiles when every option has an icon the library
 * draws and there is no figure, a grid when every option fits one line in its cell, else rows.
 */
export function hingeLookOf(c: Ctx, input: TemplateInput): HingeLook {
  return plan(c, input).look;
}

type Plan = {
  look: HingeLook;
  size: number;
  ok: boolean;
  /** Rows: the key size, the card's vertical padding and the shared card height. */
  key: number;
  py: number;
  cardH: number;
  cols: number;
  /** The gap between cards (closed up on the last rows rung). */
  gap: number;
  /** Tiles: tile height and icon size. */
  icon: number;
  icons: (string | null)[];
};

type Geo = { x: number; w: number; top: number; bottom: number; fig: boolean };

function ageOf(c: Ctx): Age {
  return v2Profile(c.t).age;
}

function linesAt(c: Ctx, s: string, w: number, size: number, weight: number): number {
  if (FRACTION.test(s)) return 2;
  return countLines(optionText(s), "body", c.t, w, weight, size);
}

function tryTiles(
  c: Ctx,
  ch: HingeChoice[],
  g: Geo,
  a: AgeSpec,
  icons: (string | null)[],
): Plan | null {
  const n = ch.length;
  const tw = (g.w - (n - 1) * GAP) / n;
  const h = Math.min(g.bottom - g.top, a.tileMax);
  const size = a.tileLabel;
  const inner = tw - 2 * pt(24);
  const fits = ch.every(
    (o) =>
      kit.wordsFit(c, o.text, "body", inner, size, 600) &&
      linesAt(c, o.text, inner, size, 600) <= 2,
  );
  if (!fits) return null;
  const lab = Math.max(...ch.map((o) => linesAt(c, o.text, inner, size, 600))) * size * 1.1;
  const icon = Math.floor(Math.min(tw - pt(56), h - lab - pt(32) * 2 - pt(16) - pt(8), a.iconMax));
  return {
    look: "tiles",
    size,
    ok: icon > 40,
    key: a.key,
    py: 0,
    cardH: h,
    gap: GAP,
    cols: n,
    icon,
    icons,
  };
}

function tryGrid(c: Ctx, ch: HingeChoice[], g: Geo, a: AgeSpec, keyPx: number): Plan | null {
  const n = ch.length;
  const cols = n === 4 ? 2 : n;
  const rows = Math.ceil(n / cols);
  const key = keyPx;
  const cellW = (g.w - (cols - 1) * GAP) / cols;
  const tw = cellW - pt(32) - key - pt(32) - pt(72);
  // `cellMax` is already in points (it was converted twice, so cards stood at 2/3 of the gold's).
  const cellH = Math.min(a.cellMax, Math.floor((g.bottom - g.top - (rows - 1) * GAP) / rows));
  // The gold's grid ladder: its start size down to its grid floor in 2 px steps.
  for (const size of rungs(a.grid, a.gridFloor, ex(2))) {
    if (ch.every((o) => FRACTION.test(o.text) || linesAt(c, o.text, tw, size, 600) === 1))
      return {
        look: "grid",
        size,
        ok: true,
        key,
        py: 0,
        cardH: cellH,
        gap: GAP,
        cols,
        icon: 0,
        icons: [],
      };
  }
  return null;
}

/** The gold's comfort size (`floor + 4` px), held at the stage's reading floor by `plan`. */
const comfortOf = (a: AgeSpec) => a.comfort;

function tryRows(c: Ctx, ch: HingeChoice[], g: Geo, a: AgeSpec, keyPx: number): Plan {
  const n = ch.length;
  const room = g.bottom - g.top;
  const specs = [
    { key: keyPx, py: 0.55, min: comfortOf(a), gap: GAP },
    { key: keyPx - 5, py: 0.42, min: a.floor, gap: GAP },
    // Last rung (y11 s11): closer cards and padding before anything is flagged.
    { key: keyPx - 5, py: 0.22, min: a.floor, gap: pt(10) },
  ];
  for (const sp of specs) {
    const tw = g.w - pt(28) - sp.key - pt(28) - Math.round(sp.key * 0.78) - pt(48);
    let best: { s: number; wraps: number; h: number } | null = null;
    // The gold's rows ladder: its ceiling down to the rung's smallest size in 1 px steps.
    for (const s of rungs(a.ceil, sp.min, ex(1))) {
      const ls = ch.map((o) => linesAt(c, o.text, tw, s, 500));
      if (ls.some((l) => l > 2)) continue;
      const py = Math.round(s * sp.py);
      const h = Math.ceil(Math.max(sp.key, Math.max(...ls) * s * LINE_H) + 2 * py);
      if (h * n + sp.gap * (n - 1) > room + 0.5) continue;
      const wraps = ls.filter((l) => l > 1).length;
      // Largest size that fits wins; a smaller one only if it saves every wrap and costs <= 4px.
      if (!best) best = { s, wraps, h };
      else if (wraps === 0 && best.wraps > 0 && best.s - s <= ex(4) + 1e-6)
        best = { s, wraps: 0, h };
      if (wraps === 0 || best.s - s > ex(4) + 1e-6) break;
    }
    if (best)
      return {
        look: "rows",
        size: best.s,
        ok: true,
        key: sp.key,
        py: Math.round(best.s * sp.py),
        cardH: best.h,
        gap: sp.gap,
        cols: 1,
        icon: 0,
        icons: [],
      };
  }
  // Nothing fits: the floor and compact cards, flagged.
  const sp = specs[2] as (typeof specs)[number];
  const s = a.floor;
  const tw = g.w - pt(28) - sp.key - pt(28) - Math.round(sp.key * 0.78) - pt(48);
  const ls = ch.map((o) => linesAt(c, o.text, tw, s, 500));
  const py = Math.round(s * sp.py);
  const h = Math.ceil(Math.max(sp.key, Math.max(...ls) * s * LINE_H) + 2 * py);
  return {
    look: "rows",
    size: s,
    ok: false,
    key: sp.key,
    py,
    cardH: h,
    gap: sp.gap,
    cols: 1,
    icon: 0,
    icons: [],
  };
}

function geometry(c: Ctx, input: TemplateInput, headBottom: number, n: number, fig: boolean): Geo {
  const top = Math.round(headBottom + pt(n <= 2 ? 80 : 72));
  const figW = fig ? (input.figure && "photo" in input.figure ? pt(400) : pt(440)) : 0;
  return { x: X0, w: X1 - X0 - (fig ? figW + FIG_GAP : 0), top, bottom: H - FOOT, fig };
}

function plan(
  c: Ctx,
  input: TemplateInput,
  headBottom = 120,
): Plan & { geo: Geo; choices: HingeChoice[] } {
  const { choices } = keptHinge(input);
  const fig = !!input.figure;
  const g = geometry(c, input, headBottom, choices.length, fig);
  // Ruling 21 A: the gold's own ladders, never under the stage's reading floor (ruling 162,
  // bodySmall: KS1 28, KS2 25, KS3+ 21pt). The sizes are drawn as given (`fixedSize`).
  const a = heldAt(AGES()[ageOf(c)], c.s.small);
  const labels = choices.map((o) => o.icon?.trim() ?? "");
  const res = labels.every(Boolean) ? resolveIcons(labels) : null;
  const iconOk = !!res?.complete && !fig;
  const p =
    (iconOk ? tryTiles(c, choices, g, a, res?.ids ?? []) : null) ??
    tryGrid(c, choices, g, a, a.key) ??
    tryRows(c, choices, g, a, a.key);
  return { ...p, geo: g, choices };
}

/** The gold's sizes held at `floor` (the stage's reading floor). */
function heldAt(g0: AgeSpec, floor: number): AgeSpec {
  const at = (s: number) => Math.max(s, floor);
  return {
    ...g0,
    comfort: at(g0.comfort),
    floor: at(g0.floor),
    ceil: at(g0.ceil),
    grid: at(g0.grid),
    gridFloor: at(g0.gridFloor),
    tileLabel: at(g0.tileLabel),
  };
}

/** The speaker notes line for each wrong option's why (ruling 241). */
export function hingeNotes(
  choices: HingeChoice[],
  correct: number | undefined,
  letters: readonly string[],
): string {
  return choices
    .map((o, k) => (k + 1 !== correct && o.why?.trim() ? `${letters[k]}: ${o.why.trim()}` : ""))
    .filter(Boolean)
    .join("\n");
}

/** Lays the hinge into `c`: title, sand stage, answer cards, the figure, the answer and notes. */
export function layoutHinge(c: Ctx, input: TemplateInput) {
  const all = hingeChoices(input);
  if (all.length > HINGE_MAX) c.over.push(`hinge options ${all.length}/${HINGE_MAX}`);
  if (all.length < HINGE_MIN) c.over.push(`hinge options ${all.length}/${HINGE_MIN}`);
  const letters = HINGE_LETTERS[input.letters ?? "latin"];
  const age = ageOf(c);

  // The question is the title.
  const q = (input.stem?.trim() || input.heading).trim();
  let headBottom = 46;
  if (q) {
    // The question may take two lines (gold: about 12 words); the stage starts under it.
    const n0 = c.over.length;
    const el = kit.heading(c, q);
    c.over.length = n0;
    const lines = Math.round(el.h / ((el.style?.fontSize ?? c.s.heading) * kit.LH.heading));
    if (lines > 2) c.over.push(`hinge question ${lines} lines`);
    // The stem is the question when there is one: the title is bound to it (`hingePaths`).
    if (input.stem?.trim()) el.name = "Stem";
    accent(c, el, input.accentWord);
    headBottom = el.y + el.h;
  }
  c.bodyFromHeading = true;
  const p = plan(c, input, headBottom);
  const { geo: g, choices } = p;
  const n = choices.length;
  if (!p.ok) c.over.push(`hinge ${p.look} under the ${age} floor`);

  // Content block, centred in the stage.
  const rowsN = Math.ceil(n / p.cols);
  const blockH = rowsN * p.cardH + (rowsN - 1) * p.gap;
  const top = Math.max(g.top, Math.round(g.top + (g.bottom - g.top - blockH) / 2));
  const stage = paintSurface(
    {
      id: uid(),
      role: "field-b",
      box: { x: 0, y: g.top - FIELD_ABOVE, w: W, h: H - g.top + FIELD_ABOVE },
    },
    c.t,
  );
  if (stage) c.els.splice(0, 0, stage);

  const cardW = (g.w - (p.cols - 1) * p.gap) / p.cols;
  const ids: string[] = [];
  choices.forEach((o, k) => {
    const col = k % p.cols;
    const row = Math.floor(k / p.cols);
    const box = {
      x: Math.round(g.x + col * (cardW + p.gap)),
      y: Math.round(top + row * (p.cardH + p.gap)),
      w: Math.round(cardW),
      h: p.cardH,
    };
    const card = cardOf(c, box, HINGE_NAMES.card);
    ids.push(card.id);
    const letter = letters[k] ?? String(k + 1);
    if (p.look === "tiles") {
      key(c, letter, k, box.x + pt(24), box.y + pt(24), p.key);
      const id = p.icons[k];
      const label = o.text;
      const inner = box.w - 2 * pt(24);
      const lab = Math.ceil(linesAt(c, label, inner, p.size, 600) * p.size * 1.1);
      const free = box.h - pt(32) * 2 - pt(16) - lab;
      const iy = box.y + pt(32) + Math.max(0, (free - p.icon) / 2);
      if (id)
        c.els.push(
          iconImage(
            id,
            c.t,
            {
              x: Math.round(box.x + (box.w - p.icon) / 2),
              y: Math.round(iy),
              w: p.icon,
              h: p.icon,
            },
            v2Colors(c.t).ink ?? c.t.colors.ink,
            HINGE_NAMES.icon,
            label,
          ),
        );
      optionWords(
        c,
        label,
        { x: box.x + pt(24), y: iy + p.icon + pt(16), w: inner },
        p.size,
        600,
        "center",
        1.1,
      );
    } else {
      const px = p.look === "grid" ? pt(32) : pt(28);
      const gapK = p.look === "grid" ? pt(32) : pt(28);
      const right = p.look === "grid" ? pt(72) : Math.round(p.key * 0.78) + pt(48);
      key(c, letter, k, box.x + px, box.y + (box.h - p.key) / 2, p.key);
      const tx = box.x + px + p.key + gapK;
      const tw = box.w - (tx - box.x) - right;
      optionWords(
        c,
        o.text,
        { x: tx, y: box.y, w: tw, h: box.h },
        p.size,
        p.look === "grid" ? 600 : 500,
        "left",
        LINE_H,
      );
    }
  });

  if (g.fig && input.figure) {
    const figW = X1 - (g.x + g.w + FIG_GAP);
    const fh = Math.max(blockH, 200);
    kit.figurePanel(c, input.figure, {
      x: X1 - figW,
      y: Math.round(top + (blockH - fh) / 2),
      w: figW,
      h: fh,
    });
  }

  // The answer is question data on the cards, counted from 1 (TEACH-110 part u).
  // Counted among the options kept (`keptHinge`): a dropped 5th never takes the right answer.
  const right = keptHinge(input).correct;
  if (right >= 1 && right <= ids.length)
    c.question = {
      type: "multiple-choice",
      options: ids.map((id, k) => ({ id, correct: k === right - 1 })),
      // The gold reveals in one click: every wrong card fades and the right one is marked.
      oneStep: true,
      ...(input.explanation?.trim() ? { explanation: input.explanation.trim() } : {}),
    };
  const notes = hingeNotes(choices, right || undefined, letters);
  if (notes) c.notes = notes;
  c.fields = fieldsOf(choices, age);
  c.tight =
    p.ok &&
    p.look === "rows" &&
    (p.gap < GAP || p.size < comfortOf(heldAt(AGES()[age], c.s.small)) - 1e-6);
}

function cardOf(
  c: Ctx,
  box: { x: number; y: number; w: number; h: number },
  name: string,
): SlideElement {
  const own: Corners = [CARD_R, CARD_R, CARD_R, CARD_R];
  const el = paintSurface({ id: uid(), role: "card", box, own }, c.t);
  if (el) {
    const { locked: _l, ...free } = el;
    const named = { ...free, name } as SlideElement;
    c.els.push(named);
    return named;
  }
  return kit.box(c, box, c.t.colors.surface, { radius: CARD_R, name });
}

/**
 * Themes whose hinge gold gives each letter its own colour (TEACH-215 part i, cause C14): round 3's
 * per-letter option tones (`themes3.css` `--opt-1..4` on `[data-k]`, the product's `OPTION_TONES`)
 * and the round 5 darks (`themes5.css`). Paper, Poster, Storytime, Scrapbook, Calm and Geometric keep
 * one key colour: round 4 resets their `[data-k]` keys (`themes4.css`), and Paper defines no tones.
 */
export const HINGE_TONED_KEYS: ReadonlySet<string> = new Set([
  "treehouse",
  "reading-room",
  "beacon",
  "crayon",
  "exam-hall",
  "playground",
  "splash",
  "studio",
  "dark-slate",
  "dark-ember",
]);

/** A key's letter colour: of the card's two colours, the one that reads best on `fill`. */
const letterOn = (fill: string, a: string, b: string) =>
  contrastRatio(a, fill) >= contrastRatio(b, fill) ? a : b;

/** The rounded-square letter key, a card a pupil holds up (never the round number badge). */
function key(c: Ctx, letter: string, k: number, x: number, y: number, d: number) {
  // The gold's key is the card's ink with the letter in the card's fill (on dark themes a pale key
  // with a dark letter); the `key` role's accent would be a second red on the slide.
  const card = surfaceStyle(c.t, "card");
  const ink = card.ink ?? c.t.colors.ink;
  // The theme's key family (THEMING.md section 6: outline, sticky, notch ...), never its badge.
  const s = surfacesOf(c.t);
  const tone = HINGE_TONED_KEYS.has(c.t.id) ? optionTones(c.t)[k] : undefined;
  // A theme whose gold keys wear its accent (Geometric) takes the `key` role's fill and ink; a
  // theme whose gold colours each letter takes that letter's tone, its letter in the card's fill
  // (white on the light themes, the dark card on the darks) or ink, whichever reads better.
  const look =
    s.marks.keyFill === "accent"
      ? markLook(c.t, "key", d, s.roles.key.fill, s.roles.key.ink ?? c.t.colors.onAccent)
      : tone
        ? markLook(c.t, "key", d, tone, letterOn(tone, card.fill, ink))
        : markLook(c.t, "key", d, ink, card.fill);
  const st = { fill: look.fill, ink: look.ink };
  c.els.push({
    id: uid(),
    type: "shape",
    shape: look.shape,
    x: Math.round(x),
    y: Math.round(y),
    w: d,
    h: d,
    ...(look.radius != null ? { radius: look.radius } : {}),
    ...(look.stroke ? { stroke: look.stroke, strokeWidth: look.strokeWidth } : {}),
    ...(look.rotation ? { rotation: look.rotation } : {}),
    ...(look.shadow ? { shadow: look.shadow } : {}),
    fill: st.fill,
    name: HINGE_NAMES.key,
    doc: kit.doc(letter),
    textStyle: {
      preset: "heading",
      // The gold's letter is the key's size x 0.52 (hinge.html `.key`), a layout size.
      fontSize: d * 0.52,
      fixedSize: true,
      fontWeight: 700,
      color: st.ink ?? c.t.colors.onAccent,
      align: "center",
      valign: "middle",
      padding: 0,
    },
  } as ShapeElement);
}

/** An option's words, centred on `rect.h` when given; a fraction stacked over a bar. */
function optionWords(
  c: Ctx,
  value: string,
  rect: { x: number; y: number; w: number; h?: number },
  size: number,
  weight: number,
  align: "left" | "center",
  lh: number,
) {
  const ink = surfaceStyle(c.t, "card").ink ?? c.t.colors.ink;
  const m = FRACTION.exec(value);
  if (m) {
    // The gold's stacked fraction is 0.92 of the option size, held at the reading floor.
    const s = Math.max(size * 0.92, c.s.small);
    const lineH = Math.ceil(s * 1.05);
    const total = 2 * lineH + 3;
    const y = rect.h != null ? rect.y + (rect.h - total) / 2 : rect.y;
    const numW = Math.ceil(
      s * 0.62 * Math.max((m[1] as string).length, (m[2] as string).length) + s * 0.25,
    );
    const x = align === "center" ? rect.x + (rect.w - numW) / 2 : rect.x;
    const part = (t: string, yy: number) =>
      textAt(c, t, { x, y: yy, w: numW }, s, weight, "center", 1.05, ink);
    part(m[1] as string, y);
    c.els.push({
      id: uid(),
      type: "shape",
      shape: "rect",
      x: Math.round(x),
      y: Math.round(y + lineH + 1),
      w: numW,
      h: 2,
      fill: ink,
      name: HINGE_NAMES.bar,
    } as ShapeElement);
    part(m[2] as string, y + lineH + 3);
    return;
  }
  const t = optionText(value);
  const lines = countLines(t, "body", c.t, rect.w, weight, size);
  const h = Math.ceil(lines * size * lh);
  const y = rect.h != null ? rect.y + (rect.h - h) / 2 : rect.y;
  textAt(c, t, { x: rect.x, y, w: rect.w }, size, weight, align, lh, ink);
}

function textAt(
  c: Ctx,
  value: string,
  rect: { x: number; y: number; w: number },
  size: number,
  weight: number,
  align: "left" | "center",
  lh: number,
  color: string,
): TextElement {
  const lines = countLines(value, "body", c.t, rect.w, weight, size);
  const el: TextElement = {
    id: uid(),
    type: "text",
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.w),
    h: Math.ceil(lines * size * lh),
    doc: kit.doc(value),
    name: HINGE_NAMES.text,
    style: {
      preset: "body",
      autoHeight: true,
      fontSize: size,
      fixedSize: true,
      lineHeight: lh,
      fontWeight: weight,
      padding: 0,
      color,
      ...(align === "center" ? { align } : {}),
    },
  };
  c.els.push(el);
  return el;
}

/** The title's accent word in the theme accent (the slide's one red thing before the reveal). */
function accent(c: Ctx, el: TextElement, word: string | null | undefined) {
  const w = word?.trim();
  if (!w) return;
  const text = el.doc.content?.[0]?.content?.map((r) => ("text" in r ? r.text : "")).join("") ?? "";
  const at = text.indexOf(w);
  if (at < 0) return;
  const parts = [text.slice(0, at), w, text.slice(at + w.length)];
  el.doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: parts
          .map((t, i) =>
            i === 1
              ? {
                  type: "text",
                  text: t,
                  marks: [{ type: "textStyle", attrs: { color: c.t.colors.accent } }],
                }
              : { type: "text", text: t },
          )
          .filter((r) => r.text),
      },
    ],
  } as TextElement["doc"];
}

type Caps = Record<
  Age,
  { words: number; maxWords: number; chars: number; maxChars: number; options: number }
>;
/** The measured caps (`hinge-capacity.json`, written by `measureHingeCapacity`). */
export const HINGE_CAPS = CAPACITY as Caps;

/** One counter per option: its length against the measured comfortable cap and hard maximum. */
function fieldsOf(choices: HingeChoice[], age: Age): FieldReport[] {
  const cap = HINGE_CAPS[age];
  return choices.map((o, k) => {
    const chars = o.text.length;
    return {
      field: `Option ${k + 1}`,
      path: `options.${k}`,
      chars,
      cap: cap.chars,
      hardMax: cap.maxChars,
      tight: chars > cap.chars,
      over: chars > cap.maxChars,
    };
  });
}

export const HINGE_AGES = AGES;
