import type { AiCallContext } from "@tj/ai";
import { costUsd, withGenerationBudget } from "@tj/ai";
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
      const c = ctx("write-small", r.name, r.effort ?? "low");
      // Every call goes through the lesson's budget, like `callStructured`'s.
      const model = withGenerationBudget(
        deps.ai.model("small", c),
        writerRoute("small", c) ?? deps.ai.modelId("small"),
        deps.budget,
      );
      const result = await generateText({
        model,
        system: r.system,
        prompt: r.user,
        output: Output.object({ schema: jsonSchema(r.schema as never), name: r.name }),
        // A call's own deadline aborts it as a TimeoutError (non-fatal); a cancel stays fatal.
        abortSignal: r.timeoutMs
          ? AbortSignal.any([deps.signal, AbortSignal.timeout(r.timeoutMs)])
          : deps.signal,
        // The budget estimates a call from its output cap, so every call has one.
        maxOutputTokens: r.maxTokens ?? SMALL_CALL_MAX_TOKENS,
        ...providerOptionsFor(r.model ?? SMALL_MODEL, r.effort ?? "low"),
      });
      return { out: result.output, usd: usdOf(SMALL_MODEL, result.usage), ms: Date.now() - t0 };
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
