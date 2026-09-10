import { describe, expect, test } from "bun:test";
import { costUsd, createBudget, DEFAULT_MODEL_IDS } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { parseLesson, parseWorksheet } from "@tj/domain/documents";
import type { StoredPhoto } from "@tj/images";
import { PROMPT_VERSIONS } from "./prompts";
import { GENERATE_CONCURRENCY } from "./stages/generate";
import { TITLE_PROMPT_VERSION } from "./stages/plan";
import { slideText } from "./stages/shared";
import {
  answeringAi,
  CHECK_INPUT_CALLS,
  FIXTURES,
  memoryLogger,
  miss,
  PLAN_CALLS,
  PLAN_INDEX,
  pipelineScript,
  recordingDeps,
  routed,
  SAMPLE_WORKSHEET_ID,
  sampleBriefLesson,
  scriptedPipelineAi,
  scriptedPipelineAiWithInserted,
} from "./testing";
import { StageFailure } from "./types";
import { resumeFrom, runLessonPipeline } from "./workflow";

const TOTAL_SLIDES = FIXTURES.planSkeleton.outline.length; // 10
const GENERATED_SLIDES = TOTAL_SLIDES - 2; // 8
/** What one fake call (1 000 in / 400 out) costs on a class at the current list price. */
function callUsd(cls: "small" | "standard"): number {
  return costUsd(DEFAULT_MODEL_IDS[cls], { inputTokens: 1000, outputTokens: 400 }) ?? 0;
}
/** Plan persists three times: the title slide, the skeleton, the planned checkpoint. */
const PLAN_PERSISTS = 3;
/** Script index of the first slide answer: after the input check and Plan's two answers. */
const SLIDES_INDEX = CHECK_INPUT_CALLS + PLAN_CALLS;
const ALL_STAGES = ["check-input", "plan", "generate", "illustrate", "evaluate", "repair"];
const PLANNED_VERSION = `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}+${PROMPT_VERSIONS["verify-facts"]}`;

