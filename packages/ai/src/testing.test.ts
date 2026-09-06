import { expect, test } from "bun:test";
import { generateText, streamText } from "ai";
import { createFakeAi } from "./testing";

test("createFakeAi provides deterministic text and usage through a configured-shaped client", async () => {
  const ai = createFakeAi({
    text: "scripted text",
    usage: { inputTokens: 5, outputTokens: 2 },
    modelIds: { small: "test-small" },
  });

  expect(ai.kind).toBe("bedrock");
  expect(ai.modelId("small")).toBe("test-small");
  const result = await generateText({ model: ai.model("small"), prompt: "ignored by fake" });
  expect(result.text).toBe("scripted text");
  expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 2 });
});

test("a script is consumed in call order, then the fallback text; every call is recorded", async () => {
  const ai = createFakeAi({ script: ["a", (call) => `b${call.index}`] });
  const texts: string[] = [];
  for (let i = 0; i < 3; i++) {
    const result = await generateText({ model: ai.model("small"), prompt: "ignored" });
    texts.push(result.text);
  }
  expect(texts).toEqual(["a", "b1", "fake response"]);
  expect(ai.calls).toHaveLength(3);
  expect(ai.calls[0]).toMatchObject({
    index: 0,
    modelClass: "small",
    modelId: ai.modelId("small"),
  });
  expect(ai.calls[2]?.index).toBe(2);
});

test("a script entry may carry its own usage; otherwise the global usage applies", async () => {
  const ai = createFakeAi({
    usage: { inputTokens: 1, outputTokens: 1 },
    script: [{ text: "x", usage: { inputTokens: 5, outputTokens: 7 } }, "y"],
  });
  const first = await generateText({ model: ai.model("standard"), prompt: "ignored" });
  expect(first.text).toBe("x");
  expect(first.usage).toMatchObject({ inputTokens: 5, outputTokens: 7 });
  const second = await generateText({ model: ai.model("standard"), prompt: "ignored" });
  expect(second.usage).toMatchObject({ inputTokens: 1, outputTokens: 1 });
  expect(ai.calls.map((c) => c.usage)).toEqual([
    { inputTokens: 5, outputTokens: 7 },
    { inputTokens: 1, outputTokens: 1 },
  ]);
});

test("the call context passed to ai.model is recorded on the call; streams count too", async () => {
  const ai = createFakeAi({ script: ["planned", "streamed"] });
  const context = { lessonId: "l1", jobId: "j1", stage: "plan", promptVersion: "plan.v1" };
  await generateText({ model: ai.model("standard", context), prompt: "ignored" });
  const stream = streamText({ model: ai.model("small"), prompt: "ignored" });
  expect(await stream.text).toBe("streamed");
  expect(ai.calls).toEqual([
    expect.objectContaining({ index: 0, modelClass: "standard", context }),
    expect.objectContaining({ index: 1, modelClass: "small", context: undefined }),
  ]);
});

test("a scripted error still throws and records nothing", async () => {
  const ai = createFakeAi({ script: ["never"], error: new Error("boom") });
  await expect(generateText({ model: ai.model("small"), prompt: "x" })).rejects.toThrow();
  expect(ai.calls).toHaveLength(0);
});
