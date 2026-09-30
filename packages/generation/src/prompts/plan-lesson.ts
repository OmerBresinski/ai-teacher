import { z } from "zod";
import type { Audience } from "./shared";

/*
 * STUB (spike/plan-write). The prompt-engineer agent owns this file and replaces the prompt text.
 * The code depends on: `PLAN_LESSON_VERSION` (must start "plan-lesson."), `PlanLessonInput`,
 * `planLessonPrompt(input) → { system, user }`, and `planLessonSchema` with the keys below (the
 * code check reads them; field descriptions and wording are the prompt's to change).
 */

export const PLAN_LESSON_VERSION = "plan-lesson.v0";

/** One form and layout on the planner's menu, with its measured capacity and contract text. */
export type PlanMenuEntry = {
  form: string;
  layout: string;
  /** When to pick this layout over the form's others (from the contract). */
  when?: string;
  /** The most parts (points, steps, options, pairs, sentences…) the layout holds. */
  capacity?: number;
  /** `contractText(form, layout)`: the slots, one per line, in structural units. */
  contract: string;
};

export type PlanLessonInput = {
  topic: string;
  audience: Audience;
  /** The brief's clarifying answers, as the teacher gave them. */
  answers?: Record<string, string>;
  priorKnowledge?: string;
  /** Exactly this many slides, the title included. */
  slideCount: number;
  menu: PlanMenuEntry[];
  /** A repair: the plan as written, and the rules it broke, one per line. */
  repair?: { previous: PlanLessonOutput; problems: string[] };
};

const nullableText = z.string().nullable();

export const PlanSlideSchema = z.object({
  /** "title" on slide 1; otherwise free (starter, hook, teach, model, practise, hinge, check, exit…). */
  role: z.string(),
  /** 1-based objective numbers this slide serves. */
  objectives: z.array(z.number().int().min(1)),
  /** A menu form, or "title" on slide 1. */
  form: z.string(),
  /** A layout of that form on the menu ("default" when it has one). */
  layout: z.string(),
  purpose: z.string(),
  /** How many parts the slide's idea has (points, steps, options, pairs, sentences). */
  parts: z.number().int().min(0),
  /** Short keys for the ideas this slide teaches. */
  teaches: z.array(z.string()),
  /** Keys of the ideas this slide checks; each must be taught on an earlier slide. */
  tests: z.array(z.string()),
  imageBrief: z.object({ subject: z.string(), mustShow: z.array(z.string()) }).nullable(),
  figureBrief: nullableText,
});
export type PlanSlide = z.infer<typeof PlanSlideSchema>;

export const planLessonSchema = z.object({
  objectives: z.array(z.string()).min(1).max(4),
  runningExample: z.string(),
  misconception: z.string(),
  slides: z.array(PlanSlideSchema),
});
export type PlanLessonOutput = z.infer<typeof planLessonSchema>;

export function planLessonPrompt(input: PlanLessonInput): { system: string; user: string } {
  return {
    system: "STUB: design the whole lesson as a slide table.",
    user: JSON.stringify(input),
  };
}
