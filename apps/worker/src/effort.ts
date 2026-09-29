import type { ReasoningEffort } from "@tj/generation";

/**
 * The `effortFor` hook for `AI_REASONING_EFFORT` (TEACH-72): every call at the environment's
 * effort, whatever the stage asked for. The worker's env defaults it to `low` (decision 25–26 Sept
 * 2026); `undefined` here (no hook, each stage keeps its own) is for callers outside the worker.
 */
export function effortOverride(
  effort: ReasoningEffort | undefined,
): { effortFor: () => ReasoningEffort } | Record<string, never> {
  return effort === undefined ? {} : { effortFor: () => effort };
}
