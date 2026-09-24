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
        model: ai.model("small", {
          jobId,
          stage: "check-input",
          promptVersion: "check-input.v3",
        }),
        prompt: "x",
      });
      return text;
    };
    // The script's first answer is the input check's clean `{ findings: [] }` for both jobs.
    expect(await first("job-a")).toBe(JSON.stringify({ findings: [] }));
    expect(await first("job-b")).toBe(JSON.stringify({ findings: [] }));
    // The same job's second call moves on to Plan's skeleton.
    const { text } = await generateText({
      model: ai.model("standard", {
        jobId: "job-a",
        stage: "plan",
        promptVersion: "plan-skeleton.v17",
      }),
      prompt: "The outline has exactly 10 slides.",
    });
    expect(JSON.parse(text)).toHaveProperty("outline");
    expect(ai.kind).toBe("bedrock");
    expect(ai.modelId("small")).toBeString();
  });

  test.each([6, 8] as const)(
    "the plan fixture honours a requested %i-slide outline",
    async (count) => {
      const ai = createPerJobFakeAi({ AI_FAKE_DELAY_MS: 0 });
      const { text } = await generateText({
        model: ai.model("standard", {
          jobId: `plan-${count}`,
          stage: "plan",
          promptVersion: "plan-skeleton.v17",
        }),
        prompt: `The outline has exactly ${count} slides, counting the title and objectives slides.`,
      });
      expect(JSON.parse(text).outline).toHaveLength(count);
      const facts = await generateText({
        model: ai.model("standard", {
          jobId: `plan-${count}`,
          stage: "plan",
          promptVersion: "plan-facts.v9",
        }),
        prompt: "Write the facts for this outline.",
      });
      const refs = JSON.parse(facts.text).outlineFactRefs as Array<{ index: number }>;
      expect(refs.every((entry) => entry.index >= 2 && entry.index < count)).toBe(true);
    },
  );

  test("a fresh generate job routes slide and evaluate calls by prompt version", async () => {
    const ai = createPerJobFakeAi({ AI_FAKE_DELAY_MS: 0 });
    const jobId = "generate-after-plan";
    const slide = await generateText({
      model: ai.model("standard", {
        jobId,
        stage: "generate",
        promptVersion: "generate-slide.v1",
      }),
      prompt: 'Write the slide with kind "content".',
    });
    expect(JSON.parse(slide.text).kind).toBe("content");

    const review = await generateText({
      model: ai.model("standard", {
        jobId,
        stage: "evaluate",
        promptVersion: "evaluate.v1",
      }),
      prompt: "Review the lesson.",
    });
    expect(JSON.parse(review.text).findings).toEqual([FAKE_REVIEW_WARNING]);
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
