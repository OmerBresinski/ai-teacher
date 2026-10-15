/** Bar models: one to four bars cut into parts, drawn to one scale, with totals as braces. */
import { answerPart, buildsOn, PASSING_HIDDEN, part } from "./builds";
import {
  type BarModel,
  type BarPanel,
  type BarPanelInput,
  BarPanelSchema,
  barPanelGuard,
} from "./schema";
import { look, WEIGHT } from "./style";
import { type Ctx, type DrawnText, hBrace, n, num, text, textWidth, vBrace } from "./svg";

export { barPanelGuard, EQUATION_MAX_A } from "./schema";

/** The widest a row's name may be, as a share of the drawing, beside its bar. */
const LABEL_SIDE_MAX = 0.2;
/** The tallest a bar is drawn, in label heights. */
const BAR_H_MAX = 5;

export function drawBarModel(s0: BarModel, x: Ctx, w: number, h: number): string {
  if (s0.panel) return drawPanel(s0.panel, x, w, h);
  const { c, fs } = x;
  const gap = fs * 0.6;
  // dd-diagrams2: a row name that only repeats the bar's total ("40" beside a bar totalled "40")
  // says nothing; it is dropped.
  const digits = (t?: string) => (t ?? "").replace(/[^0-9./]/g, "");
  const s: BarModel = {
    ...s0,
    bars: s0.bars.map((b) =>
      b.label &&
      b.total &&
      (b.label.trim() === b.total.trim() ||
        (digits(b.label) !== "" &&
          digits(b.label) === digits(b.total) &&
          /^[\d\s.,]+$/.test(b.label)))
        ? { ...b, label: undefined }
        : b,
    ),
  };
  const labelW = Math.max(0, ...s.bars.map((b) => (b.label ? textWidth(b.label, x, fs, 600) : 0)));
  // FIX1: a row name wider than a fifth of the drawing stands over its bar, so the bars keep the
  // drawing's width (y5's "Counters" took a third of a half zone and the bars were a narrow strip).
  // fix-bars: a single bar's name stands over it too (it names the whole, like a caption), so the
  // bar spans the zone; names beside their bars are kept for rows compared side by side.
  // It stays beside when the drawing is too short for a name line over the bar (a wide, short zone).
  const braceH0 = fs * 2.8;
  const underH0 = s.combined && s.bars.length === 1 ? fs * 2.9 : 0;
  const rowsH = (named: number) =>
    s.bars.reduce((a, b) => a + (b.total ? braceH0 : 0) + (b.label ? named : 0) + fs * 1.8, 0) +
    fs * 0.9 * (s.bars.length - 1) +
    underH0;
  const above =
    labelW > w * LABEL_SIDE_MAX || (labelW > 0 && s.bars.length === 1 && rowsH(fs * 1.8) <= h);
  const left = labelW > 0 && !above ? labelW + gap : 0;
  const nameH = above ? fs * 1.8 : 0;
  // dd-diagrams: one bar's `combined` names part of that bar (the shaded parts: "3/5 = 18"), so it
  // stands under a brace below those parts, not beside the bar where it took the parts' width and
  // ran off the edge (K y5 s10 "⅝ walk"). Rows compared side by side keep the brace on the right.
  const under = !!s.combined && s.bars.length === 1;
  const underH = under ? fs * 2.9 : 0;
  const right =
    s.combined && !under ? fs * 1.2 + gap + textWidth(s.combined, x, fs, 600) * 1.08 + 2 : 0;
  const barW = w - left - right - 4;
  const braceH = braceH0;
  const rowGap = fs * 0.9;
  const tops = s.bars.map((b) => (b.total ? braceH : 0) + (b.label ? nameH : 0));
  const room = h - tops.reduce((a, b) => a + b, 0) - rowGap * (s.bars.length - 1) - underH;
  // As tall as the room allows, to BAR_H_MAX label heights: a bar model is read as blocks, not a strip.
  const barH = Math.max(fs * 1.8, Math.min(fs * BAR_H_MAX, room / s.bars.length));
  const used =
    tops.reduce((a, b) => a + b, 0) + barH * s.bars.length + rowGap * (s.bars.length - 1) + underH;
  const scale = Math.max(...s.bars.map((b) => b.parts.reduce((a, p) => a + p.value, 0)));
  const unit = barW / scale;
  const out: string[] = [];
  // fix-bars: rows that do not fit the drawing's height are a fault (they ran off its foot unseen).
  if (used > h + 2) x.faults?.push("the bars run off the foot of the drawing");
  let y = Math.max(0, (h - used) / 2);
  const x0 = left + 2;
  let firstTop = 0;
  let lastBottom = 0;
  s.bars.forEach((b, i) => {
    const at = out.length;
    y += tops[i] ?? 0;
    if (i === 0) firstTop = y;
    if (b.label && above) {
      out.push(
        text(x, x0, y - (b.total ? braceH : 0) - fs * 0.6, [b.label], {
          anchor: "start",
          weight: WEIGHT.name,
          v: "bottom",
        }),
      );
    } else if (b.label) {
      out.push(
        text(x, left - gap, y + barH / 2, [b.label], { anchor: "end", weight: WEIGHT.name }),
      );
    }
    let px = x0;
    for (const p of b.parts) {
      const pw = p.value * unit;
      // Modern looks: touching cells stand a hair apart instead of sharing an outline.
      const cut = look().gap * fs;
      out.push(
        `<rect x="${n(px + cut / 2)}" y="${n(y)}" width="${n(pw - cut)}" height="${n(barH)}" fill="${p.shaded ? c.accent : c.tint}"/>`,
      );
      // Clear of both sides of its part by a quarter label height, so "6 m" never touches its edges.
      // dd-diagrams: "6; ¼" is a value and its fraction: two lines, the fraction under the value,
      // never one run-on label.
      const lines = p.label ? p.label.split(/\s*;\s*/).filter(Boolean) : [];
      const fits =
        !p.label ||
        (lines.length <= 2 &&
          lines.length * fs * 1.2 <= barH - fs * 0.3 &&
          lines.every((l) => textWidth(l, x, fs, 600) <= pw - cut - fs * 0.5));
      // fix-bars: a part whose label does not fit is a fault, not a silent drop, so the drawing
      // takes a wider zone (or a smaller zoom) instead of losing the numbers it is there to show.
      if (!fits) x.faults?.push(`the part label "${p.label}" does not fit its part`);
      if (p.label && fits) {
        out.push(
          text(x, px + pw / 2, y + barH / 2, lines, {
            weight: 600,
            fill: p.shaded ? c.onAccent : c.ink,
          }),
        );
      }
      px += pw;
    }
    if (b.total) {
      const end = px;
      out.push(hBrace(x0, end, y - fs * 0.35, fs * 0.8, c.ink));
      out.push(text(x, (x0 + end) / 2, y - fs * 1.5, [b.total], { weight: 600, v: "bottom" }));
    }
    lastBottom = y + barH;
    y += barH + rowGap;
    out.splice(at, out.length - at, part(i, out.slice(at).join("")));
  });
  // The combined total is the last build, and an answer: hidden on a question slide until revealed.
  const total = out.length;
  if (s.combined && under) {
    const b = s.bars[0];
    const unitW = barW / scale;
    let a = -1;
    let z = -1;
    let acc = 0;
    b?.parts.forEach((p, i) => {
      if (p.shaded && a < 0) a = i;
      if (p.shaded) z = i;
    });
    const edges = (b?.parts ?? []).map((p) => {
      const e0 = acc;
      acc += p.value;
      return [e0, acc] as const;
    });
    const [from, to] = a >= 0 ? [edges[a]?.[0] ?? 0, edges[z]?.[1] ?? acc] : [0, acc];
    const bx0 = x0 + from * unitW;
    const bx1 = x0 + to * unitW;
    const by = lastBottom + fs * 0.35;
    out.push(hBrace(bx0, bx1, by, -fs * 0.8, c.ink));
    // Held clear of both edges with room to spare: display faces set bold run wider than their
    // measured advances (T y5 s9 "14 adventure" lost its first digit at the left edge).
    const half = textWidth(s.combined, x, fs, 600) * 0.62;
    const cx = Math.max(half + 2, Math.min(w - half - 2, (bx0 + bx1) / 2));
    out.push(text(x, cx, by + fs * 1.0, [s.combined], { weight: 600, v: "top" }));
  } else if (s.combined) {
    const bx = x0 + barW + fs * 0.35;
    out.push(vBrace(firstTop, lastBottom, bx, fs * 0.8, c.ink));
    out.push(
      text(x, bx + fs * 0.8 + gap, (firstTop + lastBottom) / 2, [s.combined], {
        anchor: "start",
        weight: 600,
      }),
    );
  }
  if (out.length > total)
    out.splice(
      total,
      out.length - total,
      answerPart(part(s.bars.length, out.slice(total).join(""))),
    );
  return out.join("");
}

