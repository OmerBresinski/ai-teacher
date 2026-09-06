import { describe, expect, test } from "bun:test";
import { createBudget } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { checkLesson, type Finding, SlideSchema } from "@tj/domain/documents";
import { PROMPT_VERSIONS } from "../prompts";
import { assignFactIds } from "../specs";
import { FIXTURES, initialState, recordingDeps, sampleBriefLesson } from "../testing";
import { evaluate } from "./evaluate";
import { BUDGET_FINDING, generate, PLANNED_SLIDES } from "./generate";
import { plan } from "./plan";
import { MAX_TARGETS, repair, repairTargets } from "./repair";
import { blockText, slideText } from "./shared";

const json = (v: unknown) => JSON.stringify(v);
const usage = { inputTokens: 1000, outputTokens: 400 };

describe("plan", () => {
  test("one standard call → facts with ids, title + objectives slides, generation at planned", async () => {
    const ai = createFakeAi({ script: [json(FIXTURES.plan)], usage });
    const deps = recordingDeps(ai);
    const state = await plan(initialState(), deps);
    expect(ai.calls.map((c) => [c.modelClass, c.context?.stage])).toEqual([["standard", "plan"]]);
    expect(state.lesson.facts).toEqual(assignFactIds(FIXTURES.plan, 60));
    expect(state.lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    for (const slide of state.lesson.slides)
      expect(SlideSchema.safeParse(slide).success).toBe(true);
    expect(state.lesson.generation).toMatchObject({
      jobId: deps.context.jobId,
      stage: "planned",
      promptVersions: { planned: PROMPT_VERSIONS.plan },
      usage: { calls: 1, inputTokens: 1000, outputTokens: 400 },
      findings: [],
    });
    expect(deps.persisted).toHaveLength(1);
    expect(deps.progress).toEqual([
      { percent: 10, message: "Planned", documentUpdatedAt: deps.persisted[0]?.updatedAt },
    ]);
    // The objectives slide references the objectives; the title slide the outline's first entry.
    const objectives = state.lesson.slides[1];
    expect(objectives?.elements.every((e) => e.generatedFrom?.factRefs.includes("o1"))).toBe(true);
    expect(slideText(objectives as never)).toContain("Describe the arrangement");
  });

  test("a lesson without a brief cannot be planned", async () => {
    const { brief: _b, ...lesson } = sampleBriefLesson();
    await expect(
      plan(initialState(lesson as never), recordingDeps(createFakeAi())),
    ).rejects.toThrow(/no brief/);
  });
});

describe("generate", () => {
  async function planned() {
    const ai = createFakeAi({ script: [json(FIXTURES.plan)], usage });
    const deps = recordingDeps(ai);
    return plan(initialState(), deps);
  }

  test("one call per remaining outline entry, then the worksheet; persists after each slide", async () => {
    const start = await planned();
    const slides = FIXTURES.plan.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const ai = createFakeAi({ script: [...slides, json(FIXTURES.worksheet)], usage });
    const deps = recordingDeps(ai);
    const state = await generate(start, deps);
    expect(ai.calls).toHaveLength(slides.length + 1);
    expect(
      ai.calls.every((c) => c.modelClass === "standard" && c.context?.stage === "generate"),
    ).toBe(true);
    expect(state.lesson.slides).toHaveLength(FIXTURES.plan.outline.length);
    expect(deps.persisted).toHaveLength(slides.length + 1);
    expect(deps.persisted.map((p) => p.lesson.slides.length)).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 10,
    ]);
    expect(deps.progress.map((p) => p.message).slice(0, 2)).toEqual([
      "Slide 3 of 10",
      "Slide 4 of 10",
    ]);
    expect(deps.progress.at(-1)).toMatchObject({ percent: 85, message: "Worksheet ready" });
    expect(state.worksheet).toMatchObject({
      id: state.worksheetId,
      lessonId: state.lesson.id,
      includeAnswerKey: true,
      pageSize: "A4",
      themeId: "chalk",
      yearGroup: "Year 8",
      subject: "Science",
      header: { title: FIXTURES.worksheet.title, subtitle: FIXTURES.worksheet.subtitle },
    });
    expect(state.worksheet?.header.criteria).toEqual(FIXTURES.worksheet.criteria);
    expect(state.worksheet?.blocks).toHaveLength(FIXTURES.worksheet.blocks.length);
    expect(state.lesson.generation?.stage).toBe("generated");
    expect(state.lesson.generation?.promptVersions.generated).toBe(
      PROMPT_VERSIONS["generate-slide"],
    );
    expect(state.lesson.artefacts).toEqual({ worksheetId: state.worksheetId });
    expect(checkLesson(state.lesson, state.worksheet)).toEqual([]);
  });

  test("a spec of the wrong kind is a validation issue: retried once with the right kind", async () => {
    const start = await planned();
    const slides = FIXTURES.plan.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const wrongKind = json(FIXTURES.slides.content); // outline[2] is a starter
    const ai = createFakeAi({ script: [wrongKind, ...slides, json(FIXTURES.worksheet)], usage });
    const state = await generate(start, recordingDeps(ai));
    expect(ai.calls).toHaveLength(slides.length + 2);
    expect(state.lesson.slides[2]?.kind).toBe("starter");
  });

  test("budget exceeded mid-way keeps the slides written, records a budget finding, reaches generated", async () => {
    const start = await planned();
    const slides = FIXTURES.plan.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const ai = createFakeAi({ script: [...slides, json(FIXTURES.worksheet)], usage });
    // Roughly two slides' worth of standard-class tokens at list price.
    const budget = createBudget({ capUsd: 0.02, capTokens: 1_000_000 });
    const deps = recordingDeps(ai, { budget });
    const state = await generate(start, deps);
    expect(ai.calls.length).toBeLessThan(slides.length);
    expect(state.lesson.slides.length).toBeGreaterThan(PLANNED_SLIDES);
    expect(state.lesson.slides.length).toBeLessThan(FIXTURES.plan.outline.length);
    expect(state.worksheet).toBeUndefined();
    expect(state.lesson.generation?.stage).toBe("generated");
    expect(state.lesson.generation?.findings).toEqual([
      expect.objectContaining({ check: "budget", severity: "error" }),
    ]);
    expect(deps.progress.at(-1)?.message).toBe("Slides ready");
  });

  test("resumes: slides already present are not regenerated", async () => {
    const start = await planned();
    const slides = FIXTURES.plan.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const full = await generate(
      start,
      recordingDeps(createFakeAi({ script: [...slides, json(FIXTURES.worksheet)], usage })),
    );
    // The checkpoint a retried job reads: Plan's two slides plus three generated ones.
    const partial = {
      ...start,
      lesson: { ...start.lesson, slides: full.lesson.slides.slice(0, 5) },
    };
    const ai = createFakeAi({ script: [...slides.slice(3), json(FIXTURES.worksheet)], usage });
    const state = await generate(partial, recordingDeps(ai));
    expect(ai.calls).toHaveLength(slides.length - 3 + 1);
    expect(state.lesson.slides).toHaveLength(FIXTURES.plan.outline.length);
    expect(state.lesson.slides.slice(0, 5)).toEqual(full.lesson.slides.slice(0, 5));
  });
});

