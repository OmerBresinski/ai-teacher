import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { Hono } from "hono";
import type { AppEnv } from "./context";
import {
  createRateLimiter,
  loadImageRateLimitConfig,
  loadRateLimitConfig,
  type RateLimiter,
  rateLimitByWorkspace,
} from "./rate-limit";
import { IMAGE_RATE_LIMIT_MESSAGE } from "./routes/images";

describe("createRateLimiter", () => {
  test("resets a fixed window and reports the retry delay", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });

    expect(limiter.take("A", 0)).toEqual({ ok: true, remaining: 0 });
    expect(limiter.take("A", 500)).toEqual({ ok: false, retryAfterMs: 500 });
    expect(limiter.take("A", 1_000)).toEqual({ ok: true, remaining: 0 });
  });

  test("prunes expired buckets after the map grows beyond 1,000 keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    for (let index = 0; index < 1_001; index += 1) limiter.take(`workspace-${index}`, 0);

    limiter.take("current", 10_000);

    expect(limiter.count("workspace-0", 10_000)).toBe(0);
    expect(limiter.size()).toBe(1);
  });
});

describe("loadRateLimitConfig", () => {
  test("uses defaults and accepts configured values", () => {
    expect(loadRateLimitConfig({})).toEqual({ limit: 10, windowMs: 60_000 });
    expect(
      loadRateLimitConfig({ AI_RATE_LIMIT_PER_WORKSPACE: "3", AI_RATE_LIMIT_WINDOW_S: "5" }),
    ).toEqual({ limit: 3, windowMs: 5_000 });
  });

  test("rejects non-positive values", () => {
    expect(() => loadRateLimitConfig({ AI_RATE_LIMIT_PER_WORKSPACE: "0" })).toThrow();
    expect(() => loadRateLimitConfig({ AI_RATE_LIMIT_WINDOW_S: "0" })).toThrow();
  });
});

describe("loadImageRateLimitConfig", () => {
  test("reads the IMAGE_* keys with their own defaults", () => {
    expect(loadImageRateLimitConfig({})).toEqual({ limit: 30, windowMs: 60_000 });
    expect(
      loadImageRateLimitConfig({
        IMAGE_RATE_LIMIT_PER_WORKSPACE: "5",
        IMAGE_RATE_LIMIT_WINDOW_S: "7",
      }),
    ).toEqual({ limit: 5, windowMs: 7_000 });
  });
});

describe("rateLimitByWorkspace message", () => {
  const ws = newId<WorkspaceId>();

  function limitedApp(limiter: RateLimiter, message?: string) {
    const app = new Hono<AppEnv>();
    app.use("/x", async (c, next) => {
      c.set("workspaceId", ws);
      await next();
    });
    app.use(
      "/x",
      message === undefined
        ? rateLimitByWorkspace(limiter)
        : rateLimitByWorkspace(limiter, message),
    );
    app.get("/x", (c) => c.text("ok"));
    return app;
  }

  test("defaults to the AI message", async () => {
    const app = limitedApp(createRateLimiter({ limit: 0, windowMs: 60_000 }));
    const res = await app.request("/x");
    expect(res.status).toBe(429);
    expect(await res.text()).toBe(
      "Too many AI requests for this workspace. Try again in a moment.",
    );
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  test("accepts an override, e.g. the photo-search message", async () => {
    const app = limitedApp(
      createRateLimiter({ limit: 0, windowMs: 60_000 }),
      IMAGE_RATE_LIMIT_MESSAGE,
    );
    const res = await app.request("/x");
    expect(res.status).toBe(429);
    expect(await res.text()).toBe(IMAGE_RATE_LIMIT_MESSAGE);
  });
});
