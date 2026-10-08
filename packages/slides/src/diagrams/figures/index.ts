/**
 * Figure templates (ADR 0032 and its 2026-09-26 amendment). A template takes the values and labels
 * the model supplies and draws the geometry itself; `drawFigure` returns the drawing as one `group`
 * that carries its own alt text and the values it was drawn from, so Repair and cascade (TEACH-89)
 * redraw it from them rather than from its label text.
 *
 * Drawing never throws: a template's value rules are editorial (a slide that still breaks a shape
 * rule after its retry fails the whole Generate stage), and values it cannot draw from get a safe
 * fallback drawing captioned "Not drawn to scale".
 */

import type {
  FigureRef,
  FigureTemplateName,
  GroupElement,
  SlideElement,
  Theme,
} from "@tj/domain/documents";
import type { z } from "zod";
import { uid } from "../../factories";
import { COORDINATE_DISTANCE } from "./coordinate-distance";
import { ENERGY_PROFILE } from "./energy-profile";
import { RIGHT_TRIANGLE } from "./right-triangle";
import { TRIANGLE } from "./triangle";

export * from "./energy-profile";
export * from "./right-triangle";
export * from "./triangle";

export type FigureRect = { x: number; y: number; w: number; h: number };

/** A template's drawing: the group's children in its local space, and what a screen reader hears. */
export type FigureDrawing = { children: SlideElement[]; alt: string };

export type FigureTemplate<V = unknown> = {
  /** The group's name in the layers list. */
  name: string;
  /** The values' shape without the rules: a stored value that does not have it draws the fallback. */
  shape: z.ZodType<V>;
  /** `shape` with the template's editorial rules (`editorialIssue`): what a diagram spec embeds. */
  values: z.ZodType<V>;
  /**
   * The children, in a `w`×`h` box at the origin, and the alt text. `undefined` values are ones
   * that did not have the template's shape. Pure and deterministic apart from element ids.
   */
  draw(values: V | undefined, theme: Theme, size: { w: number; h: number }): FigureDrawing;
  /**
   * The diagram slide's variant this template is drawn in: `figure-wide` for a figure that
   * carries many labels (ADR 0034 decision 7), `figure-left` when absent. A function picks it
   * from the values (`undefined` when they do not have the template's shape).
   */
  layout?: FigureLayout | LayoutOf<V>;
  /**
   * The value of what the figure's question asks for (TEACH-221), worked out from the other
   * values, for the answer check (TEACH-253). `undefined` when the values name no unknown or
   * cannot give it.
   */
  unknown?(values: V): FigureUnknown | undefined;
};

/** The diagram variants a template can ask for (`DIAGRAM_VARIANT_NAMES` in `../layouts`). */
export type FigureLayout = "figure-left" | "figure-wide";

/**
 * A layout picked from the values. Written as a method's type so a template's own values type
 * still fits `FigureTemplate<unknown>` in the registry, as `draw` does.
 */
type LayoutOf<V> = { pick(values: V | undefined): FigureLayout }["pick"];

/** An unknown's value: a length in the values' units, or an angle in degrees. */
export type FigureUnknown = { value: number; unit: "length" | "degrees" };

export const FIGURE_TEMPLATES: Record<FigureTemplateName, FigureTemplate> = {
  "right-triangle": RIGHT_TRIANGLE,
  "energy-profile": ENERGY_PROFILE,
  triangle: TRIANGLE,
};

/**
 * DIAGRAM-AUDIT figures drawn by code but not yet on the writer's menu (adding a name to the
 * domain's figure list needs its prompt clauses, which the prompt owner writes).
 */
export const EXTRA_FIGURES = { "coordinate-distance": COORDINATE_DISTANCE } as const;

/**
 * The diagram variant a template's slide is laid out in when nothing else picks one: what
 * `materialiseSlide` uses for a diagram spec called without a variant. The template decides,
 * not the deck's rhythm (`chooseVariant` always gives `figure-left`). A template whose layout
 * depends on its values (a `triangle` with a `pair`) reads them, parsed against its shape.
 */
export function diagramVariantFor(template: FigureTemplateName, values?: unknown): FigureLayout {
  const { layout, shape } = FIGURE_TEMPLATES[template];
  if (typeof layout !== "function") return layout ?? "figure-left";
  const parsed = shape.safeParse(values);
  return layout(parsed.success ? parsed.data : undefined);
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * One Figure as a `group` at `rect`. `values` is parsed against the template's shape first,
 * because a stored `figure.values` is only a record and may have been edited by hand; the group
 * stores the parsed values (the model's input, never the geometry). Never throws.
 */
export function drawFigure(
  template: FigureTemplateName,
  values: unknown,
  theme: Theme,
  rect: FigureRect,
): GroupElement {
  // A lab-menu figure (EXTRA_FIGURES) draws through the same path as a registered one.
  const figure =
    FIGURE_TEMPLATES[template] ??
    (EXTRA_FIGURES as Record<string, FigureTemplate>)[template as string];
  const parsed = figure.shape.safeParse(values);
  const drawn = figure.draw(parsed.success ? parsed.data : undefined, theme, rect);
  return {
    id: uid(),
    type: "group",
    name: figure.name,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    children: drawn.children,
    alt: drawn.alt,
    figure: { template, values: asRecord(parsed.success ? parsed.data : values) },
  };
}

/** A group that carries the values its figure was drawn from. */
export type FigureGroup = GroupElement & { figure: FigureRef };

/**
 * The top-level group that carries a Figure, on a slide or a recipe's layout (TEACH-89). The one
 * way to find a slide's figure: the diagram filler replaces the recipe's placeholder with it, and
 * Repair and cascade read the stored template and values from it. A figure the teacher ungrouped
 * has no such group.
 */
export function figureGroupOf(slide: {
  elements: readonly SlideElement[];
}): FigureGroup | undefined {
  return slide.elements.find(
    (element): element is FigureGroup => element.type === "group" && element.figure !== undefined,
  );
}
