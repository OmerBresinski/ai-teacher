/**
 * `GET /images/search` — the Pexels search proxy (Images project, "Search and the API") — plus
 * `POST /images/pick` and the safety pair (TEACH-162): a query blocklist gate on search and a
 * log-only `POST /images/report`.
 *
 * The browser never sees the key: `apps/api` holds a server-only `@tj/images` client, injected
 * here in the factory style of `fileRoutes(storage)` (absent collaborator → `503`). The short
 * in-process cache is keyed by the normalised public query and is therefore cross-Workspace by
 * design: the same public query is the same public answer.
 *
 * Logging (ADR 0015): one `image search` line per search carries the query *length*, never the
 * query text — a search term can name a pupil. `429`s reach the existing `request error` line
 * with `code: "rate_limited"`. Reports log ids and enums only, at `warn`.
 *
 * Image measures: how each project measure is read from these lines is documented in
 * `infra/README.md` ("Image measures").
 */
import { zValidator } from "@hono/zod-validator";
import type { StorageAdapter } from "@tj/domain";
import {
  isBlockedQuery,
  type PexelsClient,
  PexelsError,
  type PhotoResult,
  type PhotoSearchPage,
  StorePhotoError,
  storePhoto,
} from "@tj/images";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../context";
import { type RateLimiter, rateLimitByWorkspace } from "../rate-limit";
import { requireJsonBody, validationHook } from "../validation";
import { getWorkspaceId } from "../workspace";

export const IMAGE_RATE_LIMIT_MESSAGE =
  "Too many photo searches for this workspace. Try again in a moment.";

const SearchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  orientation: z.enum(["landscape", "portrait", "square"]).optional(),
  page: z.coerce.number().int().min(1).max(50).default(1),
});

const IMAGE_SEARCH_CACHE_MS = 5 * 60_000;
const IMAGE_SEARCH_CACHE_MAX = 500;

