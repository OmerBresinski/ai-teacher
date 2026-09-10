import { describe, expect, test } from "bun:test";
import { costUsd, createBudget, DEFAULT_MODEL_IDS } from "@tj/ai";
import { createFakeAi } from "@tj/ai/testing";
import { checkLesson, type Finding, SlideSchema } from "@tj/domain/documents";
import { generatedLesson } from "@tj/domain/documents/fixtures";
import { PexelsError } from "@tj/images";
import { PROMPT_VERSIONS } from "../prompts";
import { assignFactIds, planFactsSchemaFor } from "../specs";
import {
  FIXTURES,
  initialState,
  memoryLogger,
  miss,
  recordingDeps,
  routed,
  sampleBriefLesson,
} from "../testing";
import { evaluate } from "./evaluate";
import { GENERATE_CONCURRENCY, generate, PLANNED_SLIDES } from "./generate";
import { plan, TITLE_PROMPT_VERSION } from "./plan";
import { MAX_TARGETS, repair, repairTargets } from "./repair";
import { BUDGET_FINDING, blockText, slideText, specFieldsCover, specFieldsOf } from "./shared";

const json = (v: unknown) => JSON.stringify(v);
const usage = { inputTokens: 1000, outputTokens: 400 };
/** One fake call's cost on the standard class at the current list price (not hard-coded dollars). */
const STANDARD_CALL_USD = costUsd(DEFAULT_MODEL_IDS.standard, usage) ?? 0;
const SMALL_CALL_USD = costUsd(DEFAULT_MODEL_IDS.small, usage) ?? 0;

const planScript = () => [
  json(FIXTURES.planSkeleton),
  json(FIXTURES.planFacts),
  json(FIXTURES.verify),
];
const fullFacts = () => assignFactIds(FIXTURES.planSkeleton, FIXTURES.planFacts, 60);

