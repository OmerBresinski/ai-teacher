import { describe, expect, mock, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import pino from "pino";
import type { WorkerDeps } from "../deps";

// `clearGenerating` is mocked at the module boundary so the handler is tested without a
// database; `packages/db/src/documents.test.ts` covers the UPDATE itself.
const clearGenerating = mock(async (_ws: unknown, _lessonId: string, _jobId: string) => {});
mock.module("@tj/db", () => ({
  clearGenerating,
  forWorkspace: (db: unknown, workspaceId: string) => ({ db, workspaceId }),
}));

const { lessonPlanJob } = await import("./lesson-plan");

const ids = {
  jobId: "0192f7a0-0000-7000-8000-000000000001",
  workspaceId: "0192f7a0-0000-7000-8000-000000000002",
  lessonId: "0192f7a0-0000-7000-8000-000000000003",
};

function ctx(options: { ac?: AbortController; progress?: () => Promise<void> } = {}) {
  const ac = options.ac ?? new AbortController();
  const calls: Array<[number | undefined, string | undefined]> = [];
  const deps = { ai: createFakeAi(), db: { marker: "fake-db" } } as unknown as WorkerDeps;
  return {
    calls,
    deps,
    ctx: {
      jobId: ids.jobId,
      workspaceId: ids.workspaceId,
      payload: { lessonId: ids.lessonId },
      signal: ac.signal,
      progress:
        options.progress ??
        (async (percent?: number, message?: string) => {
          calls.push([percent, message]);
        }),
      logger: pino({ level: "silent" }),
      deps,
    } as unknown as Parameters<typeof lessonPlanJob>[0],
  };
}

describe("lesson.plan job (stub)", () => {
  test("reports one content-free progress line and releases the lock", async () => {
    clearGenerating.mockClear();
    const h = ctx();

    await lessonPlanJob(h.ctx);

    expect(h.calls).toEqual([[100, "planned (stub)"]]);
    expect(clearGenerating).toHaveBeenCalledTimes(1);
    expect(clearGenerating).toHaveBeenCalledWith(
      { db: h.deps.db, workspaceId: ids.workspaceId },
      ids.lessonId,
      ids.jobId,
    );
  });

  test("still releases the lock when progress throws, and rethrows", async () => {
    clearGenerating.mockClear();
    const h = ctx({
      progress: async () => {
        throw new Error("event store down");
      },
    });

    await expect(lessonPlanJob(h.ctx)).rejects.toThrow("event store down");
    expect(clearGenerating).toHaveBeenCalledTimes(1);
  });

  test("does nothing but release the lock when already aborted", async () => {
    clearGenerating.mockClear();
    const ac = new AbortController();
    ac.abort("cancelled");
    const h = ctx({ ac });

    await lessonPlanJob(h.ctx);

    expect(h.calls).toEqual([]);
    expect(clearGenerating).toHaveBeenCalledTimes(1);
    expect(clearGenerating.mock.calls[0]?.[1]).toBe(ids.lessonId);
    expect(clearGenerating.mock.calls[0]?.[2]).toBe(ids.jobId);
  });
});
