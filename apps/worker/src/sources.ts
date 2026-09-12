import { type ReadableStorageAdapter, storageKey, type WorkspaceId } from "@tj/domain";
import { ExtractedSourceSchema, type SourceRef } from "@tj/domain/documents";
import type { SourceLoader, SourceText } from "@tj/generation";
import type { Logger } from "pino";

/**
 * The `SourceLoader` the worker gives the pipeline (ADR 0027 §6): for every `SourceRef` on the
 * lesson, read `<ws>/sources/<id>/extracted.json` — written by `POST /sources` after extraction
 * and screening — validate it and hand Plan one `SourceText` per chunk. The worker never opens
 * the original document (§1). A Source whose object is missing or unreadable is a
 * `SourceUnavailable`: the job fails for the teacher to see, never a silent plan without the
 * material. Logs carry counts only (ADR 0015).
 */

export const SOURCE_UNAVAILABLE_MESSAGE = "One of the uploaded files is no longer available.";

export class SourceUnavailable extends Error {
  override readonly name = "SourceUnavailable";
  constructor(readonly sourceId: string) {
    super(SOURCE_UNAVAILABLE_MESSAGE);
  }
}

export function storageSourceLoader(
  storage: ReadableStorageAdapter,
  workspaceId: WorkspaceId,
  logger?: Logger,
): SourceLoader {
  return async (refs: SourceRef[]): Promise<SourceText[]> => {
    const out: SourceText[] = [];
    for (const ref of refs) {
      const key = storageKey(workspaceId, "sources", ref.id, "extracted.json");
      let raw: string;
      try {
        const object = await storage.get(key);
        raw = await new Response(object.body).text();
      } catch {
        throw new SourceUnavailable(ref.id);
      }
      let parsed: ReturnType<typeof ExtractedSourceSchema.parse>;
      try {
        parsed = ExtractedSourceSchema.parse(JSON.parse(raw));
      } catch {
        throw new SourceUnavailable(ref.id);
      }
      logger?.info(
        { sourceId: ref.id, kind: parsed.kind, pages: parsed.pages, chunks: parsed.chunks.length },
        "source loaded",
      );
      for (const chunk of parsed.chunks)
        out.push({ sourceId: ref.id, ref: chunk.ref, text: chunk.text });
    }
    return out;
  };
}
