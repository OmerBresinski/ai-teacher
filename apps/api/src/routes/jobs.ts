/**
 * `/jobs/*` — enqueue, cancel and per-job SSE (ADR 0006: the API only enqueues; ADR 0012: SSE
 * with `Last-Event-ID` replay). Every route resolves the caller's Workspace with
 * `getWorkspaceId(c)` and checks job ownership through `job_events` scoped by `forWorkspace()`.
 */
import { zValidator } from "@hono/zod-validator";
import { listJobEvents } from "@tj/db";
import { AiPingPayloadSchema, JobId, PingPayloadSchema, type WorkspaceId } from "@tj/domain";
import { cancel, enqueue } from "@tj/jobs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import type { EventsRuntime } from "../events/runtime";
import { parseLastEventId, streamJobEvents } from "../events/stream";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";

const jobParam = z.object({ id: JobId });

/** 503 when the process was started without pg-boss (tests, or a misconfigured deploy). */
export function requireRuntime(runtime: EventsRuntime | undefined): EventsRuntime {
  if (!runtime) {
    throw new HTTPException(503, { message: "Background jobs are not available right now." });
  }
  return runtime;
}

/** 404 unless at least one event for `jobId` exists in the caller's Workspace. */
export async function assertJobInWorkspace(
  runtime: EventsRuntime,
  workspaceId: WorkspaceId,
  jobId: JobId,
): Promise<void> {
  const rows = await listJobEvents(runtime.jobs.db, { workspaceId, jobId, limit: 1 });
  if (rows.length === 0) {
    throw new HTTPException(404, { message: "That job does not exist." });
  }
}

/** Reserve a stream slot or fail with 429. Returns the release function. */
export function acquireStreamOr429(runtime: EventsRuntime, workspaceId: WorkspaceId): () => void {
  const release = runtime.acquireStream(workspaceId);
  if (!release) {
    throw new HTTPException(429, {
      message: "Too many open event streams for this workspace. Close one and try again.",
    });
  }
  return release;
}

export function jobRoutes(runtime: EventsRuntime | undefined) {
  return new Hono<AppEnv>()
    .post(
      "/jobs/ping",
      requireJsonBody(),
      zValidator("json", PingPayloadSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c);
        const rt = requireRuntime(runtime);
        const body = c.req.valid("json");
        const jobId = await enqueue(rt.jobs, "ping", body, { workspaceId });
        if (jobId === null) {
          throw new HTTPException(409, { message: "An identical job is already queued." });
        }
        return c.json({ jobId }, 202);
      },
    )
    .post(
      "/jobs/ai-ping",
      requireJsonBody(),
      zValidator("json", AiPingPayloadSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c);
        const rt = requireRuntime(runtime);
        const body = c.req.valid("json");
        const jobId = await enqueue(rt.jobs, "ai.ping", body, { workspaceId });
        if (jobId === null) {
          throw new HTTPException(409, { message: "An identical job is already queued." });
        }
        return c.json({ jobId }, 202);
      },
    )
    .post("/jobs/:id/cancel", zValidator("param", jobParam, validationHook), async (c) => {
      const workspaceId = getWorkspaceId(c);
      const rt = requireRuntime(runtime);
      const { id } = c.req.valid("param");
      await assertJobInWorkspace(rt, workspaceId, id);
      const result = await cancel(rt.jobs, id);
      return c.json({ status: result.status }, 202);
    })
    .get("/jobs/:id/events", zValidator("param", jobParam, validationHook), async (c) => {
      const workspaceId = getWorkspaceId(c);
      const rt = requireRuntime(runtime);
      const { id } = c.req.valid("param");
      await assertJobInWorkspace(rt, workspaceId, id);
      const release = acquireStreamOr429(rt, workspaceId);
      return streamJobEvents(c, rt, {
        workspaceId,
        jobId: id,
        lastEventId: parseLastEventId(c.req.header("Last-Event-ID")),
        closeOnTerminal: true,
        onClose: release,
      });
    });
}
