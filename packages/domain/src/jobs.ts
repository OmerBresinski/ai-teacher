import { z } from "zod";
import { ModelClassSchema } from "./ai";
import { GeneratedFromSchema } from "./documents/generated-from";
import { SlideElementSchema } from "./documents/slide";
import { WorksheetBlockSchema } from "./documents/worksheet";
import { JobId, LessonId, WorkspaceId } from "./ids";
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
  lessonPlan: "lesson.plan",
  lessonCascade: "lesson.cascade",
  lessonRegenerate: "lesson.regenerate",
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

/**
 * The F06 Plan stage for one lesson (ADR 0024 §14). Enqueued by `POST /lessons` in the same
 * transaction that creates the `documents` row and sets its generating lock (§6, §18); the worker
 * reads the brief from the row, so the payload carries the id only. Whether Plan, Generate,
 * Evaluate and Repair stay one job is F06's decision; the name and payload do not change.
 */
export const LessonPlanPayloadSchema = z.strictObject({
  lessonId: LessonId,
});
export type LessonPlanPayload = z.infer<typeof LessonPlanPayloadSchema>;
export type LessonPlanPayloadInput = z.input<typeof LessonPlanPayloadSchema>;

/** How many facts one cascade may name; a fact edit touches one or a few, never the whole set. */
export const CASCADE_MAX_FACTS = 50;
/** How many slides/elements/blocks one regenerate may name. */
export const REGENERATE_MAX_TARGETS = 20;
export const REGENERATE_INSTRUCTION_MAX = 500;

/**
 * One slide, element or block a proposal job targets or returns (ADR 0025 §18). An element is
 * addressed by its slide and its own id; a block by its id alone.
 */
export const ProposalTargetSchema = z
  .strictObject({
    slideId: z.string().optional(),
    elementId: z.string().optional(),
    blockId: z.string().optional(),
  })
  .refine((target) => target.slideId !== undefined || target.blockId !== undefined, {
    message: "A target names a slideId or a blockId.",
  });
export type ProposalTarget = z.infer<typeof ProposalTargetSchema>;

/**
 * F06 cascade (ADR 0025 §18): a fact changed; re-derive every AI-authored element and block whose
 * `generatedFrom.factRefs` names it and return the proposals. Enqueued by
 * `POST /lessons/:id/cascade`; takes no generating lock, never writes the document.
 */
export const LessonCascadePayloadSchema = z.strictObject({
  lessonId: LessonId,
  changedFactIds: z.array(z.string()).min(1).max(CASCADE_MAX_FACTS),
});
export type LessonCascadePayload = z.infer<typeof LessonCascadePayloadSchema>;
export type LessonCascadePayloadInput = z.input<typeof LessonCascadePayloadSchema>;

/**
 * F06 regenerate (ADR 0025 §18): the teacher asked for named slides, elements or blocks again,
 * optionally with an instruction. Enqueued by `POST /lessons/:id/regenerate`; same contract as
 * cascade — no lock, proposals only.
 */
export const LessonRegeneratePayloadSchema = z.strictObject({
  lessonId: LessonId,
  targets: z.array(ProposalTargetSchema).min(1).max(REGENERATE_MAX_TARGETS),
  instruction: z.string().max(REGENERATE_INSTRUCTION_MAX).optional(),
});
export type LessonRegeneratePayload = z.infer<typeof LessonRegeneratePayloadSchema>;
export type LessonRegeneratePayloadInput = z.input<typeof LessonRegeneratePayloadSchema>;

/** Payload schema per job name. `satisfies` keeps the record exhaustive over `JobName`. */
export const JobPayloadSchemas = {
  ping: PingPayloadSchema,
  "ai.ping": AiPingPayloadSchema,
  "lesson.plan": LessonPlanPayloadSchema,
  "lesson.cascade": LessonCascadePayloadSchema,
  "lesson.regenerate": LessonRegeneratePayloadSchema,
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
  /**
   * ADR 0025 §7: the document's `updatedAt` after the worker wrote it. No content travels in an
   * event; the read-only editor refetches `GET /documents/:id` when this changes.
   */
  documentUpdatedAt: IsoDateTime.optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

// ---------------------------------------------------------------------------------------------
// Job results (ADR 0025 §19: a proposal job's output rides on its `completed` event)
// ---------------------------------------------------------------------------------------------

/**
 * One re-derived element or block. Exactly one of `element` / `block` is set, matching the
 * target; the editor applies every proposal of a result as one undo transaction (ADR 0022 §4).
 */
export const ProposalSchema = z.strictObject({
  target: ProposalTargetSchema,
  element: SlideElementSchema.optional(),
  block: WorksheetBlockSchema.optional(),
  generatedFrom: GeneratedFromSchema,
});
export type Proposal = z.infer<typeof ProposalSchema>;

const proposalResultFields = {
  proposals: z.array(ProposalSchema),
  /** Targets in the impact set that are `authoredBy: "teacher"`: not re-derived, shown by F07. */
  flagged: z.array(ProposalTargetSchema),
};

/**
 * Discriminated on `job`, not on the event: a `job_events` row carries no job name, so SSE
 * consumers narrow on `result.job`. `lesson.plan` returns no result. Bounded to a few elements —
 * this is not a general result store.
 */
export const JobResultSchema = z.discriminatedUnion("job", [
  z.strictObject({ job: z.literal(JobName.lessonCascade), ...proposalResultFields }),
  z.strictObject({ job: z.literal(JobName.lessonRegenerate), ...proposalResultFields }),
]);
export type JobResult = z.infer<typeof JobResultSchema>;
/** Narrow a `JobResult` to one job's shape. */
export type JobResultOf<J extends JobResult["job"]> = Extract<JobResult, { job: J }>;

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
  /** ADR 0025 §19: present only for jobs that return something. */
  result: JobResultSchema.optional(),
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
