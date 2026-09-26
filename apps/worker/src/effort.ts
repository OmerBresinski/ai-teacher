import type { ReasoningEffort } from "@tj/generation";

/**
 * The `effortFor` hook for `AI_REASONING_EFFORT` (TEACH-72): every call at the environment's
 * effort, whatever the stage asked for. Absent when unset, so each stage keeps its own.
 */
export function effortOverride(
  effort: ReasoningEffort | undefined,
): { effortFor: () => ReasoningEffort } | Record<string, never> {
  return effort === undefined ? {} : { effortFor: () => effort };
}
