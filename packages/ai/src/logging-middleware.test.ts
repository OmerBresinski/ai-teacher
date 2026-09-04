import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { AiError, DEFAULT_MODEL_IDS, isAiError } from "./index";
import { createLoggingMiddleware } from "./logging-middleware";
import { createFakeAi } from "./testing";

function createMemoryLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, logger: pino({ level: "info" }, destination) };
}

/** A mock model whose stream can be scripted to fail mid-stream or reject cancellation. */
function createScriptedStreamModel(
  logger: pino.Logger,
  script: { midStreamError?: Error; cancelError?: Error },
) {
  const modelId = DEFAULT_MODEL_IDS.small;
  const inner = new MockLanguageModelV4({
    provider: "bedrock",
    modelId,
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: "private stream completion" });
          if (script.midStreamError) controller.error(script.midStreamError);
        },
        cancel() {
          if (script.cancelError) throw script.cancelError;
        },
      }),
    }),
  });
  return wrapLanguageModel({
    model: inner,
    middleware: createLoggingMiddleware({ logger, modelClass: "small", modelId }),
  });
}

describe("AI logging middleware", () => {
  test("writes one metadata-only success log for a generation", async () => {
    const { lines, logger } = createMemoryLogger();
    const prompt = "private prompt text";
    const completion = "private completion text";
    const ai = createFakeAi({
      logger,
      text: completion,
      usage: { inputTokens: 11, outputTokens: 7, cachedInputTokens: 3 },
    });

    const result = await generateText({ model: ai.model("small"), prompt });
    expect(result.text).toBe(completion);
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0] ?? "") as { ai: Record<string, unknown> };
    expect(record.ai).toMatchObject({
      class: "small",
      modelId: DEFAULT_MODEL_IDS.small,
      provider: "bedrock",
      inputTokens: 11,
      outputTokens: 7,
      cachedInputTokens: 3,
      finishReason: "stop",
    });
    expect(record.ai.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(record)).not.toContain(prompt);
    expect(JSON.stringify(record)).not.toContain(completion);
  });

  test("writes one success log when a stream reaches its finish part", async () => {
    const { lines, logger } = createMemoryLogger();
    const ai = createFakeAi({ logger, usage: { inputTokens: 2, outputTokens: 1 } });

    const result = streamText({ model: ai.model("standard"), prompt: "stream prompt" });
    await result.text;

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "").ai).toMatchObject({
      class: "standard",
      inputTokens: 2,
      outputTokens: 1,
      finishReason: "stop",
    });
  });

  test("wraps provider errors after writing one metadata-only warning", async () => {
    const { lines, logger } = createMemoryLogger();
    const prompt = "private failing prompt";
    const providerError = new Error("private provider completion");
    const ai = createFakeAi({ logger, error: providerError });

    try {
      await generateText({ model: ai.model("frontier"), prompt });
      throw new Error("Expected generateText to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiError);
      expect(isAiError(error, "provider")).toBe(true);
      expect((error as Error & { cause?: unknown }).cause).toBe(providerError);
    }

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as { level: number; ai: Record<string, unknown> };
    expect(record.level).toBe(40);
    expect(record.ai).toMatchObject({
      class: "frontier",
      provider: "bedrock",
      inputTokens: null,
      outputTokens: null,
      finishReason: "error",
    });
    expect(Object.keys(record.ai)).toEqual(
      expect.arrayContaining(["inputTokens", "outputTokens", "durationMs", "modelId"]),
    );
    expect(JSON.stringify(record)).not.toContain(prompt);
    expect(JSON.stringify(record)).not.toContain(providerError.message);
  });

  test("a mid-stream provider error yields one warning and an AiError on the stream", async () => {
    const { lines, logger } = createMemoryLogger();
    const streamError = new Error("private mid-stream failure");
    const model = createScriptedStreamModel(logger, { midStreamError: streamError });

    const result = streamText({ model, prompt: "private stream prompt" });
    const chunks: string[] = [];
    let caught: unknown;
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") chunks.push(part.text);
        if (part.type === "error") caught = part.error;
      }
    } catch (error) {
      caught = error;
    }

    expect(isAiError(caught, "provider")).toBe(true);
    expect((caught as Error & { cause?: unknown }).cause).toBe(streamError);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as { level: number; ai: Record<string, unknown> };
    expect(record.level).toBe(40);
    expect(record.ai).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      finishReason: "error",
    });
    expect(JSON.stringify(record)).not.toContain("private");
  });

  test("cancelling a stream logs once and wraps a rejecting cancel as AiError", async () => {
    const { lines, logger } = createMemoryLogger();
    const cancelError = new Error("private cancel failure");
    const model = createScriptedStreamModel(logger, { cancelError });

    const { stream } = await model.doStream({ prompt: [] });
    const reader = stream.getReader();
    await reader.read();

    let caught: unknown;
    try {
      await reader.cancel("test abort");
    } catch (error) {
      caught = error;
    }

    expect(isAiError(caught, "provider")).toBe(true);
    expect((caught as Error & { cause?: unknown }).cause).toBe(cancelError);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "") as { level: number };
    expect(record.level).toBe(40);
    expect(JSON.stringify(record)).not.toContain("private");
  });
});
