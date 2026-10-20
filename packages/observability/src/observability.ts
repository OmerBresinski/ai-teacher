import { createHash } from "node:crypto";
import { safeError } from "@tj/domain";
import type { Logger } from "pino";
import { PostHog } from "posthog-node";
import { BINDING_KEYS, eventNameOf, MESSAGE_EVENTS, metadataOf, SKIPPED_MESSAGES } from "./events";
import { sanitizeError } from "./scrub";

/**
 * PostHog (EU cloud) error tracking and model-call metrics for the worker (ADR 0041). Metadata
 * only: identifiers, counts, costs, durations and our own error messages. Prompt text, model
 * output and lesson content never reach this module's events; each event's properties are built
 * from an explicit list of fields, so an extra field a caller passes is never sent.
 *
 * Without `POSTHOG_API_KEY` every method is a no-op, so dev, tests and CI send nothing. With a
 * key, a PostHog outage or a slow request never fails or slows a job: capture only queues, sends
 * are batched and time out, failures are logged and the events dropped.
 */

/** The transport the client posts through (`posthog-node`'s `fetch` option). Test seam. */
export type ObservabilityFetch = NonNullable<ConstructorParameters<typeof PostHog>[1]>["fetch"];

export interface ObservabilityOptions {
  /** The PostHog project API key (`phc_…`). Unset or blank: the no-op client. */
  apiKey?: string | undefined;
  /** Default `https://eu.i.posthog.com` (EU cloud, ADR 0041). */
  host?: string | undefined;
  logger: Logger;
  /** Which app sends (`worker`). */
  service: string;
  /** Test seam: replaces the HTTP transport. */
  fetch?: ObservabilityFetch;
  /** Per request (default 3000 ms). */
  requestTimeoutMs?: number;
  /** The longest `flush()` / `shutdown()` wait (default 3000 ms); the rest is dropped. */
  flushTimeoutMs?: number;
  /** Events per batch before a send starts (default 20). */
  flushAt?: number;
  /** Background send interval (default 5000 ms). */
  flushIntervalMs?: number;
}

/** A job attempt that failed: retried by pg-boss (`willRetry`) or terminal. */
export interface JobFailure {
  error: unknown;
  /** The job name (`lesson.plan`, …). */
  job: string;
  jobId: string;
  workspaceId?: string | undefined;
  /** pg-boss `retryCount` of this attempt (0 for the first). */
  attempt: number;
  willRetry: boolean;
  lessonId?: string | undefined;
  stage?: string | undefined;
  planner?: string | undefined;
}

/** One model call, from the `@tj/ai` logging middleware's fields. */
export interface AiGeneration {
  modelId: string;
  /** The wrapped model's provider string (`openai.chat`, `amazon-bedrock`). */
  provider: string;
  modelClass: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | undefined;
  cacheWriteInputTokens?: number | undefined;
  costUsd: number | null;
  finishReason: string;
  isError: boolean;
  lessonId?: string | undefined;
  jobId?: string | undefined;
  stage?: string | undefined;
  promptVersion?: string | undefined;
  effort?: string | undefined;
}

/** The pipeline's `generation summary` (ADR 0025 §16), one per lesson job. */
export interface LessonSummary {
  lessonId?: string | undefined;
  jobId?: string | undefined;
  outcome: string;
  planner: string;
  stages: readonly string[];
  costUsd: number | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  readableMs?: number | undefined;
  checkedMs?: number | undefined;
  findings: { error: number; warning: number };
  images: {
    photographable: boolean | null;
    requested: number;
    placed: number;
    empty: number;
    failed: number;
  };
}

export interface JobScope {
  workspaceId?: string | undefined;
  job: string;
  lessonId?: string | undefined;
}

