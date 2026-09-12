import { describe, expect, test } from "bun:test";
import { newId, storageKey, type WorkspaceId } from "@tj/domain";
import type { ExtractedSource, SourceRef } from "@tj/domain/documents";
import { SOURCE_UNAVAILABLE_MESSAGE, SourceUnavailable, storageSourceLoader } from "./sources";
import { memoryStorage } from "./testing/memory-storage";

const ws = newId<WorkspaceId>();
const other = newId<WorkspaceId>();

const extracted = (sourceId: string): ExtractedSource => ({
  version: 1,
  sourceId,
  kind: "pdf",
  pages: 2,
  lowText: false,
  chunks: [
    { ref: { page: 1 }, text: "Photosynthesis happens in leaves." },
    { ref: { page: 2 }, text: "Chlorophyll is green." },
  ],
  images: [],
});

const ref = (id: string): SourceRef => ({
  id,
  kind: "file",
  name: "plants.pdf",
  storageKey: storageKey(ws, "sources", id, "original.pdf"),
  pages: 2,
});

describe("storageSourceLoader", () => {
  test("reads extracted.json and returns one SourceText per chunk, in order", async () => {
    const a = newId();
    const b = newId();
    const storage = memoryStorage({
      [storageKey(ws, "sources", a, "extracted.json")]: JSON.stringify(extracted(a)),
      [storageKey(ws, "sources", b, "extracted.json")]: JSON.stringify({
        ...extracted(b),
        kind: "docx",
        pages: 1,
        chunks: [{ ref: { section: "Cells" }, text: "Cells have membranes." }],
      }),
    });
    const texts = await storageSourceLoader(storage, ws)([ref(a), ref(b)]);
    expect(texts).toEqual([
      { sourceId: a, ref: { page: 1 }, text: "Photosynthesis happens in leaves." },
      { sourceId: a, ref: { page: 2 }, text: "Chlorophyll is green." },
      { sourceId: b, ref: { section: "Cells" }, text: "Cells have membranes." },
    ]);
  });

  test("no refs → no reads, empty list", async () => {
    expect(await storageSourceLoader(memoryStorage(), ws)([])).toEqual([]);
  });

  test("a missing object is SourceUnavailable with the fixed sentence", async () => {
    const id = newId();
    const error = await storageSourceLoader(memoryStorage(), ws)([ref(id)]).catch((e) => e);
    expect(error).toBeInstanceOf(SourceUnavailable);
    expect(error).toMatchObject({ sourceId: id, message: SOURCE_UNAVAILABLE_MESSAGE });
  });

  test("invalid JSON or a schema miss is SourceUnavailable too", async () => {
    const a = newId();
    const b = newId();
    const storage = memoryStorage({
      [storageKey(ws, "sources", a, "extracted.json")]: "{not json",
      [storageKey(ws, "sources", b, "extracted.json")]: JSON.stringify({
        ...extracted(b),
        version: 2,
      }),
    });
    await expect(storageSourceLoader(storage, ws)([ref(a)])).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
    await expect(storageSourceLoader(storage, ws)([ref(b)])).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
  });

  test("keys are Workspace-prefixed: another Workspace's Source reads as unavailable", async () => {
    const id = newId();
    const storage = memoryStorage({
      [storageKey(other, "sources", id, "extracted.json")]: JSON.stringify(extracted(id)),
    });
    await expect(storageSourceLoader(storage, ws)([ref(id)])).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
  });
});
