import {
  BudgetReservationError,
  isAiError,
  isAnthropicModelId,
  withGenerationBudget,
} from "@tj/ai";
import { type ModelClass, safeValidationIssues } from "@tj/domain";
import type { Finding, FindingSeverity, FindingTarget } from "@tj/domain/documents";
import { isEditorialIssue } from "@tj/slides";
import {
  generateText,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
  type OutputInterface,
} from "ai";
import type { z } from "zod";
import { CallTimeout, withCallDeadline } from "./call-deadline";
import type { PromptName } from "./prompts";
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
 * context, and a typed `StageFailure` on the second miss — unless the second miss is **editorial
 * only** (ADR 0025 §7, TEACH-257): every issue carries the `editorialIssue` tag and the caller gave
 * a `soft` build of the schema. Then the retry's answer is parsed with the soft schema, accepted,
 * and each issue comes back as an `EditorialMiss` for the stage to record as a `spec-rule` finding
 * (`specRuleFinding`), which Repair acts on. A shape miss — a type, a missing field, a list the
 * recipe has no slot for, invalid JSON — still fails the call: the model did not give us the thing.
 * Nothing about the prompt or the model's text is logged (ADR 0015); only the issue messages
 * travel back into the retry prompt.
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
  /**
   * The same schema with every editorial rule left out (`{ soft: true }` from the spec factories).
   * With it, a retry that misses only editorial rules is accepted and its misses returned; without
   * it every second miss is a `StageFailure`, as before.
   */
  soft?: z.ZodType<T> | undefined;
  maxOutputTokens: number;
  /** Per attempt; defaults to the bound for this prompt (TEACH-235). */
  timeoutMs?: number;
  /**
   * Photographs the model must look at (TEACH-220): sent as image parts beside the user text, by
   * public URL, so the provider fetches them — `@tj/generation` still makes no HTTP call. The retry
   * carries them again. Billed as input tokens on the GPT-5.6 family (stop-gate, 10 Sept).
   */
  images?: { id: string; url: string }[] | undefined;
}

export interface CallUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cachedInputTokens?: number | undefined;
}

/** One editorial rule the accepted answer still breaks: the issue's path and its message. */
export interface EditorialMiss {
  path: (string | number)[];
  message: string;
}

export interface CallResult<T> {
  output: T;
  usage: CallUsage;
  /** 1 or 2: how many attempts the call took. */
  attempts: number;
  modelId: string;
  /**
   * Empty when the answer validated. Otherwise the editorial rules the accepted retry breaks (see
   * `soft`); the stage turns each into a `spec-rule` finding with `specRuleFinding`.
   */
  editorialMisses: EditorialMiss[];
}

/** The check name a finding from an accepted editorial miss carries. */
export const SPEC_RULE_CHECK = "spec-rule";

/**
 * The `Finding` for one editorial miss. The stage supplies the target — the slide or block the
 * answer became, which is not known until it is materialised — and the severity: `error` where
 * Repair can rewrite the target, `warning` where nothing downstream can (Plan's facts, or a Repair
 * answer that itself still misses — never a second pass). The message keeps the issue's path so
 * the reader knows which field.
 */
export function specRuleFinding(
  miss: EditorialMiss,
  target: FindingTarget,
  severity: FindingSeverity = "error",
): Finding {
  const at = miss.path.join(".");
  return {
    check: SPEC_RULE_CHECK,
    severity,
    target,
    message: at.length > 0 ? `${at}: ${miss.message}` : miss.message,
  };
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
  // At most twelve short corrections.
  verify: 1500,
  slide: 1500,
  worksheet: 4000,
  // Up to twenty findings, each with its evidence span (TEACH-216).
  evaluate: 2500,
  // Six ids (TEACH-227).
  shortlist: 200,
  repair: 1500,
  // Four short fields (TEACH-16).
  parseBrief: 120,
} as const;

/**
 * Failure bounds, not latency targets: valid Bedrock slide responses took 87–100 s in the
 * TEACH-258 probe. Short calls get 3 minutes, larger outputs/judges 5; never an unbounded wait.
 */
export const CALL_TIMEOUT_MS = {
  "check-input": 180_000,
  "plan-skeleton": 180_000,
  "plan-facts": 300_000,
  "verify-facts": 180_000,
  "generate-slide": 180_000,
  "generate-worksheet": 300_000,
  // One `small` call for the placeholder slots; the API's own 2 s deadline bounds parse-brief.
  "generate-worksheet-fill": 180_000,
  "parse-brief": 180_000,
  "shortlist-photos": 180_000,
  "pick-or-requery-photo": 180_000,
  evaluate: 300_000,
  repair: 180_000,
  "repair-fact": 180_000,
  cascade: 300_000,
  regenerate: 300_000,
} satisfies Record<PromptName, number>;