describe("evaluate", () => {
  async function generated() {
    const ai = createFakeAi({
      script: [
        json(FIXTURES.plan),
        ...FIXTURES.plan.outline.slice(PLANNED_SLIDES).map((e) => json(FIXTURES.slides[e.kind])),
        json(FIXTURES.worksheet),
      ],
      usage,
    });
    const deps = recordingDeps(ai);
    return generate(await plan(initialState(), deps), deps);
  }

  test("schema checks plus one small call; findings with unknown targets are dropped", async () => {
    const state = await generated();
    const slideId = state.lesson.slides[4]?.id as string;
    const findings: Finding[] = [
      { check: "age-fit", severity: "warning", target: { slideId }, message: "Hard word." },
      {
        check: "terminology",
        severity: "warning",
        target: { slideId: "ghost" },
        message: "Dropped.",
      },
      { check: "answer-correctness", severity: "error", target: {}, message: "Untargeted, kept." },
    ];
    const ai = createFakeAi({ script: [json({ findings })], usage });
    const deps = recordingDeps(ai);
    const next = await evaluate(state, deps);
    expect(ai.calls.map((c) => [c.modelClass, c.context?.stage])).toEqual([["small", "evaluate"]]);
    expect(next.lesson.generation?.stage).toBe("evaluated");
    expect(next.lesson.generation?.findings.map((f) => f.check)).toEqual([
      "age-fit",
      "answer-correctness",
    ]);
    expect(deps.persisted).toHaveLength(1);
    expect(deps.progress).toEqual([
      { percent: 90, message: "Reviewed", documentUpdatedAt: deps.persisted[0]?.updatedAt },
    ]);
  });

  test("a review that fails twice becomes a warning; the schema checks still run", async () => {
    const state = await generated();
    const broken = {
      ...state,
      lesson: {
        ...state.lesson,
        slides: state.lesson.slides.map((s) =>
          s.kind === "multiple-choice" && s.question?.type === "multiple-choice"
            ? {
                ...s,
                question: {
                  ...s.question,
                  options: s.question.options.map((o) => ({ ...o, correct: false })),
                },
              }
            : s,
        ),
      },
    };
    const ai = createFakeAi({ script: ["nope", "nope"], usage });
    const next = await evaluate(broken, recordingDeps(ai));
    expect(next.lesson.generation?.findings.map((f) => f.check).sort()).toEqual([
      "evaluate",
      "question-answer",
    ]);
  });

  test("a budget stop from Generate is carried through", async () => {
    const state = await generated();
    const withBudget = {
      ...state,
      lesson: {
        ...state.lesson,
        generation: {
          ...(state.lesson.generation as NonNullable<typeof state.lesson.generation>),
          findings: [BUDGET_FINDING("usd", "slide 5 of 10")],
        },
      },
    };
    const next = await evaluate(
      withBudget,
      recordingDeps(createFakeAi({ script: [json({ findings: [] })], usage })),
    );
    expect(next.lesson.generation?.findings.map((f) => f.check)).toEqual(["budget"]);
  });
});

