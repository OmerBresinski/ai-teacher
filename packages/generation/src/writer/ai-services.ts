import type { AiCallContext } from "@tj/ai";
import { costUsd } from "@tj/ai";
import { generateText, jsonSchema, Output, streamText } from "ai";
import { providerOptionsFor } from "../call";
import type { PipelineDeps } from "../types";
import {
  type ChatReq,
  SMALL_MODEL,
  WRITER_MODEL,
  type WriterReq,
  type WriterResult,
  type WriterServices,
} from "./services";

/** The writer stage's prompt version, stamped on the lesson and carried on every call it makes. */
export const WRITER_VERSION = "lesson-writer.v1";

/**
 * The writer route (ADR 0031 amendment): a call the writer stage makes runs on its own model,
 * whatever the classes are configured to. The writer call is Sol; the stage's small calls are
 * Luna. A code default, not a Railway variable; read from the call's own context, so a lesson
 * resumes on the model it started with.
 */
export function writerRoute(_cls: unknown, context: AiCallContext | undefined): string | undefined {
  if (!context?.promptVersion?.startsWith(`${WRITER_VERSION}`)) return undefined;
  return context.stage === "write" ? WRITER_MODEL : SMALL_MODEL;
}

const usdOf = (modelId: string, u: { inputTokens?: number; outputTokens?: number } | undefined) => {
  try {
    return (
      costUsd(modelId, {
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
      } as never) ?? 0
    );
  } catch {
    return 0;
  }
};

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
      const model = deps.ai.model("small", ctx("write-small", r.name, r.effort ?? "low"));
      const result = await generateText({
        model,
        system: r.system,
        prompt: r.user,
        output: Output.object({ schema: jsonSchema(r.schema as never), name: r.name }),
        abortSignal: deps.signal,
        ...(r.maxTokens ? { maxOutputTokens: r.maxTokens } : {}),
        ...providerOptionsFor(r.model ?? SMALL_MODEL, r.effort ?? "low"),
      });
      return { out: result.output, usd: usdOf(SMALL_MODEL, result.usage), ms: Date.now() - t0 };
    },
    async writer(r: WriterReq, onDelta): Promise<WriterResult> {
      const t0 = Date.now();
      let firstTokenMs: number | undefined;
      const model = deps.ai.model("frontier", ctx("write", r.name, r.effort));
      const result = streamText({
        model,
        system: r.system,
        prompt: r.user,
        output: Output.object({ schema: jsonSchema(r.schema as never), name: r.name }),
        maxOutputTokens: r.maxTokens,
        abortSignal: deps.signal,
        ...providerOptionsFor(r.model, r.effort),
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
