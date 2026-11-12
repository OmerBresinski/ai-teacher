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

export type GenerationUsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Confirmed cost; `null` if confirmed usage includes an unpriced model (ADR 0025 §15). */
  costUsd: number | null;
};

export type GenerationUsage = GenerationUsageTotals & {
  reserved?: GenerationUsageTotals;
  uncertain?: GenerationUsageTotals;
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
  /**
   * Each slide's state while Generate runs, by slide id (TEACH-110 part h; ruling 188): `writing`
   * while it is still being made (read-only), `done` once its words, picture or diagram have
   * settled and its checks have run. Absent on lessons generated before it.
   */
  slideStates?: Record<string, SlideGenerationState>;
  /**
   * ISO 8601 UTC: when the writer laid out the whole deck (editable) for this checkpoint. A retry of
   * the job finishes from that deck instead of writing it again, so a retry never visibly undoes
   * work (TEACH-312 part j). Absent until then, and on lessons generated before it.
   */
  editableAt?: string;
  /**
   * The ship gate's record (RC1, e2e-11nov): every certain layout fault found on the deck as saved
   * (an empty picture slot or figure plate, words past the slide's edge or on other words), what
   * code did about it and what still ships, with the counts. Absent on lessons saved before it.
   */
  shipGate?: ShipGateRecord;
};

export type ShipGateRecord = {
  detected: number;
  acted: number;
  shipped: number;
  slides: {
    slide: number;
    id: string;
    faults: string[];
    action: "slot-removed" | "answers-paginated" | "words-only" | "none";
    shipped: string[];
  }[];
};

export const SLIDE_GENERATION_STATES = ["writing", "done"] as const;
export type SlideGenerationState = (typeof SLIDE_GENERATION_STATES)[number];

export const GenerationStageSchema = z.enum(GENERATION_STAGES);

const GenerationUsageTotalsSchema = z.strictObject({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});

export const GenerationUsageSchema = GenerationUsageTotalsSchema.extend({
  reserved: GenerationUsageTotalsSchema.optional(),
  uncertain: GenerationUsageTotalsSchema.optional(),
});

export const GenerationSchema = z.strictObject({
  jobId: z.string(),
  stage: GenerationStageSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  promptVersions: z.partialRecord(GenerationStageSchema, z.string()),
  usage: GenerationUsageSchema,
  findings: z.array(FindingSchema),
  slideStates: z.record(z.string(), z.enum(SLIDE_GENERATION_STATES)).optional(),
  editableAt: z.iso.datetime().optional(),
  shipGate: z
    .strictObject({
      detected: z.number().int().nonnegative(),
      acted: z.number().int().nonnegative(),
      shipped: z.number().int().nonnegative(),
      slides: z.array(
        z.strictObject({
          slide: z.number().int().positive(),
          id: z.string(),
          faults: z.array(z.string()),
          action: z.enum(["slot-removed", "answers-paginated", "words-only", "none"]),
          shipped: z.array(z.string()),
        }),
      ),
    })
    .optional(),
});
