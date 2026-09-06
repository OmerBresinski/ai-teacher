import type { ModelClass as ModelClassType } from "@tj/domain";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { createConfiguredAi, DEFAULT_MODEL_IDS, DEFAULT_REGION } from "./create-ai";
import type { AiCallContext, ConfiguredAi } from "./types";

export interface FakeAiUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}

/** One recorded call to the fake, in call order (ADR 0025 §22). */
export interface FakeCall {
  /** 0-based position among every `generateText` / `streamText` made through this fake. */
  index: number;
  modelClass: ModelClassType;
  modelId: string;
  /** The `AiCallContext` the caller passed to `ai.model(cls, context)`, if any. */
  context?: AiCallContext | undefined;
  /** The usage the fake reported for this call. */
  usage: FakeAiUsage;
}

/** A scripted answer: the text, optionally with its own usage. */
export interface FakeReply {
  text: string;
  usage?: FakeAiUsage | undefined;
}

export type FakeScriptEntry = string | FakeReply | ((call: FakeCall) => string | FakeReply);

export interface CreateFakeAiOptions {
  /** The answer once the script is exhausted (and for every call when there is no script). */
  text?: string | undefined;
  /** Usage reported when a script entry does not carry its own. */
  usage?: FakeAiUsage | undefined;
  /** Answers consumed in call order, so a test can script Plan → Generate×N → Evaluate. */
  script?: FakeScriptEntry[] | undefined;
  modelIds?: Partial<Record<ModelClassType, string>> | undefined;
  logger?: pino.Logger | undefined;
  error?: unknown;
}

export type FakeAi = ConfiguredAi & {
  /** Every call made so far; assert on this rather than on prompt text. */
  calls: FakeCall[];
};

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
export function createFakeAi(options: CreateFakeAiOptions = {}): FakeAi {
  const fallback: FakeReply = { text: options.text ?? "fake response" };
  const script = [...(options.script ?? [])];
  const logger = options.logger ?? pino({ level: "silent" });
  const modelIds = { ...DEFAULT_MODEL_IDS, ...options.modelIds };
  const calls: FakeCall[] = [];

  /** Records the call and resolves its scripted reply; one entry is consumed per call. */
  const nextReply = (
    modelClass: ModelClassType,
    modelId: string,
    context: AiCallContext | undefined,
  ) => {
    const call: FakeCall = { index: calls.length, modelClass, modelId, context, usage: {} };
    const entry = script.shift() ?? fallback;
    const resolved = typeof entry === "function" ? entry(call) : entry;
    const reply: FakeReply = typeof resolved === "string" ? { text: resolved } : resolved;
    call.usage = reply.usage ?? options.usage ?? {};
    calls.push(call);
    return { text: reply.text, usage: usageForFake(call.usage) };
  };

  const ai = createConfiguredAi({
    region: DEFAULT_REGION,
    modelIds,
    logger,
    createModel: (modelClass, modelId, context) =>
      new MockLanguageModelV4({
        provider: "bedrock",
        modelId,
        doGenerate: async () => {
          if (options.error !== undefined) throw options.error;
          const { text, usage } = nextReply(modelClass, modelId, context);
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
              const { text, usage } = nextReply(modelClass, modelId, context);
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

  return { ...ai, calls };
}
