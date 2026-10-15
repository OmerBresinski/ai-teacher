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
import { uid } from "../factories";
import { countLines } from "../text-measure";
import { resolveFontSize } from "../text-style";
import { MIN_FONT_SIZE } from "../themes";
import { type Corners, paintSurface, surfaceStyle } from "../themes/surfaces";
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
/** Gold px x 2/3. */
const pt = (px: number) => Math.round((px * 2) / 3);
const GAP = pt(20);
const FOOT = pt(64);
const FIELD_ABOVE = pt(40);
const CARD_R = pt(20);
const LINE_H = 1.24;
const FIG_GAP = pt(48);

type AgeSpec = {
  key: number;
  floor: number;
  ceil: number;
  grid: number;
  gridFloor: number;
  cellMax: number;
  tileMax: number;
  tileLabel: number;
  iconMax: number;
};
/** The gold's `AGE` table (hinge.html) in points; floors never under master's body floor. */
function AGES(): Record<Age, AgeSpec> {
  const raw = {
    early: [72, 34, 48, 56, 44, 200, 470, 48, 280],
    primary: [64, 28, 40, 50, 34, 170, 420, 40, 250],
    secondary: [58, 28, 36, 46, 32, 170, 420, 36, 250],
  } as const;
  const out = {} as Record<Age, AgeSpec>;
  for (const [age, v] of Object.entries(raw) as [Age, readonly number[]][]) {
    const [key, floor, ceil, grid, gridFloor, cellMax, tileMax, tileLabel, iconMax] = v.map(
      pt,
    ) as number[];
    const f = MIN_FONT_SIZE.body;
    out[age] = {
      key: key as number,
      floor: Math.max(f, floor as number),
      ceil: Math.max(f, ceil as number),
      grid: Math.max(f, grid as number),
      gridFloor: Math.max(f, gridFloor as number),
      cellMax: cellMax as number,
      tileMax: tileMax as number,
      tileLabel: Math.max(f, tileLabel as number),
      iconMax: iconMax as number,
    };
  }
  return out;
}

/** "2/5" set as a stacked fraction. */
const FRACTION = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;
/** Maths options: digits and operators only. */
const mathy = (s: string) => /^[\d\s.+\-−×÷=()/a-z]+$/i.test(s) && /\d/.test(s);
/** A true minus in a maths option (never a hyphen). */
export const optionText = (s: string): string => (mathy(s) ? s.replace(/-/g, "−") : s);

/** The options as choices: `choices` when given, else the plain `options`. */
export function hingeChoices(input: TemplateInput): HingeChoice[] {
  if (input.choices?.length) return input.choices;
  return (input.options ?? []).map((text) => ({ text }));
}

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
  return countLines(optionText(s), "body", c.t, w, weight, resolveFontSize(c.t, "body", size));
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
  const size = resolveFontSize(c.t, "body", a.tileLabel);
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
  const cellH = Math.min(pt(a.cellMax), Math.floor((g.bottom - g.top - (rows - 1) * GAP) / rows));
  for (let s = a.grid; s >= a.gridFloor; s -= 1) {
    const size = resolveFontSize(c.t, "body", s);
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

/** The gold's comfort size (NOTES caps): 30px from KS2, 38px (floor + 4) at KS1. */
const comfortOf = (a: AgeSpec) => Math.max(MIN_FONT_SIZE.body, a.key > pt(70) ? pt(38) : pt(30));

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
    for (let s0 = a.ceil; s0 >= sp.min; s0 -= 1) {
      const s = resolveFontSize(c.t, "body", s0);
      const ls = ch.map((o) => linesAt(c, o.text, tw, s, 500));
      if (ls.some((l) => l > 2)) continue;
      const py = Math.round(s * sp.py);
      const h = Math.ceil(Math.max(sp.key, Math.max(...ls) * s * LINE_H) + 2 * py);
      if (h * n + sp.gap * (n - 1) > room + 0.5) continue;
      const wraps = ls.filter((l) => l > 1).length;
      // Largest size that fits wins; a smaller one only if it saves every wrap and costs <= 3pt.
      if (!best) best = { s, wraps, h };
      else if (wraps === 0 && best.wraps > 0 && best.s - s <= 3) best = { s, wraps: 0, h };
      if (wraps === 0 || best.s - s > 3) break;
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
  const s = resolveFontSize(c.t, "body", a.floor);
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
  const choices = hingeChoices(input).slice(0, HINGE_MAX);
  const fig = !!input.figure;
  const g = geometry(c, input, headBottom, choices.length, fig);
  // Master's key-stage scale (ruling 91) sets body and one step under it: the gold's px ceilings
  // sit under some stages' body step, so the ladder starts at body at least.
  const g0 = AGES()[ageOf(c)];
  const body = c.s.body;
  const a = {
    ...g0,
    ceil: Math.max(g0.ceil, body),
    grid: Math.max(g0.grid, body),
    gridFloor: Math.max(g0.gridFloor, body),
    floor: Math.min(g0.floor, body),
  };
  const labels = choices.map((o) => o.icon?.trim() ?? "");
  const res = labels.every(Boolean) ? resolveIcons(labels) : null;
  const iconOk = !!res?.complete && !fig;
  const p =
    (iconOk ? tryTiles(c, choices, g, a, res?.ids ?? []) : null) ??
    tryGrid(c, choices, g, a, a.key) ??
    tryRows(c, choices, g, a, a.key);
  return { ...p, geo: g, choices };
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
      key(c, letter, box.x + pt(24), box.y + pt(24), p.key);
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
      key(c, letter, box.x + px, box.y + (box.h - p.key) / 2, p.key);
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
  const right = Number(input.correct);
  if (Number.isInteger(right) && right >= 1 && right <= ids.length)
    c.question = {
      type: "multiple-choice",
      options: ids.map((id, k) => ({ id, correct: k === right - 1 })),
      ...(input.explanation?.trim() ? { explanation: input.explanation.trim() } : {}),
    };
  const notes = hingeNotes(choices, Number.isInteger(right) ? right : undefined, letters);
  if (notes) c.notes = notes;
  c.fields = fieldsOf(choices, age);
  c.tight = p.ok && p.look === "rows" && (p.gap < GAP || p.size < comfortOf(AGES()[age]));
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

/** The rounded-square letter key, a card a pupil holds up (never the round number badge). */
function key(c: Ctx, letter: string, x: number, y: number, d: number) {
  const st = surfaceStyle(c.t, "key");
  c.els.push({
    id: uid(),
    type: "shape",
    shape: "rounded",
    x: Math.round(x),
    y: Math.round(y),
    w: d,
    h: d,
    radius: Math.round(d * 0.24),
    fill: st.fill,
    name: HINGE_NAMES.key,
    doc: kit.doc(letter),
    textStyle: {
      preset: "heading",
      fontSize: resolveFontSize(c.t, "heading", Math.round(d * 0.52)),
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
    const s = resolveFontSize(c.t, "body", Math.round(size * 0.92));
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
