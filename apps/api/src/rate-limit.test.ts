import { describe, expect, test } from "bun:test";
import { createRateLimiter, loadRateLimitConfig } from "./rate-limit";

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
