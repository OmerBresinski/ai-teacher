import { describe, expect, test } from "bun:test";
import { FIXTURES } from "@tj/generation/testing";
import { blockSpecSchemaFor, slideSpecSchemaFor } from "@tj/slides";
import { generateText } from "ai";
import {
  createPerJobFakeAi,
  FAKE_PROPOSAL_MARK,
  FAKE_REVIEW_WARNING,
  proposalAnswer,
} from "./fake-ai";

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

  test("a cascade/regenerate call is answered with a marked spec of the kind the prompt names", async () => {
    const ai = createPerJobFakeAi({ AI_FAKE_DELAY_MS: 0 });
    const { text } = await generateText({
      model: ai.model("standard", { jobId: "cascade-1", stage: "cascade" }),
      prompt:
        'Slide s-objectives (kind "objectives") currently says:\nToday we will\nThe teacher asks: Shorter',
    });
    const spec = slideSpecSchemaFor("objectives")?.parse(JSON.parse(text)) as { items: string[] };
    expect(spec.items[0]).toStartWith(`${FAKE_PROPOSAL_MARK} (Shorter)`);
    // Every generatable slide kind and every fixture block type validates after the mark.
    for (const kind of Object.keys(FIXTURES.slides)) {
      const answer = proposalAnswer({
        index: 0,
        modelClass: "standard",
        modelId: "m",
        usage: {},
        promptText: `Slide x (kind "${kind}") currently says:`,
      });
      const schema = slideSpecSchemaFor(kind as never);
      if (schema) expect(schema.safeParse(JSON.parse(answer)).success, kind).toBe(true);
    }
    for (const block of FIXTURES.worksheet.blocks) {
      const answer = proposalAnswer({
        index: 0,
        modelClass: "standard",
        modelId: "m",
        usage: {},
        promptText: `Worksheet block b (type "${block.type}") currently says:`,
      });
      const schema = blockSpecSchemaFor(block.type as never);
      if (schema) expect(schema.safeParse(JSON.parse(answer)).success, block.type).toBe(true);
    }
  });
});
