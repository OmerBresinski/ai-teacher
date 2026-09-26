import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { AiError, createBudget, ProviderFailure } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { shapeIssue, slideSpecSchemaFor } from "@tj/slides";
import { APICallError, type Schema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import pino from "pino";
import { z } from "zod";
import {
  callStructured,
  imageMediaType,
  isCapMiss,
  providerOptionsFor,
  specRuleFinding,
  wireSchemaFor,
} from "./call";
import recordedY1 from "./fixtures/objective-facts.cb-y1-animals-L.cap-miss.json";
import { planFactsObjectiveOutputSchemaFor } from "./prompts/plan-facts-objective";
import { lessonShapeOf } from "./shapes";
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
    effort: "medium",
    prompt,
    input,
    schema,
    maxOutputTokens: 100,
  });

test("concurrent structured calls reserve before dispatch and expose BudgetExceeded to stages", async () => {
  const probeBudget = createBudget({ capUsd: 1, capTokens: 100_000 });
  let cap: number | undefined;
  const probe = createFakeAi({
    fallback: () => {
      cap = probeBudget.totals().reserved?.costUsd ?? undefined;
      return JSON.stringify({ answer: "ok" });
    },
  });
  await call(deps(probe, { budget: probeBudget }));
  if (cap === undefined) throw new Error("provider was reached without a reservation");
  const budget = createBudget({ capUsd: cap, capTokens: 100_000 });
  const gate = Promise.withResolvers<string>();
  const ai = createFakeAi({ fallback: () => gate.promise });
  const shared = deps(ai, { budget });
  const first = call(shared);
  try {
    const others = await Promise.allSettled(Array.from({ length: 3 }, () => call(shared)));
    expect(ai.calls).toHaveLength(1);
    for (const result of others) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(BudgetExceeded);
    }
  } finally {
    gate.resolve(JSON.stringify({ answer: "ok" }));
  }
  expect((await first).output).toEqual({ answer: "ok" });
  expect(budget.totals().calls).toBe(1);
});

test("zero budget dispatches no provider call", async () => {
  const ai = createFakeAi({ text: JSON.stringify({ answer: "unused" }) });
  await expect(
    call(deps(ai, { budget: createBudget({ capUsd: 0, capTokens: 100_000 }) })),
  ).rejects.toBeInstanceOf(BudgetExceeded);
  expect(ai.calls).toHaveLength(0);
});

test("retryable provider faults are one reserved dispatch, not hidden SDK transport retries", async () => {
  const ai = createFakeAi();
  let calls = 0;
  const error = new APICallError({
    message: "synthetic transient failure",
    url: "https://fake.invalid",
    requestBodyValues: {},
    statusCode: 503,
    isRetryable: true,
  });
  ai.model = () =>
    new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        throw error;
      },
    });
  const d = deps(ai);
  await expect(call(d)).rejects.toBe(error);
  expect(calls).toBe(1);
  expect(d.budget.totals()).toMatchObject({ calls: 0, uncertain: { calls: 1 } });
});

describe("provider failures that are not permanent are retried once", () => {
  const fault = (isRetryable?: boolean) =>
    new AiError("provider", "Bedrock model call failed: The model provider request failed.", {
      cause: new ProviderFailure("APICallError", "The model provider request failed.", {
        statusCode: 503,
        ...(isRetryable === undefined ? {} : { isRetryable }),
      }),
    });
  const flaky = (first: AiError) => {
    const ai = createFakeAi();
    let calls = 0;
    ai.model = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          if (calls === 1) throw first;
          return {
            content: [{ type: "text", text: JSON.stringify({ answer: "ok" }) }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
            warnings: [],
          };
        },
      });
    return { ai, calls: () => calls };
  };
  test("a retryable or unlabelled provider failure is retried and the answer kept", async () => {
    for (const first of [fault(true), fault()]) {
      const { ai, calls } = flaky(first);
      const result = await call(deps(ai));
      expect(result.output).toEqual({ answer: "ok" });
      expect(calls()).toBe(2);
    }
  });
  test("a provider failure marked permanent is not retried", async () => {
    const first = fault(false);
    const { ai, calls } = flaky(first);
    await expect(call(deps(ai))).rejects.toBe(first);
    expect(calls()).toBe(1);
  });
});

