import type { ModelClass } from "@tj/domain";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import type { z } from "zod";
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
 * consulted before and charged after every attempt, one retry on a schema miss with the
 * validation issues in context, and a typed `StageFailure` on the second miss. Nothing about the
 * prompt or the model's text is logged (ADR 0015); only the issue messages travel back into the
 * retry prompt.
 */

export interface StructuredPrompt<I> {
  version: string;
  system: string;
  user(input: I): string;
}

export interface CallStructuredOptions<I, T> {
  deps: Pick<PipelineDeps, "ai" | "budget" | "signal" | "logger" | "context">;
  stage: StageName;
  cls: ModelClass;
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
  plan: 4000,
  slide: 1500,
  worksheet: 4000,
  evaluate: 2000,
  repair: 1500,
} as const;

const RETRY_PREFIX = "\n\nYour previous answer did not validate:\n";

export async function callStructured<I, T>(
  options: CallStructuredOptions<I, T>,
): Promise<CallResult<T>> {
  const { deps, stage, cls, prompt, input, schema, maxOutputTokens } = options;
  // Cancel is checked between model calls (ADR 0025 §5); the fake ignores `abortSignal`, so the
  // check is here rather than trusted to the provider.
  throwIfAborted(deps.signal);
  const exceeded = deps.budget.exceeded();
  if (exceeded) throw new BudgetExceeded(exceeded.by);
  const modelId = deps.ai.modelId(cls);
  const model = deps.ai.model(cls, callContext(deps, stage, prompt.version));
  const userText = prompt.user(input);

  const attempt = async (text: string): Promise<CallResult<T>> => {
    const result = await generateText({
      model,
      system: prompt.system,
      prompt: text,
      output: Output.object({ schema }),
      abortSignal: deps.signal,
      maxOutputTokens,
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
    deps.logger.info(
      { stage, promptVersion: prompt.version, issues: issues.length },
      "structured output did not validate; retrying once",
    );
    // The retry is a second model call: the same two gates apply before it.
    throwIfAborted(deps.signal);
    const exceededNow = deps.budget.exceeded();
    if (exceededNow) throw new BudgetExceeded(exceededNow.by);
    try {
      const second = await attempt(`${userText}${RETRY_PREFIX}${issues.join("\n")}`);
      return { ...second, attempts: 2 };
    } catch (again) {
      if (!NoObjectGeneratedError.isInstance(again)) throw again;
      if (again.usage) deps.budget.charge(modelId, usageOf(again.usage));
      throw new StageFailure(
        stage,
        `${stage}: the model did not produce a valid ${prompt.version} answer in two attempts`,
        {
          cause: issuesOf(again),
        },
      );
    }
  }
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
 */
export function issuesOf(error: NoObjectGeneratedError): string[] {
  const cause = error.cause as
    | { issues?: { path?: (string | number)[]; message: string }[]; message?: string }
    | undefined;
  const zodIssues =
    cause?.issues ?? (cause as { cause?: { issues?: unknown[] } } | undefined)?.cause?.issues;
  if (Array.isArray(zodIssues) && zodIssues.length > 0) {
    return zodIssues.map((issue) => {
      const i = issue as { path?: (string | number)[]; message: string };
      const path = i.path && i.path.length > 0 ? `${i.path.join(".")}: ` : "";
      return `- ${path}${i.message}`;
    });
  }
  return ["- The answer was not valid JSON for the requested shape."];
}
