import { describe, expect, test } from "bun:test";
import type { CreatedAi } from "@tj/ai";
import { simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { planOf, slidesKeyAt, tapWriter } from "./writer-tap";

const RAW =
  '{"design":{"picture_style":"photo"},"flow":[{"slide":1,"does":"say \\"slides\\" here"}],"title":{"heading":"T"},"slides":[{"template":"explain"}],"close":null}';

function fakeAi(chunks: string[]): CreatedAi {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t" },
          ...chunks.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 300, text: 100, reasoning: 200 },
            },
          },
        ] as never,
      }),
    }),
  });
  return { kind: "openai", region: "x", model: () => model, modelId: () => "openai/gpt-6.1-sol" };
}

describe("writer tap", () => {
  test("finds the top-level slides key, never the word inside a string", () => {
    expect(slidesKeyAt(RAW)).toBe(RAW.indexOf('"slides":['));
    expect(planOf(RAW)).toEqual({
      design: { picture_style: "photo" },
      flow: [{ slide: 1, does: 'say "slides" here' }],
      title: { heading: "T" },
    });
    expect(planOf('{"design":{}')).toBeNull();
  });

  test("passes the writer's stream through unchanged and keeps its text and usage", async () => {
    const { ai, tap } = tapWriter(fakeAi([RAW.slice(0, 60), RAW.slice(60)]));
    const r = streamText({ model: ai.model("frontier", { stage: "write" }), prompt: "p" });
    expect(await r.text).toBe(RAW);
    expect(tap.text).toBe(RAW);
    expect(tap.slidesKeyMs).not.toBeNull();
    expect(tap.usage).toEqual({ inputTokens: 900, outputTokens: 300, reasoningTokens: 200 });
  });

  test("plan-only: calls back at the slides key; other stages are not tapped", async () => {
    let at = "";
    const { ai, tap } = tapWriter(fakeAi([RAW.slice(0, 100), RAW.slice(100)]), {
      onSlidesKey: (t) => {
        at = t.text;
      },
    });
    await streamText({ model: ai.model("frontier", { stage: "write" }), prompt: "p" }).text;
    expect(slidesKeyAt(at)).toBeGreaterThan(0);
    const other = tapWriter(fakeAi(["{}"]));
    await streamText({ model: other.ai.model("small", { stage: "write-small" }), prompt: "p" })
      .text;
    expect(other.tap.text).toBe("");
    expect(tap.text).toBe(RAW);
  });
});
