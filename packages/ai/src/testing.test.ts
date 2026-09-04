import { expect, test } from "bun:test";
import { generateText } from "ai";
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
