/**
 * `GET /images/search` against a hand-written fake `PexelsClient` (Images project): mapping,
 * cache, validation, upstream failures, the missing-key 503, the per-Workspace limiter and the
 * guards. Each success-path test uses its own query: the route cache is module-level.
 */

import { describe, expect, test } from "bun:test";
import { newId, type WorkspaceId } from "@tj/domain";
import { type PexelsClient, PexelsError, type PhotoSearchPage } from "@tj/images";
import { createApp } from "../app";
import type { RateLimitConfig } from "../rate-limit";
import { fakeSql, silentLogger, TEST_ENV } from "../test-helpers";
import { WORKSPACE_HEADER } from "../workspace";
import { IMAGE_RATE_LIMIT_MESSAGE } from "./images";

const ws = newId<WorkspaceId>();

function photo(id: string) {
  return {
    id,
    width: 6000,
    height: 4000,
    alt: `Photo ${id}`,
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada/",
    pageUrl: `https://www.pexels.com/photo/${id}/`,
    src: {
      large: `https://images.pexels.com/photos/${id}/large.jpeg`,
      medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
      tiny: `https://images.pexels.com/photos/${id}/tiny.jpeg`,
    },
  };
}

interface FakeState {
  calls: { query: string; orientation?: string; page?: number; perPage?: number }[];
  error: unknown;
}

function makeFake(): { client: PexelsClient; state: FakeState } {
  const state: FakeState = { calls: [], error: null };
  const client: PexelsClient = {
    async search(params): Promise<PhotoSearchPage> {
      state.calls.push({
        query: params.query,
        orientation: params.orientation,
        page: params.page,
        perPage: params.perPage,
      });
      if (state.error !== null) throw state.error;
      return { photos: [photo("1"), photo("2")], nextPage: 2 };
    },
  };
  return { client, state };
}

function appWith(client: PexelsClient | undefined, imageRateLimit?: Partial<RateLimitConfig>) {
  return createApp({
    env: TEST_ENV,
    db: fakeSql(true),
    logger: silentLogger,
    images: client,
    imageRateLimit,
  });
}

const headers = { [WORKSPACE_HEADER]: ws };

async function errorBody(res: Response) {
  return (await res.json()) as {
    error: { code: string; message: string; retryable: boolean; fields?: string[] };
  };
}

