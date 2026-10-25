/**
 * The generation debug channel (Greg, 20 Oct 2026; ADR 0015 amendment of that date): what a stage
 * did that a root cause needs and the logs never carry — model output, before and after slides,
 * fault details, picture decisions, a failed job's full error. The worker stores each record in
 * `generation_debug` for 30 days; nothing here ever reaches a log line or a third party.
 *
 * A sink is fire and forget: it returns nothing, never throws into the pipeline (`recordDebug`
 * swallows a throwing sink) and must never be awaited by a stage. Absent, nothing is recorded and
 * the pipeline runs exactly as it does with one.
 */

/** What a debug record is about. The tool (`tools/lesson-debug`) groups and labels by it. */
export type DebugKind =
  /** The writer call's raw streamed text, its finish reason, cost and timing. */
  | "writer-output"
  /** A planner stage's output: the objectives (writer, objectives-first) or the plan. */
  | "plan"
  /** One slide's code check: its fault lines and the measured overflows (element, by how much). */
  | "check"
  /** One repair, fit or restage attempt: mode, slide before and after, accepted or reverted. */
  | "repair"
  /** A slide split into several (table continued, quick check, practice, lost-picture split). */
  | "split"
  /** A picture-director decision: the query or prompt, candidates, the choice and the outcome. */
  | "picture"
  /** A fact-check change: the text before and after. */
  | "fact-check"
  /** The model call that tripped the lesson's budget stop. */
  | "budget-stop"
  /**
   * One model request (an SDK or caller retry is its own row), captured once in `@tj/ai`'s capture
   * middleware: the full request (system, messages, schema name, model, settings), the full
   * response and finish reason, usage, cost, latency, and lessonId, jobId, stage, prompt version.
   */
  | "model-call"
  /** A writer stage event (the same object the `writer stage` log line carries). */
  | "event"
  /** A pipeline stage that threw: its stage name and the full error. */
  | "stage-error"
  /** A failed job attempt's full error (message, stack, cause chain). */
  | "job-error";

export interface DebugRecord {
  kind: DebugKind;
  /** 0-based slide index; absent for a deck-wide record. */
  slideIndex?: number;
  payload: unknown;
}

export type DebugSink = (record: DebugRecord) => void;

/** Record through `sink` when there is one; a sink that throws is ignored (never fails a stage). */
export function recordDebug(
  sink: DebugSink | undefined,
  kind: DebugKind,
  payload: unknown,
  slideIndex?: number,
): void {
  if (!sink) return;
  try {
    sink(slideIndex === undefined ? { kind, payload } : { kind, slideIndex, payload });
  } catch {
    // Debug is best effort by contract.
  }
}

/**
 * An error as a debug payload: class, message, stack, a provider failure's status, codes and
 * redacted message, and the `cause` chain (depth 5). Only for
 * `generation_debug`; logs keep `safeError` (ADR 0015 TEACH-282 amendment).
 */
export function fullError(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: String(error) };
  const own = error as Error & {
    code?: unknown;
    by?: unknown;
    reason?: unknown;
    statusCode?: unknown;
    isRetryable?: unknown;
    providerErrorCode?: unknown;
    providerCode?: unknown;
    providerMessage?: unknown;
  };
  return {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(own.code !== undefined ? { code: String(own.code) } : {}),
    ...(own.reason !== undefined ? { reason: String(own.reason) } : {}),
    ...(own.by !== undefined ? { by: own.by } : {}),
    // A provider failure's detail (`@tj/ai` `ProviderFailure`): status, codes, the redacted message.
    ...(typeof own.statusCode === "number" ? { statusCode: own.statusCode } : {}),
    ...(typeof own.isRetryable === "boolean" ? { isRetryable: own.isRetryable } : {}),
    ...(typeof own.providerErrorCode === "string"
      ? { providerErrorCode: own.providerErrorCode }
      : {}),
    ...(typeof own.providerCode === "string" ? { providerCode: own.providerCode } : {}),
    ...(typeof own.providerMessage === "string" ? { providerMessage: own.providerMessage } : {}),
    ...(error.cause !== undefined && depth < 5 ? { cause: fullError(error.cause, depth + 1) } : {}),
  };
}