describe("repair", () => {
  test("repairTargets groups error findings per target, skips warnings and untargeted, caps at MAX_TARGETS", () => {
    const f = (severity: "error" | "warning", target: Finding["target"]): Finding => ({
      check: "x",
      severity,
      target,
      message: "m",
    });
    const many = Array.from({ length: 10 }, (_, i) => f("error", { slideId: `s${i}` }));
    const targets = repairTargets([
      f("warning", { slideId: "w" }),
      f("error", {}),
      f("error", { slideId: "s0" }),
      ...many,
      f("error", { blockId: "b1" }),
    ]);
    expect(targets).toHaveLength(MAX_TARGETS);
    expect(targets[0]).toMatchObject({
      key: "slide:s0",
      findings: [expect.anything(), expect.anything()],
    });
  });

  test("regenerates only the targeted slide and block in place, then re-checks", async () => {
    const script = [
      json(FIXTURES.plan),
      ...FIXTURES.plan.outline.slice(PLANNED_SLIDES).map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupAi = createFakeAi({ script, usage });
    const setupDeps = recordingDeps(setupAi);
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    const mc = generated.lesson.slides.find((s) => s.kind === "multiple-choice");
    const block = generated.worksheet?.blocks.find((b) => b.type === "question");
    if (!mc || !block || !generated.worksheet) throw new Error("fixture changed");
    const findings: Finding[] = [
      {
        check: "answer-correctness",
        severity: "error",
        target: { slideId: mc.id },
        message: "Wrong option.",
      },
      {
        check: "answer-correctness",
        severity: "error",
        target: { blockId: block.id },
        message: "Wrong answer.",
      },
      { check: "age-fit", severity: "warning", target: { slideId: mc.id }, message: "Long." },
    ];
    const evaluated = {
      ...generated,
      lesson: {
        ...generated.lesson,
        generation: {
          ...(generated.lesson.generation as NonNullable<typeof generated.lesson.generation>),
          stage: "evaluated" as const,
          findings,
        },
      },
    };
    const repairedBlock = {
      type: "question",
      text: "Describe the particles in a solid.",
      answer: "Packed closely, vibrating in place.",
      answerLines: 3,
      marks: 2,
      factRefs: ["o1"],
    };
    const ai = createFakeAi({ script: [json(FIXTURES.repair), json(repairedBlock)], usage });
    const deps = recordingDeps(ai);
    const state = await repair(evaluated, deps);
    expect(ai.calls.map((c) => [c.modelClass, c.context?.stage])).toEqual([
      ["standard", "repair"],
      ["standard", "repair"],
    ]);
    const newMc = state.lesson.slides.find((s) => s.id === mc.id);
    expect(newMc?.notes).toBe("Repaired.");
    expect(
      newMc?.elements.every((e) => e.generatedFrom?.promptVersion === PROMPT_VERSIONS.repair),
    ).toBe(true);
    expect(newMc?.elements.map((e) => e.id)).not.toEqual(mc.elements.map((e) => e.id));
    const newBlock = state.worksheet?.blocks.find((b) => b.id === block.id);
    expect(blockText(newBlock as never)).toContain("Packed closely");
    expect(state.lesson.slides.filter((s) => s.id !== mc.id)).toEqual(
      generated.lesson.slides.filter((s) => s.id !== mc.id),
    );
    expect(state.lesson.generation).toMatchObject({
      stage: "repaired",
      promptVersions: { repaired: PROMPT_VERSIONS.repair },
    });
    expect(state.lesson.generation?.completedAt).toBeDefined();
    expect(state.lesson.generation?.findings).toEqual([
      expect.objectContaining({ check: "age-fit", severity: "warning" }),
    ]);
    expect(deps.progress).toEqual([
      { percent: 100, message: "Done", documentUpdatedAt: deps.persisted[0]?.updatedAt },
    ]);
  });

  test("a target that cannot be repaired keeps its error and gains a repair warning", async () => {
    const script = [
      json(FIXTURES.plan),
      ...FIXTURES.plan.outline.slice(PLANNED_SLIDES).map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupDeps = recordingDeps(createFakeAi({ script, usage }));
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    const mc = generated.lesson.slides.find((s) => s.kind === "multiple-choice") as NonNullable<
      (typeof generated.lesson.slides)[number]
    >;
    const findings: Finding[] = [
      {
        check: "answer-correctness",
        severity: "error",
        target: { slideId: mc.id },
        message: "Wrong.",
      },
    ];
    const evaluated = {
      ...generated,
      lesson: {
        ...generated.lesson,
        generation: {
          ...(generated.lesson.generation as NonNullable<typeof generated.lesson.generation>),
          stage: "evaluated" as const,
          findings,
        },
      },
    };
    const state = await repair(
      evaluated,
      recordingDeps(createFakeAi({ script: ["nope", "nope"], usage })),
    );
    expect(state.lesson.generation?.findings.map((f) => [f.check, f.severity])).toEqual([
      ["answer-correctness", "error"],
      ["repair", "warning"],
    ]);
    expect(state.lesson.generation?.stage).toBe("repaired");
  });
});
