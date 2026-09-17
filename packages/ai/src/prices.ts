/*
 * Static list prices per model id (ADR 0025 §15). Data only: `costUsd` is the one function.
 *
 * Short-context source: the models.dev registry's Bedrock entries (https://models.dev, `us.openai.gpt-5.6-*`),
 * read on 2026-09-09 (TEACH-205 for Luna, TEACH-208 for Terra and Sol), cross-checked against the
 * Bedrock pricing page (https://aws.amazon.com/bedrock/pricing/, OpenAI models, US East) — that
 * page renders its table client-side and the public Price List API does not carry these models,
 * so there is no machine-readable AWS source. One row per `DEFAULT_MODEL_IDS` entry in
 * `create-ai.ts`. A configured model id with no row here is unpriced: `costUsd` returns `null`
 * and the budget falls back to its token cap. Long-context and cache-write rows verified against
 * the AWS model cards on 2026-09-13 (links in ADR 0025's TEACH-280 amendment).
 */

export interface ModelPrice {
  /** USD per million input tokens read from the prompt (not served from cache). */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per million input tokens served from the prompt cache. */
  cachedInputPerMTok: number;
  cacheWriteInputPerMTok?: number;
  longContext?: {
    aboveInputTokens: number;
    inputPerMTok: number;
    outputPerMTok: number;
    cachedInputPerMTok: number;
    cacheWriteInputPerMTok: number;
  };
}

// Keys are the `DEFAULT_MODEL_IDS` values; `prices.test.ts` pins that they match, and this file
// stays import-free so `logging-middleware.ts` can read it without a cycle through `create-ai.ts`.
export const PRICES: Record<string, ModelPrice> = {
  "us.openai.gpt-5.6-luna": {
    inputPerMTok: 0.22,
    outputPerMTok: 1.32,
    cachedInputPerMTok: 0.022,
    cacheWriteInputPerMTok: 0.275,
    longContext: {
      aboveInputTokens: 272_000,
      inputPerMTok: 0.44,
      outputPerMTok: 1.98,
      cachedInputPerMTok: 0.044,
      cacheWriteInputPerMTok: 0.55,
    },
  },
  "us.openai.gpt-5.6-terra": {
    inputPerMTok: 2.2,
    outputPerMTok: 13.2,
    cachedInputPerMTok: 0.22,
    cacheWriteInputPerMTok: 2.75,
    longContext: {
      aboveInputTokens: 272_000,
      inputPerMTok: 4.4,
      outputPerMTok: 19.8,
      cachedInputPerMTok: 0.44,
      cacheWriteInputPerMTok: 5.5,
    },
  },
  "us.openai.gpt-5.6-sol": {
    inputPerMTok: 4.4,
    outputPerMTok: 22,
    cachedInputPerMTok: 0.44,
    cacheWriteInputPerMTok: 5.5,
    longContext: {
      aboveInputTokens: 272_000,
      inputPerMTok: 8.8,
      outputPerMTok: 33,
      cachedInputPerMTok: 0.88,
      cacheWriteInputPerMTok: 11,
    },
  },
  // Vercel AI Gateway ids (`provider/model`), the lab's model bench: the gateway's own list
  // prices from `getAvailableModels()` on 2026-09-17, no markup. They make `--cap` a dollar cap
  // and the lesson cost line real for those runs; the gateway's per-call cost is recorded too.
  "openai/gpt-5.6-luna": {
    inputPerMTok: 0.2,
    outputPerMTok: 1.2,
    cachedInputPerMTok: 0.02,
    cacheWriteInputPerMTok: 0.25,
  },
  "openai/gpt-5.6-terra": {
    inputPerMTok: 2,
    outputPerMTok: 12,
    cachedInputPerMTok: 0.2,
    cacheWriteInputPerMTok: 2.5,
  },
  "openai/gpt-5.6-sol": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cachedInputPerMTok: 0.2,
    cacheWriteInputPerMTok: 2.5,
  },
  "google/gemini-3.8-flash": {
    inputPerMTok: 0.75,
    outputPerMTok: 3.75,
    cachedInputPerMTok: 0.075,
  },
  "deepseek/deepseek-v4-flash": {
    inputPerMTok: 0.22,
    outputPerMTok: 0.66,
    cachedInputPerMTok: 0.022,
  },
  "deepseek/deepseek-v4-pro": {
    inputPerMTok: 0.66,
    outputPerMTok: 1.98,
    cachedInputPerMTok: 0.022,
  },
  "alibaba/qwen3.5-flash": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.4,
    cachedInputPerMTok: 0.01,
    cacheWriteInputPerMTok: 0.125,
  },
  "alibaba/qwen3.5-plus": {
    inputPerMTok: 0.4,
    outputPerMTok: 2.5,
    cachedInputPerMTok: 0.04,
    cacheWriteInputPerMTok: 0.5,
  },
  "moonshotai/kimi-k2.6": {
    inputPerMTok: 0.95,
    outputPerMTok: 4,
    cachedInputPerMTok: 0.16,
  },
  "anthropic/claude-sonnet-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cachedInputPerMTok: 0.2,
    cacheWriteInputPerMTok: 2.5,
  },
  "anthropic/claude-opus-5": {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cachedInputPerMTok: 0.5,
    cacheWriteInputPerMTok: 6.25,
  },
};

export interface TokenUsage {
  /** Every input token, cached reads included. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` served from the prompt cache. */
  cachedInputTokens?: number | undefined;
  cacheWriteInputTokens?: number | undefined;
}

/** The row for a model id, or `undefined`. Own properties only: `"toString"` is not a model. */
function priceOf(modelId: string): ModelPrice | undefined {
  return Object.hasOwn(PRICES, modelId) ? PRICES[modelId] : undefined;
}

/** Whether a model id has a row in `PRICES`. */
export function isPriced(modelId: string): boolean {
  return priceOf(modelId) !== undefined;
}

/** USD for one call, or `null` when the model id is unpriced. */
export function costUsd(modelId: string, usage: TokenUsage): number | null {
  const row = priceOf(modelId);
  if (!row) return null;
  const price =
    row.longContext && usage.inputTokens > row.longContext.aboveInputTokens ? row.longContext : row;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(usage.cacheWriteInputTokens ?? 0, usage.inputTokens - cached);
  const uncached = usage.inputTokens - cached - written;
  return (
    (uncached * price.inputPerMTok +
      cached * price.cachedInputPerMTok +
      written * (price.cacheWriteInputPerMTok ?? price.inputPerMTok) +
      usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
