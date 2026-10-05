/** Bar models: one to four bars cut into parts, drawn to one scale, with totals as braces. */
import type { BarModel } from "./schema";
import { look, WEIGHT } from "./style";
import { type Ctx, hBrace, n, text, textWidth, vBrace } from "./svg";

export function drawBarModel(s: BarModel, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const gap = fs * 0.6;
  const labelW = Math.max(0, ...s.bars.map((b) => (b.label ? textWidth(b.label, x, fs, 600) : 0)));
  const left = labelW > 0 ? labelW + gap : 0;
  const right = s.combined ? fs * 1.2 + gap + textWidth(s.combined, x, fs, 600) : 0;
  const barW = w - left - right - 4;
  const braceH = fs * 2.4;
  const rowGap = fs * 0.9;
  const tops = s.bars.map((b) => (b.total ? braceH : 0));
  const room = h - tops.reduce((a, b) => a + b, 0) - rowGap * (s.bars.length - 1);
  const barH = Math.max(fs * 1.8, Math.min(fs * 3.4, room / s.bars.length));
  const used =
    tops.reduce((a, b) => a + b, 0) + barH * s.bars.length + rowGap * (s.bars.length - 1);
  const scale = Math.max(...s.bars.map((b) => b.parts.reduce((a, p) => a + p.value, 0)));
  const unit = barW / scale;
  const out: string[] = [];
  let y = Math.max(0, (h - used) / 2);
  const x0 = left + 2;
  let firstTop = 0;
  let lastBottom = 0;
  s.bars.forEach((b, i) => {
    y += tops[i] ?? 0;
    if (i === 0) firstTop = y;
    if (b.label) {
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
        `<rect x="${n(px + cut / 2)}" y="${n(y)}" width="${n(pw - cut)}" height="${n(barH)}" fill="${p.shaded ? c.accent : c.tint}" stroke="${c.ink}" stroke-width="2"/>`,
      );
      if (p.label && textWidth(p.label, x, fs, 600) <= pw - 6) {
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