// ─── panel models (TEACH-75 part y) ──────────────────────────────────────────────────────────

/**
 * The builds a panel model shows, in order: one per working line it pictures. Percent: 10%, the
 * tens (when there are more than one), half a tenth (when p ends in 5), then the total (when
 * there was more than one step). Equation: the whole, take b from both, share into a parts, check.
 */
export function barPanelFrames(p: BarPanelInput): string[] {
  if (p.model === "equation") return ["whole", "take", "share", "check"];
  const t = Math.floor(p.percent / 10);
  const half = p.percent % 10 === 5;
  const out = t >= 1 ? ["unit"] : [];
  if (t > 1) out.push("tens");
  if (half) out.push("half");
  if (out.length > 1 && half) out.push("total");
  return out;
}

/**
 * A worked example's panel as a full bar-model spec, or the guard's result when the numbers are
 * not ones the panel draws exactly (the caller then shows its working as text only).
 */
export function barPanelSpec(
  panel: BarPanelInput,
  alt: string,
): { ok: true; spec: BarModel } | { ok: false; reason: string } {
  const g = barPanelGuard(panel);
  if (!g.ok) return g;
  const p = BarPanelSchema.parse(panel);
  // `bars` mirror the picture for every reader that is not the panel drawer (capacity, alt).
  const bars =
    p.model === "percent"
      ? [
          {
            parts: Array.from({ length: 10 }, () => ({ value: 1 })),
            total: num(p.amount),
          },
        ]
      : [
          {
            parts: [
              ...Array.from({ length: p.a }, () => ({
                value: (p.c - p.b) / p.a,
                label: p.unknown,
              })),
              { value: p.b, label: num(p.b) },
            ],
          },
          { parts: [{ value: p.c, label: num(p.c) }] },
        ];
  return { ok: true, spec: { kind: "bar-model", alt, bars, panel: p } as BarModel };
}

