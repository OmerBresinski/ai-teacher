import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { type JobEvent, type JobId, newId, type WorkspaceId } from "@tj/domain";
import { ZodError } from "zod";
import {
  getTerminalJobEvent,
  hasAnyJobEvent,
  insertJobEvent,
  JOB_EVENTS_CHANNEL,
  type JobEventNotification,
  JobEventNotificationSchema,
  listJobEvents,
  notifyJobEvent,
} from "./job-events";
import { forWorkspace } from "./tenant";
import { createTestUserWithWorkspace, withTestDb } from "./testing";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping job-events tests: ${t.reason}`);

const at = () => new Date().toISOString();

describeDb("job events", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const wsA = newId<WorkspaceId>();
  const wsB = newId<WorkspaceId>();

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsA, workspaceName: "A" });
    await createTestUserWithWorkspace(unsafeDb, { workspaceId: wsB, workspaceName: "B" });
  });

  test("insertJobEvent rejects an unknown event type", async () => {
    const bad = { type: "done", jobId: newId<JobId>(), workspaceId: wsA, at: at() };
    await expect(insertJobEvent(unsafeDb, bad as unknown as JobEvent)).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  test("insertJobEvent rejects a non-UTC timestamp", async () => {
    const bad: JobEvent = {
      type: "started",
      jobId: newId<JobId>(),
      workspaceId: wsA,
      at: "2026-09-04T10:00:00+02:00",
    };
    await expect(insertJobEvent(unsafeDb, bad)).rejects.toBeInstanceOf(ZodError);
  });

  test("insertJobEvent stores a progress event with the whole event as payload", async () => {
    const event: JobEvent = {
      type: "progress",
      jobId: newId<JobId>(),
      workspaceId: wsA,
      at: at(),
      progress: { percent: 42, message: "half way" },
    };
    const { id } = await insertJobEvent(unsafeDb, event);
    expect(id).toBeGreaterThan(0);

    const rows = await listJobEvents(unsafeDb, { workspaceId: wsA, limit: 10 });
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.type).toBe("progress");
    expect(rows[0]?.jobId).toBe(event.jobId);
    expect(rows[0]?.payload).toEqual(event);
    expect(rows[0]?.at.toISOString()).toBe(event.at);
  });

  test("listJobEvents orders by id, filters by job and honours afterId + limit", async () => {
    const job1 = newId<JobId>();
    const job2 = newId<JobId>();
    const ids: number[] = [];
    for (const [jobId, type] of [
      [job1, "queued"],
      [job1, "started"],
      [job2, "queued"],
      [job1, "completed"],
    ] as const) {
      ids.push((await insertJobEvent(unsafeDb, { type, jobId, workspaceId: wsA, at: at() })).id);
    }
    await insertJobEvent(unsafeDb, { type: "queued", jobId: job1, workspaceId: wsB, at: at() });

    const all = await listJobEvents(unsafeDb, { workspaceId: wsA, limit: 100 });
    expect(all.map((r) => r.id)).toEqual(ids);

    const forJob1 = await listJobEvents(unsafeDb, { workspaceId: wsA, jobId: job1, limit: 100 });
    expect(forJob1.map((r) => r.type)).toEqual(["queued", "started", "completed"]);

    const replay = await listJobEvents(unsafeDb, {
      workspaceId: wsA,
      jobId: job1,
      afterId: ids[1],
      limit: 100,
    });
    expect(replay.map((r) => r.id)).toEqual(ids.slice(3));

    const page = await listJobEvents(unsafeDb, { workspaceId: wsA, limit: 2 });
    expect(page.map((r) => r.id)).toEqual(ids.slice(0, 2));

    const other = await listJobEvents(unsafeDb, { workspaceId: wsB, jobId: job1, limit: 100 });
    expect(other.length).toBe(1);
  });

  test("notifyJobEvent is received by sql.listen on the job_events channel", async () => {
    const notification: JobEventNotification = { id: 7, jobId: newId<JobId>(), workspaceId: wsA };
    const received = new Promise<JobEventNotification>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no NOTIFY within 1s")), 1000);
      sql
        .listen(JOB_EVENTS_CHANNEL, (payload) => {
          clearTimeout(timer);
          resolve(JobEventNotificationSchema.parse(JSON.parse(payload)));
        })
        .then(() => notifyJobEvent(sql, notification))
        .catch(reject);
    });
    expect(await received).toEqual(notification);
  });

  test("notifyJobEvent validates the notification", async () => {
    await expect(
      notifyJobEvent(sql, { id: 0, jobId: newId<JobId>(), workspaceId: wsA }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  test("getTerminalJobEvent finds the terminal row for a job in its Workspace only", async () => {
    const jobId = newId<JobId>();
    const base = { jobId, workspaceId: wsA, at: at() };
    await insertJobEvent(unsafeDb, { type: "queued", ...base });
    await insertJobEvent(unsafeDb, { type: "started", ...base });
    expect(await getTerminalJobEvent(unsafeDb, { workspaceId: wsA, jobId })).toBeUndefined();
    const { id } = await insertJobEvent(unsafeDb, { type: "completed", ...base });
    expect((await getTerminalJobEvent(unsafeDb, { workspaceId: wsA, jobId }))?.id).toBe(id);
    expect(await getTerminalJobEvent(unsafeDb, { workspaceId: wsB, jobId })).toBeUndefined();
  });

  test("hasAnyJobEvent is true from the first queued row, scoped to the Workspace", async () => {
    const jobId = newId<JobId>();
    expect(await hasAnyJobEvent(forWorkspace(unsafeDb, wsA), jobId)).toBe(false);
    await insertJobEvent(unsafeDb, { type: "queued", jobId, workspaceId: wsA, at: at() });
    expect(await hasAnyJobEvent(forWorkspace(unsafeDb, wsA), jobId)).toBe(true);
    expect(await hasAnyJobEvent(forWorkspace(unsafeDb, wsB), jobId)).toBe(false);
  });
});
