import { z } from "zod";
import { type Finding, FindingSchema } from "./finding";

/*
 * Generation state (ADR 0025 §3). Written on the Lesson by the `lesson.plan` job after every
 * stage: `stage` is the checkpoint a retry resumes from instead of re-spending Plan; `findings`
 * holds the model-check findings and the unrepaired schema findings at completion (residuals).
 * Schema findings are otherwise recomputed client-side by `checkLesson`, never trusted from here.
 */

export const GENERATION_STAGES = ["planned", "generated", "evaluated", "repaired"] as const;
export type GenerationStage = (typeof GENERATION_STAGES)[number];

export type GenerationUsage = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** `null` when the model id has no price and the job was capped by tokens (ADR 0025 §15). */
  costUsd: number | null;
};

export type Generation = {
  jobId: string;
  stage: GenerationStage;
  /** ISO 8601 UTC. */
  startedAt: string;
  completedAt?: string;
  /** The prompt module version each stage ran with, e.g. `{ plan: "plan.v1" }`. */
  promptVersions: Partial<Record<GenerationStage, string>>;
  usage: GenerationUsage;
  findings: Finding[];
};

export const GenerationStageSchema = z.enum(GENERATION_STAGES);

export const GenerationUsageSchema = z.strictObject({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});

export const GenerationSchema = z.strictObject({
  jobId: z.string(),
  stage: GenerationStageSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  promptVersions: z.partialRecord(GenerationStageSchema, z.string()),
  usage: GenerationUsageSchema,
  findings: z.array(FindingSchema),
});
