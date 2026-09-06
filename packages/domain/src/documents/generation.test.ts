import { describe, expect, test } from "bun:test";
import { generatedLesson } from "./fixtures.test-helpers";
import { GENERATION_STAGES, GenerationSchema } from "./generation";

describe("GenerationSchema", () => {
  const generation = () => {
    const g = generatedLesson().generation;
    if (!g) throw new Error("fixture has no generation");
    return g;
  };

  test("round-trips the fixture's generation state through JSON", () => {
    const input = generation();
    expect(GenerationSchema.parse(JSON.parse(JSON.stringify(input)))).toEqual(input);
  });

  test("stage is one of the four checkpoints, in pipeline order", () => {
    expect(GENERATION_STAGES).toEqual(["planned", "generated", "evaluated", "repaired"]);
    expect(GenerationSchema.safeParse({ ...generation(), stage: "done" }).success).toBe(false);
  });

  test("a checkpoint written after Plan needs no completedAt and only its own prompt version", () => {
    const planned = {
      jobId: "job",
      stage: "planned" as const,
      startedAt: "2026-09-06T10:00:00.000Z",
      promptVersions: { planned: "plan.v1" },
      usage: { calls: 1, inputTokens: 900, outputTokens: 300, costUsd: null },
      findings: [],
    };
    expect(GenerationSchema.parse(planned)).toEqual(planned);
  });

  test("costUsd is a non-negative number or null (token-capped model), never missing", () => {
    const g = generation();
    expect(GenerationSchema.safeParse({ ...g, usage: { ...g.usage, costUsd: -1 } }).success).toBe(
      false,
    );
    const { costUsd: _c, ...usage } = g.usage;
    expect(GenerationSchema.safeParse({ ...g, usage }).success).toBe(false);
  });

  test("promptVersions refuses an unknown stage key and findings refuse an unknown severity", () => {
    const g = generation();
    expect(
      GenerationSchema.safeParse({ ...g, promptVersions: { ...g.promptVersions, drafted: "x" } })
        .success,
    ).toBe(false);
    expect(
      GenerationSchema.safeParse({
        ...g,
        findings: [{ check: "x", severity: "info", target: {}, message: "m" }],
      }).success,
    ).toBe(false);
  });

  test("rejects unknown keys (strict)", () => {
    expect(GenerationSchema.safeParse({ ...generation(), extra: true }).success).toBe(false);
  });
});
