import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import pino from "pino";
import { z } from "zod";
import { callStructured } from "./call";
import { BudgetExceeded, type PipelineDeps, StageFailure } from "./types";

const schema = z.strictObject({ answer: z.string() });
const prompt = {
  version: "test.v1",
  system: "system text",
  user: (input: string) => `user ${input}`,
};

/** A pino logger that keeps its JSON lines so a test can assert what did (not) reach the log. */
function capturingLogger() {
  const lines: string[] = [];
  const logger = pino(
    { level: "info" },
    new Writable({
      write(c, _e, cb) {
        lines.push(c.toString());
        cb();
      },
    }),
  );
  return { logger, text: () => lines.join("\n") };
}

function deps(ai: ReturnType<typeof createFakeAi>, extra: Partial<PipelineDeps> = {}) {
  return {
    ai,
    budget: createBudget({ capUsd: 1, capTokens: 1_000_000 }),
    signal: new AbortController().signal,
    logger: pino({ level: "silent" }),
    context: { lessonId: "l1", jobId: "j1" },
    ...extra,
  };
}

const call = (d: ReturnType<typeof deps>, input = "hi") =>
  callStructured({
    deps: d,
    stage: "plan",
    cls: "standard",
    prompt,
    input,
    schema,
    maxOutputTokens: 100,
  });

describe("callStructured", () => {
  test("returns the parsed object, charges the budget and carries the stage context", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ answer: "42" })],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const d = deps(ai);
    const result = await call(d);
    expect(result).toEqual({
      output: { answer: "42" },
      usage: { inputTokens: 10, outputTokens: 5 },
      attempts: 1,
      modelId: ai.modelId("standard"),
    });
    expect(d.budget.totals()).toMatchObject({ calls: 1, inputTokens: 10, outputTokens: 5 });
    expect(ai.calls[0]?.context).toEqual({
      lessonId: "l1",
      jobId: "j1",
      stage: "plan",
      promptVersion: "test.v1",
    });
  });

  test("retries once on a schema miss with the issues in the prompt, and both attempts are charged", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ answer: 1, pupilName: "Aisha" }), JSON.stringify({ answer: "ok" })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    const result = await call(d);
    expect(result.attempts).toBe(2);
    expect(result.output).toEqual({ answer: "ok" });
    expect(d.budget.totals().calls).toBe(2);
    expect(ai.calls).toHaveLength(2);
    expect(log.text()).toContain("retrying once");
    // The validation issues (path + message) are logged so a production miss is diagnosable…
    expect(log.text()).toContain("answer: Invalid input: expected string, received number");
    // …with the key names the model invented reduced to a count (ADR 0015)…
    expect(log.text()).toContain("1 unrecognized key(s)");
    expect(log.text()).not.toContain("pupilName");
    expect(log.text()).not.toContain("Aisha");
    // …and neither the model's text nor the prompt reaches the log.
    expect(log.text()).not.toContain('"answer":1');
    expect(log.text()).not.toContain("system text");
  });

  test("a second miss is a StageFailure naming the stage, with the issues as cause and in the log", async () => {
    const ai = createFakeAi({
      script: ["nope", JSON.stringify({ answer: 2, pupilName: "Aisha" })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    const error = await call(d).catch((e) => e);
    expect(error).toBeInstanceOf(StageFailure);
    expect((error as StageFailure).stage).toBe("plan");
    // The cause (what the retry prompt is built from) keeps the key name; the log does not.
    expect((error as StageFailure).cause).toEqual([
      "- answer: Invalid input: expected string, received number",
      '- Unrecognized key: "pupilName"',
    ]);
    expect((error as Error).message).not.toContain("nope");
    expect(d.budget.totals().calls).toBe(2);
    // Both misses' issues reach the log (pino drops a non-Error `cause`), the model's text does not.
    expect(log.text()).toContain("giving up");
    expect(log.text()).toContain("- The answer was not valid JSON for the requested shape.");
    expect(log.text()).toContain("- answer: Invalid input: expected string, received number");
    expect(log.text()).toContain("- 1 unrecognized key(s)");
    expect(log.text()).not.toContain("pupilName");
    expect(log.text()).not.toContain("nope");
    expect(log.text()).not.toContain('"answer":2');
  });

  test("an exceeded budget refuses the call before it is made", async () => {
    const ai = createFakeAi({ script: ["unused"] });
    const budget = createBudget({ capUsd: 0.000001, capTokens: 10 });
    budget.charge("made-up", { inputTokens: 50, outputTokens: 0 });
    const error = await call(deps(ai, { budget })).catch((e) => e);
    expect(error).toBeInstanceOf(BudgetExceeded);
    expect((error as BudgetExceeded).by).toBe("tokens");
    expect(ai.calls).toHaveLength(0);
  });

  test("an aborted signal rejects without a retry", async () => {
    const controller = new AbortController();
    controller.abort();
    const ai = createFakeAi({ script: [JSON.stringify({ answer: "x" })] });
    await expect(call(deps(ai, { signal: controller.signal }))).rejects.toThrow();
    expect(ai.calls.length).toBeLessThanOrEqual(1);
  });

  test("an abort between the first miss and the retry stops the retry", async () => {
    const controller = new AbortController();
    const ai = createFakeAi({
      script: [
        (call) => {
          // The first answer is a schema miss; cancel lands while it is being handled.
          if (call.index === 0) controller.abort();
          return "nope";
        },
        JSON.stringify({ answer: "never asked" }),
      ],
    });
    const error = await call(deps(ai, { signal: controller.signal })).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
    expect(ai.calls).toHaveLength(1);
  });

  test("a provider error is rethrown as is (no retry, no StageFailure)", async () => {
    const ai = createFakeAi({ error: new Error("bedrock down") });
    const error = await call(deps(ai)).catch((e) => e);
    expect(error).not.toBeInstanceOf(StageFailure);
    expect(ai.calls).toHaveLength(0);
  });
});
