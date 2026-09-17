/**
 * Integration: `lesson.generate` against the compose Postgres (ADR 0014), with the scripted fake
 * provider. A real `lesson.plan` run with `stopAfter: "planned"` writes the checkpoint; the test
 * then confirms the plan the way `POST /lessons/:id/generate` does (compare-and-set, lock to the
 * generate job) and runs the handler directly. Skips visibly when the database is unreachable.
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
import {
  FIXTURES,
  pipelineScript,
  routed,
  SLIDES_INDEX,
  scriptedPipelineAi,
} from "@tj/generation/testing";
import { NonRetryableError, type ProgressExtra } from "@tj/jobs";
import pino from "pino";
import type { WorkerDeps } from "../deps";
import { memoryStorage } from "../testing/memory-storage";
import { lessonGenerateJob } from "./lesson-generate";
import { lessonPlanJob } from "./lesson-plan";

const t = await withTestDb();
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping lesson.generate tests: ${t.reason}`);

describeDb("lesson.generate job", () => {
  if (!t.ok) return;
  const { unsafeDb, sql, truncateTenantTables, close } = t.db;
  afterAll(() => close());

  const workspaceId = newId<WorkspaceId>();
  const ws = () => forWorkspace(unsafeDb, workspaceId);
  const quiet = pino({ level: "silent" });
  const depsWith = (ai: WorkerDeps["ai"]): WorkerDeps => ({
    ai,
    db: unsafeDb,
    caps: { capUsd: 5, capTokens: 1_000_000 },
    worksheetCapUsd: 0.1,
    storage: memoryStorage(),
  });

  beforeEach(async () => {
    await truncateTenantTables();
    await createTestUserWithWorkspace(unsafeDb, { workspaceId });
  });

  function ctxFor<K extends "lesson.plan" | "lesson.generate">(
    jobId: JobId,
    payload: K extends "lesson.plan" ? LessonPlanPayload : { lessonId: LessonId; revision: number },
    deps: WorkerDeps,
    ac = new AbortController(),
  ) {
    const progress: ProgressExtra[] = [];
    return {
      progress,
      ctx: {
        jobId,
        workspaceId,
        payload,
        signal: ac.signal,
        progress: async (_percent?: number, _message?: string, extra?: ProgressExtra) => {
          progress.push(extra ?? {});
        },
        logger: quiet,
        deps,
      },
    };
  }

  /** A lesson the plan job left at `planned` (revision 1, proposed, unlocked). */
  async function plannedLesson(): Promise<LessonId> {
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
    const row = await getDocument(ws(), lessonId);
    expect(row?.generatingJobId).toBeNull();
    expect(parseLesson(row?.body).generation?.stage).toBe("planned");
    return lessonId;
  }

  /** `POST /lessons/:id/generate` with a text-only edit of the first objective. */
  async function confirm(lessonId: LessonId, state: "confirmed" | "proposed" = "confirmed") {
    const jobId = newId<JobId>();
    const result = await setPlanRevisionAndLock(ws(), lessonId, {
      expectedRevision: 1,
      jobId,
      patch: (lesson) => {
        const facts = lesson.facts;
        if (!facts) throw new Error("no facts");
        const edits = facts.objectives.map((o, i) => ({
          id: o.id,
          text: i === 0 ? "Explain particle spacing in all three states" : o.text,
        }));
        const edited = applyObjectiveEdits(facts, edits);
        expect(edited.shapeChanged).toBe(false);
        return {
          ...lesson,
          facts: edited.facts,
          plan: { revision: 1, state, jobId, confirmedAt: new Date().toISOString() },
        };
      },
    });
    expect(result.status).toBe("ok");
    return jobId;
  }

  /** The fake for everything after `planned`: slides, then evaluate. No Verify answer. */
  const afterPlanned = () =>
    createFakeAi({
      script: routed(pipelineScript().slice(SLIDES_INDEX)),
      usage: { inputTokens: 1000, outputTokens: 400 },
    });

  test("generates the slides from the confirmed plan: no Verify, no worksheet, completedAt set", async () => {
    const lessonId = await plannedLesson();
    const planned = parseLesson((await getDocument(ws(), lessonId))?.body);
    const objectivesSlide = planned.slides[1];
    const jobId = await confirm(lessonId);
    const ai = afterPlanned();
    const h = ctxFor<"lesson.generate">(jobId, { lessonId, revision: 1 }, depsWith(ai));

    await lessonGenerateJob(h.ctx);

    const row = await getDocument(ws(), lessonId);
    expect(row?.generatingJobId).toBeNull();
    const lesson = parseLesson(row?.body);
    expect(lesson.generation?.stage).toBe("repaired");
    expect(lesson.generation?.completedAt).toBeDefined();
    expect(lesson.slides).toHaveLength(lesson.facts?.outline.length ?? -1);
    // Verify ran inside the plan job; the generate job never calls it.
    expect(ai.calls.some((c) => c.context?.promptVersion?.startsWith("verify-facts"))).toBe(false);
    expect(ai.calls.some((c) => c.context?.stage === "plan")).toBe(false);
    // Slides only (ADR 0030 item 2).
    expect(lesson.artefacts).toBeUndefined();
    expect(await sql`select id from documents where kind = 'worksheet'`).toHaveLength(0);
    // The objectives slide was rebuilt from the edited facts, in place.
    const slide = lesson.slides[1];
    expect(slide?.id).toBe(objectivesSlide?.id);
    expect(JSON.stringify(slide)).toContain("xplain particle spacing in all three states");
    expect(lesson.plan).toMatchObject({ revision: 1, state: "confirmed", jobId });
    // Every progress event names a valid stage, none of them Plan's.
    expect(h.progress.length).toBeGreaterThan(0);
    for (const { stage } of h.progress) {
      expect(JOB_PROGRESS_STAGES).toContain(stage as never);
      expect(stage).not.toBe("plan");
    }
  });

  test("the first persist already carries the re-materialised objectives slide", async () => {
    const lessonId = await plannedLesson();
    const jobId = await confirm(lessonId);
    // Cancel as the last slide call answers: the slides before it are persisted, the
    // `generated` checkpoint is not.
    const ac = new AbortController();
    const script = routed(pipelineScript().slice(SLIDES_INDEX));
    const last = FIXTURES.planSkeleton.outline.length - 3;
    const entry = script[last];
    script[last] = async (call) => {
      ac.abort("cancelled");
      return typeof entry === "function" ? entry(call) : (entry as string);
    };
    const ai = createFakeAi({ script });

    await lessonGenerateJob(
      ctxFor<"lesson.generate">(jobId, { lessonId, revision: 1 }, depsWith(ai), ac).ctx,
    );

    const lesson = parseLesson((await getDocument(ws(), lessonId))?.body);
    expect(lesson.generation?.stage).toBe("planned");
    expect(lesson.slides.length).toBeGreaterThan(2);
    expect(JSON.stringify(lesson.slides[1])).toContain(
      "xplain particle spacing in all three states",
    );
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a plan that is still proposed is refused without retry; the lock is released", async () => {
    const lessonId = await plannedLesson();
    const jobId = await confirm(lessonId, "proposed");
    const before = await getDocument(ws(), lessonId);
    const ai = afterPlanned();

    await expect(
      lessonGenerateJob(
        ctxFor<"lesson.generate">(jobId, { lessonId, revision: 1 }, depsWith(ai)).ctx,
      ),
    ).rejects.toThrow(new NonRetryableError("plan not confirmed"));

    expect(ai.calls).toHaveLength(0);
    const after = await getDocument(ws(), lessonId);
    expect(after?.generatingJobId).toBeNull();
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });

  test("another revision is refused: revision moved", async () => {
    const lessonId = await plannedLesson();
    const jobId = await confirm(lessonId);
    const ai = afterPlanned();

    await expect(
      lessonGenerateJob(
        ctxFor<"lesson.generate">(jobId, { lessonId, revision: 2 }, depsWith(ai)).ctx,
      ),
    ).rejects.toThrow(new NonRetryableError("revision moved"));
    expect(ai.calls).toHaveLength(0);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a confirmed lesson without a planned checkpoint is refused: it would re-run Plan", async () => {
    const jobId = newId<JobId>();
    const lessonId = newId<LessonId>();
    const lesson: Lesson = {
      ...lessonFromBrief({ brief: { topic: "Volcanoes" } }, lessonId, new Date()),
      plan: { revision: 1, state: "confirmed", jobId },
    };
    await createDocument(ws(), "lesson", lesson, { id: lessonId, generatingJobId: jobId });
    const ai = afterPlanned();

    await expect(
      lessonGenerateJob(
        ctxFor<"lesson.generate">(jobId, { lessonId, revision: 1 }, depsWith(ai)).ctx,
      ),
    ).rejects.toThrow(new NonRetryableError("lesson is not planned"));
    expect(ai.calls).toHaveLength(0);
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBeNull();
  });

  test("a row locked by another job is refused and left locked", async () => {
    const lessonId = await plannedLesson();
    const holder = await confirm(lessonId);
    const ai = afterPlanned();

    await expect(
      lessonGenerateJob(
        ctxFor<"lesson.generate">(newId<JobId>(), { lessonId, revision: 1 }, depsWith(ai)).ctx,
      ),
    ).rejects.toThrow(new NonRetryableError("lock lost"));
    expect((await getDocument(ws(), lessonId))?.generatingJobId).toBe(holder);
  });

  test("a failed Evaluate keeps the lock; the retry resumes after generated", async () => {
    const lessonId = await plannedLesson();
    const jobId = await confirm(lessonId);
    const slides = pipelineScript().slice(SLIDES_INDEX);
    const evaluateAt = slides.length - 1;
    slides[evaluateAt] = () => {
      throw new Error("provider unreachable");
    };
    const first = createFakeAi({ script: routed(slides) });
    await expect(
      lessonGenerateJob(
        ctxFor<"lesson.generate">(jobId, { lessonId, revision: 1 }, depsWith(first)).ctx,
      ),
    ).rejects.toThrow();
    const mid = await getDocument(ws(), lessonId);
    expect(parseLesson(mid?.body).generation?.stage).toBe("generated");
    expect(mid?.generatingJobId).toBe(jobId);

    const second = createFakeAi({
      script: routed(pipelineScript().slice(SLIDES_INDEX + evaluateAt)),
    });
    await lessonGenerateJob(
      ctxFor<"lesson.generate">(jobId, { lessonId, revision: 1 }, depsWith(second)).ctx,
    );

    expect(second.calls.map((c) => c.context?.stage)).toEqual(["evaluate"]);
    const done = await getDocument(ws(), lessonId);
    expect(parseLesson(done?.body).generation?.stage).toBe("repaired");
    expect(done?.generatingJobId).toBeNull();
  });
});
