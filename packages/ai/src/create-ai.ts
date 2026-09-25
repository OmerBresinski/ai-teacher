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
        "AI is not configured: set OPENAI_API_KEY for openai/ ids, AWS_BEARER_TOKEN_BEDROCK for Bedrock ids, or AI_GATEWAY_API_KEY for other provider/model ids",
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

/**
 * An OpenAI id is `openai/<model>` (`openai/gpt-5.6-luna`): served directly from OpenAI's API
 * with the prefix stripped (ADR 0031), or by the gateway as a fallback when only its key is set.
 */
export const OPENAI_PREFIX = "openai/";

export function isOpenAiModelId(modelId: string): boolean {
  return modelId.startsWith(OPENAI_PREFIX);
}

/**
 * A Vercel AI Gateway id is any other `provider/model`; a Bedrock id never contains a slash.
 * An `openai/` id is not one: it is decided first in `createAi` and only falls back to the
 * gateway when there is no OpenAI key.
 */
export function isGatewayModelId(modelId: string): boolean {
  return modelId.includes("/") && !isOpenAiModelId(modelId);
}

/**
 * Creates the model client from explicit environment values. It never reads `process.env`,
 * allowing apps to validate their environment at boot and tests to be deterministic. An OpenAI
 * key serves `openai/<model>` ids directly (ADR 0031); a Bedrock key serves ids without a slash;
 * a Vercel AI Gateway key serves every other `provider/model` id (the lab's model bench) and
 * stands in for `openai/` ids when no OpenAI key is set. Any one key configures the client, and a
 * class whose id needs a missing key fails at `model()`, not at boot.
 */
export function createAi(env: AiEnv, options: CreateAiOptions = {}): CreatedAi {
  const apiKey = env.AWS_BEARER_TOKEN_BEDROCK?.trim();
  const openAiKey = env.OPENAI_API_KEY?.trim();
  const gatewayKey = env.AI_GATEWAY_API_KEY?.trim();
  const region = env.AWS_REGION?.trim() || DEFAULT_REGION;
  const modelIds = modelIdsFromEnv(env);
  if (!apiKey && !openAiKey && !gatewayKey) return unconfiguredAi(region, modelIds);

  const logger = options.logger ?? pino({ level: "silent" });
  warnUnpricedModels(logger, modelIds);
  const openai = openAiKey ? createOpenAI({ apiKey: openAiKey }) : undefined;
  const bedrock = apiKey ? createAmazonBedrock({ apiKey, region }) : undefined;
  const gateway = gatewayKey ? createGateway({ apiKey: gatewayKey }) : undefined;
  return createConfiguredAi({
    kind: openai ? "openai" : bedrock ? "bedrock" : "gateway",
    region,
    modelIds,
    logger,
    route: options.route,
    createModel: (_modelClass, modelId) => {
      // Before the gateway check: an `openai/` id also contains a slash.
      if (isOpenAiModelId(modelId)) {
        // The chat completions API: `.responses()` is a batch model in @ai-sdk/openai 4.0.58.
        if (openai) return openai.chat(modelId.slice(OPENAI_PREFIX.length));
        if (!gateway)
          throw new AiError("unconfigured", `model id "${modelId}" needs OPENAI_API_KEY (OpenAI)`);
        return gateway(modelId);
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
