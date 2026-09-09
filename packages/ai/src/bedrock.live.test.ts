import { describe, expect, test } from "bun:test";
import { generateText } from "ai";
import { createAi } from "./create-ai";

const apiKey = process.env.AWS_BEARER_TOKEN_BEDROCK?.trim();
const liveSuiteName = apiKey
  ? "bedrock live"
  : "bedrock live — set AWS_BEARER_TOKEN_BEDROCK to run";
/** A real round trip through Bedrock; Bun's 5 s default is not a network budget. */
const LIVE_TIMEOUT_MS = 30_000;

(apiKey ? describe : describe.skip)(liveSuiteName, () => {
  test(
    "generates a short response with the small model",
    async () => {
      const ai = createAi({
        AWS_BEARER_TOKEN_BEDROCK: apiKey,
        AWS_REGION: process.env.AWS_REGION,
        AI_MODEL_SMALL: process.env.AI_MODEL_SMALL,
      });
      const result = await generateText({
        model: ai.model("small"),
        prompt: "Reply with pong.",
        maxOutputTokens: 16,
      });

      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      console.info(
        `Bedrock live usage: input=${result.usage.inputTokens}, output=${result.usage.outputTokens}`,
      );
    },
    LIVE_TIMEOUT_MS,
  );

  // A wrong `standard` id (a bare id for a model that is inference-profile only, say) fails
  // here before it fails every lesson in production.
  test(
    "generates a short response with the standard model",
    async () => {
      const ai = createAi({
        AWS_BEARER_TOKEN_BEDROCK: apiKey,
        AWS_REGION: process.env.AWS_REGION,
        AI_MODEL_STANDARD: process.env.AI_MODEL_STANDARD,
      });
      const result = await generateText({
        model: ai.model("standard"),
        prompt: "Reply with pong.",
        maxOutputTokens: 16,
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );
});
