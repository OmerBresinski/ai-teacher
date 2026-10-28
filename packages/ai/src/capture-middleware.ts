import type { LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";
import { type ProviderErrorDetail, providerErrorDetail, redactSecrets } from "./errors";
import { costUsd } from "./prices";
import type { AiCallContext, CreatedAi } from "./types";

/**
 * One model request as sent and answered, for a host's own debug store (the worker's
 * `generation_debug`, Greg 20 Oct 2026). Unlike the logging middleware this carries **content**:
 * prompts and answers. It must only ever reach the host's own database: never a log line, an
 * analytics sink (PostHog) or any third party.
 */
export interface CapturedCall {
  context: AiCallContext;
  modelId: string;
  provider: string;
  mode: "generate" | "stream";
  request: {
    system: string[];
    /** Every non-system message; file parts become `{ type: "file", mediaType, bytes }`. */
    messages: unknown[];
    /** The structured-output schema's name, and the tool names; never the schemas themselves. */
    schemaName?: string;
    responseFormat?: string;
    tools?: string[];
    settings: Record<string, unknown>;
  };
  response?: { text: string; reasoning?: string; finishReason: string; rawFinishReason?: string };
  usage?: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedInputTokens?: number;
    /** Input tokens the call wrote to the prompt cache (OpenAI `cache_write_tokens`). */
    cacheWriteInputTokens?: number;
  };
  costUsd: number | null;
  durationMs: number;
  ok: boolean;
  error?: CapturedError;
}

/** A failed call's error; a provider failure adds its `ProviderErrorDetail` (no secrets). */
export type CapturedError = { name: string; message: string } & Partial<ProviderErrorDetail>;

export type CallCapture = (call: CapturedCall) => void;

type Params = Parameters<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>[0]["params"];
type Usage = {
  inputTokens: {
    total: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
  };
  outputTokens: { total: number | undefined };
};

const SETTING_KEYS = [
  "maxOutputTokens",
  "temperature",
  "topP",
  "topK",
  "seed",
  "stopSequences",
  "presencePenalty",
  "frequencyPenalty",
  "toolChoice",
  "providerOptions",
] as const;

/** A data URL or byte array is replaced by its media type and size: pictures are not kept. */
function slimPart(part: unknown): unknown {
  const p = part as { type?: string; mediaType?: string; data?: unknown };
  if (p?.type !== "file") return part;
  const data = p.data;
  const bytes =
    typeof data === "string"
      ? data.length
      : data instanceof Uint8Array
        ? data.byteLength
        : data instanceof URL
          ? data.href.length
          : undefined;
  const url = data instanceof URL && !data.href.startsWith("data:") ? data.href : undefined;
  return { type: "file", mediaType: p.mediaType, ...(url ? { url } : { bytes }) };
}

export function captureRequest(params: Params): CapturedCall["request"] {
  const system: string[] = [];
  const messages: unknown[] = [];
  for (const m of params.prompt) {
    if (m.role === "system") system.push(m.content);
    else
      messages.push({
        ...m,
        content: Array.isArray(m.content) ? m.content.map(slimPart) : m.content,
      });
  }
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const v = (params as Record<string, unknown>)[key];
    if (v !== undefined) settings[key] = v;
  }
  const format = params.responseFormat;
  return {
    system,
    messages,
    ...(format?.type === "json" && format.name ? { schemaName: format.name } : {}),
    ...(format ? { responseFormat: format.type } : {}),
    ...(params.tools?.length ? { tools: params.tools.map((t) => t.name) } : {}),
    settings,
  };
}

function usageOf(modelId: string, usage: Usage | undefined) {
  const inputTokens = usage?.inputTokens.total ?? null;
  const outputTokens = usage?.outputTokens.total ?? null;
  const cached = usage?.inputTokens.cacheRead;
  // A cache write shows in the record and is priced at its own rate, so a miss that wrote the
  // prefix is told apart from one that wrote nothing (the writer's prompt cache, TEACH-247).
  const written = usage?.inputTokens.cacheWrite;
  return {
    usage: {
      inputTokens,
      outputTokens,
      ...(cached !== undefined ? { cachedInputTokens: cached } : {}),
      ...(written !== undefined ? { cacheWriteInputTokens: written } : {}),
    },
    costUsd:
      inputTokens === null || outputTokens === null
        ? null
        : costUsd(modelId, {
            inputTokens,
            outputTokens,
            cachedInputTokens: cached,
            cacheWriteInputTokens: written,
          }),
  };
}

/** The error and, for a provider failure, its status, codes and redacted message (no secrets). */
const errorOf = (e: unknown): CapturedError =>
  e instanceof Error
    ? { name: e.name, message: redactSecrets(e.message), ...providerErrorDetail(e) }
    : { name: "Error", message: redactSecrets(String(e)) };

