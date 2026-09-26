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
import type { FigureTemplateName, GroupElement, SlideElement, Theme } from "@tj/domain/documents";
import type { z } from "zod";
import { uid } from "../factories";
import { RIGHT_TRIANGLE } from "./right-triangle";

export * from "./right-triangle";

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
};

export const FIGURE_TEMPLATES: Record<FigureTemplateName, FigureTemplate> = {
  "right-triangle": RIGHT_TRIANGLE,
};

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
  const figure = FIGURE_TEMPLATES[template];
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
