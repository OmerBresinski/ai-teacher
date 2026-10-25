import { describe, expect, spyOn, test } from "bun:test";
import { PROVIDER_ERROR_CODES } from "@tj/ai";
import * as gen from "@tj/generation";
import { VERIFY_FIELDS, VERIFY_REASONS } from "@tj/generation";
import { PICTURE_FAIL_STAGES } from "@tj/images";
import * as obs from "@tj/observability";
import { FACT_FIELDS, FACT_REASONS, type Observability } from "@tj/observability";
import pino from "pino";
import { parseEnv } from "./env";
import { createLogger } from "./logger";
import {
  aiGenerationOf,
  createWorkerObservability,
  lessonIdOf,
  reportJobFailure,
} from "./observability";

const DB = "postgres://postgres:postgres@localhost:5432/teaching_journey";
const quiet = pino({ level: "silent" });

function recorder() {
  const seen: Array<[string, unknown]> = [];
  const obs: Observability = {
    enabled: true,
    beginJob: () => () => {},
    captureJobFailure: (f) => void seen.push(["job", f]),
    captureException: (e, source) => void seen.push(["exception", { e, source }]),
    captureAiGeneration: (c) => void seen.push(["ai", c]),
    captureLessonSummary: (s) => void seen.push(["summary", s]),
    captureLogLine: () => {},
    captureJobEvent: () => {},
    flush: async () => {},
    shutdown: async () => {},
  };
  return { obs, seen };
}

describe("worker observability (ADR 0041)", () => {
  test("is off without POSTHOG_API_KEY, on with one", () => {
    expect(createWorkerObservability(parseEnv({ DATABASE_URL: DB }), quiet).enabled).toBe(false);
    expect(
      createWorkerObservability(parseEnv({ DATABASE_URL: DB, POSTHOG_API_KEY: "  " }), quiet)
        .enabled,
    ).toBe(false);
    const on = createWorkerObservability(
      parseEnv({ DATABASE_URL: DB, POSTHOG_API_KEY: "phc_test" }),
      quiet,
    );
    expect(on.enabled).toBe(true);
    return on.shutdown();
  });

  test("without a key (dev, tests, CI) nothing reaches the network, whatever is captured", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");
    try {
      const obs = createWorkerObservability(parseEnv({ DATABASE_URL: DB }), quiet);
      expect(obs.enabled).toBe(false);
      const endJob = obs.beginJob("j1", { job: "lesson.plan", workspaceId: "w1", lessonId: "l1" });
      obs.captureJobEvent("j1", "gen_job", { status: "picked" });
      obs.captureException(new Error("boom"), "uncaughtException");
      obs.captureJobFailure({
        error: new Error("x"),
        job: "lesson.plan",
        jobId: "j1",
        attempt: 1,
        willRetry: false,
      });
      endJob();
      await obs.flush();
      await obs.shutdown();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("a job failure goes to captureJobFailure; one without a job id is an exception", () => {
    const { obs, seen } = recorder();
    const error = new Error("x");
    reportJobFailure(obs, {
      error,
      job: "lesson.plan",
      jobId: "j1",
      workspaceId: "w1",
      attempt: 1,
      willRetry: false,
      kind: "handler",
    });
    reportJobFailure(obs, {
      error,
      job: "lesson.plan",
      attempt: 0,
      willRetry: true,
      kind: "infrastructure",
    });
    expect(seen[0]).toEqual([
      "job",
      { error, job: "lesson.plan", jobId: "j1", workspaceId: "w1", attempt: 1, willRetry: false },
    ]);
    expect(seen[1]).toEqual(["exception", { e: error, source: "job:infrastructure" }]);
  });

  test("an ai call record maps field by field", () => {
    expect(
      aiGenerationOf({
        class: "small",
        modelId: "m",
        provider: "openai.chat",
        durationMs: 5,
        inputTokens: 1,
        outputTokens: 2,
        costUsd: 0.1,
        finishReason: "stop",
        isError: false,
        jobId: "j",
        stage: "write",
      }),
    ).toMatchObject({
      modelClass: "small",
      modelId: "m",
      jobId: "j",
      stage: "write",
      isError: false,
    });
  });

  test("lessonIdOf reads the payload without trusting it", () => {
    expect(lessonIdOf({ payload: { lessonId: "l1" } })).toBe("l1");
    expect(lessonIdOf({ payload: { lessonId: 3 } })).toBeUndefined();
    expect(lessonIdOf(null)).toBeUndefined();
  });

  test("POSTHOG_HOST must be a URL", () => {
    expect(
      parseEnv({ DATABASE_URL: DB, POSTHOG_HOST: "https://eu.i.posthog.com" }).POSTHOG_HOST,
    ).toBe("https://eu.i.posthog.com");
  });

  test("the logger tap sees each line with its bindings and never breaks logging", () => {
    const seen: unknown[] = [];
    const lines: string[] = [];
    const logger = createLogger(
      { NODE_ENV: "test", LOG_LEVEL: "info" },
      { write: (l: string) => void lines.push(l) },
      (bindings, record, msg) => {
        seen.push({ bindings, record, msg });
        throw new Error("tap down");
      },
    );
    logger.child({ jobId: "j1", attempt: 0 }).info({ ev: "stage", stage: "write" }, "timeline");
    logger.info("plain message");
    expect(lines).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      bindings: { jobId: "j1", attempt: 0 },
      record: { ev: "stage", stage: "write" },
      msg: "timeline",
    });
    expect(seen[1]).toMatchObject({ record: {}, msg: "plain message" });
  });

  test("the fact-check count names are the generation enums, so no name comes from model text", () => {
    expect([...FACT_REASONS]).toEqual([...VERIFY_REASONS]);
    expect([...FACT_FIELDS]).toEqual([...VERIFY_FIELDS]);
  });

  test("the lesson picture codes PostHog accepts are the ones the pipeline logs", () => {
    const pairs = [
      [obs.PICTURE_FAIL_REASONS, gen.PICTURE_FAIL_REASONS],
      [obs.JUDGE_CHECKS, gen.JUDGE_CHECKS],
      [obs.SOURCE_KINDS, gen.SOURCE_KINDS],
      [obs.PICTURE_KINDS, gen.PICTURE_KINDS],
      [obs.LESSON_SUBJECTS, gen.LESSON_SUBJECTS],
      [obs.KEY_STAGES, gen.KEY_STAGES],
    ] as const;
    for (const [sent, logged] of pairs)
      expect<string[]>([...sent].sort()).toEqual([...logged].sort());
  });
});

describe("provider failure detail", () => {
  test("the PostHog provider and picture failure enums are exactly the packages' own", () => {
    expect([...obs.PROVIDER_ERROR_CODES].sort()).toEqual([...PROVIDER_ERROR_CODES].sort());
    expect([...obs.PICTURE_FAIL_STAGES]).toEqual([...PICTURE_FAIL_STAGES]);
  });

  test("aiGenerationOf passes a failed call's status and code through", () => {
    expect(
      aiGenerationOf({
        class: "small",
        modelId: "gpt-6-luna",
        provider: "openai.chat",
        durationMs: 255,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        finishReason: "error",
        isError: true,
        statusCode: 401,
        providerErrorCode: "invalid_api_key",
        stage: "check-input",
      }),
    ).toMatchObject({ isError: true, statusCode: 401, providerErrorCode: "invalid_api_key" });
  });
});
