/**
 * The SSE stream shared by `GET /jobs/:id/events` and `GET /events` (ADR 0012).
 *
 * Protocol: one SSE message per `job_events` row — `id:` is the row id, `event:` is the job event
 * type, `data:` is the `JobEvent` JSON. On connect the rows after `Last-Event-ID` (or all of
 * them) are replayed from the table, then live rows are forwarded as the hub announces them.
 * Every live notification triggers a re-read by id (`afterId: lastSent`), so the payload on the
 * wire always comes from the table and duplicates are impossible. A `: ping` comment goes out
 * every `heartbeatMs`. Per-job streams close after a terminal event; the firehose never closes.
 * While the LISTEN connection is down (hub degraded) the stream polls the table every `pollMs`.
 */
import { type JobEventRow, listJobEvents } from "@tj/db";
import { JOB_TERMINAL_EVENT_TYPES, type JobId, type WorkspaceId } from "@tj/domain";
import type { Context } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import type { AppEnv } from "../context";
import type { EventsRuntime } from "./runtime";

export interface StreamJobEventsOptions {
  workspaceId: WorkspaceId;
  /** Per-job stream when set; workspace firehose otherwise. */
  jobId?: JobId;
  /** Parsed `Last-Event-ID`; replay starts after it. */
  lastEventId?: number;
  /** Close the stream once a terminal event has been written. */
  closeOnTerminal: boolean;
  /** Called when the stream has fully torn down (slot released, hub unsubscribed). */
  onClose?: () => void;
}

/** `Last-Event-ID` must be a non-negative integer; anything else is ignored (replay from start). */
export function parseLastEventId(header: string | undefined | null): number | undefined {
  if (header === undefined || header === null) return undefined;
  const trimmed = header.trim();
  if (!/^\d{1,15}$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

const terminal = new Set<string>(JOB_TERMINAL_EVENT_TYPES);
export const LIVE_PAGE_SIZE = 100;

export function streamJobEvents(
  c: Context<AppEnv>,
  runtime: EventsRuntime,
  opts: StreamJobEventsOptions,
): Response {
  const { hub, config, jobs } = runtime;
  const log = c.get("logger") ?? runtime.logger;
  c.header("X-Accel-Buffering", "no");

  return streamSSE(
    c,
    async (stream) => {
      let lastSent = opts.lastEventId ?? 0;
      let finished = false;
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((r) => {
        resolveDone = r;
      });
      const finish = () => {
        if (finished) return;
        finished = true;
        resolveDone();
      };

      stream.onAbort(finish);
      c.req.raw.signal.addEventListener("abort", finish, { once: true });
      runtime.shutdown.addEventListener("abort", finish, { once: true });

      async function send(row: JobEventRow): Promise<boolean> {
        if (finished) return false;
        await stream.writeSSE({
          id: String(row.id),
          event: row.type,
          data: JSON.stringify(row.payload),
        });
        lastSent = row.id;
        if (opts.closeOnTerminal && terminal.has(row.type)) {
          finish();
          return false;
        }
        return true;
      }

      /** Send up to `limit` rows after `lastSent`, page by page. */
      async function drain(limit: number): Promise<void> {
        let remaining = limit;
        while (!finished && remaining > 0) {
          const page = Math.min(remaining, LIVE_PAGE_SIZE);
          const rows = await listJobEvents(jobs.db, {
            workspaceId: opts.workspaceId,
            jobId: opts.jobId,
            afterId: lastSent,
            limit: page,
          });
          for (const row of rows) if (!(await send(row))) return;
          remaining -= rows.length;
          if (rows.length < page) return;
        }
      }

      // Serialise drains: a notification while one is running just marks another pass, so two
      // concurrent reads can never both write the same row.
      let draining: Promise<void> | undefined;
      let again = false;
      const runDrain = (limit: number): Promise<void> => {
        if (finished) return Promise.resolve();
        if (draining) {
          again = true;
          return draining;
        }
        draining = (async () => {
          let first = true;
          do {
            again = false;
            try {
              await drain(first ? limit : Number.MAX_SAFE_INTEGER);
            } catch (err) {
              log.warn({ err }, "sse drain failed");
            }
            first = false;
          } while (again && !finished);
          draining = undefined;
        })();
        return draining;
      };
      const scheduleDrain = () => void runDrain(Number.MAX_SAFE_INTEGER);

      // Subscribe before replaying so nothing slips between the replay read and the first
      // notification; the id cursor dedupes whatever both paths see.
      runtime.ensureListener();
      const unsubscribe = hub.subscribe(
        { workspaceId: opts.workspaceId, jobId: opts.jobId },
        scheduleDrain,
      );

      const heartbeat = setInterval(() => {
        if (!finished) void writeComment(stream, "ping");
      }, config.heartbeatMs);
      const poll = setInterval(() => {
        if (!finished && hub.isDegraded()) scheduleDrain();
      }, config.pollMs);

      try {
        await runDrain(config.replayLimit);
        // A `Last-Event-ID` past the terminal row would otherwise leave a per-job stream open
        // forever: check whether the job already finished before waiting for live rows.
        if (!finished && opts.closeOnTerminal && opts.jobId !== undefined) {
          const all = await listJobEvents(jobs.db, {
            workspaceId: opts.workspaceId,
            jobId: opts.jobId,
            limit: config.replayLimit,
          });
          if (all.some((row) => terminal.has(row.type))) finish();
        }
        await done;
      } catch (err) {
        log.warn({ err }, "sse stream failed");
      } finally {
        finished = true;
        clearInterval(heartbeat);
        clearInterval(poll);
        unsubscribe();
        c.req.raw.signal.removeEventListener("abort", finish);
        runtime.shutdown.removeEventListener("abort", finish);
        opts.onClose?.();
      }
    },
    async (err) => {
      log.error({ err }, "sse stream error");
    },
  );
}

async function writeComment(stream: SSEStreamingApi, text: string): Promise<void> {
  await stream.write(`: ${text}\n\n`);
}