/**
 * Frame layers as one drawing. Under `withBuilds` each earlier frame shows only in its own build
 * (`data-f`, hidden by the drawing's own style everywhere else) and the last frame is the last
 * build; every other render (editor, PDF, PPTX) shows the last frame alone. Frames never show
 * together, so the fit probe reads the last frame with the drawing and checks each earlier frame
 * on its own against the drawing's still marks.
 */
function frames(x: Ctx, count: number, draw: (x: Ctx, k: number) => string): string {
  const last = count - 1;
  const still = x.rec ? [...x.rec] : [];
  const early: string[] = [];
  for (let k = 0; k < last; k++) {
    if (!x.rec) {
      if (buildsOn()) early.push(`<g data-f="${k}">${draw(x, k)}</g>`);
      continue;
    }
    const rec: DrawnText[] = [];
    draw({ ...x, rec }, k);
    frameFaults(x, still, rec);
  }
  const end = draw(x, last);
  if (!buildsOn() || last < 1) return end;
  return `<g class="slide"><style>${PASSING_HIDDEN}</style>${early.join("")}${part(last, end)}</g>`;
}

/** An earlier frame's labels that overlap each other or the still marks (as `diagramFaults` reads). */
function frameFaults(x: Ctx, still: DrawnText[], rec: DrawnText[]) {
  const area = (b: DrawnText) => Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  const over = (a: DrawnText, b: DrawnText) =>
    Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) *
    Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  rec.forEach((a, i) => {
    for (const b of [...still, ...rec.slice(i + 1)])
      if (over(a, b) > 0.15 * Math.min(area(a), area(b)))
        x.faults?.push(`the labels "${a.text}" and "${b.text}" overlap`);
  });
}

/** The label size a panel sets: grown with its box, never under the drawing's own (the age floor). */
const panelFs = (x: Ctx, w: number, h: number) =>
  Math.max(x.fs, Math.min(x.fs * 1.4, w / 11, h / 7));