describe("runLessonPipeline", () => {
  test("a full run on the fixture script: persists per stage and slide, documents are valid", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai);
    const { lesson, worksheet } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );

    // 3 (plan) + 8 (slides) + 1 (worksheet) + 1 (evaluate) + 1 (repair)
    expect(deps.persisted).toHaveLength(PLAN_PERSISTS + GENERATED_SLIDES + 1 + 1 + 1);
    expect(lesson.facts?.objectives.map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lesson.slides.map((s) => s.kind)).toEqual(
      FIXTURES.planSkeleton.outline.map((e) => e.kind),
    );
    expect(lesson.generation).toMatchObject({
      stage: "repaired",
      promptVersions: {
        planned: PLANNED_VERSION,
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
          slide.kind === "title"
            ? TITLE_PROMPT_VERSION
            : slide.kind === "objectives"
              ? PROMPT_VERSIONS["plan-skeleton"]
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

  test("illustrate places one photo in a full run and the summary counts it", async () => {
    // The fixture skeleton with its content slide swapped for a picture slide: same length, so
    // the fixture facts and every script index still line up.
    const skeleton = structuredClone(FIXTURES.planSkeleton);
    const swapped = skeleton.outline[4];
    if (swapped?.kind !== "content") throw new Error("fixture outline moved");
    skeleton.outline[4] = {
      ...swapped,
      kind: "image-text",
      imageBrief: { subject: "river severn", mustShow: ["river water"], purpose: "observe" },
    };
    const script = pipelineScript({
      judges: [JSON.stringify({ pick: "p1", visible: ["river water"], count: "one", query: null })],
    });
    script[PLAN_INDEX] = JSON.stringify(skeleton);
    script[SLIDES_INDEX + 2] = JSON.stringify({
      kind: "image-text",
      factRefs: ["o1"],
      heading: "Rivers",
      body: "Rivers flow to the sea.",
    });
    const ai = createFakeAi({
      script: routed(script),
      usage: { inputTokens: 1000, outputTokens: 400 },
    });
    const photo = {
      id: "p1",
      width: 4000,
      height: 6000,
      alt: "River",
      photographer: "Ada",
      photographerUrl: "https://www.pexels.com/@ada",
      pageUrl: "https://www.pexels.com/photo/p1/",
      src: {
        large: "https://images.pexels.com/photos/p1/large.jpeg",
        medium: "https://images.pexels.com/photos/p1/medium.jpeg",
        // A data URL: the SDK downloads https image parts in-process before the call (ADR 0018).
        tiny: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      },
    };
    const stored: StoredPhoto = {
      key: "ws/images/p1.jpg",
      url: "/files/ws/images/p1.jpg",
      width: 4000,
      height: 6000,
      bytes: 100,
      contentType: "image/jpeg",
      source: {
        provider: "pexels",
        id: "p1",
        pageUrl: photo.pageUrl,
        photographer: photo.photographer,
        photographerUrl: photo.photographerUrl,
      },
    };
    const { lines, logger } = memoryLogger();
    const deps = recordingDeps(ai, {
      logger,
      images: {
        search: async () => [photo],
        store: async () => stored,
      },
    });
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    const imageSlide = lesson.slides.find((slide) => slide.kind === "image-text");
    const element = imageSlide?.elements.find((el) => el.type === "image");
    if (element?.type !== "image") throw new Error("no placed image");
    expect(element.src).toBe("/files/ws/images/p1.jpg");
    expect(element.source).toEqual({
      ...stored.source,
      evidence: {
        visible: ["river water"],
        count: "one",
        alt: "River",
        promptVersion: "pick-or-requery-photo.v3",
      },
    });
    // Picture first: the judge ran inside Generate and the slide's text was written to the photo.
    const slideCall = ai.calls.find((c) => c.promptText?.includes("The photograph on this slide"));
    expect(slideCall?.promptText).toContain("Visible: river water");
    // 1 check + 2 plan + 8 slides + 1 worksheet + 1 judge (the one image slide) + 1 evaluate.
    expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1 + 1);
    const judge = ai.calls.find((call) => call.context?.stage === "illustrate");
    expect(judge?.modelClass).toBe("small");
    expect(judge?.context?.promptVersion).toBe("pick-or-requery-photo.v3");
    expect(lesson.generation?.promptVersions.generated).toContain("pick-or-requery-photo.v3");
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation.images).toEqual({ requested: 1, placed: 1, empty: 0, failed: 0 });
    expect(summary.generation.stages).toContain("illustrate");
    // Picture first: the photograph landed with its slide's persist, so the illustrate step had
    // nothing left to place and reported no 88 progress event (the strip tolerates that).
    expect(deps.progress.some((p) => p.message === "Pictures placed")).toBe(false);
    expect(ai.calls.filter((c) => c.context?.stage === "illustrate")).toHaveLength(1);
  });

  test("every call carries a stage context and the classes follow the stage plan", () => {
    return (async () => {
      const ai = scriptedPipelineAi();
      await runLessonPipeline(
        { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
        recordingDeps(ai),
      );
      expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1);
      // Generate is on the small class (TEACH-213); Plan and Evaluate (TEACH-216) on standard.
      expect(ai.calls.map((c) => c.modelClass)).toEqual([
        "small",
        ...Array.from({ length: PLAN_CALLS }, () => "standard" as const),
        ...Array.from({ length: GENERATED_SLIDES + 1 }, () => "small" as const),
        "standard",
      ]);
      expect(ai.calls.map((c) => c.context?.stage)).toEqual([
        "check-input",
        "plan",
        "plan",
        "plan",
        ...Array.from({ length: GENERATED_SLIDES + 1 }, () => "generate"),
        "evaluate",
      ]);
      expect(ai.calls.slice(PLAN_INDEX, SLIDES_INDEX).map((c) => c.context?.promptVersion)).toEqual(
        [
          PROMPT_VERSIONS["plan-skeleton"],
          PROMPT_VERSIONS["plan-facts"],
          PROMPT_VERSIONS["verify-facts"],
        ],
      );
      // Effort per stage (Generation quality §6, TEACH-207): Generate at low, Plan and Evaluate at
      // medium, Verify at high (TEACH-212), the input check at low; every call says so to the
      // provider and in its context.
      expect(ai.calls.map((c) => c.context?.effort)).toEqual([
        "low",
        "medium",
        "medium",
        "high",
        ...Array.from({ length: GENERATED_SLIDES + 1 }, () => "low"),
        "medium",
      ]);
      // Every default is a GPT-5.6 id (TEACH-208), so every call carries the provider option.
      for (const call of ai.calls) {
        expect(call.providerOptions).toEqual({
          bedrock: { reasoningConfig: { maxReasoningEffort: call.context?.effort } },
        });
      }
      for (const call of ai.calls) {
        expect(call.context?.lessonId).toBeDefined();
        expect(call.context?.jobId).toBeDefined();
        expect(call.context?.promptVersion).toMatch(/\.v\d+$/);
      }
    })();
  });

  test("progress: (2, Starting), (6, Planned the lesson), (8, Checking the facts), (10, Planned) … (100, Done); every documentUpdatedAt is the preceding persist", async () => {
    const deps = recordingDeps(scriptedPipelineAi());
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(deps.progress.slice(0, 4)).toEqual([
      { percent: 2, message: "Starting", documentUpdatedAt: deps.persisted[0]?.updatedAt },
      {
        percent: 6,
        message: "Planned the lesson",
        documentUpdatedAt: deps.persisted[1]?.updatedAt,
      },
      // Verify persists nothing of its own: it carries the skeleton persist (TEACH-212).
      {
        percent: 8,
        message: "Checking the facts",
        documentUpdatedAt: deps.persisted[1]?.updatedAt,
      },
      { percent: 10, message: "Planned", documentUpdatedAt: deps.persisted[2]?.updatedAt },
    ]);
    // The first two persists carry no checkpoint: a retry from either re-runs Plan.
    expect(deps.persisted[0]?.lesson.generation).toBeUndefined();
    expect(deps.persisted[1]?.lesson.generation).toBeUndefined();
    expect(deps.persisted[2]?.lesson.generation?.stage).toBe("planned");
    expect(deps.progress.at(-1)).toEqual({
      percent: 100,
      message: "Done",
      documentUpdatedAt: deps.persisted.at(-1)?.updatedAt,
    });
    // Every progress message carries the latest persist; only "Checking the facts" (index 2)
    // repeats one, because Verify persists nothing itself.
    const persistedAt = new Set(deps.persisted.map((p) => p.updatedAt));
    deps.progress.forEach((p, i) => {
      const expected = deps.persisted[i < 2 ? i : i - 1]?.updatedAt;
      expect(p.documentUpdatedAt).toBe(expected);
      expect(persistedAt.has(p.documentUpdatedAt ?? "")).toBe(true);
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
    expect(resumeFrom(generated.lesson)).toBe("illustrate");

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
    // Script index 0 is the input check, 1–2 are plan; slides start at 3; the third generated
    // slide is index 5.
    const bad = "not json";
    const good = JSON.stringify(
      FIXTURES.slides[FIXTURES.planSkeleton.outline[4]?.kind ?? "content"],
    );
    const ai = scriptedPipelineAiWithInserted(SLIDES_INDEX + 2, [bad, good]);
    const deps = recordingDeps(ai, { logger });
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1 + 1);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lines.join("\n")).not.toContain(bad);
    expect(lines.some((l) => l.includes("retrying once"))).toBe(true);
  });

  test("TEACH-210 row 7: a degenerate slide reply (equal MCQ options) is a validation issue the retry names; the good reply lands", async () => {
    // Outline position 7 is the multiple-choice slide; its generated-slide call is SLIDES_INDEX + 5
    // (positions 0–1 are materialised by Plan).
    const goodSpec = FIXTURES.slides["multiple-choice"] as {
      options: { text: string; correct: boolean }[];
    };
    const bad = JSON.stringify({
      ...goodSpec,
      options: goodSpec.options.map((o, i) =>
        i === 1 ? { ...o, text: goodSpec.options[0]?.text } : o,
      ),
    });
    // The bad reply is a scripted miss: the routed fake hands it to whichever slide call is next,
    // and that call's retry finds the good multiple-choice spec by kind (TEACH-213).
    const ai = scriptedPipelineAiWithInserted(SLIDES_INDEX + 5, [
      miss(bad),
      JSON.stringify(goodSpec),
    ]);
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      recordingDeps(ai),
    );
    expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1 + 1);
    const retry = ai.calls.find((c) => c.promptText.includes("did not validate"));
    expect(retry?.promptText).toContain("did not validate");
    expect(retry?.promptText).toContain("Every option must be different.");
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lesson.slides.find((s) => s.kind === "multiple-choice")).toBeDefined();
  });

  test("two schema misses on a slide fail Generate with a StageFailure; earlier slides were persisted", async () => {
    const ai = scriptedPipelineAiWithInserted(SLIDES_INDEX + 2, ["not json", "still not json"]);
    const deps = recordingDeps(ai);
    await expect(
      runLessonPipeline({ lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID }, deps),
    ).rejects.toBeInstanceOf(StageFailure);
    try {
      await runLessonPipeline(
        { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
        recordingDeps(scriptedPipelineAiWithInserted(SLIDES_INDEX + 2, ["x", "y"])),
      );
    } catch (error) {
      expect((error as StageFailure).stage).toBe("generate");
    }
    // Plan's three persists + two slides landed before the failing third slide.
    expect(deps.persisted).toHaveLength(PLAN_PERSISTS + 2);
    expect(deps.persisted.at(-1)?.lesson.slides).toHaveLength(4);
  });

  // Derived from the price table rather than hard-coded dollars (a model change must not silently
  // retune these): the cap admits the input check (`small`) and Plan's skeleton call
  // (`standard`), then refuses the facts call — the budget is checked *before* each call, so a
  // cap between one and two standard calls' spend refuses the second.
  const TINY_CAP = { capUsd: callUsd("small") + callUsd("standard") / 2, capTokens: 1_000_000 };

  test("a tiny USD cap stops after Plan's skeleton call, records one budget finding and still completes", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai, { budget: createBudget(TINY_CAP) });
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["check-input", "plan"]);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.generation?.findings.filter((f) => f.check === "budget")).toEqual([
      expect.objectContaining({ severity: "error" }),
    ]);
    expect(lesson.slides).toHaveLength(2);
    expect(deps.progress.at(-1)?.percent).toBe(100);
  });

  test("an abort after slide 4 stops the model calls; slides 1–4 stay persisted", async () => {
    const ai = scriptedPipelineAi();
    // Persists #1–#3 are Plan's (title, skeleton, planned); #5 is the 4th slide.
    const deps = recordingDeps(ai, { abortAfterPersist: PLAN_PERSISTS + 2 });
    // Throws the abort so the worker records `cancelled`; what was written stays (ADR 0025 §5)
    // and no checkpoint past `planned` is claimed, so a retry resumes from the slides on disk.
    const error = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    ).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
    expect(deps.persisted.at(-1)?.lesson.generation?.stage).toBe("planned");
    // One batch (four slides) and the worksheet were in flight; nothing started after the abort.
    const generateCalls = ai.calls.filter((c) => c.context?.stage === "generate");
    expect(generateCalls.length).toBeLessThanOrEqual(GENERATE_CONCURRENCY + 1);
    expect(deps.persisted.at(-1)?.lesson.slides).toHaveLength(4);
    expect(ai.calls.some((c) => c.context?.stage === "evaluate")).toBe(false);
  });

  test("a skeleton whose outline refers to vocabulary is a validation issue: one retry", async () => {
    const broken = structuredClone(FIXTURES.planSkeleton);
    const entry = broken.outline[2];
    if (entry) entry.factRefs = [{ type: "vocabulary", index: 0 }];
    // The retry consumes the next script entry, so the good skeleton follows the broken one.
    const fixed = scriptedPipelineAiWithInserted(PLAN_INDEX, [
      JSON.stringify(broken),
      JSON.stringify(FIXTURES.planSkeleton),
    ]);
    const deps = recordingDeps(fixed);
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(fixed.calls.filter((c) => c.context?.stage === "plan")).toHaveLength(PLAN_CALLS + 1);
    expect(lesson.generation?.stage).toBe("repaired");
  });

  test("facts whose outlineFactRefs index is out of range is a validation issue: one retry", async () => {
    const broken = structuredClone(FIXTURES.planFacts);
    broken.outlineFactRefs.push({ index: 99, factRefs: [{ type: "question", index: 0 }] });
    const fixed = scriptedPipelineAiWithInserted(PLAN_INDEX + 1, [
      JSON.stringify(broken),
      JSON.stringify(FIXTURES.planFacts),
    ]);
    const deps = recordingDeps(fixed);
    const { lesson } = await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    );
    expect(fixed.calls.filter((c) => c.context?.stage === "plan")).toHaveLength(PLAN_CALLS + 1);
    expect(lesson.generation?.stage).toBe("repaired");
  });

  test("resumed with the title slide and no generation: Plan re-runs both calls, one title slide", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      first,
    );
    const titleOnly = first.persisted[0]?.lesson;
    if (!titleOnly || titleOnly.generation) throw new Error("no title-only persist");
    // No checkpoint: the input check runs again too — nothing was certified.
    expect(resumeFrom(titleOnly)).toBe("check-input");

    const ai = scriptedPipelineAi();
    const { lesson } = await runLessonPipeline(
      { lesson: titleOnly, worksheetId: SAMPLE_WORKSHEET_ID },
      recordingDeps(ai),
    );
    expect(ai.calls.filter((c) => c.context?.stage === "plan")).toHaveLength(PLAN_CALLS);
    expect(lesson.slides.filter((s) => s.kind === "title")).toHaveLength(1);
    expect(lesson.slides[0]).toEqual(titleOnly.slides[0]);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
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
          evidence: slideText(mcSlide).split("\n")[0],
          message: "Wrong option marked correct.",
        },
        {
          check: "pitch",
          severity: "warning",
          target: { slideId: mcSlide.id },
          evidence: slideText(mcSlide).split("\n")[0],
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
    const ai = scriptedPipelineAiWithInserted(SLIDES_INDEX + 2, ["not json", "still not json"]);
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      recordingDeps(ai, { logger }),
    ).catch(() => undefined);
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    // The check and Plan ran and Generate failed; Evaluate and Repair were never entered.
    expect(summary.generation).toMatchObject({
      outcome: "failed",
      stages: ["check-input", "plan", "generate"],
    });
    // Both misses were paid for, as were the slides other workers had in flight while the retry
    // ran; every worker settled before the stage failed, so the summary counts each call made and
    // nothing was started once the failure was known: Evaluate's call never happened.
    expect(summary.generation.calls).toBeGreaterThanOrEqual(CHECK_INPUT_CALLS + PLAN_CALLS + 2);
    expect(summary.generation.calls).toBe(ai.calls.length);
    expect(ai.calls.some((c) => c.context?.stage === "evaluate")).toBe(false);
  });

  test("a failed run's summary counts the findings of the last persisted checkpoint", async () => {
    const { lines, logger } = memoryLogger();
    // A tiny budget stops Plan at its facts call with a `budget` error finding at `planned`; an
    // abort right after that persist makes Generate throw, and the summary must still count the
    // finding of the last checkpoint.
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai, {
      logger,
      budget: createBudget(TINY_CAP),
      abortAfterPersist: PLAN_PERSISTS,
    });
    await runLessonPipeline(
      { lesson: sampleBriefLesson(), worksheetId: SAMPLE_WORKSHEET_ID },
      deps,
    ).catch(() => undefined);
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation).toMatchObject({
      outcome: "failed",
      stages: ["check-input", "plan", "generate"],
      findings: { error: 1, warning: 0 },
    });
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
      stages: ALL_STAGES,
      calls: CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1,
      findings: { error: 0, warning: 0 },
    });
    expect(summary.generation.durationMs).toEqual(expect.any(Number));
    expect(lines.join("\n")).not.toContain("particle");
  });
});

describe("resumeFrom", () => {
  test("maps the checkpoint to the next stage", () => {
    const base = sampleBriefLesson();
    expect(resumeFrom(base)).toBe("check-input");
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
    expect(resumeFrom(at("generated"))).toBe("illustrate");
    expect(resumeFrom(at("evaluated"))).toBe("repair");
    expect(resumeFrom(at("repaired"))).toBeNull();
  });
});
