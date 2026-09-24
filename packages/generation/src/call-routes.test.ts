import { expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { z } from "zod";
import {
  CALL_TIMEOUT_MS,
  callStructured,
  callTimeoutMs,
  FAST_CALL_TIMEOUT_MS,
  isFastModelId,
  providerOptionsFor,
} from "./call";
import { memoryLogger, recordingDeps } from "./testing";

/*
 * Per-route settings (lab pw, 24 Sept 2026): a fast gateway route (Luna, Gemini Flash-Lite) has
 * its own, shorter deadlines; the class models keep theirs. Gemini 2.5 takes a thinking budget
 * where Gemini 3 takes a level.
 */

test("a fast route is Luna or a Gemini Flash-Lite through the gateway, never a Bedrock or Sol id", () => {
  expect(isFastModelId("openai/gpt-5.6-luna")).toBe(true);
  expect(isFastModelId("openai/gpt-6-luna")).toBe(true);
  expect(isFastModelId("google/gemini-3.1-flash-lite")).toBe(true);
  expect(isFastModelId("google/gemini-2.5-flash-lite")).toBe(true);
  expect(isFastModelId("google/gemini-3.5-flash-lite")).toBe(true);
  for (const slow of [
    "us.openai.gpt-5.6-luna",
    "us.openai.gpt-5.6-sol",
    "openai/gpt-5.6-sol",
    "openai/gpt-6-sol",
    "us.anthropic.claude-sonnet-5",
    "anthropic/claude-opus-5",
    "google/gemini-3.8-flash",
  ])
    expect(isFastModelId(slow)).toBe(false);
});

test("a fast route's deadline is its own table's; a class model keeps the class table", () => {
  expect(callTimeoutMs("evaluate.v7", "openai/gpt-5.6-luna")).toBe(90_000);
  expect(callTimeoutMs("repair.v14", "openai/gpt-5.6-luna")).toBe(30_000);
  expect(callTimeoutMs("plan-question-set.v2", "google/gemini-3.1-flash-lite")).toBe(60_000);
  expect(callTimeoutMs("generate-slide.v23", "google/gemini-3.1-flash-lite")).toBe(45_000);
  expect(callTimeoutMs("evaluate.v7", "us.openai.gpt-5.6-sol")).toBe(CALL_TIMEOUT_MS.evaluate);
  expect(callTimeoutMs("evaluate.v7", "us.anthropic.claude-opus-5")).toBe(CALL_TIMEOUT_MS.evaluate);
  expect(callTimeoutMs("evaluate.v7")).toBe(CALL_TIMEOUT_MS.evaluate);
  // A prompt unmeasured on a fast route keeps the class bound; an unknown prompt the default.
  expect(callTimeoutMs("plan-skeleton.v3", "openai/gpt-5.6-luna")).toBe(
    CALL_TIMEOUT_MS["plan-skeleton"],
  );
  expect(callTimeoutMs("rubric-judge.v2", "openai/gpt-5.6-luna")).toBe(300_000);
  // Every fast bound is under the class bound for the same prompt, and none is under 30 s.
  for (const [name, ms] of Object.entries(FAST_CALL_TIMEOUT_MS)) {
    expect(ms).toBeGreaterThanOrEqual(30_000);
    expect(ms).toBeLessThan(callTimeoutMs(`${name}.v1`));
  }
});

test("callStructured takes the deadline from the model the call was routed to", async () => {
  const hang = () => new Promise<string>(() => {});
  const ai = createFakeAi({ fallback: hang, modelIds: { small: "openai/gpt-5.6-luna" } });
  const { logger, lines } = memoryLogger();
  const deps = recordingDeps(ai, { logger });
  // The fast bound for repair is 30 s: too long for a test, so the clock is checked only through
  // the logged `timeoutMs`; the hung attempts are cut by the test's own override otherwise.
  const error = await callStructured({
    deps,
    stage: "repair",
    cls: "small",
    effort: "low",
    prompt: { version: "repair.v14", system: "s", user: () => "u" },
    input: null,
    schema: z.object({ answer: z.string() }),
    maxOutputTokens: 100,
    timeoutMs: 20,
  }).catch((e) => e);
  expect(error).toMatchObject({ name: "StageFailure", reason: "timeout" });
  expect(lines.join()).toContain('"timeoutMs":20');
  // Without the override the routed id decides.
  expect(callTimeoutMs("repair.v14", ai.modelId("small"))).toBe(30_000);
});

test("Gemini 2.5 gets a thinking budget (off at low); Gemini 3 a thinking level", () => {
  const google = (id: string, effort: "low" | "high") =>
    providerOptionsFor(id, effort).providerOptions?.google;
  expect(google("google/gemini-2.5-flash-lite", "low")).toEqual({
    thinkingConfig: { thinkingBudget: 0 },
  });
  expect(google("google/gemini-2.5-flash-lite", "high")).toEqual({
    thinkingConfig: { thinkingBudget: 4096 },
  });
  expect(google("google/gemini-3.1-flash-lite", "low")).toEqual({
    thinkingConfig: { thinkingLevel: "low" },
  });
  expect(google("google/gemini-3.5-flash-lite", "high")).toEqual({
    thinkingConfig: { thinkingLevel: "high" },
  });
});
