import { describe, expect, test } from "bun:test";
import { generateText } from "ai";
import { createPerJobFakeAi, FAKE_REVIEW_WARNING } from "./fake-ai";

/* `AI_FAKE_SCRIPT=pipeline`: one scripted run per job id, paced when asked. */

describe("createPerJobFakeAi", () => {
  test("two jobs each get the whole script from the start", async () => {
    const ai = createPerJobFakeAi({ AI_FAKE_DELAY_MS: 0 });
    const first = async (jobId: string) => {
      const { text } = await generateText({
        model: ai.model("small", { jobId, stage: "check-input" }),
        prompt: "x",
      });
      return text;
    };
    // The script's first answer is the input check's clean `{ findings: [] }` for both jobs.
    expect(await first("job-a")).toBe(JSON.stringify({ findings: [] }));
    expect(await first("job-b")).toBe(JSON.stringify({ findings: [] }));
    // The same job's second call moves on to Plan's skeleton.
    const { text } = await generateText({
      model: ai.model("standard", { jobId: "job-a", stage: "plan" }),
      prompt: "x",
    });
    expect(JSON.parse(text)).toHaveProperty("outline");
    expect(ai.kind).toBe("bedrock");
    expect(ai.modelId("small")).toBeString();
  });

  test("the review answer carries one lesson-level warning", () => {
    expect(FAKE_REVIEW_WARNING.target).toEqual({});
    expect(FAKE_REVIEW_WARNING.severity).toBe("warning");
  });

  test("AI_FAKE_DELAY_MS paces each answer", async () => {
    const ai = createPerJobFakeAi({ AI_FAKE_DELAY_MS: 60 });
    const started = Date.now();
    await generateText({ model: ai.model("small", { jobId: "j" }), prompt: "x" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });
});
