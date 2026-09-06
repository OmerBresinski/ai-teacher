import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import { createBudget } from "@tj/ai";
import { parseLesson, parseWorksheet } from "@tj/domain/documents";
import pino from "pino";
import { PROMPT_VERSIONS } from "./prompts";
import {
  answeringAi,
  FIXTURES,
  recordingDeps,
  SAMPLE_WORKSHEET_ID,
  sampleBriefLesson,
  scriptedPipelineAi,
  scriptedPipelineAiWithInserted,
} from "./testing";
import { StageFailure } from "./types";
import { resumeFrom, runLessonPipeline } from "./workflow";

const TOTAL_SLIDES = FIXTURES.plan.outline.length; // 10
const GENERATED_SLIDES = TOTAL_SLIDES - 2; // 8

function memoryLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, logger: pino({ level: "info" }, destination) };
}

describe("runLessonPipeline", () => {
  test("a full run on the fixture script: persists per stage and slide, documents are valid", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai);
    const { lesson, worksheet } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );

    // 1 (plan) + 8 (slides) + 1 (worksheet) + 1 (evaluate) + 1 (repair)
    expect(deps.persisted).toHaveLength(1 + GENERATED_SLIDES + 1 + 1 + 1);
    expect(lesson.facts?.objectives.map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lesson.slides.map((s) => s.kind)).toEqual(FIXTURES.plan.outline.map((e) => e.kind));
    expect(lesson.generation).toMatchObject({
      stage: "repaired",
      promptVersions: {
        planned: PROMPT_VERSIONS.plan,
        generated: PROMPT_VERSIONS["generate-slide"],
        evaluated: PROMPT_VERSIONS.evaluate,
        repaired: PROMPT_VERSIONS.repair,
      },
    });
    expect(lesson.generation?.completedAt).toBeDefined();
    expect(lesson.artefacts).toEqual({ worksheetId: SAMPLE_WORKSHEET_ID });
    for (const slide of lesson.slides) {
      for (const element of slide.elements) {
        expect(element.authoredBy).toBe("ai");
        expect(element.generatedFrom?.promptVersion).toBe(
          slide.kind === "title" || slide.kind === "objectives"
            ? PROMPT_VERSIONS.plan
            : PROMPT_VERSIONS["generate-slide"],
        );
      }
    }
    expect(worksheet).toBeDefined();
    expect(worksheet?.lessonId).toBe(lesson.id);
    expect(worksheet?.includeAnswerKey).toBe(true);
    expect(worksheet?.blocks.length).toBeGreaterThanOrEqual(4);
    expect(worksheet?.blocks.every((b) => b.generatedFrom && b.authoredBy === "ai")).toBe(true);
    // Both documents round-trip through the domain parsers as the worker will store them.
    expect(parseLesson(JSON.parse(JSON.stringify(lesson)))).toEqual(lesson);
    expect(parseWorksheet(JSON.parse(JSON.stringify(worksheet)))).toEqual(worksheet as never);
    // The fixture pair is clean: no residual findings.
    expect(lesson.generation?.findings).toEqual([]);
  });

  test("every call carries a stage context and the classes follow the stage plan", () => {
    return (async () => {
      const ai = scriptedPipelineAi();
      await runLessonPipeline(
        { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
        recordingDeps(ai),
      );
      expect(ai.calls).toHaveLength(1 + GENERATED_SLIDES + 1 + 1);
      expect(ai.calls.map((c) => c.modelClass)).toEqual([
        "standard",
        ...Array.from({ length: GENERATED_SLIDES + 1 }, () => "standard" as const),
        "small",
      ]);
      expect(ai.calls.map((c) => c.context?.stage)).toEqual([
        "plan",
        ...Array.from({ length: GENERATED_SLIDES + 1 }, () => "generate"),
        "evaluate",
      ]);
      for (const call of ai.calls) {
        expect(call.context?.lessonId).toBeDefined();
        expect(call.context?.jobId).toBeDefined();
        expect(call.context?.promptVersion).toMatch(/\.v\d+$/);
      }
    })();
  });

  test("progress: first (10, Planned), last (100, Done); every documentUpdatedAt is the preceding persist", async () => {
    const deps = recordingDeps(scriptedPipelineAi());
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(deps.progress[0]).toEqual({
      percent: 10,
      message: "Planned",
      documentUpdatedAt: deps.persisted[0]?.updatedAt,
    });
    expect(deps.progress.at(-1)).toEqual({
      percent: 100,
      message: "Done",
      documentUpdatedAt: deps.persisted.at(-1)?.updatedAt,
    });
    deps.progress.forEach((p, i) => {
      expect(p.documentUpdatedAt).toBe(deps.persisted[i]?.updatedAt);
    });
    const percents = deps.progress.map((p) => p.percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  test("resumes after `generated`: Plan and Generate are skipped, only Evaluate and Repair persist", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    const done = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      first,
    );
    const generated = first.persisted.find((p) => p.lesson.generation?.stage === "generated");
    if (!generated) throw new Error("no generated checkpoint recorded");
    expect(resumeFrom(generated.lesson)).toBe("evaluate");

    // Only Evaluate's answer is consumed on resume.
    const deps = recordingDeps(answeringAi([JSON.stringify({ findings: [] })]));
    const result = await runLessonPipeline(
      {
        lesson: generated.lesson,
        worksheet: generated.worksheet,
        worksheetId: SAMPLE_WORKSHEET_ID,
      },
      deps,
    );
    expect(deps.persisted).toHaveLength(2);
    expect(deps.ai.calls.map((c) => c.context?.stage)).toEqual(["evaluate"]);
    expect(result.lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(result.lesson.generation?.stage).toBe("repaired");
    expect(done.lesson.slides.map((s) => s.id)).toEqual(result.lesson.slides.map((s) => s.id));
  });

  test("a schema miss on the third slide is retried once and the slide lands", async () => {
    const { lines, logger } = memoryLogger();
    // Script index 0 is plan; slides start at 1; the third generated slide is index 3.
    const bad = "not json";
    const good = JSON.stringify(FIXTURES.slides[FIXTURES.plan.outline[4]?.kind ?? "content"]);
    const ai = scriptedPipelineAiWithInserted(3, [bad, good]);
    const deps = recordingDeps(ai, { logger });
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(ai.calls).toHaveLength(1 + GENERATED_SLIDES + 1 + 1 + 1);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lines.join("\n")).not.toContain(bad);
    expect(lines.some((l) => l.includes("retrying once"))).toBe(true);
  });

  test("two schema misses on a slide fail Generate with a StageFailure; earlier slides were persisted", async () => {
    const ai = scriptedPipelineAiWithInserted(3, ["not json", "still not json"]);
    const deps = recordingDeps(ai);
    await expect(
      runLessonPipeline({ lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID }, deps),
    ).rejects.toBeInstanceOf(StageFailure);
    try {
      await runLessonPipeline(
        { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
        recordingDeps(scriptedPipelineAiWithInserted(3, ["x", "y"])),
      );
    } catch (error) {
      expect((error as StageFailure).stage).toBe("generate");
    }
    // Plan + two slides landed before the failing third slide.
    expect(deps.persisted).toHaveLength(3);
    expect(deps.persisted.at(-1)?.lesson.slides).toHaveLength(4);
  });

  test("a tiny USD cap stops after Plan, records a budget finding and still completes", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai, {
      budget: createBudget({ capUsd: 0.0001, capTokens: 1_000_000 }),
    });
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["plan"]);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(
      lesson.generation?.findings.some((f) => f.check === "budget" && f.severity === "error"),
    ).toBe(true);
    expect(lesson.slides).toHaveLength(2);
    expect(deps.progress.at(-1)?.percent).toBe(100);
  });

  test("an abort after slide 4 stops the model calls; slides 1–4 stay persisted", async () => {
    const ai = scriptedPipelineAi();
    // persist #1 is Plan (2 slides); #3 is the 4th slide.
    const deps = recordingDeps(ai, { abortAfterPersist: 3 });
    // Throws the abort so the worker records `cancelled`; what was written stays (ADR 0025 §5)
    // and no checkpoint past `planned` is claimed, so a retry resumes from the slides on disk.
    const error = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    ).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
    expect(deps.persisted.at(-1)?.lesson.generation?.stage).toBe("planned");
    const generateCalls = ai.calls.filter((c) => c.context?.stage === "generate");
    expect(generateCalls).toHaveLength(2);
    expect(deps.persisted[2]?.lesson.slides).toHaveLength(4);
    expect(ai.calls.some((c) => c.context?.stage === "evaluate")).toBe(false);
  });

  test("an out-of-range ordinal in the plan answer is a validation issue: one retry", async () => {
    const broken = structuredClone(FIXTURES.plan);
    const entry = broken.outline[2];
    if (entry) entry.factRefs = [{ type: "question", index: 99 }];
    // The retry consumes the next script entry, so the good plan follows the broken one.
    const fixed = scriptedPipelineAiWithInserted(0, [
      JSON.stringify(broken),
      JSON.stringify(FIXTURES.plan),
    ]);
    const deps = recordingDeps(fixed);
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(fixed.calls.filter((c) => c.context?.stage === "plan")).toHaveLength(2);
    expect(lesson.generation?.stage).toBe("repaired");
  });

  test("Evaluate error findings drive Repair: one call per target, re-materialised in place", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    const dry = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      first,
    );
    const mcSlide = dry.lesson.slides.find((s) => s.kind === "multiple-choice");
    if (!mcSlide) throw new Error("no multiple-choice slide");
    const evaluate = {
      findings: [
        {
          check: "answer-correctness",
          severity: "error",
          target: { slideId: mcSlide.id },
          message: "Wrong option marked correct.",
        },
        {
          check: "age-fit",
          severity: "warning",
          target: { slideId: mcSlide.id },
          message: "Long stem.",
        },
      ],
    };
    const ai = scriptedPipelineAi({ evaluate, repairs: 1 });
    const deps = recordingDeps(ai);
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(ai.calls.filter((c) => c.context?.stage === "repair")).toHaveLength(1);
    const repaired = lesson.slides.find((s) => s.kind === "multiple-choice");
    expect(repaired?.id).toBe(mcSlide.id);
    expect(
      repaired?.elements.every((e) => e.generatedFrom?.promptVersion === PROMPT_VERSIONS.repair),
    ).toBe(true);
    expect(repaired?.notes).toBe("Repaired.");
    // The model's warning stays as a residual; no error finding remains.
    expect(lesson.generation?.findings.map((f) => f.severity)).toEqual(["warning"]);
  });

  test("a failed run still writes the summary line, marked failed", async () => {
    const { lines, logger } = memoryLogger();
    const ai = scriptedPipelineAiWithInserted(3, ["not json", "still not json"]);
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      recordingDeps(ai, { logger }),
    ).catch(() => undefined);
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation).toMatchObject({ outcome: "failed", calls: 1 + 2 + 2 });
  });

  test("writes one generation summary line with counts, never content", async () => {
    const { lines, logger } = memoryLogger();
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      recordingDeps(scriptedPipelineAi(), { logger }),
    );
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation).toMatchObject({
      outcome: "success",
      stages: ["plan", "generate", "evaluate", "repair"],
      calls: 1 + GENERATED_SLIDES + 1 + 1,
      findings: { error: 0, warning: 0 },
    });
    expect(summary.generation.durationMs).toEqual(expect.any(Number));
    expect(lines.join("\n")).not.toContain("particle");
  });
});

describe("resumeFrom", () => {
  test("maps the checkpoint to the next stage", () => {
    const base = sampleBriefLesson();
    expect(resumeFrom(base)).toBe("plan");
    const at = (stage: "planned" | "generated" | "evaluated" | "repaired") => ({
      ...base,
      generation: {
        jobId: "j",
        stage,
        startedAt: "2026-09-06T10:00:00.000Z",
        promptVersions: {},
        usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        findings: [],
      },
    });
    expect(resumeFrom(at("planned"))).toBe("generate");
    expect(resumeFrom(at("generated"))).toBe("evaluate");
    expect(resumeFrom(at("evaluated"))).toBe("repair");
    expect(resumeFrom(at("repaired"))).toBeNull();
  });
});
