import { describe, expect, test } from "bun:test";
import { JOB_PROGRESS_STAGES } from "@tj/domain";
import type { Lesson } from "@tj/domain/documents";
import romans from "../fixtures/objective-facts.y4-history-romans.json";
import { planObjectivesPrompt } from "../prompts/plan-objectives";
import { labAi, memoryLogger, recordingDeps, romansLesson, versionsOf } from "../testing";
import { StageFailure } from "../types";
import { runLessonPipeline } from "../workflow";
import { ObjectivesBlocked } from "./objectives";
import {
  isObjectivesFirstStamp,
  OBJECTIVES_FIRST_VERSION,
  PLANNED_VERSION,
  plannerFor,
  plannerOf,
  resumeFromObjectivesFirst,
} from "./objectives-first";

/*
 * TEACH-93: the objectives-first planner as the production workflow runs it — the objectives step
 * in the plan job (stopping at the plan screen), the facts step and the stages in the generate
 * job, which the lesson's stamp (not the flag) picks.
 */

const BAD = [{ text: "Understand the Romans" }, { text: "Explain Boudica's revolt" }];

/** The row after the plan job: objectives only. */
async function plannedRow(): Promise<Lesson> {
  const deps = recordingDeps(labAi());
  const final = await runLessonPipeline({ lesson: romansLesson() }, deps, {
    stopAfter: "planned",
    planner: "objectives-first",
  });
  return final.lesson;
}

function confirmed(lesson: Lesson, patch: Partial<Lesson> = {}): Lesson {
  return {
    ...lesson,
    plan: { revision: 1, state: "confirmed", confirmedAt: "2026-09-26T10:00:00.000Z" },
    ...patch,
  } as Lesson;
}

const summaryOf = (lines: string[]) =>
  lines.map((l) => JSON.parse(l)).find((r) => r.msg === "generation summary")?.generation;

describe("which planner and where a lesson resumes", () => {
  const at = (stage: string | undefined, planned: string | undefined, outline = 0): Lesson =>
    ({
      ...romansLesson(),
      facts: {
        objectives: [{ id: "o1", text: "Describe the Roman invasion" }],
        misconceptions: [],
        vocabulary: [],
        workedExamples: [],
        questions: [],
        outline: Array.from({ length: outline }, (_, i) => ({
          kind: i === 0 ? "title" : "content",
          factRefs: [],
        })),
      },
      ...(stage
        ? {
            generation: {
              jobId: "j",
              stage,
              startedAt: "2026-09-26T10:00:00.000Z",
              promptVersions: planned === undefined ? {} : { planned },
              findings: [],
            },
          }
        : {}),
    }) as unknown as Lesson;

  test("plannerOf reads the stamp: legacy, objectives only, outlined, verified", () => {
    expect(plannerOf(romansLesson())).toBe("legacy");
    expect(plannerOf(at("planned", "plan-skeleton.v9+plan-facts.v9", 4))).toBe("legacy");
    expect(plannerOf(at("planned", OBJECTIVES_FIRST_VERSION))).toBe("objectives-first");
    expect(plannerOf(at("planned", PLANNED_VERSION, 4))).toBe("objectives-first");
    expect(plannerOf(at("generated", `${PLANNED_VERSION}+verify-facts.v3`, 4))).toBe(
      "objectives-first",
    );
    expect(isObjectivesFirstStamp(`x+${OBJECTIVES_FIRST_VERSION}`)).toBe(false);
  });

  test("plannerFor: a stamped lesson keeps its planner; an unstamped one takes the flag", () => {
    expect(plannerFor(romansLesson(), "objectives-first")).toBe("objectives-first");
    expect(plannerFor(romansLesson(), undefined)).toBe("legacy");
    expect(plannerFor(at("planned", "plan-skeleton.v9+plan-facts.v9", 4), "objectives-first")).toBe(
      "legacy",
    );
    expect(plannerFor(at("planned", OBJECTIVES_FIRST_VERSION), "legacy")).toBe("objectives-first");
  });

  test("resumeFromObjectivesFirst", () => {
    expect(resumeFromObjectivesFirst(romansLesson())).toBe("check-input");
    expect(resumeFromObjectivesFirst(at("planned", OBJECTIVES_FIRST_VERSION))).toBe("facts");
    expect(resumeFromObjectivesFirst(at("planned", PLANNED_VERSION, 4))).toBe("generate");
    expect(resumeFromObjectivesFirst(at("generated", PLANNED_VERSION, 4))).toBe("illustrate");
    expect(resumeFromObjectivesFirst(at("evaluated", PLANNED_VERSION, 4))).toBe("repair");
    expect(resumeFromObjectivesFirst(at("repaired", PLANNED_VERSION, 4))).toBeNull();
    // A planned row with no outline and another stamp is stale: start over.
    expect(resumeFromObjectivesFirst(at("planned", PLANNED_VERSION))).toBe("check-input");
  });
});

