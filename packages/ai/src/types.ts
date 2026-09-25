import type { ModelClass } from "@tj/domain";
import type { LanguageModel } from "ai";
import type pino from "pino";

export interface AiEnv {
  AWS_BEARER_TOKEN_BEDROCK?: string | undefined;
  AWS_REGION?: string | undefined;
  /** OpenAI key: serves `openai/<model>` ids directly (ADR 0031). */
  OPENAI_API_KEY?: string | undefined;
  /**
   * Vercel AI Gateway key: routes any other `provider/model` id (`google/gemini-3.8-flash`)
   * there, and `openai/` ids when no OpenAI key is set.
   */
  AI_GATEWAY_API_KEY?: string | undefined;
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
  /** The reasoning effort the call asked for (`none` … `high`), a string for the log. */
  effort?: string | undefined;
}

export interface ConfiguredAi {
  /**
   * The boot log's word for the client: `openai` when an OpenAI key is set (others may also
   * be), else `bedrock` when the Bedrock key is, else `gateway` (ADR 0031 §7). Which provider a
   * call actually reaches is decided per model id in `model()`.
   */
  kind: "openai" | "bedrock" | "gateway";
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
