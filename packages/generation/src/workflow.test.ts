import { describe, expect, spyOn, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { type Lesson, parseLesson } from "@tj/domain/documents";
import type { StoredPhoto } from "@tj/images";
import { PROMPT_VERSIONS } from "./prompts";
import { assignFactIds } from "./specs";
import { GENERATE_CONCURRENCY } from "./stages/generate";
import { TITLE_PROMPT_VERSION } from "./stages/plan";
import { slideText } from "./stages/shared";
import {
  answeringAi,
  CHECK_INPUT_CALLS,
  callLimitedBudget,
  FIXTURES,
  fixtureSlideScript,
  memoryLogger,
  miss,
  PLAN_CALLS,
  PLAN_INDEX,
  pipelineScript,
  recordingDeps,
  routed,
  sampleBriefLesson,
  scriptedPipelineAi,
  scriptedPipelineAiWithInserted,
} from "./testing";
import { STAGE_ORDER, StageFailure } from "./types";
import { resumeFrom, runLessonPipeline } from "./workflow";

const TOTAL_SLIDES = FIXTURES.planSkeleton.outline.length; // 10
const GENERATED_SLIDES = TOTAL_SLIDES - 2; // 8
/** Plan persists three times: the title slide, the skeleton, the planned checkpoint. */
const PLAN_PERSISTS = 3;
/** Script index of the first slide answer: after the input check and Plan's two answers. */
const SLIDES_INDEX = CHECK_INPUT_CALLS + PLAN_CALLS;
const ALL_STAGES = ["check-input", "plan", "generate", "illustrate", "evaluate", "repair"];
const PLANNED_VERSION = `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}+${PROMPT_VERSIONS["verify-facts"]}`;

describe("runLessonPipeline", () => {
  test("the fixture still completes inside the default admission cap without a budget finding", async () => {
    const budget = createBudget({ capUsd: 0.5, capTokens: 300_000 });
    const result = await runLessonPipeline(
      { lesson: sampleBriefLesson() },
      recordingDeps(scriptedPipelineAi(), { budget }),
    );
    expect(result.lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(result.lesson.generation?.stage).toBe("repaired");
    expect(result.lesson.generation?.findings.some((f) => f.check === "budget")).toBe(false);
    expect(budget.totals()).not.toHaveProperty("reserved");
    expect(budget.totals()).not.toHaveProperty("uncertain");
  });

  test("raw persistence errors bypass Mastra diagnostics but retain identity for retry decisions", async () => {
    const marker = "PRIVATE_WORKFLOW_282";
    const original = Object.assign(new Error(marker), {
      params: [marker],
      cause: { token: marker },
    });
    const { logger, lines } = memoryLogger();
    const stderr: string[] = [];
    const consoleError = spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(Bun.inspect(args));
    });
    const deps = recordingDeps(scriptedPipelineAi(), { logger });
    deps.persist = async () => {
      throw original;
    };
    try {
      const caught = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps).catch(
        (error: unknown) => error,
      );
      expect(caught).toBe(original);
      expect([...lines, ...stderr].join("")).not.toContain(marker);
      expect(lines.join("")).toContain("generation stage failed");
    } finally {
      consoleError.mockRestore();
    }
  });

  test("a full run on the fixture script: persists per stage and slide, documents are valid", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai);
    const { lesson, worksheet } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);

    // 3 (plan) + 8 (slides) + 1 (the `generated` checkpoint) + 1 (evaluate) + 1 (repair)
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
    // Slides only (ADR 0030 item 2): no worksheet row is named, written or returned.
    expect(lesson.artefacts).toBeUndefined();
    expect(worksheet).toBeUndefined();
    expect(deps.persisted.every((p) => p.worksheet === undefined)).toBe(true);
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
    // The document round-trips through the domain parser as the worker will store it.
    expect(parseLesson(JSON.parse(JSON.stringify(lesson)))).toEqual(lesson);
    // The fixture is clean: no residual findings.
    expect(lesson.generation?.findings).toEqual([]);
    // Every progress event names its stage (ADR 0029 item 14), in pipeline order.
    const stages = deps.progress.map((p) => p.stage);
    expect(stages.every((stage) => STAGE_ORDER.includes(stage))).toBe(true);
    expect([...stages].sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b))).toEqual(
      stages,
    );
  });

  test("illustrate places one photo in a full run and the summary counts it", async () => {
    // The fixture skeleton's own image-text slide (position 5, TEACH-238): one judge answers for it.
    const script = pipelineScript({
      judges: [
        JSON.stringify({
          pick: "p1",
          onSubject: true,
          clear: true,
          visible: ["ice cubes", "meltwater"],
          count: "one",
          query: null,
        }),
      ],
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
      budget: createBudget({ capUsd: 0.5, capTokens: 300_000 }),
      images: {
        search: async () => [photo],
        store: async () => stored,
      },
    });
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
    const imageSlide = lesson.slides.find((slide) => slide.kind === "image-text");
    // TEACH-243: the fixture's picture is for "observe", so its caption says to look, not KEY IDEA.
    const caption = imageSlide?.elements.find(
      (el) => el.type === "text" && el.style.preset === "caption",
    );
    expect(caption && "doc" in caption ? JSON.stringify(caption.doc) : "").toContain(
      "LOOK CLOSELY",
    );
    const element = imageSlide?.elements.find((el) => el.type === "image");
    if (element?.type !== "image") throw new Error("no placed image");
    expect(element.src).toBe("/files/ws/images/p1.jpg");
    expect(element.source).toEqual({
      ...stored.source,
      evidence: {
        visible: ["ice cubes", "meltwater"],
        count: "one",
        alt: "River",
        promptVersion: "pick-or-requery-photo.v7",
        thumbnail: photo.src.tiny,
      },
    });
    // Picture first: the judge ran inside Generate and the slide's text was written to the photo.
    const slideCall = ai.calls.find((c) => c.promptText?.includes("The photograph on this slide"));
    expect(slideCall?.promptText).toContain("Visible: ice cubes");
    // 1 check + 3 plan + 8 slides + 1 judge (the one image slide) + 1 evaluate.
    expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1);
    const judge = ai.calls.find((call) => call.context?.stage === "illustrate");
    expect(judge?.modelClass).toBe("standard");
    expect(judge?.context?.promptVersion).toBe("pick-or-requery-photo.v7");
    expect(lesson.generation?.promptVersions.generated).toContain("pick-or-requery-photo.v7");
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation.images).toEqual({
      photographable: true,
      requested: 1,
      placed: 1,
      empty: 0,
      failed: 0,
    });
    const accepted = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "skeleton accepted");
    expect(accepted).toMatchObject({ stage: "plan", photographable: true });
    expect(JSON.stringify(accepted)).not.toContain("camera captures");
    expect(summary.generation.stages).toContain("illustrate");
    // Picture first: the photograph landed with its slide's persist, so the illustrate step had
    // nothing left to place and reported no 88 progress event (the strip tolerates that).
    expect(deps.progress.some((p) => p.message === "Pictures placed")).toBe(false);
    expect(ai.calls.filter((c) => c.context?.stage === "illustrate")).toHaveLength(1);
  });

  test("every call carries a stage context and the classes follow the stage plan", () => {
    return (async () => {
      const ai = scriptedPipelineAi();
      await runLessonPipeline({ lesson: sampleBriefLesson() }, recordingDeps(ai));
      expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1);
      // Generate is on the small class (TEACH-213); Plan and Evaluate (TEACH-216) on standard.
      expect(ai.calls.map((c) => c.modelClass)).toEqual([
        "small",
        ...Array.from({ length: PLAN_CALLS }, () => "standard" as const),
        ...Array.from({ length: GENERATED_SLIDES }, () => "small" as const),
        "standard",
      ]);
      expect(ai.calls.map((c) => c.context?.stage)).toEqual([
        "check-input",
        "plan",
        "plan",
        "plan",
        ...Array.from({ length: GENERATED_SLIDES }, () => "generate"),
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
      // medium, Verify at low (was high under TEACH-212; lowered 17 Sept 2026 with the input check,
      // both are checks not writers); every call says so to the provider and in its context.
      expect(ai.calls.map((c) => c.context?.effort)).toEqual([
        "low",
        "medium",
        "medium",
        "low",
        ...Array.from({ length: GENERATED_SLIDES }, () => "low"),
        "medium",
      ]);
      // Every default is a GPT-5.6 id (TEACH-208), so every call carries the provider option; each
      // call also carries the gateway providers' effort settings, so only the Bedrock one is pinned
      // here (`providerOptionsFor` has its own tests).
      for (const call of ai.calls) {
        expect(call.providerOptions).toMatchObject({
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

  test("progress: (2, Starting), (6, Planned the lesson), (10, Planned), (11, Checking the facts) … (80, Slides ready) … (100, Done), each with its stage; every other documentUpdatedAt is the preceding persist", async () => {
    const deps = recordingDeps(scriptedPipelineAi());
    await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
    expect(deps.progress.slice(0, 4)).toEqual([
      {
        percent: 2,
        message: "Starting",
        stage: "plan",
        documentUpdatedAt: deps.persisted[0]?.updatedAt,
      },
      {
        percent: 6,
        message: "Planned the lesson",
        stage: "plan",
        documentUpdatedAt: deps.persisted[1]?.updatedAt,
      },
      {
        percent: 10,
        message: "Planned",
        stage: "plan",
        documentUpdatedAt: deps.persisted[2]?.updatedAt,
      },
      // Verify announces itself from inside Generate (TEACH-233), between persists: it carries
      // none, and the strip reads 11 as Writing.
      {
        percent: 11,
        message: "Checking the facts",
        stage: "generate",
        documentUpdatedAt: undefined,
      },
    ]);
    // The `generated` checkpoint is announced at the slides' final mark; the worksheet's 85 is
    // gone with the worksheet (ADR 0030 item 2).
    const generated = deps.persisted.findIndex((p) => p.lesson.generation?.stage === "generated");
    expect(deps.progress[generated + 1]).toEqual({
      percent: 80,
      message: "Slides ready",
      stage: "generate",
      documentUpdatedAt: deps.persisted[generated]?.updatedAt,
    });
    expect(deps.progress.some((p) => p.percent === 85 || /worksheet/i.test(p.message))).toBe(false);
    // The first two persists carry no checkpoint: a retry from either re-runs Plan.
    expect(deps.persisted[0]?.lesson.generation).toBeUndefined();
    expect(deps.persisted[1]?.lesson.generation).toBeUndefined();
    expect(deps.persisted[2]?.lesson.generation?.stage).toBe("planned");
    expect(deps.progress.at(-1)).toEqual({
      percent: 100,
      message: "Done",
      stage: "repair",
      documentUpdatedAt: deps.persisted.at(-1)?.updatedAt,
    });
    // Every progress message carries the latest persist; only "Checking the facts" (index 3)
    // carries none, because Verify persists nothing itself.
    const persistedAt = new Set(deps.persisted.map((p) => p.updatedAt));
    deps.progress.forEach((p, i) => {
      if (i === 3) return;
      const expected = deps.persisted[i < 3 ? i : i - 1]?.updatedAt;
      expect(p.documentUpdatedAt).toBe(expected);
      expect(persistedAt.has(p.documentUpdatedAt ?? "")).toBe(true);
    });
    const percents = deps.progress.map((p) => p.percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  test("resumes after `generated`: Plan and Generate are skipped, only Evaluate and Repair persist", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    const done = await runLessonPipeline({ lesson: sampleBriefLesson() }, first);
    const generated = first.persisted.find((p) => p.lesson.generation?.stage === "generated");
    if (!generated) throw new Error("no generated checkpoint recorded");
    expect(resumeFrom(generated.lesson)).toBe("illustrate");

    // Only Evaluate's answer is consumed on resume.
    const deps = recordingDeps(answeringAi([JSON.stringify({ findings: [] })]));
    const result = await runLessonPipeline({ lesson: generated.lesson }, deps);
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
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
    // One retry and Evaluate on top of the slides.
    expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1);
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
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, recordingDeps(ai));
    expect(ai.calls).toHaveLength(CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1 + 1);
    const retry = ai.calls.find((c) => c.promptText.includes("did not validate"));
    expect(retry?.promptText).toContain("did not validate");
    expect(retry?.promptText).toContain("Every option must be different.");
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lesson.slides.find((s) => s.kind === "multiple-choice")).toBeDefined();
  });

  test("two schema misses on a slide fail Generate with a StageFailure; earlier slides were persisted", async () => {
    // The second content slide (position 5): with two misses in place of its spec, no other
    // content spec is left for its retry to find.
    const ai = scriptedPipelineAiWithInserted(SLIDES_INDEX + 3, ["not json", "still not json"]);
    const deps = recordingDeps(ai);
    await expect(runLessonPipeline({ lesson: sampleBriefLesson() }, deps)).rejects.toBeInstanceOf(
      StageFailure,
    );
    try {
      await runLessonPipeline(
        { lesson: sampleBriefLesson() },
        recordingDeps(scriptedPipelineAiWithInserted(SLIDES_INDEX + 3, ["x", "y"])),
      );
    } catch (error) {
      expect((error as StageFailure).stage).toBe("generate");
    }
    // Plan's three persists + three slides landed before the failing fourth slide.
    expect(deps.persisted).toHaveLength(PLAN_PERSISTS + 3);
    expect(deps.persisted.at(-1)?.lesson.slides).toHaveLength(5);
  });

  test("a reservation refusal after Plan's skeleton records one budget finding and still completes", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai, { budget: callLimitedBudget(CHECK_INPUT_CALLS + 1) });
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
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
    const error = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
    expect(deps.persisted.at(-1)?.lesson.generation?.stage).toBe("planned");
    // Only the slides already in flight (at most one batch) were called; nothing started after the abort.
    const generateCalls = ai.calls.filter((c) => c.context?.stage === "generate");
    expect(generateCalls.length).toBeLessThanOrEqual(GENERATE_CONCURRENCY);
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
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
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
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
    expect(fixed.calls.filter((c) => c.context?.stage === "plan")).toHaveLength(PLAN_CALLS + 1);
    expect(lesson.generation?.stage).toBe("repaired");
  });

  test("resumed with the title slide and no generation: Plan re-runs both calls, one title slide", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    await runLessonPipeline({ lesson: sampleBriefLesson() }, first);
    const titleOnly = first.persisted[0]?.lesson;
    if (!titleOnly || titleOnly.generation) throw new Error("no title-only persist");
    // No checkpoint: the input check runs again too — nothing was certified.
    expect(resumeFrom(titleOnly)).toBe("check-input");

    const ai = scriptedPipelineAi();
    const { lesson } = await runLessonPipeline({ lesson: titleOnly }, recordingDeps(ai));
    expect(ai.calls.filter((c) => c.context?.stage === "plan")).toHaveLength(PLAN_CALLS);
    expect(lesson.slides.filter((s) => s.kind === "title")).toHaveLength(1);
    expect(lesson.slides[0]).toEqual(titleOnly.slides[0]);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
  });

  test("Evaluate error findings drive Repair: one call per target, re-materialised in place", async () => {
    const first = recordingDeps(scriptedPipelineAi());
    const dry = await runLessonPipeline({ lesson: sampleBriefLesson() }, first);
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
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
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
    await runLessonPipeline({ lesson: sampleBriefLesson() }, recordingDeps(ai, { logger })).catch(
      () => undefined,
    );
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
      budget: callLimitedBudget(CHECK_INPUT_CALLS + 1),
      abortAfterPersist: PLAN_PERSISTS,
    });
    await runLessonPipeline({ lesson: sampleBriefLesson() }, deps).catch(() => undefined);
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
      { lesson: sampleBriefLesson() },
      recordingDeps(scriptedPipelineAi(), { logger }),
    );
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation).toMatchObject({
      outcome: "success",
      stages: ALL_STAGES,
      calls: CHECK_INPUT_CALLS + PLAN_CALLS + GENERATED_SLIDES + 1,
      findings: { error: 0, warning: 0 },
    });
    expect(summary.generation.durationMs).toEqual(expect.any(Number));
    expect(lines.join("\n")).not.toContain("particle");
  });
});

