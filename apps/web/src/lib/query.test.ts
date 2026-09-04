import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, meQueryOptions, queryKeys } from "./query";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("meQueryOptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the shared key", () => {
    expect(meQueryOptions.queryKey).toEqual(queryKeys.me);
    expect(queryKeys.job("x")).toEqual(["job", "x"]);
  });

  it("resolves the body on 200", async () => {
    const me = { user: { id: "u1", email: "ada@example.com", name: "Ada" }, workspaceId: "w1" };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, me));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(client.fetchQuery(meQueryOptions)).resolves.toEqual(me);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("/api/me");
    expect(init.credentials).toBe("include");
  });

  it("maps 401 to null instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(401, {
          error: { code: "unauthorized", message: "You need to sign in.", retryable: false },
        }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await expect(client.fetchQuery(meQueryOptions)).resolves.toBeNull();
  });

  it("throws an ApiError carrying the envelope for other failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: {
            code: "service_unavailable",
            message: "The service is temporarily unavailable.",
            requestId: "r1",
            retryable: true,
          },
        }),
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const err = await client.fetchQuery(meQueryOptions).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiError = err as ApiError;
    expect(apiError.message).toBe("The service is temporarily unavailable.");
    expect(apiError.code).toBe("service_unavailable");
    expect(apiError.retryable).toBe(true);
    expect(apiError.status).toBe(503);
    expect(apiError.requestId).toBe("r1");
  });

  it("tolerates a non-JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 502 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const err = (await client.fetchQuery(meQueryOptions).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Something went wrong talking to the server.");
    expect(err.retryable).toBe(true);
  });
});
