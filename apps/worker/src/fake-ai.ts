import type { ConfiguredAi } from "@tj/ai";
import { DEFAULT_MODEL_IDS, DEFAULT_REGION } from "@tj/ai";
import { createFakeAi, type FakeCall, type FakeScriptEntry } from "@tj/ai/testing";
import { FIXTURES, scriptedPipelineAi } from "@tj/generation/testing";
import type { Env } from "./env";

/*
 * `AI_FAKE_SCRIPT=pipeline` (ADR 0025 §22): the e2e worker runs the real handlers over the
 * scripted fake instead of Bedrock, so a browser test can create a lesson and watch it arrive,
 * edit a fact and watch the cascade land. One script per job — keyed on the `jobId` the pipeline
 * puts in every call's context — because a `FakeAi` consumes its answers in call order and two
 * jobs would otherwise share one run. `lesson.plan` gets the fixture run (the review answer
 * carries one lesson-level warning, so the finished editor has a residual to show); a
 * `lesson.cascade` / `lesson.regenerate` call is answered from the prompt's `kind "…"` /
 * `type "…"` with the fixture spec of that kind, with the teacher's instruction (when any) echoed
 * into the first text so the change is visible. `AI_FAKE_DELAY_MS` paces the answers so slides
 * are visibly written one at a time. Never constructed in production (`env.ts` refuses it).
 */

/**
 * The residual the fake's Evaluate answer reports: a lesson-level `pitch` warning that
 * `knownTargetsWithEvidence` keeps — its evidence is a term from the fixture facts (TEACH-216).
 */
export const FAKE_REVIEW_WARNING = {
  check: "pitch",
  severity: "warning" as const,
  target: {},
  evidence: FIXTURES.planFacts.vocabulary[0]?.term ?? "Particle",
  message: "Consider a diagram for this age group.",
};

/** What the fake writes into a re-derived slide's first text so a test can see the cascade landed. */
export const FAKE_PROPOSAL_MARK = "Updated to match";

/** A proposal answer: the fixture spec for the kind named in the prompt, marked as re-derived. */
export function proposalAnswer(call: FakeCall): string {
  const slideKind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1];
  const blockType = /type "([a-z-]+)"/.exec(call.promptText)?.[1];
  const instruction = /The teacher asks: (.+)/.exec(call.promptText)?.[1]?.trim();
  const mark = instruction ? `${FAKE_PROPOSAL_MARK} (${instruction})` : FAKE_PROPOSAL_MARK;
  if (slideKind) {
    const spec = FIXTURES.slides[slideKind as keyof typeof FIXTURES.slides];
    if (spec) return JSON.stringify(markSpec(spec as Record<string, unknown>, mark));
  }
  if (blockType) {
    const spec = FIXTURES.worksheet.blocks.find((b) => b.type === blockType);
    if (spec) return JSON.stringify(markSpec(spec as unknown as Record<string, unknown>, mark));
  }
  return JSON.stringify({});
}

/**
 * Prefix the first text a spec exposes (title, heading, stem, … or the first `items` entry) with
 * `mark`, cut to the tightest spec limit (60) so the answer still validates.
 */
function markSpec(spec: Record<string, unknown>, mark: string): Record<string, unknown> {
  const marked = (value: string) => `${mark}: ${value}`.slice(0, 60);
  for (const key of ["title", "heading", "stem", "statement", "prompt", "question"]) {
    const value = spec[key];
    if (typeof value === "string") return { ...spec, [key]: marked(value) };
  }
  const items = spec.items;
  if (Array.isArray(items) && typeof items[0] === "string") {
    return { ...spec, items: [marked(items[0]), ...items.slice(1)] };
  }
  return spec;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPerJobFakeAi(env: Pick<Env, "AI_FAKE_DELAY_MS">): ConfiguredAi {
  const byJob = new Map<string, ConfiguredAi>();
  const delay = env.AI_FAKE_DELAY_MS;
  const proposal: FakeScriptEntry = async (call) => {
    if (delay > 0) await sleep(delay);
    return proposalAnswer(call);
  };
  const forJob = (jobId: string, stage: string | undefined): ConfiguredAi => {
    const existing = byJob.get(jobId);
    if (existing) return existing;
    const fake =
      stage === "cascade" || stage === "regenerate"
        ? createFakeAi({ fallback: proposal, usage: { inputTokens: 1000, outputTokens: 400 } })
        : scriptedPipelineAi({
            evaluate: { findings: [FAKE_REVIEW_WARNING] },
            ...(delay > 0 ? { pace: delay } : {}),
          });
    byJob.set(jobId, fake);
    return fake;
  };
  return {
    kind: "bedrock",
    region: DEFAULT_REGION,
    model: (cls, context) => forJob(context?.jobId ?? "", context?.stage).model(cls, context),
    modelId: (cls) => DEFAULT_MODEL_IDS[cls],
  };
}