/** A list field, for the Bedrock "list as a string" quirk (`repair-json.ts`). */
const listSchema = z.strictObject({ items: z.array(z.string()).max(4) });
const callList = (d: ReturnType<typeof deps>) =>
  callStructured({
    deps: d,
    stage: "plan",
    cls: "standard",
    effort: "medium",
    prompt,
    input: "hi",
    schema: listSchema,
    maxOutputTokens: 100,
  });

describe("callStructured repairs the text before validating it", () => {
  test("a list sent as a JSON string is unwrapped: one call, no retry, the repair kinds logged", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ items: JSON.stringify(["a", "b"]) })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    const result = await callList(d);
    expect(result.output).toEqual({ items: ["a", "b"] });
    expect(result.attempts).toBe(1);
    expect(ai.calls).toHaveLength(1);
    expect(log.text()).toContain("structured output repaired before validation");
    expect(log.text()).toContain('"repairs":["parsed-string"]');
    expect(log.text()).not.toContain("retrying once");
    // Only the repair kinds are logged, never the text.
    expect(log.text()).not.toContain('"a"');
  });

  test("the whole answer sent as a string under its first key is hoisted", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ items: JSON.stringify({ items: ["a"] }) })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    const result = await callList(d);
    expect(result.output).toEqual({ items: ["a"] });
    expect(result.attempts).toBe(1);
    expect(log.text()).toContain('"repairs":["parsed-string","hoisted"]');
  });

  test("an answer that already validates is never repaired, even when a string holds JSON", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ answer: JSON.stringify({ answer: "ok" }) })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    const result = await call(d);
    expect(result.output).toEqual({ answer: '{"answer":"ok"}' });
    expect(log.text()).not.toContain("repaired");
  });

  test("a repair that still does not validate falls through to the retry with the original issues", async () => {
    const ai = createFakeAi({
      // `[1, 2]` unwraps to numbers, which the schema refuses; the retry answers properly.
      script: [JSON.stringify({ items: "[1, 2]" }), JSON.stringify({ items: ["a"] })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    const result = await callList(d);
    expect(result.output).toEqual({ items: ["a"] });
    expect(result.attempts).toBe(2);
    expect(log.text()).not.toContain("repaired before validation");
    // The issue describes what the model sent (a string), not the failed repair (numbers).
    expect(ai.calls[1]?.promptText).toContain(
      "items: Invalid input: expected array, received string",
    );
    expect(log.text()).toContain("invalid_type: 1");
    expect(log.text()).not.toContain("received number");
  });

  test("two refinement failures on one path are both kept: only follow-ons to a type miss are dropped", async () => {
    const twice = z.strictObject({
      items: z
        .array(z.string())
        .refine((v) => v.length !== 1, { message: "give more than one item" })
        .refine((v) => !v.includes("x"), { message: "no x" }),
    });
    const ai = createFakeAi({
      script: [JSON.stringify({ items: ["x"] }), JSON.stringify({ items: ["a", "b"] })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    await callStructured({
      deps: d,
      stage: "plan",
      cls: "standard",
      effort: "medium",
      prompt,
      input: "hi",
      schema: twice,
      maxOutputTokens: 100,
    });
    const issues = /"issues":(\[[^\]]*\])/.exec(log.text())?.[1];
    expect(JSON.parse(issues as string)).toEqual(["custom: 2"]);
    expect(ai.calls[1]?.promptText).toContain("- items: give more than one item");
    expect(ai.calls[1]?.promptText).toContain("- items: no x");
  });

  test("one issue per path: the checks zod runs after a type miss are not sent to the model", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ items: "hello world" }), JSON.stringify({ items: ["a"] })],
    });
    const log = capturingLogger();
    const d = deps(ai, { logger: log.logger });
    await callList(d);
    const issues = /"issues":(\[[^\]]*\])/.exec(log.text())?.[1];
    expect(issues).toBeDefined();
    expect(JSON.parse(issues as string)).toContain("invalid_type: 1");
    expect(ai.calls[1]?.promptText).toContain(
      "- items: Invalid input: expected array, received string",
    );
  });
});

