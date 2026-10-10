/**
 * Register diagrams-02: what keeps a reader from telling which label names what, read from what a
 * drawing recorded (its label boxes, strokes, leaders and closed parts). Two labels touching; a
 * line of the drawing, or another label's leader, set across a label; a label over another label's
 * point; two leaders crossing; a leader that ends on nothing drawn. Empty when every label reads
 * clear. Each entry starts with its kind ("overlap: ...").
 */
import type { DrawnText } from "./svg";

type Seg = [number, number, number, number];

/** A segment passes through the inside of a box (exact: a long leader never skips a short label). */
export function segThroughBox(
  [ax, ay]: [number, number],
  [bx, by]: [number, number],
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  if (b.x1 <= b.x0 || b.y1 <= b.y0) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [
    [-dx, ax - b.x0],
    [dx, b.x1 - ax],
    [-dy, ay - b.y0],
    [dy, b.y1 - ay],
  ] as const) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return false;
  }
  return true;
}

/** Two segments cross at a point inside both (touching ends do not count). */
export function segmentsCross([ax, ay, bx, by]: Seg, [cx, cy, dx, dy]: Seg): boolean {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

export function labelRule(
  rec: DrawnText[],
  strokes: Seg[],
  leaders: Seg[],
  parts: [number, number][][],
): string[] {
  const out: string[] = [];
  for (let i = 0; i < rec.length; i++)
    for (let j = i + 1; j < rec.length; j++) {
      const a = rec[i];
      const b = rec[j];
      if (!a || !b) continue;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox > 1 && oy > 1) out.push(`overlap: "${a.text}" and "${b.text}"`);
    }
  // A segment through the label's box, less the small margin `diagramFaults` allows.
  const across = (b: (typeof rec)[number], [ax, ay, bx, by]: Seg) =>
    segThroughBox([ax, ay], [bx, by], { x0: b.x0 + 3, y0: b.y0 + 4, x1: b.x1 - 3, y1: b.y1 - 4 });
  // A label's own leader starts at its box's edge.
  const own = (b: (typeof rec)[number], [sx, sy]: Seg) =>
    sx >= b.x0 - 6 && sx <= b.x1 + 6 && sy >= b.y0 - 6 && sy <= b.y1 + 6;
  for (const b of rec) {
    if (strokes.some((sg) => across(b, sg))) out.push(`line across: "${b.text}"`);
    if (leaders.some((l) => !own(b, l) && across(b, l))) out.push(`leader across: "${b.text}"`); // Another label's point under these words: its leader ends hidden.
    const under = ([, , ex, ey]: Seg) =>
      ex > b.x0 - 2 && ex < b.x1 + 2 && ey > b.y0 - 2 && ey < b.y1 + 2;
    if (leaders.some((l) => !own(b, l) && under(l))) out.push(`point under: "${b.text}"`);
  }
  const near = ([px, py]: [number, number], [ax, ay, bx, by]: Seg) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy) <= 3;
  };
  const inside = ([px, py]: [number, number], pts: [number, number][]) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i] as [number, number];
      const b = pts[j] as [number, number];
      if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0])
        hit = !hit;
    }
    return hit;
  };
  for (let i = 0; i < leaders.length; i++)
    for (let j = i + 1; j < leaders.length; j++)
      if (segmentsCross(leaders[i] as Seg, leaders[j] as Seg)) out.push("leaders cross");
  for (const l of leaders) {
    const end: [number, number] = [l[2], l[3]];
    if (!strokes.some((sg) => near(end, sg)) && !parts.some((pts) => inside(end, pts)))
      out.push("leader ends on nothing drawn");
  }
  return [...new Set(out)];
}
