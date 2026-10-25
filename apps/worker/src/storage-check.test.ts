import { describe, expect, test } from "bun:test";
import type { StorageAdapter } from "@tj/domain";
import type { StorageCheck } from "@tj/storage";
import type { WorkerDeps } from "./deps";
import { pictureMaker } from "./jobs/lesson-pipeline";
import { createDailyImageCap } from "./picture-generator";
import { recheckDelayMs, verifyStorage } from "./storage-check";

type Line = { level: "info" | "warn" | "error"; obj: Record<string, unknown>; msg?: string };
function logs() {
  const lines: Line[] = [];
  const at = (level: Line["level"]) => (obj: Record<string, unknown>, msg?: string) =>
    lines.push({ level, obj, msg });
  return { lines, logger: { info: at("info"), warn: at("warn"), error: at("error") } };
}

const storage = {} as StorageAdapter;
const failed: StorageCheck = {
  ok: false,
  ms: 80,
  step: "put",
  code: "SignatureDoesNotMatch",
  status: 403,
  message: "The request signature we calculated does not match",
};

/** Checks that answer from `answers` in turn, counting how many ran at once. */
function scripted(answers: StorageCheck[]) {
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const check = async () => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Bun.sleep(1);
    inFlight--;
    return answers.shift() ?? { ok: true as const, ms: 1 };
  };
  return { check, stats: () => ({ calls, maxInFlight }) };
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await Bun.sleep(2);
}

describe("verifyStorage (the boot storage check)", () => {
  test("a working bucket logs storage_check ok and leaves the gate open", async () => {
    const { lines, logger } = logs();
    const out = await verifyStorage(storage, "s3", logger, {
      check: async () => ({ ok: true, ms: 42 }),
    });
    expect(out.storageCheck).toBe("ok");
    expect(out.gate.open).toBe(true);
    expect(lines).toEqual([
      { level: "info", obj: { storage: "s3", ms: 42 }, msg: "storage_check ok" },
    ]);
  });

  test("a failed check closes the gate with an error line; a later pass reopens it", async () => {
    const { lines, logger } = logs();
    const { check, stats } = scripted([failed, failed, failed]);
    const stop = new AbortController();
    const out = await verifyStorage(storage, "s3", logger, {
      check,
      delayMs: () => 1,
      signal: stop.signal,
    });
    expect(out.storageCheck).toBe("failed");
    expect(out.gate.open).toBe(false);
    expect(lines[0]).toMatchObject({
      level: "error",
      obj: { storage: "s3", step: "put", code: "SignatureDoesNotMatch", status: 403 },
    });
    expect(lines[0]?.msg).toStartWith("storage_check failed");
    await until(() => out.gate.open);
    // Boot check, two failed re-checks, then the pass; never two at once.
    expect(out.gate.open).toBe(true);
    expect(stats()).toEqual({ calls: 4, maxInFlight: 1 });
    expect(lines.map((l) => l.level)).toEqual(["error", "warn", "warn", "info"]);
    expect(lines.at(-1)).toMatchObject({
      msg: "storage_check ok (recovered)",
      obj: { rechecks: 3 },
    });
    stop.abort();
  });

  test("a lesson job reads the gate when it starts: no picture maker while closed, back once reopened", async () => {
    const { logger } = logs();
    const { check } = scripted([failed]);
    const stop = new AbortController();
    const { gate } = await verifyStorage(storage, "s3", logger, {
      check,
      delayMs: () => 1,
      signal: stop.signal,
    });
    const deps = {
      storage,
      images: { client: {}, storage },
      imageGeneration: {
        generator: { model: "gpt-image-2.5-sunburst", generate: async () => ({}) },
        cap: createDailyImageCap({ capUsd: 5 }),
      },
      storageGate: gate,
    } as unknown as WorkerDeps;
    const ws = "01a12146-0bf6-7000-9dad-27a0a34bb22f" as never;
    expect(pictureMaker(deps, ws, logger as never)).toEqual({});
    await until(() => gate.open);
    expect(pictureMaker(deps, ws, logger as never).pictureMaker).toBeDefined();
    stop.abort();
  });

  test("a re-check that throws is logged and the chain goes on: the next pass reopens the gate", async () => {
    const { lines, logger } = logs();
    const answers: (StorageCheck | Error)[] = [failed, new Error("boom"), { ok: true, ms: 3 }];
    const stop = new AbortController();
    const out = await verifyStorage(storage, "s3", logger, {
      check: async () => {
        const next = answers.shift();
        if (next instanceof Error) throw next;
        return next ?? { ok: true, ms: 1 };
      },
      delayMs: () => 1,
      signal: stop.signal,
    });
    expect(out.gate.open).toBe(false);
    await until(() => out.gate.open);
    expect(out.gate.open).toBe(true);
    expect(lines.map((l) => l.msg)).toEqual([
      "storage_check failed: picture generation is off until a re-check passes",
      "storage_check re-check threw",
      "storage_check ok (recovered)",
    ]);
    stop.abort();
  });

  test("a pass whose probe could not be deleted keeps pictures on and warns", async () => {
    const { lines, logger } = logs();
    const out = await verifyStorage(storage, "s3", logger, {
      check: async () => ({ ok: true, ms: 5, warning: { step: "delete", code: "AccessDenied" } }),
    });
    expect(out).toMatchObject({ storageCheck: "ok" });
    expect(out.gate.open).toBe(true);
    expect(lines.map((l) => [l.level, l.msg])).toEqual([
      ["info", "storage_check ok"],
      ["warn", "storage_check: the probe could not be deleted"],
    ]);
    expect(lines[1]?.obj).toMatchObject({ step: "delete", code: "AccessDenied" });
  });

  test("shutdown stops the re-checks; the gate stays closed", async () => {
    const { logger } = logs();
    const { check, stats } = scripted([failed]);
    const stop = new AbortController();
    const out = await verifyStorage(storage, "s3", logger, {
      check,
      delayMs: () => 20,
      signal: stop.signal,
    });
    stop.abort();
    await Bun.sleep(40);
    expect(out.gate.open).toBe(false);
    expect(stats().calls).toBe(1);
  });

  test("local disk is not checked", async () => {
    const { lines, logger } = logs();
    let called = false;
    const out = await verifyStorage(storage, "local-disk", logger, {
      check: async () => {
        called = true;
        return { ok: true, ms: 0 };
      },
    });
    expect(called).toBe(false);
    expect(out).toMatchObject({ storageCheck: "skipped" });
    expect(out.gate.open).toBe(true);
    expect(lines).toEqual([]);
  });

  test("backoff: 30 s, 60 s, 120 s, 240 s, then capped at 5 min", () => {
    expect([0, 1, 2, 3, 4, 9].map(recheckDelayMs)).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
    ]);
  });
});
