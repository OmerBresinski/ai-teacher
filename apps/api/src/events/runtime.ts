/**
 * Everything the job/event routes share: the pg-boss context, the fan-out hub, the lazily started
 * Postgres listener, per-workspace stream limits and the config knobs. Built once per process in
 * `src/index.ts` (or per test) and handed to `createApp({ jobs, events })`.
 */

import type { WorkspaceId } from "@tj/domain";
import type { JobsContext } from "@tj/jobs";
import type { Logger } from "../logger";
import { type EventsConfig, loadEventsConfig } from "./config";
import { createHub, type Hub } from "./hub";
import { type JobEventsListener, startJobEventsListener } from "./listener";

export interface CreateEventsRuntimeOptions {
  jobs: JobsContext;
  /**
   * Connection URL for the dedicated `LISTEN` connection. When omitted no listener is started
   * and the hub stays degraded, i.e. streams poll `job_events` every `pollMs`.
   */
  databaseUrl?: string;
  logger: Logger;
  config?: Partial<EventsConfig>;
  hub?: Hub;
}

export interface EventsRuntime {
  jobs: JobsContext;
  hub: Hub;
  config: EventsConfig;
  logger: Logger;
  /**
   * Reserve a stream slot for `workspaceId`. Returns a release function, or `null` when the
   * workspace already has `maxStreamsPerWorkspace` open streams.
   */
  acquireStream(workspaceId: WorkspaceId): (() => void) | null;
  /** Streams open for a workspace (tests). */
  openStreams(workspaceId: WorkspaceId): number;
  /** Start the Postgres listener if not already running (called on first subscription). */
  ensureListener(): void;
  /** Aborted by `stop()`; every open stream ends so `server.stop()` can drain. */
  shutdown: AbortSignal;
  stop(): Promise<void>;
}

export function createEventsRuntime({
  jobs,
  databaseUrl,
  logger,
  config: overrides,
  hub = createHub(),
}: CreateEventsRuntimeOptions): EventsRuntime {
  const config = loadEventsConfig(process.env, overrides);
  const perWorkspace = new Map<WorkspaceId, number>();
  let listener: JobEventsListener | undefined;
  let stopped = false;
  const shutdown = new AbortController();

  if (databaseUrl === undefined) hub.setDegraded(true);

  return {
    jobs,
    hub,
    config,
    logger,
    acquireStream(workspaceId) {
      const current = perWorkspace.get(workspaceId) ?? 0;
      if (current >= config.maxStreamsPerWorkspace) return null;
      perWorkspace.set(workspaceId, current + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (perWorkspace.get(workspaceId) ?? 1) - 1;
        if (n <= 0) perWorkspace.delete(workspaceId);
        else perWorkspace.set(workspaceId, n);
      };
    },
    openStreams: (workspaceId) => perWorkspace.get(workspaceId) ?? 0,
    ensureListener() {
      if (listener || stopped || databaseUrl === undefined) return;
      hub.setDegraded(true); // until `onlisten` confirms the channel is live
      listener = startJobEventsListener({ databaseUrl, hub, logger });
    },
    shutdown: shutdown.signal,
    async stop() {
      stopped = true;
      shutdown.abort();
      await listener?.stop();
      listener = undefined;
    },
  };
}
