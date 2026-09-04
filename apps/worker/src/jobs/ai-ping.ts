import { isAiError } from "@tj/ai";
import { defineJob, NonRetryableError } from "@tj/jobs";
import { generateText } from "ai";
import type { WorkerDeps } from "../deps";

/** One bounded model call proving the configured Bedrock path (ADR 0018 §7). */
export const aiPingJob = defineJob<"ai.ping", WorkerDeps>(
  "ai.ping",
  async ({ payload, signal, progress, deps }) => {
    if (signal.aborted) return;

    try {
      const modelId = deps.ai.modelId(payload.class);
      await progress(10, `calling ${modelId}`);
      if (deps.ai.kind === "unconfigured") {
        throw new NonRetryableError(
          "AI provider is not configured (AWS_BEARER_TOKEN_BEDROCK unset)",
        );
      }

      const result = await generateText({
        model: deps.ai.model(payload.class),
        prompt: payload.prompt,
        maxOutputTokens: 32,
        abortSignal: signal,
      });
      if (signal.aborted) return;

      await progress(
        100,
        `${modelId}: in=${result.usage.inputTokens} out=${result.usage.outputTokens} finish=${result.finishReason}`,
      );
    } catch (error) {
      if (isAiError(error) && (error.code === "unconfigured" || error.code === "invalid_model")) {
        throw new NonRetryableError(error.message);
      }
      throw error;
    }
  },
);
