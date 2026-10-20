/**
 * The worker side of the per-lesson debug record (Greg, 20 Oct 2026; ADR 0015 amendment of that
 * date): a `DebugSink` that numbers, caps and batches `@tj/generation`'s debug records into
 * `generation_debug`, fire and forget. A failed or slow write never fails, slows or changes a
 * lesson: the sink only pushes to a buffer, writes run off the pipeline's path, a failure is one
 * warn line, and `close()` (run after the job's terminal event) never throws.
 */
import { type CreatedAi, withCallCapture } from "@tj/ai";
import type { GenerationDebugInsert } from "@tj/db";
import { type JobId, type LessonId, safeError, type WorkspaceId } from "@tj/domain";
import { type DebugRecord, type DebugSink, fullError } from "@tj/generation";
import type { Logger } from "pino";

/**
 * The cap on one row's payload, as serialised JSON: 128 KiB, about twice the largest row it must
 * keep whole, rounded up. That row is the writer's `model-call`: 40.5 KB measured in
 * `lesson-debug.integration.test.ts` (KS3 system prompt 28.5 KB, user turn, an 8.3 KB answer);
 * with the largest lab writer answer (13.8 KB, the y12 psychology replay) about 46 KB, so 2x is
 * 92 KB. Over the cap the longest strings are cut first (a pasted source, then the system prompt)
 * and the row says so: `truncated: true`, `originalBytes`, and each cut field's path and original
 * length (`truncatedFields`).
 */
export const DEBUG_PAYLOAD_MAX_BYTES = 128 * 1024;
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
 * NUL characters (Postgres `jsonb` refuses `\u0000`), capped at `maxBytes` by cutting its longest
 * strings (each to half, longest first) and saying what was cut.
 */
export function capPayload(payload: unknown, maxBytes = DEBUG_PAYLOAD_MAX_BYTES): unknown {
  const text = (JSON.stringify(payload ?? null) ?? "null").replaceAll("\\u0000", "");
  const originalBytes = Buffer.byteLength(text);
  if (originalBytes <= maxBytes) return JSON.parse(text);
  // Room kept for the truncation marks themselves.
  const reserve = Math.min(4096, Math.floor(maxBytes / 8));
  const root = { value: JSON.parse(text) as unknown };
  const cut = new Map<string, number>();
  for (let round = 0; round < 64; round++) {
    // The longest string in the payload, wherever it is.
    let best: { holder: Record<string, unknown>; key: string; path: string; len: number } | null =
      null;
    const walk = (holder: Record<string, unknown>, key: string, path: string) => {
      const v = holder[key];
      if (typeof v === "string") {
        if (!best || v.length > best.len) best = { holder, key, path, len: v.length };
      } else if (v && typeof v === "object")
        for (const k of Object.keys(v)) walk(v as Record<string, unknown>, k, `${path}.${k}`);
    };
    walk(root as Record<string, unknown>, "value", "$");
    const found = best as {
      holder: Record<string, unknown>;
      key: string;
      path: string;
      len: number;
    } | null;
    if (!found || found.len < 64) break;
    if (!cut.has(found.path)) cut.set(found.path, found.len);
    found.holder[found.key] =
      `${(found.holder[found.key] as string).slice(0, Math.floor(found.len / 2))}…[truncated]`;
    if (Buffer.byteLength(JSON.stringify(root.value)) + reserve <= maxBytes) break;
  }
  const truncatedFields = [...cut].map(([path, originalLength]) => ({ path, originalLength }));
  const body = JSON.stringify(root.value);
  if (Buffer.byteLength(body) + reserve > maxBytes)
    return { truncated: true, originalBytes, truncatedFields, head: body.slice(0, maxBytes / 2) };
  const value = root.value;
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as object), truncated: true, originalBytes, truncatedFields }
    : { value, truncated: true, originalBytes, truncatedFields };
}

/** `ai` for one job, with every model request captured as a `model-call` debug row. */
export function captureCalls(ai: CreatedAi, recorder: DebugRecorder | undefined): CreatedAi {
  if (!recorder) return ai;
  return withCallCapture(ai, (call) => recorder.sink({ kind: "model-call", payload: call }));
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
