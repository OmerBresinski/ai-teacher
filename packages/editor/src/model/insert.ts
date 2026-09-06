/**
 * What the insert rail creates (TeachDeck `components/editor/insert.ts`). Every preset lands at
 * the slide centre at a size a teacher would have drawn anyway, so "click, then type" is the whole
 * interaction. Pure factories only: TeachDeck's `insertElement` read the zustand store; here the
 * shell composes `reducers.addElement` with its own selection state (ADR 0022 §4).
 */

import {
  type EmbedElement,
  type IconElement,
  type ImageElement,
  type LineElement,
  type ShapeElement,
  SLIDE_H,
  SLIDE_W,
  type TableElement,
  type TextElement,
  type TextPreset,
  type Theme,
  type TimerElement,
} from "@tj/domain/documents";
import { newText, uid } from "./factories";
import type { Point, Rect } from "./geometry";
import { fitWithin } from "./images";
import { fontFloor } from "./themes";

/** How far an element may hang off the stage, slide points (transform `constants.ts`). */
export const OVERHANG = 40;

const CENTRE = { x: SLIDE_W / 2, y: SLIDE_H / 2 };

/** A rect of this size centred on `at` (slide centre by default), clamped to the stage. */
export function placeRect(w: number, h: number, at: Point = CENTRE): Rect {
  return clampRect({ x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), w, h });
}

export function clampRect(r: Rect): Rect {
  return {
    ...r,
    x: Math.min(SLIDE_W - OVERHANG, Math.max(OVERHANG - r.w, r.x)),
    y: Math.min(SLIDE_H - OVERHANG, Math.max(OVERHANG - r.h, r.y)),
  };
}

/** One line of a preset, in slide points — the height a fresh text box wants. */
const lineH = (theme: Theme, preset: TextPreset) =>
  Math.ceil(theme.sizes[preset] * theme.lineHeights[preset]);

export type TextPresetSpec = {
  preset: TextPreset;
  label: string;
  width: number;
  placeholder: string;
};

const BODY_PRESET: TextPresetSpec = {
  preset: "body",
  label: "Body",
  width: 520,
  placeholder: "Body text",
};

export const TEXT_PRESETS: readonly TextPresetSpec[] = [
  { preset: "title", label: "Title", width: 700, placeholder: "Title" },
  { preset: "heading", label: "Heading", width: 600, placeholder: "Heading" },
  BODY_PRESET,
];

export function makeText(preset: TextPreset, theme: Theme, at?: Point): TextElement {
  const spec = TEXT_PRESETS.find((p) => p.preset === preset) ?? BODY_PRESET;
  return newText(preset, spec.placeholder, placeRect(spec.width, lineH(theme, preset), at));
}

export const SHAPE_KINDS: readonly { shape: ShapeElement["shape"]; label: string }[] = [
  { shape: "rect", label: "Rectangle" },
  { shape: "rounded", label: "Rounded" },
  { shape: "ellipse", label: "Ellipse" },
  { shape: "triangle", label: "Triangle" },
  { shape: "diamond", label: "Diamond" },
  { shape: "star", label: "Star" },
  { shape: "speech", label: "Speech bubble" },
  { shape: "pill", label: "Pill" },
];

export function makeShape(shape: ShapeElement["shape"], theme: Theme, at?: Point): ShapeElement {
  const square = shape === "ellipse" || shape === "star" || shape === "diamond";
  const size = square
    ? { w: 220, h: 220 }
    : shape === "pill"
      ? { w: 280, h: 96 }
      : { w: 280, h: 180 };
  return {
    id: uid(),
    type: "shape",
    shape,
    ...placeRect(size.w, size.h, at),
    fill: theme.colors.accent2,
    radius: shape === "rounded" ? theme.radius : undefined,
  };
}

export const LINE_KINDS: readonly { id: "line" | "arrow"; label: string }[] = [
  { id: "line", label: "Line" },
  { id: "arrow", label: "Arrow" },
];

export function makeLine(kind: "line" | "arrow", theme: Theme, at?: Point): LineElement {
  return {
    id: uid(),
    type: "line",
    ...placeRect(320, 32, at),
    from: { x: 0, y: 0.5 },
    to: { x: 1, y: 0.5 },
    stroke: theme.colors.ink,
    strokeWidth: 3,
    arrowEnd: kind === "arrow",
  };
}

export function makeIcon(icon: string, theme: Theme, at?: Point): IconElement {
  return { id: uid(), type: "icon", ...placeRect(120, 120, at), icon, color: theme.colors.accent };
}

export function makeTable(theme: Theme, at?: Point): TableElement {
  return {
    id: uid(),
    type: "table",
    ...placeRect(620, 200, at),
    header: true,
    stripe: true,
    fontSize: Math.max(fontFloor("small"), theme.sizes.small),
    rows: [
      ["Column", "Column", "Column"],
      ["", "", ""],
      ["", "", ""],
    ],
  };
}

export function makeTimer(at?: Point): TimerElement {
  return { id: uid(), type: "timer", ...placeRect(300, 180, at), seconds: 300 };
}

export function makeEmbed(at?: Point): EmbedElement {
  return { id: uid(), type: "embed", ...placeRect(600, 338, at), url: "" };
}

/** Images arrive at their own aspect, capped at 60% of the slide (SPEC §7). */
export function makeImage(
  src: string,
  natural: { w: number; h: number },
  at?: Point,
): ImageElement {
  const { w, h } = fitWithin(natural, { w: SLIDE_W * 0.6, h: SLIDE_H * 0.6 });
  return { id: uid(), type: "image", ...placeRect(w, h, at), src, fit: "contain" };
}
