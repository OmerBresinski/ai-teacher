import { describe, expect, test } from "bun:test";
import type { StorageCheck } from "@tj/storage";
import type { WorkerDeps } from "./deps";
import { verifyStorage } from "./storage-check";

function logs() {
  const lines: { level: "info" | "error"; obj: Record<string, unknown>; msg?: string }[] = [];
  return {
    lines,
    logger: {
      info: (obj: Record<string, unknown>, msg?: string) => lines.push({ level: "info", obj, msg }),
      error: (obj: Record<string, unknown>, msg?: string) =>
        lines.push({ level: "error", obj, msg }),
    },
  };
}

const deps = (storageKind: "s3" | "local-disk") =>
  ({
    storage: {},
    storageKind,
    imageGeneration: { generator: {}, cap: {} },
  }) as unknown as WorkerDeps & { storageKind: "s3" | "local-disk" };

describe("verifyStorage (the boot storage check)", () => {
  test("a working bucket logs storage_check ok and keeps picture generation", async () => {
    const { lines, logger } = logs();
    const out = await verifyStorage(deps("s3"), logger, async () => ({ ok: true, ms: 42 }));
    expect(out.storageCheck).toBe("ok");
    expect(out.imageGeneration).toBeDefined();
    expect(lines).toEqual([
      { level: "info", obj: { storage: "s3", ms: 42 }, msg: "storage_check ok" },
    ]);
  });

  test("a bucket that refuses the write logs an error with the code and turns generation off", async () => {
    const { lines, logger } = logs();
    const failed: StorageCheck = {
      ok: false,
      ms: 80,
      step: "put",
      code: "SignatureDoesNotMatch",
      status: 403,
      message: "The request signature we calculated does not match",
    };
    const out = await verifyStorage(deps("s3"), logger, async () => failed);
    expect(out.storageCheck).toBe("failed");
    expect(out.imageGeneration).toBeUndefined();
    expect("imageGeneration" in out).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("error");
    expect(lines[0]?.msg).toStartWith("storage_check failed");
    expect(lines[0]?.obj).toMatchObject({
      storage: "s3",
      step: "put",
      code: "SignatureDoesNotMatch",
      status: 403,
      imageGeneration: "disabled",
    });
  });

  test("local disk is not checked", async () => {
    const { lines, logger } = logs();
    let called = false;
    const out = await verifyStorage(deps("local-disk"), logger, async () => {
      called = true;
      return { ok: true, ms: 0 };
    });
    expect(called).toBe(false);
    expect(out.storageCheck).toBe("skipped");
    expect(out.imageGeneration).toBeDefined();
    expect(lines).toEqual([]);
  });
});