describe("plan", () => {
  test("title slide first, then the skeleton, then the facts and verify: three persists, three calls, one checkpoint", async () => {
    const ai = createFakeAi({ script: planScript(), usage });
    const deps = recordingDeps(ai);
    const state = await plan(initialState(), deps);

    // 1. The title slide is persisted before any model call, with no `generation` yet.
    const [first, second, third] = deps.persisted;
    expect(first?.lesson.slides.map((s) => s.kind)).toEqual(["title"]);
    expect(first?.lesson.generation).toBeUndefined();
    expect(first?.lesson.facts).toBeUndefined();
    expect(deps.progress[0]).toEqual({
      percent: 2,
      message: "Starting",
      documentUpdatedAt: first?.updatedAt,
    });
    expect(first?.lesson.slides[0]?.elements.every((e) => e.generatedFrom?.model === "none")).toBe(
      true,
    );
    expect(
      first?.lesson.slides[0]?.elements.every(
        (e) => e.generatedFrom?.promptVersion === TITLE_PROMPT_VERSION,
      ),
    ).toBe(true);

    // 2. After the skeleton call: objectives slide, outline present, the other lists empty.
    expect(second?.lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(second?.lesson.facts?.outline).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(second?.lesson.facts?.vocabulary).toEqual([]);
    expect(second?.lesson.facts?.questions).toEqual([]);
    expect(second?.lesson.generation).toBeUndefined();
    expect(deps.progress[1]).toMatchObject({ percent: 6, documentUpdatedAt: second?.updatedAt });

    // 3. Verify announces itself before its call, carrying the skeleton persist; no persist of
    //    its own. Then the checkpoint with the complete facts (an empty patch: unchanged) and the
    //    three-version stamp (row 4).
    expect(deps.progress[2]).toEqual({
      percent: 8,
      message: "Checking the facts",
      documentUpdatedAt: second?.updatedAt,
    });
    expect(third?.lesson.generation?.stage).toBe("planned");
    expect(third?.lesson.facts).toEqual(fullFacts());
    expect(third?.lesson.generation?.findings).toEqual([]);
    expect(third?.lesson.generation?.promptVersions.planned).toBe(
      `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}+${PROMPT_VERSIONS["verify-facts"]}`,
    );
    expect(deps.progress[3]).toEqual({
      percent: 10,
      message: "Planned",
      documentUpdatedAt: third?.updatedAt,
    });
    expect(deps.persisted).toHaveLength(3);
    // Row 8: the verify call is the third plan call, standard class at high effort.
    expect(
      ai.calls.map((c) => [
        c.modelClass,
        c.context?.stage,
        c.context?.promptVersion,
        c.context?.effort,
      ]),
    ).toEqual([
      ["standard", "plan", PROMPT_VERSIONS["plan-skeleton"], "medium"],
      ["standard", "plan", PROMPT_VERSIONS["plan-facts"], "medium"],
      ["standard", "plan", PROMPT_VERSIONS["verify-facts"], "high"],
    ]);

    expect(state.lesson.facts).toEqual(fullFacts());
    expect(state.lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    for (const slide of state.lesson.slides)
      expect(SlideSchema.safeParse(slide).success).toBe(true);
    expect(state.lesson.generation).toMatchObject({
      jobId: deps.context.jobId,
      stage: "planned",
      promptVersions: {
        planned: `${PROMPT_VERSIONS["plan-skeleton"]}+${PROMPT_VERSIONS["plan-facts"]}+${PROMPT_VERSIONS["verify-facts"]}`,
      },
      usage: { calls: 3, inputTokens: 3000, outputTokens: 1200 },
      findings: [],
    });
    // The objectives slide references the objectives and carries the skeleton prompt's version.
    const objectives = state.lesson.slides[1];
    expect(objectives?.elements.every((e) => e.generatedFrom?.factRefs.includes("o1"))).toBe(true);
    expect(
      objectives?.elements.every(
        (e) => e.generatedFrom?.promptVersion === PROMPT_VERSIONS["plan-skeleton"],
      ),
    ).toBe(true);
    // The slide carries the stem in its heading and lists the phrases lower-case (TEACH-198).
    expect(slideText(objectives as never)).toStartWith("By the end of this lesson I can\n");
    expect(slideText(objectives as never)).toContain("\ndescribe the arrangement");
  });

  test("a skeleton whose outline refers to vocabulary is a validation issue: one retry", async () => {
    const broken = structuredClone(FIXTURES.planSkeleton);
    const entry = broken.outline[2];
    if (entry) entry.factRefs = [{ type: "vocabulary", index: 0 }];
    const ai = createFakeAi({
      script: [
        json(broken),
        json(FIXTURES.planSkeleton),
        json(FIXTURES.planFacts),
        json(FIXTURES.verify),
      ],
      usage,
    });
    const state = await plan(initialState(), recordingDeps(ai));
    expect(ai.calls).toHaveLength(4);
    expect(state.lesson.facts).toEqual(fullFacts());
  });

  test("facts whose outlineFactRefs index is out of range is a validation issue: one retry", async () => {
    const broken = structuredClone(FIXTURES.planFacts);
    broken.outlineFactRefs.push({ index: 99, factRefs: [{ type: "question", index: 0 }] });
    const ai = createFakeAi({
      script: [
        json(FIXTURES.planSkeleton),
        json(broken),
        json(FIXTURES.planFacts),
        json(FIXTURES.verify),
      ],
      usage,
    });
    const state = await plan(initialState(), recordingDeps(ai));
    expect(ai.calls).toHaveLength(4);
    expect(state.lesson.facts).toEqual(fullFacts());
  });

  test("facts that touch the objectives slide or reference an objective are validation issues", async () => {
    const skeleton = FIXTURES.planSkeleton;
    const schema = planFactsSchemaFor(skeleton);
    const onObjectivesSlide = structuredClone(FIXTURES.planFacts);
    onObjectivesSlide.outlineFactRefs.push({
      index: 1,
      factRefs: [{ type: "question", index: 0 }],
    });
    const objectiveRef = structuredClone(FIXTURES.planFacts);
    objectiveRef.outlineFactRefs.push({ index: 2, factRefs: [{ type: "objective", index: 0 }] });
    expect(schema.safeParse(FIXTURES.planFacts).success).toBe(true);
    const last = FIXTURES.planFacts.outlineFactRefs.length;
    expect(schema.safeParse(onObjectivesSlide).error?.issues.map((i) => i.path)).toEqual([
      ["outlineFactRefs", last, "index"],
    ]);
    expect(schema.safeParse(objectiveRef).error?.issues.map((i) => i.path)).toEqual([
      ["outlineFactRefs", last, "factRefs", 0, "type"],
    ]);
  });

  test("resumed with the title slide and no generation: all three calls run, the title is not duplicated", async () => {
    const first = recordingDeps(createFakeAi({ script: planScript(), usage }));
    await plan(initialState(), first);
    const titleOnly = first.persisted[0]?.lesson;
    if (!titleOnly) throw new Error("no title persist");

    const ai = createFakeAi({ script: planScript(), usage });
    const deps = recordingDeps(ai);
    const state = await plan(initialState(titleOnly), deps);
    expect(ai.calls).toHaveLength(3);
    expect(state.lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(state.lesson.slides[0]).toEqual(titleOnly.slides[0]);
    expect(deps.persisted[0]?.lesson.slides).toEqual(titleOnly.slides);
  });

  test("resumed after the skeleton persist: the skeleton call is skipped, the objectives slide stays, facts and verify run", async () => {
    const first = recordingDeps(createFakeAi({ script: planScript(), usage }));
    await plan(initialState(), first);
    const afterSkeleton = first.persisted[1]?.lesson;
    if (!afterSkeleton?.facts) throw new Error("no skeleton persist");
    expect(afterSkeleton.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);

    const ai = createFakeAi({ script: [json(FIXTURES.planFacts), json(FIXTURES.verify)], usage });
    const deps = recordingDeps(ai);
    const state = await plan(initialState(afterSkeleton), deps);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[0]?.context?.promptVersion).toBe(PROMPT_VERSIONS["plan-facts"]);
    // No persist ever drops slide two: the first persist already carries both slides.
    for (const p of deps.persisted) {
      expect(p.lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    }
    expect(state.lesson.slides).toEqual(afterSkeleton.slides);
    expect(state.lesson.generation?.stage).toBe("planned");
    // The facts are the same as a fresh run's: the skeleton was rebuilt from the persisted facts.
    expect(state.lesson.facts).toEqual(fullFacts());
  });

  test("a lesson that only looks like a skeleton checkpoint is planned from the top", async () => {
    const first = recordingDeps(createFakeAi({ script: planScript(), usage }));
    await plan(initialState(), first);
    const afterSkeleton = first.persisted[1]?.lesson;
    if (!afterSkeleton?.facts) throw new Error("no skeleton persist");
    const objectives = afterSkeleton.slides[1] as (typeof afterSkeleton.slides)[number];

    const variants: Record<string, typeof afterSkeleton> = {
      // An older prompt version wrote slide two: its objectives may not match today's schema.
      olderPrompt: {
        ...afterSkeleton,
        slides: [
          afterSkeleton.slides[0] as (typeof afterSkeleton.slides)[number],
          {
            ...objectives,
            elements: objectives.elements.map((el) => ({
              ...el,
              generatedFrom: el.generatedFrom && {
                ...el.generatedFrom,
                promptVersion: "plan-skeleton.v1",
              },
            })),
          },
        ],
      },
      // The teacher touched slide two.
      teacherEdit: {
        ...afterSkeleton,
        slides: [
          afterSkeleton.slides[0] as (typeof afterSkeleton.slides)[number],
          {
            ...objectives,
            elements: objectives.elements.map((el) => ({ ...el, authoredBy: "teacher" as const })),
          },
        ],
      },
      // A third slide already exists.
      threeSlides: { ...afterSkeleton, slides: [...afterSkeleton.slides, objectives] },
      // The facts carry a list the skeleton call never writes.
      hasMisconceptions: {
        ...afterSkeleton,
        facts: {
          ...afterSkeleton.facts,
          misconceptions: [
            {
              id: "m1",
              belief: "Heat is a substance.",
              correction: "Heat is energy transferred.",
              objectiveRefs: [],
            },
          ],
        },
      },
    };
    for (const [name, lesson] of Object.entries(variants)) {
      const ai = createFakeAi({ script: planScript(), usage });
      const state = await plan(initialState(lesson), recordingDeps(ai));
      expect(ai.calls, name).toHaveLength(3);
      expect(state.lesson.generation?.stage, name).toBe("planned");
    }
  });

  test("a budget stop on the facts call keeps the skeleton facts, records the finding, reaches planned", async () => {
    const ai = createFakeAi({ script: planScript(), usage });
    // Below one call's worth of standard-class tokens: the budget is checked before each call,
    // so the first goes ahead at zero spend and the second is refused.
    const deps = recordingDeps(ai, {
      budget: createBudget({ capUsd: STANDARD_CALL_USD / 2, capTokens: 1_000_000 }),
    });
    const state = await plan(initialState(), deps);
    expect(ai.calls).toHaveLength(1);
    expect(state.lesson.generation?.stage).toBe("planned");
    expect(state.lesson.facts?.outline).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(state.lesson.facts?.vocabulary).toEqual([]);
    expect(state.lesson.generation?.findings).toEqual([
      expect.objectContaining({ check: "budget", severity: "error" }),
    ]);
  });

  describe("verify (TEACH-212)", () => {
    const withCorrection = (corrections: unknown[]) =>
      createFakeAi({
        script: [json(FIXTURES.planSkeleton), json(FIXTURES.planFacts), json({ corrections })],
        usage,
      });

    test("row 1: a term correction lands in the persisted facts with one content-free fact-verify warning", async () => {
      const ai = withCorrection([
        { factId: "v1", field: "term", value: "Clan", reason: "wrong-term" },
      ]);
      const deps = recordingDeps(ai);
      const state = await plan(initialState(), deps);
      const facts = deps.persisted.at(-1)?.lesson.facts;
      expect(facts?.vocabulary[0]?.term).toBe("Clan");
      expect(facts?.vocabulary[0]?.definition).toBe(fullFacts().vocabulary[0]?.definition);
      const findings = state.lesson.generation?.findings ?? [];
      expect(findings).toEqual([
        {
          check: "fact-verify",
          severity: "warning",
          target: { factId: "v1" },
          message: "Vocabulary term corrected: not the accepted term.",
        },
      ]);
      expect(JSON.stringify(findings)).not.toContain("Clan");
    });

    test("row 2: an unknown fact id is a validation issue the retry names; the second reply is applied", async () => {
      const ai = createFakeAi({
        script: [
          json(FIXTURES.planSkeleton),
          json(FIXTURES.planFacts),
          json({
            corrections: [{ factId: "v9", field: "term", value: "Clan", reason: "wrong-term" }],
          }),
          json({
            corrections: [{ factId: "v1", field: "term", value: "Clan", reason: "wrong-term" }],
          }),
        ],
        usage,
      });
      const state = await plan(initialState(), recordingDeps(ai));
      expect(ai.calls).toHaveLength(4);
      expect(ai.calls[3]?.promptText).toContain("unknown fact id v9");
      expect(state.lesson.facts?.vocabulary[0]?.term).toBe("Clan");
    });

    test("row 5: the budget spent before Verify skips it; planned is reached with one budget finding", async () => {
      const ai = createFakeAi({ script: planScript(), usage });
      // Two calls' worth and a little: skeleton and facts go ahead, Verify is refused.
      const deps = recordingDeps(ai, {
        budget: createBudget({ capUsd: STANDARD_CALL_USD * 1.5, capTokens: 1_000_000 }),
      });
      const state = await plan(initialState(), deps);
      expect(ai.calls).toHaveLength(2);
      expect(state.lesson.generation?.stage).toBe("planned");
      expect(state.lesson.facts).toEqual(fullFacts());
      expect(state.lesson.generation?.findings.filter((f) => f.check === "budget")).toHaveLength(1);
    });

    test("a provider fault on Verify is a fact-verify warning too, never a failed job; a cancel still propagates", async () => {
      const faulty = createFakeAi({
        script: [
          json(FIXTURES.planSkeleton),
          json(FIXTURES.planFacts),
          () => {
            throw new Error("boom");
          },
        ],
        usage,
      });
      const state = await plan(initialState(), recordingDeps(faulty));
      expect(state.lesson.generation?.stage).toBe("planned");
      expect(state.lesson.generation?.findings).toEqual([
        expect.objectContaining({ check: "fact-verify", target: {} }),
      ]);
    });

    test("row 6: two schema misses on Verify leave the facts as they were and one fact-verify warning; the job goes on", async () => {
      const ai = createFakeAi({
        script: [json(FIXTURES.planSkeleton), json(FIXTURES.planFacts), "not json", "{}"],
        usage,
      });
      const state = await plan(initialState(), recordingDeps(ai));
      expect(ai.calls).toHaveLength(4);
      expect(state.lesson.generation?.stage).toBe("planned");
      expect(state.lesson.facts).toEqual(fullFacts());
      expect(state.lesson.generation?.findings).toEqual([
        {
          check: "fact-verify",
          severity: "warning",
          target: {},
          message: "Fact verification could not be completed.",
        },
      ]);
    });
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
    const ai = createFakeAi({ script: planScript(), usage });
    const deps = recordingDeps(ai);
    return plan(initialState(), deps);
  }

  test("one call per remaining outline entry, then the worksheet; persists after each slide", async () => {
    const start = await planned();
    const slides = FIXTURES.planSkeleton.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const ai = createFakeAi({ script: routed([...slides, json(FIXTURES.worksheet)]), usage });
    const deps = recordingDeps(ai);
    const state = await generate(start, deps);
    expect(ai.calls).toHaveLength(slides.length + 1);
    // Row 6 (TEACH-213): Generate runs on the small class at low effort.
    expect(
      ai.calls.every(
        (c) =>
          c.modelClass === "small" &&
          c.context?.stage === "generate" &&
          c.context?.effort === "low",
      ),
    ).toBe(true);
    expect(state.lesson.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
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
    const slides = FIXTURES.planSkeleton.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    // A scripted reply of the wrong kind for the first slide call (outline[2] is a starter).
    const wrongKind = miss(json(FIXTURES.slides.content));
    const ai = createFakeAi({
      script: routed([wrongKind, ...slides, json(FIXTURES.worksheet)]),
      usage,
    });
    const state = await generate(start, recordingDeps(ai));
    expect(ai.calls).toHaveLength(slides.length + 2);
    expect(state.lesson.slides[2]?.kind).toBe("starter");
  });

  test("budget exceeded mid-way keeps the slides written, records a budget finding, reaches generated", async () => {
    const start = await planned();
    const slides = FIXTURES.planSkeleton.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const ai = createFakeAi({ script: routed([...slides, json(FIXTURES.worksheet)]), usage });
    // Under one batch's worth of small-class tokens at list price: the first four slide calls and
    // the worksheet start together at zero spend, the fifth slide is refused (row 5).
    const budget = createBudget({ capUsd: SMALL_CALL_USD * 2.5, capTokens: 1_000_000 });
    const deps = recordingDeps(ai, { budget });
    const state = await generate(start, deps);
    expect(ai.calls).toHaveLength(GENERATE_CONCURRENCY + 1);
    expect(state.lesson.slides).toHaveLength(PLANNED_SLIDES + GENERATE_CONCURRENCY);
    // The worksheet was already in flight when the cap was hit, so it lands; nothing started after.
    expect(state.worksheet).toBeDefined();
    expect(state.lesson.generation?.stage).toBe("generated");
    expect(state.lesson.generation?.findings).toEqual([
      expect.objectContaining({
        check: "budget",
        severity: "error",
        message: expect.stringContaining("slide 7 of 10"),
      }),
    ]);
    expect(deps.progress.at(-1)?.message).toBe("Worksheet ready");
  });

  test("a cancel mid-way throws without claiming `generated`; the slides written stay persisted", async () => {
    const start = await planned();
    const slides = FIXTURES.planSkeleton.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const ai = createFakeAi({ script: routed([...slides, json(FIXTURES.worksheet)]), usage });
    const deps = recordingDeps(ai, { abortAfterPersist: 2 });
    const error = await generate(start, deps).catch((e) => e);
    expect((error as Error).name).toBe("AbortError");
    // Nothing is written after the abort: the calls already in flight (one batch and the
    // worksheet) finish and are dropped.
    expect(deps.persisted).toHaveLength(2);
    expect(deps.persisted.at(-1)?.lesson.generation?.stage).toBe("planned");
    expect(ai.calls.length).toBeLessThanOrEqual(GENERATE_CONCURRENCY + 1);
  });

  test("row 1: each slide is given the stems reserved for others; the worksheet its own pool and the slides' stems", async () => {
    const start = await planned();
    const facts = start.lesson.facts;
    if (!facts) throw new Error("no facts");
    const slides = FIXTURES.planSkeleton.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const ai = createFakeAi({ script: routed([...slides, json(FIXTURES.worksheet)]), usage });
    await generate(start, recordingDeps(ai));
    const slideCalls = ai.calls.filter(
      (c) => c.context?.promptVersion === PROMPT_VERSIONS["generate-slide"],
    );
    const worksheetCall = ai.calls.find(
      (c) => c.context?.promptVersion === PROMPT_VERSIONS["generate-worksheet"],
    );
    // The multiple-choice slide (outline position 7) references q1; every other question's stem
    // is reserved from it, its own is not.
    const mc = slideCalls.find((c) => c.promptText.includes('kind "multiple-choice"'));
    const q1 = facts.questions.find((q) => q.id === "q1");
    if (!mc || !q1) throw new Error("fixture");
    expect(mc.promptText).not.toContain(`  - ${q1.stem}`);
    for (const q of facts.questions.filter((q) => q.id !== "q1" && q.use !== "any")) {
      expect(mc.promptText).toContain(`  - ${q.stem}`);
    }
    // The worksheet sees exactly the worksheet/any pool, and the slide/exit stems as reserved.
    for (const q of facts.questions) {
      const inPool = q.use === "worksheet" || q.use === "any";
      expect(worksheetCall?.promptText.includes(`${q.id}: ${q.stem}`)).toBe(inPool);
      const reserved = q.use === "slide" || q.use === "exit";
      expect(worksheetCall?.promptText.includes(`  - ${q.stem}`)).toBe(reserved);
    }
    // Filtered facts: the slide sees only what its entry references (plus misconceptions).
    expect(mc.promptText).not.toContain("Key ideas:");
    expect(mc.promptText).toContain("Misconceptions:");
  });

  test("rows 2–4: slides resolving out of order are persisted in outline order, one at a time, at most four in flight; the worksheet lands only with the final write", async () => {
    const start = await planned();
    const entries = FIXTURES.planSkeleton.outline.slice(PLANNED_SLIDES);
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = new Map<number, () => void>();
    const delayed = (i: number, text: string) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Slide 3 (i = 1) resolves only after slide 4 (i = 2) has.
      if (i === 1) await new Promise<void>((resolve) => gate.set(1, resolve));
      await new Promise((r) => setTimeout(r, 1));
      if (i === 2) gate.get(1)?.();
      inFlight -= 1;
      return text;
    };
    const byKind = new Map(
      entries.map((e, i) => [e.kind, delayed(i, json(FIXTURES.slides[e.kind]))]),
    );
    // One dispatcher answers every call by what it asks for: the worksheet at once, each slide by
    // its kind with the scripted delay.
    const ai = createFakeAi({
      fallback: (call) => {
        if (call.context?.promptVersion === PROMPT_VERSIONS["generate-worksheet"]) {
          return json(FIXTURES.worksheet);
        }
        const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1] ?? "";
        const reply = byKind.get(kind as (typeof entries)[number]["kind"]);
        if (!reply) throw new Error(`no scripted reply for ${kind}`);
        return reply();
      },
      usage,
    });
    const deps = recordingDeps(ai);
    const state = await generate(start, deps);
    expect(maxInFlight).toBeLessThanOrEqual(GENERATE_CONCURRENCY + 1);
    const lengths = deps.persisted.map((p) => p.lesson.slides.length);
    expect(lengths).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 10]);
    expect(deps.progress.map((p) => p.message).slice(0, 8)).toEqual(
      entries.map((_, i) => `Slide ${i + PLANNED_SLIDES + 1} of 10`),
    );
    // The worksheet is on the final write only.
    expect(deps.persisted.slice(0, -1).every((p) => p.worksheet === undefined)).toBe(true);
    expect(deps.persisted.at(-1)?.worksheet).toBeDefined();
    expect(state.lesson.artefacts).toEqual({ worksheetId: state.worksheetId });
    expect(state.lesson.slides.map((s) => s.kind)).toEqual(
      FIXTURES.planSkeleton.outline.map((e) => e.kind),
    );
  });

  /** The planned state with the `content` entry turned into an image-text one (TEACH-220). */
  async function plannedWithImage(mustShow: string[] = ["river water"]) {
    const start = await planned();
    const facts = start.lesson.facts;
    if (!facts) throw new Error("no facts");
    const outline = facts.outline.map((e) =>
      e.kind === "content"
        ? {
            ...e,
            kind: "image-text" as const,
            imageBrief: { subject: "river severn", mustShow, purpose: "observe" as const },
          }
        : e,
    );
    return { ...start, lesson: { ...start.lesson, facts: { ...facts, outline } } };
  }
  const PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const riverPhoto = {
    id: "p1",
    width: 4000,
    height: 6000,
    alt: "River at dawn",
    photographer: "Ada",
    photographerUrl: "https://www.pexels.com/@ada",
    pageUrl: "https://www.pexels.com/photo/p1/",
    src: {
      large: "https://images.pexels.com/photos/p1/large.jpeg",
      medium: "https://images.pexels.com/photos/p1/medium.jpeg",
      tiny: `data:image/png;base64,${PNG}`,
    },
  };
  const riverImages = {
    search: async () => [riverPhoto],
    store: async () => ({
      key: "ws/images/p1.jpg",
      url: "/files/ws/images/p1.jpg",
      width: 4000,
      height: 6000,
      bytes: 100,
      contentType: "image/jpeg",
      source: {
        provider: "pexels" as const,
        id: "p1",
        pageUrl: riverPhoto.pageUrl,
        photographer: "Ada",
        photographerUrl: "https://www.pexels.com/@ada",
      },
    }),
  };
  /** Every generate call by shape; the judge's reply is `judge`, held until `release` is called. */
  const imageRunAi = (judge: string, hold?: { release: () => void; wait: Promise<void> }) =>
    createFakeAi({
      fallback: async (call) => {
        const version = call.context?.promptVersion ?? "";
        if (version.startsWith("pick-or-requery-photo")) {
          if (hold) await hold.wait;
          return judge;
        }
        if (version.startsWith("generate-worksheet")) return json(FIXTURES.worksheet);
        const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1] ?? "";
        const spec = FIXTURES.slides[kind as keyof typeof FIXTURES.slides];
        if (!spec) throw new Error(`no fixture for ${kind}`);
        return json(spec);
      },
      usage,
    });

  test("row 5 (TEACH-220): the image-text slide waits for its own pick only; its text is written to the photo and the photo lands in the same persist", async () => {
    const start = await plannedWithImage();
    let release = () => {};
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ai = imageRunAi(
      json({
        pick: "p1",
        onSubject: true,
        clear: true,
        visible: ["river water"],
        count: "one",
        query: null,
      }),
      { release: () => release(), wait },
    );
    const deps = recordingDeps(ai, { images: riverImages });
    const run = generate(start, deps);
    // Slides before the image one land while the pick is still out.
    await new Promise((r) => setTimeout(r, 5));
    const imageIndex = start.lesson.facts?.outline.findIndex((e) => e.kind === "image-text") ?? -1;
    expect(deps.persisted.length).toBe(imageIndex - PLANNED_SLIDES);
    release();
    const state = await run;

    const slideCall = ai.calls.find((c) => c.promptText.includes("The photograph on this slide"));
    expect(slideCall?.promptText).toContain("Visible: river water");
    expect(slideCall?.promptText).toContain("Purpose: observe");
    const judge = ai.calls.find((c) => c.context?.stage === "illustrate");
    expect(judge?.imageParts).toBe(1);
    const slide = state.lesson.slides[imageIndex];
    const image = slide?.elements.find((e) => e.type === "image");
    if (image?.type !== "image") throw new Error("no image element");
    expect(image.src).toBe("/files/ws/images/p1.jpg");
    expect(image.source?.evidence?.visible).toEqual(["river water"]);
    // The persist that added the slide already carried the photo: no placeholder was ever written.
    const persisted = deps.persisted.find((p) => p.lesson.slides.length === imageIndex + 1);
    const persistedImage = persisted?.lesson.slides[imageIndex]?.elements.find(
      (e) => e.type === "image",
    );
    expect(persistedImage?.type === "image" && persistedImage.src).toBe("/files/ws/images/p1.jpg");
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 1, empty: 0, failed: 0 });
    expect(state.lesson.generation?.promptVersions.generated).toBe(
      `${PROMPT_VERSIONS["generate-slide"]}+${PROMPT_VERSIONS["pick-or-requery-photo"]}`,
    );
    expect(state.lesson.generation?.findings).toEqual([]);
  });

  test("a Pexels rate limit during the pick is the busy warning, not 'no photograph found'", async () => {
    const start = await plannedWithImage();
    const ai = imageRunAi(json({ pick: null, visible: [], count: null, query: null }));
    const busyImages = {
      ...riverImages,
      search: async () => {
        throw new PexelsError(429, "slow");
      },
    };
    const state = await generate(start, recordingDeps(ai, { images: busyImages }));
    expect(ai.calls.some((c) => c.context?.stage === "illustrate")).toBe(false);
    const findings = state.lesson.generation?.findings ?? [];
    expect(findings.map((f) => f.check)).toEqual(["image"]);
    expect(findings[0]?.message).toContain("busy");
  });

  test("row 6: an empty pick writes the slide as plain content with the image warning", async () => {
    const start = await plannedWithImage();
    const ai = imageRunAi(json({ pick: null, visible: [], count: null, query: null }));
    const deps = recordingDeps(ai, { images: riverImages });
    const state = await generate(start, deps);
    const slideCall = ai.calls.find((c) =>
      c.promptText.includes("There is no photograph on this slide"),
    );
    expect(slideCall).toBeDefined();
    const imageIndex = start.lesson.facts?.outline.findIndex((e) => e.kind === "image-text") ?? -1;
    const image = state.lesson.slides[imageIndex]?.elements.find((e) => e.type === "image");
    expect(image?.type === "image" && image.src.startsWith("data:image/svg+xml")).toBe(true);
    expect(state.lesson.generation?.findings.map((f) => f.check)).toEqual(["image"]);
    expect(deps.imageCounts).toEqual({ requested: 1, placed: 0, empty: 1, failed: 0 });
  });

  test("row 8: Evaluate shows the photographed slide as an image part and keeps an image-fit warning; Repair rewrites its text and keeps the photo", async () => {
    const start = await plannedWithImage();
    const ai = imageRunAi(
      json({
        pick: "p1",
        onSubject: true,
        clear: true,
        visible: ["river water"],
        count: "one",
        query: null,
      }),
    );
    const generated = await generate(start, recordingDeps(ai, { images: riverImages }));
    const imageIndex = start.lesson.facts?.outline.findIndex((e) => e.kind === "image-text") ?? -1;
    const slide = generated.lesson.slides[imageIndex];
    if (!slide) throw new Error("no image slide");
    const before = slide.elements.find((e) => e.type === "image");

    const review = createFakeAi({
      script: [
        json({
          findings: [
            {
              check: "image-fit",
              severity: "warning",
              target: { slideId: slide.id },
              evidence: "Rivers flow to the sea.",
              message: "The photograph shows a river at dawn, not the sea.",
            },
          ],
        }),
      ],
      usage,
    });
    const evaluated = await evaluate(generated, recordingDeps(review));
    expect(review.calls[0]?.imageParts).toBe(1);
    expect(review.calls[0]?.promptText).toContain(`[slideId ${slide.id}, image-text, photo 1]`);
    expect(evaluated.lesson.generation?.findings.map((f) => f.check)).toEqual(["image-fit"]);

    // The slide's purpose is "observe" (plannedWithImage), so the image-fit finding is an error with
    // a regenerate fix (TEACH-227): Repair rewrites the text to what the picture shows.
    expect(evaluated.lesson.generation?.findings[0]).toMatchObject({
      severity: "error",
      fix: { kind: "regenerate-slide" },
    });
    const errored = evaluated;
    const fixer = createFakeAi({
      script: [
        json({
          kind: "image-text",
          heading: "Rivers",
          body: "Look at the photograph: the river water flows downhill.",
          factRefs: ["o1"],
        }),
      ],
      usage,
    });
    const repaired = await repair(errored, recordingDeps(fixer));
    // Row 2 (TEACH-222): the KEY IDEA caption is not part of the current text the model is shown,
    // so it cannot be copied into `heading`.
    expect(fixer.calls[0]?.promptText).not.toContain("KEY IDEA");
    expect(fixer.calls[0]?.promptText).toMatch(/heading: .+\nbody: .+/);
    expect(fixer.calls[0]?.promptText).toContain(
      "The photograph on this slide shows: River at dawn",
    );
    expect(fixer.calls[0]?.promptText).toContain("Visible: river water");
    const after = repaired.lesson.slides[imageIndex];
    expect(after?.elements.find((e) => e.type === "image")).toEqual(before);
    expect(
      after?.elements.some(
        (e) => e.type === "text" && JSON.stringify(e).includes("flows downhill"),
      ),
    ).toBe(true);
    expect(repaired.lesson.generation?.findings.some((f) => f.check === "image-fit")).toBe(false);
  });

  test("TEACH-227: an image-fit finding on a context-purpose picture stays a warning", async () => {
    const start = await plannedWithImage();
    const facts = start.lesson.facts;
    if (!facts) throw new Error("fixture");
    const outline = facts.outline.map((e) =>
      e.kind === "image-text" && e.imageBrief
        ? { ...e, imageBrief: { ...e.imageBrief, purpose: "context" as const } }
        : e,
    );
    const contextStart = { ...start, lesson: { ...start.lesson, facts: { ...facts, outline } } };
    const ai = imageRunAi(
      json({
        pick: "p1",
        onSubject: true,
        clear: true,
        visible: ["river water"],
        count: "one",
        query: null,
      }),
    );
    const generated = await generate(contextStart, recordingDeps(ai, { images: riverImages }));
    const slide = generated.lesson.slides.find((s) => s.kind === "image-text");
    if (!slide) throw new Error("no image slide");
    const review = createFakeAi({
      script: [
        json({
          findings: [
            {
              check: "image-fit",
              severity: "warning",
              target: { slideId: slide.id },
              evidence: "Rivers flow to the sea.",
              message: "The photograph shows a river at dawn, not the sea.",
            },
          ],
        }),
      ],
      usage,
    });
    const evaluated = await evaluate(generated, recordingDeps(review));
    expect(evaluated.lesson.generation?.findings[0]).toMatchObject({ severity: "warning" });
    expect(evaluated.lesson.generation?.findings[0]?.fix).toBeUndefined();
  });

  test("resumes: slides already present are not regenerated", async () => {
    const start = await planned();
    const slides = FIXTURES.planSkeleton.outline
      .slice(PLANNED_SLIDES)
      .map((e) => json(FIXTURES.slides[e.kind]));
    const full = await generate(
      start,
      recordingDeps(createFakeAi({ script: routed([...slides, json(FIXTURES.worksheet)]), usage })),
    );
    // The checkpoint a retried job reads: Plan's two slides plus three generated ones.
    const partial = {
      ...start,
      lesson: { ...start.lesson, slides: full.lesson.slides.slice(0, 5) },
    };
    const ai = createFakeAi({
      script: routed([...slides.slice(3), json(FIXTURES.worksheet)]),
      usage,
    });
    const state = await generate(partial, recordingDeps(ai));
    // Row 7: the calls start at entry 5 (the sixth slide).
    expect(ai.calls).toHaveLength(slides.length - 3 + 1);
    const slideCalls = ai.calls.filter(
      (c) => c.context?.promptVersion === PROMPT_VERSIONS["generate-slide"],
    );
    expect(slideCalls[0]?.promptText).toContain("Slide 6 of 10");
    expect(state.lesson.slides).toHaveLength(FIXTURES.planSkeleton.outline.length);
    expect(state.lesson.slides.slice(0, 5)).toEqual(full.lesson.slides.slice(0, 5));
  });
});