describe("the plan job's run (flag on, stopAfter planned)", () => {
  test("check-input and the objectives call only; one persist of title and objectives; the plan screen's checkpoint", async () => {
    const ai = labAi();
    const { lines, logger } = memoryLogger();
    const deps = { ...recordingDeps(ai, { logger }) };
    const final = await runLessonPipeline({ lesson: romansLesson() }, deps, {
      stopAfter: "planned",
      planner: "objectives-first",
    });
    expect(versionsOf(ai)).toEqual(["check-input", "plan-objectives"]);
    expect(deps.persisted).toHaveLength(1);
    const row = deps.persisted[0]?.lesson;
    expect(row?.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(row?.facts?.objectives.map((o) => o.text)).toEqual(romans.objectives.map((o) => o.text));
    expect(row?.facts?.outline).toEqual([]);
    expect(row?.generation?.stage).toBe("planned");
    expect(row?.generation?.promptVersions.planned).toBe(planObjectivesPrompt.version);
    expect(final.lesson).toEqual(row as Lesson);
    expect(deps.progress).toEqual([
      { percent: 2, message: "Starting", stage: "plan", documentUpdatedAt: undefined },
      {
        percent: 10,
        message: "Planned",
        stage: "plan",
        documentUpdatedAt: deps.persisted[0]?.updatedAt,
      },
    ]);
    const summary = summaryOf(lines);
    expect(summary.planner).toBe("objectives-first");
    expect(summary.stages).toEqual(["check-input", "objectives"]);
  });

  test("objectives that fail the check twice: a StageFailure (objectives-check), nothing persisted, no facts call", async () => {
    const ai = labAi({ objectives: BAD });
    const deps = recordingDeps(ai);
    let failure: unknown;
    try {
      await runLessonPipeline({ lesson: romansLesson() }, deps, {
        stopAfter: "planned",
        planner: "objectives-first",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(StageFailure);
    expect(failure).toBeInstanceOf(ObjectivesBlocked);
    expect((failure as StageFailure).reason).toBe("objectives-check");
    // The message is fixed: it never quotes what the model wrote.
    expect((failure as Error).message).not.toContain("nderstand");
    expect(versionsOf(ai)).toEqual(["check-input", "plan-objectives", "plan-objectives"]);
    expect(deps.persisted).toHaveLength(0);
  });

  test("a set that fails once is asked for again and the second is used", async () => {
    const ai = labAi({ objectivesAt: (n) => (n === 1 ? BAD : romans.objectives) });
    const deps = recordingDeps(ai);
    const final = await runLessonPipeline({ lesson: romansLesson() }, deps, {
      stopAfter: "planned",
      planner: "objectives-first",
    });
    expect(versionsOf(ai)).toEqual(["check-input", "plan-objectives", "plan-objectives"]);
    expect(final.lesson.facts?.objectives.map((o) => o.text)).toEqual(
      romans.objectives.map((o) => o.text),
    );
  });

  test("flag off: the same brief plans on the legacy planner", async () => {
    const ai = labAi();
    const deps = recordingDeps(ai);
    await runLessonPipeline({ lesson: romansLesson() }, deps, { stopAfter: "planned" }).catch(
      () => undefined,
    );
    expect(versionsOf(ai)).not.toContain("plan-objectives");
    expect(versionsOf(ai)).toContain("plan-skeleton");
  });
});

describe("the generate job's run from the confirmed objectives (the stamp decides)", () => {
  test("the facts step reads the edited objectives; outline persisted, then one persist per slide, repaired; the FR5 event sequence", async () => {
    const planned = await plannedRow();
    const edited = planned.facts?.objectives.map((o, i) =>
      i === 0 ? { ...o, text: `${o.text} in AD 43` } : o,
    );
    const lesson = confirmed(planned, {
      facts: { ...(planned.facts as NonNullable<Lesson["facts"]>), objectives: edited ?? [] },
    });
    const ai = labAi();
    const { lines, logger } = memoryLogger();
    const deps = recordingDeps(ai, { logger });
    // No planner option: a generate job passes none, and the stamp picks the path.
    const final = await runLessonPipeline({ lesson }, deps);

    expect(versionsOf(ai)).not.toContain("check-input");
    expect(versionsOf(ai)).not.toContain("plan-objectives");
    const teach = ai.calls.filter((c) =>
      (c.context?.promptVersion ?? "").startsWith("plan-teach-objective"),
    );
    expect(teach).toHaveLength(romans.objectives.length);
    expect(
      teach.every((c) => c.promptText.includes(`${romans.objectives[0]?.text} in AD 43`)),
    ).toBe(true);

    const outlined = deps.persisted[0]?.lesson;
    expect(outlined?.facts?.outline.length).toBeGreaterThan(2);
    expect(outlined?.generation?.promptVersions.planned).toBe(PLANNED_VERSION);
    expect(outlined?.slides[1]?.kind).toBe("objectives");
    expect(outlined?.slides[1]?.id).toBe(planned.slides[1]?.id as string);
    expect(outlined?.facts?.objectives.map((o) => o.id)).toEqual(
      planned.facts?.objectives.map((o) => o.id),
    );
    expect(final.lesson.generation?.stage).toBe("repaired");
    expect(final.lesson.slides[1]?.id).toBe(planned.slides[1]?.id as string);

    // FR5: stages stay inside JOB_PROGRESS_STAGES; the planner's events are "plan".
    const stages = new Set(deps.progress.map((p) => p.stage));
    for (const s of stages) expect(JOB_PROGRESS_STAGES as readonly string[]).toContain(s);
    const n = (outlined?.facts?.outline.length ?? 0) - 2;
    const head = deps.progress.slice(0, 2).map((p) => [p.percent, p.message, p.stage]);
    expect(head).toEqual([
      [10, "Planning the slides", "plan"],
      [10, "Planned", "plan"],
    ]);
    const slideEvents = deps.progress.filter((p) => /^Slide \d+ of \d+$/.test(p.message));
    expect(slideEvents).toHaveLength(n);
    // Generate numbers the slides across the whole deck, title and objectives included.
    const deck = outlined?.facts?.outline.length ?? 0;
    expect(slideEvents.at(-1)?.message).toBe(`Slide ${deck} of ${deck}`);
    const tail = deps.progress
      .filter((p) => !/^Slide /.test(p.message))
      .slice(2)
      .map((p) => [p.percent, p.message, p.stage]);
    expect(tail).toEqual([
      [11, "Checking the facts", "generate"],
      [80, "Slides ready", "generate"],
      // No image placer in this run, so Illustrate places nothing and says nothing.
      [90, "Reviewed", "evaluate"],
      [100, "Done", "repair"],
    ]);
    // Every event that names a document version follows the persist that wrote it.
    const written = new Set(deps.persisted.map((p) => p.updatedAt));
    for (const p of deps.progress) {
      if (p.documentUpdatedAt !== undefined) expect(written.has(p.documentUpdatedAt)).toBe(true);
    }

    const summary = summaryOf(lines);
    expect(summary.planner).toBe("objectives-first");
    expect(summary.stages).toEqual(["facts", "generate", "illustrate", "evaluate", "repair"]);
    expect(typeof summary.readableMs).toBe("number");
    expect(typeof summary.checkedMs).toBe("number");
    expect(summary.readableMs).toBeLessThanOrEqual(summary.checkedMs);
  });

  test("a finished lesson above AI_LESSON_COST_WARN_USD logs one warn line; the run completes", async () => {
    const lesson = confirmed(await plannedRow());
    const { lines, logger } = memoryLogger();
    const deps = { ...recordingDeps(labAi(), { logger }), costWarnUsd: 0 };
    const final = await runLessonPipeline({ lesson }, deps);
    expect(final.lesson.generation?.stage).toBe("repaired");
    const warns = lines
      .map((l) => JSON.parse(l))
      .filter((r) => r.msg === "lesson cost above target");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ planner: "objectives-first" });
    expect(typeof warns[0].costUsd).toBe("number");
  });

  test("a facts step that fails leaves the objectives checkpoint; the retry resumes at facts with no objectives call", async () => {
    const lesson = confirmed(await plannedRow());
    const failing = recordingDeps(
      labAi({
        teach: () => {
          throw new Error("provider down");
        },
      }),
    );
    await expect(runLessonPipeline({ lesson }, failing)).rejects.toBeInstanceOf(StageFailure);
    expect(failing.persisted).toHaveLength(0);
    expect(resumeFromObjectivesFirst(lesson)).toBe("facts");
    const ai = labAi();
    const final = await runLessonPipeline({ lesson }, recordingDeps(ai));
    expect(versionsOf(ai)).not.toContain("plan-objectives");
    expect(final.lesson.generation?.stage).toBe("repaired");
  });

  test("skip planning (no stopAfter, flag on): objectives, facts and the stages in one run; two planned stamps", async () => {
    const ai = labAi();
    const deps = recordingDeps(ai);
    const final = await runLessonPipeline({ lesson: romansLesson() }, deps, {
      planner: "objectives-first",
    });
    const stamps = deps.persisted
      .filter((p) => p.lesson.generation?.stage === "planned")
      .map((p) => p.lesson.generation?.promptVersions.planned);
    // Generate's per-slide persists keep `planned` (with Verify's version appended) until its end.
    expect([...new Set(stamps)].slice(0, 2)).toEqual([OBJECTIVES_FIRST_VERSION, PLANNED_VERSION]);
    expect(final.lesson.generation?.stage).toBe("repaired");
  });

  test("a pinned re-plan (shape change after confirm): no objectives call, the teacher's ids and text kept, the outline fits the new count", async () => {
    const base = romansLesson();
    const objectives = romans.objectives.map((o, i) => ({ id: `o${i * 2 + 1}`, text: o.text }));
    const lesson = confirmed(base, {
      brief: { ...(base.brief as NonNullable<Lesson["brief"]>), slideCount: 10 },
      facts: {
        durationMin: 60,
        objectives,
        misconceptions: [],
        vocabulary: [],
        workedExamples: [],
        questions: [],
        outline: [],
      },
    });
    const ai = labAi();
    const deps = recordingDeps(ai);
    const final = await runLessonPipeline({ lesson, pinObjectives: true }, deps, {
      planner: "objectives-first",
    });
    expect(versionsOf(ai)).not.toContain("plan-objectives");
    expect(final.lesson.facts?.objectives).toEqual(objectives);
    expect(final.lesson.facts?.outline).toHaveLength(10);
    expect(final.lesson.generation?.stage).toBe("repaired");
  });
});