describe("stopAfter: planned (ADR 0029 items 1–2)", () => {
  /** The verified `planned` lesson the plan job leaves, and the deps that recorded the run. */
  async function plannedRun() {
    const ai = scriptedPipelineAi();
    const { lines, logger } = memoryLogger();
    const deps = recordingDeps(ai, { logger });
    const result = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps, {
      stopAfter: "planned",
    });
    return { ai, deps, lines, result };
  }

  test("row 1: persists title, skeleton and a verified `planned` checkpoint, then stops; no worksheet; the summary lists check-input and plan", async () => {
    const { ai, deps, lines, result } = await plannedRun();
    // Exactly the plan job's calls: the input check, skeleton, facts and Verify — awaited.
    expect(ai.calls.map((c) => c.context?.promptVersion)).toEqual([
      PROMPT_VERSIONS["check-input"],
      PROMPT_VERSIONS["plan-skeleton"],
      PROMPT_VERSIONS["plan-facts"],
      PROMPT_VERSIONS["verify-facts"],
    ]);
    expect(deps.persisted.map((p) => p.lesson.slides.map((s) => s.kind))).toEqual([
      ["title"],
      ["title", "objectives"],
      ["title", "objectives"],
    ]);
    expect(deps.persisted.map((p) => p.lesson.generation?.stage)).toEqual([
      undefined,
      undefined,
      "planned",
    ]);
    expect(deps.persisted.every((p) => p.worksheet === undefined)).toBe(true);
    const planned = result.lesson;
    expect(planned.generation?.stage).toBe("planned");
    expect(planned.slides).toHaveLength(2);
    expect(planned.artefacts).toBeUndefined();
    expect(result.worksheet).toBeUndefined();
    // The Verify stamp and its findings are folded into the checkpoint, and Verify's call is in
    // the usage the checkpoint records: nothing is left to hand on.
    expect(planned.generation?.promptVersions).toEqual({ planned: PLANNED_VERSION });
    expect(planned.generation?.findings).toEqual([]);
    expect(planned.generation?.usage.calls).toBe(CHECK_INPUT_CALLS + PLAN_CALLS);
    expect(result.pendingVerify).toBeUndefined();
    expect(deps.progress.map((p) => [p.percent, p.stage])).toEqual([
      [2, "plan"],
      [6, "plan"],
      [10, "plan"],
    ]);
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary");
    expect(summary.generation).toMatchObject({
      outcome: "success",
      stages: ["check-input", "plan"],
      calls: CHECK_INPUT_CALLS + PLAN_CALLS,
    });
    expect(lines.some((l) => l.includes("verify awaited"))).toBe(true);
    expect(lines.join("\n")).not.toContain("particle");
  });

  test("row 1, Verify corrects a fact: the `planned` checkpoint carries the patched facts and the fact-verify finding", async () => {
    const ai = scriptedPipelineAi({
      verify: {
        corrections: [{ factId: "v1", field: "term", value: "Clan", reason: "wrong-term" }],
      },
    });
    const deps = recordingDeps(ai);
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps, {
      stopAfter: "planned",
    });
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.facts?.vocabulary[0]?.term).toBe("Clan");
    expect(lesson.generation?.findings).toEqual([
      expect.objectContaining({ check: "fact-verify", target: { factId: "v1" } }),
    ]);
    expect(lesson.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
    expect(deps.persisted.at(-1)?.lesson).toEqual(lesson);
  });

  test("row 2: that lesson run again without the option resumes at Generate, completes the slides with no worksheet, and Verify is called once across both runs", async () => {
    const { ai: planAi, result } = await plannedRun();
    expect(resumeFrom(result.lesson)).toBe("generate");

    // The generate job's script: the slides and the review only — no Verify answer is offered,
    // so a second Verify call would take a slide spec and fail its schema.
    const ai = answeringAi([...fixtureSlideScript(), JSON.stringify({ findings: [] })]);
    const deps = recordingDeps(ai);
    const { lesson, worksheet } = await runLessonPipeline({ lesson: result.lesson }, deps);
    const verifyCalls = (calls: { context?: { promptVersion?: string } }[]) =>
      calls.filter((c) => c.context?.promptVersion === PROMPT_VERSIONS["verify-facts"]);
    expect(verifyCalls(planAi.calls)).toHaveLength(1);
    expect(verifyCalls(ai.calls)).toHaveLength(0);
    expect(ai.calls.map((c) => c.context?.stage)).toEqual([
      ...Array.from({ length: GENERATED_SLIDES }, () => "generate"),
      "evaluate",
    ]);
    // No "Checking the facts": Generate had nothing to await, so no slide was written twice and
    // the first event is the first slide.
    expect(deps.progress[0]).toMatchObject({ message: "Slide 3 of 10", stage: "generate" });
    expect(deps.progress.some((p) => p.message === "Checking the facts")).toBe(false);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    expect(lesson.slides.slice(0, 2)).toEqual(result.lesson.slides);
    expect(lesson.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
    expect(lesson.artefacts).toBeUndefined();
    expect(worksheet).toBeUndefined();
    expect(deps.persisted.every((p) => p.worksheet === undefined)).toBe(true);
    // Generate, Evaluate and Repair persist: 8 slides + generated + evaluated + repaired.
    expect(deps.persisted).toHaveLength(GENERATED_SLIDES + 1 + 1 + 1);
  });

  test("a resumed `planned` lesson without the stamp (an older row) is verified by Generate, as before", async () => {
    const { result } = await plannedRun();
    const generation = result.lesson.generation;
    if (!generation) throw new Error("no generation");
    const unstamped = {
      ...result.lesson,
      generation: {
        ...generation,
        promptVersions: {
          planned: `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}`,
        },
      },
    };
    const ai = answeringAi([
      JSON.stringify(FIXTURES.verify),
      ...fixtureSlideScript(),
      JSON.stringify({ findings: [] }),
    ]);
    const { lesson } = await runLessonPipeline({ lesson: unstamped }, recordingDeps(ai));
    expect(ai.calls[0]?.context?.promptVersion).toBe(PROMPT_VERSIONS["verify-facts"]);
    expect(lesson.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
    expect(lesson.generation?.stage).toBe("repaired");
  });

  test("without Verify (the facts call was refused at the cap) the stop still reaches `planned`, unstamped, with the budget finding", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai, { budget: callLimitedBudget(CHECK_INPUT_CALLS + 1) });
    const { lesson, pendingVerify } = await runLessonPipeline(
      { lesson: sampleBriefLesson() },
      deps,
      { stopAfter: "planned" },
    );
    expect(ai.calls.map((c) => c.context?.stage)).toEqual(["check-input", "plan"]);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.generation?.promptVersions.planned).toBe(
      `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}`,
    );
    expect(lesson.generation?.findings).toEqual([
      expect.objectContaining({ check: "budget", severity: "error" }),
    ]);
    expect(pendingVerify).toBeUndefined();
    expect(deps.persisted).toHaveLength(PLAN_PERSISTS);
  });

  test("the one-job path (no option) is unchanged: Verify overlaps the first slide batch and Generate stamps it", async () => {
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai);
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
    const planned = deps.persisted.find((p) => p.lesson.generation?.stage === "planned");
    expect(planned?.lesson.generation?.promptVersions.planned).toBe(
      `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}`,
    );
    expect(deps.progress[3]).toMatchObject({ percent: 11, message: "Checking the facts" });
    expect(lesson.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
  });

  test("pinObjectives rides on the input into Plan: a pinned re-plan keeps the teacher's objectives by id and text", async () => {
    const { result } = await plannedRun();
    const facts = result.lesson.facts;
    if (!facts) throw new Error("no facts");
    // The plan screen removed o2 and added one (`applyObjectiveEdits`): non-positional ids over
    // an emptied outline, the objectives slide still on the lesson.
    const pinned = [
      { id: "o1", text: facts.objectives[0]?.text ?? "" },
      { id: "o3", text: facts.objectives[2]?.text ?? "" },
      { id: "o4", text: "Explain why a gas fills its container" },
    ];
    const rePlan = {
      ...result.lesson,
      facts: {
        ...facts,
        objectives: pinned,
        outline: [],
        keyIdeas: [],
        vocabulary: [],
        workedExamples: [],
        questions: [],
        misconceptions: [],
      },
      plan: { revision: 2, state: "proposed" as const, jobId: "job-2" },
    };
    const ai = scriptedPipelineAi();
    const deps = recordingDeps(ai);
    const { lesson } = await runLessonPipeline({ lesson: rePlan, pinObjectives: true }, deps, {
      stopAfter: "planned",
    });
    const skeletonCall = ai.calls.find(
      (c) => c.context?.promptVersion === PROMPT_VERSIONS["plan-skeleton"],
    );
    expect(skeletonCall?.promptText).toContain("o4: Explain why a gas fills its container");
    expect(lesson.facts?.objectives).toEqual(pinned);
    expect(lesson.generation?.stage).toBe("planned");
    expect(slideText(lesson.slides[1] as never)).toContain("explain why a gas fills its container");
  });
});

