import { withGenerationBudget } from "@tj/ai";
import { streamText } from "ai";
import type { z } from "zod";
import { type EditorialMiss, providerOptionsFor } from "../call";
import { type WriteDeckInput, writeDeckPrompt } from "../prompts/write-deck";
import { repairJsonText } from "../repair-json";
import { callContext, type PipelineDeps } from "../types";

/*
 * Lab fit-single-writer: one streamed `write-deck` call writes every model-written slide in order,
 * one JSON object per line. Each line is validated against its entry's schema as soon as it is
 * complete and handed to Generate, which materialises and persists it in outline order. A slide
 * the stream does not deliver (no line, a line that does not parse, a shape miss) resolves to
 * `undefined`, and Generate writes that one slide with the per-slide call as before.
 */

export type StreamedSlide = { output: unknown; misses: EditorialMiss[]; modelId: string };

export type DeckStream = {
  slides: Map<number, Promise<StreamedSlide | undefined>>;
  done: Promise<void>;
};

const DECK_TIMEOUT_MS = 180_000;

export function startDeckStream(options: {
  deps: Pick<PipelineDeps, "ai" | "budget" | "signal" | "logger" | "context" | "effortFor">;
  input: WriteDeckInput;
  schemas: Map<number, { schema: z.ZodType<unknown>; soft: z.ZodType<unknown> | undefined }>;
}): DeckStream {
  const { deps, input, schemas } = options;
  const resolvers = new Map<number, (value: StreamedSlide | undefined) => void>();
  const slides = new Map<number, Promise<StreamedSlide | undefined>>();
  for (const i of schemas.keys()) {
    slides.set(i, new Promise((resolve) => resolvers.set(i, resolve)));
  }
  const started = Date.now();
  let delivered = 0;
  const log = (fields: Record<string, unknown>, msg: string) =>
    deps.logger.info({ stage: "generate", call: "write-deck", ...fields }, msg);

  const settle = (i: number, value: StreamedSlide | undefined) => {
    const resolve = resolvers.get(i);
    if (!resolve) return;
    resolvers.delete(i);
    resolve(value);
  };

  const done = (async () => {
    const effort = deps.effortFor?.("generate", "write-deck", "low") ?? ("low" as const);
    if (deps.signal.aborted || deps.budget.exceeded()) return;
    const routed = deps.ai.model(
      "small",
      callContext(deps, "generate", writeDeckPrompt.version, effort),
    );
    const modelId = typeof routed === "string" ? routed : routed.modelId;
    const model = withGenerationBudget(routed, modelId, deps.budget);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("write-deck timeout")),
      DECK_TIMEOUT_MS,
    );
    const onAbort = () => controller.abort(deps.signal.reason);
    deps.signal.addEventListener("abort", onAbort, { once: true });
    let streamError: unknown;

    const handle = (raw: string) => {
      const line = raw.trim();
      if (!line || line.startsWith("```") || line === "[" || line === "]") return;
      const text = line.replace(/,\s*$/, "");
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        const repaired = repairJsonText(text);
        try {
          value = repaired.text === null ? undefined : JSON.parse(repaired.text);
        } catch {
          value = undefined;
        }
      }
      if (!value || typeof value !== "object") {
        log({ ms: Date.now() - started }, "write-deck line did not parse");
        return;
      }
      const { slide: n, ...spec } = value as { slide?: unknown } & Record<string, unknown>;
      const index = typeof n === "number" ? n - 1 : Number.NaN;
      const found = schemas.get(index);
      if (!found || !resolvers.has(index)) {
        log({ slide: n, ms: Date.now() - started }, "write-deck line for no open slide");
        return;
      }
      const hard = found.schema.safeParse(spec);
      const ms = Date.now() - started;
      if (hard.success) {
        delivered += 1;
        log({ index, ms, chars: text.length, delivered }, "write-deck slide complete");
        settle(index, { output: hard.data, misses: [], modelId });
        return;
      }
      const soft = found.soft?.safeParse(spec);
      if (soft?.success) {
        delivered += 1;
        const misses = hard.error.issues.map((issue) => ({
          path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
          message: issue.message,
        }));
        log(
          { index, ms, chars: text.length, delivered, misses: misses.length },
          "write-deck slide complete",
        );
        settle(index, { output: soft.data, misses, modelId });
        return;
      }
      log(
        { index, ms, issues: hard.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`) },
        "write-deck slide did not validate",
      );
      settle(index, undefined);
    };

    try {
      const result = streamText({
        model,
        system: writeDeckPrompt.system,
        prompt: writeDeckPrompt.user(input),
        abortSignal: controller.signal,
        maxOutputTokens: 1200 * schemas.size + 2000,
        maxRetries: 0,
        ...providerOptionsFor(modelId, effort),
        onError: ({ error }) => {
          streamError = error;
        },
      });
      let buffer = "";
      let firstText: number | undefined;
      for await (const chunk of result.textStream) {
        if (firstText === undefined) {
          firstText = Date.now() - started;
          log({ ms: firstText }, "write-deck first text");
        }
        buffer += chunk;
        for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
          handle(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      handle(buffer);
      const usage = await Promise.resolve(result.totalUsage).catch(() => undefined);
      log(
        {
          ms: Date.now() - started,
          delivered,
          wanted: schemas.size,
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
          error: streamError
            ? String((streamError as Error).message ?? streamError).slice(0, 200)
            : undefined,
        },
        "write-deck done",
      );
    } catch (error) {
      deps.logger.warn(
        {
          stage: "generate",
          call: "write-deck",
          error: String((error as Error)?.message ?? error).slice(0, 200),
        },
        "write-deck stream failed",
      );
    } finally {
      clearTimeout(timer);
      deps.signal.removeEventListener("abort", onAbort);
    }
  })().finally(() => {
    for (const i of [...resolvers.keys()]) settle(i, undefined);
  });

  return { slides, done };
}
