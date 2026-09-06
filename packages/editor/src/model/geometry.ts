import type { SlideElement } from "@tj/domain/documents";

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export const rectOf = (el: Pick<SlideElement, "x" | "y" | "w" | "h">): Rect => ({
  x: el.x,
  y: el.y,
  w: el.w,
  h: el.h,
});

export function unionRect(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Axis-aligned bounding box of a rect rotated about its centre (degrees). */
export function rotatedBounds(r: Rect, deg = 0): Rect {
  if (!deg) return r;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = r.w * cos + r.h * sin;
  const h = r.w * sin + r.h * cos;
  const c = centre(r);
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

export function rotatePoint(p: Point, about: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return {
    x: about.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: about.y + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, step = 1) => Math.round(v / step) * step;

export function snapAngle(deg: number, step = 15, threshold = 4): number {
  const nearest = Math.round(deg / step) * step;
  return Math.abs(nearest - deg) <= threshold ? nearest : deg;
}

export function normaliseAngle(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}
