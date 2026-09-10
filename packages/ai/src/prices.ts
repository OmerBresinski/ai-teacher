/*
 * Static list prices per model id (ADR 0025 §15). Data only: `costUsd` is the one function.
 *
 * Source: the models.dev registry's Bedrock entries (https://models.dev, `us.openai.gpt-5.6-*`),
 * read on 2026-09-09 (TEACH-205 for Luna, TEACH-208 for Terra and Sol), cross-checked against the
 * Bedrock pricing page (https://aws.amazon.com/bedrock/pricing/, OpenAI models, US East) — that
 * page renders its table client-side and the public Price List API does not carry these models,
 * so there is no machine-readable AWS source. One row per `DEFAULT_MODEL_IDS` entry in
 * `create-ai.ts`. A configured model id with no row here is unpriced: `costUsd` returns `null`
 * and the budget falls back to its token cap. A price change is a data edit here and nowhere else.
 */

export interface ModelPrice {
  /** USD per million input tokens read from the prompt (not served from cache). */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per million input tokens served from the prompt cache. */
  cachedInputPerMTok: number;
}

// Keys are the `DEFAULT_MODEL_IDS` values; `prices.test.ts` pins that they match, and this file
// stays import-free so `logging-middleware.ts` can read it without a cycle through `create-ai.ts`.
export const PRICES: Record<string, ModelPrice> = {
  "us.openai.gpt-5.6-luna": { inputPerMTok: 0.22, outputPerMTok: 1.32, cachedInputPerMTok: 0.022 },
  "us.openai.gpt-5.6-terra": { inputPerMTok: 2.2, outputPerMTok: 13.2, cachedInputPerMTok: 0.22 },
  "us.openai.gpt-5.6-sol": { inputPerMTok: 4.4, outputPerMTok: 22, cachedInputPerMTok: 0.44 },
};

export interface TokenUsage {
  /** Every input token, cached reads included. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` served from the prompt cache. */
  cachedInputTokens?: number | undefined;
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
  const price = priceOf(modelId);
  if (!price) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncached = usage.inputTokens - cached;
  return (
    (uncached * price.inputPerMTok +
      cached * price.cachedInputPerMTok +
      usage.outputTokens * price.outputPerMTok) /
    1_000_000
  );
}
