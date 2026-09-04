import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  newId,
  type StorageAdapter,
  StorageKeyError,
  storageKey,
  type WorkspaceId,
} from "@tj/domain";
import { deleteByPrefix, MAX_DELETE_CONCURRENCY } from "./delete-by-prefix";
import { LocalDiskStorage } from "./local-disk";

/** Wraps an adapter and records the peak number of concurrent `delete` calls. */
function countingAdapter(inner: StorageAdapter) {
  let inFlight = 0;
  const stats = { peak: 0, calls: 0 };
  const adapter: StorageAdapter = {
    put: (k, b, o) => inner.put(k, b, o),
    getSignedUrl: (k, o) => inner.getSignedUrl(k, o),
    list: (p) => inner.list(p),
    async delete(key) {
      inFlight++;
      stats.calls++;
      stats.peak = Math.max(stats.peak, inFlight);
      try {
        // Yield so several deletes can genuinely overlap.
        await new Promise((r) => setTimeout(r, 2));
        await inner.delete(key);
      } finally {
        inFlight--;
      }
    },
  };
  return { adapter, stats };
}

describe("deleteByPrefix", () => {
  test("deletes 25 objects, leaves the workspace empty and never exceeds 5 in flight", async () => {
    const root = await mkdtemp(join(tmpdir(), "tj-storage-del-"));
    try {
      const disk = new LocalDiskStorage(root);
      const ws = newId<WorkspaceId>();
      const other = newId<WorkspaceId>();
      for (let i = 0; i < 25; i++) {
        await disk.put(
          storageKey(ws, i % 2 ? "sources" : "exports", `f${i}.bin`),
          new Uint8Array([i]),
          {
            contentType: "application/octet-stream",
          },
        );
      }
      await disk.put(storageKey(other, "keep.bin"), new Uint8Array([1]), {
        contentType: "application/octet-stream",
      });

      const { adapter, stats } = countingAdapter(disk);
      const result = await deleteByPrefix(adapter, ws);
      expect(result).toEqual({ deleted: 25 });
      expect(stats.calls).toBe(25);
      expect(stats.peak).toBeGreaterThan(1);
      expect(stats.peak).toBeLessThanOrEqual(MAX_DELETE_CONCURRENCY);

      const left = [];
      for await (const o of disk.list(ws)) left.push(o);
      expect(left).toEqual([]);
      const kept = [];
      for await (const o of disk.list(other)) kept.push(o.key);
      expect(kept).toEqual([storageKey(other, "keep.bin")]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("concurrency is clamped to 1..5 and sub-prefixes work", async () => {
    const root = await mkdtemp(join(tmpdir(), "tj-storage-del-"));
    try {
      const disk = new LocalDiskStorage(root);
      const ws = newId<WorkspaceId>();
      for (let i = 0; i < 8; i++) {
        await disk.put(storageKey(ws, "a", `${i}`), new Uint8Array([1]), { contentType: "x/y" });
      }
      await disk.put(storageKey(ws, "b", "0"), new Uint8Array([1]), { contentType: "x/y" });

      const { adapter, stats } = countingAdapter(disk);
      expect(await deleteByPrefix(adapter, `${ws}/a`, { concurrency: 50 })).toEqual({ deleted: 8 });
      expect(stats.peak).toBeLessThanOrEqual(MAX_DELETE_CONCURRENCY);

      const one = countingAdapter(disk);
      expect(await deleteByPrefix(one.adapter, ws, { concurrency: 0 })).toEqual({ deleted: 1 });
      expect(one.stats.peak).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects prefixes that are not workspace-scoped", async () => {
    const disk = new LocalDiskStorage(await mkdtemp(join(tmpdir(), "tj-storage-del-")));
    await expect(deleteByPrefix(disk, "")).rejects.toBeInstanceOf(StorageKeyError);
    await expect(deleteByPrefix(disk, "../etc")).rejects.toBeInstanceOf(StorageKeyError);
    await expect(deleteByPrefix(disk, "not-a-uuid")).rejects.toBeInstanceOf(StorageKeyError);
  });
});
