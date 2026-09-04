import { describe, expect, test } from "bun:test";
import {
  newId,
  type StorageAdapter,
  StorageKeyError,
  storageKey,
  type WorkspaceId,
} from "@tj/domain";
import { isStorageError } from "./errors";

/** Returns a fresh adapter; `cleanup` runs after the suite. */
export type ContractFactory = () => Promise<{
  adapter: StorageAdapter;
  cleanup?: () => Promise<void>;
}>;

export interface ContractOptions {
  /** When set, the whole suite is skipped with this reason (e.g. missing credentials). */
  skip?: string;
}

async function collect(adapter: StorageAdapter, prefix: string) {
  const out = [];
  for await (const o of adapter.list(prefix)) out.push(o);
  return out;
}

function streamOf(bytes: Uint8Array, chunk = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

/**
 * Behavioural contract every `StorageAdapter` in this package must satisfy. Run it against a
 * factory; the Blob run skips cleanly when `BLOB_READ_WRITE_TOKEN` is not set.
 */
export function runStorageContract(
  name: string,
  factory: ContractFactory,
  options: ContractOptions = {},
): void {
  const suite = options.skip ? describe.skip : describe;
  suite(
    `${name} — StorageAdapter contract${options.skip ? ` (skipped: ${options.skip})` : ""}`,
    () => {
      const ws = newId<WorkspaceId>();
      let ctx: Awaited<ReturnType<ContractFactory>> | undefined;
      const get = async () => {
        ctx ??= await factory();
        return ctx.adapter;
      };

      test("put(Uint8Array) → list reports size → getSignedUrl → delete → list empty", async () => {
        const adapter = await get();
        const key = storageKey(ws, "sources", "hello.txt");
        const bytes = new TextEncoder().encode("hello storage");
        expect(await adapter.put(key, bytes, { contentType: "text/plain" })).toEqual({ key });

        const listed = await collect(adapter, ws);
        expect(listed.map((o) => o.key)).toEqual([key]);
        expect(listed[0]?.size).toBe(bytes.byteLength);
        expect(listed[0]?.updatedAt).toBeInstanceOf(Date);

        const url = await adapter.getSignedUrl(key, { expiresInSeconds: 60 });
        expect(typeof url).toBe("string");
        expect(url.length).toBeGreaterThan(0);

        await adapter.delete(key);
        expect(await collect(adapter, ws)).toEqual([]);
      });

      test("put(ReadableStream ~1MB) stores the full body", async () => {
        const adapter = await get();
        const key = storageKey(ws, "sources", "big.bin");
        const size = 1024 * 1024 + 17;
        const bytes = new Uint8Array(size);
        for (let i = 0; i < size; i += 4096) bytes[i] = i & 0xff;
        await adapter.put(key, streamOf(bytes), { contentType: "application/octet-stream" });
        const listed = await collect(adapter, `${ws}/sources`);
        expect(listed.find((o) => o.key === key)?.size).toBe(size);
        await adapter.delete(key);
      });

      test("list(prefix) is path-style and recursive", async () => {
        const adapter = await get();
        const a = storageKey(ws, "exports", "2026", "a.pdf");
        const b = storageKey(ws, "exports", "b.pdf");
        const c = storageKey(ws, "exports-old", "c.pdf");
        for (const k of [a, b, c]) {
          await adapter.put(k, new Uint8Array([1]), { contentType: "application/pdf" });
        }
        const under = (await collect(adapter, `${ws}/exports`)).map((o) => o.key).sort();
        expect(under).toEqual([a, b].sort());
        const all = (await collect(adapter, `${ws}/`)).map((o) => o.key).sort();
        expect(all).toEqual([a, b, c].sort());
        for (const k of [a, b, c]) await adapter.delete(k);
      });

      test("delete is idempotent", async () => {
        const adapter = await get();
        const key = storageKey(ws, "missing.bin");
        await adapter.delete(key);
        await adapter.delete(key);
      });

      test("getSignedUrl for a missing object → StorageError not_found", async () => {
        const adapter = await get();
        const key = storageKey(ws, "nope", "missing.bin");
        const err = await adapter.getSignedUrl(key, { expiresInSeconds: 60 }).catch((e) => e);
        expect(isStorageError(err, "not_found")).toBe(true);
      });

      test("invalid keys throw StorageKeyError before touching the backend", async () => {
        const adapter = await get();
        const bad = ["../etc/passwd", `${ws}/../x`, "not-a-uuid/file.txt", ws, `${ws}/`, ""];
        for (const key of bad) {
          await expect(
            adapter.put(key, new Uint8Array([1]), { contentType: "text/plain" }),
          ).rejects.toBeInstanceOf(StorageKeyError);
          await expect(adapter.getSignedUrl(key, { expiresInSeconds: 1 })).rejects.toBeInstanceOf(
            StorageKeyError,
          );
          await expect(adapter.delete(key)).rejects.toBeInstanceOf(StorageKeyError);
        }
        await expect(collect(adapter, "../etc")).rejects.toBeInstanceOf(StorageKeyError);
        await expect(collect(adapter, "not-a-uuid")).rejects.toBeInstanceOf(StorageKeyError);
      });

      test("cleanup", async () => {
        if (ctx) {
          for await (const o of ctx.adapter.list(ws)) await ctx.adapter.delete(o.key);
          await ctx.cleanup?.();
        }
      });
    },
  );
}
