import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { slideSpecSchemaFor } from "@tj/slides";
import pino from "pino";
import { z } from "zod";
import { callStructured, imageMediaType, specRuleFinding } from "./call";
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
    expect(log.text()).toContain("items: Invalid input: expected array, received string");
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
    expect(JSON.parse(issues as string)).toEqual([
      "- items: give more than one item",
      "- items: no x",
    ]);
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
    expect(JSON.parse(issues as string)).toEqual([
      "- items: Invalid input: expected array, received string",
    ]);
  });
});

/** A 1×1 PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
    expect(ai.calls[0]?.providerOptions).toEqual({
      bedrock: { reasoningConfig: { maxReasoningEffort: "low" } },
    });
    expect(ai.calls[0]?.context?.effort).toBe("low");
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
    expect(ai.calls[1]?.providerOptions).toEqual({
      bedrock: { reasoningConfig: { maxReasoningEffort: "medium" } },
    });
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

  test("row 1: a 90-character step twice resolves with one editorial miss naming steps.0; the warn line says editorialOnly", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), worked([longStep])] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(result.editorialMisses).toEqual([
      { path: ["steps", 0], message: "Too long: at most 84 characters." },
    ]);
    // The accepted answer is the retry's, parsed (trimmed, decoded) by the soft schema.
    expect(result.output).toMatchObject({ kind: "worked-example", steps: [longStep] });
    expect(ai.calls).toHaveLength(2);
    expect(log.text()).toContain("did not validate on the retry; accepted");
    expect(log.text()).toContain('"editorialOnly":true');
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

  test("row 4: an editorial miss then a clean answer resolves with no misses (today's happy retry)", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), good] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(result.editorialMisses).toEqual([]);
    expect(log.text()).toContain("retrying once");
    expect(log.text()).not.toContain("did not validate on the retry");
  });

  test("a mixed second miss (one shape issue beside editorial ones) still fails the call", async () => {
    const ai = createFakeAi({
      script: [worked([longStep]), JSON.stringify({ ...JSON.parse(worked([longStep])), extra: 1 })],
    });
    const log = capturingLogger();
    await expect(run(ai, log)).rejects.toBeInstanceOf(StageFailure);
    expect(log.text()).toContain('"editorialOnly":false');
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
    const wrapped = worked(JSON.stringify([longStep, "Second."]));
    const ai = createFakeAi({ script: [wrapped, wrapped] });
    const log = capturingLogger();
    const result = await run(ai, log);
    expect(result.attempts).toBe(2);
    expect(result.output).toMatchObject({ steps: [longStep, "Second."] });
    expect(result.editorialMisses.map((m) => m.path)).toEqual([["steps", 0]]);
    expect(log.text()).toContain('"repairs":["parsed-string"]');
    expect(log.text()).toContain('"editorialOnly":true');
    // The retry was told about the cap, not about a string where a list goes.
    expect(ai.calls[1]?.promptText).toContain("Too long: at most 84");
    expect(ai.calls[1]?.promptText).not.toContain("expected array");
  });

  test("a custom message that quotes the model's words keeps them for the retry and elides them in the log (ADR 0015)", async () => {
    const quoting = z.strictObject({
      word: z.string().refine((w) => w !== "evidence", {
        error: (issue) =>
          `pitch.avoid lists "${String(issue.input)}", which the vocabulary defines.`,
      }),
    });
    const ai = createFakeAi({
      script: [JSON.stringify({ word: "evidence" }), JSON.stringify({ word: "evidence" })],
    });
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
    expect(ai.calls[1]?.promptText).toContain('lists "evidence"');
    expect((error as StageFailure).cause).toEqual([
      '- word: pitch.avoid lists "evidence", which the vocabulary defines.',
    ]);
    expect(log.text()).toContain('pitch.avoid lists \\"…\\", which the vocabulary defines.');
    expect(log.text()).not.toContain("evidence");
  });

  test("the model's text never reaches the log on the accepted path either", async () => {
    const ai = createFakeAi({ script: [worked([longStep]), worked([longStep])] });
    const log = capturingLogger();
    await run(ai, log);
    expect(log.text()).not.toContain("puddle");
    expect(log.text()).not.toContain(longStep);
  });
});
