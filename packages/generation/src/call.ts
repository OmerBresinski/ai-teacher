import { isAnthropicModelId } from "@tj/ai";
import type { ModelClass } from "@tj/domain";
import { generateText, NoObjectGeneratedError, Output, type OutputInterface } from "ai";
import type { z } from "zod";
import { type JsonRepairKind, repairJsonText } from "./repair-json";
import {
  BudgetExceeded,
  callContext,
  type PipelineDeps,
  StageFailure,
  type StageName,
  throwIfAborted,
} from "./types";

/*
 * One structured model call (ADR 0025 §14): `generateText` with `Output.object`, the budget
 * consulted before and charged after every attempt, a deterministic repair of the text before
 * validation (`repair-json.ts`), one retry on a schema miss with the validation issues in
 * context, and a typed `StageFailure` on the second miss. Nothing about the prompt or the model's
 * text is logged (ADR 0015); only the issue messages travel back into the retry prompt.
 */

export interface StructuredPrompt<I> {
  version: string;
  system: string;
  user(input: I): string;
}

/**
 * How hard the model may think on one call (Generation quality §6). Required on every call so no
 * stage is left at the provider's default by omission; the per-stage values are the project's
 * table, set at the call sites, never in a prompt. Carried to Bedrock as
 * `providerOptions.bedrock.reasoningConfig.maxReasoningEffort`, which `@ai-sdk/amazon-bedrock`
 * maps to `reasoning.effort` for an OpenAI id and `output_config.effort` for an Anthropic one.
 * `xhigh` / `max` are not offered: nothing in the pipeline needs them.
 */
export type ReasoningEffort = "low" | "medium" | "high";

export interface CallStructuredOptions<I, T> {
  deps: Pick<PipelineDeps, "ai" | "budget" | "signal" | "logger" | "context">;
  stage: StageName;
  cls: ModelClass;
  effort: ReasoningEffort;
  prompt: StructuredPrompt<I>;
  input: I;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number | undefined;
}

export interface CallResult<T> {
  output: T;
  usage: CallUsage;
  /** 1 or 2: how many attempts the call took. */
  attempts: number;
  modelId: string;
}

/** The token caps per stage (ticket guidance); a slide or repair answer is small by design. */
export const MAX_OUTPUT_TOKENS = {
  // At most three one-sentence findings.
  checkInput: 400,
  // The skeleton (4 objectives, up to 16 outline entries each with a brief and a phase) is under
  // a thousand tokens; the facts (5 key ideas, 4 misconceptions, 8 terms, 4 worked examples, up to
  // 20 questions with distractors, the pitch, the outline refs) ~5 000 pretty-printed. Room left
  // so the cap is never the reason a call fails (TEACH-211).
  planSkeleton: 2500,
  planFacts: 7000,
  slide: 1500,
  worksheet: 4000,
  evaluate: 2000,
  repair: 1500,
} as const;

const RETRY_PREFIX = "\n\nYour previous answer did not validate:\n";
/**
 * The retry's closing instruction. The misses seen in production are shape misses (a list or the
 * whole answer given as a string, a key left out), so the reminder is about shape, not content.
 * Schema-neutral on purpose: some lists hold strings and some keys are optional.
 */
const RETRY_SUFFIX =
  "\n\nAnswer again with the complete answer as one JSON object in the shape shown. Lists are JSON arrays, never strings containing JSON; do not wrap the answer or any part of it in a string; no prose.";

/**
 * `Output.object` with a repair pass: when the text fails to parse or validate, `repairJsonText`
 * is tried once and, if the repaired text validates, that answer is returned and `onRepair` told
 * what was done. A repaired text that still fails rethrows the *original* error, so the retry
 * prompt describes what the model actually sent.
 */
function repairingObjectOutput<T>(
  schema: z.ZodType<T>,
  onRepair: (repairs: JsonRepairKind[]) => void,
): OutputInterface<T> {
  const inner = Output.object({ schema });
  return {
    name: inner.name,
    responseFormat: inner.responseFormat,
    parsePartialOutput: (options) => inner.parsePartialOutput(options),
    createElementStreamTransform: () => inner.createElementStreamTransform(),
    async parseCompleteOutput(options, context) {
      try {
        return await inner.parseCompleteOutput(options, context);
      } catch (error) {
        const repaired = repairJsonText(options.text);
        if (repaired.text === null) throw error;
        try {
          const output = await inner.parseCompleteOutput({ text: repaired.text }, context);
          onRepair(repaired.repairs);
          return output;
        } catch {
          throw error;
        }
      }
    },
  };
}