describe("evaluate", () => {
  async function generated() {
    const ai = createFakeAi({
      script: routed([
        ...planScript(),
        ...FIXTURES.planSkeleton.outline
          .slice(PLANNED_SLIDES)
          .map((e) => json(FIXTURES.slides[e.kind])),
        json(FIXTURES.worksheet),
      ]),
      usage,
    });
    const deps = recordingDeps(ai);
    return generate(await plan(initialState(), deps), deps);
  }

  test("schema checks plus one standard call; findings with unknown targets or absent evidence are dropped (rows 2, 6)", async () => {
    const state = await generated();
    const slide = state.lesson.slides[4];
    if (!slide) throw new Error("fixture");
    const slideId = slide.id;
    const quoted = slideText(slide).split("\n")[0] ?? "";
    const findings: Finding[] = [
      {
        check: "pitch",
        severity: "warning",
        target: { slideId },
        evidence: quoted.toUpperCase(),
        message: "Hard word.",
      },
      {
        check: "pitch",
        severity: "warning",
        target: { slideId: "ghost" },
        evidence: quoted,
        message: "Dropped.",
      },
      {
        check: "pitch",
        severity: "warning",
        target: { slideId },
        evidence: "Words that are on no slide at all",
        message: "Dropped too.",
      },
      {
        check: "notes-quality",
        severity: "warning",
        target: { slideId },
        evidence: slide.notes ?? "",
        message: "Notes kept: evidence is in the notes.",
      },
      {
        check: "fact-consistency",
        severity: "error",
        target: {},
        evidence: "Particle",
        message: "Untargeted: a fact, kept.",
      },
      {
        check: "fact-consistency",
        severity: "error",
        target: { slideId, factId: "v99" },
        evidence: slide.notes ?? "",
        message: "Kept, but v99 names no fact: the id is removed so Repair patches nothing.",
      },
      {
        check: "fact-consistency",
        severity: "error",
        target: { slideId, factId: "o1" },
        evidence: slide.notes ?? "",
        message: "Kept; an objective cannot be patched, so its id is removed too.",
      },
    ];
    const { lines, logger } = memoryLogger();
    const ai = createFakeAi({ script: [json({ findings })], usage });
    const deps = recordingDeps(ai, { logger });
    const next = await evaluate(state, deps);
    expect(ai.calls.map((c) => [c.modelClass, c.context?.stage, c.context?.effort])).toEqual([
      ["standard", "evaluate", "medium"],
    ]);
    expect(next.lesson.generation?.stage).toBe("evaluated");
    expect(next.lesson.generation?.findings.map((f) => f.check)).toEqual([
      "pitch",
      "notes-quality",
      "fact-consistency",
      "fact-consistency",
      "fact-consistency",
    ]);
    expect(next.lesson.generation?.findings.slice(-2).map((f) => f.target)).toEqual([
      { slideId },
      { slideId },
    ]);
    const dropped = lines.map((l) => JSON.parse(l)).find((r) => r.msg === "findings dropped");
    expect(dropped).toMatchObject({ stage: "evaluate", dropped: 2 });
    expect(lines.join("\n")).not.toContain("Dropped");
    expect(lines.join("\n")).not.toContain(quoted);
    expect(deps.persisted).toHaveLength(1);
    expect(deps.progress).toEqual([
      { percent: 90, message: "Reviewed", documentUpdatedAt: deps.persisted[0]?.updatedAt },
    ]);
  });

  test("illustrate image warnings survive the review", async () => {
    const state = await generated();
    const slideId = state.lesson.slides[4]?.id as string;
    const generation = state.lesson.generation;
    if (!generation) throw new Error("no generation");
    const warning: Finding = {
      check: "image",
      severity: "warning",
      target: { slideId, elementId: "e1" },
      message: "No photograph was found for this slide. Add one from the image panel.",
    };
    const withWarning = {
      ...state,
      lesson: {
        ...state.lesson,
        generation: { ...generation, findings: [...generation.findings, warning] },
      },
    };
    const ai = createFakeAi({ script: [json({ findings: [] })], usage });
    const next = await evaluate(withWarning, recordingDeps(ai));
    expect(
      next.lesson.generation?.findings.filter((f) => f.check === "image").map((f) => f.severity),
    ).toEqual(["warning"]);
  });

  test("row 7 (TEACH-212): a fact-verify finding from Plan survives the review", async () => {
    const state = await generated();
    const generation = state.lesson.generation;
    if (!generation) throw new Error("no generation");
    const verify: Finding = {
      check: "fact-verify",
      severity: "warning",
      target: { factId: "v1" },
      message: "Vocabulary term corrected: not the accepted term.",
    };
    const withVerify = {
      ...state,
      lesson: {
        ...state.lesson,
        generation: { ...generation, findings: [...generation.findings, verify] },
      },
    };
    const ai = createFakeAi({ script: [json({ findings: [] })], usage });
    const next = await evaluate(withVerify, recordingDeps(ai));
    expect(next.lesson.generation?.findings).toContainEqual(verify);
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
      ...planScript(),
      ...FIXTURES.planSkeleton.outline
        .slice(PLANNED_SLIDES)
        .map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupAi = createFakeAi({ script: routed(script), usage });
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
      // Warnings on the regenerated slide (TEACH-222): one quoting text the rewrite keeps, one
      // quoting text it removes, one with no evidence at all.
      {
        check: "pitch",
        severity: "warning",
        target: { slideId: mc.id },
        evidence: "Repaired.",
        message: "Kept: its evidence is in the new notes.",
      },
      {
        check: "pitch",
        severity: "warning",
        target: { slideId: mc.id },
        evidence: "words that the rewrite removed",
        message: "Dropped: stale.",
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
    // Row 6 (TEACH-216): Repair runs on the small class at low effort.
    expect(ai.calls.map((c) => [c.modelClass, c.context?.stage, c.context?.effort])).toEqual([
      ["small", "repair", "low"],
      ["small", "repair", "low"],
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
      expect.objectContaining({
        check: "pitch",
        message: "Kept: its evidence is in the new notes.",
      }),
    ]);
    // Row 2 (TEACH-222): the slide's current text is shown field by field, never the caption line.
    const slidePrompt = ai.calls[0]?.promptText ?? "";
    expect(slidePrompt).toContain("heading: ");
    expect(slidePrompt).toContain("option A");
    expect(slidePrompt).toContain("(correct)");
    expect(deps.progress).toEqual([
      { percent: 100, message: "Done", documentUpdatedAt: deps.persisted[0]?.updatedAt },
    ]);
  });

  test("row 4: a fact-consistency error naming the fact patches the fact first, then regenerates the slide from the patched facts; one fact-verify warning", async () => {
    const script = [
      ...planScript(),
      ...FIXTURES.planSkeleton.outline
        .slice(PLANNED_SLIDES)
        .map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupDeps = recordingDeps(createFakeAi({ script: routed(script), usage }));
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    const vocab = generated.lesson.slides.find((s) => s.kind === "vocabulary");
    const v1 = generated.lesson.facts?.vocabulary[0];
    if (!vocab || !v1) throw new Error("fixture");
    const findings: Finding[] = [
      {
        check: "fact-consistency",
        severity: "error",
        target: { slideId: vocab.id, factId: "v1" },
        evidence: v1.term,
        message: "Not the accepted term for this year group.",
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
    const ai = createFakeAi({
      script: [
        json({
          corrections: [{ factId: "v1", field: "term", value: "Corpuscle", reason: "wrong-term" }],
        }),
        json(FIXTURES.slides.vocabulary),
      ],
      usage,
    });
    const state = await repair(evaluated, recordingDeps(ai));
    expect(
      ai.calls.map((c) => [c.context?.promptVersion, c.modelClass, c.context?.effort]),
    ).toEqual([
      [PROMPT_VERSIONS["repair-fact"], "small", "low"],
      [PROMPT_VERSIONS.repair, "small", "low"],
    ]);
    // The fact call saw v1 and the review's words; the slide call saw the patched fact.
    expect(ai.calls[0]?.promptText).toContain("v1:");
    // Row 3 (TEACH-222): and the fields it may correct on a vocabulary fact.
    expect(ai.calls[0]?.promptText).toContain("Fields you may correct on v1: term, definition.");
    expect(ai.calls[0]?.promptText).toContain("Not the accepted term");
    expect(ai.calls[1]?.promptText).toContain("Corpuscle");
    expect(state.lesson.facts?.vocabulary[0]?.term).toBe("Corpuscle");
    expect(state.lesson.generation?.findings).toContainEqual({
      check: "fact-verify",
      severity: "warning",
      target: { factId: "v1" },
      message: "Vocabulary term corrected: not the accepted term.",
    });
    // The error was repaired: no fact-consistency error remains.
    expect(state.lesson.generation?.findings.some((f) => f.check === "fact-consistency")).toBe(
      false,
    );
  });

  test("a fact patch is committed only with its regenerated artefact: a slide call that fails leaves the facts as they were", async () => {
    const script = [
      ...planScript(),
      ...FIXTURES.planSkeleton.outline
        .slice(PLANNED_SLIDES)
        .map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupDeps = recordingDeps(createFakeAi({ script: routed(script), usage }));
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    const vocab = generated.lesson.slides.find((s) => s.kind === "vocabulary");
    const v1 = generated.lesson.facts?.vocabulary[0];
    if (!vocab || !v1) throw new Error("fixture");
    const findings: Finding[] = [
      {
        check: "fact-consistency",
        severity: "error",
        target: { slideId: vocab.id, factId: "v1" },
        evidence: v1.term,
        message: "Not the accepted term for this year group.",
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
    // The fact call succeeds; the slide call misses twice.
    const ai = createFakeAi({
      script: [
        json({
          corrections: [{ factId: "v1", field: "term", value: "Corpuscle", reason: "wrong-term" }],
        }),
        "not json",
        "still not json",
      ],
      usage,
    });
    const state = await repair(evaluated, recordingDeps(ai));
    expect(ai.calls).toHaveLength(3);
    expect(state.lesson.facts?.vocabulary[0]?.term).toBe(v1.term);
    const checks = state.lesson.generation?.findings.map((f) => f.check) ?? [];
    expect(checks).not.toContain("fact-verify");
    // The error stays, with the repair warning, as for any target that could not be repaired.
    expect(checks).toContain("fact-consistency");
    expect(checks).toContain("repair");
  });

  test("row 7: seven error targets — six repaired (the cap), the seventh's error stays a residual", async () => {
    const script = [
      ...planScript(),
      ...FIXTURES.planSkeleton.outline
        .slice(PLANNED_SLIDES)
        .map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupDeps = recordingDeps(createFakeAi({ script: routed(script), usage }));
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    const targets = generated.lesson.slides.slice(2, 9); // seven generated slides
    expect(targets).toHaveLength(7);
    const findings: Finding[] = targets.map((s) => ({
      check: "answer-correctness",
      severity: "error" as const,
      target: { slideId: s.id },
      evidence: slideText(s).split("\n")[0] ?? "",
      message: "Wrong.",
    }));
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
    // One answer per repaired slide, by kind.
    const ai = createFakeAi({
      fallback: (call) => {
        const kind = /kind "([a-z-]+)"/.exec(call.promptText)?.[1] ?? "content";
        return json(FIXTURES.slides[kind as keyof typeof FIXTURES.slides]);
      },
      usage,
    });
    const state = await repair(evaluated, recordingDeps(ai));
    expect(ai.calls).toHaveLength(MAX_TARGETS);
    const residual = state.lesson.generation?.findings.filter(
      (f) => f.check === "answer-correctness" && f.severity === "error",
    );
    expect(residual).toHaveLength(1);
    expect(residual?.[0]?.target.slideId).toBe(targets[6]?.id);
  });

  test("row 5: a repair reply whose notes are a change log is a validation issue; the retry lands", async () => {
    const script = [
      ...planScript(),
      ...FIXTURES.planSkeleton.outline
        .slice(PLANNED_SLIDES)
        .map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupDeps = recordingDeps(createFakeAi({ script: routed(script), usage }));
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    const mc = generated.lesson.slides.find((s) => s.kind === "multiple-choice");
    if (!mc) throw new Error("fixture");
    const evaluated = {
      ...generated,
      lesson: {
        ...generated.lesson,
        generation: {
          ...(generated.lesson.generation as NonNullable<typeof generated.lesson.generation>),
          stage: "evaluated" as const,
          findings: [
            {
              check: "answer-correctness",
              severity: "error" as const,
              target: { slideId: mc.id },
              evidence: slideText(mc).split("\n")[0] ?? "",
              message: "Wrong option.",
            },
          ],
        },
      },
    };
    const commentary = {
      ...FIXTURES.repair,
      notes: "Corrected the marked option so that it matches the facts.",
    };
    const ai = createFakeAi({ script: [json(commentary), json(FIXTURES.repair)], usage });
    const state = await repair(evaluated, recordingDeps(ai));
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]?.promptText).toContain("Notes are for the teacher");
    expect(state.lesson.slides.find((s) => s.id === mc.id)?.notes).toBe(FIXTURES.repair.notes);
  });

  test("a target that cannot be repaired keeps its error and gains a repair warning", async () => {
    const script = [
      ...planScript(),
      ...FIXTURES.planSkeleton.outline
        .slice(PLANNED_SLIDES)
        .map((e) => json(FIXTURES.slides[e.kind])),
      json(FIXTURES.worksheet),
    ];
    const setupDeps = recordingDeps(createFakeAi({ script: routed(script), usage }));
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

describe("specFieldsOf (TEACH-222)", () => {
  test("covers every generatable kind's text: nothing slideText shows is missing from the fields, and captions are excluded", async () => {
    const setupDeps = recordingDeps(
      createFakeAi({
        script: routed([
          ...planScript(),
          ...FIXTURES.planSkeleton.outline
            .slice(PLANNED_SLIDES)
            .map((e) => json(FIXTURES.slides[e.kind])),
          json(FIXTURES.worksheet),
        ]),
        usage,
      }),
    );
    const generated = await generate(await plan(initialState(), setupDeps), setupDeps);
    for (const slide of generated.lesson.slides) {
      expect({ kind: slide.kind, covered: specFieldsCover(slide) }).toEqual({
        kind: slide.kind,
        covered: true,
      });
      const fields = specFieldsOf(slide);
      expect(fields.map((f) => f.text)).not.toContain("KEY IDEA");
      expect(fields.map((f) => f.text)).not.toContain("QUESTION");
    }
  });

  test("a slide whose text the projection cannot label is not covered, so Repair shows the flat text", () => {
    const slide = generatedLesson().slides[0];
    if (!slide) throw new Error("fixture");
    // A text element with no preset is still shown, labelled "text", so it is covered…
    const noPreset = {
      ...slide,
      elements: slide.elements.map((e) =>
        e.type === "text" ? { ...e, style: { ...e.style, preset: undefined } } : e,
      ),
    } as typeof slide;
    expect(specFieldsCover(noPreset)).toBe(true);
    expect(specFieldsOf(noPreset).some((f) => f.field === "text")).toBe(true);
    // …but a table slideText renders that the projection did not would not be: prove the guard
    // reads slideText by adding text only slideText sees (a fill-gap answer line is filtered, a
    // caption is filtered; an unknown element carrying a doc is not).
    const odd = {
      ...slide,
      elements: [
        ...slide.elements,
        {
          id: "x",
          type: "sticker",
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          doc: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Only slideText sees me" }] },
            ],
          },
        },
      ],
    } as unknown as typeof slide;
    expect(specFieldsCover(odd)).toBe(false);
  });
});
