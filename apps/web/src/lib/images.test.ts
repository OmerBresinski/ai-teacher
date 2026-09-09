import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { SearchError } from "@tj/editor/images";
import { env } from "@/env";
import { imageSearchClient } from "@/lib/images";
import { installFakeApi } from "@/test/fake-api";

const { fakeApi, restore } = installFakeApi();
afterAll(restore);
beforeEach(() => fakeApi.reset());

function lastRequest() {
  return fakeApi.requests[fakeApi.requests.length - 1];
}

describe("imageSearchClient", () => {
  test("search builds the RPC call and maps the page", async () => {
    const page = await imageSearchClient.search("river", { orientation: "landscape", page: 1 });
    const request = lastRequest();
    expect(request?.method).toBe("GET");
    expect(request?.path).toBe("/images/search");
    expect(request?.query.get("q")).toBe("river");
    expect(request?.query.get("orientation")).toBe("landscape");
    expect(request?.query.get("page")).toBe("1");
    expect(page.nextPage).toBe(2);
    expect(page.photos.map((p) => p.id)).toEqual(["1", "2"]);
    expect(page.photos[0]?.src.tiny).toContain("tiny.jpeg");
  });

  test("a blocked search carries the flag through", async () => {
    fakeApi.failNext(
      (request) => request.path === "/images/search",
      () =>
        new Response(JSON.stringify({ photos: [], nextPage: null, blocked: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const page = await imageSearchClient.search("gore", {});
    expect(page.photos).toEqual([]);
    expect(page.blocked).toBe(true);
  });

  test("a 429 search becomes SearchError with the status", async () => {
    fakeApi.failNext(
      (request) => request.path === "/images/search",
      () =>
        new Response(JSON.stringify({ error: { code: "rate_limited", message: "Slow." } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    const error = await imageSearchClient.search("river", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as SearchError).status).toBe(429);
  });

  test("pick posts the id and prefixes the relative url", async () => {
    const photo = fakeApi.photoFixture("7");
    const picked = await imageSearchClient.pick(photo, "slide");
    const request = lastRequest();
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/images/pick");
    expect(request?.body).toEqual({ provider: "pexels", id: "7", target: "slide" });
    expect(picked.url).toBe(
      `${env.VITE_API_URL}/files/00000000-0000-4000-8000-000000000001/images/7.jpg`,
    );
    expect(picked.width).toBe(6000);
    expect(picked.source).toEqual({
      provider: "pexels",
      id: "7",
      pageUrl: "https://www.pexels.com/photo/7/",
      photographer: "Ada",
      photographerUrl: "https://www.pexels.com/@ada/",
    });
  });

  test("report posts the enums and resolves on 204", async () => {
    await imageSearchClient.report({
      photo: { provider: "pexels", id: "9" },
      reason: "unsuitable",
      context: "search",
    });
    const request = lastRequest();
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/images/report");
    expect(request?.body).toEqual({
      provider: "pexels",
      id: "9",
      reason: "unsuitable",
      context: "search",
    });
  });

  test("a failed report becomes SearchError", async () => {
    fakeApi.failNext(
      (request) => request.path === "/images/report",
      () =>
        new Response(JSON.stringify({ error: { code: "http_error", message: "Nope." } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const error = await imageSearchClient
      .report({
        photo: { provider: "pexels", id: "9" },
        reason: "other",
        context: "placed",
        lessonId: "l1",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as SearchError).status).toBe(500);
  });

  test("a 503 pick becomes SearchError with the status", async () => {
    fakeApi.failNext(
      (request) => request.path === "/images/pick",
      () =>
        new Response(JSON.stringify({ error: { code: "service_unavailable", message: "Down." } }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    const error = await imageSearchClient
      .pick(fakeApi.photoFixture("7"), "slide")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as SearchError).status).toBe(503);
  });
});