export async function callStructured<I, T>(
  options: CallStructuredOptions<I, T>,
): Promise<CallResult<T>> {
  const { deps, stage, cls, effort, prompt, input, schema, maxOutputTokens } = options;
  // Cancel is checked between model calls (ADR 0025 §5); the fake ignores `abortSignal`, so the
  // check is here rather than trusted to the provider.
  throwIfAborted(deps.signal);
  const exceeded = deps.budget.exceeded();
  if (exceeded) throw new BudgetExceeded(exceeded.by);
  const modelId = deps.ai.modelId(cls);
  const model = deps.ai.model(cls, callContext(deps, stage, prompt.version, effort));
  const userText = prompt.user(input);
  const output = repairingObjectOutput(schema, (repairs) => {
    // Repair kinds only — never the text (ADR 0015). Counted so a model change that makes the
    // quirk common (or rare) shows up in the logs.
    deps.logger.info(
      { stage, promptVersion: prompt.version, repairs },
      "structured output repaired before validation",
    );
  });

  const attempt = async (text: string): Promise<CallResult<T>> => {
    const result = await generateText({
      model,
      system: prompt.system,
      prompt: text,
      output,
      abortSignal: deps.signal,
      maxOutputTokens,
      // The same effort on the retry: a schema miss is a shape problem, not a thinking one.
      ...providerOptionsFor(modelId, effort),
    });
    const usage = usageOf(result.usage);
    deps.budget.charge(modelId, usage);
    return { output: result.output, usage, attempts: 1, modelId };
  };

  try {
    return await attempt(userText);
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    // The failed attempt was still paid for. `error.text` (the model's words) is never logged.
    if (error.usage) deps.budget.charge(modelId, usageOf(error.usage));
    const issues = issuesOf(error);
    // The issues are logged in full: zod paths and messages (`workedExamples.1.steps.2: Too big …`),
    // with the one message that would echo the model's words redacted (see `issuesOf`). Without
    // them a schema miss in production cannot be diagnosed (the 2026-09-07 derivatives lesson
    // failed Plan twice with only `issues=5` on record).
    deps.logger.info(
      { stage, promptVersion: prompt.version, issues: issuesOf(error, "log") },
      "structured output did not validate; retrying once",
    );
    // The retry is a second model call: the same two gates apply before it.
    throwIfAborted(deps.signal);
    const exceededNow = deps.budget.exceeded();
    if (exceededNow) throw new BudgetExceeded(exceededNow.by);
    try {
      const second = await attempt(`${userText}${RETRY_PREFIX}${issues.join("\n")}${RETRY_SUFFIX}`);
      return { ...second, attempts: 2 };
    } catch (again) {
      if (!NoObjectGeneratedError.isInstance(again)) throw again;
      if (again.usage) deps.budget.charge(modelId, usageOf(again.usage));
      // pino's `err` serializer drops a non-Error `cause`, so the second miss is logged here.
      deps.logger.warn(
        { stage, promptVersion: prompt.version, issues: issuesOf(again, "log") },
        "structured output did not validate on the retry; giving up",
      );
      throw new StageFailure(
        stage,
        `${stage}: the model did not produce a valid ${prompt.version} answer in two attempts`,
        { cause: issuesOf(again) },
      );
    }
  }
}

/**
 * The provider options one call sends. For an OpenAI id `@ai-sdk/amazon-bedrock` maps
 * `reasoningConfig.maxReasoningEffort` to `reasoning.effort`. For an Anthropic id it would write
 * `output_config.effort`, which the Haiku the `small` class still runs on may not accept, and
 * `@tj/ai` already disables thinking on those ids (`NO_THINKING`) so effort has nothing to act on:
 * nothing is sent and the call runs as it did before. The `effort` still reaches the log through
 * the call context. Dead for the pipeline once every class is a GPT-5.6 id (Generation quality §6).
 */
function providerOptionsFor(modelId: string, effort: ReasoningEffort) {
  if (isAnthropicModelId(modelId)) return {};
  return { providerOptions: { bedrock: { reasoningConfig: { maxReasoningEffort: effort } } } };
}

function usageOf(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
}): CallUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.cachedInputTokens,
  };
}

/**
 * The validation issues from a schema miss as plain messages with paths — what the retry prompt
 * shows the model. A JSON parse failure yields one line. Never the model's text.
 *
 * `audience: "log"` is the ADR 0015 variant: every zod message is schema-derived (limits, expected
 * types, our own refinement text) except `unrecognized_keys`, whose message repeats the key names
 * the model invented — those are replaced by a count. The retry prompt keeps them: the model needs
 * to know which keys to drop.
 *
 * After a wrong type on a path, the follow-on checks on that path are dropped: zod keeps checking
 * a mistyped value as if it were right (`expected array, received string` followed by `Too big:
 * expected string to have <=4 characters` for the same field), and the second line would send
 * the model the wrong way. Distinct refinement failures on one path are all kept.
 */
export function issuesOf(
  error: NoObjectGeneratedError,
  audience: "retry" | "log" = "retry",
): string[] {
  const cause = error.cause as
    | { issues?: { path?: (string | number)[]; message: string }[]; message?: string }
    | undefined;
  const zodIssues =
    cause?.issues ?? (cause as { cause?: { issues?: unknown[] } } | undefined)?.cause?.issues;
  if (Array.isArray(zodIssues) && zodIssues.length > 0) {
    const mistyped = new Set<string>();
    const lines: string[] = [];
    for (const issue of zodIssues) {
      const i = issue as {
        path?: (string | number)[];
        message: string;
        code?: string;
        keys?: unknown[];
      };
      const pathKey = (i.path ?? []).join(".");
      if (mistyped.has(pathKey)) continue;
      if (i.code === "invalid_type") mistyped.add(pathKey);
      const path = pathKey.length > 0 ? `${pathKey}: ` : "";
      const message =
        audience === "log" && i.code === "unrecognized_keys"
          ? `${i.keys?.length ?? "some"} unrecognized key(s)`
          : i.message;
      lines.push(`- ${path}${message}`);
    }
    return lines;
  }
  return ["- The answer was not valid JSON for the requested shape."];
}
