import { expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { z } from "zod";
import { callStructured, callTimeoutMs } from "./call";
import { PROMPTS } from "./prompts";
import { memoryLogger, recordingDeps } from "./testing";
import { BudgetExceeded, StageFailure } from "./types";

const hang = () => new Promise<string>(() => {});
const good = JSON.stringify({ answer: "ok" });
const prompt = { version: "test.v1", system: "private system", user: () => "private input" };
const run = (deps: ReturnType<typeof recordingDeps>, timeoutMs = 50) =>
  callStructured({
    deps,
    stage: "generate",
    cls: "small",
    effort: "low",
    prompt,
    input: null,
    schema: z.object({ answer: z.string() }),
    maxOutputTokens: 100,
    timeoutMs,
  });

test("two hung attempts are bounded, abort their provider signals and log no content", async () => {
  const ai = createFakeAi({ fallback: hang });
  const { logger, lines } = memoryLogger();
  const deps = recordingDeps(ai, { logger });
  const started = performance.now();
  const error = await run(deps).catch((error) => error);
  expect(error).toBeInstanceOf(StageFailure);
  expect(error.reason).toBe("timeout");
  expect(performance.now() - started).toBeLessThan(1000);
  expect(ai.calls).toHaveLength(2);
  expect(ai.calls.every((call) => call.abortSignal?.aborted)).toBe(true);
  expect(deps.budget.totals()).toMatchObject({ calls: 0, uncertain: { calls: 2 } });
  expect(deps.signal.aborted).toBe(false);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ msg: "model call timed out", stage: "generate", timeoutMs: 50 }),
    expect.objectContaining({ msg: "model call timed out", stage: "generate", timeoutMs: 50 }),
  ]);
  expect(lines.join()).not.toContain("private");
}, 2000);

test("a timeout retries the original request with a fresh signal, once", async () => {
  const ai = createFakeAi({ script: [hang, good] });
  const result = await run(recordingDeps(ai));
  expect(result.attempts).toBe(2);
  expect(result.output).toEqual({ answer: "ok" });
  expect(ai.calls[0]?.promptText).toBe(ai.calls[1]?.promptText);
  expect(ai.calls[0]?.abortSignal?.aborted).toBe(true);
  expect(ai.calls[1]?.abortSignal?.aborted).toBe(false);
});

test("schema miss then timeout shares the same single retry allowance", async () => {
  const ai = createFakeAi({ script: ["{}", hang, good] });
  await expect(run(recordingDeps(ai))).rejects.toMatchObject({ reason: "timeout" });
  expect(ai.calls).toHaveLength(2);
});

test("timeout then schema miss fails validation without a third call", async () => {
  const ai = createFakeAi({ script: [hang, "{}", good] });
  await expect(run(recordingDeps(ai))).rejects.toMatchObject({
    name: "StageFailure",
    reason: undefined,
  });
  expect(ai.calls).toHaveLength(2);
});

test("cancellation during a hung attempt is not retried or reported as timeout", async () => {
  const { logger, lines } = memoryLogger();
  const ai = createFakeAi({
    fallback: () => {
      deps.abort.abort();
      return hang();
    },
  });
  const deps = recordingDeps(ai, { logger });
  await expect(run(deps)).rejects.toMatchObject({ name: "AbortError" });
  expect(ai.calls).toHaveLength(1);
  expect(lines).toEqual([]);
  expect(deps.budget.totals().uncertain?.calls).toBe(1);
});

test("the budget gate still applies before a timeout retry", async () => {
  const ai = createFakeAi({
    script: [
      () => {
        deps.budget.charge(ai.modelId("small"), { inputTokens: 100_000_000, outputTokens: 1 });
        return hang();
      },
      good,
    ],
  });
  const deps = recordingDeps(ai);
  await expect(run(deps)).rejects.toBeInstanceOf(BudgetExceeded);
  expect(ai.calls).toHaveLength(1);
});

test("late provider success reconciles uncertain usage once without overwriting the retry", async () => {
  const late = Promise.withResolvers<string>();
  const ai = createFakeAi({ script: [() => late.promise, good] });
  const deps = recordingDeps(ai);
  const result = await run(deps);
  const totals = deps.budget.totals();
  expect(totals).toMatchObject({ calls: 1, uncertain: { calls: 1 } });
  late.resolve(JSON.stringify({ answer: "late" }));
  await Bun.sleep(20);
  expect(result.output).toEqual({ answer: "ok" });
  expect(deps.budget.totals()).toMatchObject({ calls: 2, inputTokens: 2, outputTokens: 2 });
  expect(deps.budget.totals()).not.toHaveProperty("uncertain");
});

test("each registered prompt uses its stage-specific deadline across version bumps", () => {
  // In PROMPTS order; the fill and parse-brief calls are short `small` calls (TEACH-67).
  // The four per-objective plan prompts are registered but uncalled (TEACH-88): the old default.
  const expected = [
    180, 180, 300, 300, 300, 300, 300, 180, 180, 300, 180, 180, 180, 180, 300, 180, 180, 300, 300,
  ];
  expect(Object.values(PROMPTS).map((prompt) => callTimeoutMs(prompt.version))).toEqual(
    expected.map((seconds) => seconds * 1000),
  );
  expect(callTimeoutMs("plan-facts.v99")).toBe(300_000);
  expect(callTimeoutMs("rubric-judge.v2")).toBe(300_000);
  expect(callTimeoutMs("constructor")).toBe(300_000);
});
