/**
 * Flows: a chain of steps laid out in rows that snake (left to right, then right to left, so every
 * arrow is a short straight one), or a cycle of three to six steps set clockwise round an ellipse.
 */
import type { KeyStage } from "../themes";
import { finishOf } from "./finish";
import { LIMITS } from "./limits";
import type { Flow } from "./schema";
import { STROKE, sub, WEIGHT } from "./style";
import { arrow, arrowHead, type Ctx, n, text, textWidth, wrap } from "./svg";

type Box = { cx: number; cy: number; w: number; h: number };

/** A label's lines in box `b` at `f` (as many as the box holds, 1.2 em each), or undefined if cut. */
function boxLines(x: Ctx, b: Box, label: string, f: number): string[] | undefined {
  const room = Math.max(1, Math.floor((b.h - f * 0.5) / (f * 1.2)));
  const lines = wrap(label, x, b.w - f * 0.9, Math.min(3, room), f, WEIGHT.name);
  // A single word longer than the box comes back whole from wrap: it would spill, so it does not fit.
  if (lines.some((l) => textWidth(l, x, f, WEIGHT.name) > b.w - f * 0.9 + 0.5)) return undefined;
  return lines[lines.length - 1]?.endsWith("…") ? undefined : lines;
}

/**
 * one text size for every box in a drawing, the largest at which every
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
  if (f.layout === "graph") return graph(f, x, w, h);
  return f.layout === "cycle" ? cycle(f, x, w, h) : chain(f, x, w, h);
}

// ─── graph ────────────────────────────────────────────────────────────────────────

type GLink = { from: number; to: number | "out"; label?: string };

/**
 * The layers of a flow graph: back links (those that close a loop) found by a depth-first walk
 * from the boxes nothing points into, then each box one layer past its furthest forward parent.
 */
export function graphLayers(k: number, links: GLink[]): { layer: number[]; back: Set<number> } {
  const inner = links
    .map((l, i) => ({ ...l, i }))
    .filter((l) => l.to !== "out" && l.to !== l.from) as (GLink & { to: number; i: number })[];
  const ins = Array(k).fill(0);
  for (const l of inner) ins[l.to]++;
  const state = Array(k).fill(0);
  const back = new Set<number>();
  const visit = (u: number) => {
    state[u] = 1;
    for (const l of inner)
      if (l.from === u) {
        if (state[l.to] === 1) back.add(l.i);
        else if (state[l.to] === 0) visit(l.to);
      }
    state[u] = 2;
  };
  const roots = ins.flatMap((v, i) => (v === 0 ? [i] : []));
  for (const r of roots.length ? roots : [0]) if (state[r] === 0) visit(r);
  for (let i = 0; i < k; i++) if (state[i] === 0) visit(i);
  const layer = Array(k).fill(0);
  for (let pass = 0; pass < k; pass++)
    for (const l of inner)
      if (!back.has(l.i)) layer[l.to] = Math.max(layer[l.to], layer[l.from] + 1);
  return { layer, back };
}

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Two rects overlap by more than a hair (with `pad` clear room round each). */
const hits = (a: Rect, b: Rect, pad = 0) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/** A straight segment as a thin rect (axis-aligned links only; a slanted one is skipped). */
const segRect = (x1: number, y1: number, x2: number, y2: number): Rect | undefined =>
  Math.abs(x1 - x2) < 1 || Math.abs(y1 - y2) < 1
    ? {
        x0: Math.min(x1, x2) - 1.5,
        x1: Math.max(x1, x2) + 1.5,
        y0: Math.min(y1, y2) - 1.5,
        y1: Math.max(y1, y2) + 1.5,
      }
    : undefined;

/** `k` evenly spaced ports along a side from `a` to `b` (one port: the middle). */
const ports = (k: number, a: number, b: number) =>
  Array.from({ length: k }, (_, i) => (k === 1 ? (a + b) / 2 : a + ((b - a) * i) / (k - 1)));

