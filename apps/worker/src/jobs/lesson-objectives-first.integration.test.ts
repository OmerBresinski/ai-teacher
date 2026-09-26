/**
 * Integration (TEACH-93): `AI_LESSON_PLANNER=objectives-first` through the two lesson jobs against
 * the compose Postgres, with a fake answering by prompt version. The plan job stops at the
 * objectives; the generate job runs the facts step from the confirmed (edited) objectives; the
 * lesson's stamp, not the flag, picks the generate path. Skips visibly without a database.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createFakeAi } from "@tj/ai/testing";
import { createDocument, forWorkspace, getDocument, setPlanRevisionAndLock } from "@tj/db";
import { createTestUserWithWorkspace, withTestDb } from "@tj/db/testing";
import {
  JOB_PROGRESS_STAGES,
  type JobId,
  type LessonId,
  type LessonPlanPayload,
  newId,
  type WorkspaceId,
} from "@tj/domain";
import {
  applyObjectiveEdits,
  type Lesson,
  lessonFromBrief,
  parseLesson,
} from "@tj/domain/documents";
import { OBJECTIVES_FIRST_VERSION, PLANNED_VERSION, type Planner, plannerOf } from "@tj/generation";
import {
  labAi,
  pipelineScript,
  romansLesson,
  routed,
  SLIDES_INDEX,
  scriptedPipelineAi,
  versionsOf,
} from "@tj/generation/testing";
import { NonRetryableError } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { memoryStorage } from "../testing/memory-storage";
import { lessonGenerateJob } from "./lesson-generate";
import { lessonPlanJob } from "./lesson-plan";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping objectives-first job tests: ${t.reason}`);

type Progress = { percent?: number; message?: string; stage?: string; updatedAt?: string };

describeDb("objectives-first planner through the lesson jobs (TEACH-93)", () => {
  if (!t.ok) return;
  const { unsafeDb, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const quiet = pino({ level: "silent" });
  const depsWith = (ai: WorkerDeps["ai"], planner?: Planner): WorkerDeps => ({
    ai,
    db: unsafeDb,
    caps: { capUsd: 5, capTokens: 5_000_000 },
    worksheetCapUsd: 0.1,
    storage: memoryStorage(),
    ...(planner ? { planner } : {}),
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  function ctxFor<K extends "lesson.plan" | "lesson.generate">(
    jobId: JobId,
    payload: K extends "lesson.plan" ? LessonPlanPayload : { lessonId: LessonId; revision: number },
    deps: WorkerDeps,
  ) {
    const progress: Progress[] = [];
    return {
      progress,
      ctx: {
        jobId,
        workspaceId,
        payload,
        signal: new AbortController().signal,
        progress: async (
          percent?: number,
          message?: string,
          extra?: { stage?: string; documentUpdatedAt?: string },
        ) => {
          progress.push({
            percent,
            message,
            stage: extra?.stage,
            updatedAt: extra?.documentUpdatedAt,
          });
        },
        logger: quiet,
        deps,
      },
    };
  }

  async function newLesson(
    patch: Partial<Lesson> = {},
  ): Promise<{ lessonId: LessonId; jobId: JobId }> {
    const jobId = newId<JobId>();
    const lessonId = newId<LessonId>();
    const lesson: Lesson = {
      ...romansLesson(),
      id: lessonId,
      plan: { revision: 1, state: "proposed", jobId },
      ...patch,
    } as Lesson;
    await createDocument(ws(), "lesson", lesson, { id: lessonId, generatingJobId: jobId });
    return { lessonId, jobId };
  }

  async function row(lessonId: LessonId) {
    const stored = await getDocument(ws(), lessonId);
    return { lock: stored?.generatingJobId ?? null, lesson: parseLesson(stored?.body) };
  }

  /** `POST /lessons/:id/generate` with a text-only edit of the first objective. */
  async function confirm(lessonId: LessonId) {
    const jobId = newId<JobId>();
    const result = await setPlanRevisionAndLock(ws(), lessonId, {
      expectedRevision: 1,
      jobId,
      patch: (lesson) => {
        const facts = lesson.facts;
        if (!facts) throw new Error("no facts");
        const edited = applyObjectiveEdits(
          facts,
          facts.objectives.map((o, i) => ({
            id: o.id,
            text: i === 0 ? `${o.text} in AD 43` : o.text,
          })),
        );
        return {
          ...lesson,
          facts: edited.facts,
          plan: { revision: 1, state: "confirmed", jobId, confirmedAt: new Date().toISOString() },
        };
      },
    });
    expect(result.status).toBe("ok");
    return jobId;
  }

  /** `POST /lessons/:id/generate` with the objectives unchanged. */
  async function confirmAsIs(lessonId: LessonId) {
    const jobId = newId<JobId>();
    const result = await setPlanRevisionAndLock(ws(), lessonId, {
      expectedRevision: 1,
      jobId,
      patch: (lesson) => ({
        ...lesson,
        plan: { revision: 1, state: "confirmed", jobId, confirmedAt: new Date().toISOString() },
      }),
    });
    expect(result.status).toBe("ok");
    return jobId;
  }

  test("flag on: the plan job makes the input check and the objectives call, persists title and objectives once, and releases the lock", async () => {
    const { lessonId, jobId } = await newLesson();
    const ai = labAi();
    const h = ctxFor<"lesson.plan">(
      jobId,
      { lessonId, revision: 1, stopAfter: "planned" },
      depsWith(ai, "objectives-first"),
    );
    await lessonPlanJob(h.ctx);

    expect(versionsOf(ai)).toEqual(["check-input", "plan-objectives"]);
    const { lock, lesson } = await row(lessonId);
    expect(lock).toBeNull();
    expect(lesson.slides.map((s) => s.kind)).toEqual(["title", "objectives"]);
    expect(lesson.facts?.outline).toEqual([]);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.generation?.promptVersions.planned).toBe(OBJECTIVES_FIRST_VERSION);
    expect(
      h.progress.map((p) => [p.percent, p.message, p.stage, p.updatedAt !== undefined]),
    ).toEqual([
      [2, "Starting", "plan", false],
      [10, "Planned", "plan", true],
    ]);
  });

  test("objectives that fail the check twice: a retryable failure, nothing persisted, the lock kept for the retry", async () => {
    const { lessonId, jobId } = await newLesson();
    const ai = labAi({
      objectives: [{ text: "Understand the Romans" }, { text: "Explain Boudica" }],
    });
    const h = ctxFor<"lesson.plan">(
      jobId,
      { lessonId, revision: 1, stopAfter: "planned" },
      depsWith(ai, "objectives-first"),
    );
    const failure = await lessonPlanJob(h.ctx).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(NonRetryableError);
    expect((failure as { reason?: string }).reason).toBe("objectives-check");
    expect(versionsOf(ai)).toEqual(["check-input", "plan-objectives", "plan-objectives"]);
    const { lock, lesson } = await row(lessonId);
    expect(lock).toBe(jobId);
    expect(lesson.slides).toEqual([]);
    expect(lesson.generation).toBeUndefined();
  });

  for (const flag of ["objectives-first", undefined] as const) {
    test(`generate job (flag ${flag ?? "off"}): the stamp decides; the facts step reads the edited objective, then slides, evaluate, repair`, async () => {
      const { lessonId, jobId } = await newLesson();
      await lessonPlanJob(
        ctxFor<"lesson.plan">(
          jobId,
          { lessonId, revision: 1, stopAfter: "planned" },
          depsWith(labAi(), "objectives-first"),
        ).ctx,
      );
      const planned = (await row(lessonId)).lesson;
      const generateJobId = await confirm(lessonId);
      const ai = labAi();
      const h = ctxFor<"lesson.generate">(
        generateJobId,
        { lessonId, revision: 1 },
        depsWith(ai, flag),
      );
      await lessonGenerateJob(h.ctx);

      const { lock, lesson } = await row(lessonId);
      expect(lock).toBeNull();
      expect(versionsOf(ai)).not.toContain("plan-objectives");
      const teach = ai.calls.filter((c) => c.context?.promptVersion?.startsWith("plan-teach"));
      expect(teach.length).toBeGreaterThan(0);
      for (const c of teach) expect(c.promptText).toContain(" in AD 43");
      expect(lesson.generation?.stage).toBe("repaired");
      expect(plannerOf(lesson)).toBe("objectives-first");
      expect(lesson.generation?.promptVersions.planned?.startsWith(PLANNED_VERSION)).toBe(true);
      expect(lesson.slides).toHaveLength(lesson.facts?.outline.length ?? -1);
      expect(lesson.slides[1]?.id).toBe(planned.slides[1]?.id as string);
      expect(lesson.facts?.objectives[0]?.text).toContain(" in AD 43");
      for (const { stage } of h.progress) expect(JOB_PROGRESS_STAGES).toContain(stage as never);
      expect(h.progress.slice(0, 2).map((p) => p.message)).toEqual([
        "Planning the slides",
        "Planned",
      ]);
      expect(h.progress.at(-1)).toMatchObject({ percent: 100, message: "Done", stage: "repair" });
    });
  }

  test("a legacy-planned lesson generates on the legacy path with the flag on", async () => {
    const planJobId = newId<JobId>();
    const lessonId = newId<LessonId>();
    const lesson: Lesson = {
      ...lessonFromBrief(
        { brief: { topic: "States of matter" }, subject: "Science", yearGroup: "Year 8" },
        lessonId,
        new Date("2026-09-06T10:00:00.000Z"),
      ),
      plan: { revision: 1, state: "proposed", jobId: planJobId },
    };
    await createDocument(ws(), "lesson", lesson, { id: lessonId, generatingJobId: planJobId });
    await lessonPlanJob(
      ctxFor<"lesson.plan">(
        planJobId,
        { lessonId, revision: 1, stopAfter: "planned" },
        depsWith(scriptedPipelineAi()),
      ).ctx,
    );
    expect(plannerOf((await row(lessonId)).lesson)).toBe("legacy");
    const generateJobId = await confirmAsIs(lessonId);
    const ai = createFakeAi({
      script: routed(pipelineScript().slice(SLIDES_INDEX)),
      usage: { inputTokens: 1000, outputTokens: 400 },
    });
    await lessonGenerateJob(
      ctxFor<"lesson.generate">(
        generateJobId,
        { lessonId, revision: 1 },
        depsWith(ai, "objectives-first"),
      ).ctx,
    );
    const done = (await row(lessonId)).lesson;
    expect(done.generation?.stage).toBe("repaired");
    expect(plannerOf(done)).toBe("legacy");
    expect(ai.calls.some((c) => c.context?.stage === "plan")).toBe(false);
  });

  test("skip planning (flag on, no stopAfter): objectives, facts and the stages in one job", async () => {
    const { lessonId, jobId } = await newLesson({
      plan: {
        revision: 1,
        state: "confirmed",
        jobId: newId<JobId>(),
        confirmedAt: "2026-09-26T10:00:00.000Z",
      },
    } as Partial<Lesson>);
    const ai = labAi();
    await lessonPlanJob(
      ctxFor<"lesson.plan">(jobId, { lessonId, revision: 1 }, depsWith(ai, "objectives-first")).ctx,
    );
    const { lock, lesson } = await row(lessonId);
    expect(lock).toBeNull();
    expect(lesson.generation?.stage).toBe("repaired");
    expect(versionsOf(ai).filter((v) => v === "plan-objectives")).toHaveLength(1);
    expect(versionsOf(ai)).toContain("plan-teach-objective");
  });

  test("pinned re-plan after a shape change (flag on): no objectives call, the teacher's ids kept", async () => {
    const base = romansLesson();
    const objectives = [
      { id: "o1", text: "Describe why the Romans invaded Britain" },
      { id: "o3", text: "Explain how Boudica's revolt was defeated" },
    ];
    const { lessonId, jobId } = await newLesson({
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
      plan: {
        revision: 1,
        state: "confirmed",
        jobId: newId<JobId>(),
        confirmedAt: "2026-09-26T10:00:00.000Z",
      },
    } as Partial<Lesson>);
    const ai = labAi();
    await lessonPlanJob(
      ctxFor<"lesson.plan">(
        jobId,
        { lessonId, revision: 1, pinObjectives: true },
        depsWith(ai, "objectives-first"),
      ).ctx,
    );
    const { lesson } = await row(lessonId);
    expect(versionsOf(ai)).not.toContain("plan-objectives");
    expect(lesson.facts?.objectives).toEqual(objectives);
    expect(lesson.facts?.outline).toHaveLength(10);
    expect(lesson.generation?.stage).toBe("repaired");
  });
});
