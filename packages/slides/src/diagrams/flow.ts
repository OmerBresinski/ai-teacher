/**
 * Flows: a chain of steps laid out in rows that snake (left to right, then right to left, so every
 * arrow is a short straight one), or a cycle of three to six steps set clockwise round an ellipse.
 */
import type { Flow } from "./schema";
import { arrow, arrowHead, type Ctx, n, text, textWidth, wrap } from "./svg";

type Box = { cx: number; cy: number; w: number; h: number };

function box(x: Ctx, b: Box, label: string): string {
  const { c } = x;
  const lines = wrap(label, x, b.w - x.fs * 0.9, 2, x.fs, 600);
  return `<rect x="${n(b.cx - b.w / 2)}" y="${n(b.cy - b.h / 2)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(x.fs * 0.5)}" fill="${c.tint}" stroke="${c.accent}" stroke-width="2.5"/>${text(x, b.cx, b.cy, lines, { weight: 600 })}`;
}

/** Where the segment from `b`'s centre towards (tx, ty) leaves `b`, plus a small gap. */
function edge(b: Box, tx: number, ty: number, gap: number): [number, number] {
  const dx = tx - b.cx;
  const dy = ty - b.cy;
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : b.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : b.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  const len = Math.hypot(dx, dy) || 1;
  return [b.cx + dx * s + (dx / len) * gap, b.cy + dy * s + (dy / len) * gap];
}

export function drawFlow(f: Flow, x: Ctx, w: number, h: number): string {
  return f.layout === "cycle" ? cycle(f, x, w, h) : chain(f, x, w, h);
}

function chain(f: Flow, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const k = f.steps.length;
  const wide = w / h >= 1.6;
  const cols = wide ? (k <= 4 ? k : Math.ceil(k / 2)) : k <= 4 ? 1 : 2;
  const rows = Math.ceil(k / cols);
  const arrowRoom = Math.max(
    fs * 2.4,
    ...f.steps.map((s) => (s.arrow ? textWidth(s.arrow, x, fs * 0.85) + 16 : 0)),
  );
  const gapX = cols > 1 ? arrowRoom : 0;
  const gapY = fs * 2.6;
  const bw = Math.min((w - gapX * (cols - 1)) / cols, fs * 14);
  const bh = Math.min((h - gapY * (rows - 1)) / rows, fs * 4.2);
  const totalW = bw * cols + gapX * (cols - 1);
  const totalH = bh * rows + gapY * (rows - 1);
  const ox = (w - totalW) / 2;
  const oy = (h - totalH) / 2;
  const boxes: Box[] = f.steps.map((_, i) => {
    const r = Math.floor(i / cols);
    const pos = i % cols;
    const col = r % 2 === 0 ? pos : cols - 1 - pos;
    return { cx: ox + col * (bw + gapX) + bw / 2, cy: oy + r * (bh + gapY) + bh / 2, w: bw, h: bh };
  });
  const out: string[] = [];
  const small = Math.max(14, Math.round(fs * 0.85));
  boxes.forEach((b, i) => {
    const next = boxes[i + 1];
    if (!next) return;
    const [x1, y1] = edge(b, next.cx, next.cy, 4);
    const [x2, y2] = edge(next, b.cx, b.cy, 4);
    out.push(arrow(x1, y1, x2, y2, c.ink, 3, fs * 0.75));
    const note = f.steps[i]?.arrow;
    if (note) {
      const vertical = Math.abs(x2 - x1) < 1;
      out.push(
        vertical
          ? text(x, x1 + 10, (y1 + y2) / 2, [note], {
              anchor: "start",
              fs: small,
              fill: c.muted,
              weight: 600,
            })
          : text(x, (x1 + x2) / 2, Math.min(y1, y2) - 6, [note], {
              v: "bottom",
              fs: small,
              fill: c.muted,
              weight: 600,
            }),
      );
    }
  });
  f.steps.forEach((s, i) => {
    const b = boxes[i];
    if (b) out.push(box(x, b, s.label));
  });
  return out.join("");
}

function cycle(f: Flow, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const k = f.steps.length;
  const bw = Math.min(w * (k <= 4 ? 0.42 : 0.36), fs * 11);
  const bh = Math.min(h * 0.22, fs * 3.6);
  const rx = (w - bw) / 2;
  const ry = (h - bh) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const boxes: Box[] = f.steps.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
    return { cx: cx + rx * Math.cos(a), cy: cy + ry * Math.sin(a), w: bw, h: bh };
  });
  const out: string[] = [];
  const small = Math.max(14, Math.round(fs * 0.85));
  boxes.forEach((b, i) => {
    const next = boxes[(i + 1) % k];
    if (!next) return;
    // A gentle outward bow, so the ring reads as a cycle.
    const mx = (b.cx + next.cx) / 2;
    const my = (b.cy + next.cy) / 2;
    const ox = mx - cx;
    const oy = my - cy;
    const ol = Math.hypot(ox, oy) || 1;
    const bow = Math.min(w, h) * 0.08;
    const qx = mx + (ox / ol) * bow;
    const qy = my + (oy / ol) * bow;
    const [x1, y1] = edge(b, qx, qy, 6);
    const [x2, y2] = edge(next, qx, qy, 6);
    const head = fs * 0.75;
    const tl = Math.hypot(x2 - qx, y2 - qy) || 1;
    const ex = x2 - ((x2 - qx) / tl) * head * 0.8;
    const ey = y2 - ((y2 - qy) / tl) * head * 0.8;
    out.push(
      `<path d="M${n(x1)},${n(y1)} Q${n(qx)},${n(qy)} ${n(ex)},${n(ey)}" fill="none" stroke="${c.ink}" stroke-width="3" stroke-linecap="round"/>`,
      arrowHead(x2, y2, qx, qy, head, c.ink),
    );
    const note = f.steps[i]?.arrow;
    if (note) {
      const lx = qx + (ox / ol) * fs * 0.9;
      const ly = qy + (oy / ol) * fs * 0.9;
      out.push(
        text(x, lx, ly, [note], {
          anchor: Math.abs(ox) < 4 ? "middle" : ox > 0 ? "start" : "end",
          fs: small,
          fill: c.muted,
          weight: 600,
          halo: c.bg,
        }),
      );
    }
  });
  f.steps.forEach((s, i) => {
    const b = boxes[i];
    if (b) out.push(box(x, b, s.label));
  });
  return out.join("");
}