export interface Observability {
  readonly enabled: boolean;
  /**
   * Ties a running job to its Workspace (the events' distinct id) and its lesson, so model calls
   * and failures inside it are grouped. Returns the release; call it when the attempt ends.
   */
  beginJob(jobId: string, scope: JobScope): () => void;
  captureJobFailure(failure: JobFailure): void;
  /** An error outside any job (`uncaughtException`, `unhandledRejection`, …). */
  captureException(error: unknown, source: string): void;
  captureAiGeneration(call: AiGeneration): void;
  captureLessonSummary(summary: LessonSummary): void;
  /**
   * One structured log line of a job (`bindings` are its child logger's, with `jobId`): a writer
   * `ev`, a pipeline `ev` or a known message becomes a `gen_*` event, metadata only.
   */
  captureLogLine(bindings: Record<string, unknown>, record: unknown, msg: unknown): void;
  /** A `gen_*` event of a running job, from the worker itself (queue wait, …); metadata only. */
  captureJobEvent(jobId: string, event: string, props: Record<string, unknown>): void;
  /** Sends what is queued; resolves within `flushTimeoutMs`, never rejects. */
  flush(): Promise<void>;
  /** Flushes and stops the client; resolves within `flushTimeoutMs`, never rejects. */
  shutdown(): Promise<void>;
}

export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";
/** The distinct id of events that belong to no Workspace (a crash outside a job). */
export const SYSTEM_DISTINCT_ID = "system:worker";

/**
 * A Workspace's distinct id: a hash, so PostHog never holds our ids or anything personal (no
 * email, no name). Stable, so a Workspace's events group together.
 */
export function distinctIdFor(workspaceId: string | undefined): string {
  if (!workspaceId) return SYSTEM_DISTINCT_ID;
  return `ws_${createHash("sha256").update(workspaceId).digest("hex").slice(0, 32)}`;
}

const NOOP: Observability = {
  enabled: false,
  beginJob: () => () => {},
  captureJobFailure: () => {},
  captureException: () => {},
  captureAiGeneration: () => {},
  captureLessonSummary: () => {},
  captureLogLine: () => {},
  captureJobEvent: () => {},
  flush: async () => {},
  shutdown: async () => {},
};

