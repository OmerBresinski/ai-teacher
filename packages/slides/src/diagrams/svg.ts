/**
 * The drawing kit every diagram kind shares: the theme's colours and type as SVG attributes, text
 * measured with the same advance widths the fit engine uses (`font-metrics.generated.ts`), greedy
 * wrapping, and the few marks (arrowheads, braces) more than one kind draws. Pure string building.
 */
import type { Theme } from "@tj/domain/documents";
import { ADVANCES } from "../font-metrics.generated";
import { FONT_STACKS, type FontKey } from "../fonts";
import { typeScale } from "../themes";
import { headFor, STROKE, TYPE_FLOOR, WEIGHT, washes } from "./style";

/** The colours a diagram draws in, all from the theme. */
export type Palette = {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  onAccent: string;
  line: string;
  /** The accent washed into the ground: part fills, box fills, zebra rows. */
  tint: string;
  /** The second accent washed into the ground. */
  tint2: string;
};

/** Everything a kind's renderer needs: palette, families, the label size. */
export type Ctx = {
  /** The smallest label the drawing may set: the stage's bodySmall step, or the type floor. */
  minFs: number;
  c: Palette;
  body: string;
  title: string;
  /** The body family's stack, for measuring. */
  stack: string;
  /** The heading family's stack, for measuring a title (`titleCtx`). */
  titleStack?: string;
  /** A dark theme: washes and ramps come from ink, not the accent. */
  dark?: boolean;
  /** The label size in slide points: never below the type floor, 18 (the back of the room). */
  fs: number;
  /** When set, every text block drawn is recorded here (`diagramFaults` reads the geometry). */
  rec?: DrawnText[];
  /** With `rec`: the drawing's own strokes (outlines, lines, arrows) as segments, in points. */
  strokes?: [number, number, number, number][];
  /** With `rec`: faults a renderer finds in its own layout (a squashed plot). */
  faults?: string[];
  /** With `rec`: each arrow's tip and the box it points at (the geometry checks). */
  arrows?: { tip: [number, number]; target: { x0: number; y0: number; x1: number; y1: number } }[];
  /** With `rec`: every leader line drawn from a label to its point (the crossing check). */
  leaders?: [number, number, number, number][];
  /** With `rec`: each value axis's top and the largest value drawn against it. */
  axes?: { name: string; max: number; data: number }[];
};

/** One drawn text block: its box in the drawing's points, its words, and whether a line was cut. */
export type DrawnText = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  cut: boolean;
  /** The size it is set at, in slide points. */
  fs?: number;
};

export type Tone = "accent" | "accent2" | "muted" | "surface" | "none";

