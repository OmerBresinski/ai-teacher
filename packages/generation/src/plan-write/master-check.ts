import { REASONING_EFFORTS, type ReasoningEffort } from "../call";

/*
 * The master check's model and effort (round B, arms b3/b4): the same `master-check` call, routed
 * by config. PLAN_WRITE_CHECKER_MODEL names its model (unset: the writer's model, Luna, as b3);
 * PLAN_WRITE_CHECKER_EFFORT its effort (unset or unknown: low). b4 runs it on gpt-6.1-sol at low.
 * C1: on by default on Sol at low (B4: no dimension lost, about $0.0065 and 7–10 s a lesson, after
 * the deck is editable).
 */

export const PLAN_WRITE_CHECKER_MODEL = "openai/gpt-6.1-sol";

export const PLAN_WRITE_CHECKER_EFFORT: ReasoningEffort = "low";

/** The master check's model: `asked`, else env PLAN_WRITE_CHECKER_MODEL, else `fallback` (Sol). */
export function planWriteCheckerModel(
  fallback: string = PLAN_WRITE_CHECKER_MODEL,
  asked?: string,
): string {
  const m = (asked ?? process.env.PLAN_WRITE_CHECKER_MODEL)?.trim();
  return m ? m : fallback;
}

/** The master check's effort: `asked`, else PLAN_WRITE_CHECKER_EFFORT when it names one, else low. */
export function planWriteCheckerEffort(asked?: string): ReasoningEffort {
  const e = asked ?? process.env.PLAN_WRITE_CHECKER_EFFORT;
  return REASONING_EFFORTS.find((x) => x === e) ?? PLAN_WRITE_CHECKER_EFFORT;
}
