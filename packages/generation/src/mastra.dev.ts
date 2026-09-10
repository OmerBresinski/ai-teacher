import { Mastra } from "@mastra/core";
import { createWorkflow } from "@mastra/core/workflows";
import { createAi, createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { CreateLessonSchema, lessonFromBrief } from "@tj/domain/documents";
import pino from "pino";
import { pipelineScript, routed } from "./testing";
import { noSources, type PipelineDeps } from "./types";
import { lessonWorkflow, registerDevDeps, StateSchema } from "./workflow";

/*
 * Development-only Studio entry (ADR 0025 §21): `bun run studio:generation` boots Mastra's dev
 * server with the default in-memory storage so the `lesson-plan` workflow can be inspected and
 * run by hand. Never imported by an app or by `src/index.ts` (`bundle.test.ts` pins that).
 *
 * `bun run studio:generation` loads `apps/worker/.env` (`mastra dev --env`), so Bedrock, the
 * model ids and the budget caps come from the same file the worker uses — no flags. Without
 * `AWS_BEARER_TOKEN_BEDROCK` the client boots `unconfigured` and the first run fails with the
 * standard message rather than silently using the fake. `AI_FAKE_SCRIPT=1 bun run
 * studio:generation` opts into `createFakeAi` on the fixture script: network-free, free of
 * charge, and the topic is ignored. Studio starts runs from a JSON form that cannot carry
 * functions, so `registerDevDeps` below supplies the deps per run; production never registers
 * one.
 */

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function devAi() {
  if (process.env.AI_FAKE_SCRIPT) return createFakeAi({ script: routed(pipelineScript()) });
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

/**
 * Studio's port: 4111 unless `PORT` is set in the shell. Read here from the shell (`process.env`
 * before `--env` is merged is not available), so the root script sets `PORT=4111` explicitly:
 * without it `apps/worker/.env`'s `PORT=3002` would move Studio onto the worker's port.
 */
export const STUDIO_PORT = Number(process.env.PORT ?? 4111);

/**
 * What Studio's run form asks for: the same brief `POST /lessons` takes (`CreateLessonSchema`),
 * mapped to the pipeline state with `lessonFromBrief` — the lesson id and worksheet id are
 * minted here since nothing is persisted. The inner `lessonWorkflow` takes a whole `PipelineState`,
 * which is not something to type into a form.
 */
export const StudioInputSchema = CreateLessonSchema.extend({
  // `.describe()` on the domain schemas themselves: the identifier guard and length caps on
  // `topic` stay exactly as `POST /lessons` applies them (ADR 0024 §2).
  brief: CreateLessonSchema.shape.brief.extend({
    topic: CreateLessonSchema.shape.brief.shape.topic.describe(
      "Topic or objective, e.g. 'The water cycle'",
    ),
  }),
  yearGroup: CreateLessonSchema.shape.yearGroup.describe(
    "e.g. 'Year 5' — sets the key stage and default length",
  ),
});

export const studioLessonWorkflow = createWorkflow({
  id: "lesson-from-brief",
  description:
    "Type a brief, get a lesson: the full Plan → Generate → Evaluate → Repair pipeline (ADR 0025)",
  inputSchema: StudioInputSchema,
  outputSchema: StateSchema,
})
  .map(async ({ inputData }) => ({
    lesson: lessonFromBrief(inputData, crypto.randomUUID(), new Date()),
    worksheetId: crypto.randomUUID(),
  }))
  .then(lessonWorkflow)
  .commit();

export const mastra = new Mastra({
  workflows: { studioLessonWorkflow, lessonWorkflow },
  logger: false,
  server: { port: STUDIO_PORT },
});