/**
 * Round 8: a flow as a small graph. Boxes stand in layers left to right (or
 * top to bottom in a tall zone) by their longest path from a start; a branch is one box with its
 * cases stacked in the next layer. Wide: a link back is a dashed curve under the boxes, a loop an
 * arc over its box, an "out" link an arrow down to its words. Tall: links back curve round the
 * left with their words outside the curve, "out" links leave to the right with their words after
 * the arrow, a loop is an arc over the right of its box. Every link meets a box at its own port, so
 * no arrowhead lands on another link's line, and every word, box and straight line is checked for
 * overlaps: a layout with any overlap tries a smaller size or the other direction. Each box is drawn
 * once. A graph that does not fit at a readable size is a fault (the slide falls back), never drawn
 * small.
 */
function graph(f: Flow, x: Ctx, fullW: number, fullH: number): string {
  const { c } = x;
  const inset = 2;
  const w = fullW - inset * 2;
  const h = fullH - inset * 2;
  const k = f.steps.length;
  const links = (f.links ?? []) as GLink[];
  const { layer, back } = graphLayers(k, links);
  const nl = Math.max(...layer) + 1;
  const cols: number[][] = Array.from({ length: nl }, () => []);
  layer.forEach((l, i) => {
    cols[l]?.push(i);
  });
  const most = Math.max(...cols.map((col) => col.length));
  const loops = links.filter((l) => l.to === l.from);
  // Round 8 drawer check (y12 multi-store): two arrows out of one box (STM: decay, displacement)
  // put their words side by side under it, where they always clashed, so the model never drew.
  // A box has one arrow out, its words each cause in turn ("Decay, displacement").
  const outs: GLink[] = [];
  for (const l of links)
    if (l.to === "out") {
      const same = outs.find((o) => o.from === l.from);
      if (!same) outs.push({ ...l });
      else if (l.label)
        same.label = same.label
          ? `${same.label}, ${l.label.replace(/^./, (ch) => ch.toLowerCase())}`
          : l.label;
    }
  const backs = links.filter((_, i) => back.has(i));
  const fwd = links.filter((l, i) => l.to !== "out" && l.to !== l.from && !back.has(i));
  for (const tall of w / h >= 1.1 ? [false, true] : [true, false])
    for (let fs = x.fs; fs >= x.minFs; fs -= 1) {
      const noteFs = Math.max(sub(fs), x.minFs);
      const lw = (t: string) => textWidth(t, x, noteFs, WEIGHT.label);
      const wordW = (t?: string) => Math.max(0, ...(t ?? "").split(/\s+/).map(lw));
      const oneLine = (t?: string) => (t ? lw(t) : 0);
      const fwdWord = Math.max(0, ...fwd.map((l) => wordW(l.label)));
      const loopRoom = loops.length ? fs * 1.6 + noteFs * 1.3 : 0;
      // Along the flow: the gap between layers holds the forward links' words (and, tall, a loop).
      const gapMain = Math.max(fs * 2, tall ? Math.max(noteFs * 2.6, loopRoom + 6) : fwdWord + 16);
      const gapCross = fs * 1.1;
      const outRoom = !tall && outs.length ? fs * 1.8 + noteFs * 2.5 : 0;
      const backRoom =
        !tall && backs.length
          ? fs * 1.2 +
            (backs.length - 1) * fs * 0.5 +
            (backs.some((b) => b.label) ? noteFs * 1.3 : 0)
          : 0;
      // Tall: the room left of the boxes for links back and their words, right for "out" links.
      const backWord = Math.max(0, ...backs.map((l) => oneLine(l.label)));
      const outWord = Math.max(0, ...outs.map((l) => oneLine(l.label)));
      const leftRoom = tall && backs.length ? backWord + fs * 1.4 + backs.length * fs * 0.6 : 0;
      const rightRoom = tall && outs.length ? fs * 2 + outWord + 8 : 0;
      const across = tall ? most : nl;
      const bw = Math.min(
        tall
          ? (w - leftRoom - rightRoom - gapCross * (across - 1)) / across
          : (w - gapMain * (nl - 1)) / nl,
        fs * 12,
      );
      if (bw < fs * 3.5) continue;
      const lines = f.steps.map((s) => {
        const l = wrap(s.label, x, bw - fs * 0.9, 3, fs, WEIGHT.name);
        return l[l.length - 1]?.endsWith("…") ||
          l.some((t) => textWidth(t, x, fs, WEIGHT.name) > bw - fs * 0.9 + 0.5)
          ? undefined
          : l;
      });
      if (lines.some((l) => !l)) continue;
      const bh = Math.max(...lines.map((l) => (l as string[]).length)) * fs * 1.2 + fs * 0.7;
      const linkWords = (t?: string, room = bw) =>
        t ? wrap(t, x, room, 2, noteFs, WEIGHT.label) : undefined;
      const fwdRoom = tall ? w / 2 : Math.max(gapMain - 8, bw);
      if (fwd.some((l) => l.label && linkWords(l.label, fwdRoom)?.at(-1)?.endsWith("…"))) continue;
      const stackH = tall ? nl * bh + (nl - 1) * gapMain : most * bh + (most - 1) * gapCross;
      const totalH =
        stackH +
        (tall ? (loops.length && layer[loops[0]?.from ?? 0] === 0 ? loopRoom : 0) : loopRoom) +
        outRoom +
        backRoom;
      if (totalH > h) continue;
      // Positions.
      const boxes: Box[] = Array(k);
      const top = inset + (h - totalH) / 2 + (tall ? totalH - stackH : loopRoom);
      const left = inset + leftRoom;
      const midW = w - leftRoom - rightRoom;
      cols.forEach((col, li) => {
        col.forEach((node, j) => {
          if (tall) {
            const rowW = col.length * bw + (col.length - 1) * gapCross;
            boxes[node] = {
              cx: left + (midW - rowW) / 2 + j * (bw + gapCross) + bw / 2,
              cy: top + li * (bh + gapMain) + bh / 2,
              w: bw,
              h: bh,
            };
          } else {
            const colH = col.length * bh + (col.length - 1) * gapCross;
            const totalW = nl * bw + (nl - 1) * gapMain;
            boxes[node] = {
              cx: inset + (w - totalW) / 2 + li * (bw + gapMain) + bw / 2,
              cy: top + (stackH - colH) / 2 + j * (bh + gapCross) + bh / 2,
              w: bw,
              h: bh,
            };
          }
        });
      });
      const rectOf = (b: Box): Rect => ({
        x0: b.cx - b.w / 2,
        y0: b.cy - b.h / 2,
        x1: b.cx + b.w / 2,
        y1: b.cy + b.h / 2,
      });
      // Ports: each link end on a box's side (wide: the bottom; tall: left for links back, right
      // for "out" links) gets its own place, ordered by where the link goes.
      const side: Map<number, { key: string; toward: number }[]> = new Map();
      const want = (box: number, key: string, toward: number) => {
        const l = side.get(box) ?? [];
        l.push({ key, toward });
        side.set(box, l);
      };
      backs.forEach((l, bi) => {
        const a = boxes[l.from] as Box;
        const b = boxes[l.to as number] as Box;
        want(l.from, `b${bi}s`, tall ? b.cy : b.cx);
        want(l.to as number, `b${bi}e`, tall ? a.cy : a.cx);
      });
      if (!tall)
        outs.forEach((l, oi) => {
          want(l.from, `o${oi}`, (boxes[l.from] as Box).cx);
        });
      const port = new Map<string, number>();
      for (const [bi, l] of side) {
        const b = boxes[bi] as Box;
        const o = [...l].sort((p, q) => p.toward - q.toward);
        const span = tall ? b.h * 0.3 : b.w * 0.3;
        const at = ports(o.length, (tall ? b.cy : b.cx) - span, (tall ? b.cy : b.cx) + span);
        o.forEach((p, i) => {
          port.set(p.key, at[i] as number);
        });
      }
      const out: string[] = [];
      const rec0 = x.rec?.length ?? 0;
      const strokes0 = x.strokes?.length ?? 0;
      const arrows0 = x.arrows?.length ?? 0;
      const labels: { r: Rect; own: string }[] = [];
      const lines2: { r: Rect; own: string }[] = [];
      const style = { fs: noteFs, fill: c.ink, weight: WEIGHT.label, halo: c.bg };
      const lab = (
        own: string,
        px: number,
        py: number,
        wl: string[],
        o: { anchor?: "start" | "middle" | "end"; v?: "top" | "bottom" | "middle" } = {},
      ) => {
        const lh = 1.2 * noteFs;
        const block = (wl.length - 1) * lh;
        const t0 =
          o.v === "top"
            ? py + noteFs * 0.8
            : o.v === "bottom"
              ? py - block - noteFs * 0.25
              : py - block / 2 + noteFs * 0.35;
        const bwl = Math.max(...wl.map(lw));
        const a = o.anchor ?? "middle";
        const x0 = a === "middle" ? px - bwl / 2 : a === "end" ? px - bwl : px;
        labels.push({
          r: { x0, x1: x0 + bwl, y0: t0 - noteFs * 0.8, y1: t0 + block + noteFs * 0.25 },
          own,
        });
        out.push(text(x, px, py, wl, { ...o, ...style }));
      };
      const seg = (own: string, x1: number, y1: number, x2: number, y2: number) => {
        const r = segRect(x1, y1, x2, y2);
        if (r) lines2.push({ r, own });
      };
      const target = rectOf;
      fwd.forEach((l, fi) => {
        const a = boxes[l.from] as Box;
        const b = boxes[l.to as number] as Box;
        const [x1, y1] = edge(a, b.cx, b.cy, 4);
        const [x2, y2] = edge(b, a.cx, a.cy, 4);
        out.push(arrow(x1, y1, x2, y2, c.ink, STROKE.line));
        x.strokes?.push([x1, y1, x2, y2]);
        x.arrows?.push({ tip: [x2, y2], target: target(b) });
        seg(`f${fi}`, x1, y1, x2, y2);
        const wl = linkWords(l.label, fwdRoom);
        // Tall: the words stand right of the arrow, or left when a loop's arc is over the right
        // of the box it points to (and so clear of the links back curving round the left).
        if (wl)
          if (tall && loops.some((o) => o.from === l.to))
            lab(`f${fi}`, (x1 + x2) / 2 - 8, (y1 + y2) / 2, wl, { anchor: "end" });
          else if (tall) lab(`f${fi}`, (x1 + x2) / 2 + 8, (y1 + y2) / 2, wl, { anchor: "start" });
          else lab(`f${fi}`, (x1 + x2) / 2, Math.min(y1, y2) - 5, wl, { v: "bottom" });
      });
      const floor = top + stackH;
      backs.forEach((l, bi) => {
        const a = boxes[l.from] as Box;
        const b = boxes[l.to as number] as Box;
        const head = fs * 0.7;
        const ps = port.get(`b${bi}s`) as number;
        const pe = port.get(`b${bi}e`) as number;
        if (tall) {
          const sx = a.cx - a.w / 2 - 4;
          const ex = b.cx - b.w / 2 - 4;
          // The curve's leftmost point stands just right of its words.
          const xm = inset + backWord + fs * 0.6 + (backs.length - 1 - bi) * fs * 0.6;
          const qx = 2 * xm - (sx + ex - head * 0.8) / 2;
          out.push(
            `<path d="M${n(sx)},${n(ps)} Q${n(qx)},${n((ps + pe) / 2)} ${n(ex - head * 0.8)},${n(pe)}" fill="none" stroke="${c.ink}" stroke-width="${STROKE.line}" stroke-dasharray="7 5"/>`,
            arrowHead(ex, pe, ex - head, pe, head, c.ink),
          );
          x.arrows?.push({ tip: [ex, pe], target: target(b) });
          const wl = linkWords(l.label, backWord + 1);
          if (wl) lab(`b${bi}`, xm - 6, (ps + pe) / 2, wl, { anchor: "end" });
        } else {
          const sy = a.cy + a.h / 2 + 4;
          const ey = b.cy + b.h / 2 + 4;
          const qy = floor + fs * 1.0 + bi * fs * 0.5;
          out.push(
            `<path d="M${n(ps)},${n(sy)} C${n(ps)},${n(qy)} ${n(pe)},${n(qy)} ${n(pe)},${n(ey + head * 0.8)}" fill="none" stroke="${c.ink}" stroke-width="${STROKE.line}" stroke-dasharray="7 5"/>`,
            arrowHead(pe, ey, pe, ey + head, head, c.ink),
          );
          x.arrows?.push({ tip: [pe, ey], target: target(b) });
          const wl = linkWords(l.label, Math.max(Math.abs(ps - pe) - 8, fs * 3));
          // The curve's lowest point is 3/4 of the way to qy.
          if (wl) lab(`b${bi}`, (ps + pe) / 2, sy + (qy - sy) * 0.75, wl, { v: "middle" });
        }
      });
      loops.forEach((l, li) => {
        const b = boxes[l.from] as Box;
        const r = fs * 0.75;
        const y0 = b.cy - b.h / 2;
        const xa = tall ? b.cx + b.w * 0.12 : b.cx - b.w * 0.22;
        const xb = tall ? b.cx + b.w * 0.4 : b.cx + b.w * 0.22;
        const head = fs * 0.6;
        out.push(
          `<path d="M${n(xa)},${n(y0 - 3)} C${n(xa)},${n(y0 - r * 2.2)} ${n(xb)},${n(y0 - r * 2.2)} ${n(xb)},${n(y0 - 3 - head * 0.8)}" fill="none" stroke="${c.ink}" stroke-width="${STROKE.line}"/>`,
          arrowHead(xb, y0 - 3, xb, y0 - 3 - head, head, c.ink),
        );
        x.arrows?.push({ tip: [xb, y0 - 3], target: target(b) });
        lines2.push({ r: { x0: xa - 2, x1: xb + head, y0: y0 - r * 1.75, y1: y0 }, own: `l${li}` });
        // Tall: the words stand right of the arc, clear of the forward arrow's words on the left.
        if (l.label)
          if (tall)
            lab(`l${li}`, xb + head * 0.6 + 6, y0 - r * 1.4, [l.label], { anchor: "start" });
          else lab(`l${li}`, (xa + xb) / 2, y0 - r * 1.75 - 2, [l.label], { v: "bottom" });
      });
      outs.forEach((l, oi) => {
        const b = boxes[l.from] as Box;
        const same = outs.filter((o) => o.from === l.from);
        const si = same.indexOf(l);
        const sx = tall ? b.cx + b.w / 2 + 4 : (port.get(`o${oi}`) as number);
        const sy = tall
          ? (ports(same.length, b.cy - b.h * 0.25, b.cy + b.h * 0.25)[si] as number)
          : b.cy + b.h / 2 + 4;
        const ex = tall ? sx + fs * 1.8 : sx;
        const ey = tall ? sy : Math.max(sy + fs * 1.4, floor + backRoom + fs * 1.4);
        out.push(arrow(sx, sy, ex, ey, c.muted, STROKE.line));
        x.strokes?.push([sx, sy, ex, ey]);
        seg(`o${oi}`, sx, sy, ex, ey);
        const wl = linkWords(l.label, tall ? outWord + 1 : bw);
        if (wl)
          if (tall) lab(`o${oi}`, ex + 6, ey, wl, { anchor: "start", v: "middle" });
          else lab(`o${oi}`, ex, ey + 4, wl, { v: "top" });
      });
      // Every word clear of every box, every other word and every other link's line, inside the zone.
      const boxRects = boxes.map(rectOf);
      const clash = labels.some(
        (a, i) =>
          a.r.x0 < 0 ||
          a.r.x1 > fullW ||
          a.r.y0 < 0 ||
          a.r.y1 > fullH ||
          boxRects.some((b) => hits(a.r, b, 2)) ||
          labels.some((o, j) => j > i && hits(a.r, o.r, 3)) ||
          lines2.some((o) => o.own !== a.own && hits(a.r, o.r, 1)),
      );
      if (clash) {
        // A rejected layout leaves no trace in the checks' records.
        if (x.rec) x.rec.length = rec0;
        if (x.strokes) x.strokes.length = strokes0;
        if (x.arrows) x.arrows.length = arrows0;
        continue;
      }
      f.steps.forEach((s, i) => {
        const b = boxes[i];
        const l = lines[i];
        if (!b || !l) return;
        void s;
        out.push(
          `<rect x="${n(b.cx - b.w / 2)}" y="${n(b.cy - b.h / 2)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(fs * finishOf(x).radius.box)}" fill="${c.tint}" stroke="${c.accent}" stroke-width="${finishOf(x).stroke.box}"/>`,
          text(x, b.cx, b.cy, l, { weight: WEIGHT.name, fs }),
        );
      });
      return out.join("");
    }
  x.faults?.push("the flow does not fit its zone at a readable size");
  return "";
}