/**
 * Captures every request the wrapped model makes (one record per attempt: an SDK retry or a
 * caller's retry is its own record). Never throws into the call: a failing `capture` is ignored.
 */
export function createCaptureMiddleware(
  capture: CallCapture,
  context: AiCallContext | undefined,
): LanguageModelMiddleware {
  const emit = (call: CapturedCall) => {
    try {
      capture(call);
    } catch {
      // The debug record is best effort by contract.
    }
  };
  const base = (model: { modelId: string; provider: string }, mode: CapturedCall["mode"]) => ({
    context: { ...context },
    modelId: model.modelId,
    provider: model.provider,
    mode,
  });
  return {
    wrapGenerate: async ({ doGenerate, params, model }) => {
      const startedAt = Date.now();
      const request = captureRequest(params);
      try {
        const result = await doGenerate();
        const text = result.content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("");
        const reasoning = result.content
          .filter((c) => c.type === "reasoning")
          .map((c) => (c as { text: string }).text)
          .join("");
        emit({
          ...base(model, "generate"),
          request,
          response: {
            text,
            ...(reasoning ? { reasoning } : {}),
            finishReason: result.finishReason.unified,
            ...(result.finishReason.raw ? { rawFinishReason: result.finishReason.raw } : {}),
          },
          ...usageOf(model.modelId, result.usage as Usage),
          durationMs: Date.now() - startedAt,
          ok: true,
        });
        return result;
      } catch (error) {
        emit({
          ...base(model, "generate"),
          request,
          costUsd: null,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: errorOf(error),
        });
        throw error;
      }
    },
    wrapStream: async ({ doStream, params, model }) => {
      const startedAt = Date.now();
      const request = captureRequest(params);
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        emit({
          ...base(model, "stream"),
          request,
          costUsd: null,
          durationMs: Date.now() - startedAt,
          ok: false,
          error: errorOf(error),
        });
        throw error;
      }
      let text = "";
      let reasoning = "";
      let done = false;
      const finish = (extra: Partial<CapturedCall> & { ok: boolean }) => {
        if (done) return;
        done = true;
        emit({
          ...base(model, "stream"),
          request,
          costUsd: null,
          durationMs: Date.now() - startedAt,
          ...extra,
        });
      };
      const see = (part: unknown) => {
        const p = part as {
          type: string;
          delta?: string;
          usage?: Usage;
          finishReason?: { unified: string; raw?: string };
          error?: unknown;
        };
        if (p.type === "text-delta" && p.delta) text += p.delta;
        else if (p.type === "reasoning-delta" && p.delta) reasoning += p.delta;
        else if (p.type === "finish")
          finish({
            response: {
              text,
              ...(reasoning ? { reasoning } : {}),
              finishReason: p.finishReason?.unified ?? "unknown",
              ...(p.finishReason?.raw ? { rawFinishReason: p.finishReason.raw } : {}),
            },
            ...usageOf(model.modelId, p.usage),
            ok: true,
          });
        else if (p.type === "error")
          finish({ response: { text, finishReason: "error" }, ok: false, error: errorOf(p.error) });
      };
      // A reader, not a pipe: an error the source stream itself throws (a dropped connection)
      // reaches `pull` here and is recorded before it goes on to the caller.
      const reader = result.stream.getReader();
      const stream = new ReadableStream<
        typeof result.stream extends ReadableStream<infer T> ? T : never
      >({
        async pull(controller) {
          let next: Awaited<ReturnType<typeof reader.read>>;
          try {
            next = await reader.read();
          } catch (error) {
            finish({ response: { text, finishReason: "error" }, ok: false, error: errorOf(error) });
            controller.error(error);
            return;
          }
          if (next.done) {
            finish({ response: { text, finishReason: "incomplete" }, ok: false });
            controller.close();
            return;
          }
          see(next.value);
          controller.enqueue(next.value);
        },
        cancel(reason: unknown) {
          finish({
            response: { text, finishReason: "cancelled" },
            ok: false,
            error: errorOf(reason),
          });
          return reader.cancel(reason);
        },
      });
      return { ...result, stream };
    },
  };
}

/**
 * `ai` with every model it hands out wrapped by the capture middleware: a job wraps its own copy
 * once, so no call path (structured, streamed, picture director, worksheet) is missed.
 */
export function withCallCapture(ai: CreatedAi, capture: CallCapture): CreatedAi {
  if (ai.kind === "unconfigured") return ai;
  return {
    ...ai,
    model: (modelClass, context) =>
      wrapLanguageModel({
        model: ai.model(modelClass, context) as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: createCaptureMiddleware(capture, context),
      }),
  };
}
