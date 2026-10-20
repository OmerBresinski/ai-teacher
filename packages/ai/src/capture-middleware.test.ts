import { describe, expect, test } from "bun:test";
import { APICallError, generateText, jsonSchema, Output, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { type CapturedCall, withCallCapture } from "./capture-middleware";
import { createFakeAi } from "./testing";
import type { CreatedAi } from "./types";

const BEDROCK_LUNA = "us.openai.gpt-5.6-luna";
const quiet = pino({ level: "silent" });
const context = {
  lessonId: "0192f7a0-0000-7000-8000-000000000042",
  jobId: "0192f7a0-0000-7000-8000-0000000000aa",
  stage: "write-small",
  promptVersion: "lesson-writer.v1/notes",
  effort: "low",
};

describe("the call capture middleware (generation_debug model-call rows)", () => {
  test("one record per call: full request, response, finish, usage, cost, latency, context", async () => {
    const calls: CapturedCall[] = [];
    const ai = withCallCapture(
      createFakeAi({
        logger: quiet,
        modelIds: { small: BEDROCK_LUNA },
        text: '{"notes":"say it slowly"}',
        usage: { inputTokens: 1000, outputTokens: 50 },
      }),
      (c) => calls.push(c),
    );
    await generateText({
      model: ai.model("small", context),
      system: "You write speaker notes.",
      prompt: "Slide 3: the Romans land.",
      output: Output.object({
        schema: jsonSchema({ type: "object", properties: { notes: { type: "string" } } }),
        name: "notes",
      }),
      maxOutputTokens: 800,
    });
    expect(calls).toHaveLength(1);
    const c = calls[0] as CapturedCall;
    expect(c.context).toEqual(context);
    expect(c.modelId).toBe(BEDROCK_LUNA);
    expect(c.request.system).toEqual(["You write speaker notes."]);
    expect(JSON.stringify(c.request.messages)).toContain("Slide 3: the Romans land.");
    expect(c.request.schemaName).toBe("notes");
    expect(c.request.settings.maxOutputTokens).toBe(800);
    expect(c.response).toMatchObject({ text: '{"notes":"say it slowly"}', finishReason: "stop" });
    expect(c.usage).toMatchObject({ inputTokens: 1000, outputTokens: 50 });
    expect(c.costUsd).toEqual(expect.any(Number));
    expect(c.durationMs).toEqual(expect.any(Number));
    expect(c.ok).toBe(true);
  });

  test("a retried request gives two records, the failed attempt first", async () => {
    const calls: CapturedCall[] = [];
    let attempt = 0;
    const inner = new MockLanguageModelV4({
      provider: "openai",
      modelId: "gpt-6-luna",
      doGenerate: async () => {
        attempt += 1;
        if (attempt === 1)
          throw new APICallError({
            message: "overloaded",
            url: "https://example.test",
            requestBodyValues: {},
            statusCode: 503,
            isRetryable: true,
          });
        return {
          content: [{ type: "text", text: "ok" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const base = { kind: "openai", region: "x", model: () => inner, modelId: () => "gpt-6-luna" };
    const ai = withCallCapture(base as unknown as CreatedAi, (c) => calls.push(c));
    const result = await generateText({
      model: ai.model("small", context),
      prompt: "hi",
      maxRetries: 1,
    });
    expect(result.text).toBe("ok");
    expect(calls.map((c) => c.ok)).toEqual([false, true]);
    expect(calls[0]?.error?.message).toContain("overloaded");
  });

  test("a stream is captured whole once it finishes; a throwing capture never breaks the call", async () => {
    const calls: CapturedCall[] = [];
    const fake = createFakeAi({
      logger: quiet,
      modelIds: { small: BEDROCK_LUNA },
      text: "streamed text",
    });
    const ai = withCallCapture(fake, (c) => calls.push(c));
    const r = streamText({ model: ai.model("small", context), prompt: "go" });
    expect(await r.text).toBe("streamed text");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      mode: "stream",
      ok: true,
      response: { text: "streamed text" },
    });

    const throwing = withCallCapture(fake, () => {
      throw new Error("sink down");
    });
    const g = await generateText({ model: throwing.model("small", context), prompt: "go" });
    expect(g.text).toBe("streamed text");
  });
});
