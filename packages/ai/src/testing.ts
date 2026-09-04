import type { ModelClass as ModelClassType } from "@tj/domain";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { createConfiguredAi, DEFAULT_MODEL_IDS, DEFAULT_REGION } from "./create-ai";
import type { CreatedAi } from "./types";

export interface FakeAiUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}

export interface CreateFakeAiOptions {
  text?: string | undefined;
  usage?: FakeAiUsage | undefined;
  modelIds?: Partial<Record<ModelClassType, string>> | undefined;
  logger?: pino.Logger | undefined;
  error?: unknown;
}

function usageForFake(usage: FakeAiUsage) {
  return {
    inputTokens: {
      total: usage.inputTokens ?? 1,
      noCache: usage.inputTokens ?? 1,
      cacheRead: usage.cachedInputTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.outputTokens ?? 1,
      text: usage.outputTokens ?? 1,
      reasoning: undefined,
    },
  };
}

/**
 * Deterministic, network-free models for callers of `@tj/ai`. It reports `kind: "bedrock"` so it
 * can replace a configured client without adding test-only branches to application code.
 */
export function createFakeAi(options: CreateFakeAiOptions = {}): CreatedAi {
  const text = options.text ?? "fake response";
  const usage = usageForFake(options.usage ?? {});
  const logger = options.logger ?? pino({ level: "silent" });
  const modelIds = { ...DEFAULT_MODEL_IDS, ...options.modelIds };

  return createConfiguredAi({
    region: DEFAULT_REGION,
    modelIds,
    logger,
    createModel: (_modelClass, modelId) =>
      new MockLanguageModelV4({
        provider: "bedrock",
        modelId,
        doGenerate: async () => {
          if (options.error !== undefined) throw options.error;
          return {
            content: [{ type: "text", text }],
            finishReason: { unified: "stop", raw: undefined },
            usage,
            warnings: [],
          };
        },
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              if (options.error !== undefined) {
                controller.error(options.error);
                return;
              }
              controller.enqueue({ type: "text-start", id: "fake-text" });
              controller.enqueue({ type: "text-delta", id: "fake-text", delta: text });
              controller.enqueue({ type: "text-end", id: "fake-text" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              });
              controller.close();
            },
          }),
        }),
      }),
  });
}
