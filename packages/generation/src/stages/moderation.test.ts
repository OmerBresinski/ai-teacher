import { expect, test } from "bun:test";
import { isAiError } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import type { Finding } from "@tj/domain/documents";
import {
  FIXTURES,
  fixtureSlideScript,
  initialState,
  memoryLogger,
  recordingDeps,
  routed,
} from "../testing";
import { generate } from "./generate";
import { plan } from "./plan";
import { repair } from "./repair";

const json = JSON.stringify;
const refusal = () => {
  throw Object.assign(
    new Error("validation_error: flagged as potentially violating our usage policy; private input"),
    {
      statusCode: 400,
      requestBodyValues: { text: "private input" },
      responseBody: "private output",
    },
  );
};
async function planned() {
  const ai = createFakeAi({
    script: [json(FIXTURES.planSkeleton), json(FIXTURES.planFacts), json(FIXTURES.verify)],
  });
  return plan(initialState(), recordingDeps(ai));
}

test("a moderated Generate call fails with a metadata-only moderation log", async () => {
  const start = await planned();
  const ai = createFakeAi({ fallback: refusal });
  const { logger, lines } = memoryLogger();
  const deps = recordingDeps(ai, { logger });
  const error = await generate(start, deps).catch((error) => error);
  expect(isAiError(error, "moderated")).toBe(true);
  expect(deps.persisted).toEqual([]);
  expect(lines.some((line) => JSON.parse(line).moderated === true)).toBe(true);
  expect(lines.join()).not.toContain("private");
});

for (const scenario of ["slide", "block", "staged fact"] as const) {
  test(`moderated ${scenario} repair preserves the original and continues to the next target`, async () => {
    const start = await planned();
    const generated = await generate(
      start,
      recordingDeps(
        createFakeAi({
          script: routed([...fixtureSlideScript(), json(FIXTURES.worksheet)]),
        }),
      ),
    );
    const vocab = generated.lesson.slides.find((s) => s.kind === "vocabulary");
    const mc = generated.lesson.slides.find((s) => s.kind === "multiple-choice");
    const block = generated.worksheet?.blocks.find((b) => b.type === "question");
    const generation = generated.lesson.generation;
    if (!vocab || !mc || !block || !generation) throw new Error("fixture");
    const target = scenario === "block" ? { blockId: block.id } : { slideId: vocab.id };
    const findings: Finding[] = [
      {
        check: scenario === "staged fact" ? "fact-consistency" : "answer-correctness",
        severity: "error",
        target: { ...target, ...(scenario === "staged fact" ? { factId: "v1" } : {}) },
        message: "Check this.",
      },
      {
        check: "answer-correctness",
        severity: "error",
        target: { slideId: mc.id },
        message: "Wrong option.",
      },
    ];
    const ai = createFakeAi({
      script: [
        ...(scenario === "staged fact"
          ? [
              json({
                corrections: [
                  { factId: "v1", field: "term", value: "Corpuscle", reason: "wrong-term" },
                ],
              }),
            ]
          : []),
        refusal,
        json(FIXTURES.repair),
      ],
    });
    const { logger, lines } = memoryLogger();
    const result = await repair(
      { ...generated, lesson: { ...generated.lesson, generation: { ...generation, findings } } },
      recordingDeps(ai, { logger }),
    );
    expect(ai.calls).toHaveLength(scenario === "staged fact" ? 3 : 2);
    expect(result.lesson.slides.find((s) => s.id === vocab.id)).toEqual(vocab);
    expect(result.worksheet).toEqual(generated.worksheet);
    expect(result.lesson.facts).toEqual(generated.lesson.facts);
    expect(result.lesson.slides.find((s) => s.id === mc.id)?.notes).toBe("Repaired.");
    expect(result.lesson.generation?.stage).toBe("repaired");
    expect(result.lesson.generation?.findings).toContainEqual(
      expect.objectContaining({
        check: "repair",
        severity: "warning",
        target: expect.objectContaining(target),
        message: `The review could not rewrite this ${scenario === "block" ? "block" : "slide"}; check it yourself.`,
      }),
    );
    expect(result.lesson.generation?.findings).toContainEqual(findings[0]);
    expect(result.lesson.generation?.findings).not.toContainEqual(findings[1]);
    expect(lines.join()).not.toContain("private");
  });
}
