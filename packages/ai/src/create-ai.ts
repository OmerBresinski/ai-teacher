import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createOpenAI } from "@ai-sdk/openai";
import { ModelClass, ModelClassSchema, type ModelClass as ModelClassType } from "@tj/domain";
import type { LanguageModel } from "ai";
import { createGateway, defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import pino from "pino";
import { AiError } from "./errors";
import { createLoggingMiddleware } from "./logging-middleware";
import { isPriced } from "./prices";
import type {
  AiCallContext,
  AiEnv,
  ConfiguredAi,
  CreateAiOptions,
  CreatedAi,
  UnconfiguredAi,
} from "./types";

export const DEFAULT_REGION = "us-east-1";

/**
 * The GPT-5.6 family on Bedrock (founder decision 9 Sept 2026; Generation quality §6; TEACH-208).
 * Inference-profile (`us.`) ids: the bare `openai.` ids are not invocable on-demand in
 * `us-east-1`, and structured output was verified on each of these before they were written.
 * `frontier` is the eval judge only; no production stage calls it.
 */
export const DEFAULT_MODEL_IDS = {
  [ModelClass.frontier]: "us.openai.gpt-5.6-sol",
  [ModelClass.standard]: "us.openai.gpt-5.6-terra",
  [ModelClass.small]: "us.openai.gpt-5.6-luna",
} as const satisfies Record<ModelClassType, string>;

type ModelIds = Record<ModelClassType, string>;
type WrappableLanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];

interface ConfiguredAiOptions {
  kind: ConfiguredAi["kind"];
  region: string;
  modelIds: ModelIds;
  logger: pino.Logger;
  route?: CreateAiOptions["route"];
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
        "AI is not configured: set AWS_BEARER_TOKEN_BEDROCK for Bedrock ids, AI_GATEWAY_API_KEY for `provider/model` ids, or OPENROUTER_API_KEY for `openrouter/…` ids",
      );
    },
  };
}

/** Builds a configured client around a model factory; used by the Bedrock adapter and test fake. */
export function createConfiguredAi(options: ConfiguredAiOptions): ConfiguredAi {
  return {
    kind: options.kind,
    region: options.region,
    modelId(modelClass) {
      return options.modelIds[requireModelClass(modelClass)];
    },
    model(modelClass, context): LanguageModel {
      const modelClassValue = requireModelClass(modelClass);
      const modelId =
        options.route?.(modelClassValue, context) ?? options.modelIds[modelClassValue];
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
 * ADR 0025 §15: a configured model id with no entry in `PRICES` is capped by tokens instead of
 * USD. Said once at boot, per class, so the fallback is never silent.
 */
function warnUnpricedModels(logger: pino.Logger, modelIds: ModelIds): void {
  for (const [modelClass, modelId] of Object.entries(modelIds)) {
    if (isPriced(modelId)) continue;
    logger.warn(
      { ai: { class: modelClass, modelId } },
      "model id has no list price in @tj/ai PRICES; lesson budgets fall back to the token cap",
    );
  }
}

/** An OpenRouter id is `openrouter/<vendor>/<model>`; the prefix is ours, the rest is theirs. */
export const OPENROUTER_PREFIX = "openrouter/";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function isOpenRouterModelId(modelId: string): boolean {
  return modelId.startsWith(OPENROUTER_PREFIX);
}

/** A Vercel AI Gateway id is `provider/model`; a Bedrock id never contains a slash. */
export function isGatewayModelId(modelId: string): boolean {
  return modelId.includes("/") && !isOpenRouterModelId(modelId);
}

/**
 * Creates the model client from explicit environment values. It never reads `process.env`,
 * allowing apps to validate their environment at boot and tests to be deterministic. A Bedrock
 * key serves ids without a slash; a Vercel AI Gateway key serves `provider/model` ids and an
 * OpenRouter key serves `openrouter/<vendor>/<model>` ids (the lab's model bench); any one key
 * configures the client, and a class whose id needs a missing key fails at `model()`, not at boot.
 */
export function createAi(env: AiEnv, options: CreateAiOptions = {}): CreatedAi {
  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim();
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  const region = env.AWS_REGION?.trim() || DEFAULT_REGION;
  const modelIds = modelIdsFromEnv(env);
  if (!apiKey && !gatewayKey && !openRouterKey) return unconfiguredAi(region, modelIds);

  const logger = options.logger ?? pino({ level: "silent" });
  warnUnpricedModels(logger, modelIds);
  const bedrock = apiKey ? createAmazonBedrock({ apiKey, region }) : undefined;
  const gateway = gatewayKey ? createGateway({ apiKey: gatewayKey }) : undefined;
  const openRouter = openRouterKey
    ? createOpenAI({ apiKey: openRouterKey, baseURL: OPENROUTER_BASE_URL, name: "openrouter" })
    : undefined;
  return createConfiguredAi({
    kind: bedrock ? "bedrock" : gateway ? "gateway" : "openrouter",
    region,
    modelIds,
    logger,
    route: options.route,
    createModel: (_modelClass, modelId) => {
      if (isOpenRouterModelId(modelId)) {
        if (!openRouter)
          throw new AiError(
            "unconfigured",
            `model id "${modelId}" needs OPENROUTER_API_KEY (OpenRouter)`,
          );
        return openRouter.chat(modelId.slice(OPENROUTER_PREFIX.length));
      }
      if (isGatewayModelId(modelId)) {
        if (!gateway)
          throw new AiError(
            "unconfigured",
            `model id "${modelId}" needs AI_GATEWAY_API_KEY (Vercel AI Gateway)`,
          );
        return gateway(modelId);
      }
      if (!bedrock)
        throw new AiError(
          "unconfigured",
          `model id "${modelId}" needs AWS_BEARER_TOKEN_BEDROCK (Bedrock)`,
        );
      const model = bedrock(modelId);
      if (!isAnthropicModelId(modelId)) return model;
      return wrapLanguageModel({
        model,
        middleware: defaultSettingsMiddleware({ settings: { providerOptions: NO_THINKING } }),
      });
    },
  });
}

/**
 * Anthropic models on Bedrock from the Sonnet 5 generation think before they answer unless told
 * not to, and the thinking is billed against `maxOutputTokens`: a structured call with a 4 000
 * token cap can spend all of it thinking and return an empty body, which the caller sees as a
 * schema miss (ADR 0025 §14) after paying for both attempts. Every call this package makes asks
 * for JSON in a fixed shape, where hidden reasoning buys nothing, so it is off by default. The
 * SDK's `reasoningConfig: { type: "disabled" }` is not honoured by the adapter for these ids;
 * the raw request field is. A caller that wants thinking passes its own `providerOptions`, which
 * `defaultSettingsMiddleware` lets win.
 */
export const NO_THINKING = {
  bedrock: { additionalModelRequestFields: { thinking: { type: "disabled" } } },
} as const;

/**
 * `anthropic.…` or any inference-profile-prefixed Anthropic id: `us.`, `eu.`, `apac.`, `global.`
 * — the prefix is one lower-case word, not always two letters.
 */
export function isAnthropicModelId(modelId: string): boolean {
  return /^(?:[a-z]+\.)?anthropic\./.test(modelId);
}
