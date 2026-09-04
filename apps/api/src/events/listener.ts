/**
 * `LISTEN job_events` on a dedicated postgres.js connection (`max: 1`, separate from the request
 * pool so a busy pool never delays notifications). Each payload is parsed with
 * `JobEventNotificationSchema` and handed to the hub; malformed payloads are logged and dropped.
 *
 * Resilience: if `LISTEN` cannot be established the hub is marked degraded (streams poll the
 * table instead) and the listener retries with exponential backoff (500 ms → 10 s cap). Once
 * listening, postgres.js re-establishes the channel itself after a dropped connection and calls
 * `onlisten` again, which clears the degraded flag; events emitted during the gap are still
 * picked up because every stream re-reads `job_events` by id rather than trusting the payload.
 */
import { createDb, JOB_EVENTS_CHANNEL, JobEventNotificationSchema } from "@tj/db";
import type { Logger } from "../logger";
import type { Hub } from "./hub";

export const LISTENER_BACKOFF_INITIAL_MS = 500;
export const LISTENER_BACKOFF_MAX_MS = 10_000;

export interface StartListenerOptions {
  databaseUrl: string;
  hub: Hub;
  logger: Logger;
  /** Test seams. */
  backoffInitialMs?: number;
  backoffMaxMs?: number;
}

export interface JobEventsListener {
  /** Resolves once the first `LISTEN` attempt settled (listening or degraded). */
  ready: Promise<void>;
  stop(): Promise<void>;
}

export function startJobEventsListener({
  databaseUrl,
  hub,
  logger,
  backoffInitialMs = LISTENER_BACKOFF_INITIAL_MS,
  backoffMaxMs = LISTENER_BACKOFF_MAX_MS,
}: StartListenerOptions): JobEventsListener {
  const db = createDb(databaseUrl, { max: 1 });
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => Promise<void>) | undefined;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  function onNotification(payload: string) {
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      logger.warn({ channel: JOB_EVENTS_CHANNEL }, "job_events notification is not JSON; ignored");
      return;
    }
    const parsed = JobEventNotificationSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { channel: JOB_EVENTS_CHANNEL, issues: parsed.error.issues },
        "job_events notification failed validation; ignored",
      );
      return;
    }
    hub.publish(parsed.data);
  }

  async function connect(delayMs: number): Promise<void> {
    if (stopped) return;
    try {
      const result = await db.sql.listen(JOB_EVENTS_CHANNEL, onNotification, () => {
        if (hub.isDegraded()) logger.info({ channel: JOB_EVENTS_CHANNEL }, "job_events listening");
        hub.setDegraded(false);
      });
      unlisten = result.unlisten;
      resolveReady();
    } catch (err) {
      hub.setDegraded(true);
      const next = Math.min(delayMs * 2, backoffMaxMs);
      logger.warn(
        { err, retry_in_ms: delayMs },
        "job_events LISTEN failed; polling until it is back",
      );
      resolveReady();
      retryTimer = setTimeout(() => void connect(next), delayMs);
    }
  }

  void connect(backoffInitialMs);

  return {
    ready,
    async stop() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      try {
        await unlisten?.();
      } catch {
        // connection already gone
      }
      await db.close();
    },
  };
}
