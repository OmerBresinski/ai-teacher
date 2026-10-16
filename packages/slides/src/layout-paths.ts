/**
 * Dotted input paths of an adaptive layout's `LayoutRef` (TEACH-205 part b), shared by the lazy
 * relayout (`./relayout`) and the editor's history, which writes a child's new words through to
 * the ref. Kept out of `@tj/domain`'s barrel and `@tj/slides`' index so they load only with the
 * editor, not on every lesson page.
 */
import type { LayoutRef, TextPreset, Theme } from "@tj/domain/documents";
import { resolveFontSize } from "./text-style";

const segs = (path: string) => path.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));

/** The value at a dotted path ("grid.1.text") in the ref's input. */
export function getAtPath(ref: LayoutRef, path: string): unknown {
  let v: unknown = ref.input;
  for (const k of segs(path)) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string | number, unknown>)[k];
  }
  return v;
}

/** A copy of the ref with one value set at a dotted path; the source is untouched. */
export function setAtPath(ref: LayoutRef, path: string, value: unknown): LayoutRef {
  const put = (node: unknown, keys: (string | number)[]): unknown => {
    const [k, ...rest] = keys;
    if (k === undefined) return value;
    const next = rest.length ? put((node as Record<string | number, unknown>)?.[k], rest) : value;
    if (Array.isArray(node)) {
      const arr = [...node];
      arr[k as number] = next;
      return arr;
    }
    return { ...((node as object) ?? {}), [k]: next };
  };
  return { ...ref, input: put(ref.input, segs(path)) as Record<string, unknown> };
}

/**
 * The input path a layout group's child shows, from its id (`<groupId>:<path>`, written by
 * `relayout`); undefined for a child that is not bound to a field (`<groupId>:<n>`).
 */
export function boundPath(groupId: string, childId: string): string | undefined {
  const prefix = `${groupId}:`;
  if (!childId.startsWith(prefix)) return undefined;
  const path = childId.slice(prefix.length);
  // A box with no field: its place (`3`) or its name (`~Row_picture-0`, TEACH-110 part s).
  return /^\d+$/.test(path) || path.startsWith("~") || !path ? undefined : path;
}

type Box = { x: number; y: number; w: number; h: number };
type Scalable = Box & {
  style?: { fontSize?: number };
  textStyle?: { fontSize?: number };
  strokeWidth?: number;
  radius?: number;
  children?: Scalable[];
};

/**
 * Elements laid out in `from`, fitted whole into `to` (a resized layout group, TEACH-205 part b):
 * one scale for every box, type size, stroke and radius, centred in `to`, so nothing is squashed
 * and no text overlaps what sits under it. Pure; group children (local space) are scaled, not moved.
 */
export function fitInto<T extends Scalable>(els: readonly T[], from: Box, to: Box): T[] {
  const k = Math.min(to.w / (from.w || 1), to.h / (from.h || 1));
  const ox = to.x + (to.w - from.w * k) / 2;
  const oy = to.y + (to.h - from.h * k) / 2;
  const size = (v: number | undefined) => (v === undefined ? v : Math.round(v * k * 2) / 2);
  const scale = (e: Scalable, local: boolean): Scalable => {
    const next: Scalable = {
      ...e,
      x: local ? e.x * k : ox + (e.x - from.x) * k,
      y: local ? e.y * k : oy + (e.y - from.y) * k,
      w: e.w * k,
      h: e.h * k,
    };
    if (e.style?.fontSize !== undefined)
      next.style = { ...e.style, fontSize: size(e.style.fontSize) };
    if (e.textStyle?.fontSize !== undefined)
      next.textStyle = { ...e.textStyle, fontSize: size(e.textStyle.fontSize) };
    if (e.strokeWidth !== undefined) next.strokeWidth = e.strokeWidth * k;
    if (e.radius !== undefined) next.radius = e.radius * k;
    if (e.children) next.children = e.children.map((c) => scale(c, true));
    return next;
  };
  return els.map((e) => scale(e, false) as T);
}

type TextLike = {
  style?: { preset?: string; fontSize?: number };
  textStyle?: { fontSize?: number };
};

/**
 * The smallest uniform scale a laid-out layout takes before its words stop shrinking with it: the
 * renderer holds type at the theme's steps and floors (`resolveFontSize`), so below this scale the
 * words keep their size while their boxes shrink, and they overlap. 1 when nothing may shrink.
 */
export function minFitScale(
  els: readonly (Box & TextLike & { children?: unknown[] })[],
  theme: Theme,
): number {
  const sizes: { preset: string; fs: number }[] = [];
  const walk = (list: readonly (TextLike & { children?: unknown[] })[]) => {
    for (const e of list) {
      const fs = e.style?.fontSize ?? e.textStyle?.fontSize;
      if (fs) sizes.push({ preset: e.style?.preset ?? "body", fs });
      if (Array.isArray(e.children)) walk(e.children as TextLike[]);
    }
  };
  walk(els);
  const holds = (k: number) =>
    sizes.every(
      ({ preset, fs }) => resolveFontSize(theme, preset as TextPreset, fs * k) <= fs * k + 0.05,
    );
  let k = 1;
  for (let t = 0.99; t >= 0.3; t -= 0.01) {
    if (!holds(t)) break;
    k = t;
  }
  return k;
}

/** The smallest size a layout group may be resized to (`minFitScale` of what it shows now). */
export function minLayoutSize(
  group: Box & { children: readonly (Box & TextLike)[] },
  theme: Theme,
) {
  const k = minFitScale(group.children, theme);
  return { w: group.w * k, h: group.h * k };
}
