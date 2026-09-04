/**
 * Per-process request limit for model-call routes. The api has one Railway replica today; use a
 * shared store (Postgres or Redis) before scaling out so the limit remains per Workspace.
 */
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "./context";
import { getWorkspaceId } from "./workspace";

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Consume one unit for `key`. */
  take(
    key: string,
    now?: number,
  ): { ok: true; remaining: number } | { ok: false; retryAfterMs: number };
  /** Tests: current count for a key in the open window. */
  count(key: string, now?: number): number;
  /** Tests: stored keys after expired buckets are pruned. */
  size(): number;
}

export const RateLimitConfigSchema = z.object({
  AI_RATE_LIMIT_PER_WORKSPACE: z.coerce.number().int().positive().default(10),
  AI_RATE_LIMIT_WINDOW_S: z.coerce.number().int().positive().default(60),
});

export function loadRateLimitConfig(
  source: Record<string, string | undefined> = process.env,
  overrides: Partial<RateLimitConfig> = {},
): RateLimitConfig {
  const parsed = RateLimitConfigSchema.parse(source);
  return {
    limit: parsed.AI_RATE_LIMIT_PER_WORKSPACE,
    windowMs: parsed.AI_RATE_LIMIT_WINDOW_S * 1_000,
    ...overrides,
  };
}

export function createRateLimiter({ limit, windowMs }: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function prune(now: number) {
    if (buckets.size <= 1_000) return;
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  return {
    take(key, now = Date.now()) {
      prune(now);
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }

      if (bucket.count >= limit) {
        return { ok: false, retryAfterMs: bucket.resetAt - now };
      }

      bucket.count += 1;
      return { ok: true, remaining: limit - bucket.count };
    },
    count(key, now = Date.now()) {
      // Read-only: expired buckets read as 0 and are removed only by `prune()` in `take()`.
      const bucket = buckets.get(key);
      return !bucket || now >= bucket.resetAt ? 0 : bucket.count;
    },
    size: () => buckets.size,
  };
}

export function rateLimitByWorkspace(limiter: RateLimiter): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const result = limiter.take(getWorkspaceId(c, { allowHeaderShim: false }));
    if (!result.ok) {
      c.header("Retry-After", String(Math.ceil(result.retryAfterMs / 1_000)));
      throw new HTTPException(429, {
        message: "Too many AI requests for this workspace. Try again in a moment.",
      });
    }
    await next();
  };
}
