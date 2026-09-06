/*
 * The numeric helpers `NumberInput` (and later the drawers) need, DOM-free. From TeachDeck
 * `components/ui2/math.ts`. This `clamp` takes optional bounds, unlike the slide-geometry one.
 */

/** Hold `v` inside `[min, max]`. An undefined bound does not clamp that side. */
export function clamp(v: number, min?: number, max?: number): number {
  let out = v;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

/** Snap `v` to the nearest `min + n * step`. */
export function snap(v: number, min: number, step: number): number {
  return min + Math.round((v - min) / step) * step;
}

/** Round to `precision` decimal places, avoiding a trailing float tail. */
export function round(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}

/** Fixed-precision string for display in a field. */
export function format(v: number, precision: number): string {
  return v.toFixed(precision);
}
