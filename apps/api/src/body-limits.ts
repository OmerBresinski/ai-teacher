import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "./context";

export const SMALL_JSON_BODY_BYTES = 64 * 1024;
/** Runtime ceiling leaves room above the existing 26 MiB multipart limit. */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
export const SMALL_BODY_MESSAGE = "This request is too large (64 KB limit).";

/**
 * Count actual bytes even with Content-Length. Keep one growing buffer, not one retained object
 * per chunk, so arbitrarily small chunks cannot amplify memory use. Install after protected-route
 * guards and before parsers. The same transport limit supports JSON and OAuth form callbacks.
 */
export function boundedBodyLimit(maxBytes: number, message: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const request = c.req.raw;
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || !request.body) return next();
    const tooLarge = () => new HTTPException(413, { message });
    if (Number(request.headers.get("content-length")) > maxBytes) {
      void request.body.cancel().catch(() => undefined);
      throw tooLarge();
    }
    const reader = request.body.getReader();
    let bytes = new Uint8Array(Math.min(1024, maxBytes));
    let size = 0;
    let complete = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          complete = true;
          break;
        }
        const needed = size + value.byteLength;
        if (needed > maxBytes) throw tooLarge();
        if (needed > bytes.length) {
          const grown = new Uint8Array(Math.min(maxBytes, Math.max(needed, bytes.length * 2)));
          grown.set(bytes.subarray(0, size));
          bytes = grown;
        }
        bytes.set(value, size);
        size = needed;
      }
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(400, { message: "The request body could not be read." });
    } finally {
      if (!complete) void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const headers = new Headers(request.headers);
    headers.delete("transfer-encoding");
    headers.set("content-length", String(size));
    c.req.raw = new Request(request, { headers, body: bytes.subarray(0, size) });
    return next();
  };
}

export const smallJsonBodyLimit = () => boundedBodyLimit(SMALL_JSON_BODY_BYTES, SMALL_BODY_MESSAGE);
