/**
 * TEACH-81 (audit F05): `POST /jobs/ping` and `POST /jobs/ai-ping` exist only outside production.
 * Pattern: `test-routes.test.ts` (predicate + "not mounted → 404").
 */
import { describe, expect, test } from "bun:test";
import { createApp } from "../app";
import type { Env } from "../env";
import type { ErrorEnvelope } from "../errors";
import { fakeSql, silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import { devJobRoutesEnabled } from "./dev-jobs";

const WS = "0192f7a0-0000-7000-8000-000000000001";

function appWith(nodeEnv: Env["NODE_ENV"]) {
  const enqueued: string[] = [];
  const jobs = {
    boss: {
      send: async (name: string) => {
        enqueued.push(name);
        return "job-id";
      },
    },
  } as unknown as NonNullable<Parameters<typeof createApp>[0]["jobs"]>;
  const app = createApp({
    env: { ...TEST_ENV, NODE_ENV: nodeEnv },
    db: fakeSql(true),
    logger: silentLogger,
    jobs,
  });
  return { app, enqueued };
}

const post = (app: ReturnType<typeof createApp>, path: string, withShim: boolean) =>
  app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(withShim ? { [WORKSPACE_HEADER]: WS } : {}),
    },
    body: JSON.stringify({ message: "hi", steps: 1 }),
  });

describe("devJobRoutesEnabled", () => {
  test("false only in production", () => {
    expect(devJobRoutesEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devJobRoutesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(devJobRoutesEnabled({ NODE_ENV: "test" })).toBe(true);
  });
});

describe("dev job routes", () => {
  test("production: 404 not_found for both paths, unauthenticated, nothing enqueued", async () => {
    const { app, enqueued } = appWith("production");
    for (const path of ["/jobs/ping", "/jobs/ai-ping"]) {
      const res = await post(app, path, false);
      expect(res.status).toBe(404);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error.code).toBe("not_found");
    }
    expect(enqueued).toEqual([]);
  });

  test("production: 404 even with the workspace shim header (the guards never run)", async () => {
    const { app, enqueued } = appWith("production");
    expect((await post(app, "/jobs/ai-ping", true)).status).toBe(404);
    expect(enqueued).toEqual([]);
  });

  test("production: the other /jobs routes still hit the session guard (401)", async () => {
    const { app } = appWith("production");
    const res = await app.request("/jobs/0192f7a0-0000-7000-8000-000000000042/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  test("test/development: 401 without a session; the routes are mounted", async () => {
    for (const env of ["test", "development"] as const) {
      const { app } = appWith(env);
      expect((await post(app, "/jobs/ping", false)).status).toBe(401);
      expect((await post(app, "/jobs/ai-ping", false)).status).toBe(401);
    }
  });
});
