/**
 * Flows: a chain of steps laid out in rows that snake (left to right, then right to left, so every
 * arrow is a short straight one), or a cycle of three to six steps set clockwise round an ellipse.
 */
import { type KeyStage, keyStage } from "../themes";
import type { Flow } from "./schema";
import { STROKE, sub, WEIGHT } from "./style";
import { arrow, arrowHead, type Ctx, n, text, textWidth, wrap } from "./svg";

type Box = { cx: number; cy: number; w: number; h: number };

/** A label's lines in box `b` at `f` (as many as the box holds, 1.2 em each), or undefined if cut. */
function boxLines(x: Ctx, b: Box, label: string, f: number): string[] | undefined {
  const room = Math.max(1, Math.floor((b.h - f * 0.5) / (f * 1.2)));
  const lines = wrap(label, x, b.w - f * 0.9, Math.min(3, room), f, WEIGHT.name);
  return lines[lines.length - 1]?.endsWith("…") ? undefined : lines;
}

/**
 * DIAGRAM-AUDIT look #9: one text size for every box in a drawing, the largest at which every
 * step fits (a step down from the label size at most), so no single box shrinks alone.
 */
function boxSize(x: Ctx, boxes: Box[], labels: string[]): number {
  // FIX-TYPE: a box label steps down no further than the stage's bodySmall (`x.minFs`).
  // When no size at or over it fits, the old steps keep the drawing rather than drop it.
  const tries = [x.fs, x.fs * 0.88, x.fs * 0.76];
  for (const f of [
    ...tries.map((v) => Math.max(sub(v, 1), 16, x.minFs)),
    ...tries.map((v) => Math.max(sub(v, 1), 16)),
  ])
    if (labels.every((l, i) => boxes[i] && boxLines(x, boxes[i] as Box, l, f))) return f;
  return Math.max(16, x.fs * 0.76);
}

