import type { ModelClass } from "@tj/domain";
import type { LanguageModel } from "ai";
import type pino from "pino";

export interface AiEnv {
  AWS_BEARER_TOKEN_BEDROCK?: string | undefined;
  AWS_REGION?: string | undefined;
  /** Vercel AI Gateway key: routes any `provider/model` id (`google/gemini-3.8-flash`) there. */
  AI_GATEWAY_API_KEY?: string | undefined;
  /** OpenRouter key: routes any `openrouter/<vendor>/<model>` id there (OpenAI-compatible API). */
  OPENROUTER_API_KEY?: string | undefined;
  AI_MODEL_FRONTIER?: string | undefined;
  AI_MODEL_STANDARD?: string | undefined;
  AI_MODEL_SMALL?: string | undefined;
}

export interface CreateAiOptions {
  logger?: pino.Logger | undefined;
  /**
   * A model id to use instead of the class's configured one for this call, or `undefined` to keep
   * it. Lab and eval use only: it lets one run send a stage to a different model.
   */
  route?:
    | ((modelClass: ModelClass, context: AiCallContext | undefined) => string | undefined)
    | undefined;
}

/**
 * What the pipeline knows about a call that the middleware may log beside the usage
 * (ADR 0025 §16). Identifiers and version strings only — never prompt or document content.
 */
export interface AiCallContext {
  lessonId?: string | undefined;
  jobId?: string | undefined;
  stage?: string | undefined;
  promptVersion?: string | undefined;
  /** The reasoning effort the call asked for (`low` / `medium` / `high`), a string for the log. */
  effort?: string | undefined;
}

export interface ConfiguredAi {
  /** `bedrock` when a Bedrock key is set (others may also be); otherwise the one remote that is. */
  kind: "bedrock" | "gateway" | "openrouter";
  region: string;
  /** `context` is carried onto the `ai` log line of every call made through this model. */
  model(modelClass: ModelClass, context?: AiCallContext): LanguageModel;
  modelId(modelClass: ModelClass): string;
}

export interface UnconfiguredAi {
  kind: "unconfigured";
  region: string;
  model(modelClass: ModelClass, context?: AiCallContext): LanguageModel;
  modelId(modelClass: ModelClass): string;
}

export type CreatedAi = ConfiguredAi | UnconfiguredAi;
