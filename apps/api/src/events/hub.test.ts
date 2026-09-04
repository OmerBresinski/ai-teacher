import { describe, expect, test } from "bun:test";
import { type JobId, newId, type WorkspaceId } from "@tj/domain";
import { createHub } from "./hub";

const ws = () => newId<WorkspaceId>();
const job = () => newId<JobId>();

describe("events hub", () => {
  test("delivers to job and workspace subscribers; unsubscribe returns size to 0", () => {
    const hub = createHub();
    const workspaceId = ws();
    const jobId = job();
    const seenJob: number[] = [];
    const seenWs: number[] = [];
    const offJob = hub.subscribe({ workspaceId, jobId }, (n) => seenJob.push(n.id));
    const offWs = hub.subscribe({ workspaceId }, (n) => seenWs.push(n.id));
    expect(hub.size()).toBe(2);

    hub.publish({ id: 1, jobId, workspaceId });
    hub.publish({ id: 2, jobId: job(), workspaceId });
    expect(seenJob).toEqual([1]);
    expect(seenWs).toEqual([1, 2]);

    offJob();
    hub.publish({ id: 3, jobId, workspaceId });
    expect(seenJob).toEqual([1]);
    expect(seenWs).toEqual([1, 2, 3]);
    expect(hub.size()).toBe(1);

    offWs();
    offWs(); // idempotent
    expect(hub.size()).toBe(0);
    hub.publish({ id: 4, jobId, workspaceId });
    expect(seenWs).toEqual([1, 2, 3]);
  });

  test("never crosses workspaces", () => {
    const hub = createHub();
    const a = ws();
    const b = ws();
    const jobId = job();
    const seen: number[] = [];
    hub.subscribe({ workspaceId: a, jobId }, (n) => seen.push(n.id));
    hub.subscribe({ workspaceId: a }, (n) => seen.push(n.id));
    hub.publish({ id: 1, jobId, workspaceId: b });
    expect(seen).toEqual([]);
  });

  test("degraded flag", () => {
    const hub = createHub();
    expect(hub.isDegraded()).toBe(false);
    hub.setDegraded(true);
    expect(hub.isDegraded()).toBe(true);
  });
});
