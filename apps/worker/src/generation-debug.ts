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
/** A buffer is also written once it holds this many bytes, so one insert stays small. */
export const DEBUG_BATCH_BYTES = 1024 * 1024;
/** How long `close()` waits for writes still in flight before giving up on them. */
export const DEBUG_CLOSE_TIMEOUT_MS = 5000;
/**
 * The worker's memory budget for debug rows buffered or in flight, across every job: past it a
 * record is dropped and counted (one warn line at close), so a slow debug database never grows
 * the worker's heap without bound.
 */
export const DEBUG_BUDGET_BYTES = 32 * 1024 * 1024;

/** Bytes held by debug rows not yet written; one per worker unless a test passes its own. */
export interface DebugBudget {
  used: number;
  max: number;
}
const workerBudget: DebugBudget = { used: 0, max: DEBUG_BUDGET_BYTES };

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
  batchBytes?: number;
  closeTimeoutMs?: number;
  budget?: DebugBudget;
}

export interface DebugRecorder {
  sink: DebugSink;
  /** A failed attempt's full error (message, stack, cause chain): the debug record only. */
  recordError(error: unknown, extra?: Record<string, unknown>): void;
  /** Write what is buffered and wait (bounded) for every write; never throws. */
  close(): Promise<void>;
}

/** NUL-free, well-formed text: Postgres `jsonb` refuses `\u0000` and lone surrogates. */
function cleanString(s: string): string {
  return s.toWellFormed().replaceAll("\u0000", "");
}

/** A deep copy with every string (and key) cleaned; JSON-shaped input. */
function clean(value: unknown): unknown {
  if (typeof value === "string") return cleanString(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[cleanString(k)] = clean(v);
    return out;
  }
  return value;
}

/** UTF-8 bytes of one code point. */
const bytesOf = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** The longest prefix of `s` within `maxBytes` of UTF-8, cut between code points. */
export function cutUtf8(s: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of s) {
    const b = bytesOf(ch.codePointAt(0) ?? 0);
    if (bytes + b > maxBytes) break;
    bytes += b;
    end += ch.length;
  }
  return s.slice(0, end);
}

/**
 * The payload as stored: a JSON snapshot taken now (the pipeline mutates slides later), its strings
 * cleaned (no NUL, no lone surrogate), capped at `maxBytes` of UTF-8 by cutting its longest
 * strings (each to half its bytes, longest first, between code points) and saying what was cut.
 */
export function capPayload(payload: unknown, maxBytes = DEBUG_PAYLOAD_MAX_BYTES): unknown {
  return capPayloadSized(payload, maxBytes).value;
}