/** dd-diagrams: the most steps a chain shows at each key stage; past it the flow does not draw. */
export const FLOW_STEP_CAP: Record<KeyStage, number> = LIMITS.steps;

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
  // dd-diagrams2: every size from the label size down to the stage floor, before giving up.
  const sizes: number[] = [];
  for (let v = x.fs; v >= x.minFs; v -= 1) sizes.push(v);
  // dd-diagrams2: the shapes that suit the zone are tried at every size first (a row or a snake
  // across a wide zone, a column or a snake down a tall one); the others only after.
  const wideZone = w / h >= 1.6;
  const passes: [number, number][][] = wideZone
    ? [
        [
          [k, 1],
          [Math.ceil(k / 2), 2],
        ],
        [
          [1, k],
          [2, Math.ceil(k / 2)],
        ],
      ]
    : [
        [
          [1, k],
          [Math.ceil(k / 2), 2],
        ],
        [
          [2, Math.ceil(k / 2)],
          [k, 1],
        ],
      ];
  for (const shapes of passes)
    for (const fs of sizes) {
      const noteFs = Math.max(sub(fs), x.minFs);
      for (const [cols, rows] of shapes) {
        // A row, a column, a two-row snake, or (dd-diagrams2) a two-column zigzag in a tall zone.
        if (rows > 2 && cols > 2) continue;
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
        const gapX = cols > 1 ? Math.max(fs * 1.8, longestWord + 16) : 0;
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
        const bh = most * fs * 1.2 + fs * 0.7;
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

        // A word above a row arrow needs room over the arrow, inside the box band.
        const hNoteH = Math.max(
          0,
          ...notes.flatMap((l, i) => (l && rowArrow(i) ? [l.length * noteFs * 1.2 + 8] : [])),
        );
        // A word over a row arrow rises out of the box band into the gap above (or the margin over
        // the first row): the gap grows to hold it.
        const rise = Math.max(0, hNoteH - bh / 2);
        const gapY = rows > 1 ? Math.max(fs * 1.5, vNoteH + 10, rise + 4) : 0;
        const totalH = rows * bh + (rows - 1) * gapY + 2 * rise;

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
  const cap = FLOW_STEP_CAP[x.stage ?? "ks4"];
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
  const base = Math.min(w * (k <= 4 ? 0.42 : 0.36), fs * 11);
  const bh = Math.min(h * 0.22, fs * 3.6);
  const cx = w / 2;
  const cy = h / 2;
  const ring = (bw: number): Box[] => {
    // An inset, so the boxes' strokes never clip at the slot's edge.
    const rx = (w - bw) / 2 - 4;
    const ry = (h - bh) / 2 - 4;
    return f.steps.map((_, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / k;
      return { cx: cx + rx * Math.cos(a), cy: cy + ry * Math.sin(a), w: bw, h: bh };
    });
  };
  // A box widens (up to about half the zone) before a long word ("Condensation") spills over it.
  const labels = f.steps.map((s) => s.label);
  const fitsIn = (bs: Box[]) => {
    const f0 = boxSize(x, bs, labels);
    return labels.every((l, i) => boxLines(x, bs[i] as Box, l, f0));
  };
  const widest = Math.max(base, w * (k <= 4 ? 0.48 : 0.4));
  let boxes = ring(base);
  for (let i = 1; i <= 4 && !fitsIn(boxes); i++) boxes = ring(base + ((widest - base) * i) / 4);
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
