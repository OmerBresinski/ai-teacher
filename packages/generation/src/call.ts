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
  // At most three one-sentence findings.
  checkInput: 400,
  // The skeleton (4 objectives, 16 outline entries) is a few hundred tokens; the facts (6 terms,
  // 3 worked examples, 8 questions, the outline refs) ~2 500 pretty-printed. Room left so the cap
  // is never the reason a call fails.
  planSkeleton: 1500,
  planFacts: 4000,
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
      const second = await attempt(`${userText}${RETRY_PREFIX}${issues.join("\n")}`);
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
    return zodIssues.map((issue) => {
      const i = issue as {
        path?: (string | number)[];
        message: string;
        code?: string;
        keys?: unknown[];
      };
      const path = i.path && i.path.length > 0 ? `${i.path.join(".")}: ` : "";
      const message =
        audience === "log" && i.code === "unrecognized_keys"
          ? `${i.keys?.length ?? "some"} unrecognized key(s)`
          : i.message;
      return `- ${path}${message}`;
    });
  }
  return ["- The answer was not valid JSON for the requested shape."];
}
