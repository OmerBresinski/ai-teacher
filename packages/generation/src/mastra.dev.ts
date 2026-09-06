import { Mastra } from "@mastra/core";
import { createAi, createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import pino from "pino";
import { pipelineScript } from "./testing";
import { noSources, type PipelineDeps } from "./types";
import { lessonWorkflow, registerDevDeps } from "./workflow";

/*
 * Development-only Studio entry (ADR 0025 §21): `bun run studio:generation` boots Mastra's dev
 * server with the default in-memory storage so the `lesson-plan` workflow can be inspected and
 * run by hand. Never imported by an app or by `src/index.ts` (`bundle.test.ts` pins that).
 *
 * `AI_FAKE_SCRIPT=1` runs on `createFakeAi` with the fixture script — network-free, free of
 * charge; otherwise `createAi(process.env)` (Bedrock, needs `AWS_BEARER_TOKEN_BEDROCK`). Studio
 * starts runs from a JSON form that cannot carry functions, so `registerDevDeps` below supplies
 * the deps per run; production never registers one.
 */

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function devAi() {
  if (process.env.AI_FAKE_SCRIPT) return createFakeAi({ script: pipelineScript() });
  const {
    AWS_BEARER_TOKEN_BEDROCK,
    AWS_REGION,
    AI_MODEL_FRONTIER,
    AI_MODEL_STANDARD,
    AI_MODEL_SMALL,
  } = process.env;
  return createAi(
    { AWS_BEARER_TOKEN_BEDROCK, AWS_REGION, AI_MODEL_FRONTIER, AI_MODEL_STANDARD, AI_MODEL_SMALL },
    { logger },
  );
}

/** Deps for a Studio run: persistence is a log line, ids are a counter. */
export function devDeps(context: { lessonId: string; jobId: string }): PipelineDeps {
  let n = 0;
  return {
    ai: devAi(),
    budget: createBudget({
      capUsd: Number(process.env.AI_LESSON_COST_CAP_USD ?? 0.5),
      capTokens: Number(process.env.AI_LESSON_TOKEN_CAP ?? 300_000),
    }),
    signal: new AbortController().signal,
    logger,
    now: () => new Date(),
    ids: () => `dev${++n}`,
    sources: noSources,
    persist: async (lesson, worksheet) => {
      const updatedAt = new Date().toISOString();
      logger.info(
        {
          lessonId: lesson.id,
          slides: lesson.slides.length,
          blocks: worksheet?.blocks.length ?? 0,
          stage: lesson.generation?.stage,
        },
        "studio persist (not written anywhere)",
      );
      return { updatedAt };
    },
    onProgress: async (percent, message) => {
      logger.info({ percent, message }, "studio progress");
    },
    context,
  };
}

// A Studio run starts from a JSON form that cannot carry `deps`; the workflow asks this factory.
registerDevDeps((runId) => devDeps({ lessonId: "studio-lesson", jobId: runId }));

export const mastra = new Mastra({
  workflows: { lessonWorkflow },
  logger: false,
});
