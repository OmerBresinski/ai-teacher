/** Number lines: ticks and numbers, marked points (open or closed), jumps as arcs, a shaded range. */
import type { NumberLine } from "./schema";
import { arrowHead, type Ctx, n, num, text, textWidth } from "./svg";

export function drawNumberLine(l: NumberLine, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const count = Math.round((l.max - l.min) / l.step);
  const values = Array.from({ length: count + 1 }, (_, i) => l.min + i * l.step);
  const pad = Math.max(
    fs * 1.2,
    textWidth(num(l.min), x) / 2 + 8,
    textWidth(num(l.max), x) / 2 + 8,
  );
  const X = (v: number) => pad + ((v - l.min) / (l.max - l.min)) * (w - 2 * pad);
  const every =
    l.labelEvery ??
    (() => {
      const widest = Math.max(...values.map((v) => textWidth(num(v), x))) + fs * 0.6;
      const per = (w - 2 * pad) / count;
      const k = Math.ceil(widest / per);
      return [1, 2, 5, 10, 20].find((m) => m >= k) ?? k;
    })() * l.step;
  const span = Math.max(0, ...l.jumps.map((j) => Math.abs(X(j.to) - X(j.from))));
  const arcH = Math.min(h * 0.4, span * 0.35 + fs);
  const pointsBelow = l.points.some((p) => p.label);
  const used = (l.jumps.length ? arcH + fs * 1.5 : fs) + fs * 2.4 + (pointsBelow ? fs * 1.8 : 0);
  const y = Math.max(
    l.jumps.length ? arcH + fs * 1.5 : fs,
    (h - used) / 2 + (l.jumps.length ? arcH + fs * 1.5 : fs),
  );
  const out: string[] = [];

  if (l.range) {
    out.push(
      `<line x1="${n(X(l.range.from))}" y1="${n(y)}" x2="${n(X(l.range.to))}" y2="${n(y)}" stroke="${c.accent}" stroke-opacity="0.35" stroke-width="${n(fs * 0.9)}" stroke-linecap="butt"/>`,
    );
  }
  const end = 6;
  out.push(
    `<line x1="${n(end + fs * 0.6)}" y1="${n(y)}" x2="${n(w - end - fs * 0.6)}" y2="${n(y)}" stroke="${c.ink}" stroke-width="3"/>`,
    arrowHead(end, y, w, y, fs * 0.8, c.ink),
    arrowHead(w - end, y, 0, y, fs * 0.8, c.ink),
  );
  const labelled = (v: number) => {
    // Counted from zero when the line crosses it.
    const origin = l.min <= 0 && l.max >= 0 ? 0 : l.min;
    const r = (v - origin) / every;
    return Math.abs(r - Math.round(r)) < 1e-6;
  };
  for (const v of values) {
    const big = labelled(v);
    const t = big ? fs * 0.55 : fs * 0.35;
    out.push(
      `<line x1="${n(X(v))}" y1="${n(y - t)}" x2="${n(X(v))}" y2="${n(y + t)}" stroke="${c.ink}" stroke-width="${big ? 2.5 : 1.5}"/>`,
    );
    if (big) out.push(text(x, X(v), y + fs * 0.7, [num(v)], { v: "top" }));
  }
  for (const j of l.jumps) {
    const x1 = X(j.from);
    const x2 = X(j.to);
    const hgt = Math.min(arcH, Math.abs(x2 - x1) * 0.35 + fs * 0.5);
    const top = y - fs * 0.4 - hgt * 1.33;
    const head = fs * 0.6;
    const dir = Math.sign(x2 - x1);
    out.push(
      `<path d="M${n(x1)},${n(y - fs * 0.4)} C${n(x1)},${n(top)} ${n(x2)},${n(top)} ${n(x2)},${n(y - fs * 0.4 - head * 0.6)}" fill="none" stroke="${c.accent}" stroke-width="3" stroke-linecap="round"/>`,
      arrowHead(x2, y - fs * 0.4, x2 - dir * 0.001, y - fs * 0.4 - 10, head, c.accent),
    );
    if (j.label) {
      out.push(
        text(x, (x1 + x2) / 2, y - fs * 0.4 - hgt - 4, [j.label], {
          v: "bottom",
          weight: 600,
          fill: c.accent,
          halo: c.bg,
        }),
      );
    }
  }
  for (const p of l.points) {
    const px = X(p.value);
    out.push(
      `<circle cx="${n(px)}" cy="${n(y)}" r="${n(fs * 0.42)}" fill="${p.open ? c.bg : c.accent}" stroke="${c.accent}" stroke-width="3"/>`,
    );
    if (p.label) {
      out.push(text(x, px, y + fs * 2.2, [p.label], { v: "top", weight: 700, fill: c.accent }));
    }
  }
  return out.join("");
}
