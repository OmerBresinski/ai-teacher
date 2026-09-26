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
  isGatewayModelId,
  isOpenAiModelId,
  OPENAI_PREFIX,
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
  test("returns an unconfigured client when every key is absent or blank, naming all three", () => {
    for (const env of [
      {},
      { AWS_BEARER_TOKEN_BEDROCK: "   " },
      { OPENAI_API_KEY: "  " },
      { AI_GATEWAY_API_KEY: "" },
    ]) {
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
        const message = (error as Error).message;
        expect(message).toContain("OPENAI_API_KEY");
        expect(message).toContain("AWS_BEARER_TOKEN_BEDROCK");
        expect(message).toContain("AI_GATEWAY_API_KEY");
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

describe("Vercel AI Gateway ids (the lab's model bench)", () => {
  test("isGatewayModelId is the slash: `provider/model` ids other than `openai/`", () => {
    expect(isGatewayModelId("google/gemini-3.8-flash")).toBe(true);
    expect(isGatewayModelId("anthropic/claude-sonnet-5")).toBe(true);
    // An `openai/` id is decided first (direct when the key is set) and reaches the gateway only
    // as a fallback, so it is not a gateway id by predicate.
    expect(isGatewayModelId("openai/gpt-5.6-luna")).toBe(false);
    for (const id of [
      DEFAULT_MODEL_IDS.small,
      "us.anthropic.claude-sonnet-5",
      "anthropic.claude-sonnet-5",
    ])
      expect(isGatewayModelId(id)).toBe(false);
  });

  test("a gateway key alone configures the client as `gateway`; a Bedrock id then fails at model()", () => {
    const ai = createAi({ AI_GATEWAY_API_KEY: "gw-key", AI_MODEL_SMALL: "openai/gpt-5.6-luna" });
    expect(ai.kind).toBe("gateway");
    expect(ai.model("small")).toBeDefined();
    try {
      ai.model("standard"); // the default Bedrock id, no Bedrock key
      throw new Error("Expected ai.model to throw");
    } catch (error) {
      expect(isAiError(error, "unconfigured")).toBe(true);
      expect((error as Error).message).toContain("AWS_BEARER_TOKEN_BEDROCK");
    }
  });

  test("a Bedrock key alone keeps `bedrock` and rejects a gateway id at model()", () => {
    const ai = createAi({
      AWS_BEARER_TOKEN_BEDROCK: "test-key",
      AI_MODEL_SMALL: "google/gemini-3.8-flash",
    });
    expect(ai.kind).toBe("bedrock");
    try {
      ai.model("small");
      throw new Error("Expected ai.model to throw");
    } catch (error) {
      expect(isAiError(error, "unconfigured")).toBe(true);
      expect((error as Error).message).toContain("AI_GATEWAY_API_KEY");
    }
  });

  test("both keys: each id goes to its own provider, and the gateway request carries the id", async () => {
    const urls: string[] = [];
    const requests: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url instanceof Request ? url.url : url));
      // The gateway names the model in a header or the path, Bedrock in the path: search all of it.
      requests.push(JSON.stringify({ url: urls.at(-1), headers: init?.headers, body: init?.body }));
      return new Response("{}", { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    try {
      const ai = createAi({
        AWS_BEARER_TOKEN_BEDROCK: "test-key",
        AI_GATEWAY_API_KEY: "gw-key",
        AI_MODEL_SMALL: "google/gemini-3.8-flash",
      });
      expect(ai.kind).toBe("bedrock");
      await generateText({ model: ai.model("small"), prompt: "x", maxRetries: 0 }).catch(
        () => undefined,
      );
      expect(urls[0]).toContain("ai-gateway.vercel.sh");
      expect(requests[0]).toContain("google/gemini-3.8-flash");
      await generateText({ model: ai.model("standard"), prompt: "x", maxRetries: 0 }).catch(
        () => undefined,
      );
      expect(urls[1]).toContain("bedrock");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("route(cls, context) swaps the model id for one call and the log line shows the id used", async () => {
    const { lines, logger } = createMemoryLogger();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("{}", { status: 500 })) as unknown as typeof globalThis.fetch;
    try {
      const ai = createAi(
        { AWS_BEARER_TOKEN_BEDROCK: "test-key", AI_GATEWAY_API_KEY: "gw-key" },
        {
          logger,
          route: (_cls, context) =>
            context?.stage === "generate" ? "google/gemini-3.8-flash" : undefined,
        },
      );
      await generateText({
        model: ai.model("small", { stage: "generate" }),
        prompt: "x",
        maxRetries: 0,
      }).catch(() => undefined);
      await generateText({
        model: ai.model("small", { stage: "plan" }),
        prompt: "x",
        maxRetries: 0,
      }).catch(() => undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
    const ids = lines
      .map((l) => JSON.parse(l) as { ai?: { modelId?: string } })
      .map((r) => r.ai?.modelId)
      .filter(Boolean);
    expect(ids).toEqual(["google/gemini-3.8-flash", DEFAULT_MODEL_IDS.small]);
  });
});

/** Captures every request the SDK would send; the response is a 500 so nothing is parsed. */
function captureFetch() {
  const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url instanceof Request ? url.url : url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body ?? ""),
    });
    return new Response("{}", { status: 500 });
  }) as unknown as typeof globalThis.fetch;
  return { requests, fetch };
}

describe("OpenAI direct (`openai/<model>` ids, ADR 0031)", () => {
  test("isOpenAiModelId is the `openai/` prefix", () => {
    expect(OPENAI_PREFIX).toBe("openai/");
    expect(isOpenAiModelId("openai/gpt-5.6-luna")).toBe(true);
    expect(isOpenAiModelId("openai/gpt-6-sol")).toBe(true);
    for (const id of [DEFAULT_MODEL_IDS.small, "google/gemini-3.8-flash", "openai.gpt-5.6-luna"])
      expect(isOpenAiModelId(id)).toBe(false);
  });

  test("A1: an OpenAI key serves the id from api.openai.com with the prefix stripped and the bearer key", async () => {
    const { requests, fetch } = captureFetch();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const ai = createAi({ OPENAI_API_KEY: "k", AI_MODEL_SMALL: "openai/gpt-5.6-luna" });
      expect(ai.kind).toBe("openai");
      await generateText({ model: ai.model("small"), prompt: "x", maxRetries: 0 }).catch(
        () => undefined,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url.startsWith("https://api.openai.com/v1/")).toBe(true);
    expect(request?.body).toContain('"model":"gpt-5.6-luna"');
    expect(request?.body).not.toContain("openai/");
    expect(request?.headers.authorization).toBe("Bearer k");
  });

  test("A2: the same client rejects the default Bedrock id at model(), naming the Bedrock variable", () => {
    const ai = createAi({ OPENAI_API_KEY: "k", AI_MODEL_SMALL: "openai/gpt-5.6-luna" });
    try {
      ai.model("standard");
      throw new Error("Expected ai.model to throw");
    } catch (error) {
      expect(isAiError(error, "unconfigured")).toBe(true);
      expect((error as Error).message).toContain("AWS_BEARER_TOKEN_BEDROCK");
    }
  });

  test("A3: with only a gateway key an `openai/` id still goes through the gateway (fallback)", async () => {
    const { requests, fetch } = captureFetch();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const ai = createAi({ AI_GATEWAY_API_KEY: "g", AI_MODEL_SMALL: "openai/gpt-5.6-luna" });
      expect(ai.kind).toBe("gateway");
      await generateText({ model: ai.model("small"), prompt: "x", maxRetries: 0 }).catch(
        () => undefined,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(requests[0]?.url).toContain("ai-gateway.vercel.sh");
    expect(JSON.stringify(requests[0])).toContain("openai/gpt-5.6-luna");
  });

  test("A4: all three keys: `openai` kind, and each id reaches its own provider", async () => {
    const { requests, fetch } = captureFetch();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const ai = createAi({
        OPENAI_API_KEY: "k",
        AI_GATEWAY_API_KEY: "g",
        AWS_BEARER_TOKEN_BEDROCK: "b",
        AI_MODEL_SMALL: "openai/gpt-5.6-luna",
        AI_MODEL_FRONTIER: "google/gemini-3.8-flash",
      });
      expect(ai.kind).toBe("openai");
      for (const cls of ["small", "frontier", "standard"] as const) {
        await generateText({ model: ai.model(cls), prompt: "x", maxRetries: 0 }).catch(
          () => undefined,
        );
      }
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(requests.map((r) => r.url)).toHaveLength(3);
    expect(requests[0]?.url).toContain("api.openai.com");
    expect(requests[1]?.url).toContain("ai-gateway.vercel.sh");
    expect(requests[2]?.url).toContain("bedrock");
  });

  test("A5: an `openai/` id with only a Bedrock key fails at model() naming OPENAI_API_KEY and the id", () => {
    const ai = createAi({ AWS_BEARER_TOKEN_BEDROCK: "b", AI_MODEL_SMALL: "openai/gpt-5.6-luna" });
    expect(ai.kind).toBe("bedrock");
    try {
      ai.model("small");
      throw new Error("Expected ai.model to throw");
    } catch (error) {
      expect(isAiError(error, "unconfigured")).toBe(true);
      expect((error as Error).message).toContain("OPENAI_API_KEY");
      expect((error as Error).message).toContain('"openai/gpt-5.6-luna"');
    }
  });

  test("A7: the `ai` log line names the routed id and an openai provider, never the key or prompt", async () => {
    const { lines, logger } = createMemoryLogger();
    const { fetch } = captureFetch();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const ai = createAi(
        { OPENAI_API_KEY: "k-secret-value", AI_MODEL_SMALL: "openai/gpt-5.6-luna" },
        { logger },
      );
      await generateText({
        model: ai.model("small"),
        prompt: "private prompt text",
        maxRetries: 0,
      }).catch(() => undefined);
    } finally {
      globalThis.fetch = realFetch;
    }
    const records = lines.map((l) => JSON.parse(l) as { ai?: Record<string, unknown> });
    const record = records.find((r) => r.ai?.modelId !== undefined);
    expect(record?.ai).toMatchObject({ modelId: "openai/gpt-5.6-luna" });
    expect(String(record?.ai?.provider)).toContain("openai");
    const text = lines.join("\n");
    expect(text).not.toContain("authorization");
    expect(text).not.toContain("k-secret-value");
    expect(text).not.toContain("private prompt text");
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
