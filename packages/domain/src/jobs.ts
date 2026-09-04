import { z } from "zod";
import { ModelClassSchema } from "./ai";
import { JobId, WorkspaceId } from "./ids";
import { IsoDateTime } from "./primitives";

// ---------------------------------------------------------------------------------------------
// Job names + payloads (ADR 0006: names are constants here, payloads are Zod-validated)
// ---------------------------------------------------------------------------------------------

/**
 * Every background job name, as a const object so call sites read `JobName.ping` instead of a
 * string literal. Add a key here, a payload schema below, and an entry in `JobPayloadSchemas`.
 */
export const JobName = {
  ping: "ping",
  aiPing: "ai.ping",
} as const;
export type JobName = (typeof JobName)[keyof typeof JobName];

/** Runtime validator for job names (e.g. when reading a pg-boss row). */
export const JobNameSchema = z.enum(JobName);

/**
 * Payload of the scaffold `ping` job (ADR 0012 demo): the worker emits `steps` progress events,
 * failing at step `failAt` when set. Strict so unknown fields fail loudly.
 */
export const PingPayloadSchema = z.strictObject({
  message: z.string().min(1),
  /** Number of progress steps to emit. Defaults to 5 when omitted. */
  steps: z.number().int().positive().max(100).default(5),
  /** When set, the worker fails (retryable) at this step. Used to exercise the failure path. */
  failAt: z.number().int().positive().optional(),
});
export type PingPayload = z.infer<typeof PingPayloadSchema>;
export type PingPayloadInput = z.input<typeof PingPayloadSchema>;

/** Small, content-free Bedrock smoke call (ADR 0018 §7). */
export const AiPingPayloadSchema = z.strictObject({
  class: ModelClassSchema.default("small"),
  prompt: z.string().min(1).max(200).default("Reply with the single word: pong."),
});
export type AiPingPayload = z.infer<typeof AiPingPayloadSchema>;
export type AiPingPayloadInput = z.input<typeof AiPingPayloadSchema>;

/** Payload schema per job name. `satisfies` keeps the record exhaustive over `JobName`. */
export const JobPayloadSchemas = {
  ping: PingPayloadSchema,
  "ai.ping": AiPingPayloadSchema,
} as const satisfies Record<JobName, z.ZodType>;

/** Parsed (output) payload type per job name. */
export type JobPayloads = { [K in JobName]: z.infer<(typeof JobPayloadSchemas)[K]> };
/** Payload type accepted when enqueuing (defaults not yet applied). */
export type JobPayloadInputs = { [K in JobName]: z.input<(typeof JobPayloadSchemas)[K]> };

// ---------------------------------------------------------------------------------------------
// Job events (ADR 0012: emitted by the worker, streamed to clients over SSE)
// ---------------------------------------------------------------------------------------------

export const JobEventType = z.enum([
  "queued",
  "started",
  "progress",
  "completed",
  "failed",
  "cancelled",
]);
export type JobEventType = z.infer<typeof JobEventType>;

/** Event types after which no further events are emitted for a job. */
export const JOB_TERMINAL_EVENT_TYPES = ["completed", "failed", "cancelled"] as const;
export type JobTerminalEventType = (typeof JOB_TERMINAL_EVENT_TYPES)[number];

const jobEventBase = {
  jobId: JobId,
  workspaceId: WorkspaceId,
  /** When the event happened (worker clock), ISO 8601 UTC. */
  at: IsoDateTime,
} as const;

export const JobProgressSchema = z.strictObject({
  /** 0–100 when the job can estimate completion; omitted for indeterminate progress. */
  percent: z.number().min(0).max(100).optional(),
  /** Short human-readable status line for the activity tray. */
  message: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const JobErrorSchema = z.strictObject({
  message: z.string(),
  /** Whether the API may offer "retry" (F13-R03). */
  retryable: z.boolean(),
});
export type JobError = z.infer<typeof JobErrorSchema>;

export const JobQueuedEventSchema = z.strictObject({ type: z.literal("queued"), ...jobEventBase });
export const JobStartedEventSchema = z.strictObject({
  type: z.literal("started"),
  ...jobEventBase,
});
export const JobProgressEventSchema = z.strictObject({
  type: z.literal("progress"),
  ...jobEventBase,
  progress: JobProgressSchema,
});
export const JobCompletedEventSchema = z.strictObject({
  type: z.literal("completed"),
  ...jobEventBase,
});
export const JobFailedEventSchema = z.strictObject({
  type: z.literal("failed"),
  ...jobEventBase,
  error: JobErrorSchema,
});
export const JobCancelledEventSchema = z.strictObject({
  type: z.literal("cancelled"),
  ...jobEventBase,
});

/** Discriminated on `type`. Every variant is strict: unknown fields are rejected. */
export const JobEventSchema = z.discriminatedUnion("type", [
  JobQueuedEventSchema,
  JobStartedEventSchema,
  JobProgressEventSchema,
  JobCompletedEventSchema,
  JobFailedEventSchema,
  JobCancelledEventSchema,
]);
export type JobEvent = z.infer<typeof JobEventSchema>;

/** Narrow a `JobEvent` to one variant by its `type`. */
export type JobEventOf<T extends JobEventType> = Extract<JobEvent, { type: T }>;

export function isTerminalJobEvent(event: JobEvent): event is JobEventOf<JobTerminalEventType> {
  return (JOB_TERMINAL_EVENT_TYPES as readonly string[]).includes(event.type);
}
