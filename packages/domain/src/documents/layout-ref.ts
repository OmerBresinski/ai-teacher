import { z } from "zod";

/*
 * Adaptive layouts (TEACH-205 part b; UX rulings 215, 199). A layout the writer lays out from a
 * template stays a component in the editor: its elements sit in one `group` whose `layout` keeps
 * the template and the input it was laid out from, so editing, adding or removing an item re-runs
 * the template (`@tj/slides/relayout`) and replaces the group's children. The same pattern as a
 * Figure group's `figure` (ADR 0032 amendment). The names live here because `@tj/domain` depends
 * on nothing internal; `@tj/slides` owns the recipes.
 */

/** Every template a group may be re-laid from. Names only: a template not yet built never lays out. */
export const ADAPTIVE_TEMPLATE_IDS = [
  "cards-grid",
  "items-row",
  "panel-list",
  "split-compare",
  // TEACH-230 part b (B2): the "work alone" slides.
  "practice",
  "exit-ticket",
  "hinge",
  // TEACH-17 part b (C1): the worked example.
  "worked",
  // TEACH-75 part ac (C4).
  "stages",
] as const;

export type AdaptiveTemplateId = (typeof ADAPTIVE_TEMPLATE_IDS)[number];

export const AdaptiveTemplateIdSchema = z.enum(ADAPTIVE_TEMPLATE_IDS);

/** A box on the 960 x 540 slide. */
export type LayoutFrame = { x: number; y: number; w: number; h: number };

/**
 * What an adaptive group was laid out from: the template and its input as the template takes it
 * (the words and items, never the geometry). `frame` is where the template put the elements' bounds
 * on the slide the last time it ran, so a group the teacher has moved keeps its offset when it is
 * re-laid.
 */
export type LayoutRef = {
  template: AdaptiveTemplateId;
  input: Record<string, unknown>;
  frame?: LayoutFrame;
  /**
   * The size the teacher resized the group to. The layout is laid out, then fitted into it whole
   * (one scale for every box and type size, centred), never squashed; absent, it keeps its own size.
   */
  fit?: { w: number; h: number };
};

export const LayoutRefSchema = z.object({
  template: AdaptiveTemplateIdSchema,
  input: z.record(z.string(), z.unknown()),
  frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  fit: z.object({ w: z.number(), h: z.number() }).optional(),
});

/** A group laid out from an adaptive template (it carries a `layout`). */
export const isLayoutGroup = <E extends { type: string }>(
  el: E,
): el is E & { type: "group"; layout: LayoutRef } =>
  el.type === "group" && (el as { layout?: unknown }).layout !== undefined;
