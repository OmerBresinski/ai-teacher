/*
 * Static list prices per model id (ADR 0025 §15). Data only: `costUsd` is the one function.
 *
 * Source: Anthropic's published per-model list prices (https://www.anthropic.com/pricing#api),
 * which Bedrock on-demand inference mirrors for the Claude family, read on 2026-09-06; the
 * `standard` class (GPT-5.6 Luna, TEACH-205) from the models.dev registry's Bedrock entry
 * (https://models.dev, `us.openai.gpt-5.6-luna`), read on 2026-09-09. One row per
 * `DEFAULT_MODEL_IDS` entry in `create-ai.ts`. A configured model id with no row here is
 * unpriced: `costUsd` returns `null` and the budget falls back to its token cap. A price change is
 * a data edit here and nowhere else.
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
  "us.anthropic.claude-opus-5": { inputPerMTok: 15, outputPerMTok: 75, cachedInputPerMTok: 1.5 },
  "us.openai.gpt-5.6-luna": { inputPerMTok: 0.22, outputPerMTok: 1.32, cachedInputPerMTok: 0.022 },
  "us.anthropic.claude-haiku-4-5-20251001-v1:0": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedInputPerMTok: 0.1,
  },
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
