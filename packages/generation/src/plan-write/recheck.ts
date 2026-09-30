import type { PlanMenuEntry } from "../prompts/plan-lesson";

/*
 * The hinge gate (UX ruling 136): a hinge whose stem, options and reveal still do not fit one slide
 * after its named-field re-write had options that are ideas, not short answers. It is written again
 * ONCE as another check on the same idea, never split. These are the checks it may become.
 */

/** Checks a failed hinge may become, in the order offered. */
export const RECHECK_FORMS = [
  "true-false",
  "open-response",
  "check-set",
  "fill-gap",
  "matching",
  "sort",
] as const;

/** The menu entries a failed hinge may become (the forms the lesson's menu offers). */
export function recheckKinds(menu: readonly PlanMenuEntry[]): PlanMenuEntry[] {
  return RECHECK_FORMS.flatMap((form) => menu.filter((m) => m.form === form));
}
