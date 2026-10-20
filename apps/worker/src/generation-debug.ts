/**
 * The worker side of the per-lesson debug record (Greg, 20 Oct 2026; ADR 0015 amendment of that
 * date): a `DebugSink` that numbers, caps and batches `@tj/generation`'s debug records into
 * `generation_debug`, fire and forget. A failed or slow write never fails, slows or changes a
 * lesson: the sink only pushes to a buffer, writes run off the pipeline's path, a failure is one
 * warn line, and `close()` (run after the job's terminal event) never throws.
 */
import type { GenerationDebugInsert } from "@tj/db";
import { type JobId, type LessonId, safeError, type WorkspaceId } from "@tj/domain";
import { type DebugRecord, type DebugSink, fullError } from "@tj/generation";
import type { Logger } from "pino";

/**
 * The cap on one row's payload, as serialised JSON (256 KiB). A larger payload is stored as
 * `{ truncated: true, bytes, head }`, `head` being the first 256 KiB of its JSON text. The writer's
 * raw output (the largest record, about 20–60 KB for a 20-slide deck) fits whole.
 */
export const DEBUG_PAYLOAD_MAX_BYTES = 256 * 1024;
/** Rows per attempt; past it, records are counted and dropped (one warn line at close). */
export const DEBUG_MAX_ROWS = 5000;
/** A buffer is written when it holds this many rows, or this long after its first row. */
export const DEBUG_BATCH_ROWS = 50;
export const DEBUG_FLUSH_MS = 1000;
/** How long `close()` waits for writes still in flight before giving up on them. */
export const DEBUG_CLOSE_TIMEOUT_MS = 5000;

/** Where the rows go: `insertGenerationDebug` on the worker's pool in production. */
export type DebugStore = (
  workspaceId: WorkspaceId,
  rows: readonly GenerationDebugInsert[],
) => Promise<unknown>;

export interface DebugRecorderOptions {
  store: DebugStore;
  workspaceId: WorkspaceId;
  lessonId: LessonId;
  jobId: JobId;
  attempt: number;
  logger: Pick<Logger, "warn">;
  maxBytes?: number;
  maxRows?: number;
  batchRows?: number;
  flushMs?: number;
  closeTimeoutMs?: number;
}

export interface DebugRecorder {
  sink: DebugSink;
  /** A failed attempt's full error (message, stack, cause chain): the debug record only. */
  recordError(error: unknown, extra?: Record<string, unknown>): void;
  /** Write what is buffered and wait (bounded) for every write; never throws. */
  close(): Promise<void>;
}

/**
 * The payload as stored: a JSON snapshot taken now (the pipeline mutates slides later), without
 * NUL characters (Postgres `jsonb` refuses `\u0000`), capped at `maxBytes`.
 */
export function capPayload(payload: unknown, maxBytes = DEBUG_PAYLOAD_MAX_BYTES): unknown {
  const text = (JSON.stringify(payload ?? null) ?? "null").replaceAll("\\u0000", "");
  const bytes = Buffer.byteLength(text);
  if (bytes <= maxBytes) return JSON.parse(text);
  return { truncated: true, bytes, head: Buffer.from(text).subarray(0, maxBytes).toString() };
}

export function createDebugRecorder(opts: DebugRecorderOptions): DebugRecorder {
  const maxBytes = opts.maxBytes ?? DEBUG_PAYLOAD_MAX_BYTES;
  const maxRows = opts.maxRows ?? DEBUG_MAX_ROWS;
  const batchRows = opts.batchRows ?? DEBUG_BATCH_ROWS;
  const flushMs = opts.flushMs ?? DEBUG_FLUSH_MS;
  let seq = 0;
  let dropped = 0;
  let failedRows = 0;
  let buffer: GenerationDebugInsert[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inflight = new Set<Promise<void>>();

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (buffer.length === 0) return;
    const rows = buffer;
    buffer = [];
    const write: Promise<void> = Promise.resolve()
      .then(() => opts.store(opts.workspaceId, rows))
      .then(
        () => undefined,
        (err: unknown) => {
          failedRows += rows.length;
          opts.logger.warn(
            { err: safeError(err), rows: rows.length, lessonId: opts.lessonId },
            "generation debug write failed",
          );
        },
      )
      .finally(() => inflight.delete(write));
    inflight.add(write);
  };

  const sink: DebugSink = (record: DebugRecord) => {
    try {
      if (seq >= maxRows) {
        dropped += 1;
        return;
      }
      buffer.push({
        lessonId: opts.lessonId,
        jobId: opts.jobId,
        attempt: opts.attempt,
        seq: seq++,
        kind: record.kind,
        slideIndex: record.slideIndex ?? null,
        payload: capPayload(record.payload, maxBytes),
        createdAt: new Date(),
      });
      if (buffer.length >= batchRows) flush();
      else if (!timer) {
        timer = setTimeout(flush, flushMs);
        timer.unref?.();
      }
    } catch (err) {
      opts.logger.warn({ err: safeError(err) }, "generation debug record failed");
    }
  };

  return {
    sink,
    recordError: (error, extra) =>
      sink({ kind: "job-error", payload: { ...extra, ...fullError(error) } }),
    async close() {
      try {
        flush();
        if (inflight.size > 0) {
          let late: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            Promise.all([...inflight]),
            new Promise<void>((resolve) => {
              late = setTimeout(resolve, opts.closeTimeoutMs ?? DEBUG_CLOSE_TIMEOUT_MS);
              late.unref?.();
            }),
          ]);
          if (late) clearTimeout(late);
        }
        if (dropped > 0 || failedRows > 0)
          opts.logger.warn(
            { lessonId: opts.lessonId, dropped, failedRows, maxRows },
            "generation debug record incomplete",
          );
      } catch (err) {
        opts.logger.warn({ err: safeError(err) }, "generation debug close failed");
      }
    },
  };
}
