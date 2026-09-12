import type { ReadableStorageAdapter, StorageObject, StorageObjectBody } from "@tj/domain";

/**
 * An in-memory `ReadableStorageAdapter` for worker tests: `put` a Source's `extracted.json`
 * (or anything) and the loader reads it back; a missing key rejects the way the real adapters do
 * (`StorageError("not_found")` in `@tj/storage`; here a plain error with the same `code`).
 */
export function memoryStorage(
  seed: Record<string, Uint8Array | string> = {},
): ReadableStorageAdapter & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  for (const [key, value] of Object.entries(seed)) {
    objects.set(key, {
      bytes: typeof value === "string" ? new TextEncoder().encode(value) : value,
      contentType: typeof value === "string" ? "application/json" : "application/octet-stream",
    });
  }
  const notFound = (key: string) =>
    Object.assign(new Error(`not found: ${key}`), { name: "StorageError", code: "not_found", key });
  return {
    objects,
    async put(key, body, opts) {
      const bytes =
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, contentType: opts.contentType });
      return { key };
    },
    async get(key): Promise<StorageObjectBody> {
      const object = objects.get(key);
      if (!object) throw notFound(key);
      return {
        key,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(object.bytes);
            controller.close();
          },
        }),
        contentType: object.contentType,
        size: object.bytes.byteLength,
        updatedAt: new Date(),
      };
    },
    async getSignedUrl(key) {
      return `/files/${key}`;
    },
    async delete(key) {
      objects.delete(key);
    },
    async *list(prefix): AsyncIterable<StorageObject> {
      for (const [key, object] of objects) {
        if (key.startsWith(prefix))
          yield { key, size: object.bytes.byteLength, updatedAt: new Date() };
      }
    },
  };
}