function capPayloadSized(payload: unknown, maxBytes: number): { value: unknown; bytes: number } {
  const snapshot = clean(JSON.parse(JSON.stringify(payload ?? null) ?? "null"));
  const text = JSON.stringify(snapshot);
  const originalBytes = Buffer.byteLength(text);
  if (originalBytes <= maxBytes) return { value: snapshot, bytes: originalBytes };
  // Room kept for the truncation marks themselves.
  const reserve = Math.min(4096, Math.floor(maxBytes / 8));
  const root = { value: snapshot };
  const cut = new Map<string, number>();
  type Found = { holder: Record<string, unknown>; key: string; path: string; len: number };
  for (let round = 0; round < 64; round++) {
    // The longest string in the payload, wherever it is.
    let best: Found | null = null;
    const walk = (holder: Record<string, unknown>, key: string, path: string) => {
      const v = holder[key];
      if (typeof v === "string") {
        if (!best || v.length > best.len) best = { holder, key, path, len: v.length };
      } else if (v && typeof v === "object")
        for (const k of Object.keys(v)) walk(v as Record<string, unknown>, k, `${path}.${k}`);
    };
    walk(root as Record<string, unknown>, "value", "$");
    const found = best as Found | null;
    if (!found || found.len < 64) break;
    const str = found.holder[found.key] as string;
    const strBytes = Buffer.byteLength(str);
    if (!cut.has(found.path)) cut.set(found.path, strBytes);
    found.holder[found.key] = `${cutUtf8(str, Math.floor(strBytes / 2))}…[truncated]`;
    if (Buffer.byteLength(JSON.stringify(root.value)) + reserve <= maxBytes) break;
  }
  const truncatedFields = [...cut].map(([path, originalBytes]) => ({ path, originalBytes }));
  const body = JSON.stringify(root.value);
  let value: unknown;
  if (Buffer.byteLength(body) + reserve > maxBytes)
    // A quarter of the cap in bytes: escaped inside JSON, the head at most doubles.
    value = { truncated: true, originalBytes, truncatedFields, head: cutUtf8(body, maxBytes / 4) };
  else
    value =
      root.value && typeof root.value === "object" && !Array.isArray(root.value)
        ? { ...(root.value as object), truncated: true, originalBytes, truncatedFields }
        : { value: root.value, truncated: true, originalBytes, truncatedFields };
  return { value, bytes: Buffer.byteLength(JSON.stringify(value)) };
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
  const batchBytes = opts.batchBytes ?? DEBUG_BATCH_BYTES;
  const budget = opts.budget ?? workerBudget;
  let seq = 0;
  let dropped = 0;
  let overBudget = 0;
  let failedRows = 0;
  let buffer: GenerationDebugInsert[] = [];
  let bufferBytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inflight = new Set<Promise<void>>();

  /** The batch, or row by row when the batch fails (one bad row costs only itself). */
  const write = async (rows: GenerationDebugInsert[]) => {
    try {
      await opts.store(opts.workspaceId, rows);
      return;
    } catch (err) {
      if (rows.length === 1) {
        failedRows += 1;
        opts.logger.warn(
          { err: safeError(err), rows: 1, lessonId: opts.lessonId },
          "generation debug write failed",
        );
        return;
      }
    }
    let failed = 0;
    let lastErr: unknown;
    for (const row of rows) {
      try {
        await opts.store(opts.workspaceId, [row]);
      } catch (err) {
        failed += 1;
        lastErr = err;
      }
    }
    if (failed > 0) {
      failedRows += failed;
      opts.logger.warn(
        { err: safeError(lastErr), rows: failed, of: rows.length, lessonId: opts.lessonId },
        "generation debug write failed",
      );
    }
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (buffer.length === 0) return;
    const rows = buffer;
    const bytes = bufferBytes;
    buffer = [];
    bufferBytes = 0;
    // Off the caller's path: the store is first called after the sink has returned.
    const done: Promise<void> = Promise.resolve()
      .then(() => write(rows))
      .catch(() => undefined)
      .finally(() => {
        budget.used -= bytes;
        inflight.delete(done);
      });
    inflight.add(done);
  };

  const sink: DebugSink = (record: DebugRecord) => {
    try {
      if (seq >= maxRows) {
        dropped += 1;
        return;
      }
      const { value, bytes } = capPayloadSized(record.payload, maxBytes);
      if (budget.used + bytes > budget.max) {
        overBudget += 1;
        return;
      }
      budget.used += bytes;
      bufferBytes += bytes;
      buffer.push({
        lessonId: opts.lessonId,
        jobId: opts.jobId,
        attempt: opts.attempt,
        seq: seq++,
        kind: record.kind,
        slideIndex: record.slideIndex ?? null,
        payload: value,
        createdAt: new Date(),
      });
      if (buffer.length >= batchRows || bufferBytes >= batchBytes) flush();
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
        if (dropped > 0 || overBudget > 0 || failedRows > 0)
          opts.logger.warn(
            { lessonId: opts.lessonId, dropped, overBudget, failedRows, maxRows },
            "generation debug record incomplete",
          );
      } catch (err) {
        opts.logger.warn({ err: safeError(err) }, "generation debug close failed");
      }
    },
  };
}