/** "lead" in ink then "value" in the accent, as one label centred at (cx, y) and kept inside 0..w. */
function valueLabel(
  x: Ctx,
  cx: number,
  y: number,
  lead: string,
  value: string,
  fs: number,
  w: number,
  colour: string,
): string {
  const lw = textWidth(lead, x, fs, 600) + fs * 0.3;
  const vw = textWidth(value, x, fs, 700);
  const total = lw + vw;
  const x0 = Math.max(2, Math.min(w - total - 2, cx - total / 2));
  return (
    text(x, x0, y, [lead], { anchor: "start", fs, weight: 600 }) +
    text(x, x0 + lw, y, [value], { anchor: "start", fs, weight: 700, fill: colour })
  );
}

/** The smallest box a panel model draws into (a worked example's panel, ruling 155). */
export const PANEL_MIN = { w: 270, h: 180 } as const;

function drawPanel(p: BarPanel, x: Ctx, w: number, h: number): string {
  // Under its smallest box a panel is a fault, so a zoom never draws it small and scales it up.
  if (w < PANEL_MIN.w || h < PANEL_MIN.h)
    x.faults?.push(`the panel is smaller than ${PANEL_MIN.w}×${PANEL_MIN.h}`);
  return p.model === "percent" ? drawPercent(p, x, w, h) : drawEquation(p, x, w, h);
}

/** p% of an amount by tenths (W-d2): the whole bracketed above, one brace and one label per build. */
function drawPercent(p: Extract<BarPanel, { model: "percent" }>, x: Ctx, w: number, h: number) {
  const { c } = x;
  const L = panelFs(x, w, h);
  const bx = 2;
  const bw = w - 4;
  const cw = bw / 10;
  const wholeH = L * 1.5;
  const braceD = L * 0.9;
  const labH = L * 1.5;
  const bh = Math.max(L * 2, Math.min(h - wholeH - braceD - labH - L * 0.9, w * 0.3, L * 4.2));
  const used = wholeH + L * 0.5 + bh + L * 0.4 + braceD + labH;
  if (used > h + 2) x.faults?.push("the percent bar runs off the foot of the drawing");
  const top = Math.max(0, (h - used) / 2) + wholeH + L * 0.5;
  const t = Math.floor(p.percent / 10);
  const half = p.percent % 10 === 5;
  // The whole, bracketed above: it never changes.
  const wy = top - L * 1.1;
  const amount = num(p.amount);
  const aw = textWidth(amount, x, L, 700) / 2 + L * 0.5;
  const tick = L * 0.45;
  let still = `<path d="M${n(bx)},${n(wy + tick)} L${n(bx)},${n(wy)} L${n(bx + bw / 2 - aw)},${n(wy)} M${n(bx + bw / 2 + aw)},${n(wy)} L${n(bx + bw)},${n(wy)} L${n(bx + bw)},${n(wy + tick)}" fill="none" stroke="${c.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  still += text(x, bx + bw / 2, wy, [amount], { fs: L, weight: 700 });
  still += `<rect x="${n(bx)}" y="${n(top)}" width="${n(bw)}" height="${n(bh)}" fill="${c.surface}"/>`;
  const lines = Array.from(
    { length: 9 },
    (_, i) =>
      `<line x1="${n(bx + (i + 1) * cw)}" x2="${n(bx + (i + 1) * cw)}" y1="${n(top)}" y2="${n(top + bh)}" stroke="${c.ink}" stroke-width="1.5" stroke-opacity="0.35"/>`,
  ).join("");
  const outline = `<rect x="${n(bx)}" y="${n(top)}" width="${n(bw)}" height="${n(bh)}" rx="6" fill="none" stroke="${c.ink}" stroke-width="2"/>`;
  const spans: Record<string, [number, number, number]> = {
    unit: [0, 1, 10],
    tens: [0, t, 10 * t],
    half: [t, t + 0.5, 5],
    total: [0, t + (half ? 0.5 : 0), p.percent],
  };
  const keys = barPanelFrames(p);
  const layer = (x: Ctx, k: number) => {
    const key = keys[k] as string;
    const [s0, s1, pc] = spans[key] ?? [0, 1, 10];
    const shade = key === "unit" ? 1 : t;
    const halfOn = key === "half" || key === "total";
    // The last brace is the answer: in the accent.
    const fin = k === keys.length - 1;
    let g = shade
      ? `<rect x="${n(bx)}" y="${n(top)}" width="${n(shade * cw)}" height="${n(bh)}" fill="${c.tint}"/>`
      : "";
    if (halfOn)
      g += `<rect x="${n(bx + t * cw)}" y="${n(top)}" width="${n(cw / 2)}" height="${n(bh)}" fill="${c.accent}"/>`;
    g += lines + outline;
    if (key === "total")
      g += `<rect x="${n(bx - 3)}" y="${n(top - 3)}" width="${n(s1 * cw + 6)}" height="${n(bh + 6)}" rx="8" fill="none" stroke="${c.ink}" stroke-width="3"/>`;
    const x1 = bx + s0 * cw + 2;
    const x2 = bx + s1 * cw - 2;
    const by = top + bh + L * 0.4;
    const col = fin ? c.accent : c.ink;
    // A narrow span (half a tenth) takes a bracket with a short tip, so it reads as a brace,
    // not a fork; a wider one the curly brace.
    const d = braceD * 0.75;
    if (x2 - x1 < L * 1.6) {
      const r = Math.min(4, (x2 - x1) / 4);
      const m = (x1 + x2) / 2;
      const ym = by + d * 0.5;
      g += `<path d="M${n(x1)},${n(by)} Q${n(x1)},${n(ym)} ${n(x1 + r)},${n(ym)} L${n(x2 - r)},${n(ym)} Q${n(x2)},${n(ym)} ${n(x2)},${n(by)} M${n(m)},${n(ym)} L${n(m)},${n(by + d)}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else g += hBrace(x1, x2, by, -d, col, 2.5);
    g += valueLabel(
      x,
      (x1 + x2) / 2,
      by + d + labH / 2,
      `${num(pc)}% =`,
      num((p.amount * pc) / 100),
      fin ? L * 1.1 : L,
      w,
      c.accent,
    );
    return g;
  };
  return still + frames(x, keys.length, layer);
}

