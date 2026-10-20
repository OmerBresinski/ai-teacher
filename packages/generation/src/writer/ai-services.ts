import type { AiCallContext } from "@tj/ai";
import { costUsd, withGenerationBudget } from "@tj/ai";
import { generateText, jsonSchema, Output, streamText } from "ai";
import { imageMediaType, providerOptionsFor } from "../call";
import { fullError, recordDebug } from "../debug";
import type { PipelineDeps } from "../types";
import {
  type CallTokens,
  type ChatReq,
  isBudgetRefusal,
  nonFatalSync,
  SMALL_MODEL,
  WRITER_MODEL,
  type WriterReq,
  type WriterResult,
  type WriterServices,
} from "./services";

/** The output cap of a small call that names none (the notes for 20 slides fit well under it). */
export const SMALL_CALL_MAX_TOKENS = 8000;

/** The writer stage's prompt version, stamped on the lesson and carried on every call it makes. */
export const WRITER_VERSION = "lesson-writer.v1";

/**
 * The writer route (ADR 0031 amendment): a call the writer stage makes runs on its own model,
 * whatever the classes are configured to. The writer call is Sol; the stage's small calls are
 * Luna. A code default, not a Railway variable; read from the call's own context, so a lesson
 * resumes on the model it started with.
 */
export function writerRoute(_cls: unknown, context: AiCallContext | undefined): string | undefined {
  if (!context?.promptVersion?.startsWith(`${WRITER_VERSION}/`)) return undefined;
  return context.stage === "write" || context.stage === "write-frontier"
    ? WRITER_MODEL
    : SMALL_MODEL;
}

/** Whether a small call asks for the writer's model (the objectives call, TEACH-110 part f). */
export const onWriterModel = (model: string | undefined) =>
  model === WRITER_MODEL || `openai/${model}` === WRITER_MODEL;

const usdOf = (modelId: string, u: { inputTokens?: number; outputTokens?: number } | undefined) => {
  return nonFatalSync(
    () =>
      costUsd(modelId, {
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
      } as never) ?? 0,
    () => 0,
  );
};

/**
 * A small call's options: its own deadline (`timeoutMs`) aborts it as a TimeoutError (non-fatal)
 * while a cancel stays fatal; every call has an output cap (the budget estimates from it); and the
 * request's `strict` is honoured: OpenAI strict JSON schema only when the request asks for it
 * (base4's drawer ran non-strict on the wire schema, TEACH-247).
 */
export function chatCallOptions(r: ChatReq, signal: AbortSignal) {
  const base = providerOptionsFor(r.model ?? SMALL_MODEL, r.effort ?? "low") as {
    providerOptions?: Record<string, Record<string, unknown>>;
  };
  const providerOptions = base.providerOptions
    ? {
        ...base.providerOptions,
        openai: {
          ...base.providerOptions.openai,
          strictJsonSchema: r.strict === true,
          // The system text goes as a `system` message, as base4f-p123 sent it (the SDK otherwise
          // sends `developer` to a reasoning model).
          systemMessageMode: "system",
        },
      }
    : undefined;
  return {
    abortSignal: r.timeoutMs ? AbortSignal.any([signal, AbortSignal.timeout(r.timeoutMs)]) : signal,
    maxOutputTokens: r.maxTokens ?? SMALL_CALL_MAX_TOKENS,
    ...(providerOptions ? { providerOptions } : {}),
  };
}

/**
 * A small call's user turn: the text alone, or the text then each picture as an `image_url` at
 * low detail, as base4f-p123's harness sent them (TEACH-110 part f).
 */
export function chatUserTurn(r: Pick<ChatReq, "user" | "images">) {
  if (!r.images?.length) return { prompt: r.user };
  return {
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: r.user },
          ...r.images.map((url) => ({
            type: "file" as const,
            data: new URL(url),
            mediaType: imageMediaType(url),
            providerOptions: { openai: { imageDetail: "low" } },
          })),
        ],
      },
    ],
  };
}

/** The writer call's options: strict JSON and a `system` message, as base4f-p123 sent them. */
export function writerProviderOptions(model: string, effort: WriterReq["effort"]) {
  const base = providerOptionsFor(model, effort, true) as {
    providerOptions?: Record<string, Record<string, unknown>>;
  };
  if (!base.providerOptions) return {};
  return {
    providerOptions: {
      ...base.providerOptions,
      openai: { ...base.providerOptions.openai, systemMessageMode: "system" },
    },
  };
}

const tokensOf = (
  u: { inputTokens?: number; outputTokens?: number } | undefined,
): CallTokens | undefined =>
  u ? { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0 } : undefined;

/**
 * One model call in the lesson's debug record (`call`), and, when it was refused by the budget,
 * the `budget-stop` record naming it. Never throws, never awaited.
 */