interface CacheEntry {
  page: PhotoSearchPage;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(q: string, orientation: string | undefined, page: number): string {
  return `${q.toLowerCase().replace(/\s+/g, " ")}|${orientation ?? ""}|${page}`;
}

function readCache(key: string, now: number): PhotoSearchPage | undefined {
  const entry = cache.get(key);
  if (entry === undefined || now >= entry.expiresAt) {
    if (entry !== undefined) cache.delete(key);
    return undefined;
  }
  return entry.page;
}

function writeCache(key: string, page: PhotoSearchPage, now: number): void {
  if (cache.size >= IMAGE_SEARCH_CACHE_MAX) {
    for (const [candidate, entry] of cache) {
      if (now >= entry.expiresAt) cache.delete(candidate);
    }
    // Still full (every entry live): evict the oldest rather than growing without bound.
    // `Map` iterates in insertion order, so the first key is the oldest entry.
    if (cache.size >= IMAGE_SEARCH_CACHE_MAX) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
  }
  cache.set(key, { page, expiresAt: now + IMAGE_SEARCH_CACHE_MS });
}

const PickBody = z.strictObject({
  provider: z.literal("pexels"),
  id: z.string().min(1).max(32),
  target: z.enum(["slide", "worksheet"]),
  /**
   * Telemetry only (TEACH-163): the `authoredBy` of the element being replaced, and ms from
   * panel open to the pick. Neither affects the response; both land on the log line.
   */
  replaces: z.enum(["ai", "teacher"]).optional(),
  msSinceOpen: z.number().int().nonnegative().max(3_600_000).optional(),
});

const ReportBody = z.strictObject({
  provider: z.literal("pexels"),
  id: z.string().min(1).max(32),
  reason: z.enum(["unsuitable", "wrong-subject", "other"]),
  context: z.enum(["search", "placed"]),
  lessonId: z.uuid().optional(),
});

export function imageRoutes(
  images: PexelsClient | undefined,
  limiter: RateLimiter,
  storage: StorageAdapter | undefined,
) {
  return new Hono<AppEnv>()
    .get(
      "/images/search",
      rateLimitByWorkspace(limiter, IMAGE_RATE_LIMIT_MESSAGE),
      zValidator("query", SearchQuery, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        if (!images) {
          throw new HTTPException(503, { message: "Photo search is not available right now." });
        }
        const { q, orientation, page } = c.req.valid("query");
        const logger = c.get("logger");
        const start = performance.now();
        const durationMs = () => Math.round((performance.now() - start) * 100) / 100;
        // Safety (TEACH-162): a blocklisted query never reaches Pexels — or the cache.
        if (isBlockedQuery(q)) {
          logger.info(
            {
              workspace_id: workspaceId,
              q_len: q.length,
              orientation,
              page,
              cached: false,
              blocked: true,
              duration_ms: durationMs(),
            },
            "image search",
          );
          return c.json({ photos: [], nextPage: null, blocked: true }, 200);
        }
        const key = cacheKey(q, orientation, page);
        const now = Date.now();
        const hit = readCache(key, now);
        if (hit !== undefined) {
          logger.info(
            {
              workspace_id: workspaceId,
              q_len: q.length,
              orientation,
              page,
              cached: true,
              duration_ms: durationMs(),
            },
            "image search",
          );
          return c.json(hit, 200);
        }
        try {
          const result = await images.search({ query: q, orientation, page, perPage: 24 });
          writeCache(key, result, now);
          logger.info(
            {
              workspace_id: workspaceId,
              q_len: q.length,
              orientation,
              page,
              cached: false,
              upstream_status: 200,
              duration_ms: durationMs(),
            },
            "image search",
          );
          return c.json(result, 200);
        } catch (error) {
          const upstreamStatus = error instanceof PexelsError ? error.status : undefined;
          logger.info(
            {
              workspace_id: workspaceId,
              q_len: q.length,
              orientation,
              page,
              cached: false,
              ...(upstreamStatus === undefined ? {} : { upstream_status: upstreamStatus }),
              duration_ms: durationMs(),
            },
            "image search",
          );
          if (error instanceof PexelsError && error.status === 429) {
            c.header("Retry-After", String(error.retryAfterS ?? 60));
            throw new HTTPException(429, { message: IMAGE_RATE_LIMIT_MESSAGE });
          }
          throw new HTTPException(503, { message: "Photo search is not available right now." });
        }
      },
    )
    .post(
      "/images/pick",
      rateLimitByWorkspace(limiter, IMAGE_RATE_LIMIT_MESSAGE),
      requireJsonBody(),
      zValidator("json", PickBody, validationHook),
      async (c) => {
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        if (!images || !storage) {
          throw new HTTPException(503, { message: "Photo search is not available right now." });
        }
        const { id, target, replaces, msSinceOpen } = c.req.valid("json");
        const logger = c.get("logger");
        const start = performance.now();
        const durationMs = () => Math.round((performance.now() - start) * 100) / 100;
        let photo: PhotoResult | null;
        try {
          photo = await images.photo(id);
        } catch (error) {
          if (error instanceof PexelsError && error.status === 429) {
            c.header("Retry-After", String(error.retryAfterS ?? 60));
            throw new HTTPException(429, { message: IMAGE_RATE_LIMIT_MESSAGE });
          }
          throw new HTTPException(503, { message: "Photo search is not available right now." });
        }
        if (photo === null) {
          throw new HTTPException(404, { message: "That photo is no longer available." });
        }
        try {
          const stored = await storePhoto({ photo, target, storage, workspaceId });
          logger.info(
            {
              provider: "pexels",
              target,
              bytes: stored.bytes,
              replaced: replaces ?? null,
              ms_since_open: msSinceOpen ?? null,
              duration_ms: durationMs(),
            },
            "image picked",
          );
          return c.json(stored, 201);
        } catch (error) {
          // The StorePhotoError messages are plain sentences fit for the envelope directly.
          if (error instanceof StorePhotoError) {
            if (error.reason === "fetch_failed") {
              throw new HTTPException(503, { message: "Photo search is not available right now." });
            }
            throw new HTTPException(422, { message: error.message });
          }
          throw error;
        }
      },
    )
    .post(
      "/images/report",
      requireJsonBody(),
      zValidator("json", ReportBody, validationHook),
      async (c) => {
        // Deliberately outside the image limiter: a safety report must never 429 because the
        // teacher searched a lot first. Nothing is stored or fetched — one log line.
        const workspaceId = getWorkspaceId(c, { allowHeaderShim: false });
        const { provider, id, reason, context, lessonId } = c.req.valid("json");
        c.get("logger").warn(
          { provider, photoId: id, reason, context, lessonId, workspaceId },
          "image reported",
        );
        return c.body(null, 204);
      },
    );
}