/** `onTimeout` runs when `promise` has not settled by `ms`; the result never rejects. */
async function bounded(promise: Promise<unknown>, ms: number, onTimeout: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    const result = await Promise.race([promise.then(() => "done" as const), timeout]);
    if (result === "timeout") onTimeout();
  } catch {
    // The client's own error event has logged it.
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps only defined values: PostHog stores `null` as a value, `undefined` keys are noise. */
function defined(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (value !== undefined) out[key] = value;
  return out;
}

export function createObservability(options: ObservabilityOptions): Observability {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return NOOP;

  const { logger, service } = options;
  const flushTimeoutMs = options.flushTimeoutMs ?? 3000;
  const client = new PostHog(apiKey, {
    host: options.host?.trim() || DEFAULT_POSTHOG_HOST,
    flushAt: options.flushAt ?? 20,
    flushInterval: options.flushIntervalMs ?? 5000,
    requestTimeout: options.requestTimeoutMs ?? 3000,
    // One attempt: a failed batch is dropped and logged, never retried into a slow shutdown.
    fetchRetryCount: 0,
    // Belt and braces (ADR 0041): no `$ai_input` / `$ai_output_choices` even if one were passed.
    privacyMode: true,
    // Our handlers send a scrubbed error; PostHog's own would send the raw message.
    enableExceptionAutocapture: false,
    // The worker's IP says nothing about the teacher.
    disableGeoip: true,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  let dropped = 0;
  client.on("error", (err: unknown) => {
    dropped += 1;
    // First failure and then every 50th: an outage must not flood the log either.
    if (dropped === 1 || dropped % 50 === 0) {
      logger.warn({ err: safeError(err), dropped }, "posthog send failed; events dropped");
    }
  });

  interface Totals {
    factChecks: number;
    factsChecked: number;
    factsCorrected: number;
    factsChanged: number;
    factWordsChanged: number;
    factChecksCapped: number;
    factChecksDropped: number;
    repairs: number;
    repairsReverted: number;
    repairsFailed: number;
    events: number;
  }
  const emptyTotals = (): Totals => ({
    factChecks: 0,
    factsChecked: 0,
    factsCorrected: 0,
    factsChanged: 0,
    factWordsChanged: 0,
    factChecksCapped: 0,
    factChecksDropped: 0,
    repairs: 0,
    repairsReverted: 0,
    repairsFailed: 0,
    events: 0,
  });
  const jobs = new Map<string, JobScope & { stage?: string; planner?: string; totals: Totals }>();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  /** Per-job totals for `gen_lesson` (the fact checker's change rate, repairs). */
  const tallyInto = (totals: Totals, event: string, props: Record<string, unknown>) => {
    totals.events += 1;
    if (event === "gen_fact_check") {
      if (props.outcome === "checked") {
        totals.factChecks += 1;
        totals.factsChecked += num(props.factsChecked);
        totals.factsCorrected += num(props.corrections);
        totals.factsChanged += num(props.factsChanged);
        totals.factWordsChanged += num(props.wordsChanged);
      } else if (props.outcome === "capped") totals.factChecksCapped += 1;
      else if (props.outcome === "dropped") totals.factChecksDropped += 1;
    }
    if (event === "gen_repair") {
      totals.repairs += 1;
      if (props.reverted === true) totals.repairsReverted += 1;
      if (props.ok === false) totals.repairsFailed += 1;
    }
  };
  const MAX_EVENTS_PER_JOB = 2000;

  const safely = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      logger.warn({ err: safeError(err), what }, "posthog capture failed; event dropped");
    }
  };

  const capture = (
    distinctId: string,
    event: string,
    properties: Record<string, unknown>,
  ): void => {
    client.capture({
      distinctId,
      event,
      // No person profiles: a distinct id here is a Workspace hash, not a person.
      properties: { ...defined(properties), service, $process_person_profile: false },
    });
  };

  return {
    enabled: true,

    beginJob(jobId, scope) {
      jobs.set(jobId, { ...scope, totals: emptyTotals() });
      return () => {
        jobs.delete(jobId);
      };
    },

    captureJobFailure(failure) {
      safely("job_failed", () => {
        const scope = jobs.get(failure.jobId);
        const workspaceId = failure.workspaceId ?? scope?.workspaceId;
        client.captureException(
          sanitizeError(failure.error),
          distinctIdFor(workspaceId),
          defined({
            service,
            $process_person_profile: false,
            source: "job",
            job: failure.job,
            jobId: failure.jobId,
            lessonId: failure.lessonId ?? scope?.lessonId,
            stage: failure.stage ?? scope?.stage,
            planner: failure.planner ?? scope?.planner,
            attempt: failure.attempt,
            willRetry: failure.willRetry,
            errorType: safeError(failure.error).type,
            errorCode: safeError(failure.error).code,
          }),
        );
      });
    },

    captureException(error, source) {
      safely("exception", () => {
        client.captureException(sanitizeError(error), SYSTEM_DISTINCT_ID, {
          service,
          $process_person_profile: false,
          source,
          errorType: safeError(error).type,
        });
      });
    },

    captureAiGeneration(call) {
      safely("$ai_generation", () => {
        const scope = call.jobId ? jobs.get(call.jobId) : undefined;
        if (scope && call.stage) scope.stage = call.stage;
        // Only these fields: never `$ai_input` or `$ai_output_choices` (ADR 0041).
        capture(distinctIdFor(scope?.workspaceId), "$ai_generation", {
          $ai_trace_id: call.jobId,
          $ai_span_name: call.stage,
          $ai_model: call.modelId,
          $ai_provider: call.provider,
          $ai_input_tokens: call.inputTokens ?? undefined,
          $ai_output_tokens: call.outputTokens ?? undefined,
          $ai_cache_read_input_tokens: call.cachedInputTokens,
          $ai_cache_creation_input_tokens: call.cacheWriteInputTokens,
          $ai_total_cost_usd: call.costUsd ?? undefined,
          // PostHog's latency is in seconds.
          $ai_latency: call.durationMs / 1000,
          $ai_stop_reason: call.finishReason,
          $ai_is_error: call.isError,
          lessonId: call.lessonId ?? scope?.lessonId,
          jobId: call.jobId,
          stage: call.stage,
          promptVersion: call.promptVersion,
          effort: call.effort,
          modelClass: call.modelClass,
        });
      });
    },

    captureLessonSummary(summary) {
      safely("gen_lesson", () => {
        const scope = summary.jobId ? jobs.get(summary.jobId) : undefined;
        if (scope) {
          scope.planner = summary.planner;
          const last = summary.stages.at(-1);
          if (last) scope.stage = last;
        }
        const t = scope?.totals;
        capture(distinctIdFor(scope?.workspaceId), "gen_lesson", {
          ...(t
            ? {
                factChecks: t.factChecks,
                factsChecked: t.factsChecked,
                factsCorrected: t.factsCorrected,
                factsChanged: t.factsChanged,
                factWordsChanged: t.factWordsChanged,
                factChangeRate: t.factsChecked ? t.factsChanged / t.factsChecked : null,
                factChecksCapped: t.factChecksCapped,
                factChecksDropped: t.factChecksDropped,
                repairs: t.repairs,
                repairsReverted: t.repairsReverted,
                repairsFailed: t.repairsFailed,
              }
            : {}),
          $ai_trace_id: summary.jobId,
          lessonId: summary.lessonId ?? scope?.lessonId,
          jobId: summary.jobId,
          job: scope?.job,
          outcome: summary.outcome,
          planner: summary.planner,
          stages: [...summary.stages],
          costUsd: summary.costUsd,
          calls: summary.calls,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          durationMs: summary.durationMs,
          readableMs: summary.readableMs,
          checkedMs: summary.checkedMs,
          findingsError: summary.findings.error,
          findingsWarning: summary.findings.warning,
          imagesPhotographable: summary.images.photographable,
          imagesRequested: summary.images.requested,
          imagesPlaced: summary.images.placed,
          imagesEmpty: summary.images.empty,
          imagesFailed: summary.images.failed,
        });
      });
    },

    captureLogLine(bindings, record, msg) {
      safely("gen_log", () => {
        const jobId = typeof bindings.jobId === "string" ? bindings.jobId : undefined;
        if (!jobId || !record || typeof record !== "object") return;
        const scope = jobs.get(jobId);
        if (!scope) return;
        const rec = record as Record<string, unknown>;
        const writer =
          rec.writer && typeof rec.writer === "object"
            ? (rec.writer as Record<string, unknown>)
            : undefined;
        const ev = typeof rec.ev === "string" ? rec.ev : writer?.ev;
        let event: string | undefined;
        let status: string | undefined;
        if (typeof ev === "string") event = eventNameOf(ev);
        else if (typeof msg === "string" && !SKIPPED_MESSAGES.has(msg)) {
          const mapped = MESSAGE_EVENTS[msg];
          event = mapped?.event;
          status = mapped?.status;
        }
        if (!event) return;
        if (scope.totals.events >= MAX_EVENTS_PER_JOB) return;
        const { ev: _ev, writer: _writer, ...rest } = rec;
        const props = metadataOf({ ...rest, ...(writer ?? {}) });
        delete props.ev;
        if (writer) props.source = "writer";
        if (status) props.status = status;
        for (const key of BINDING_KEYS) {
          const v = metadataOf({ [key]: bindings[key] })[key];
          if (v !== undefined) props[key] = v;
        }
        tallyInto(scope.totals, event, props);
        if (event === "gen_stage" && typeof props.stage === "string") scope.stage = props.stage;
        capture(distinctIdFor(scope.workspaceId), event, {
          ...props,
          $ai_trace_id: jobId,
          jobId,
          lessonId: scope.lessonId,
          job: scope.job,
        });
      });
    },

    captureJobEvent(jobId, event, props) {
      safely(event, () => {
        const scope = jobs.get(jobId);
        if (!event.startsWith("gen_")) return;
        capture(distinctIdFor(scope?.workspaceId), event, {
          ...metadataOf(props),
          $ai_trace_id: jobId,
          jobId,
          lessonId: scope?.lessonId,
          job: scope?.job,
        });
      });
    },

    flush() {
      return bounded(client.flush(), flushTimeoutMs, () =>
        logger.warn({ timeoutMs: flushTimeoutMs }, "posthog flush timed out; events dropped"),
      );
    },

    shutdown() {
      return bounded(client.shutdown(flushTimeoutMs), flushTimeoutMs + 500, () =>
        logger.warn({ timeoutMs: flushTimeoutMs }, "posthog shutdown timed out; events dropped"),
      );
    },
  };
}
