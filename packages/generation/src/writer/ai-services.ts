import type { AiCallContext } from "@tj/ai";
import { costUsd, withGenerationBudget } from "@tj/ai";
import { generateText, jsonSchema, Output, streamText } from "ai";
import { imageMediaType, providerOptionsFor } from "../call";
import type { PipelineDeps } from "../types";
import {
  type ChatReq,
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
      const result = await generateText({
        model,
        system: r.system,
        ...chatUserTurn(r),
        output: Output.object({ schema: jsonSchema(r.schema as never), name: r.name }),
        ...chatCallOptions(r, deps.signal),
      });
      const usd = usdOf(sol ? WRITER_MODEL : SMALL_MODEL, result.usage);
      return { out: result.output, usd, ms: Date.now() - t0 };
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
      const result = streamText({
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
      for await (const delta of result.textStream) {
        if (firstTokenMs === undefined) firstTokenMs = Date.now() - t0;
        text += delta;
        onDelta(delta);
      }
      const usage = await result.usage;
      return {
        text,
        finishReason: (await result.finishReason) ?? null,
        usd: usdOf(r.model, usage),
        ms: Date.now() - t0,
        ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
      };
    },
  };
}
