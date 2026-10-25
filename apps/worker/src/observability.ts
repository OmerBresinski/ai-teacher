import { type AiCallRecord, DEFAULT_MODEL_IDS, PRICES } from "@tj/ai";
import type { GenerationSummary } from "@tj/generation";
import type { JobFailureReport } from "@tj/jobs";
import {
  type AiGeneration,
  createObservability,
  type LessonSummary,
  type Observability,
} from "@tj/observability";
import type { Logger } from "pino";
import type { Env } from "./env";

/**
 * The worker's PostHog reporting (ADR 0041): job failures, uncaught errors, one `$ai_generation`
 * per model call and one `lesson_generation` per lesson job. Metadata only; a no-op without
 * `POSTHOG_API_KEY`, so dev, tests and CI send nothing.
 */
export function createWorkerObservability(
  env: Pick<
    Env,
    | "POSTHOG_API_KEY"
    | "POSTHOG_HOST"
    | "AI_MODEL_FRONTIER"
    | "AI_MODEL_STANDARD"
    | "AI_MODEL_SMALL"
  >,
  logger: Logger,
): Observability {
  return createObservability({
    apiKey: env.POSTHOG_API_KEY,
    host: env.POSTHOG_HOST,
    // The only model ids that may be sent: ours (configured, default or priced), never free text.
    modelIds: [
      env.AI_MODEL_FRONTIER,
      env.AI_MODEL_STANDARD,
      env.AI_MODEL_SMALL,
      ...Object.values(DEFAULT_MODEL_IDS),
      ...Object.keys(PRICES),
    ],
    logger: logger.child({ component: "posthog" }),
    service: "worker",
  });
}

/** `@tj/ai`'s per-call record, field by field (never content: the record has none). */
export function aiGenerationOf(call: AiCallRecord): AiGeneration {
  return {
    modelId: call.modelId,
    provider: call.provider,
    modelClass: call.class,
    durationMs: call.durationMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    cachedInputTokens: call.cachedInputTokens,
    cacheWriteInputTokens: call.cacheWriteInputTokens,
    costUsd: call.costUsd,
    finishReason: call.finishReason,
    isError: call.isError,
    statusCode: call.statusCode,
    providerErrorCode: call.providerErrorCode,
    lessonId: call.lessonId,
    jobId: call.jobId,
    stage: call.stage,
    promptVersion: call.promptVersion,
    effort: call.effort,
  };
}

/** The pipeline's `generation summary`, without the fit block (layout detail, not a metric). */
export function lessonSummaryOf(summary: GenerationSummary): LessonSummary {
  return {
    lessonId: summary.lessonId,
    jobId: summary.jobId,
    outcome: summary.outcome,
    planner: summary.planner,
    stages: summary.stages,
    costUsd: summary.costUsd,
    calls: summary.calls,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    durationMs: summary.durationMs,
    readableMs: summary.readableMs,
    checkedMs: summary.checkedMs,
    findings: summary.findings,
    images: summary.images,
  };
}

/** `runJob`'s failure report, to the tracker; the lesson, stage and planner come from the job's scope. */
export function reportJobFailure(observability: Observability, report: JobFailureReport): void {
  if (report.jobId === undefined) {
    observability.captureException(report.error, `job:${report.kind}`);
    return;
  }
  observability.captureJobFailure({
    error: report.error,
    job: report.job,
    jobId: report.jobId,
    workspaceId: report.workspaceId,
    attempt: report.attempt,
    willRetry: report.willRetry,
  });
}

/** The lesson a job's payload names, read without trusting it (for the job's scope). */
export function lessonIdOf(data: unknown): string | undefined {
  const payload = (data as { payload?: { lessonId?: unknown } } | null)?.payload;
  return typeof payload?.lessonId === "string" ? payload.lessonId : undefined;
}