const hex = (s: string): [number, number, number] | undefined => {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (!m?.[1]) return undefined;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** `a` mixed into `b` at `share` (0 = all b). Non-hex colours give `b`. */
export function mix(a: string, b: string, share: number): string {
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return b;
  const ch = (i: 0 | 1 | 2) =>
    Math.round(x[i] * share + y[i] * (1 - share))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/**
 * A CSS stack without its `var(--font-*)` part, which an SVG outside the editor's DOM cannot resolve:
 * the variable becomes the family it names ("Lexend Variable"), then the stack's own fallbacks.
 */
const VAR_FAMILY: Record<string, string> = {
  lexend: "Lexend Variable",
  gabarito: "Gabarito Variable",
  figtree: "Figtree Variable",
  "source-serif": "Source Serif 4 Variable",
  schibsted: "Schibsted Grotesk Variable",
  literata: "Literata Variable",
  "public-sans": "Public Sans Variable",
  bricolage: "Bricolage Grotesque Variable",
  "instrument-sans": "Instrument Sans Variable",
  atkinson: "Atkinson Hyperlegible Next Variable",
  fredoka: "Fredoka Variable",
  playpen: "Playpen Sans Variable",
  baloo: "Baloo 2 Variable",
  nunito: "Nunito Variable",
  outfit: "Outfit Variable",
  geist: "Geist Variable",
};

export function family(stack: string): string {
  return stack
    .replace(/var\(--font-([a-z0-9-]+)\)/g, (_, k: string) => `'${VAR_FAMILY[k] ?? k}'`)
    .replace(/"/g, "'");
}

export function context(t: Theme, w: number, h: number, fs?: number): Ctx {
  const bg = t.colors.background;
  const surface = t.colors.panel ?? t.colors.surface;
  return {
    c: {
      bg,
      surface,
      ink: t.colors.ink,
      muted: t.colors.muted,
      accent: t.colors.accent,
      accent2: t.colors.accent2,
      onAccent: t.colors.onAccent,
      line: t.colors.line,
      ...washes(t, surface, mix),
    },
    dark: !!t.dark,
    body: family(t.fonts.body),
    title: family(t.fonts.title),
    stack: t.fonts.body,
    titleStack: t.fonts.title,
    // Round A6: labels a step larger (a 403-wide panel draws 24, was 20), so a class reads them.
    // A drawing sized to its content (UX ruling 155) keeps the label size of its full panel.
    // FIX-TYPE: at a key stage a label is never under the stage's bodySmall step (`typeScale`),
    // whoever asked for the size; a drawing is only ever scaled up into its zone.
    minFs: Math.max(TYPE_FLOOR, typeScale(t)?.bodySmall ?? 0),
    fs: Math.max(
      typeScale(t)?.bodySmall ?? 0,
      fs ?? Math.max(TYPE_FLOOR, Math.min(26, Math.round(Math.min(w, h) / 16))),
    ),
  };
}

/** `x` drawing and measuring in the heading family: for a diagram's own title. */
export const titleCtx = (x: Ctx): Ctx => ({ ...x, body: x.title, stack: x.titleStack ?? x.stack });

export function toneFill(c: Palette, tone: Tone | undefined, fallback: Tone = "surface"): string {
  switch (tone ?? fallback) {
    case "accent":
      return c.accent;
    case "accent2":
      return c.accent2;
    case "muted":
      return c.tint2;
    case "surface":
      return c.surface;
    default:
      return "none";
  }
}

const KEY_BY_STACK = new Map<string, FontKey>(
  Object.entries(FONT_STACKS).map(([key, stack]) => [stack, key as FontKey]),
);

/** How wide `s` is at `fs` in the body family, in points (unknown glyphs count as 0.62 em). */
export function textWidth(s: string, x: Ctx, fs = x.fs, weight: number = WEIGHT.label): number {
  const key = KEY_BY_STACK.get(x.stack);
  const table = key ? ADVANCES[key] : undefined;
  const adv = table ? (weight >= 650 ? table[700] : weight >= 500 ? table[600] : table[400]) : [];
  let em = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const a = code >= 32 && code <= 126 ? adv[code - 32] : undefined;
    em += a === undefined ? 0.62 : a / 1000;
  }
  return em * fs;
}

/**
 * `s` broken into lines no wider than `maxW`, at most `maxLines` of them; a last line that still
 * overflows is cut with an ellipsis. Deterministic, greedy, no hyphenation.
 */
export function wrap(
  s: string,
  x: Ctx,
  maxW: number,
  maxLines = 2,
  fs = x.fs,
  weight: number = WEIGHT.label,
) {
  const words = s
    .trim()
    .split(/[^\S\u00a0]+/)
    .filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (!cur || textWidth(next, x, fs, weight) <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  while (last.length > 1 && textWidth(`${last}…`, x, fs, weight) > maxW) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A number for an attribute: two decimals at most. */
export const n = (v: number) => String(Math.round(v * 100) / 100);

export type TextOpts = {
  fs?: number;
  weight?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  /** Where `y` sits against the block: its middle (default), its top or its bottom. */
  v?: "middle" | "top" | "bottom";
  family?: string;
  /** A ground-coloured outline so the words read over lines they cross. */
  halo?: string;
  lh?: number;
};

/** One or more lines of text as a `<text>`, anchored at (`x`, `y`). */
export function text(x: Ctx, px: number, py: number, lines: string[], o: TextOpts = {}): string {
  const fs = o.fs ?? x.fs;
  const lh = (o.lh ?? 1.2) * fs;
  const block = (lines.length - 1) * lh;
  const top =
    o.v === "top"
      ? py + fs * 0.8
      : o.v === "bottom"
        ? py - block - fs * 0.25
        : py - block / 2 + fs * 0.35;
  const halo = o.halo
    ? ` stroke="${o.halo}" stroke-width="${n(fs * 0.28)}" stroke-linejoin="round" paint-order="stroke"`
    : "";
  if (x.rec && lines.length > 0) {
    const bw = Math.max(...lines.map((l) => textWidth(l, x, fs, o.weight ?? WEIGHT.label)));
    const anchor = o.anchor ?? "middle";
    const x0 = anchor === "middle" ? px - bw / 2 : anchor === "end" ? px - bw : px;
    x.rec.push({
      x0,
      x1: x0 + bw,
      y0: top - fs * 0.8,
      y1: top + block + fs * 0.25,
      text: lines.join(" "),
      cut: lines.some((l) => l.endsWith("…")),
      fs,
    });
  }
  const spans = lines
    .map((l, i) => `<tspan x="${n(px)}" y="${n(top + i * lh)}">${esc(l)}</tspan>`)
    .join("");
  return `<text font-family="${o.family ?? x.body}" font-size="${n(fs)}" font-weight="${o.weight ?? WEIGHT.label}" fill="${o.fill ?? x.c.ink}" text-anchor="${o.anchor ?? "middle"}"${halo}>${spans}</text>`;
}

/**
 * The one arrowhead (DIAGRAM-AUDIT look #5): tip at (tx, ty), pointing away from (fx, fy), its
 * length 4.2 × the line's stroke, half as wide as 0.6 of that, with a swept-back notch. `_size` is
 * kept for old callers and ignored: every head is sized from its stroke.
 */
export function arrowHead(
  tx: number,
  ty: number,
  fx: number,
  fy: number,
  _size: number,
  fill: string,
  stroke: number = STROKE.line,
) {
  const size = headFor(stroke);
  const a = Math.atan2(ty - fy, tx - fx);
  const p = (back: number, s: number) =>
    `${n(tx - back * Math.cos(a) + s * Math.cos(a + Math.PI / 2))},${n(ty - back * Math.sin(a) + s * Math.sin(a + Math.PI / 2))}`;
  return `<polygon points="${n(tx)},${n(ty)} ${p(size, size * 0.6)} ${p(size * 0.85, 0)} ${p(size, -size * 0.6)}" fill="${fill}"/>`;
}

/** A straight arrow from (x1, y1) to (x2, y2). */
export function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number = STROKE.line,
  _head = 0,
) {
  const head = headFor(width);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const ex = x2 - Math.cos(a) * head * 0.8;
  const ey = y2 - Math.sin(a) * head * 0.8;
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(ex)}" y2="${n(ey)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>${arrowHead(x2, y2, x1, y1, head, color, width)}`;
}

/** A horizontal curly brace from x1 to x2 whose ends sit at `y` and whose point is `d` above (d < 0: below). */
export function hBrace(
  x1: number,
  x2: number,
  y: number,
  d: number,
  color: string,
  width: number = STROKE.line,
) {
  const m = (x1 + x2) / 2;
  const r = Math.min(Math.abs(d) / 2, (x2 - x1) / 4);
  const s = Math.sign(d) || 1;
  const yl = y - s * r;
  const tip = y - d;
  const path = `M${n(x1)},${n(y)} Q${n(x1)},${n(yl)} ${n(x1 + r)},${n(yl)} L${n(m - r)},${n(yl)} Q${n(m)},${n(yl)} ${n(m)},${n(tip)} Q${n(m)},${n(yl)} ${n(m + r)},${n(yl)} L${n(x2 - r)},${n(yl)} Q${n(x2)},${n(yl)} ${n(x2)},${n(y)}`;
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A vertical curly brace from y1 to y2 whose ends sit at `x` and whose point is `d` to the right. */
export function vBrace(
  y1: number,
  y2: number,
  x: number,
  d: number,
  color: string,
  width: number = STROKE.line,
) {
  const m = (y1 + y2) / 2;
  const r = Math.min(Math.abs(d) / 2, (y2 - y1) / 4);
  const xl = x + r;
  const tip = x + d;
  const path = `M${n(x)},${n(y1)} Q${n(xl)},${n(y1)} ${n(xl)},${n(y1 + r)} L${n(xl)},${n(m - r)} Q${n(xl)},${n(m)} ${n(tip)},${n(m)} Q${n(xl)},${n(m)} ${n(xl)},${n(m + r)} L${n(xl)},${n(y2 - r)} Q${n(xl)},${n(y2)} ${n(x)},${n(y2)}`;
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A number as a tick label: no trailing zeros, a real minus sign. */
export function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r).replace("-", "−");
}

/** Tick values from `min` to `max` at `step`, or a round step giving about `aim` ticks. */
export function ticks(min: number, max: number, step?: number, aim = 6): number[] {
  let s = step;
  if (!s || (max - min) / s > 12) {
    const raw = (max - min) / aim;
    const p = 10 ** Math.floor(Math.log10(raw));
    const f = raw / p;
    s = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const out: number[] = [];
  const first = Math.ceil(min / s - 1e-9) * s;
  for (let v = first; v <= max + 1e-9; v += s) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** The axis top for data reaching `v`: the first round tick at or above it (about `aim` ticks). */
export function niceTop(v: number, aim = 5): number {
  if (!(v > 0)) return 1;
  const tv = ticks(0, v, undefined, aim);
  const step = (tv[1] ?? v) - (tv[0] ?? 0) || v;
  return Math.ceil(v / step - 1e-9) * step;
}
