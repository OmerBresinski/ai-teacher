import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageAdapter } from "@tj/domain";
import { checkStorage, STORAGE_CHECK_PREFIX } from "./check-storage";
import { toBackendError } from "./errors";
import { LocalDiskStorage } from "./local-disk";

/** What `Bun.S3Client` raises for a stale secret, wrapped as the S3 adapter wraps it. */
function signatureMismatch() {
  const s3 = Object.assign(
    new Error(
      "The request signature we calculated does not match the signature you provided. Check AKIAIOSFODNN7EXAMPLE https://t3.storageapi.dev/files/x?X-Amz-Signature=abc",
    ),
    { name: "S3Error", code: "SignatureDoesNotMatch", status: 403 },
  );
  return toBackendError("put", "k", s3);
}

describe("checkStorage", () => {
  test("a working store: put then delete under the health prefix, nothing left behind", async () => {
    const root = await mkdtemp(join(tmpdir(), "tj-storage-check-"));
    try {
      const disk = new LocalDiskStorage(root);
      const out = await checkStorage(disk, { id: () => "probe" });
      expect(out.ok).toBe(true);
      const left = [];
      for await (const o of disk.list(STORAGE_CHECK_PREFIX)) left.push(o.key);
      expect(left).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a put that fails reports the step, the S3 code and status, and no secret", async () => {
    const calls: string[] = [];
    const store = {
      put: async (key: string) => {
        calls.push(`put ${key}`);
        throw signatureMismatch();
      },
      delete: async () => {
        calls.push("delete");
      },
    } as unknown as StorageAdapter;
    const out = await checkStorage(store, { id: () => "probe" });
    expect(calls).toEqual([`put ${STORAGE_CHECK_PREFIX}/probe.txt`]);
    expect(out).toMatchObject({
      ok: false,
      step: "put",
      code: "SignatureDoesNotMatch",
      status: 403,
    });
    const message = out.ok ? "" : (out.message ?? "");
    expect(message).toContain("signature we calculated does not match");
    expect(message).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(message).not.toContain("X-Amz-Signature");
  });

  test("a delete that fails still passes, with a warning (a key without DeleteObject)", async () => {
    const store = {
      put: async (key: string) => ({ key }),
      delete: async () => {
        throw toBackendError(
          "delete",
          "k",
          Object.assign(new Error("denied"), { code: "AccessDenied" }),
        );
      },
    } as unknown as StorageAdapter;
    expect(await checkStorage(store)).toMatchObject({
      ok: true,
      warning: { step: "delete", code: "AccessDenied" },
    });
  });

  test("a store that never answers fails on the timeout instead of holding the boot", async () => {
    const store = { put: () => new Promise(() => {}) } as unknown as StorageAdapter;
    expect(await checkStorage(store, { timeoutMs: 20 })).toMatchObject({
      ok: false,
      step: "put",
      code: "timeout",
    });
  });
});