/** ax + b = c as two equal bars (W-d3): the x cells at a neutral width, never to scale. */
function drawEquation(p: Extract<BarPanel, { model: "equation" }>, x: Ctx, w: number, h: number) {
  const { c } = x;
  const L = panelFs(x, w, h);
  const bx = 2;
  const bw = w - 4;
  const bh = Math.max(L * 2, Math.min((h - L * 2.8) / 2, w * 0.24, L * 3.6));
  const gap = Math.max(L * 1.1, Math.min(bh * 0.45, h - 2 * bh - L * 1.4));
  const used = bh * 2 + gap;
  if (used > h + 2) x.faults?.push("the equation bars run off the foot of the drawing");
  const top = Math.max(L * 1.1, (h - used) / 2);
  const bot = top + bh + gap;
  const xv = (p.c - p.b) / p.a;
  const bLabel = num(p.b);
  const cut = Math.max(2, look().gap * x.fs);
  // Neutral: b takes a fixed share (or the room its number needs); the x cells share the rest
  // equally, whatever x is.
  const cells = (size: number) => {
    const bW = Math.max(bw / (p.a + 2), textWidth(bLabel, x, size, 600) + L * 0.6);
    const xw = (bw - bW) / p.a;
    return { bW, xw, inner: xw - cut - x.minFs * 0.2 };
  };
  // The numbers a step over the labels, smaller in narrow x cells, never under the age floor.
  let big = L * 1.15;
  while (big > x.minFs && textWidth(num(xv), x, big, 700) > cells(big).inner)
    big = Math.max(x.minFs, big - 0.5);
  const { bW, xw, inner } = cells(big);
  const xEnd = bx + p.a * xw;
  // The letter a step over the numbers when the cell has room for it.
  const letterFs = Math.max(big, Math.min(big * 1.2, inner / textWidth(p.unknown, x, 1, 500)));
  const need = Math.max(textWidth(num(xv), x, big, 700), textWidth(p.unknown, x, letterFs, 500));
  if (need > inner) x.faults?.push(`the ${p.unknown} cells are too narrow for "${num(xv)}"`);
  const cell = (cx: number, cy: number, cw: number, fill: string, stroke = c.ink) =>
    `<rect x="${n(cx + cut / 2)}" y="${n(cy)}" width="${n(cw - cut)}" height="${n(bh)}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const ghost = (cx: number, cy: number, cw: number) =>
    `<rect x="${n(cx + cut / 2 + 2)}" y="${n(cy + 2)}" width="${n(cw - cut - 4)}" height="${n(bh - 4)}" rx="6" fill="none" stroke="${c.muted}" stroke-width="2" stroke-dasharray="6 6" stroke-opacity="0.6"/>`;
  const letter = (x: Ctx, cx: number, cy: number, fs: number, fill = c.ink) =>
    text(x, cx, cy, [p.unknown], { fs, weight: 500, fill }).replace(
      "<text ",
      '<text font-style="italic" ',
    );
  const mid = (y: number) => y + bh / 2;
  const tickMark = (tx: number, ty: number, s: number) =>
    `<path d="M${n(tx - s * 0.5)},${n(ty)} L${n(tx - s * 0.15)},${n(ty + s * 0.35)} L${n(tx + s * 0.55)},${n(ty - s * 0.4)}" fill="none" stroke="${c.accent}" stroke-width="${n(s * 0.14)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const keys = barPanelFrames(p);
  const layer = (x: Ctx, k: number) => {
    const key = keys[k] as string;
    let g = "";
    for (let i = 0; i < p.a; i++) {
      const cx = bx + i * xw;
      g += cell(cx, top, xw, c.tint);
      if (key === "check") {
        // The x tag in the cell's corner, the value under it; a cell too short for both carries
        // its tag just over it.
        const inside = bh >= x.minFs * 1.3 + big * 1.05;
        g += inside
          ? letter(x, cx + cut / 2 + x.minFs * 0.6, top + x.minFs * 0.75, x.minFs, c.muted)
          : letter(x, cx + xw / 2, top - x.minFs * 0.65, x.minFs, c.muted);
        const vy = inside ? Math.max(mid(top), top + x.minFs * 1.3 + big * 0.45) : mid(top);
        g += text(x, cx + xw / 2, vy, [num(xv)], {
          fs: big,
          weight: 700,
          fill: c.accent,
        });
      } else g += letter(x, cx + xw / 2, mid(top), letterFs);
    }
    const taken = key === "take" || key === "share";
    if (taken)
      g +=
        ghost(xEnd, top, bW) +
        text(x, xEnd + bW / 2, mid(top), [bLabel], { fs: big, weight: 600, fill: c.muted });
    else
      g +=
        cell(xEnd, top, bW, c.surface) +
        text(x, xEnd + bW / 2, mid(top), [bLabel], { fs: big, weight: 600 });
    if (key === "whole" || key === "check") {
      g += cell(bx, bot, bw, c.surface);
      const cl = num(p.c);
      const off = key === "check" ? L * 0.8 : 0;
      g += text(x, bx + bw / 2 - off, mid(bot), [cl], { fs: big, weight: 600 });
      if (key === "check")
        g += tickMark(bx + bw / 2 + textWidth(cl, x, big, 600) / 2 + L * 0.4, mid(bot), L * 1.1);
    } else {
      if (key === "take")
        g +=
          cell(bx, bot, p.a * xw, c.surface) +
          text(x, bx + (p.a * xw) / 2, mid(bot), [num(p.c - p.b)], { fs: big, weight: 600 });
      else
        for (let i = 0; i < p.a; i++)
          g +=
            cell(bx + i * xw, bot, xw, c.surface) +
            text(x, bx + i * xw + xw / 2, mid(bot), [num(xv)], {
              fs: big,
              weight: 700,
              fill: c.accent,
            });
      g +=
        ghost(xEnd, bot, bW) +
        text(x, xEnd + bW / 2, mid(bot), [bLabel], { fs: big, weight: 600, fill: c.muted });
      if (key === "take")
        g += `<line x1="${n(xEnd)}" x2="${n(xEnd)}" y1="${n(top - L * 0.6)}" y2="${n(bot + bh + L * 0.6)}" stroke="${c.accent}" stroke-width="3" stroke-linecap="round"/>`;
    }
    return g;
  };
  return frames(x, keys.length, layer);
}
