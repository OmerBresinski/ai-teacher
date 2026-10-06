/** Bar models: one to four bars cut into parts, drawn to one scale, with totals as braces. */
import type { BarModel } from "./schema";
import { look, WEIGHT } from "./style";
import { type Ctx, hBrace, n, text, textWidth, vBrace } from "./svg";

/** The widest a row's name may be, as a share of the drawing, beside its bar. */
const LABEL_SIDE_MAX = 0.2;
/** The tallest a bar is drawn, in label heights. */
const BAR_H_MAX = 5;

export function drawBarModel(s: BarModel, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const gap = fs * 0.6;
  const labelW = Math.max(0, ...s.bars.map((b) => (b.label ? textWidth(b.label, x, fs, 600) : 0)));
  // FIX1: a row name wider than a fifth of the drawing stands over its bar, so the bars keep the
  // drawing's width (y5's "Counters" took a third of a half zone and the bars were a narrow strip).
  // fix-bars: a single bar's name stands over it too (it names the whole, like a caption), so the
  // bar spans the zone; names beside their bars are kept for rows compared side by side.
  // It stays beside when the drawing is too short for a name line over the bar (a wide, short zone).
  const braceH0 = fs * 2.8;
  const rowsH = (named: number) =>
    s.bars.reduce((a, b) => a + (b.total ? braceH0 : 0) + (b.label ? named : 0) + fs * 1.8, 0) +
    fs * 0.9 * (s.bars.length - 1);
  const above =
    labelW > w * LABEL_SIDE_MAX || (labelW > 0 && s.bars.length === 1 && rowsH(fs * 1.5) <= h);
  const left = labelW > 0 && !above ? labelW + gap : 0;
  const nameH = above ? fs * 1.5 : 0;
  const right = s.combined ? fs * 1.2 + gap + textWidth(s.combined, x, fs, 600) : 0;
  const barW = w - left - right - 4;
  const braceH = braceH0;
  const rowGap = fs * 0.9;
  const tops = s.bars.map((b) => (b.total ? braceH : 0) + (b.label ? nameH : 0));
  const room = h - tops.reduce((a, b) => a + b, 0) - rowGap * (s.bars.length - 1);
  // As tall as the room allows, to BAR_H_MAX label heights: a bar model is read as blocks, not a strip.
  const barH = Math.max(fs * 1.8, Math.min(fs * BAR_H_MAX, room / s.bars.length));
  const used =
    tops.reduce((a, b) => a + b, 0) + barH * s.bars.length + rowGap * (s.bars.length - 1);
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
      const fits = !p.label || textWidth(p.label, x, fs, 600) <= pw - cut - fs * 0.5;
      // fix-bars: a part whose label does not fit is a fault, not a silent drop, so the drawing
      // takes a wider zone (or a smaller zoom) instead of losing the numbers it is there to show.
      if (!fits) x.faults?.push(`the part label "${p.label}" does not fit its part`);
      if (p.label && fits) {
        out.push(
          text(x, px + pw / 2, y + barH / 2, [p.label], {
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
  });
  if (s.combined) {
    const bx = x0 + barW + fs * 0.35;
    out.push(vBrace(firstTop, lastBottom, bx, fs * 0.8, c.ink));
    out.push(
      text(x, bx + fs * 0.8 + gap, (firstTop + lastBottom) / 2, [s.combined], {
        anchor: "start",
        weight: 600,
      }),
    );
  }
  return out.join("");
}
