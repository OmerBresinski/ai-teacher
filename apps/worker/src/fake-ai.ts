import type { ConfiguredAi } from "@tj/ai";
import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
import { FIXTURES, scriptedPipelineAi } from "@tj/generation/testing";
import type { Env } from "./env";

/*
 * `AI_FAKE_SCRIPT=pipeline` (ADR 0025 §22): the e2e worker runs the real `lesson.plan` handler
 * over the scripted fake instead of Bedrock, so a browser test can create a lesson and watch it
 * arrive. One script per job — keyed on the `jobId` the pipeline puts in every call's context —
 * because a `FakeAi` consumes its answers in call order and two jobs would otherwise share one
 * run. The review answer carries one lesson-level warning, so the finished editor has a residual
 * to show. `AI_FAKE_DELAY_MS` paces the answers so slides are visibly written one at a time.
 * Never constructed in production (`env.ts` refuses the variable there).
 */

/** The residual the fake's Evaluate answer reports: a lesson-level warning `knownTargetsOnly` keeps. */
export const FAKE_REVIEW_WARNING = {
  check: "age-fit",
  severity: "warning" as const,
  target: {},
  message: FIXTURES.evaluate.findings[0]?.message ?? "Consider a diagram for this age group.",
};

export function createPerJobFakeAi(env: Pick<Env, "AI_FAKE_DELAY_MS">): ConfiguredAi {
  const byJob = new Map<string, ConfiguredAi>();
  const delay = env.AI_FAKE_DELAY_MS;
  const forJob = (jobId: string): ConfiguredAi => {
    const existing = byJob.get(jobId);
    if (existing) return existing;
    const fake = scriptedPipelineAi({
      evaluate: { findings: [FAKE_REVIEW_WARNING] },
      ...(delay > 0 ? { pace: delay } : {}),
    });
    byJob.set(jobId, fake);
    return fake;
  };
  return {
    kind: "bedrock",
    region: DEFAULT_REGION,
    model: (cls, context) => forJob(context?.jobId ?? "").model(cls, context),
    modelId: (cls) => DEFAULT_MODEL_IDS[cls],
  };
}