export function callTimeoutMs(version: string): number {
  const name = version.replace(/\.v\d+$/, "");
  return Object.hasOwn(CALL_TIMEOUT_MS, name) ? CALL_TIMEOUT_MS[name as PromptName] : 300_000;
}

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
 * prompt describes what the model actually sent — unless what the repaired text still fails is
 * editorial only: then that error is thrown (its `text` is the repaired text), so the second-miss
 * path can accept the answer the model meant rather than fail on the wrapping it came in.
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
        } catch (afterRepair) {
          if (
            NoObjectGeneratedError.isInstance(afterRepair) &&
            editorialMissesOf(afterRepair) !== null
          ) {
            onRepair(repaired.repairs);
            throw afterRepair;
          }
          throw error;
        }
      }
    },
  };
}

export async function callStructured<I, T>(
  options: CallStructuredOptions<I, T>,
): Promise<CallResult<T>> {
  const { deps, stage, cls, effort, prompt, input, schema, soft, maxOutputTokens, images } =
    options;
  const timeoutMs = options.timeoutMs ?? callTimeoutMs(prompt.version);
  // Cancel is checked between model calls (ADR 0025 §5); the fake ignores `abortSignal`, so the
  // check is here rather than trusted to the provider.
  throwIfAborted(deps.signal);
  const exceeded = deps.budget.exceeded();
  if (exceeded) throw new BudgetExceeded(exceeded.by);
  const modelId = deps.ai.modelId(cls);
  const model = withGenerationBudget(
    deps.ai.model(cls, callContext(deps, stage, prompt.version, effort)),
    modelId,
    deps.budget,
  );
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
    try {
      const result = await withCallDeadline(deps.signal, timeoutMs, (abortSignal) =>
        generateText({
          model,
          system: prompt.system,
          ...userTurn(text, images),
          output,
          abortSignal,
          maxOutputTokens,
          maxRetries: 0,
          // The same effort on the retry: a schema miss is a shape problem, not a thinking one.
          ...providerOptionsFor(modelId, effort),
        }),
      );
      const usage = usageOf(result.usage);
      return { output: result.output, usage, attempts: 1, modelId, editorialMisses: [] };
    } catch (error) {
      if (error instanceof BudgetReservationError) throw new BudgetExceeded(error.by);
      if (error instanceof CallTimeout) {
        deps.logger.warn(
          { stage, promptVersion: prompt.version, timeoutMs },
          "model call timed out",
        );
        throw new StageFailure(stage, `${stage}: model call timeout after ${timeoutMs} ms`, {
          reason: "timeout",
        });
      }
      if (isAiError(error, "moderated")) {
        deps.logger.warn(
          { stage, promptVersion: prompt.version, moderated: true },
          "model call moderated",
        );
      }
      throw error;
    }
  };

  try {
    return await attempt(userText);
  } catch (error) {
    const timedOut = error instanceof StageFailure && error.reason === "timeout";
    if (!timedOut && !NoObjectGeneratedError.isInstance(error)) throw error;
    let retryText = userText;
    if (NoObjectGeneratedError.isInstance(error)) {
      // The failed attempt was still paid for. `error.text` (the model's words) is never logged.
      const issues = issuesOf(error);
      // Log finite issue codes/counts; even paths and custom messages may echo model content.
      deps.logger.info(
        {
          stage,
          promptVersion: prompt.version,
          issues: issuesOf(error, "log"),
          editorialOnly: editorialMissesOf(error) !== null,
        },
        "structured output did not validate; retrying once",
      );
      retryText = `${userText}${RETRY_PREFIX}${issues.join("\n")}${RETRY_SUFFIX}`;
    }
    // The retry is a second model call: the same two gates apply before it.
    throwIfAborted(deps.signal);
    const exceededNow = deps.budget.exceeded();
    if (exceededNow) throw new BudgetExceeded(exceededNow.by);
    try {
      const second = await attempt(retryText);
      return { ...second, attempts: 2 };
    } catch (again) {
      if (!NoObjectGeneratedError.isInstance(again)) throw again;
      const misses = editorialMissesOf(again);
      const logged = {
        stage,
        promptVersion: prompt.version,
        issues: issuesOf(again, "log"),
        editorialOnly: misses !== null,
      };
      // Only our own content rules were broken, and the stage can carry them as findings: the
      // answer is taken as returned (TEACH-257 — five eval runs lost every dead lesson here).
      const accepted = misses && soft ? softParse(soft, again.text) : undefined;
      if (misses && accepted !== undefined) {
        deps.logger.warn(logged, "structured output did not validate on the retry; accepted");
        return {
          output: accepted,
          usage: usageOf(again.usage ?? {}),
          attempts: 2,
          modelId,
          editorialMisses: misses,
        };
      }
      // pino's `err` serializer drops a non-Error `cause`, so the second miss is logged here.
      deps.logger.warn(logged, "structured output did not validate on the retry; giving up");
      throw new StageFailure(
        stage,
        `${stage}: the model did not produce a valid ${prompt.version} answer in two attempts`,
        { cause: issuesOf(again) },
      );
    }
  }
}