/** A 1×1 PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("wireSchemaFor (Gemini's schema dialect)", () => {
  const bounded = z.object({ items: z.array(z.string()).min(2).max(3) });

  test("a Bedrock or OpenAI id sends the zod schema itself", () => {
    expect(wireSchemaFor(bounded, "us.openai.gpt-5.6-luna")).toBe(bounded);
    expect(wireSchemaFor(bounded, "openai/gpt-5.6-luna")).toBe(bounded);
  });

  test("a google/ id sends a JSON schema without array bounds, and zod still enforces them", async () => {
    const wire = wireSchemaFor(bounded, "google/gemini-3.8-flash") as Schema<unknown>;
    expect(wire).not.toBe(bounded);
    expect(JSON.stringify(wire.jsonSchema)).not.toContain("minItems");
    expect(JSON.stringify(wire.jsonSchema)).not.toContain("maxItems");
    expect(JSON.stringify(wire.jsonSchema)).toContain('"items"');
    const ok = await wire.validate?.({ items: ["a", "b"] });
    expect(ok?.success).toBe(true);
    const short = await wire.validate?.({ items: ["a"] });
    expect(short?.success).toBe(false);
  });
});

describe("providerOptionsFor (the effort under every provider's namespace, ADR 0031)", () => {
  test("A8: an `openai/` id at `none` sends reasoningEffort none, non-strict schema, and Bedrock's floor `low`", () => {
    expect(providerOptionsFor("openai/gpt-5.6-luna", "none")).toEqual({
      providerOptions: {
        bedrock: { reasoningConfig: { maxReasoningEffort: "low" } },
        openai: { reasoningEffort: "none", strictJsonSchema: false },
        google: { thinkingConfig: { thinkingLevel: "low" } },
        alibaba: { enableThinking: false },
        deepseek: { thinking: { type: "disabled" } },
        gateway: { only: ["openai"] },
      },
    });
  });

  test("A9: a Bedrock id sends the effort as is, and no gateway pin", () => {
    const options = providerOptionsFor("us.openai.gpt-5.6-luna", "medium").providerOptions;
    expect(options?.openai).toEqual({ reasoningEffort: "medium", strictJsonSchema: false });
    expect(options?.bedrock.reasoningConfig.maxReasoningEffort).toBe("medium");
    expect(options && "gateway" in options).toBe(false);
  });

  test("the direct OpenAI route's bare id (`gpt-6-luna`) still sends a non-strict schema", () => {
    // The direct provider strips the `openai/` prefix, so the routed model reports the bare id.
    const sent = providerOptionsFor("gpt-6-luna", "none").providerOptions?.openai;
    expect(sent).toEqual({ reasoningEffort: "none", strictJsonSchema: false });
  });

  test("A10: an Anthropic id gets no provider options at all", () => {
    expect(providerOptionsFor("us.anthropic.claude-sonnet-5", "low")).toEqual({});
  });

  test("every offered effort is forwarded verbatim to OpenAI; `minimal` is not in the type", () => {
    for (const effort of ["none", "low", "medium", "high"] as const) {
      const sent = providerOptionsFor("openai/gpt-5.6-luna", effort).providerOptions?.openai;
      expect(sent?.reasoningEffort).toBe(effort);
    }
  });
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
      editorialMisses: [],
    });
    expect(d.budget.totals()).toMatchObject({ calls: 1, inputTokens: 10, outputTokens: 5 });
    expect(ai.calls[0]?.context).toEqual({
      lessonId: "l1",
      jobId: "j1",
      stage: "plan",
      promptVersion: "test.v1",
      effort: "medium",
    });
  });

  test("the effort travels to the provider as Bedrock's reasoningConfig and into the call context", async () => {
    const ai = createFakeAi({ script: [JSON.stringify({ answer: "42" })] });
    const d = deps(ai);
    await callStructured({
      deps: d,
      stage: "generate",
      cls: "standard",
      effort: "low",
      prompt,
      input: "hi",
      schema,
      maxOutputTokens: 100,
    });
    // Every provider namespace carries the same effort; a provider reads only its own.
    expect(ai.calls[0]?.providerOptions).toEqual({
      bedrock: { reasoningConfig: { maxReasoningEffort: "low" } },
      openai: { reasoningEffort: "low", strictJsonSchema: false },
      google: { thinkingConfig: { thinkingLevel: "low" } },
      alibaba: { enableThinking: false },
      deepseek: { thinking: { type: "disabled" } },
    });
    expect(ai.calls[0]?.context?.effort).toBe("low");
  });

  test("A12: the host's effortFor can turn a call down to `none`, and the fake records it as sent", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ answer: "42" })],
      modelIds: { standard: "openai/gpt-5.6-luna" },
    });
    const d = deps(ai, { effortFor: () => "none" });
    await callStructured({
      deps: d,
      stage: "generate",
      cls: "standard",
      effort: "medium",
      prompt,
      input: "hi",
      schema,
      maxOutputTokens: 100,
    });
    const sent = ai.calls[0]?.providerOptions as {
      openai: { reasoningEffort: string; strictJsonSchema: boolean };
      bedrock: { reasoningConfig: { maxReasoningEffort: string } };
    };
    expect(sent.openai).toEqual({ reasoningEffort: "none", strictJsonSchema: false });
    expect(sent.bedrock.reasoningConfig.maxReasoningEffort).toBe("low");
    expect(ai.calls[0]?.context?.effort).toBe("none");
  });

  test("row 1 (TEACH-220): images ride as image parts on the user turn, on the retry too", async () => {
    const ai = createFakeAi({ script: ["not json", JSON.stringify({ answer: "42" })] });
    const d = deps(ai);
    await callStructured({
      deps: d,
      stage: "illustrate",
      cls: "small",
      effort: "low",
      prompt,
      input: "hi",
      schema,
      maxOutputTokens: 100,
      // Data URLs: the SDK fetches an https image in-process before the call (Bedrock takes bytes
      // or s3:// only), which a unit test must not do.
      images: [
        { id: "a", url: `data:image/png;base64,${PNG}` },
        { id: "b", url: `data:image/png;base64,${PNG}` },
      ],
    });
    expect(ai.calls.map((c) => c.imageParts)).toEqual([2, 2]);
    expect(ai.calls[0]?.promptText).toContain("hi");
  });

  test("image parts go as `file` parts with the image's media type (the SDK's `image` part is deprecated)", () => {
    expect(imageMediaType(`data:image/png;base64,${PNG}`)).toBe("image/png");
    expect(imageMediaType("https://images.pexels.com/photos/1/tiny.jpeg?auto=compress")).toBe(
      "image/jpeg",
    );
    expect(imageMediaType("https://images.pexels.com/photos/1/tiny.webp")).toBe("image/webp");
    expect(imageMediaType("https://images.pexels.com/photos/1/tiny")).toBe("image/jpeg");
  });

  test("an Anthropic id gets no reasoningConfig (thinking is off there); the context still says the effort", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify({ answer: "42" })],
      modelIds: { standard: "us.anthropic.claude-sonnet-5" },
    });
    const d = deps(ai);
    await callStructured({
      deps: d,
      stage: "generate",
      cls: "standard",
      effort: "low",
      prompt,
      input: "hi",
      schema,
      maxOutputTokens: 100,
    });
    expect(ai.calls[0]?.providerOptions).toBeUndefined();
    expect(ai.calls[0]?.context?.effort).toBe("low");
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
    // The retry is the same call with the issues appended: same effort, same provider options.
    expect(ai.calls[1]?.providerOptions).toEqual(ai.calls[0]?.providerOptions);
    expect(ai.calls[1]?.providerOptions).toMatchObject({
      bedrock: { reasoningConfig: { maxReasoningEffort: "medium" } },
      openai: { reasoningEffort: "medium" },
    });
    expect(log.text()).toContain("retrying once");
    // Logs retain finite validation codes/counts; details remain inside the retry prompt.
    expect(log.text()).toContain("invalid_type: 1");
    expect(log.text()).toContain("unrecognized_keys: 1");
    expect(log.text()).not.toContain("pupilName");
    expect(log.text()).not.toContain("Aisha");
    // …and neither the model's text nor the prompt reaches the log.
    expect(log.text()).not.toContain('"answer":1');
    expect(log.text()).not.toContain("system text");
    // The retry carries the failed answer, so a miss is an edit, not a fresh answer (audit A1).
    expect(ai.calls[1]?.promptText).toContain(
      'Your previous answer:\n{"answer":1,"pupilName":"Aisha"}',
    );
    expect(ai.calls[1]?.promptText).toContain("did not validate");
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
    expect(log.text()).toContain("invalid_json: 1");
    expect(log.text()).toContain("invalid_type: 1");
    expect(log.text()).toContain("unrecognized_keys: 1");
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

describe("callStructured: editorial misses are accepted, shape misses fail (TEACH-257)", () => {
  const strict = slideSpecSchemaFor("worked-example");
  const soft = slideSpecSchemaFor("worked-example", { soft: true });
  if (!strict || !soft) throw new Error("worked-example schema");
  const worked = (step: unknown) =>
    JSON.stringify({
      kind: "worked-example",
      factRefs: ["x1"],
      question: "Why does a puddle vanish?",
      steps: Array.isArray(step) || typeof step === "string" ? step : [step],
    });
  const longStep = "x".repeat(90);
  // An editorial miss that is not a text cap (a leaked house rule): the retry still happens.
  const leakyStep = "Answer as JSON.";
  const good = worked(["Warm air passes energy in.", "Particles speed up."]);
  const run = (
    ai: ReturnType<typeof createFakeAi>,
    log: ReturnType<typeof capturingLogger>,
    withSoft = true,
  ) =>
    callStructured({
      deps: deps(ai, { logger: log.logger }),
      stage: "generate",
      cls: "small",
      effort: "low",
      prompt,
      input: "hi",
      schema: strict,
      ...(withSoft ? { soft } : {}),
      maxOutputTokens: 100,
    });

  test("row 1: a 90-character step is accepted on the first answer with one cap miss naming steps.0; no retry (lab round 1)", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), good] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(1);
    expect(ai.calls).toHaveLength(1);
    expect(result.editorialMisses).toEqual([
      { path: ["steps", 0], message: "Too long: at most 84 characters." },
    ]);
    // The accepted answer is the first one, parsed (trimmed, decoded) by the soft schema.
    expect(result.output).toMatchObject({ kind: "worked-example", steps: [longStep] });
    expect(log.text()).toContain("missed only text caps; accepted without a retry");
    expect(log.text()).not.toContain("retrying once");
    expect(log.text()).not.toContain("giving up");
    // The finding a stage records from it: spec-rule, on the target it names, path in the message.
    const finding = specRuleFinding(result.editorialMisses[0] as never, { slideId: "s7" });
    expect(finding).toEqual({
      check: "spec-rule",
      severity: "error",
      target: { slideId: "s7" },
      message: "steps.0: Too long: at most 84 characters.",
    });
  });

  test("row 1b: a leaked house rule twice resolves on the retry with one editorial miss; the warn line says editorialOnly", async () => {
    const ai = createFakeAi({ script: [worked([leakyStep]), worked([leakyStep])] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(ai.calls).toHaveLength(2);
    expect(result.editorialMisses.map((m) => m.path)).toEqual([["steps", 0]]);
    expect(isCapMiss(result.editorialMisses[0] as never)).toBe(false);
    expect(log.text()).toContain("did not validate on the retry; accepted");
    expect(log.text()).toContain('"editorialOnly":true');
  });

  test("row 1c: a cap-only first answer is retried as before when the caller asks (Repair: nothing after it trims)", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), good] });
    const log = capturingLogger();
    const result = await callStructured({
      deps: deps(ai, { logger: log.logger }),
      stage: "repair",
      cls: "small",
      effort: "low",
      prompt,
      input: "hi",
      schema: strict,
      soft,
      retryCapMisses: true,
      maxOutputTokens: 100,
    });
    expect(result.attempts).toBe(2);
    expect(result.editorialMisses).toEqual([]);
    expect(log.text()).toContain("retrying once");
  });

  test('row 2: `steps: "not an array"` twice is a StageFailure as before; the warn line says editorialOnly: false', async () => {
    const ai = createFakeAi({ script: [worked("not an array"), worked("not an array")] });
    const log = capturingLogger();
    const error = await run(ai, log).catch((e) => e);
    expect(error).toBeInstanceOf(StageFailure);
    expect(log.text()).toContain("giving up");
    expect(log.text()).toContain('"editorialOnly":false');
  });

  test("row 3: a shape miss then an editorial-only miss resolves with the misses (the retry fixed the shape)", async () => {
    const ai = createFakeAi({ script: [worked("not an array"), worked([longStep])] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(result.editorialMisses.map((m) => m.path)).toEqual([["steps", 0]]);
    // The first miss was a shape miss, the second was not: the two log lines say which.
    expect(log.text()).toContain('"editorialOnly":false');
    expect(log.text()).toContain('"editorialOnly":true');
  });

  // Row 4's intent changed in lab round 1: a cap-only first miss no longer retries (row 1), so the
  // happy retry is now driven by an editorial miss that is not a text cap.
  test("row 4: a non-cap editorial miss then a clean answer resolves with no misses (the happy retry)", async () => {
    const ai = createFakeAi({ script: [worked([leakyStep]), good] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(result.editorialMisses).toEqual([]);
    expect(log.text()).toContain("retrying once");
    expect(log.text()).not.toContain("did not validate on the retry");
  });

  test("a mixed second miss after a shape miss still fails the call", async () => {
    const ai = createFakeAi({
      script: [worked("not an array"), worked([longStep, ""])],
    });
    const log = capturingLogger();
    await expect(run(ai, log)).rejects.toBeInstanceOf(StageFailure);
    expect(log.text()).toContain('"editorialOnly":false');
    expect(log.text()).toContain("giving up");
  });

  test("keep the best answer: an editorial-only first answer survives a retry that misses shape (CB run, 24 Sept)", async () => {
    const ai = createFakeAi({
      script: [worked([leakyStep]), worked([longStep, ""])],
    });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(ai.calls).toHaveLength(2);
    expect(result.attempts).toBe(2);
    // The first answer, parsed by the soft schema, with its own misses.
    expect(result.output).toMatchObject({ kind: "worked-example", steps: [leakyStep] });
    expect(result.editorialMisses.map((m) => m.path)).toEqual([["steps", 0]]);
    expect(log.text()).toContain("first answer accepted");
    expect(log.text()).not.toContain("giving up");
  });

  test("keep the best answer: a retry that is itself editorial-only is still the one accepted", async () => {
    const shorter = "y".repeat(85);
    const ai = createFakeAi({ script: [worked([leakyStep]), worked([shorter])] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.output).toMatchObject({ steps: [shorter] });
    expect(log.text()).not.toContain("first answer accepted");
  });

  test("keep the best answer: without a soft schema the first answer is not kept", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), worked("not an array")] });
    const log = capturingLogger();
    await expect(run(ai, log, false)).rejects.toBeInstanceOf(StageFailure);
    expect(log.text()).toContain("giving up");
  });

  test("keep the best answer: an editorial-only first answer survives an empty retry", async () => {
    const response = (text: string | undefined) => ({
      content: text === undefined ? [] : [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: 5, reasoning: undefined },
        raw: undefined,
      },
      warnings: [],
    });
    let calls = 0;
    const ai = createFakeAi();
    ai.model = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          return calls === 1 ? response(worked([leakyStep])) : response(undefined);
        },
      });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(calls).toBe(2);
    expect(result.output).toMatchObject({ steps: [leakyStep] });
    expect(result.editorialMisses.map((m) => m.path)).toEqual([["steps", 0]]);
    expect(log.text()).toContain("first answer accepted");
  });

  test("without a soft schema an editorial-only second miss fails as before, logged editorialOnly: true", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), worked([longStep])] });
    const log = capturingLogger();
    await expect(run(ai, log, false)).rejects.toBeInstanceOf(StageFailure);
    expect(log.text()).toContain("giving up");
    expect(log.text()).toContain('"editorialOnly":true');
  });

  test("a list sent as a JSON string whose unwrapped items miss only a cap is repaired, then accepted", async () => {
    // The Bedrock quirk (`repair-json.ts`) on top of an editorial miss: the original text is a
    // shape miss (a string where a list goes), the repaired text an editorial one. The repaired
    // reading is the one judged, on both attempts.
    const wrapped = worked(JSON.stringify([leakyStep, "Second."]));
    const ai = createFakeAi({ script: [wrapped, wrapped] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(result.output).toMatchObject({ steps: [leakyStep, "Second."] });
    expect(result.editorialMisses.map((m) => m.path)).toEqual([["steps", 0]]);
    expect(log.text()).toContain('"repairs":["parsed-string"]');
    expect(log.text()).toContain('"editorialOnly":true');
    // The retry was told about the leak, not about a string where a list goes.
    expect(ai.calls[1]?.promptText).toContain("Pupil-facing text must not contain");
    expect(ai.calls[1]?.promptText).not.toContain("expected array");
    // The same quirk with only a cap missed is accepted on the first answer.
    const capped = worked(JSON.stringify([longStep, "Second."]));
    const once = createFakeAi({ script: [capped, capped] });
    const onceResult = await run(once, capturingLogger());
    expect(onceResult.attempts).toBe(1);
    expect(onceResult.output).toMatchObject({ steps: [longStep, "Second."] });
  });

  test("a custom message that quotes the model's words keeps them for the retry and logs its declared log form (ADR 0015)", async () => {
    // A value with an embedded quote and one with none: the log form is declared by the rule,
    // never derived from the rendered message, so neither can leak.
    const quoting = z.strictObject({ word: z.string(), id: z.string() }).superRefine((v, ctx) => {
      if (v.word !== "ok") {
        ctx.addIssue(shapeIssue(`pitch.avoid lists "${v.word}"`, ["word"], "pitch.avoid lists …"));
      }
      if (v.id !== "ok") {
        ctx.addIssue(
          shapeIssue(`${v.id} is not a candidate id`, ["id"], "… is not a candidate id"),
        );
      }
    });
    const bad = JSON.stringify({ word: 'a"secret', id: "q9secret" });
    const ai = createFakeAi({ script: [bad, bad] });
    const log = capturingLogger();
    const error = await callStructured({
      deps: deps(ai, { logger: log.logger }),
      stage: "plan",
      cls: "standard",
      effort: "medium",
      prompt,
      input: "hi",
      schema: quoting,
      maxOutputTokens: 100,
    }).catch((e) => e);
    expect(error).toBeInstanceOf(StageFailure);
    expect(ai.calls[1]?.promptText).toContain('lists "a"secret"');
    expect(ai.calls[1]?.promptText).toContain("q9secret is not a candidate id");
    expect((error as StageFailure).cause).toEqual([
      '- word: pitch.avoid lists "a"secret"',
      "- id: q9secret is not a candidate id",
    ]);
    expect(log.text()).toContain("custom: 2");
    expect(log.text()).not.toContain("secret");
  });

  test("unclassified validation messages, dynamic paths and log annotations never reach logs", async () => {
    const marker = "PRIVATE_VALIDATION_282";
    const schema = z.object({ word: z.string() }).superRefine((value, ctx) => {
      ctx.addIssue({
        code: "custom",
        path: [value.word],
        message: value.word,
        params: { log: value.word },
      });
    });
    const bad = JSON.stringify({ word: marker });
    const ai = createFakeAi({ script: [bad, bad] });
    const log = capturingLogger();
    await expect(
      callStructured({
        deps: deps(ai, { logger: log.logger }),
        stage: "plan",
        cls: "standard",
        effort: "medium",
        prompt,
        input: "hi",
        schema,
        maxOutputTokens: 100,
      }),
    ).rejects.toBeInstanceOf(StageFailure);
    expect(log.text()).not.toContain(marker);
    expect(log.text()).toContain("custom: 1");
    expect(ai.calls[1]?.promptText).toContain(marker);
  });

  test("the model's text never reaches the log on the accepted path either", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), worked([longStep])] });
    const log = capturingLogger();
    await run(ai, log);
    expect(log.text()).not.toContain("puddle");
    expect(log.text()).not.toContain(longStep);
  });
});

test("an empty answer (no output at all) is retried once with the same text; a second one is a StageFailure (quality lab, Sept 2026)", async () => {
  // With Output.object the SDK raises NoObjectGeneratedError (no text) when the model returns no
  // content parts at all; it must take the empty-answer path, not the did-not-validate one.
  const empty = {
    content: [],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined },
      raw: undefined,
    },
    warnings: [],
  };
  const answer = {
    ...empty,
    content: [{ type: "text" as const, text: JSON.stringify({ answer: "second time" }) }],
  };
  let calls = 0;
  const prompts: string[] = [];
  const flaky = createFakeAi();
  flaky.model = () =>
    new MockLanguageModelV4({
      doGenerate: async (options) => {
        calls++;
        prompts.push(JSON.stringify(options.prompt));
        return calls === 1 ? empty : answer;
      },
    });
  const log = capturingLogger();
  const result = await call(deps(flaky, { logger: log.logger }));
  expect(result.output).toEqual({ answer: "second time" });
  expect(result.attempts).toBe(2);
  expect(calls).toBe(2);
  // One retry, with the same text: no "did not validate" correction appended.
  expect(prompts[1]).toBe(prompts[0]);
  expect(prompts[1]).not.toContain("did not validate");
  expect(log.text()).toContain("model returned no output; retrying once");
  expect(log.text()).not.toContain("structured output did not validate");

  const dead = createFakeAi();
  dead.model = () => new MockLanguageModelV4({ doGenerate: async () => empty });
  await expect(call(deps(dead))).rejects.toBeInstanceOf(StageFailure);
});

describe("callStructured: a cap-only first answer is kept, not regenerated (lab round 1, cb-y1-animals-L)", () => {
  // The recorded facts call for objective 0: one reasoning 1 character over its 120 cap. The retry
  // rewrote everything and turned "may look smaller or different" into an overgeneralisation.
  const position = {
    shape: lessonShapeOf(undefined, { yearGroup: recordedY1.yearGroup }),
    objectives: recordedY1.objectives,
    target: recordedY1.target,
  };
  test("the first answer is accepted with its cap miss, and the retry is never asked for", async () => {
    const ai = createFakeAi({
      script: [JSON.stringify(recordedY1.first), JSON.stringify(recordedY1.retry)],
    });
    const log = capturingLogger();
    const result = await callStructured({
      deps: deps(ai, { logger: log.logger }),
      stage: "plan",
      cls: "small",
      effort: "medium",
      prompt,
      input: "hi",
      schema: planFactsObjectiveOutputSchemaFor(position as never),
      soft: planFactsObjectiveOutputSchemaFor(position as never, { soft: true }),
      maxOutputTokens: 7000,
    });
    expect(ai.calls).toHaveLength(1);
    expect(result.attempts).toBe(1);
    expect(result.editorialMisses).toEqual([
      { path: ["questions", 3, "reasoning"], message: "Too long: at most 120 characters." },
    ]);
    expect(result.output.keyIdeas[1]?.statement).toBe(
      "Young animals may look smaller or different, but they still have features like their parents.",
    );
  });

  test("isCapMiss is the text cap only", () => {
    expect(isCapMiss({ path: [], message: "Too long: at most 120 characters." })).toBe(true);
    expect(isCapMiss({ path: [], message: "Every option must be different." })).toBe(false);
    expect(isCapMiss({ path: [], message: "Too many steps: at most 4." })).toBe(false);
  });
});
