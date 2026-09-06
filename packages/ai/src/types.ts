import type { ModelClass } from "@tj/domain";
import type { LanguageModel } from "ai";
import type pino from "pino";

export interface AiEnv {
  AWS_BEARER_TOKEN_BEDROCK?: string | undefined;
  AWS_REGION?: string | undefined;
  AI_MODEL_FRONTIER?: string | undefined;
  AI_MODEL_STANDARD?: string | undefined;
  AI_MODEL_SMALL?: string | undefined;
}

export interface CreateAiOptions {
  logger?: pino.Logger | undefined;
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
}

export interface ConfiguredAi {
  kind: "bedrock";
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
