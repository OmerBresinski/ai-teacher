/**
 * Arrowhead clashes on a drawn library SVG (TEACH-75 part x): a head (the arrow primitive's open
 * chevron) must not overlap a word, touch a leader line, or touch a leader's dot, on any frame where
 * both show. Touching edge to edge is allowed; overlapping by more than half a pixel is not.
 */
import type { DrawnArrows, DrawnWords } from "./render";

type P2 = [number, number];
const together = (a?: number[], b?: number[]) => !a || !b || a.some((i) => b.includes(i));
const segDist = (a: P2, b: P2, p: P2) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
};
const along = (a: P2, b: P2, n: number): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);

export function arrowClashes(words: DrawnWords[], arrows: DrawnArrows): string[] {
  const out: string[] = [];
  for (const h of arrows.heads) {
    const [a0, tip, a1] = h.pts as [P2, P2, P2];
    const hw = Math.hypot(a0[0] - tip[0], a0[1] - tip[1]) / 3.2 / 2;
    const segs: [P2, P2][] = [
      [a0, tip],
      [tip, a1],
    ];
    const name = `head at ${tip.map((v) => Math.round(v)).join(",")}`;
    const near = (p: P2, gap: number) => segs.some(([a, b]) => segDist(a, b, p) < gap);
    for (const w of words) {
      if (!together(h.shown, w.shown)) continue;
      const pad = hw - 0.5;
      const hit = segs.some(([a, b]) =>
        along(a, b, 24).some(
          ([x, y]) => x > w.x0 - pad && x < w.x1 + pad && y > w.y0 - pad && y < w.y1 + pad,
        ),
      );
      if (hit) out.push(`${name} overlaps "${w.words.slice(0, 24)}"`);
    }
    const ends: P2[] = [];
    for (const l of arrows.leaders) {
      if (!together(h.shown, l.shown)) continue;
      const first = l.pts[0] as P2;
      const last = l.pts[l.pts.length - 1] as P2;
      ends.push(first, last);
      // the arrow's own line, wherever a build draws it, ends on the tip
      if (Math.hypot(last[0] - tip[0], last[1] - tip[1]) < 1.5) continue;
      const gap = hw + l.w / 2 - 0.5;
      let hit = false;
      for (let i = 0; i + 1 < l.pts.length && !hit; i++)
        hit = along(l.pts[i] as P2, l.pts[i + 1] as P2, 48).some((p) => near(p, gap));
      if (hit) out.push(`${name} touches a leader`);
    }
    for (const d of arrows.dots) {
      if (!together(h.shown, d.shown)) continue;
      if (!ends.some((e) => Math.hypot(e[0] - d.c[0], e[1] - d.c[1]) < d.r * 2 + 3)) continue;
      if (near(d.c, hw + d.r - 0.5)) out.push(`${name} touches a leader dot`);
    }
  }
  return [...new Set(out)];
}