/**
 * The user turn: plain `prompt` text, or one message with the text and the image parts. Images go
 * as `file` parts with an image media type (the SDK's `image` part is deprecated in v7).
 */
function userTurn(
  text: string,
  images: { id: string; url: string }[] | undefined,
): { prompt: string } | { messages: ModelMessage[] } {
  if (!images || images.length === 0) return { prompt: text };
  return {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text },
          ...images.map((image) => ({
            type: "file" as const,
            data: new URL(image.url),
            mediaType: imageMediaType(image.url),
          })),
        ],
      },
    ],
  };
}

/** The media type of an image URL: a data URL says it; otherwise the extension, JPEG by default. */
export function imageMediaType(url: string): string {
  const data = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(url);
  if (data?.[1]) return data[1].toLowerCase();
  const ext = /\.(png|webp|gif|jpe?g)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "gif") return `image/${ext}`;
  return "image/jpeg";
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
  inputTokenDetails?: { cacheReadTokens?: number | undefined };
}): CallUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
  };
}

/**
 * The answer's JSON parsed with the soft schema, or `undefined` when even that refuses it (a rule
 * tagged editorial that the soft build still applies — a bug in a spec factory, so the caller
 * falls back to the failure path rather than guess). Zod issues exist only for text that parsed as
 * JSON, so no repair pass is needed here. The text is parsed, never logged.
 */
function softParse<T>(soft: z.ZodType<T>, text: string | undefined): T | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = soft.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type RawIssue = {
  path?: (string | number)[];
  message: string;
  code?: string;
  keys?: unknown[];
  params?: Record<string, unknown>;
};

/** The zod issues behind a schema miss, or `undefined` when the text was not even JSON. */
function zodIssuesOf(error: NoObjectGeneratedError): RawIssue[] | undefined {
  const cause = error.cause as { issues?: unknown[]; cause?: { issues?: unknown[] } } | undefined;
  const issues = cause?.issues ?? cause?.cause?.issues;
  return Array.isArray(issues) && issues.length > 0 ? (issues as RawIssue[]) : undefined;
}

/**
 * The misses when every issue is an editorial rule (`editorialIssue`), else `null`: one shape
 * issue — or no zod issues at all (invalid JSON) — and the miss is the model's, not ours.
 */
export function editorialMissesOf(error: NoObjectGeneratedError): EditorialMiss[] | null {
  const issues = zodIssuesOf(error);
  if (issues === undefined) return null;
  if (!issues.every((issue) => isEditorialIssue(issue))) return null;
  return issues.map((issue) => ({ path: issue.path ?? [], message: issue.message }));
}

/**
 * The validation issues from a schema miss as plain messages with paths — what the retry prompt
 * shows the model. A JSON parse failure yields one line. Never the model's text.
 *
 * `audience: "log"` exposes only allow-listed issue codes/counts (ADR 0015). Arbitrary paths,
 * messages and custom params stay inside the retry prompt and never reach the log sink.
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
  const zodIssues = zodIssuesOf(error);
  if (audience === "log") return zodIssues ? safeValidationIssues(zodIssues) : ["invalid_json: 1"];
  if (zodIssues) {
    const mistyped = new Set<string>();
    const lines: string[] = [];
    for (const i of zodIssues) {
      const pathKey = (i.path ?? []).join(".");
      if (mistyped.has(pathKey)) continue;
      if (i.code === "invalid_type") mistyped.add(pathKey);
      const path = pathKey.length > 0 ? `${pathKey}: ` : "";
      lines.push(`- ${path}${i.message}`);
    }
    return lines;
  }
  return ["- The answer was not valid JSON for the requested shape."];
}