function recordCall(
  deps: Pick<PipelineDeps, "debug" | "budget">,
  call: { name: string; model: string; stage?: string; effort?: string; ms: number },
  outcome: { usd: number; tokens?: CallTokens } | { error: unknown },
): void {
  if (!deps.debug) return;
  if ("error" in outcome) {
    recordDebug(deps.debug, "call", { ...call, ok: false, error: fullError(outcome.error) });
    if (isBudgetRefusal(outcome.error))
      recordDebug(deps.debug, "budget-stop", {
        ...call,
        totals: nonFatalSync(
          () => deps.budget.totals(),
          () => undefined,
        ),
        error: fullError(outcome.error),
      });
    return;
  }
  recordDebug(deps.debug, "call", { ...call, ok: true, ...outcome });
}

/** The stage's calls on `@tj/ai`: every call carries the writer's context, so the route applies. */
export function aiWriterServices(deps: PipelineDeps): WriterServices {
  const ctx = (stage: string, name: string, effort: string): AiCallContext => ({
    lessonId: deps.context.lessonId,
    jobId: deps.context.jobId,
    stage,
    promptVersion: `${WRITER_VERSION}/${name}`,
    effort,
  });
  return {
    log: (e) => deps.logger.info({ writer: e }, "writer stage"),
    ...(deps.debug ? { debug: deps.debug } : {}),
    async chat(r: ChatReq) {
      const t0 = Date.now();
      // A call that names the writer's model runs on it (the objectives call); every other on Luna.
      const sol = onWriterModel(r.model);
      const c = ctx(sol ? "write-frontier" : "write-small", r.name, r.effort ?? "low");
      const cls = sol ? "frontier" : "small";
      // Every call goes through the lesson's budget, like `callStructured`'s.
      const model = withGenerationBudget(
        deps.ai.model(cls, c),
        writerRoute(cls, c) ?? deps.ai.modelId(cls),
        deps.budget,
      );
      const modelId = sol ? WRITER_MODEL : SMALL_MODEL;
      const call = { name: r.name, model: modelId, stage: c.stage, effort: c.effort ?? "low" };
      const result = await generateText({
        model,
        system: r.system,
        ...chatUserTurn(r),
        output: Output.object({ schema: jsonSchema(r.schema as never), name: r.name }),
        ...chatCallOptions(r, deps.signal),
      }).catch((error: unknown) => {
        recordCall(deps, { ...call, ms: Date.now() - t0 }, { error });
        throw error;
      });
      const usd = usdOf(modelId, result.usage);
      const tokens = tokensOf(result.usage);
      const ms = Date.now() - t0;
      recordCall(deps, { ...call, ms }, { usd, ...(tokens ? { tokens } : {}) });
      return { out: result.output, usd, ms, ...(tokens ? { tokens } : {}) };
    },
    async writer(r: WriterReq, onDelta): Promise<WriterResult> {
      const t0 = Date.now();
      let firstTokenMs: number | undefined;
      const c = ctx("write", r.name, r.effort);
      const model = withGenerationBudget(
        deps.ai.model("frontier", c),
        writerRoute("frontier", c) ?? deps.ai.modelId("frontier"),
        deps.budget,
      );
      // The SDK reports a stream's error to `onError` and then fails `usage` with its own
      // `NoOutputGeneratedError`, which drops the original: a budget refusal would reach the job
      // as an unknown error and be retried (TEACH-202 part g). Keep the first error and throw it.
      let streamError: unknown;
      const result = streamText({
        onError: ({ error }) => {
          streamError ??= error;
        },
        model,
        system: r.system,
        prompt: r.user,
        output: Output.object({ schema: jsonSchema(r.schema as never), name: r.name }),
        maxOutputTokens: r.maxTokens,
        abortSignal: deps.signal,
        // Strict JSON, as base4f-p123 ran the writer (TEACH-110 part f): the schema lists every key.
        ...writerProviderOptions(r.model, r.effort),
      });
      let text = "";
      let usage: Awaited<typeof result.usage> | undefined;
      let finishReason: Awaited<typeof result.finishReason> | undefined;
      const read = async () => {
        for await (const delta of result.textStream) {
          if (firstTokenMs === undefined) firstTokenMs = Date.now() - t0;
          text += delta;
          onDelta(delta);
        }
        usage = await result.usage;
        finishReason = await result.finishReason;
      };
      // Always rethrows (never recovers), so it is not one of the stage's non-fatal handlers.
      const call = { name: r.name, model: r.model, stage: c.stage, effort: r.effort };
      await read().then(undefined, (error: unknown) => {
        recordCall(deps, { ...call, ms: Date.now() - t0 }, { error: streamError ?? error });
        throw streamError ?? error;
      });
      const usd = usdOf(r.model, usage as Awaited<typeof result.usage>);
      const tokens = tokensOf(usage);
      const ms = Date.now() - t0;
      recordCall(deps, { ...call, ms }, { usd, ...(tokens ? { tokens } : {}) });
      return {
        text,
        finishReason: finishReason ?? null,
        usd,
        ms,
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
        ...(tokens ? { tokens } : {}),
      };
    },
  };
}
