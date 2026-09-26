import { describe, expect, test } from "bun:test";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createAi } from "./create-ai";

/**
 * The credentialed smoke test for the direct OpenAI route (ADR 0031 §8). Skipped, with the reason
 * in the suite name, unless `OPENAI_API_KEY` is set: CI holds no OpenAI secret and must never
 * spend. One run costs well under a cent. Run it by hand:
 *
 *   OPENAI_API_KEY=… bun test packages/ai/src/openai.live.test.ts
 */
const apiKey = process.env.OPENAI_API_KEY?.trim();
const liveSuiteName = apiKey ? "openai live" : "openai live — set OPENAI_API_KEY to run";
/** A real round trip; Bun's 5 s default is not a network budget. */
const LIVE_TIMEOUT_MS = 30_000;
const SMALL = process.env.AI_MODEL_SMALL?.trim() || "openai/gpt-6-luna";

(apiKey ? describe : describe.skip)(liveSuiteName, () => {
  test(
    "a pong from the small model at reasoningEffort none",
    async () => {
      const ai = createAi({ OPENAI_API_KEY: apiKey, AI_MODEL_SMALL: SMALL });
      expect(ai.kind).toBe("openai");
      const result = await generateText({
        model: ai.model("small", { effort: "none" }),
        prompt: "Reply with pong.",
        maxOutputTokens: 16,
        providerOptions: { openai: { reasoningEffort: "none" } },
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      console.info(
        `OpenAI live usage: input=${result.usage.inputTokens}, output=${result.usage.outputTokens}`,
      );
    },
    LIVE_TIMEOUT_MS,
  );

  // The pipeline's schemas have optional fields; strict mode refuses those, so `callStructured`
  // sends `strictJsonSchema: false` and zod validates the answer. This proves that pairing works.
  test(
    "an Output.object call with an optional field returns a valid object non-strict",
    async () => {
      const ai = createAi({ OPENAI_API_KEY: apiKey, AI_MODEL_SMALL: SMALL });
      const schema = z.object({ answer: z.string(), note: z.string().optional() });
      const result = await generateText({
        model: ai.model("small", { effort: "none" }),
        prompt: 'Answer with JSON: {"answer": "pong"}.',
        output: Output.object({ schema }),
        maxOutputTokens: 64,
        providerOptions: { openai: { reasoningEffort: "none", strictJsonSchema: false } },
      });
      expect(schema.safeParse(result.output).success).toBe(true);
      expect(result.output.answer.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT_MS,
  );
});
