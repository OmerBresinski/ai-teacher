import { describe, expect, test } from "bun:test";
import { createAi, DEFAULT_MODEL_IDS, DEFAULT_REGION, isAiError } from "./index";

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
