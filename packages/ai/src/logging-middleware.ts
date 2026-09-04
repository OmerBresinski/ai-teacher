import type { ModelClass } from "@tj/domain";
import type { LanguageModelMiddleware } from "ai";
import type pino from "pino";
import { toProviderError } from "./errors";

interface LoggingMiddlewareOptions {
  logger: pino.Logger;
  modelClass: ModelClass;
  modelId: string;
}

/**
 * Token counts are `null` (not `undefined`) when unknown so pino serializes the key: a log line
 * always carries `inputTokens` and `outputTokens`, even on the error path.
 */
interface AiLogFields {
  class: ModelClass;
  modelId: string;
  provider: "bedrock";
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number;
  finishReason: string;
}

function logSuccess(
  logger: pino.Logger,
  options: LoggingMiddlewareOptions,
  startedAt: number,
  usage: {
    inputTokens: { total: number | undefined; cacheRead: number | undefined };
    outputTokens: { total: number | undefined };
  },
  finishReason: string,
) {
  const cachedInputTokens = usage.inputTokens.cacheRead;
  const ai: AiLogFields = {
    class: options.modelClass,
    modelId: options.modelId,
    provider: "bedrock",
    durationMs: Date.now() - startedAt,
    inputTokens: usage.inputTokens.total ?? null,
    outputTokens: usage.outputTokens.total ?? null,
    finishReason,
  };
  if (cachedInputTokens !== undefined) ai.cachedInputTokens = cachedInputTokens;
  logger.info({ ai });
}

function logError(logger: pino.Logger, options: LoggingMiddlewareOptions, startedAt: number) {
  logger.warn({
    ai: {
      class: options.modelClass,
      modelId: options.modelId,
      provider: "bedrock",
      durationMs: Date.now() - startedAt,
      inputTokens: null,
      outputTokens: null,
      finishReason: "error",
    } satisfies AiLogFields,
  });
}

/** Logs only call metadata and token usage; request and response content never leave the SDK. */
export function createLoggingMiddleware(
  options: LoggingMiddlewareOptions,
): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate }) => {
      const startedAt = Date.now();
      try {
        const result = await doGenerate();
        logSuccess(options.logger, options, startedAt, result.usage, result.finishReason.unified);
        return result;
      } catch (error) {
        logError(options.logger, options, startedAt);
        throw toProviderError(error);
      }
    },
    wrapStream: async ({ doStream }) => {
      const startedAt = Date.now();
      try {
        const result = await doStream();
        const reader = result.stream.getReader();
        let logged = false;

        const logStreamError = () => {
          if (logged) return;
          logged = true;
          logError(options.logger, options, startedAt);
        };

        return {
          ...result,
          stream: new ReadableStream({
            async pull(controller) {
              try {
                const next = await reader.read();
                if (next.done) {
                  controller.close();
                  return;
                }
                if (next.value.type === "finish" && !logged) {
                  logged = true;
                  logSuccess(
                    options.logger,
                    options,
                    startedAt,
                    next.value.usage,
                    next.value.finishReason.unified,
                  );
                }
                controller.enqueue(next.value);
              } catch (error) {
                logStreamError();
                controller.error(toProviderError(error));
              }
            },
            async cancel(reason) {
              logStreamError();
              try {
                await reader.cancel(reason);
              } catch (error) {
                throw toProviderError(error);
              }
            },
          }),
        };
      } catch (error) {
        logError(options.logger, options, startedAt);
        throw toProviderError(error);
      }
    },
  };
}
