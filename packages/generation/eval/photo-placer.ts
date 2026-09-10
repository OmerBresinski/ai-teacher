/*
 * The eval's `PhotoPlacer` (TEACH-220): Pexels search through `@tj/images` and an in-memory
 * `put` so photographs are placed in an eval run — the rubric's `imageFit` is scored only when a
 * lesson carries one — without writing a byte anywhere persistent. Results carry counts, never
 * URLs or alt text (ADR 0015).
 */
import type { WorkspaceId } from "@tj/domain";
import { createPexelsClient, storePhoto } from "@tj/images";
import type { PhotoPlacer } from "../src";

const EVAL_WORKSPACE = "eval" as WorkspaceId;

/** A `put`-only store that keeps nothing: `storePhoto` fetches the bytes and hands them here. */
export function memoryStore(): { put: Parameters<typeof storePhoto>[0]["storage"]["put"] } {
  return {
    put: async (key, body) => {
      // Drain a stream so the fetch completes; bytes are discarded.
      if (body instanceof ReadableStream) await new Response(body).arrayBuffer();
      return { key };
    },
  };
}

export function evalPhotoPlacer(apiKey: string): PhotoPlacer {
  const client = createPexelsClient({ apiKey });
  const storage = memoryStore();
  return {
    search: (query, opts) =>
      client.search({ query, ...opts, locale: "en-GB" }).then((page) => page.photos),
    store: (photo, target) => storePhoto({ photo, target, storage, workspaceId: EVAL_WORKSPACE }),
  };
}
