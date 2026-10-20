import { describe, expect, test } from "bun:test";
import type { Observability } from "@tj/observability";
import pino from "pino";
import { parseEnv } from "./env";
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
});
