/**
 * Tunables for the SSE endpoints. Read from `process.env` with defaults; `src/env.ts` is owned by
 * TEACH-20 right now, so these stay out of the boot contract until TEACH-26 folds them in.
 */
import { z } from "zod";

export const EventsConfigSchema = z.object({
  /** Concurrent SSE streams per Workspace before `429 rate_limited`. */
  EVENTS_MAX_STREAMS_PER_WORKSPACE: z.coerce.number().int().positive().default(20),
  /** Most rows replayed when a stream opens (`Last-Event-ID` or from the start). */
  EVENTS_REPLAY_LIMIT: z.coerce.number().int().positive().max(5_000).default(500),
  /** Interval of the `: ping` comment that keeps proxies from idling the connection out. */
  EVENTS_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
  /** Poll interval used while the LISTEN connection is down (degraded mode). */
  EVENTS_POLL_MS: z.coerce.number().int().positive().default(1_000),
});

export interface EventsConfig {
  maxStreamsPerWorkspace: number;
  replayLimit: number;
  heartbeatMs: number;
  pollMs: number;
}

export function loadEventsConfig(
  source: Record<string, string | undefined> = process.env,
  overrides: Partial<EventsConfig> = {},
): EventsConfig {
  const parsed = EventsConfigSchema.parse(source);
  return {
    maxStreamsPerWorkspace: parsed.EVENTS_MAX_STREAMS_PER_WORKSPACE,
    replayLimit: parsed.EVENTS_REPLAY_LIMIT,
    heartbeatMs: parsed.EVENTS_HEARTBEAT_MS,
    pollMs: parsed.EVENTS_POLL_MS,
    ...overrides,
  };
}
