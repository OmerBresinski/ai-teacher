/**
 * In-process fan-out of `job_events` notifications to open SSE streams (ADR 0012). One hub per
 * API process; the Postgres listener (`listener.ts`) calls `publish()`, streams `subscribe()`.
 *
 * Subscribers are keyed by `jobId` (per-job streams) or by `workspaceId` (the firehose). A
 * notification reaches the job's subscribers and the workspace's subscribers; the per-job
 * subscribers are additionally checked against the workspace so a stale subscription can never
 * receive another tenant's ids.
 */
import type { JobEventNotification } from "@tj/db";
import type { JobId, WorkspaceId } from "@tj/domain";

export interface HubFilter {
  workspaceId: WorkspaceId;
  /** When set, only this job's notifications are delivered. */
  jobId?: JobId;
}

export type HubSubscriber = (notification: JobEventNotification) => void;

export interface Hub {
  subscribe(filter: HubFilter, cb: HubSubscriber): () => void;
  publish(notification: JobEventNotification): void;
  /** Number of live subscriptions (tests assert it returns to 0). */
  size(): number;
  /** Degraded = the LISTEN connection is down; streams fall back to polling. */
  setDegraded(degraded: boolean): void;
  isDegraded(): boolean;
}

interface Entry {
  filter: HubFilter;
  cb: HubSubscriber;
}

export function createHub(): Hub {
  const byJob = new Map<JobId, Set<Entry>>();
  const byWorkspace = new Map<WorkspaceId, Set<Entry>>();
  let count = 0;
  let degraded = false;

  function add<K>(map: Map<K, Set<Entry>>, key: K, entry: Entry) {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(entry);
  }
  function remove<K>(map: Map<K, Set<Entry>>, key: K, entry: Entry) {
    const set = map.get(key);
    if (!set) return;
    set.delete(entry);
    if (set.size === 0) map.delete(key);
  }

  return {
    subscribe(filter, cb) {
      const entry: Entry = { filter, cb };
      if (filter.jobId !== undefined) add(byJob, filter.jobId, entry);
      else add(byWorkspace, filter.workspaceId, entry);
      count++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (filter.jobId !== undefined) remove(byJob, filter.jobId, entry);
        else remove(byWorkspace, filter.workspaceId, entry);
        count--;
      };
    },

    publish(notification) {
      const jobSubs = byJob.get(notification.jobId);
      if (jobSubs) {
        for (const entry of jobSubs) {
          if (entry.filter.workspaceId === notification.workspaceId) entry.cb(notification);
        }
      }
      const wsSubs = byWorkspace.get(notification.workspaceId);
      if (wsSubs) for (const entry of wsSubs) entry.cb(notification);
    },

    size: () => count,
    setDegraded: (d) => {
      degraded = d;
    },
    isDegraded: () => degraded,
  };
}
