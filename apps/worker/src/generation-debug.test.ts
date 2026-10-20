import { describe, expect, test } from "bun:test";
import type { GenerationDebugInsert } from "@tj/db";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import { capPayload, createDebugRecorder, type DebugStore } from "./generation-debug";

const ids = {
  workspaceId: newId<WorkspaceId>(),
  lessonId: newId<LessonId>(),
  jobId: newId<JobId>(),
  attempt: 1,
};
const silent = () => {
  const warned: string[] = [];
  return { warned, logger: { warn: (_o: unknown, msg?: string) => void warned.push(String(msg)) } };
};

describe("capPayload", () => {
  test("keeps a small payload as a JSON snapshot, not a reference", () => {
    const slide = { heading: "Romans" };
    const stored = capPayload({ slide }) as { slide: { heading: string } };
    slide.heading = "changed later";
    expect(stored.slide.heading).toBe("Romans");
  });

  test("strips NUL characters Postgres jsonb refuses", () => {
    expect(capPayload({ text: "a\u0000b" })).toEqual({ text: "ab" });
  });

  test("a payload over the cap is stored as its head, with its size", () => {
    const stored = capPayload({ text: "x".repeat(2000) }, 100) as Record<string, unknown>;
    expect(stored.truncated).toBe(true);
    expect(stored.bytes).toBe(2011);
    expect(String(stored.head)).toHaveLength(100);
  });
});

describe("createDebugRecorder", () => {
  test("numbers rows per attempt and writes them in batches", async () => {
    const batches: GenerationDebugInsert[][] = [];
    const store: DebugStore = async (_ws, rows) => void batches.push([...rows]);
    const { logger } = silent();
    const r = createDebugRecorder({ ...ids, store, logger, batchRows: 2, flushMs: 10_000 });
    r.sink({ kind: "event", payload: { ev: "a" } });
    r.sink({ kind: "check", slideIndex: 3, payload: { faults: [] } });
    r.sink({ kind: "event", payload: { ev: "c" } });
    // The full batch is written off the caller's path, after it returns.
    expect(batches).toHaveLength(0);
    await r.close();
    expect(batches.map((b) => b.map((row) => row.seq))).toEqual([[0, 1], [2]]);
    expect(batches[0]?.[1]).toMatchObject({ kind: "check", slideIndex: 3, attempt: 1 });
  });

  test("a store that throws or rejects never reaches the caller; it is one warn line", async () => {
    const { warned, logger } = silent();
    const throwing: DebugStore = () => {
      throw new Error("sync boom");
    };
    const r = createDebugRecorder({ ...ids, store: throwing, logger, batchRows: 1 });
    expect(() => r.sink({ kind: "event", payload: {} })).not.toThrow();
    await r.close();
    expect(warned).toContain("generation debug write failed");
    expect(warned).toContain("generation debug record incomplete");
  });

  test("close waits for a hanging store only up to its timeout", async () => {
    const { logger } = silent();
    const r = createDebugRecorder({
      ...ids,
      store: () => new Promise(() => {}),
      logger,
      closeTimeoutMs: 50,
    });
    r.sink({ kind: "event", payload: {} });
    const t0 = Date.now();
    await r.close();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  test("rows past the cap are dropped and counted", async () => {
    const rows: GenerationDebugInsert[] = [];
    const { warned, logger } = silent();
    const r = createDebugRecorder({
      ...ids,
      store: async (_ws, batch) => void rows.push(...batch),
      logger,
      maxRows: 2,
    });
    for (let i = 0; i < 5; i++) r.sink({ kind: "event", payload: { i } });
    await r.close();
    expect(rows).toHaveLength(2);
    expect(warned).toContain("generation debug record incomplete");
  });

  test("recordError stores the full error: message, stack and cause", async () => {
    const rows: GenerationDebugInsert[] = [];
    const { logger } = silent();
    const r = createDebugRecorder({
      ...ids,
      store: async (_ws, batch) => void rows.push(...batch),
      logger,
    });
    r.recordError(new Error("outer", { cause: new TypeError("inner detail") }), { aborted: "no" });
    await r.close();
    const payload = rows[0]?.payload as Record<string, unknown>;
    expect(rows[0]?.kind).toBe("job-error");
    expect(payload.message).toBe("outer");
    expect(String(payload.stack)).toContain("generation-debug.test.ts");
    expect(payload.cause).toMatchObject({ name: "TypeError", message: "inner detail" });
    expect(payload.aborted).toBe("no");
  });
});