describe("resumeFrom", () => {
  const facts = assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);
  const at = (
    stage: "planned" | "generated" | "evaluated" | "repaired",
    lesson: Lesson = { ...sampleBriefLesson(), facts },
  ) => ({
    ...lesson,
    generation: {
      jobId: "j",
      stage,
      startedAt: "2026-09-06T10:00:00.000Z",
      promptVersions: {},
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      findings: [],
    },
  });

  test("maps the checkpoint to the next stage", () => {
    expect(resumeFrom(sampleBriefLesson())).toBe("check-input");
    expect(resumeFrom(at("planned"))).toBe("generate");
    expect(resumeFrom(at("generated"))).toBe("illustrate");
    expect(resumeFrom(at("evaluated"))).toBe("repair");
    expect(resumeFrom(at("repaired"))).toBeNull();
  });

  test("a checkpoint over facts with no outline is stale (a re-plan emptied it, ADR 0029 item 8): the run starts over", () => {
    const emptied = { ...sampleBriefLesson(), facts: { ...facts, outline: [] } };
    expect(resumeFrom(at("planned", emptied))).toBe("check-input");
    expect(resumeFrom(at("planned", sampleBriefLesson()))).toBe("check-input");
  });
});

describe("TEACH-257: an editorial miss on both attempts does not lose the lesson", () => {
  const longStep = "x".repeat(90);
  const TOO_LONG = "steps.0: Too long: at most 84 characters.";
  const workedExample = FIXTURES.slides["worked-example"];
  const badWorked = JSON.stringify({ ...workedExample, steps: [longStep, "Second step."] });
  /** Script index of the worked-example slide's answer. */
  const WORKED_INDEX =
    SLIDES_INDEX + FIXTURES.planSkeleton.outline.findIndex((e) => e.kind === "worked-example") - 2;

  const runWith = async (repairAnswers: string[]) => {
    const script = pipelineScript();
    // The worked-example slide breaks the step cap; a cap-only miss is kept without a retry (lab
    // round 1); Repair then answers.
    script.splice(WORKED_INDEX, 1, badWorked);
    script.push(...repairAnswers);
    const ai = answeringAi(script);
    const deps = recordingDeps(ai);
    const result = await runLessonPipeline({ lesson: sampleBriefLesson() }, deps);
    return { ...result, ai, deps };
  };

  test("row 5: the slide is written as returned with a spec-rule error; Repair rewrites it and the finding is gone", async () => {
    const { lesson, ai, deps } = await runWith([JSON.stringify(workedExample)]);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    // No retry: the first answer was accepted with its cap miss, not a StageFailure.
    const retries = ai.calls.filter(
      (c) => c.context?.stage === "generate" && c.promptText.includes("Too long: at most 84"),
    );
    expect(retries).toHaveLength(0);
    const generated = deps.persisted.find((p) => p.lesson.generation?.stage === "generated");
    const worked = generated?.lesson.slides.find((s) => s.kind === "worked-example");
    expect(worked).toBeDefined();
    expect(generated?.lesson.generation?.findings).toContainEqual({
      check: "spec-rule",
      severity: "error",
      target: { slideId: worked?.id },
      message: TOO_LONG,
    });
    // Evaluate carried it; Repair was called once, for that slide, and the rewrite passed.
    const evaluated = deps.persisted.find((p) => p.lesson.generation?.stage === "evaluated");
    expect(evaluated?.lesson.generation?.findings.map((f) => f.check)).toContain("spec-rule");
    const repairs = ai.calls.filter((c) => c.context?.stage === "repair");
    expect(repairs).toHaveLength(1);
    expect(repairs[0]?.promptText).toContain(TOO_LONG);
    expect(lesson.generation?.findings.filter((f) => f.check === "spec-rule")).toEqual([]);
    const final = lesson.slides.find((s) => s.kind === "worked-example");
    expect(final?.id).toBe(worked?.id);
    expect(slideText(final as never)).not.toContain(longStep);
  });

  test("row 5, Repair misses too (it retries a cap miss): the slide is rewritten as returned and one spec-rule warning remains; no second pass", async () => {
    const { lesson, ai } = await runWith([badWorked, badWorked]);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(ai.calls.filter((c) => c.context?.stage === "repair")).toHaveLength(2);
    const worked = lesson.slides.find((s) => s.kind === "worked-example");
    expect(lesson.generation?.findings.filter((f) => f.check === "spec-rule")).toEqual([
      {
        check: "spec-rule",
        severity: "warning",
        target: { slideId: worked?.id },
        message: TOO_LONG,
      },
    ]);
    // Never `StageFailure`, never the "could not be repaired" warning: the answer was taken.
    expect(lesson.generation?.findings.filter((f) => f.check === "repair")).toEqual([]);
  });

  test("row 6: plan-facts with ten questions twice completes with a spec-rule warning on the facts; the slides still generate", async () => {
    const ten = structuredClone(FIXTURES.planFacts);
    ten.questions = ten.questions.slice(0, 10);
    ten.outlineFactRefs = ten.outlineFactRefs.map((e) => ({
      ...e,
      factRefs: e.factRefs.filter((r) => !(r.type === "question" && r.index >= 10)),
    }));
    const script = pipelineScript();
    script.splice(PLAN_INDEX + 1, 1, JSON.stringify(ten), JSON.stringify(ten));
    const ai = answeringAi(script);
    const { lesson } = await runLessonPipeline({ lesson: sampleBriefLesson() }, recordingDeps(ai));
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.facts?.questions).toHaveLength(10);
    expect(lesson.slides).toHaveLength(TOTAL_SLIDES);
    const specRule = lesson.generation?.findings.filter((f) => f.check === "spec-rule") ?? [];
    expect(specRule.length).toBeGreaterThan(0);
    for (const f of specRule) expect(f).toMatchObject({ severity: "warning", target: {} });
    expect(specRule.map((f) => f.message)).toContainEqual(
      "questions: Give at least 12 questions across the three tiers, each tagged with a use.",
    );
    // Nothing else changed: no error findings, no repair call.
    expect(ai.calls.filter((c) => c.context?.stage === "repair")).toHaveLength(0);
  });
});
