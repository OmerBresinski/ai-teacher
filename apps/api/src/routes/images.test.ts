/**
 * `GET /images/search` against a hand-written fake `PexelsClient` (Images project): mapping,
 * cache, validation, upstream failures, the missing-key 503, the per-Workspace limiter and the
 * guards. Each success-path test uses its own query: the route cache is module-level.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, type WorkspaceId } from "@tj/domain";
import { PhotoSourceSchema } from "@tj/domain/documents";
import { type PexelsClient, PexelsError, type PhotoResult, type PhotoSearchPage } from "@tj/images";
import { LocalDiskStorage } from "@tj/storage";
import { createApp } from "../app";
import type { RateLimitConfig } from "../rate-limit";
import { captureLogger, fakeSql, silentLogger, TEST_ENV } from "../test-helpers";
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
  photoCalls: string[];
  photoResult: PhotoResult | null;
}

function makeFake(): { client: PexelsClient; state: FakeState } {
  const state: FakeState = { calls: [], error: null, photoCalls: [], photoResult: null };
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
    async photo(id: string) {
      state.photoCalls.push(id);
      return state.photoResult;
    },
  };
  return { client, state };
}

function appWith(
  client: PexelsClient | undefined,
  imageRateLimit?: Partial<RateLimitConfig>,
  storage?: LocalDiskStorage,
  logger = silentLogger,
) {
  return createApp({
    env: TEST_ENV,
    db: fakeSql(true),
    logger,
    images: client,
    imageRateLimit,
    storage,
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
    expect("blocked" in body).toBe(false);
  });

  test("a blocklisted query answers without calling upstream and logs blocked", async () => {
    const { client, state } = makeFake();
    const { logger, lines } = captureLogger();
    const res = await appWith(client, undefined, undefined, logger).request(
      "/images/search?q=%20GORE%20",
      { headers },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ photos: [], nextPage: null, blocked: true });
    expect(state.calls).toHaveLength(0);
    const search = lines.map((line) => JSON.parse(line)).find((l) => l.msg === "image search");
    expect(search?.blocked).toBe(true);
    expect(JSON.stringify(search)).not.toContain("gore");
    expect(JSON.stringify(search)).not.toContain("GORE");
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
      photo: () => Promise.resolve(null),
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
      photo: () => Promise.resolve(null),
    };
    const broken: PexelsClient = {
      search: () => Promise.reject(new TypeError("fetch failed")),
      photo: () => Promise.resolve(null),
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

describe("POST /images/pick", () => {
  const realFetch = globalThis.fetch;
  const roots: string[] = [];
  afterEach(async () => {
    globalThis.fetch = realFetch;
    while (roots.length > 0) await rm(roots.pop() as string, { recursive: true, force: true });
  });

  function cdnFetch(
    entries: Record<string, { bytes: Uint8Array; contentType: string; length?: number }>,
  ) {
    const seen: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      seen.push(url);
      const key = Object.keys(entries).find((k) => url.includes(k));
      if (key === undefined) return new Response("no", { status: 404 });
      const entry = entries[key] as { bytes: Uint8Array; contentType: string; length?: number };
      const headers: Record<string, string> = { "content-type": entry.contentType };
      if (entry.length !== undefined) headers["content-length"] = String(entry.length);
      return new Response(entry.bytes, { status: 200, headers });
    }) as typeof globalThis.fetch;
    return { fetch, seen };
  }

  async function pickSetup(logger = silentLogger) {
    const root = await mkdtemp(join(tmpdir(), "tj-api-pick-"));
    roots.push(root);
    const storage = new LocalDiskStorage(root);
    const { client, state } = makeFake();
    const app = appWith(client, undefined, storage, logger);
    return { app, root, storage, state };
  }

  function pickedLine(lines: string[]) {
    return lines.map((line) => JSON.parse(line)).find((l) => l.msg === "image picked");
  }

  function pick(
    app: ReturnType<typeof appWith>,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    return app.request("/images/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json", [WORKSPACE_HEADER]: ws, ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  test("a slide pick stores the large rendition and streams it back", async () => {
    const { app, state } = await pickSetup();
    state.photoResult = photo("1");
    const bytes = new Uint8Array(300 * 1024).fill(9);
    const { fetch } = cdnFetch({
      large: { bytes, contentType: "image/jpeg", length: bytes.length },
    });
    globalThis.fetch = fetch;
    const res = await pick(app, { provider: "pexels", id: "1", target: "slide" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      key: string;
      url: string;
      width: number;
      height: number;
      contentType: string;
      source: unknown;
    };
    expect(body.key).toMatch(new RegExp(`^${ws}/images/.+\\.jpg$`));
    expect(body.url).toBe(`/files/${body.key}`);
    expect(body.width).toBe(6000);
    expect(body.height).toBe(4000);
    expect(body.contentType).toBe("image/jpeg");
    expect(PhotoSourceSchema.parse(body.source)).toEqual({
      provider: "pexels",
      id: "1",
      pageUrl: "https://www.pexels.com/photo/1/",
      photographer: "Ada",
      photographerUrl: "https://www.pexels.com/@ada/",
    });
    const file = await app.request(body.url, { headers });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  test("telemetry fields land on the image picked line", async () => {
    const { app, state } = await pickSetup();
    state.photoResult = photo("1");
    const { fetch } = cdnFetch({
      large: { bytes: new Uint8Array([1]), contentType: "image/jpeg" },
    });
    globalThis.fetch = fetch;
    const plain = await pick(app, { provider: "pexels", id: "1", target: "slide" });
    expect(plain.status).toBe(201);
    // Without the fields the line carries explicit nulls (pino would drop undefined).
    const { logger, lines } = captureLogger();
    const logged = await pickSetup(logger);
    logged.state.photoResult = photo("1");
    globalThis.fetch = fetch;
    const res = await pick(logged.app, {
      provider: "pexels",
      id: "1",
      target: "slide",
      replaces: "ai",
      msSinceOpen: 4200,
    });
    expect(res.status).toBe(201);
    const line = pickedLine(lines);
    expect(line?.replaced).toBe("ai");
    expect(line?.ms_since_open).toBe(4200);
    expect(line?.bytes).toBe(1);
  });

  test("a pick without telemetry logs nulls", async () => {
    const { logger, lines } = captureLogger();
    const { app, state } = await pickSetup(logger);
    state.photoResult = photo("2");
    const { fetch } = cdnFetch({
      large: { bytes: new Uint8Array([1]), contentType: "image/jpeg" },
    });
    globalThis.fetch = fetch;
    const res = await pick(app, { provider: "pexels", id: "2", target: "slide" });
    expect(res.status).toBe(201);
    const line = pickedLine(lines);
    expect(line?.replaced).toBeNull();
    expect(line?.ms_since_open).toBeNull();
  });

  test("out-of-range telemetry is a validation failure", async () => {
    const { app } = await pickSetup();
    for (const body of [
      { provider: "pexels", id: "1", target: "slide", msSinceOpen: -1 },
      { provider: "pexels", id: "1", target: "slide", msSinceOpen: 3_600_001 },
      { provider: "pexels", id: "1", target: "slide", msSinceOpen: "fast" },
    ]) {
      const res = await pick(app, body);
      expect(res.status).toBe(400);
      expect((await errorBody(res)).error.code).toBe("validation_failed");
    }
  });

  test("a worksheet pick fetches medium, never original", async () => {
    const { app, state } = await pickSetup();
    state.photoResult = photo("2");
    const { fetch, seen } = cdnFetch({
      medium: { bytes: new Uint8Array([1]), contentType: "image/jpeg" },
    });
    globalThis.fetch = fetch;
    const res = await pick(app, { provider: "pexels", id: "2", target: "worksheet" });
    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("medium");
    expect(seen[0]).not.toContain("original");
  });

  test("a photo that is gone is 404", async () => {
    const { app, state } = await pickSetup();
    state.photoResult = null;
    const res = await pick(app, { provider: "pexels", id: "404", target: "slide" });
    expect(res.status).toBe(404);
    expect((await errorBody(res)).error.code).toBe("not_found");
    expect(state.photoCalls).toEqual(["404"]);
  });

  test("an over-cap download and a non-image are 422 with nothing stored", async () => {
    for (const entry of [
      { bytes: new Uint8Array([1]), contentType: "image/jpeg", length: 9_000_000 },
      { bytes: new Uint8Array([1, 2, 3]), contentType: "text/html" },
    ] as const) {
      const { app, root, state } = await pickSetup();
      state.photoResult = photo("3");
      const { fetch } = cdnFetch({ large: entry });
      globalThis.fetch = fetch;
      const res = await pick(app, { provider: "pexels", id: "3", target: "slide" });
      expect(res.status).toBe(422);
      expect((await errorBody(res)).error.code).toBe("unprocessable");
      expect(await readdir(root)).toEqual([]);
    }
  });

  test("a failed download is 503", async () => {
    const { app, state } = await pickSetup();
    state.photoResult = photo("4");
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("down"))) as unknown as typeof globalThis.fetch;
    const res = await pick(app, { provider: "pexels", id: "4", target: "slide" });
    expect(res.status).toBe(503);
    expect((await errorBody(res)).error.code).toBe("service_unavailable");
  });

  test("bad provider, missing target and non-JSON bodies are 400", async () => {
    const { app, state } = await pickSetup();
    state.photoResult = photo("5");
    const bad = await pick(app, { provider: "other", id: "5", target: "slide" });
    expect(bad.status).toBe(400);
    expect((await errorBody(bad)).error.code).toBe("validation_failed");
    const missing = await pick(app, { provider: "pexels", id: "5" });
    expect(missing.status).toBe(400);
    const plain = await app.request("/images/pick", {
      method: "POST",
      headers: { "Content-Type": "text/plain", [WORKSPACE_HEADER]: ws },
      body: "{}",
    });
    expect(plain.status).toBe(400);
  });

  test("no storage or no client is 503", async () => {
    const { client } = makeFake();
    const storageless = await appWith(client).request("/images/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json", [WORKSPACE_HEADER]: ws },
      body: JSON.stringify({ provider: "pexels", id: "6", target: "slide" }),
    });
    expect(storageless.status).toBe(503);
    const root = await mkdtemp(join(tmpdir(), "tj-api-pick-"));
    roots.push(root);
    const clientless = await appWith(undefined, undefined, new LocalDiskStorage(root)).request(
      "/images/pick",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", [WORKSPACE_HEADER]: ws },
        body: JSON.stringify({ provider: "pexels", id: "6", target: "slide" }),
      },
    );
    expect(clientless.status).toBe(503);
  });

  test("foreign Origin is 403 before photo() is called", async () => {
    const { app, state } = await pickSetup();
    const res = await app.request("/images/pick", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        [WORKSPACE_HEADER]: ws,
      },
      body: JSON.stringify({ provider: "pexels", id: "7", target: "slide" }),
    });
    expect(res.status).toBe(403);
    expect(state.photoCalls).toHaveLength(0);
  });
});

describe("POST /images/report", () => {
  const report = { provider: "pexels", id: "9", reason: "unsuitable", context: "search" };

  function reportApp(logger = silentLogger) {
    const { client } = makeFake();
    return appWith(client, undefined, undefined, logger);
  }

  function postReport(
    app: ReturnType<typeof appWith>,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    return app.request("/images/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", [WORKSPACE_HEADER]: ws, ...extraHeaders },
      body: JSON.stringify(body),
    });
  }

  test("logs one warn line with ids and enums and answers 204", async () => {
    const { logger, lines } = captureLogger();
    const res = await postReport(reportApp(logger), {
      ...report,
      lessonId: "0192f7a0-0000-7000-8000-000000000042",
    });
    expect(res.status).toBe(204);
    const reported = lines.map((line) => JSON.parse(line)).find((l) => l.msg === "image reported");
    expect(reported?.level).toBe(40);
    expect(reported?.provider).toBe("pexels");
    expect(reported?.photoId).toBe("9");
    expect(reported?.reason).toBe("unsuitable");
    expect(reported?.context).toBe("search");
    expect(reported?.lessonId).toBe("0192f7a0-0000-7000-8000-000000000042");
    expect(reported?.workspaceId).toBe(ws);
    const text = JSON.stringify(reported);
    expect(text).not.toContain("Ada");
    expect(text).not.toContain("river");
  });

  test("bad reason and non-JSON bodies are 400", async () => {
    const app = reportApp();
    const bad = await postReport(app, { ...report, reason: "meh" });
    expect(bad.status).toBe(400);
    expect((await errorBody(bad)).error.code).toBe("validation_failed");
    const plain = await app.request("/images/report", {
      method: "POST",
      headers: { "Content-Type": "text/plain", [WORKSPACE_HEADER]: ws },
      body: "{}",
    });
    expect(plain.status).toBe(400);
  });

  test("foreign Origin is 403 and no session is 401", async () => {
    const app = reportApp();
    const evil = await postReport(app, report, { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const anon = await app.request("/images/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    expect(anon.status).toBe(401);
  });
});
