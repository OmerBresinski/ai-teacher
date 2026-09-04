import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, StorageKeyError, storageKey, type WorkspaceId } from "@tj/domain";
import { isStorageError } from "./errors";
import { LocalDiskStorage, META_SUFFIX } from "./local-disk";
import { runStorageContract } from "./storage-contract";

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "tj-storage-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

runStorageContract("LocalDiskStorage", async () => {
  const { root, cleanup } = await tempRoot();
  return { adapter: new LocalDiskStorage(root), cleanup };
});

describe("LocalDiskStorage specifics", () => {
  test("writes the object under <root>/<key> with a sidecar that list() excludes", async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const storage = new LocalDiskStorage(root);
      const ws = newId<WorkspaceId>();
      const key = storageKey(ws, "sources", "a.txt");
      await storage.put(key, new TextEncoder().encode("abc"), { contentType: "text/plain" });

      const files = await readdir(join(root, ws, "sources"));
      expect(files.sort()).toEqual(["a.txt", `a.txt${META_SUFFIX}`]);

      const listed = [];
      for await (const o of storage.list(ws)) listed.push(o.key);
      expect(listed).toEqual([key]);

      const got = await storage.get(key);
      expect(got.contentType).toBe("text/plain");
      expect(got.size).toBe(3);
      expect(await new Response(got.body).text()).toBe("abc");

      await storage.delete(key);
      expect(await readdir(join(root, ws, "sources"))).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  test("getSignedUrl → file:// URL by default, publicBaseUrl/key when configured", async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const ws = newId<WorkspaceId>();
      const key = storageKey(ws, "exports", "plan v1.pdf");
      const plain = new LocalDiskStorage(root);
      await plain.put(key, new Uint8Array([1]), { contentType: "application/pdf" });
      const fileUrl = await plain.getSignedUrl(key, { expiresInSeconds: 60 });
      expect(fileUrl.startsWith("file://")).toBe(true);
      expect(decodeURIComponent(fileUrl)).toEndWith(`/${key}`);

      const served = new LocalDiskStorage(root, { publicBaseUrl: "http://localhost:5555/blob/" });
      expect(await served.getSignedUrl(key, { expiresInSeconds: 60 })).toBe(
        `http://localhost:5555/blob/${ws}/exports/plan%20v1.pdf`,
      );
    } finally {
      await cleanup();
    }
  });

  test("get on a missing object → StorageError not_found", async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const storage = new LocalDiskStorage(root);
      const err = await storage.get(storageKey(newId<WorkspaceId>(), "x")).catch((e) => e);
      expect(isStorageError(err, "not_found")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("path traversal is rejected before touching the file system", async () => {
    const { root, cleanup } = await tempRoot();
    try {
      const storage = new LocalDiskStorage(root);
      const ws = newId<WorkspaceId>();
      for (const key of ["../etc/passwd", `${ws}/../x`, `${ws}/a/../../x`, "not-a-uuid/x"]) {
        expect(() => storage.pathFor(key)).toThrow(StorageKeyError);
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});
