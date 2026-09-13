/**
 * Diagnostic job routes — `POST /jobs/ping` and `POST /jobs/ai-ping` (TEACH-19's SSE demo).
 * Development and test only (TEACH-81, audit F05): `ai-ping` enqueues a real Bedrock call outside
 * the Lesson screening/budget path, and `ping` accepts a message no one reads.
 *
 * The router is always chained into the app so `AppType` keeps `api.jobs.ping` / `api.jobs["ai-ping"]`
 * (the dev page type-checks against it); in production `devJobsNotFound` is registered on the two
 * exact paths **before** the `/jobs/*` CSRF + session guards, so an unauthenticated request gets
 * the plain `404 not_found` envelope, not a `401` that advertises the route.
 */
import { zValidator } from "@hono/zod-validator";
import { AiPingPayloadSchema, PingPayloadSchema } from "@tj/domain";
import { enqueue } from "@tj/jobs";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { smallJsonBodyLimit } from "../body-limits";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { envelope } from "../errors";
import type { EventsRuntime } from "../events/runtime";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";
import { requireRuntime } from "./jobs";

/** The two paths, exact, for the guard bypass in `app.ts`. */
export const DEV_JOB_PATHS = ["/jobs/ping", "/jobs/ai-ping"] as const;

/**
 * Anything but `NODE_ENV=production`. Not `testRoutesEnabled` (that is `test` + `ENABLE_TEST_ROUTES`
 * and is false in local development, where the SSE demo must keep working), and not an
 * overridable flag: there is no production use for these routes.
 */
export function devJobRoutesEnabled(env: Pick<Env, "NODE_ENV">): boolean {
  return env.NODE_ENV !== "production";
}

/** Answers the app's standard not-found envelope without calling `next()`. */
export const devJobsNotFound: MiddlewareHandler<AppEnv> = (c) =>
  Promise.resolve(c.json(envelope(c, "not_found", "That resource does not exist.", false), 404));

export function devJobRoutes(runtime: EventsRuntime | undefined) {
  return new Hono<AppEnv>()
    .post(
      "/jobs/ping",
      smallJsonBodyLimit(),
      requireJsonBody(),
      zValidator("json", PingPayloadSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
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
      smallJsonBodyLimit(),
      requireJsonBody(),
      zValidator("json", AiPingPayloadSchema, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const rt = requireRuntime(runtime);
        const body = c.req.valid("json");
        const jobId = await enqueue(rt.jobs, "ai.ping", body, { workspaceId });
        if (jobId === null) {
          throw new HTTPException(409, { message: "An identical job is already queued." });
        }
        return c.json({ jobId }, 202);
      },
    );
}
