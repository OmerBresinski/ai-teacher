import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { type EmbeddingModel, embed } from "ai";

/**
 * The embedding class (ADR 0018: "added when a feature needs it"; first user the picture library,
 * TEACH-84). OpenAI direct with `OPENAI_API_KEY`, the production provider today (ADR 0031).
 * `text-embedding-3-small` at $0.02 per 1M tokens: a library lookup card is ~10 tokens, about
 * $0.0000002. The text is never logged (ADR 0015).
 */
export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMENSIONS = 1536;
export const EMBED_USD_PER_MTOK = 0.02;

export interface Embedding {
  vector: number[];
  tokens: number;
  costUsd: number;
}

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  embed(text: string, signal?: AbortSignal): Promise<Embedding>;
}

export interface CreateEmbedderOptions {
  apiKey: string;
  /** Tests pass a mock model; production uses OpenAI's. */
  model?: EmbeddingModel;
  /** Most texts kept in the in-process cache (oldest dropped first). */
  cacheSize?: number;
}

/**
 * An embedder whose results are cached in-process by a hash of the text: the same card never pays
 * twice in one worker. A call in flight is shared too, so a lookup that gave up waiting (its own
 * deadline) still fills the cache for the write-through that follows. A cached answer reports
 * zero tokens and cost.
 */
export function createOpenAiEmbedder(options: CreateEmbedderOptions): Embedder {
  const model = options.model ?? createOpenAI({ apiKey: options.apiKey }).embedding(EMBED_MODEL);
  return cachedEmbedder(
    {
      model: EMBED_MODEL,
      dimensions: EMBED_DIMENSIONS,
      async embed(text, signal) {
        const result = await embed({
          model,
          value: text,
          maxRetries: 1,
          ...(signal ? { abortSignal: signal } : {}),
        });
        const tokens = result.usage?.tokens ?? 0;
        return {
          vector: [...result.embedding],
          tokens,
          costUsd: (tokens * EMBED_USD_PER_MTOK) / 1e6,
        };
      },
    },
    options.cacheSize,
  );
}

/** Wrap any embedder with the text-hash cache described above. */
export function cachedEmbedder(inner: Embedder, cacheSize = 2000): Embedder {
  const cache = new Map<string, Promise<Embedding>>();
  return {
    model: inner.model,
    dimensions: inner.dimensions,
    embed(text) {
      const key = createHash("sha256").update(text).digest("hex");
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        return hit.then((r) => ({ ...r, tokens: 0, costUsd: 0 }));
      }
      // No caller's signal reaches the shared call: one caller giving up must not cancel it for
      // the next. The call has its own retry and the SDK's timeout.
      const p = inner.embed(text);
      cache.set(key, p);
      p.catch(() => cache.delete(key));
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
      return p;
    },
  };
}
