import { describe, expect, test } from "bun:test";
import { cachedEmbedder, type Embedder } from "./embed";

function counting(): Embedder & { calls: number } {
  const inner = {
    model: "m",
    dimensions: 2,
    calls: 0,
    async embed(text: string) {
      inner.calls += 1;
      if (text === "boom") throw new Error("failed");
      return { vector: [text.length, 1], tokens: 3, costUsd: 0.00000006 };
    },
  };
  return inner;
}

describe("cachedEmbedder", () => {
  test("the same text is embedded once; a cached answer costs nothing", async () => {
    const inner = counting();
    const embedder = cachedEmbedder(inner);
    const first = await embedder.embed("frog");
    const second = await embedder.embed("frog");
    expect(inner.calls).toBe(1);
    expect(second.vector).toEqual(first.vector);
    expect(first.costUsd).toBeGreaterThan(0);
    expect(second.costUsd).toBe(0);
    expect(second.tokens).toBe(0);
  });

  test("a failed call is not cached", async () => {
    const inner = counting();
    const embedder = cachedEmbedder(inner);
    await expect(embedder.embed("boom")).rejects.toThrow("failed");
    await expect(embedder.embed("boom")).rejects.toThrow("failed");
    expect(inner.calls).toBe(2);
  });

  test("the oldest text is dropped past the cache size", async () => {
    const inner = counting();
    const embedder = cachedEmbedder(inner, 2);
    await embedder.embed("a");
    await embedder.embed("bb");
    await embedder.embed("ccc");
    await embedder.embed("a");
    expect(inner.calls).toBe(4);
  });
});