function box(x: Ctx, b: Box, label: string, fs: number): string {
  const { c } = x;
  const lines = boxLines(x, b, label, fs) ?? wrap(label, x, b.w - fs * 0.9, 3, fs, WEIGHT.name);
  return `<rect x="${n(b.cx - b.w / 2)}" y="${n(b.cy - b.h / 2)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(x.fs * 0.5)}" fill="${c.tint}" stroke="${c.accent}" stroke-width="${STROKE.line}"/>${text(x, b.cx, b.cy, lines, { weight: WEIGHT.name, fs })}`;
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

/** dd-diagrams: the most steps a chain shows at each key stage; past it the flow does not draw. */
export const FLOW_STEP_CAP: Record<KeyStage, number> = { ks1: 4, ks2: 4, ks3: 5, ks4: 6, ks5: 6 };

type ChainPlan = {
  fs: number;
  noteFs: number;
  cols: number;
  rows: number;
  bw: number;
  bh: number;
  gapX: number;
  gapY: number;
  lines: string[][];
  notes: (string[] | undefined)[];
};

/**
 * dd-diagrams: a chain reads as one line of boxes, one column, or a two-row snake (left to right,
 * then right to left), never more rows. Box labels stand at the label size or one step down (never
 * under the stage's small size) and every box is as tall as its longest label needs; arrow words
 * sit in their own gap, never over a box or another word. A chain that cannot be laid out that way
 * in its zone is a fault (the slide falls back), never drawn small (T y9 s9, y10 s3).
 */
function planChain(f: Flow, x: Ctx, w: number, h: number): ChainPlan | undefined {
  const k = f.steps.length;
  const sizes = [...new Set([x.fs, Math.max(sub(x.fs), x.minFs)])].filter((v) => v >= x.minFs);
  const shapes: [number, number][] =
    w / h >= 1.6
      ? [
          [k, 1],
          [Math.ceil(k / 2), 2],
          [1, k],
        ]
      : [
          [1, k],
          [Math.ceil(k / 2), 2],
          [k, 1],
        ];
  for (const fs of sizes) {
    const noteFs = Math.max(sub(fs), x.minFs);
    for (const [cols, rows] of shapes) {
      if (rows > 2 && cols > 1) continue;
      // Words on arrows within a row sit above the arrow in the gap between the boxes.
      const rowArrow = (i: number) =>
        cols > 1 && Math.floor(i / cols) === Math.floor((i + 1) / cols);
      const hWords = f.steps.flatMap((s, i) =>
        i < k - 1 && rowArrow(i) && s.arrow ? [s.arrow] : [],
      );
      const longestWord = Math.max(
        0,
        ...hWords.flatMap((t) =>
          t.split(/\s+/).map((wd) => textWidth(wd, x, noteFs, WEIGHT.label)),
        ),
      );
      const gapX = cols > 1 ? Math.max(fs * 2.2, longestWord + 16) : 0;
      const bw = Math.min((w - gapX * (cols - 1)) / cols, fs * 14);
      if (bw < fs * 3.5) continue;
      const lines = f.steps.map((s) => {
        const l = wrap(s.label, x, bw - fs * 0.9, 3, fs, WEIGHT.name);
        return l[l.length - 1]?.endsWith("…") ||
          l.some((t) => textWidth(t, x, fs, WEIGHT.name) > bw - fs * 0.9 + 0.5)
          ? undefined
          : l;
      });
      if (lines.some((l) => !l)) continue;
      const most = Math.max(...lines.map((l) => (l as string[]).length));
      const bh = most * fs * 1.2 + fs * 0.9;
      // Arrow words: horizontal ones wrapped to their gap (two lines at most), vertical ones beside
      // their arrow, inside the drawing.
      const vRoom = cols === 1 ? w / 2 - fs * 0.6 - 8 : w - bw / 2 - 16;
      const notes = f.steps.map((s, i) => {
        if (!s.arrow || i >= k - 1) return undefined;
        const room = rowArrow(i) ? gapX - 8 : vRoom;
        const l = wrap(s.arrow, x, room, 2, noteFs, WEIGHT.label);
        return l[l.length - 1]?.endsWith("…") ||
          l.some((t) => textWidth(t, x, noteFs, WEIGHT.label) > room + 0.5)
          ? null
          : l;
      });
      if (notes.some((l) => l === null)) continue;
      const vNoteH = Math.max(
        0,
        ...notes.flatMap((l, i) => (l && !rowArrow(i) ? [l.length * noteFs * 1.2] : [])),
      );
      const gapY = rows > 1 ? Math.max(fs * 2.2, vNoteH + 12) : 0;
      // A word above a row arrow needs room over the arrow, inside the box band.
      const hNoteH = Math.max(
        0,
        ...notes.flatMap((l, i) => (l && rowArrow(i) ? [l.length * noteFs * 1.2 + 8] : [])),
      );
      if (hNoteH > bh / 2 + (rows > 1 ? gapY / 2 : (h - bh) / 2)) continue;
      const totalH =
        rows * bh + (rows - 1) * gapY + (rows === 1 ? Math.max(0, hNoteH * 2 - bh) : 0);
      const totalW = cols * bw + (cols - 1) * gapX;
      if (totalH > h || totalW > w + 0.5) continue;
      return {
        fs,
        noteFs,
        cols,
        rows,
        bw,
        bh,
        gapX,
        gapY,
        lines: lines as string[][],
        notes: notes as (string[] | undefined)[],
      };
    }
  }
  return undefined;
}

function chain(f: Flow, x: Ctx, fullW: number, fullH: number): string {
  const { c } = x;
  // The boxes' strokes stay inside the drawing: a 2-point inset on every side.
  const inset = 2;
  const w = fullW - inset * 2;
  const h = fullH - inset * 2;
  const k = f.steps.length;
  const cap = FLOW_STEP_CAP[keyStage() ?? "ks4"];
  if (k > cap) x.faults?.push(`the flow has ${k} steps, past the ${cap} this key stage reads`);
  const plan = planChain(f, x, w, h);
  if (!plan) {
    x.faults?.push("the flow does not fit its zone at a readable size");
    return "";
  }
  const { fs, noteFs, cols, rows, bw, bh, gapX, gapY } = plan;
  const totalW = bw * cols + gapX * (cols - 1);
  const totalH = bh * rows + gapY * (rows - 1);
  const ox = inset + (w - totalW) / 2;
  const oy = inset + (h - totalH) / 2;
  const boxes: Box[] = f.steps.map((_, i) => {
    const r = Math.floor(i / cols);
    const pos = i % cols;
    const col = r % 2 === 0 ? pos : cols - 1 - pos;
    return { cx: ox + col * (bw + gapX) + bw / 2, cy: oy + r * (bh + gapY) + bh / 2, w: bw, h: bh };
  });
  const out: string[] = [];
  const style = { fs: noteFs, fill: c.ink, weight: WEIGHT.label };
  boxes.forEach((b, i) => {
    const next = boxes[i + 1];
    if (!next) return;
    const [x1, y1] = edge(b, next.cx, next.cy, 4);
    const [x2, y2] = edge(next, b.cx, b.cy, 4);
    out.push(arrow(x1, y1, x2, y2, c.ink, STROKE.line));
    x.strokes?.push([x1, y1, x2, y2]);
    x.arrows?.push({
      tip: [x2, y2],
      target: {
        x0: next.cx - next.w / 2,
        y0: next.cy - next.h / 2,
        x1: next.cx + next.w / 2,
        y1: next.cy + next.h / 2,
      },
    });
    const lines = plan.notes[i];
    if (!lines) return;
    if (Math.abs(y2 - y1) < 1) {
      out.push(text(x, (x1 + x2) / 2, Math.min(y1, y2) - 6, lines, { v: "bottom", ...style }));
    } else {
      // Beside a vertical arrow, towards the middle of the drawing (a turn of the snake sits at an
      // outer column, so the middle of its gap row is clear).
      const toLeft = x1 > fullW / 2;
      out.push(
        text(x, toLeft ? x1 - 10 : x1 + 10, (y1 + y2) / 2, lines, {
          anchor: toLeft ? "end" : "start",
          ...style,
        }),
      );
    }
  });
  f.steps.forEach((_, i) => {
    const b = boxes[i];
    const lines = plan.lines[i];
    if (!b || !lines) return;
    out.push(
      `<rect x="${n(b.cx - b.w / 2)}" y="${n(b.cy - b.h / 2)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(fs * 0.5)}" fill="${c.tint}" stroke="${c.accent}" stroke-width="${STROKE.line}"/>`,
      text(x, b.cx, b.cy, lines, { weight: WEIGHT.name, fs }),
    );
  });
  return out.join("");
}

function cycle(f: Flow, x: Ctx, w: number, h: number): string {
  const { c, fs } = x;
  const k = f.steps.length;
  const bw = Math.min(w * (k <= 4 ? 0.42 : 0.36), fs * 11);
  const bh = Math.min(h * 0.22, fs * 3.6);
  // An inset, so the boxes' strokes never clip at the slot's edge.
  const rx = (w - bw) / 2 - 4;
  const ry = (h - bh) / 2 - 4;
  const cx = w / 2;
  const cy = h / 2;
  const boxes: Box[] = f.steps.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
    return { cx: cx + rx * Math.cos(a), cy: cy + ry * Math.sin(a), w: bw, h: bh };
  });
  const out: string[] = [];
  const small = Math.max(sub(fs), x.minFs);
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
    x.arrows?.push({
      tip: [x2, y2],
      target: {
        x0: next.cx - next.w / 2,
        y0: next.cy - next.h / 2,
        x1: next.cx + next.w / 2,
        y1: next.cy + next.h / 2,
      },
    });
    const note = f.steps[i]?.arrow;
    if (note) {
      const lx = qx + (ox / ol) * fs * 0.9;
      const ly = qy + (oy / ol) * fs * 0.9;
      out.push(
        text(x, lx, ly, [note], {
          anchor: Math.abs(ox) < 4 ? "middle" : ox > 0 ? "start" : "end",
          fs: small,
          fill: c.ink,
          weight: 600,
          halo: c.bg,
        }),
      );
    }
  });
  const bfs = boxSize(
    x,
    boxes,
    f.steps.map((s) => s.label),
  );
  f.steps.forEach((s, i) => {
    const b = boxes[i];
    if (b) out.push(box(x, b, s.label, bfs));
  });
  return out.join("");
}
