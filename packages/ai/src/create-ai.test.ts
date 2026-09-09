import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { generateText } from "ai";
import pino from "pino";
import {
  createAi,
  DEFAULT_MODEL_IDS,
  DEFAULT_REGION,
  isAiError,
  isAnthropicModelId,
} from "./index";

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

describe("createAi", () => {
  test("returns an unconfigured client when the Bedrock key is absent or blank", () => {
    for (const env of [{}, { AWS_BEARER_TOKEN_BEDROCK: "   " }]) {
      const ai = createAi(env);
      expect(ai.kind).toBe("unconfigured");
      expect(ai.region).toBe(DEFAULT_REGION);
      expect(ai.modelId("small")).toBe(DEFAULT_MODEL_IDS.small);

      try {
        ai.model("small");
        throw new Error("Expected ai.model to throw");
      } catch (error) {
        expect(isAiError(error, "unconfigured")).toBe(true);
        expect(error).toHaveProperty("message");
        expect((error as Error).message).toContain("AWS_BEARER_TOKEN_BEDROCK");
      }
    }
  });

  test("uses default model IDs and region with a configured key", () => {
    const ai = createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key" });
    expect(ai.kind).toBe("bedrock");
    expect(ai.region).toBe(DEFAULT_REGION);
    expect(ai.modelId("frontier")).toBe(DEFAULT_MODEL_IDS.frontier);
    expect(ai.modelId("standard")).toBe(DEFAULT_MODEL_IDS.standard);
    expect(ai.modelId("small")).toBe(DEFAULT_MODEL_IDS.small);
  });

  test("uses non-blank model and region overrides", () => {
    const ai = createAi({
      AWS_BEARER_TOKEN_BEDROCK: "test-key",
      AWS_REGION: " eu-west-1 ",
      AI_MODEL_SMALL: " us.amazon.nova-micro-v1:0 ",
      AI_MODEL_STANDARD: "   ",
    });
    expect(ai.kind).toBe("bedrock");
    expect(ai.region).toBe("eu-west-1");
    expect(ai.modelId("small")).toBe("us.amazon.nova-micro-v1:0");
    expect(ai.modelId("standard")).toBe(DEFAULT_MODEL_IDS.standard);
  });

  test("model(cls, context) is accepted with and without a context on both client kinds", () => {
    const configured = createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key" });
    expect(configured.model("small")).toBeDefined();
    expect(configured.model("small", { lessonId: "l1", stage: "plan" })).toBeDefined();
    const unconfigured = createAi({});
    expect(() => unconfigured.model("small", { lessonId: "l1" })).toThrow();
  });

  test("warns once per unpriced configured model id at boot, and not for the defaults (ADR 0025 §15)", () => {
    const quiet = createMemoryLogger();
    createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key" }, { logger: quiet.logger });
    expect(quiet.lines).toEqual([]);

    const noisy = createMemoryLogger();
    createAi(
      { AWS_BEARER_TOKEN_BEDROCK: "test-key", AI_MODEL_SMALL: "us.amazon.nova-micro-v1:0" },
      { logger: noisy.logger },
    );
    expect(noisy.lines).toHaveLength(1);
    const record = JSON.parse(noisy.lines[0] ?? "") as { level: number; ai: unknown; msg: string };
    expect(record.level).toBe(40);
    expect(record.ai).toEqual({ class: "small", modelId: "us.amazon.nova-micro-v1:0" });
    expect(record.msg).toContain("token cap");
  });

  test("rejects invalid model classes at the package boundary", () => {
    const ai = createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key" });
    try {
      ai.modelId("unknown" as never);
      throw new Error("Expected ai.modelId to throw");
    } catch (error) {
      expect(isAiError(error, "invalid_model")).toBe(true);
    }
  });
});

/** A Claude id an env may still set; the defaults are all GPT-5.6 (TEACH-208). */
const CLAUDE = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

describe("thinking is off for Anthropic models on Bedrock", () => {
  test("isAnthropicModelId matches bare and region-prefixed Anthropic ids only", () => {
    for (const id of [
      "anthropic.claude-sonnet-5",
      "us.anthropic.claude-sonnet-5",
      "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      "apac.anthropic.claude-sonnet-5",
      "global.anthropic.claude-opus-5",
      "us.anthropic.claude-opus-5",
    ]) {
      expect(isAnthropicModelId(id)).toBe(true);
    }
    for (const id of [
      "us.amazon.nova-micro-v1:0",
      "meta.llama3-70b-instruct-v1:0",
      "anthropicx.y",
      // Every default is a GPT-5.6 id (TEACH-205, TEACH-208): none may receive Anthropic settings.
      DEFAULT_MODEL_IDS.small,
      DEFAULT_MODEL_IDS.standard,
      DEFAULT_MODEL_IDS.frontier,
    ]) {
      expect(isAnthropicModelId(id)).toBe(false);
    }
  });

  test("the configured client sends the raw thinking-disabled field to Bedrock", async () => {
    // Capture the request body the Bedrock adapter would send; no network.
    let body: Record<string, unknown> | undefined;
    const fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ message: "captured" }), { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      // No default is Anthropic any more (TEACH-208); an env that sets a Claude id still gets it.
      const ai = createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key", AI_MODEL_SMALL: CLAUDE });
      await generateText({ model: ai.model("small"), prompt: "x", maxRetries: 0 }).catch(
        () => undefined,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(body?.additionalModelRequestFields).toEqual({ thinking: { type: "disabled" } });
  });

  test("a caller's own providerOptions win over the default", async () => {
    let body: Record<string, unknown> | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response("{}", { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    try {
      const ai = createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key", AI_MODEL_SMALL: CLAUDE });
      await generateText({
        model: ai.model("small"),
        prompt: "x",
        maxRetries: 0,
        providerOptions: {
          bedrock: {
            additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: 2048 } },
          },
        },
      }).catch(() => undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(body?.additionalModelRequestFields).toEqual({
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
  });

  test("a default class (GPT-5.6, TEACH-208) is sent no Anthropic fields", async () => {
    let body: Record<string, unknown> | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ message: "captured" }), { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    try {
      const ai = createAi({ AWS_BEARER_TOKEN_BEDROCK: "test-key" });
      await generateText({ model: ai.model("standard"), prompt: "x", maxRetries: 0 }).catch(
        () => undefined,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(body).toBeDefined();
    expect(body?.additionalModelRequestFields).toBeUndefined();
  });
});
