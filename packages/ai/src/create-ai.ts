import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { ModelClass, ModelClassSchema, type ModelClass as ModelClassType } from "@tj/domain";
import type { LanguageModel } from "ai";
import { wrapLanguageModel } from "ai";
import pino from "pino";
import { AiError } from "./errors";
import { createLoggingMiddleware } from "./logging-middleware";
import type {
  AiCallContext,
  AiEnv,
  ConfiguredAi,
  CreateAiOptions,
  CreatedAi,
  UnconfiguredAi,
} from "./types";

export const DEFAULT_REGION = "us-east-1";

export const DEFAULT_MODEL_IDS = {
  [ModelClass.frontier]: "us.anthropic.claude-opus-5",
  [ModelClass.standard]: "us.anthropic.claude-sonnet-5",
  [ModelClass.small]: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
} as const satisfies Record<ModelClassType, string>;

type ModelIds = Record<ModelClassType, string>;
type WrappableLanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];

interface ConfiguredAiOptions {
  region: string;
  modelIds: ModelIds;
  logger: pino.Logger;
  createModel(
    modelClass: ModelClassType,
    modelId: string,
    context: AiCallContext | undefined,
  ): WrappableLanguageModel;
}

function requireModelClass(modelClass: ModelClassType): ModelClassType {
  const parsed = ModelClassSchema.safeParse(modelClass);
  if (parsed.success) return parsed.data;
  throw new AiError("invalid_model", `Unknown model class: ${String(modelClass)}`);
}

function modelIdsFromEnv(env: AiEnv): ModelIds {
  return {
    frontier: env.AI_MODEL_FRONTIER?.trim() || DEFAULT_MODEL_IDS.frontier,
    standard: env.AI_MODEL_STANDARD?.trim() || DEFAULT_MODEL_IDS.standard,
    small: env.AI_MODEL_SMALL?.trim() || DEFAULT_MODEL_IDS.small,
  };
}

function unconfiguredAi(region: string, modelIds: ModelIds): UnconfiguredAi {
  return {
    kind: "unconfigured",
    region,
    modelId(modelClass) {
      return modelIds[requireModelClass(modelClass)];
    },
    model() {
      throw new AiError(
        "unconfigured",
        "AI is not configured: set AWS_BEARER_TOKEN_BEDROCK to use Bedrock models",
      );
    },
  };
}

/** Builds a configured client around a model factory; used by the Bedrock adapter and test fake. */
export function createConfiguredAi(options: ConfiguredAiOptions): ConfiguredAi {
  return {
    kind: "bedrock",
    region: options.region,
    modelId(modelClass) {
      return options.modelIds[requireModelClass(modelClass)];
    },
    model(modelClass, context): LanguageModel {
      const modelClassValue = requireModelClass(modelClass);
      const modelId = options.modelIds[modelClassValue];
      return wrapLanguageModel({
        model: options.createModel(modelClassValue, modelId, context),
        middleware: createLoggingMiddleware({
          logger: options.logger,
          modelClass: modelClassValue,
          modelId,
          context,
        }),
      });
    },
  };
}

/**
 * Creates the Bedrock-backed model client from explicit environment values. It never reads
 * `process.env`, allowing apps to validate their environment at boot and tests to be deterministic.
 */
export function createAi(env: AiEnv, options: CreateAiOptions = {}): CreatedAi {
  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  const region = env.AWS_REGION?.trim() || DEFAULT_REGION;
  const modelIds = modelIdsFromEnv(env);
  if (!apiKey) return unconfiguredAi(region, modelIds);

  const logger = options.logger ?? pino({ level: "silent" });
  const bedrock = createAmazonBedrock({ apiKey, region });
  return createConfiguredAi({
    region,
    modelIds,
    logger,
    createModel: (_modelClass, modelId) => bedrock(modelId),
  });
}