describe("GET /images/search", () => {
  test("returns mapped photos with string ids", async () => {
    const { client, state } = makeFake();
    const res = await appWith(client).request(
      "/images/search?q=river&orientation=landscape&page=1",
      {
        headers,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotoSearchPage;
    expect(body.nextPage).toBe(2);
    expect(body.photos).toHaveLength(2);
    expect(body.photos[0]?.id).toBe("1");
    expect(typeof body.photos[0]?.id).toBe("string");
    expect(body.photos[0]?.src).toEqual({
      large: "https://images.pexels.com/photos/1/large.jpeg",
      medium: "https://images.pexels.com/photos/1/medium.jpeg",
      tiny: "https://images.pexels.com/photos/1/tiny.jpeg",
    });
    expect(state.calls).toEqual([
      { query: "river", orientation: "landscape", page: 1, perPage: 24 },
    ]);
  });

  test("the same query twice costs one upstream call", async () => {
    const { client, state } = makeFake();
    const app = appWith(client);
    const first = await app.request("/images/search?q=brook", { headers });
    const second = await app.request("/images/search?q=brook", { headers });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.calls).toHaveLength(1);
    expect(await second.json()).toEqual(await first.json());
  });

  test("evicts the oldest entry when every entry is still live", async () => {
    const { client, state } = makeFake();
    const app = appWith(client, { limit: 10_000, windowMs: 60_000 });
    for (let index = 0; index < 500; index += 1) {
      const res = await app.request(`/images/search?q=evict-${index}`, { headers });
      expect(res.status).toBe(200);
    }
    expect(state.calls).toHaveLength(500);
    expect((await app.request("/images/search?q=evict-500", { headers })).status).toBe(200);
    expect(state.calls).toHaveLength(501);
    expect((await app.request("/images/search?q=evict-0", { headers })).status).toBe(200);
    expect(state.calls).toHaveLength(502);
  });

  test("short, missing and out-of-range inputs are validation failures", async () => {
    const { client } = makeFake();
    const app = appWith(client);
    for (const path of [
      "/images/search?q=r",
      "/images/search",
      "/images/search?q=cedar&page=0",
      "/images/search?q=elm&orientation=wide",
    ]) {
      const res = await app.request(path, { headers });
      expect(res.status).toBe(400);
      expect((await errorBody(res)).error.code).toBe("validation_failed");
    }
    expect(
      (await errorBody(await app.request("/images/search?q=r", { headers }))).error.fields,
    ).toEqual(["q"]);
    expect(
      (await errorBody(await app.request("/images/search?q=cedar&page=0", { headers }))).error
        .fields,
    ).toEqual(["page"]);
    expect(
      (await errorBody(await app.request("/images/search?q=elm&orientation=wide", { headers })))
        .error.fields,
    ).toEqual(["orientation"]);
  });

  test("an upstream 429 becomes a typed rate limit with Retry-After", async () => {
    const throwing: PexelsClient = {
      search: () =>
        Promise.reject(new PexelsError(429, "Pexels search failed with status 429.", 17)),
    };
    const res = await appWith(throwing).request("/images/search?q=gale", { headers });
    expect(res.status).toBe(429);
    const body = await errorBody(res);
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retryable).toBe(true);
    expect(res.headers.get("Retry-After")).toBe("17");
  });

  test("an upstream 500 or a network failure becomes 503", async () => {
    const failing: PexelsClient = {
      search: () => Promise.reject(new PexelsError(500, "Pexels search failed with status 500.")),
    };
    const broken: PexelsClient = {
      search: () => Promise.reject(new TypeError("fetch failed")),
    };
    for (const [client, q] of [
      [failing, "hail"],
      [broken, "ice"],
    ] as const) {
      const res = await appWith(client).request(`/images/search?q=${q}`, { headers });
      expect(res.status).toBe(503);
      expect((await errorBody(res)).error.code).toBe("service_unavailable");
    }
  });

  test("no client answers 503", async () => {
    const res = await appWith(undefined).request("/images/search?q=jade", { headers });
    expect(res.status).toBe(503);
    expect((await errorBody(res)).error.code).toBe("service_unavailable");
  });

  test("the third search in a small window is limited with the image message", async () => {
    const { client } = makeFake();
    const app = appWith(client, { limit: 2, windowMs: 60_000 });
    expect((await app.request("/images/search?q=kelp", { headers })).status).toBe(200);
    expect((await app.request("/images/search?q=lichen", { headers })).status).toBe(200);
    const res = await app.request("/images/search?q=moss", { headers });
    expect(res.status).toBe(429);
    const body = await errorBody(res);
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toBe(IMAGE_RATE_LIMIT_MESSAGE);
    // The AI limiter is a separate instance: a model-call route is not limited.
    const ping = await app.request("/jobs/ai-ping", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(ping.status).not.toBe(429);
  });

  test("no session is 401", async () => {
    const { client } = makeFake();
    const res = await appWith(client).request("/images/search?q=lotus");
    expect(res.status).toBe(401);
    expect((await errorBody(res)).error.code).toBe("unauthorized");
  });

  test("foreign Origin is 403 before the client is called", async () => {
    const { client, state } = makeFake();
    const res = await appWith(client).request("/images/search?q=nile", {
      headers: { Origin: "https://evil.example", [WORKSPACE_HEADER]: ws },
    });
    expect(res.status).toBe(403);
    expect((await errorBody(res)).error.code).toBe("forbidden");
    expect(state.calls).toHaveLength(0);
  });
});
