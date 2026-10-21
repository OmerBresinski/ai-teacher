import { describe, expect, test } from "bun:test";
import type { GenerationDebugInsert } from "@tj/db";
import { type JobId, type LessonId, newId, type WorkspaceId } from "@tj/domain";
import { capPayload, createDebugRecorder, cutUtf8, type DebugStore } from "./generation-debug";

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

  test("over the cap, the longest strings are cut and the row is marked truncated", () => {
    const payload = { request: { system: "s".repeat(3000) }, response: { text: "r".repeat(500) } };
    const stored = capPayload(payload, 2000) as Record<string, unknown>;
    expect(stored.truncated).toBe(true);
    expect(stored.originalBytes).toBe(Buffer.byteLength(JSON.stringify(payload)));
    expect(stored.truncatedFields).toEqual([{ path: "$.request.system", originalBytes: 3000 }]);
    expect((stored.response as { text: string }).text).toHaveLength(500);
    expect(String((stored.request as { system: string }).system)).toEndWith("…[truncated]");
  });

  test("a literal backslash-u0000 in the text survives; only real NULs go", () => {
    expect(capPayload({ text: "C:\\u0000dir", ["k\u0000"]: 1 })).toEqual({
      text: "C:\\u0000dir",
      k: 1,
    });
  });

  test("a lone surrogate is made well formed, so jsonb takes the row", () => {
    expect(capPayload({ text: "a\ud83db" })).toEqual({ text: "a\ufffdb" });
  });

  test("cuts between code points and by UTF-8 bytes: emoji and multi-byte text at the cut", () => {
    expect(cutUtf8("ab😀", 5)).toBe("ab");
    expect(cutUtf8("ab😀", 6)).toBe("ab😀");
    expect(cutUtf8("é".repeat(10), 5)).toBe("éé");
    for (const unit of ["😀", "é", "中", "a😀é中"]) {
      const payload = { system: unit.repeat(3000), note: "x" };
      for (const cap of [1000, 1001, 1002, 1003, 4096]) {
        const stored = capPayload(payload, cap) as Record<string, unknown>;
        const text = JSON.stringify(stored);
        expect(text).not.toMatch(/\\ud[89a-f]/i);
        expect(text.isWellFormed()).toBe(true);
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(cap);
        expect(stored.truncated).toBe(true);
      }
    }
  });

  test("the head fallback stays within the cap in bytes", () => {
    const payload = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`k${i}`, '"中😀'.repeat(10)]),
    );
    const stored = capPayload(payload, 4096) as Record<string, unknown>;
    expect(typeof stored.head).toBe("string");
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(4096);
  });

  test("under the cap nothing is marked", () => {
    expect(capPayload({ text: "short" })).toEqual({ text: "short" });
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

  test("a failed batch falls back to row by row; only the bad row is lost", async () => {
    const written: number[] = [];
    const store: DebugStore = async (_ws, rows) => {
      if (rows.some((r) => (r.payload as { bad?: boolean }).bad)) throw new Error("bad row");
      written.push(...rows.map((r) => r.seq));
    };
    const { logger, warned } = silent();
    const r = createDebugRecorder({ ...ids, store, logger, batchRows: 3, flushMs: 10_000 });
    r.sink({ kind: "event", payload: { ev: "a" } });
    r.sink({ kind: "event", payload: { bad: true } });
    r.sink({ kind: "event", payload: { ev: "c" } });
    await r.close();
    expect(written).toEqual([0, 2]);
    expect(warned).toEqual(["generation debug write failed", "generation debug record incomplete"]);
  });

  test("past the memory budget a record is dropped and counted, and the budget is returned", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stored: number[] = [];
    const store: DebugStore = async (_ws, rows) => {
      await gate;
      stored.push(...rows.map((r) => r.seq));
    };
    const budget = { used: 0, max: 200 };
    const { logger, warned } = silent();
    const r = createDebugRecorder({ ...ids, store, logger, budget, batchRows: 1 });
    r.sink({ kind: "event", payload: { text: "x".repeat(150) } });
    r.sink({ kind: "event", payload: { text: "y".repeat(150) } });
    expect(budget.used).toBeGreaterThan(150);
    release();
    await r.close();
    expect(stored).toEqual([0]);
    expect(budget.used).toBe(0);
    expect(warned).toEqual(["generation debug record incomplete"]);
  });

  test("a batch is also written once it holds batchBytes", async () => {
    const batches: number[] = [];
    const store: DebugStore = async (_ws, rows) => void batches.push(rows.length);
    const { logger } = silent();
    const r = createDebugRecorder({ ...ids, store, logger, batchBytes: 250, flushMs: 10_000 });
    for (let i = 0; i < 4; i++) r.sink({ kind: "event", payload: { text: "z".repeat(100) } });
    await r.close();
    expect(batches).toEqual([3, 1]);
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
