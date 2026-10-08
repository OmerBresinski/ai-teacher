/** Bar models: one to four bars cut into parts, drawn to one scale, with totals as braces. */
import { answerPart, part } from "./builds";
import type { BarModel } from "./schema";
import { look, WEIGHT } from "./style";
import { type Ctx, hBrace, n, text, textWidth, vBrace } from "./svg";

/** The widest a row's name may be, as a share of the drawing, beside its bar. */
const LABEL_SIDE_MAX = 0.2;
/** The tallest a bar is drawn, in label heights. */
const BAR_H_MAX = 5;

export function drawBarModel(s0: BarModel, x: Ctx, w: number, h: number): string {
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
