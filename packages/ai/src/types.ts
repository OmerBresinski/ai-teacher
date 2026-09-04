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

export interface ConfiguredAi {
  kind: "bedrock";
  region: string;
  model(modelClass: ModelClass): LanguageModel;
  modelId(modelClass: ModelClass): string;
}

export interface UnconfiguredAi {
  kind: "unconfigured";
  region: string;
  model(modelClass: ModelClass): LanguageModel;
  modelId(modelClass: ModelClass): string;
}

export type CreatedAi = ConfiguredAi | UnconfiguredAi;
