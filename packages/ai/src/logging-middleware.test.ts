import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { generateText, streamText } from "ai";
import pino from "pino";
import { AiError, DEFAULT_MODEL_IDS, isAiError } from "./index";
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
      finishReason: "error",
    });
    expect(JSON.stringify(record)).not.toContain(prompt);
    expect(JSON.stringify(record)).not.toContain(providerError.message);
  });
});
