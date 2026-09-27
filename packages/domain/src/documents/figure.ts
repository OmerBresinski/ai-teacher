import { z } from "zod";

/*
 * Figures (ADR 0032 and its 2026-09-26 amendment). A Figure is one `group` drawn by code from a
 * named Figure template in `@tj/slides`; the names live here because the document (the group's
 * `figure`) and the outline (TEACH-89's `figureBrief`) both refer to them, and `@tj/domain`
 * depends on nothing internal.
 */

/** Every Figure template there is a drawing for. */
export const FIGURE_TEMPLATE_NAMES = ["right-triangle", "energy-profile", "triangle"] as const;

export type FigureTemplateName = (typeof FIGURE_TEMPLATE_NAMES)[number];

export const FigureTemplateNameSchema = z.enum(FIGURE_TEMPLATE_NAMES);

/**
 * What a figure group was drawn from: the template and the values as they were given (the
 * model's input, never the geometry), so Repair and cascade can redraw it from them.
 */
export type FigureRef = { template: FigureTemplateName; values: Record<string, unknown> };

export const FigureRefSchema = z.object({
  template: FigureTemplateNameSchema,
  values: z.record(z.string(), z.unknown()),
});
