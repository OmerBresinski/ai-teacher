import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ESTIMATE_HISTORY_FIXTURE } from "@/lib/generation-estimate.fixture";
import { estimatesUrl, useGenerationEstimates } from "./use-generation-estimates";

const realFetch = globalThis.fetch;
const calls: string[] = [];

function answerWith(status: number, body: unknown) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls.length = 0;
});

describe("useGenerationEstimates", () => {
  test("builds the endpoint URL from the job name and slide count", () => {
    expect(estimatesUrl("/api", "lesson.plan", 8)).toBe(
      "/api/jobs/estimates?name=lesson.plan&slides=8",
    );
    expect(estimatesUrl("http://api.test/", "lesson.plan", 12)).toBe(
      "http://api.test/jobs/estimates?name=lesson.plan&slides=12",
    );
  });

  test("returns the parsed history from a 200", async () => {
    answerWith(200, ESTIMATE_HISTORY_FIXTURE);
    const { result } = renderHook(() => useGenerationEstimates("lesson.plan", 8), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.history).toEqual(ESTIMATE_HISTORY_FIXTURE);
    expect(calls).toEqual(["/api/jobs/estimates?name=lesson.plan&slides=8"]);
  });

  test("a 404 (the endpoint is not there yet) resolves to no history in the app", async () => {
    answerWith(404, { error: { code: "not_found", message: "No such route." } });
    const { result } = renderHook(() => useGenerationEstimates("lesson.plan", 8), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.history).toBeNull();
  });

  test("a 404 resolves to the fallback when one is given (the kit and tests)", async () => {
    answerWith(404, {});
    const { result } = renderHook(
      () => useGenerationEstimates("lesson.plan", 8, { fallback: ESTIMATE_HISTORY_FIXTURE }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.history).toBe(ESTIMATE_HISTORY_FIXTURE);
  });

  test("a body the schema does not know is treated as no history", async () => {
    answerWith(200, { runs: "many" });
    const { result } = renderHook(() => useGenerationEstimates("lesson.plan", 8), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.history).toBeNull();
  });
});
